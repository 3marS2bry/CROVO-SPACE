// Unified Firebase-Firestore + WebCrypto Edge Router (zero node:sqlite, zero D1, zero local JSON storage)
// Runs cleanly on both Cloudflare Pages Functions and local Node.js Express.

import {
  decryptSecret,
  encryptSecret,
  generateId,
  hashIp,
  randomHex,
  safeCompareStrings,
  sha256Hex,
  signToken,
  verifyToken,
} from './crypto.ts';
import {
  type AdUnitConfig,
  type AdWorkflowStatus,
  buildDefaultSiteConfig,
  DEFAULT_TOOL_SERVICES,
  DEFAULT_TOOL_VIDEOS,
  getBundledChapters,
  getChapterSectionDefaultTitle,
  type LibraryAdDraftConfig,
  type PublicSiteConfig,
  type ToolServiceConfig,
  type ToolVideoConfig,
} from './defaults.ts';
import {
  buildDefaultAdUnits,
  mergeAdUnitsWithDefaults,
  sanitizeAdUnit,
  syncLegacyAdFieldsFromUnits,
  syncUnitsFromLegacyAdFields,
} from '../../src/utils/adSystem.ts';
import {
  calculateOrderPricing,
  formatOrderCode,
  isOfferCurrentlyActive,
  validateCommentPayload,
  validateOrderPayload,
  validateQuestionReportPayload,
} from './domain.ts';
import { verifyFirebaseIdToken, type VerifiedFirebaseUser } from './firebaseJwt.ts';
import {
  checkFirestoreHealth,
  type CommitWriteInput,
  commitWrites,
  createDoc,
  deleteDoc,
  type FirestoreConfig,
  FirestoreHttpError,
  getDoc,
  listCollection,
  patchDoc,
  resolveFirestoreConfig,
  runQuery,
  setDoc,
} from './firestoreRest.ts';
import { pullRemoteLiveSnapshot, runLiveFirestoreMerge } from './liveMigration.ts';
import { checkRateLimit } from './rateLimit.ts';
import type { AuthUser, Env } from './types.ts';
import {
  NOTIFICATION_TEMPLATES,
  pickNextTemplateForSubscriber,
  resolveVapidKeys,
  sendWebPushMessage,
} from './webPush.ts';

interface RequestCtx {
  request: Request;
  url: URL;
  path: string;
  method: string;
  env: Env;
  cfg: FirestoreConfig;
  visitorId: string;
  visitorToken: string;
  ipHash: string;
  idToken: string | null;
  fbUser: VerifiedFirebaseUser | null;
  currentUser: AuthUser | null;
  cookies: Record<string, string>;
  sessionSecret: string;
  encryptionKey: string;
  setCookies: string[];
}

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const ALLOWED_ANALYTICS_EVENTS = new Set([
  'page_view',
  'library_open',
  'tool_view',
  'level_view',
  'library_search',
  'question_copy',
  'user_login',
  'order_create',
  'tool_run',
  'push_error',
]);

let devBaseSecretCache = '';
const derivedSecretCache = new Map<string, { sessionSecret: string; encryptionKey: string }>();

async function resolveRuntimeSecrets(env: Env): Promise<{ sessionSecret: string; encryptionKey: string }> {
  const envSession = (env.SESSION_SECRET || '').trim();
  const envEnc = (env.CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!envSession && !devBaseSecretCache) {
    devBaseSecretCache = randomHex(32);
  }
  const cacheKey = `${envSession || devBaseSecretCache}::${envEnc}`;
  const cached = derivedSecretCache.get(cacheKey);
  if (cached) return cached;

  const baseSession = envSession || devBaseSecretCache;
  const sessionSecret = await sha256Hex(`sign:${baseSession}`);
  const encryptionKey =
    envEnc && envEnc !== envSession
      ? envEnc
      : await sha256Hex(`enc:${envEnc || baseSession}`);

  const resolved = { sessionSecret, encryptionKey };
  derivedSecretCache.set(cacheKey, resolved);
  return resolved;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function serializeCookie(
  request: Request,
  name: string,
  value: string,
  maxAgeSeconds: number,
  httpOnly = true
): string {
  const proto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '');
  const isHttps = proto === 'https';
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    isHttps ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (isHttps) parts.push('Secure');
  if (httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

const PUBLIC_CACHE_TTL_MS = 300_000;
const USER_LIKES_CACHE_TTL_MS = 120_000;
const ADMIN_READ_CACHE_TTL_MS = 180_000;
const AUTH_USER_CACHE_TTL_MS = 60_000;
const AUTH_USER_DEGRADED_TTL_MS = 15_000;
const QUOTA_COOLDOWN_MS = 30_000;

const publicReadCache = new Map<string, { value: unknown; expiresAt: number }>();
const lastKnownPublicValues = new Map<string, unknown>();
const inflightPublicReads = new Map<string, Promise<unknown>>();
const quotaCooldownUntilMap = new Map<string, number>();
let allowQuotaCooldownInMock = false;
const userCommentLikesCache = new Map<string, { likedIds: Set<string>; expiresAt: number }>();
const adminReadCache = new Map<string, { value: unknown; expiresAt: number }>();
const resolvedAuthUserCache = new Map<string, { user: AuthUser | null; expiresAt: number }>();

type DbStatusState = 'ok' | 'auth_required' | 'quota_exceeded' | 'error';
type NormalizedAdminGrade = 'bac1' | 'bac2' | 'unclassified';

const lastKnownAdminOverviewMap = new Map<string, Record<string, unknown>>();
const lastKnownAdminUsersMap = new Map<string, Record<string, unknown>>();
const lastKnownAdminAnalyticsMap = new Map<string, Record<string, unknown>>();
const OWNER_ADMIN_EMAIL = '3mars7bry@gmail.com';
const verifiedAdminRoleCache = new Map<string, number>();

export function setAllowQuotaCooldownInMock(enabled: boolean): void {
  allowQuotaCooldownInMock = enabled;
}

export function resetFirestoreQuotaCooldown(): void {
  quotaCooldownUntilMap.clear();
}

function isQuotaCooldownActive(cfg: FirestoreConfig): boolean {
  if (isMockedFetchActive() && !allowQuotaCooldownInMock) return false;
  const until = quotaCooldownUntilMap.get(`${cfg.projectId}:${cfg.databaseId}`) || 0;
  return until > Date.now();
}

function isExplicitQuotaError(err: unknown): boolean {
  if (err instanceof FirestoreHttpError && err.status === 429) return true;
  const msg = err instanceof Error ? err.message : String(err || '');
  return /quota|resource_exhausted|429/i.test(msg);
}

function markQuotaExceeded(cfg: FirestoreConfig): void {
  if (isMockedFetchActive() && !allowQuotaCooldownInMock) return;
  quotaCooldownUntilMap.set(`${cfg.projectId}:${cfg.databaseId}`, Date.now() + QUOTA_COOLDOWN_MS);
}

function clearQuotaCooldown(cfg: FirestoreConfig): void {
  quotaCooldownUntilMap.delete(`${cfg.projectId}:${cfg.databaseId}`);
}

function warmPublicReadCache(cfg: FirestoreConfig, cacheKey: string, value: unknown, ttlMs = PUBLIC_CACHE_TTL_MS): void {
  if (isMockedFetchActive()) return;
  const scopedKey = `${cfg.projectId}:${cfg.databaseId}:${cacheKey}`;
  publicReadCache.set(scopedKey, { value, expiresAt: Date.now() + ttlMs });
  lastKnownPublicValues.set(scopedKey, value);
}

function isOwnerAdminUser(fbUser: VerifiedFirebaseUser | null): boolean {
  return Boolean(
    fbUser &&
      fbUser.emailVerified &&
      typeof fbUser.email === 'string' &&
      fbUser.email.toLowerCase() === OWNER_ADMIN_EMAIL
  );
}

function buildFallbackVerifiedUser(fbUser: VerifiedFirebaseUser, isAdmin: boolean): AuthUser {
  return {
    id: fbUser.uid,
    serialNumber: null,
    name: (fbUser.name || fbUser.email.split('@')[0] || 'طالب').slice(0, 80),
    email: fbUser.email,
    grade: 'bac1',
    role: isAdmin ? 'admin' : 'user',
    status: 'active',
    suspendReason: null,
  };
}

export function clearPublicReadCache(prefix?: string): void {
  if (!prefix) {
    publicReadCache.clear();
    adminReadCache.clear();
    quotaCooldownUntilMap.clear();
    return;
  }
  for (const key of Array.from(publicReadCache.keys())) {
    if (key.includes(prefix)) {
      publicReadCache.delete(key);
    }
  }
}

function clearTargetedCachesForAdminMutation(path: string): void {
  adminReadCache.clear();
  if (path.startsWith('/api/admin/library')) {
    clearPublicReadCache('library:');
  } else if (
    path.startsWith('/api/admin/settings') ||
    path.startsWith('/api/admin/tool') ||
    path === '/api/admin/ad-image'
  ) {
    clearPublicReadCache('site_config');
  } else if (path.startsWith('/api/admin/poll')) {
    clearPublicReadCache('polls');
  } else if (path.startsWith('/api/admin/comments')) {
    clearPublicReadCache('comments_approved');
  } else if (path === '/api/admin/migrate-legacy' || path === '/api/admin/import-live-migration') {
    clearPublicReadCache();
  }
}

interface QuestionStatsCachedShape {
  totalCopies: number;
  copyCounts: Record<string, number>;
  topQuestions: Array<{
    questionKey: string;
    grade: string;
    section: string;
    chapterNum: number;
    qIndex: number;
    questionTitle: string;
    copyCount: number;
  }>;
}

function incrementCachedQuestionStat(
  cfg: FirestoreConfig,
  item: {
    questionKey: string;
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qIndex: number;
    questionTitle: string;
    copyCount: number;
  }
): void {
  const scopedKey = `${cfg.projectId}:${cfg.databaseId}:question_stats`;
  const applyToSnapshot = (snap: QuestionStatsCachedShape): QuestionStatsCachedShape => {
    const prevCount = Math.max(0, Number(snap.copyCounts[item.questionKey] || 0));
    const nextCount = Math.max(prevCount, item.copyCount);
    const delta = Math.max(0, nextCount - prevCount);
    const nextCopyCounts = { ...snap.copyCounts, [item.questionKey]: nextCount };
    const nextTopMap = new Map(snap.topQuestions.map((q) => [q.questionKey, { ...q }]));
    const existingTop = nextTopMap.get(item.questionKey);
    if (existingTop) {
      existingTop.copyCount = nextCount;
      if (item.questionTitle) existingTop.questionTitle = item.questionTitle;
    } else {
      nextTopMap.set(item.questionKey, {
        questionKey: item.questionKey,
        grade: item.grade,
        section: item.section,
        chapterNum: item.chapterNum,
        qIndex: item.qIndex,
        questionTitle: item.questionTitle,
        copyCount: nextCount,
      });
    }
    const nextTop = Array.from(nextTopMap.values())
      .sort((a, b) => b.copyCount - a.copyCount)
      .slice(0, 6);
    return {
      totalCopies: snap.totalCopies + delta,
      copyCounts: nextCopyCounts,
      topQuestions: nextTop,
    };
  };

  const cached = publicReadCache.get(scopedKey);
  if (cached && cached.value && typeof cached.value === 'object') {
    const updated = applyToSnapshot(cached.value as QuestionStatsCachedShape);
    publicReadCache.set(scopedKey, { value: updated, expiresAt: cached.expiresAt });
    lastKnownPublicValues.set(scopedKey, updated);
    return;
  }
  const lastKnown = lastKnownPublicValues.get(scopedKey);
  if (lastKnown && typeof lastKnown === 'object') {
    lastKnownPublicValues.set(scopedKey, applyToSnapshot(lastKnown as QuestionStatsCachedShape));
  }
}

function clearUserCommentLikesCache(cfg: FirestoreConfig, userId?: string): void {
  if (!userId) {
    userCommentLikesCache.clear();
    return;
  }
  userCommentLikesCache.delete(`${cfg.projectId}:${cfg.databaseId}:${userId}`);
}

function clearAuthUserCache(cfg: FirestoreConfig, userId?: string): void {
  if (!userId) {
    resolvedAuthUserCache.clear();
    return;
  }
  resolvedAuthUserCache.delete(`${cfg.projectId}:${cfg.databaseId}:${userId}`);
}

function isMockedFetchActive(): boolean {
  return typeof globalThis.fetch === 'function' && globalThis.fetch.name !== 'fetch';
}

function dbScopeKey(cfg: FirestoreConfig): string {
  return `${cfg.projectId}:${cfg.databaseId}`;
}

function classifyDbError(err: unknown): { status: 'quota_exceeded' | 'error'; message: string } {
  const msg = err instanceof Error ? err.message : String(err || 'خطأ غير معروف في قاعدة البيانات');
  const status =
    (err instanceof FirestoreHttpError && err.status === 429) || /quota|resource_exhausted|429/i.test(msg)
      ? 'quota_exceeded'
      : 'error';
  return { status, message: msg };
}

function isQuotaOrTransientDbError(err: unknown): boolean {
  if (err instanceof FirestoreHttpError && (err.status === 429 || err.status === 503 || err.status === 500)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err || '');
  return /quota|resource_exhausted|429|unavailable/i.test(msg);
}

async function safePublicWithFallback<T>(
  fallbackValue: T,
  loader: () => Promise<T>
): Promise<{ value: T; degraded: boolean }> {
  try {
    return { value: await loader(), degraded: false };
  } catch (err) {
    if (isQuotaOrTransientDbError(err)) {
      return { value: fallbackValue, degraded: true };
    }
    throw err;
  }
}

function normalizeAdminGrade(rawGrade: unknown): NormalizedAdminGrade {
  if (rawGrade === 'bac1') return 'bac1';
  if (rawGrade === 'bac2') return 'bac2';
  return 'unclassified';
}

async function readPublicCached<T>(
  cfg: FirestoreConfig,
  cacheKey: string,
  loader: () => Promise<T>,
  ttlMs = PUBLIC_CACHE_TTL_MS
): Promise<T> {
  const bypassMockCache = isMockedFetchActive() && !allowQuotaCooldownInMock;
  if (bypassMockCache || ttlMs <= 0) {
    return loader();
  }
  const scopedKey = `${cfg.projectId}:${cfg.databaseId}:${cacheKey}`;
  const now = Date.now();
  const cached = publicReadCache.get(scopedKey);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  // Fast-fail or serve last known good state during an active Firestore 429 cooldown window
  if (isQuotaCooldownActive(cfg)) {
    if (cached) {
      return cached.value as T;
    }
    if (lastKnownPublicValues.has(scopedKey)) {
      return lastKnownPublicValues.get(scopedKey) as T;
    }
    throw new FirestoreHttpError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded (cooldown active).');
  }

  const inflight = inflightPublicReads.get(scopedKey);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const promise = loader()
    .then((value) => {
      clearQuotaCooldown(cfg);
      publicReadCache.set(scopedKey, { value, expiresAt: Date.now() + ttlMs });
      lastKnownPublicValues.set(scopedKey, value);
      if (publicReadCache.size > 60) {
        const oldest = publicReadCache.keys().next().value;
        if (oldest) publicReadCache.delete(oldest);
      }
      if (lastKnownPublicValues.size > 60) {
        const oldest = lastKnownPublicValues.keys().next().value;
        if (oldest) lastKnownPublicValues.delete(oldest);
      }
      return value;
    })
    .catch((err) => {
      if (isExplicitQuotaError(err)) {
        markQuotaExceeded(cfg);
      }
      // Preserve last known cached public state instead of returning empty or crashing on transient quota limits
      if (cached) {
        return cached.value as T;
      }
      if (lastKnownPublicValues.has(scopedKey)) {
        return lastKnownPublicValues.get(scopedKey) as T;
      }
      throw err;
    })
    .finally(() => {
      inflightPublicReads.delete(scopedKey);
    });

  inflightPublicReads.set(scopedKey, promise);
  return promise;
}

function jsonResponse(
  ctx: Pick<RequestCtx, 'visitorToken' | 'setCookies'>,
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Crovo-Visitor-Token': ctx.visitorToken,
    ...extraHeaders,
  });
  for (const c of ctx.setCookies) {
    headers.append('Set-Cookie', c);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function toValidIdOrFallback(raw: string, prefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return VALID_ID_RE.test(cleaned) ? cleaned : generateId(prefix);
}

function normalizeIsoTimestamp(val: unknown): string {
  if (typeof val === 'string' && val) return val;
  return new Date().toISOString();
}

function mergeSiteConfig(raw: Record<string, unknown> | null, env: Env): PublicSiteConfig {
  const base = buildDefaultSiteConfig(env.ADMIN_WHATSAPP_NUMBER);
  if (!raw) return base;

  const whatsappNumber =
    typeof raw.whatsappNumber === 'string' && raw.whatsappNumber.trim().length >= 6
      ? raw.whatsappNumber.trim()
      : base.whatsappNumber;

  const heroPromo =
    raw.heroPromo && typeof raw.heroPromo === 'object'
      ? { ...base.heroPromo, ...(raw.heroPromo as Partial<PublicSiteConfig['heroPromo']>) }
      : base.heroPromo;
  const promoBanner =
    raw.promoBanner && typeof raw.promoBanner === 'object'
      ? { ...base.promoBanner, ...(raw.promoBanner as Partial<PublicSiteConfig['promoBanner']>) }
      : base.promoBanner;
  const libraryAd =
    raw.libraryAd && typeof raw.libraryAd === 'object'
      ? { ...base.libraryAd, ...(raw.libraryAd as Partial<PublicSiteConfig['libraryAd']>) }
      : base.libraryAd;
  const ads = mergeAdUnitsWithDefaults(raw.ads, { promoBanner, heroPromo, libraryAd });

  return {
    ...base,
    qureoOldPrice: typeof raw.qureoOldPrice === 'number' ? raw.qureoOldPrice : base.qureoOldPrice,
    qureoOfferPrice: typeof raw.qureoOfferPrice === 'number' ? raw.qureoOfferPrice : base.qureoOfferPrice,
    finOldPrice: typeof raw.finOldPrice === 'number' ? raw.finOldPrice : base.finOldPrice,
    finOfferPrice: typeof raw.finOfferPrice === 'number' ? raw.finOfferPrice : base.finOfferPrice,
    bundleOldPrice: typeof raw.bundleOldPrice === 'number' ? raw.bundleOldPrice : base.bundleOldPrice,
    bundleOfferPrice: typeof raw.bundleOfferPrice === 'number' ? raw.bundleOfferPrice : base.bundleOfferPrice,
    offerDurationHours:
      typeof raw.offerDurationHours === 'number' ? raw.offerDurationHours : base.offerDurationHours,
    offerEndsAt: typeof raw.offerEndsAt === 'string' && raw.offerEndsAt ? raw.offerEndsAt : base.offerEndsAt,
    afterOfferMode: raw.afterOfferMode === 'extended_offer' ? 'extended_offer' : 'regular_price',
    ordersEnabled: typeof raw.ordersEnabled === 'boolean' ? raw.ordersEnabled : base.ordersEnabled,
    pollClosed: typeof raw.pollClosed === 'boolean' ? raw.pollClosed : base.pollClosed,
    whatsappNumber,
    adminWhatsappDisplay:
      typeof raw.adminWhatsappDisplay === 'string' && raw.adminWhatsappDisplay.trim().length >= 6
        ? raw.adminWhatsappDisplay.trim()
        : whatsappNumber,
    offerText: typeof raw.offerText === 'string' && raw.offerText ? raw.offerText : base.offerText,
    notificationsEnabled:
      typeof raw.notificationsEnabled === 'boolean' ? raw.notificationsEnabled : base.notificationsEnabled,
    notificationsIntervalDays:
      typeof raw.notificationsIntervalDays === 'number'
        ? Math.max(1, Math.min(365, Math.round(raw.notificationsIntervalDays)))
        : base.notificationsIntervalDays,
    heroPromo,
    promoBanner,
    libraryAd,
    ads,
    toolServices: Array.isArray(raw.toolServices)
      ? (raw.toolServices as ToolServiceConfig[])
      : DEFAULT_TOOL_SERVICES,
    toolVideos: Array.isArray(raw.toolVideos)
      ? (raw.toolVideos as ToolVideoConfig[])
      : DEFAULT_TOOL_VIDEOS,
    trackingStartedAt:
      typeof raw.trackingStartedAt === 'string' && raw.trackingStartedAt
        ? raw.trackingStartedAt
        : base.trackingStartedAt,
  };
}

function buildPublicConfigResponse(cfgObj: PublicSiteConfig) {
  const nowMs = Date.now();
  return {
    ...cfgObj,
    offerActive: isOfferCurrentlyActive(cfgObj, nowMs),
    serverTime: new Date(nowMs).toISOString(),
  };
}

async function getSiteConfigCached(cfg: FirestoreConfig, env: Env): Promise<PublicSiteConfig> {
  const raw = await readPublicCached(cfg, 'site_config', async () => {
    const doc = await getDoc<Record<string, unknown>>(cfg, 'site_config/public', { apiKey: cfg.apiKey });
    return doc?.data || null;
  });
  return mergeSiteConfig(raw, env);
}

async function getToolCounterCountCached(cfg: FirestoreConfig): Promise<number> {
  return readPublicCached(cfg, 'tool_counter', async () => {
    const counterDoc = await getDoc<{ count?: number }>(cfg, 'counters/tool', { apiKey: cfg.apiKey });
    return Math.max(0, Number(counterDoc?.data.count || 0));
  });
}

async function getPollsCached(cfg: FirestoreConfig) {
  return readPublicCached(cfg, 'polls', async () =>
    listCollection<Record<string, unknown>>(cfg, 'polls', { apiKey: cfg.apiKey }, { pageSize: 50, maxDocs: 50 })
  );
}

async function getApprovedCommentsCached(cfg: FirestoreConfig) {
  return readPublicCached(cfg, 'comments_approved', async () =>
    runQuery<Record<string, unknown>>(
      cfg,
      'comments',
      {
        filters: [{ fieldPath: 'status', op: 'EQUAL', value: 'approved' }],
        limit: 200,
      },
      { apiKey: cfg.apiKey }
    )
  );
}

async function getQuestionStatsCached(cfg: FirestoreConfig) {
  return readPublicCached(cfg, 'question_stats', async () => {
    const docs = await listCollection<Record<string, unknown>>(
      cfg,
      'question_stats',
      { apiKey: cfg.apiKey },
      { pageSize: 300, maxDocs: 1000 }
    );
    let totalCopies = 0;
    const copyCounts: Record<string, number> = {};
    const items: Array<{
      questionKey: string;
      grade: string;
      section: string;
      chapterNum: number;
      qIndex: number;
      questionTitle: string;
      copyCount: number;
      updatedAt: string;
    }> = [];

    for (const d of docs) {
      const c = Math.max(0, Number(d.data.copyCount || 0));
      if (c > 0) {
        copyCounts[d.id] = c;
        totalCopies += c;
        items.push({
          questionKey: d.id,
          grade: d.data.grade === 'bac2' ? 'bac2' : 'bac1',
          section: d.data.section === 'py' || d.data.section === 'fin' ? String(d.data.section) : 'js',
          chapterNum: Number(d.data.chapterNum || 1),
          qIndex: Number(d.data.qIndex || 0),
          questionTitle: String(d.data.questionTitle || ''),
          copyCount: c,
          updatedAt: normalizeIsoTimestamp(d.data.updatedAt),
        });
      }
    }

    items.sort((a, b) => b.copyCount - a.copyCount || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return {
      totalCopies,
      copyCounts,
      topQuestions: items.slice(0, 6).map(({ updatedAt: _u, ...rest }) => rest),
    };
  });
}

function buildSiteConfigDocPayload(cfgObj: PublicSiteConfig): Record<string, unknown> {
  const cleanWhatsapp = cfgObj.whatsappNumber.replace(/\D/g, '').slice(0, 24) || '201550324450';
  return {
    id: 'public',
    qureoOldPrice: Math.max(1, Math.round(cfgObj.qureoOldPrice)),
    qureoOfferPrice: Math.max(1, Math.round(cfgObj.qureoOfferPrice)),
    finOldPrice: Math.max(1, Math.round(cfgObj.finOldPrice)),
    finOfferPrice: Math.max(1, Math.round(cfgObj.finOfferPrice)),
    bundleOldPrice: Math.max(1, Math.round(cfgObj.bundleOldPrice)),
    bundleOfferPrice: Math.max(1, Math.round(cfgObj.bundleOfferPrice)),
    offerDurationHours: Math.max(1, Number(cfgObj.offerDurationHours || 48)),
    offerEndsAt: String(cfgObj.offerEndsAt || new Date(Date.now() + 48 * 3600_000).toISOString()).slice(0, 64),
    afterOfferMode: cfgObj.afterOfferMode === 'extended_offer' ? 'extended_offer' : 'regular_price',
    ordersEnabled: cfgObj.ordersEnabled !== false,
    pollClosed: Boolean(cfgObj.pollClosed),
    whatsappNumber: cleanWhatsapp,
    adminWhatsappDisplay: (cfgObj.adminWhatsappDisplay || cleanWhatsapp).replace(/\D/g, '').slice(0, 24) || cleanWhatsapp,
    offerText: String(cfgObj.offerText || '').slice(0, 400),
    notificationsEnabled: cfgObj.notificationsEnabled !== false,
    notificationsIntervalDays: Math.max(1, Math.min(365, Math.round(cfgObj.notificationsIntervalDays || 3))),
    heroPromo: cfgObj.heroPromo,
    promoBanner: cfgObj.promoBanner,
    libraryAd: cfgObj.libraryAd,
    ads: (cfgObj.ads || []).slice(0, 40),
    toolServices: cfgObj.toolServices.slice(0, 30),
    toolVideos: cfgObj.toolVideos.slice(0, 30),
    trackingStartedAt: String(cfgObj.trackingStartedAt).slice(0, 64),
  };
}

async function resolveAdminStatus(
  cfg: FirestoreConfig,
  fbUser: VerifiedFirebaseUser,
  idToken: string
): Promise<boolean> {
  if (!fbUser.emailVerified) return false;
  if (isOwnerAdminUser(fbUser)) {
    verifiedAdminRoleCache.set(fbUser.uid, Date.now());
    return true;
  }
  if (!isMockedFetchActive()) {
    const cachedAt = verifiedAdminRoleCache.get(fbUser.uid) || 0;
    if (Date.now() - cachedAt < 10 * 60_000) {
      return true;
    }
  }
  try {
    const marker = await getDoc(cfg, `admins/${fbUser.uid}`, { idToken });
    if (marker) {
      verifiedAdminRoleCache.set(fbUser.uid, Date.now());
      return true;
    }
  } catch (err) {
    if (err instanceof FirestoreHttpError && (err.status === 401 || err.status === 403)) {
      return false;
    }
    if (isQuotaOrTransientDbError(err)) {
      return false;
    }
    throw err;
  }

  // Fallback check via Firestore Rules evaluation for delegated admins
  try {
    await listCollection(cfg, 'admins', { idToken }, { pageSize: 1, maxDocs: 1 });
    verifiedAdminRoleCache.set(fbUser.uid, Date.now());
    try {
      await createDoc(
        cfg,
        'admins',
        fbUser.uid,
        {
          uid: fbUser.uid,
          email: fbUser.email || fbUser.uid,
        },
        ['createdAt'],
        { idToken }
      );
    } catch {
      // Ignore concurrent creation race
    }
    return true;
  } catch (err) {
    if (err instanceof FirestoreHttpError && (err.status === 401 || err.status === 403)) {
      return false;
    }
    if (isQuotaOrTransientDbError(err)) {
      return false;
    }
    throw err;
  }
}

async function resolveAuthenticatedUser(
  cfg: FirestoreConfig,
  fbUser: VerifiedFirebaseUser | null,
  idToken: string | null
): Promise<AuthUser | null> {
  if (!fbUser || !idToken || !VALID_ID_RE.test(fbUser.uid)) return null;

  const isOwner = isOwnerAdminUser(fbUser);
  const cacheKey = `${cfg.projectId}:${cfg.databaseId}:${fbUser.uid}`;
  if (!isMockedFetchActive()) {
    const cached = resolvedAuthUserCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }
  }

  let profileDoc: { id: string; data: Record<string, unknown> } | null = null;
  let isAdminMarker = isOwner;
  let degraded = false;

  try {
    profileDoc = await getDoc<Record<string, unknown>>(cfg, `users/${fbUser.uid}`, { idToken });
    if (!isOwner) {
      isAdminMarker = await resolveAdminStatus(cfg, fbUser, idToken);
    }
  } catch (err) {
    if (!isQuotaOrTransientDbError(err)) {
      throw err;
    }
    degraded = true;
    const cachedAdminAt = verifiedAdminRoleCache.get(fbUser.uid) || 0;
    isAdminMarker = isOwner || (fbUser.emailVerified && Date.now() - cachedAdminAt < 10 * 60_000);
  }

  let resolved: AuthUser;
  if (!profileDoc) {
    resolved = buildFallbackVerifiedUser(fbUser, isAdminMarker);
  } else {
    const d = profileDoc.data;
    const role: 'user' | 'admin' = isOwner || isAdminMarker || d.role === 'admin' ? 'admin' : 'user';
    const status: 'active' | 'suspended' = d.status === 'suspended' ? 'suspended' : 'active';

    resolved = {
      id: fbUser.uid,
      serialNumber: typeof d.serialNumber === 'string' ? d.serialNumber : null,
      name: typeof d.name === 'string' && d.name ? d.name : fbUser.name || 'طالب',
      email: typeof d.email === 'string' && d.email ? d.email : fbUser.email,
      grade: d.grade === 'bac2' ? 'bac2' : 'bac1',
      role,
      status,
      suspendReason: typeof d.suspendReason === 'string' ? d.suspendReason : null,
    };
  }

  if (!isMockedFetchActive()) {
    resolvedAuthUserCache.set(cacheKey, {
      user: resolved,
      expiresAt: Date.now() + (degraded ? AUTH_USER_DEGRADED_TTL_MS : AUTH_USER_CACHE_TTL_MS),
    });
    if (resolvedAuthUserCache.size > 150) {
      const oldest = resolvedAuthUserCache.keys().next().value;
      if (oldest) resolvedAuthUserCache.delete(oldest);
    }
  }
  return resolved;
}

async function ensureUserSerialAndProfile(
  cfg: FirestoreConfig,
  fbUser: VerifiedFirebaseUser,
  idToken: string,
  opts: { name?: string; grade?: 'bac1' | 'bac2'; requestedSerial?: string | null }
): Promise<AuthUser> {
  const uid = fbUser.uid;
  const existingDoc = await getDoc<Record<string, unknown>>(cfg, `users/${uid}`, { idToken });
  const isAdmin = await resolveAdminStatus(cfg, fbUser, idToken);

  const safeEmail = (fbUser.email || `${uid}@users.crovo.local`).slice(0, 160);
  const rawName = (opts.name || fbUser.name || safeEmail.split('@')[0] || 'طالب CROVO').trim().slice(0, 80);
  const safeName = rawName.length >= 2 ? rawName : `${rawName} طالب`;
  const grade: 'bac1' | 'bac2' = opts.grade === 'bac2' ? 'bac2' : 'bac1';

  if (existingDoc) {
    const d = existingDoc.data;
    if (d.status === 'suspended' && !isAdmin) {
      throw new Error(`تم إيقاف هذا الحساب مؤقتًا: ${String(d.suspendReason || 'تواصل مع الإدارة')}.`);
    }

    let serial = typeof d.serialNumber === 'string' && /^CRV-\d{4,}$/.test(d.serialNumber) ? d.serialNumber : null;
    if (!serial) {
      serial = await allocateSerialAtomically(cfg, uid, opts.requestedSerial || null, { idToken }, null);
    }

    const updatedFields: Record<string, unknown> = {
      name: opts.name && opts.name.trim().length >= 2 ? opts.name.trim().slice(0, 80) : String(d.name || safeName),
      grade: opts.grade || (d.grade === 'bac2' ? 'bac2' : 'bac1'),
    };
    const updateMask = ['name', 'grade', 'updatedAt'];
    if (isAdmin && d.role !== 'admin') {
      updatedFields.role = 'admin';
      updateMask.push('role');
    }
    await patchDoc(cfg, `users/${uid}`, updatedFields, updateMask, ['updatedAt'], { idToken }, true);

    return {
      id: uid,
      serialNumber: serial,
      name: String(updatedFields.name),
      email: String(d.email || safeEmail),
      grade: updatedFields.grade as 'bac1' | 'bac2',
      role: isAdmin || d.role === 'admin' ? 'admin' : 'user',
      status: d.status === 'suspended' ? 'suspended' : 'active',
      suspendReason: typeof d.suspendReason === 'string' ? d.suspendReason : null,
    };
  }

  const baseProfile: Record<string, unknown> = {
    uid,
    name: safeName,
    email: safeEmail,
    grade,
    role: 'user',
    status: 'active',
  };
  if (fbUser.picture && fbUser.picture.length <= 500) {
    baseProfile.photoUrl = fbUser.picture;
  }

  const assignedSerial = await allocateSerialAtomically(
    cfg,
    uid,
    opts.requestedSerial || null,
    { idToken },
    baseProfile
  );

  if (isAdmin) {
    try {
      await patchDoc(cfg, `users/${uid}`, { role: 'admin' }, ['role', 'updatedAt'], ['updatedAt'], { idToken }, true);
    } catch {
      // Non-fatal
    }
  }

  return {
    id: uid,
    serialNumber: assignedSerial,
    name: safeName,
    email: safeEmail,
    grade,
    role: isAdmin ? 'admin' : 'user',
    status: 'active',
    suspendReason: null,
  };
}

async function allocateSerialAtomically(
  cfg: FirestoreConfig,
  uid: string,
  preferredSerial: string | null,
  auth: { idToken: string },
  createProfilePayload: Record<string, unknown> | null
): Promise<string> {
  if (createProfilePayload) {
    try {
      const counterDoc = await getDoc<{ count?: number }>(cfg, 'counters/user_serial', auth);
      const nextCount = counterDoc ? Math.max(1000, Number(counterDoc.data.count || 1000)) + 1 : 1001;
      const serial = `CRV-${nextCount}`;

      await commitWrites(
        cfg,
        [
          {
            docPath: 'counters/user_serial',
            data: { id: 'user_serial', count: nextCount },
            updateMask: counterDoc ? ['count', 'updatedAt'] : undefined,
            serverTimeFields: ['updatedAt'],
            exists: counterDoc ? true : false,
          },
          {
            docPath: `users/${uid}`,
            data: { ...createProfilePayload, serialNumber: serial },
            serverTimeFields: ['createdAt', 'updatedAt'],
            exists: false,
          },
        ],
        auth
      );
      return serial;
    } catch (err) {
      if (isQuotaOrTransientDbError(err)) {
        if (isExplicitQuotaError(err)) markQuotaExceeded(cfg);
        throw err;
      }
      const fallbackData = { ...createProfilePayload };
      if (preferredSerial && /^CRV-[0-9]{4,}$/.test(preferredSerial)) {
        fallbackData.serialNumber = preferredSerial;
      }
      await createDoc(cfg, 'users', uid, fallbackData, ['createdAt', 'updatedAt'], auth);
      return (fallbackData.serialNumber as string) || '';
    }
  }

  try {
    const counterDoc = await getDoc<{ count?: number }>(cfg, 'counters/user_serial', auth);
    const nextCount = counterDoc ? Math.max(1000, Number(counterDoc.data.count || 1000)) + 1 : 1001;
    const serial = `CRV-${nextCount}`;

    await commitWrites(
      cfg,
      [
        {
          docPath: 'counters/user_serial',
          data: { id: 'user_serial', count: nextCount },
          updateMask: counterDoc ? ['count', 'updatedAt'] : undefined,
          serverTimeFields: ['updatedAt'],
          exists: counterDoc ? true : false,
        },
        {
          docPath: `users/${uid}`,
          data: { serialNumber: serial },
          updateMask: ['serialNumber', 'updatedAt'],
          serverTimeFields: ['updatedAt'],
          exists: true,
        },
      ],
      auth
    );
    return serial;
  } catch (err) {
    if (isExplicitQuotaError(err)) markQuotaExceeded(cfg);
    return preferredSerial || '';
  }
}

async function recordAnalyticsEvent(
  cfg: FirestoreConfig,
  input: {
    eventType: string;
    visitorId: string;
    userId?: string | null;
    path?: string | null;
    grade?: 'bac1' | 'bac2' | null;
    section?: 'js' | 'py' | 'fin' | null;
    chapterNum?: number | null;
    query?: string | null;
    resultsCount?: number | null;
  }
): Promise<void> {
  if (!ALLOWED_ANALYTICS_EVENTS.has(input.eventType)) return;
  if (isQuotaCooldownActive(cfg)) return;
  const id = generateId('ev');
  const data: Record<string, unknown> = {
    id,
    eventType: input.eventType,
    visitorId: toValidIdOrFallback(input.visitorId, 'v'),
  };
  if (input.userId && VALID_ID_RE.test(input.userId)) {
    data.userId = input.userId;
  }
  if (input.path) data.path = input.path.slice(0, 120);
  if (input.grade === 'bac1' || input.grade === 'bac2') data.grade = input.grade;
  if (input.section === 'js' || input.section === 'py' || input.section === 'fin') data.section = input.section;
  if (typeof input.chapterNum === 'number' && Number.isFinite(input.chapterNum)) {
    data.chapterNum = Math.max(0, Math.min(500, Math.round(input.chapterNum)));
  }
  if (typeof input.query === 'string' && input.query.trim()) {
    data.query = input.query.trim().slice(0, 160);
  }
  if (typeof input.resultsCount === 'number' && Number.isFinite(input.resultsCount)) {
    data.resultsCount = Math.max(0, Math.min(5000, Math.round(input.resultsCount)));
  }

  try {
    await createDoc(cfg, 'analytics_events', id, data, ['createdAt'], { apiKey: cfg.apiKey });
  } catch (err) {
    if (isExplicitQuotaError(err)) {
      markQuotaExceeded(cfg);
    }
    throw err;
  }
}

async function logAdminAudit(
  cfg: FirestoreConfig,
  idToken: string | null,
  actorUsername: string,
  action: string,
  targetType: string,
  targetId: string | null = null,
  details?: Record<string, unknown>
): Promise<void> {
  if (!idToken) return;
  const id = generateId('aud');
  const data: Record<string, unknown> = {
    id,
    actorUsername: (actorUsername || 'admin').slice(0, 160),
    action: action.slice(0, 80),
    targetType: targetType.slice(0, 80),
  };
  if (targetId) data.targetId = targetId.slice(0, 128);
  if (details) data.detailsJson = JSON.stringify(details).slice(0, 1500);

  await createDoc(cfg, 'audit_logs', id, data, ['createdAt'], { idToken });
}

async function getApprovedCommentLikesForUser(
  cfg: FirestoreConfig,
  idToken: string,
  userId: string,
  commentDocs: Array<{ id: string }>
): Promise<Set<string>> {
  const key = `${cfg.projectId}:${cfg.databaseId}:${userId}`;
  if (!isMockedFetchActive()) {
    const cached = userCommentLikesCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.likedIds;
    }
  }
  const likedSet = new Set<string>();
  await Promise.all(
    commentDocs.slice(0, 50).map(async (d) => {
      try {
        const likeDoc = await getDoc(cfg, `comments/${d.id}/likes/${userId}`, { idToken });
        if (likeDoc) likedSet.add(d.id);
      } catch {
        // Ignore individual check error
      }
    })
  );
  if (!isMockedFetchActive()) {
    userCommentLikesCache.set(key, {
      likedIds: likedSet,
      expiresAt: Date.now() + USER_LIKES_CACHE_TTL_MS,
    });
    if (userCommentLikesCache.size > 100) {
      const oldest = userCommentLikesCache.keys().next().value;
      if (oldest) userCommentLikesCache.delete(oldest);
    }
  }
  return likedSet;
}

async function createSystemBackupSnapshot(
  cfg: FirestoreConfig,
  auth: { idToken?: string | null; apiKey?: string },
  reason: string,
  actorUsername: string,
  extraContext?: Record<string, unknown>
): Promise<{ id: string; sizeBytes: number; createdAt: string } | null> {
  if (!auth.idToken) return null;
  const authToken = { idToken: auth.idToken };
  const backupId = generateId('bak');
  const createdAt = new Date().toISOString();

  try {
    const [cfgDoc, pollDocs, toolCounter, serialCounter] = await Promise.all([
      getDoc<Record<string, unknown>>(cfg, 'site_config/public', authToken).catch(() => null),
      listCollection<Record<string, unknown>>(cfg, 'polls', authToken, { pageSize: 20, maxDocs: 20 }).catch(() => []),
      getDoc<{ count?: number }>(cfg, 'counters/tool', authToken).catch(() => null),
      getDoc<{ count?: number }>(cfg, 'counters/user_serial', authToken).catch(() => null),
    ]);

    const summaryPayload = {
      reason,
      createdAt,
      siteConfig: cfgDoc?.data || null,
      polls: pollDocs.map((p) => ({ id: p.id, ...p.data })),
      counters: {
        toolLikes: Number(toolCounter?.data.count || 0),
        userSerial: Number(serialCounter?.data.count || 1000),
      },
      extra: extraContext || null,
    };

    const countsPayload = {
      polls: pollDocs.length,
      toolLikes: Number(toolCounter?.data.count || 0),
      userSerial: Number(serialCounter?.data.count || 1000),
      hasSiteConfig: Boolean(cfgDoc?.data),
    };

    const summaryJson = JSON.stringify(summaryPayload).slice(0, 62000);
    const countsJson = JSON.stringify(countsPayload).slice(0, 1900);

    await createDoc(
      cfg,
      'system_backups',
      backupId,
      {
        id: backupId,
        reason: reason.slice(0, 80),
        actor: (actorUsername || 'admin').slice(0, 160),
        summaryJson,
        countsJson,
      },
      ['createdAt'],
      authToken
    );

    return {
      id: backupId,
      sizeBytes: new TextEncoder().encode(summaryJson).byteLength,
      createdAt,
    };
  } catch {
    return null;
  }
}

interface FirebasePasswordSignInResult {
  idToken: string;
  refreshToken: string;
  expiresInSec: number;
}

const refreshedTokenCache = new Map<string, { idToken: string; expiresAtMs: number }>();

async function signInFirebaseWithPassword(
  apiKey: string,
  email: string,
  password: string
): Promise<FirebasePasswordSignInResult | null> {
  if (!apiKey || !email || !password) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      idToken?: string;
      refreshToken?: string;
      expiresIn?: string | number;
    };
    if (!data.idToken || !data.refreshToken) return null;
    return {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresInSec: Math.max(60, Number(data.expiresIn || 3600)),
    };
  } catch {
    return null;
  }
}

async function refreshFirebaseIdToken(apiKey: string, refreshToken: string): Promise<string | null> {
  if (!apiKey || !refreshToken) return null;
  const cacheKey = await sha256Hex(refreshToken);
  const cached = refreshedTokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.idToken;
  }
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { id_token?: string; expires_in?: string | number };
    if (!data.id_token) return null;
    const ttlSec = Math.max(120, Math.min(3600, Number(data.expires_in || 3600)));
    refreshedTokenCache.set(cacheKey, {
      idToken: data.id_token,
      expiresAtMs: Date.now() + (ttlSec - 60) * 1000,
    });
    if (refreshedTokenCache.size > 50) {
      const oldestKey = refreshedTokenCache.keys().next().value;
      if (oldestKey) refreshedTokenCache.delete(oldestKey);
    }
    return data.id_token;
  } catch {
    return null;
  }
}

async function requireAdminContext(
  ctx: RequestCtx
): Promise<{ idToken: string | null; username: string; hasFirebaseToken: boolean } | null> {
  if (ctx.idToken && ctx.fbUser) {
    if (ctx.currentUser?.role === 'admin' && ctx.currentUser?.status === 'active') {
      verifiedAdminRoleCache.set(ctx.fbUser.uid, Date.now());
      return {
        idToken: ctx.idToken,
        username: ctx.currentUser.email || ctx.currentUser.name || ctx.fbUser.uid,
        hasFirebaseToken: true,
      };
    }

    const cachedAt = verifiedAdminRoleCache.get(ctx.fbUser.uid) || 0;
    const hasFreshAdminCache = ctx.fbUser.emailVerified && Date.now() - cachedAt < 10 * 60_000;
    if (
      isOwnerAdminUser(ctx.fbUser) ||
      (hasFreshAdminCache && ctx.currentUser?.status !== 'suspended')
    ) {
      verifiedAdminRoleCache.set(ctx.fbUser.uid, Date.now());
      return {
        idToken: ctx.idToken,
        username: ctx.fbUser.email || ctx.fbUser.uid,
        hasFirebaseToken: true,
      };
    }
  }

  const rawAdminCookie = ctx.cookies['crovo_admin_session'];
  if (!rawAdminCookie) return null;

  const session = await verifyToken<{
    role?: string;
    username?: string;
    fbRefreshToken?: string;
    exp?: number;
  }>(rawAdminCookie, ctx.sessionSecret);

  if (
    !session ||
    session.role !== 'admin' ||
    typeof session.username !== 'string' ||
    !session.username ||
    typeof session.exp !== 'number' ||
    session.exp <= Date.now()
  ) {
    return null;
  }

  if (!session.fbRefreshToken && (!ctx.env.ADMIN_USERNAME?.trim() || !ctx.env.ADMIN_PASSWORD)) {
    return null;
  }

  let resolvedIdToken: string | null = null;
  if (session.fbRefreshToken && ctx.cfg.apiKey) {
    resolvedIdToken = await refreshFirebaseIdToken(ctx.cfg.apiKey, session.fbRefreshToken);
  }

  return {
    idToken: resolvedIdToken,
    username: session.username,
    hasFirebaseToken: Boolean(resolvedIdToken),
  };
}

async function applyRateLimitOr429(
  ctx: RequestCtx,
  action: string,
  actorKey: string,
  maxRequests: number,
  windowSeconds: number
): Promise<Response | null> {
  const res = await checkRateLimit(ctx.env, action, actorKey, maxRequests, windowSeconds);
  if (res.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((res.resetAt - Date.now()) / 1000));
  return jsonResponse(
    ctx,
    { error: 'محاولات كثيرة في وقت قصير، من فضلك انتظر قليلاً وحاول مرة أخرى.' },
    429,
    { 'Retry-After': String(retryAfter) }
  );
}

interface StoredOverride {
  id: string;
  grade: 'bac1' | 'bac2';
  section: 'js' | 'py' | 'fin';
  chapterNum: number;
  qIndex: number;
  qText: string;
  aText: string;
  isCode: boolean;
  deleted: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
}

async function loadMergedLibrarySection(
  cfg: FirestoreConfig,
  grade: 'bac1' | 'bac2',
  section: 'js' | 'py' | 'fin'
): Promise<Array<{ num: number; title: string; qs: Array<{ id?: string; q: string; a: string; code: boolean; qIndex?: number }> }>> {
  const bundleId = `${grade}_${section}`;
  const [bundleDoc, overrideDocs] = await Promise.all([
    getDoc<{
      chapters?: Array<{ num: number; title?: string }>;
      questions?: Array<{ chapterNum: number; qIndex: number; q: string; a: string; code?: boolean }>;
    }>(cfg, `library_bundles/${bundleId}`, { apiKey: cfg.apiKey }),
    runQuery<StoredOverride>(
      cfg,
      'library_overrides',
      {
        filters: [
          { fieldPath: 'grade', op: 'EQUAL', value: grade },
          { fieldPath: 'section', op: 'EQUAL', value: section },
        ],
        limit: 500,
      },
      { apiKey: cfg.apiKey }
    ),
  ]);

  const chapterTitleMap = new Map<number, string>();
  const questionMap = new Map<string, { chapterNum: number; qIndex: number; q: string; a: string; code: boolean; id?: string }>();

  if (bundleDoc && Array.isArray(bundleDoc.data.chapters)) {
    for (const c of bundleDoc.data.chapters) {
      chapterTitleMap.set(Number(c.num), c.title || getChapterSectionDefaultTitle(grade, section, Number(c.num)));
    }
    for (const q of bundleDoc.data.questions || []) {
      const ch = Number(q.chapterNum);
      const qi = Number(q.qIndex);
      const id = `lib_${grade}_${section}_${ch}_${qi}`;
      questionMap.set(`${ch}:${qi}`, {
        id,
        chapterNum: ch,
        qIndex: qi,
        q: String(q.q || ''),
        a: String(q.a || ''),
        code: Boolean(q.code),
      });
    }
  } else {
    const bundled = getBundledChapters(grade, section);
    for (const ch of bundled) {
      chapterTitleMap.set(ch.num, getChapterSectionDefaultTitle(grade, section, ch.num));
      ch.qs.forEach((item, idx) => {
        const id = `lib_${grade}_${section}_${ch.num}_${idx}`;
        questionMap.set(`${ch.num}:${idx}`, {
          id,
          chapterNum: ch.num,
          qIndex: idx,
          q: item.q,
          a: item.a,
          code: Boolean(item.code),
        });
      });
    }
  }

  for (const ovDoc of overrideDocs) {
    const ov = ovDoc.data;
    const ch = Number(ov.chapterNum || 1);
    const qi = Number(ov.qIndex || 0);
    if (!chapterTitleMap.has(ch)) {
      chapterTitleMap.set(ch, getChapterSectionDefaultTitle(grade, section, ch));
    }
    const key = `${ch}:${qi}`;
    if (ov.deleted) {
      questionMap.delete(key);
    } else {
      questionMap.set(key, {
        id: ovDoc.id,
        chapterNum: ch,
        qIndex: qi,
        q: String(ov.qText || ''),
        a: String(ov.aText || ''),
        code: Boolean(ov.isCode),
      });
    }
  }

  const byChapter = new Map<number, Array<{ id?: string; q: string; a: string; code: boolean; qIndex: number }>>();
  for (const q of questionMap.values()) {
    const arr = byChapter.get(q.chapterNum) || [];
    arr.push(q);
    byChapter.set(q.chapterNum, arr);
  }

  const chapterNums = Array.from(chapterTitleMap.keys()).sort((a, b) => a - b);
  return chapterNums.map((num) => ({
    num,
    title: chapterTitleMap.get(num) || getChapterSectionDefaultTitle(grade, section, num),
    qs: (byChapter.get(num) || [])
      .sort((a, b) => a.qIndex - b.qIndex)
      .map(({ id, q, a, code, qIndex }) => ({ id, q, a, code, qIndex })),
  }));
}

function buildPollStateFromDoc(
  docId: string,
  d: Record<string, unknown>,
  userChoice: string | null,
  pollClosedFromConfig = false
) {
  const rawOptions = Array.isArray(d.options) ? (d.options as Array<Record<string, unknown>>) : [];
  const totalVotes = rawOptions.reduce((sum, o) => sum + Math.max(0, Number(o.count || 0)), 0);
  const options = rawOptions.map((o) => {
    const count = Math.max(0, Number(o.count || 0));
    return {
      key: String(o.key || ''),
      label: String(o.label || ''),
      count,
      percent: totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0,
    };
  });
  const endsAt = typeof d.endsAt === 'string' && d.endsAt ? d.endsAt : null;
  const expired = Boolean(endsAt && Date.parse(endsAt) <= Date.now());
  const closed = pollClosedFromConfig || d.isOpen === false || expired;
  const ext = options.find((o) => o.key === 'extend') || options[0];
  const eno = options.find((o) => o.key === 'enough') || options[1];

  return {
    pollId: docId,
    question: String(d.question || 'إيه رأيكم نمد العرض؟'),
    closed,
    startsAt: typeof d.startsAt === 'string' && d.startsAt ? d.startsAt : null,
    endsAt,
    requiresAuth: true,
    totalVotes,
    extendCount: ext?.count || 0,
    enoughCount: eno?.count || 0,
    extendPercent: ext?.percent || 0,
    enoughPercent: eno?.percent || 0,
    userChoice,
    options,
  };
}

function toCairoDayKey(tsMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(tsMs));
  } catch {
    return new Date(tsMs).toISOString().slice(0, 10);
  }
}

function getCairoMidnightUtcMs(tsMs: number): number {
  const dayKey = toCairoDayKey(tsMs);
  // Cairo is UTC+2 (or UTC+3 during DST); anchor day bucket safely around Cairo midnight
  const probe = Date.parse(`${dayKey}T00:00:00+02:00`);
  return Number.isFinite(probe) ? probe : new Date(tsMs).setUTCHours(0, 0, 0, 0);
}

function computeDashboardAnalytics(params: {
  range: string;
  fromParam?: string | null;
  toParam?: string | null;
  trackingStartedAt: string;
  events: Array<{ id: string; data: Record<string, unknown> }>;
  dailyDocs?: Array<{ id: string; data: Record<string, unknown> }>;
  users: Array<{ id: string; data: Record<string, unknown> }>;
  orders: Array<{ id: string; data: Record<string, unknown> }>;
  questionStats: Array<{ id: string; data: Record<string, unknown> }>;
  toolRuns: Array<{ id: string; data: Record<string, unknown> }>;
  comments: Array<{ id: string; data: Record<string, unknown> }>;
  polls: Array<{ id: string; data: Record<string, unknown> }>;
  toolLikesCount: number;
}) {
  const now = new Date();
  let fromMs: number;
  let toMs = now.getTime();

  switch (params.range) {
    case 'today': {
      fromMs = getCairoMidnightUtcMs(toMs);
      break;
    }
    case '30d':
      fromMs = toMs - 30 * 24 * 3600_000;
      break;
    case 'year':
      fromMs = toMs - 365 * 24 * 3600_000;
      break;
    case 'all':
      fromMs = Date.parse(params.trackingStartedAt) || Date.parse('2026-01-01T00:00:00.000Z');
      break;
    case 'custom':
      fromMs = params.fromParam ? Date.parse(params.fromParam) || toMs - 7 * 24 * 3600_000 : toMs - 7 * 24 * 3600_000;
      toMs = params.toParam ? Date.parse(`${params.toParam}T23:59:59.999Z`) || toMs : toMs;
      break;
    case '7d':
    default:
      fromMs = toMs - 7 * 24 * 3600_000;
      break;
  }

  const periodLen = Math.max(24 * 3600_000, toMs - fromMs);
  const prevFromMs = fromMs - periodLen;
  const prevToMs = fromMs;

  const uniqueSet = new Set<string>();
  const prevUniqueSet = new Set<string>();
  const activeUserSet = new Set<string>();
  const levelMap = new Map<string, { grade: string; section: string; chapterNum: number; views: number }>();
  const searchMap = new Map<string, { query: string; count: number; zeroResults: number }>();
  const dayMap = new Map<string, { day: string; visitors: Set<string>; visits: number; libraryOpens: number; searches: number }>();

  let totalVisits = 0;
  let prevTotalVisits = 0;
  let libraryOpens = 0;
  let searches = 0;
  let zeroResultSearches = 0;

  for (const evDoc of params.events) {
    const e = evDoc.data;
    const ts = Date.parse(normalizeIsoTimestamp(e.createdAt));
    if (!Number.isFinite(ts)) continue;
    const vid = String(e.visitorId || '');
    const uid = typeof e.userId === 'string' ? e.userId : null;
    const evType = String(e.eventType || '');

    if (ts >= prevFromMs && ts < prevToMs) {
      if (vid) prevUniqueSet.add(vid);
      if (evType === 'page_view') prevTotalVisits += 1;
    }

    if (ts < fromMs || ts > toMs) continue;

    if (vid) uniqueSet.add(vid);
    if (uid) activeUserSet.add(uid);

    const dayKey = toCairoDayKey(ts);
    const dayEntry = dayMap.get(dayKey) || {
      day: dayKey,
      visitors: new Set<string>(),
      visits: 0,
      libraryOpens: 0,
      searches: 0,
    };
    if (vid) dayEntry.visitors.add(vid);

    if (evType === 'page_view') {
      totalVisits += 1;
      dayEntry.visits += 1;
    } else if (evType === 'library_open') {
      libraryOpens += 1;
      dayEntry.libraryOpens += 1;
    } else if (evType === 'level_view' && e.grade && e.section && e.chapterNum) {
      const k = `${String(e.grade)}_${String(e.section)}_${Number(e.chapterNum)}`;
      const existing = levelMap.get(k) || {
        grade: String(e.grade),
        section: String(e.section),
        chapterNum: Number(e.chapterNum),
        views: 0,
      };
      existing.views += 1;
      levelMap.set(k, existing);
    } else if (evType === 'library_search') {
      searches += 1;
      dayEntry.searches += 1;
      const rc = Number(e.resultsCount ?? 1);
      if (rc === 0) zeroResultSearches += 1;
      const qStr = typeof e.query === 'string' ? e.query.trim() : '';
      if (qStr) {
        const sEntry = searchMap.get(qStr) || { query: qStr, count: 0, zeroResults: 0 };
        sEntry.count += 1;
        if (rc === 0) sEntry.zeroResults += 1;
        searchMap.set(qStr, sEntry);
      }
    }

    dayMap.set(dayKey, dayEntry);
  }

  // Merge historical aggregated daily counts from analytics_daily (monotonic Math.max per day)
  const dailySummaryMap = new Map<
    string,
    { day: string; visits: number; uniqueVisitors: number; libraryOpens: number; searches: number }
  >();
  for (const [dayKey, d] of dayMap.entries()) {
    dailySummaryMap.set(dayKey, {
      day: dayKey,
      visits: d.visits,
      uniqueVisitors: d.visitors.size,
      libraryOpens: d.libraryOpens,
      searches: d.searches,
    });
  }

  let dailyAggUniqueSum = 0;
  let prevDailyAggUniqueSum = 0;
  for (const dailyDoc of params.dailyDocs || []) {
    const rawDay = String(dailyDoc.data.id || dailyDoc.id || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDay)) continue;
    const dayStartMs = Date.parse(`${rawDay}T00:00:00.000Z`);
    const dayEndMs = Date.parse(`${rawDay}T23:59:59.999Z`);
    if (!Number.isFinite(dayStartMs)) continue;

    const dVisits = Math.max(0, Number(dailyDoc.data.visits || 0));
    const dUnique = Math.max(0, Number(dailyDoc.data.uniqueVisitors || 0));
    const dOpens = Math.max(0, Number(dailyDoc.data.libraryOpens || 0));
    const dSearches = Math.max(0, Number(dailyDoc.data.searches || 0));

    if (dayEndMs >= prevFromMs && dayStartMs < prevToMs) {
      prevDailyAggUniqueSum += dUnique;
    }
    if (dayEndMs < fromMs || dayStartMs > toMs) continue;

    dailyAggUniqueSum += dUnique;
    const existing = dailySummaryMap.get(rawDay) || {
      day: rawDay,
      visits: 0,
      uniqueVisitors: 0,
      libraryOpens: 0,
      searches: 0,
    };
    const nextVisits = Math.max(existing.visits, dVisits);
    const nextOpens = Math.max(existing.libraryOpens, dOpens);
    const nextSearches = Math.max(existing.searches, dSearches);
    const nextUnique = Math.max(existing.uniqueVisitors, dUnique);

    if (nextVisits > existing.visits) totalVisits += nextVisits - existing.visits;
    if (nextOpens > existing.libraryOpens) libraryOpens += nextOpens - existing.libraryOpens;
    if (nextSearches > existing.searches) searches += nextSearches - existing.searches;

    dailySummaryMap.set(rawDay, {
      day: rawDay,
      visits: nextVisits,
      uniqueVisitors: nextUnique,
      libraryOpens: nextOpens,
      searches: nextSearches,
    });
  }

  let newInPeriod = 0;
  let prevNewInPeriod = 0;
  for (const u of params.users) {
    const ts = Date.parse(normalizeIsoTimestamp(u.data.createdAt));
    if (ts >= fromMs && ts <= toMs) newInPeriod += 1;
    else if (ts >= prevFromMs && ts < prevToMs) prevNewInPeriod += 1;
  }

  let totalCopies = 0;
  for (const qs of params.questionStats) {
    totalCopies += Math.max(0, Number(qs.data.copyCount || 0));
  }

  const completedSubscribers = params.orders.filter((o) => o.data.status === 'completed').length;
  const totalPollVotes = params.polls.reduce((sum, p) => sum + Math.max(0, Number(p.data.totalVotes || 0)), 0);

  let succeededRuns = 0;
  let failedRuns = 0;
  let durSum = 0;
  const recentErrors: Array<{ id: string; serviceKey: string; errorMessage: string | null; createdAt: string }> = [];

  for (const tr of params.toolRuns) {
    if (tr.data.status === 'success') succeededRuns += 1;
    else if (tr.data.status === 'failed') {
      failedRuns += 1;
      recentErrors.push({
        id: tr.id,
        serviceKey: String(tr.data.serviceKey || ''),
        errorMessage: typeof tr.data.errorMessage === 'string' ? tr.data.errorMessage : null,
        createdAt: normalizeIsoTimestamp(tr.data.createdAt),
      });
    }
    durSum += Math.max(0, Number(tr.data.durationMs || 0));
  }

  return {
    range: params.range || '7d',
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    trackingStartedAt: params.trackingStartedAt,
    visitors: {
      uniqueVisitors: Math.max(uniqueSet.size, dailyAggUniqueSum),
      prevUniqueVisitors: Math.max(prevUniqueSet.size, prevDailyAggUniqueSum),
      totalVisits,
      prevTotalVisits,
      sessions: Math.max(uniqueSet.size, dailyAggUniqueSum),
    },
    users: {
      totalRegistered: params.users.length,
      newInPeriod,
      prevNewInPeriod,
      activeUsers: activeUserSet.size,
      completedSubscribers,
      totalOrders: params.orders.length,
    },
    library: {
      opens: libraryOpens,
      searches,
      zeroResultSearches,
      totalCopies,
      topLevels: Array.from(levelMap.values()).sort((a, b) => b.views - a.views).slice(0, 8),
      topSearchTerms: Array.from(searchMap.values()).sort((a, b) => b.count - a.count).slice(0, 10),
    },
    tool: {
      totalRuns: params.toolRuns.length,
      succeededRuns,
      failedRuns,
      avgDurationMs: params.toolRuns.length > 0 ? Math.round(durSum / params.toolRuns.length) : 0,
      recentErrors: recentErrors.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 8),
    },
    engagement: {
      totalLikes: params.toolLikesCount,
      totalComments: params.comments.length,
      totalPollVotes,
    },
    timeline: Array.from(dailySummaryMap.values()).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const cfg = resolveFirestoreConfig(env);
  const { sessionSecret, encryptionKey } = await resolveRuntimeSecrets(env);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const cookies = parseCookies(request.headers.get('cookie'));
  const setCookies: string[] = [];

  // Resolve HMAC visitor token (stateless identity cookie/header)
  const headerVisitor = (request.headers.get('x-crovo-visitor') || '').trim();
  const candidateVisitor = cookies['crovo_visitor'] || headerVisitor;
  const parsedVisitor = candidateVisitor
    ? await verifyToken<{ vid?: string }>(candidateVisitor, sessionSecret)
    : null;

  let visitorId: string;
  let visitorToken: string;
  if (parsedVisitor && typeof parsedVisitor.vid === 'string' && VALID_ID_RE.test(parsedVisitor.vid)) {
    visitorId = parsedVisitor.vid;
    visitorToken = candidateVisitor;
  } else {
    visitorId = generateId('v');
    visitorToken = await signToken({ vid: visitorId }, sessionSecret);
    setCookies.push(serializeCookie(request, 'crovo_visitor', visitorToken, 365 * 24 * 60 * 60));
  }

  const clientIp =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const ipHash = await hashIp(clientIp, sessionSecret);

  // Verify Firebase ID token from Authorization: Bearer <idToken>
  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const idToken = bearerToken || null;

  let fbUser: VerifiedFirebaseUser | null = null;
  let currentUser: AuthUser | null = null;

  if (idToken) {
    try {
      fbUser = await verifyFirebaseIdToken(idToken);
    } catch {
      fbUser = null;
    }
    if (fbUser) {
      try {
        currentUser = await resolveAuthenticatedUser(cfg, fbUser, idToken);
      } catch {
        // Keep verified fbUser intact so admin/status handlers can report dbStatus cleanly on 429/503 outages
        currentUser = null;
      }
    }
  }

  const ctx: RequestCtx = {
    request,
    url,
    path,
    method,
    env,
    cfg,
    visitorId,
    visitorToken,
    ipHash,
    idToken,
    fbUser,
    currentUser,
    cookies,
    sessionSecret,
    encryptionKey,
    setCookies,
  };

  try {
    // ==================== HEALTH CHECK ====================
    if (method === 'GET' && path === '/api/health') {
      try {
        const probe = await checkFirestoreHealth(cfg);
        clearQuotaCooldown(cfg);
        return jsonResponse(ctx, {
          ok: probe.ok,
          engine: 'firebase-firestore',
          latencyMs: probe.latencyMs,
          kvRateLimit: Boolean(env.RATE_LIMIT_KV),
          serverTime: new Date().toISOString(),
        });
      } catch (err) {
        if (isExplicitQuotaError(err)) {
          markQuotaExceeded(cfg);
        }
        return jsonResponse(
          ctx,
          {
            ok: false,
            engine: 'firebase-firestore',
            kvRateLimit: Boolean(env.RATE_LIMIT_KV),
            error: err instanceof Error ? err.message : 'تعذر الاتصال بقاعدة بيانات Firestore.',
          },
          503
        );
      }
    }

    // ==================== LEGACY STUDENT PASSWORD ROUTES (RETIRED) ====================
    if (
      method === 'POST' &&
      (path === '/api/auth/register' || path === '/api/auth/login')
    ) {
      return jsonResponse(
        ctx,
        { error: 'تم إيقاف تسجيل الدخول التقليدي نهائياً. استخدم المصادقة السحابية عبر Firebase فقط.' },
        410
      );
    }

    // ==================== USER AUTH ====================
    if (method === 'POST' && path === '/api/auth/cloud-sync') {
      const rlResp = await applyRateLimitOr429(ctx, 'auth_sync', ipHash, 20, 15 * 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      const tokenCandidate = (typeof body.idToken === 'string' && body.idToken.trim()) || idToken || '';
      if (!tokenCandidate) {
        return jsonResponse(ctx, { error: 'رمز التحقق من Firebase مطلوب.' }, 400);
      }

      const verified = await verifyFirebaseIdToken(tokenCandidate);
      if (!verified) {
        return jsonResponse(ctx, { error: 'انتهت صلاحية جلسة Firebase أو الرمز غير صالح.' }, 401);
      }

      try {
        clearAuthUserCache(cfg, verified.uid);
        const user = await ensureUserSerialAndProfile(cfg, verified, tokenCandidate, {
          name: typeof body.name === 'string' ? body.name : undefined,
          grade: body.grade === 'bac2' ? 'bac2' : body.grade === 'bac1' ? 'bac1' : undefined,
          requestedSerial: typeof body.serialNumber === 'string' ? body.serialNumber.trim() : null,
        });

        await recordAnalyticsEvent(cfg, {
          eventType: 'user_login',
          visitorId,
          userId: user.id,
          path: '/auth/cloud-sync',
          grade: user.grade,
        }).catch(() => {});

        return jsonResponse(ctx, { ok: true, user });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'تعذر مزامنة بيانات الحساب.';
        if (msg.includes('إيقاف')) {
          return jsonResponse(ctx, { error: msg }, 403);
        }
        if (isQuotaOrTransientDbError(err)) {
          const fallbackUser = buildFallbackVerifiedUser(verified, isOwnerAdminUser(verified));
          if (body.grade === 'bac1' || body.grade === 'bac2') {
            fallbackUser.grade = body.grade;
          }
          if (typeof body.name === 'string' && body.name.trim().length >= 2) {
            fallbackUser.name = body.name.trim().slice(0, 80);
          }
          return jsonResponse(ctx, { ok: true, user: fallbackUser, quotaDegraded: true });
        }
        return jsonResponse(ctx, { error: msg }, 503);
      }
    }

    if (method === 'GET' && path === '/api/auth/me') {
      if (!currentUser) {
        return jsonResponse(ctx, { authenticated: false, user: null });
      }
      return jsonResponse(ctx, { authenticated: true, user: currentUser });
    }

    if (method === 'POST' && path === '/api/auth/logout') {
      return jsonResponse(ctx, { ok: true });
    }

    // ==================== PUBLIC CONFIG / BOOTSTRAP / LIBRARY / ANALYTICS ====================
    const publicCacheHeader = (authenticated: boolean) =>
      authenticated
        ? { 'Cache-Control': 'private, no-store' }
        : { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30' };

    if (method === 'GET' && path === '/api/bootstrap') {
      const grade: 'bac1' | 'bac2' = url.searchParams.get('grade') === 'bac2' ? 'bac2' : 'bac1';
      const secParam = url.searchParams.get('section');
      const section: 'js' | 'py' | 'fin' =
        grade === 'bac1' ? 'js' : secParam === 'py' || secParam === 'fin' ? secParam : 'js';

      const fallbackChapters = getBundledChapters(grade, section).map((ch) => ({
        num: ch.num,
        title: getChapterSectionDefaultTitle(grade, section, ch.num),
        qs: ch.qs.map((q, idx) => ({
          id: `lib_${grade}_${section}_${ch.num}_${idx}`,
          q: q.q,
          a: q.a,
          code: Boolean(q.code),
          qIndex: idx,
        })),
      }));

      const [siteCfgRes, toolLikesRes, libRes, pollsRes, commentsRes, qStatsRes, userToolLikeDoc] =
        await Promise.all([
          safePublicWithFallback(mergeSiteConfig(null, env), () => getSiteConfigCached(cfg, env)),
          safePublicWithFallback(0, () => getToolCounterCountCached(cfg)),
          safePublicWithFallback(fallbackChapters, () =>
            readPublicCached(cfg, `library:${grade}:${section}`, () => loadMergedLibrarySection(cfg, grade, section))
          ),
          safePublicWithFallback([] as Array<{ id: string; data: Record<string, unknown>; createTime?: string }>, () =>
            getPollsCached(cfg)
          ),
          safePublicWithFallback([] as Array<{ id: string; data: Record<string, unknown>; createTime?: string }>, () =>
            getApprovedCommentsCached(cfg)
          ),
          safePublicWithFallback(
            { totalCopies: 0, copyCounts: {} as Record<string, number>, topQuestions: [] },
            () => getQuestionStatsCached(cfg)
          ),
          currentUser && idToken
            ? getDoc(cfg, `tool_likes/${currentUser.id}`, { idToken }).catch(() => null)
            : Promise.resolve(null),
        ]);

      const siteCfg = siteCfgRes.value;
      const toolLikesCount = toolLikesRes.value;
      const libraryChapters = libRes.value;
      const pollDocs = pollsRes.value;
      const commentDocs = commentsRes.value;
      const questionStats = qStatsRes.value;
      const quotaDegraded =
        siteCfgRes.degraded ||
        toolLikesRes.degraded ||
        libRes.degraded ||
        pollsRes.degraded ||
        commentsRes.degraded ||
        qStatsRes.degraded;

      const sortedPolls = [...pollDocs].sort(
        (a, b) => Date.parse(normalizeIsoTimestamp(b.data.createdAt)) - Date.parse(normalizeIsoTimestamp(a.data.createdAt))
      );
      const targetPollDoc = sortedPolls[0];

      let pollUserChoice: string | null = null;
      let commentLikedSet = new Set<string>();
      if (currentUser && idToken) {
        const [voteDoc, likedIds] = await Promise.all([
          targetPollDoc
            ? getDoc<{ choice?: string }>(cfg, `polls/${targetPollDoc.id}/votes/${currentUser.id}`, { idToken }).catch(() => null)
            : Promise.resolve(null),
          getApprovedCommentLikesForUser(cfg, idToken, currentUser.id, commentDocs).catch(() => new Set<string>()),
        ]);
        commentLikedSet = likedIds;
        if (voteDoc?.data.choice) {
          pollUserChoice = String(voteDoc.data.choice);
        }
      }

      const pollState = targetPollDoc
        ? buildPollStateFromDoc(targetPollDoc.id, targetPollDoc.data, pollUserChoice, siteCfg.pollClosed)
        : {
            pollId: 'poll_extend_offer',
            question: 'إيه رأيكم نمد عرض الـ50%؟',
            closed: siteCfg.pollClosed,
            startsAt: null,
            endsAt: null,
            requiresAuth: true,
            totalVotes: 0,
            extendCount: 0,
            enoughCount: 0,
            extendPercent: 0,
            enoughPercent: 0,
            userChoice: null,
            options: [
              { key: 'extend', label: 'أيوة، مدهولنا شوية كمان 🙏', count: 0, percent: 0 },
              { key: 'enough', label: 'لا، كده كفاية 👍', count: 0, percent: 0 },
            ],
          };

      const comments = commentDocs
        .map((d) => {
          const c = d.data;
          const beforeUrl = typeof c.attachmentBeforeDataUrl === 'string' ? c.attachmentBeforeDataUrl : null;
          const afterUrl = typeof c.attachmentAfterDataUrl === 'string' ? c.attachmentAfterDataUrl : null;
          return {
            id: d.id,
            authorName: String(c.authorName || ''),
            grade: String(c.grade || 'تانية بكالوريا'),
            rating: Number(c.rating || 5),
            content: String(c.content || ''),
            avatarUrl: typeof c.avatarDataUrl === 'string' ? c.avatarDataUrl : null,
            attachmentUrl: beforeUrl,
            attachmentBeforeUrl: beforeUrl,
            attachmentAfterUrl: afterUrl,
            contactPhone: null,
            showContactPublicly: false,
            isVerified: Boolean(c.isVerified),
            isOwner: Boolean(currentUser && c.authorUid === currentUser.id),
            likesCount: Math.max(0, Number(c.likesCount || 0)),
            hasLiked: commentLikedSet.has(d.id),
            createdAt: normalizeIsoTimestamp(c.createdAt || d.createTime),
            updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : null,
          };
        })
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

      return jsonResponse(
        ctx,
        {
          config: buildPublicConfigResponse(siteCfg),
          likes: {
            itemKey: 'tool',
            count: toolLikesCount,
            liked: Boolean(userToolLikeDoc),
          },
          library: {
            grade,
            section,
            chapters: libraryChapters.map((c) => ({
              num: c.num,
              title: c.title,
              qs: c.qs.map((q) => ({ q: q.q, a: q.a, code: q.code })),
            })),
          },
          poll: pollState,
          comments,
          questionStats,
          ...(quotaDegraded ? { quotaDegraded: true } : {}),
        },
        200,
        publicCacheHeader(Boolean(currentUser))
      );
    }

    if (method === 'GET' && path === '/api/config') {
      const merged = await safePublicWithFallback(mergeSiteConfig(null, env), () => getSiteConfigCached(cfg, env));
      return jsonResponse(
        ctx,
        {
          ...buildPublicConfigResponse(merged.value),
          ...(merged.degraded ? { quotaDegraded: true } : {}),
        },
        200,
        publicCacheHeader(false)
      );
    }

    if (method === 'GET' && path === '/api/library') {
      const grade: 'bac1' | 'bac2' = url.searchParams.get('grade') === 'bac2' ? 'bac2' : 'bac1';
      const secParam = url.searchParams.get('section');
      const section: 'js' | 'py' | 'fin' =
        grade === 'bac1' ? 'js' : secParam === 'py' || secParam === 'fin' ? secParam : 'js';

      const fallbackChapters = getBundledChapters(grade, section).map((ch) => ({
        num: ch.num,
        title: getChapterSectionDefaultTitle(grade, section, ch.num),
        qs: ch.qs.map((q, idx) => ({
          id: `lib_${grade}_${section}_${ch.num}_${idx}`,
          q: q.q,
          a: q.a,
          code: Boolean(q.code),
          qIndex: idx,
        })),
      }));

      const libRes = await safePublicWithFallback(fallbackChapters, () =>
        readPublicCached(cfg, `library:${grade}:${section}`, () => loadMergedLibrarySection(cfg, grade, section))
      );
      return jsonResponse(
        ctx,
        {
          grade,
          section,
          chapters: libRes.value.map((c) => ({
            num: c.num,
            title: c.title,
            qs: c.qs.map((q) => ({ q: q.q, a: q.a, code: q.code })),
          })),
          ...(libRes.degraded ? { quotaDegraded: true } : {}),
        },
        200,
        publicCacheHeader(false)
      );
    }

    if (method === 'POST' && path === '/api/analytics/event') {
      const rlResp = await applyRateLimitOr429(ctx, 'analytics_ev', `${ipHash}:${visitorId}`, 90, 5 * 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      const rawEventType = typeof body.eventType === 'string' ? body.eventType.trim() : '';
      if (!ALLOWED_ANALYTICS_EVENTS.has(rawEventType)) {
        return jsonResponse(ctx, { error: 'نوع الحدث غير مدعوم.' }, 400);
      }

      try {
        await recordAnalyticsEvent(cfg, {
          eventType: rawEventType,
          visitorId,
          userId: currentUser?.id || null,
          path: typeof body.path === 'string' ? body.path : null,
          grade: body.grade === 'bac2' ? 'bac2' : body.grade === 'bac1' ? 'bac1' : null,
          section:
            body.section === 'py' || body.section === 'fin' || body.section === 'js' ? body.section : null,
          chapterNum: typeof body.chapterNum === 'number' ? body.chapterNum : null,
          query: typeof body.query === 'string' ? body.query : null,
          resultsCount: typeof body.resultsCount === 'number' ? body.resultsCount : null,
        });
      } catch (err) {
        if (isQuotaOrTransientDbError(err)) {
          return jsonResponse(ctx, { ok: true, skippedQuota: true }, 202);
        }
        throw err;
      }

      return jsonResponse(ctx, { ok: true }, 202);
    }

    // ==================== QUESTION STATS & REPORTS ====================
    if (method === 'GET' && path === '/api/questions/stats') {
      const statsRes = await safePublicWithFallback(
        { totalCopies: 0, copyCounts: {}, topQuestions: [] },
        () => getQuestionStatsCached(cfg)
      );
      return jsonResponse(
        ctx,
        {
          ...statsRes.value,
          ...(statsRes.degraded ? { quotaDegraded: true } : {}),
        },
        200,
        publicCacheHeader(false)
      );
    }

    if (method === 'POST' && path === '/api/questions/copy') {
      const rlResp = await applyRateLimitOr429(ctx, 'q_copy', `${ipHash}:${visitorId}`, 120, 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      const questionKey = typeof body.questionKey === 'string' ? body.questionKey.trim() : '';
      if (!/^[a-zA-Z0-9_-]{4,60}$/.test(questionKey)) {
        return jsonResponse(ctx, { error: 'معرّف السؤال غير صالح.' }, 400);
      }

      const grade: 'bac1' | 'bac2' = body.grade === 'bac2' ? 'bac2' : 'bac1';
      const section: 'js' | 'py' | 'fin' = body.section === 'py' || body.section === 'fin' ? body.section : 'js';
      const chapterNum = Math.max(1, Math.min(200, Math.round(Number(body.chapterNum) || 1)));
      const qIndex = Math.max(0, Math.min(500, Math.round(Number(body.qIndex) || 0)));
      const questionTitle =
        typeof body.questionTitle === 'string' && body.questionTitle.trim()
          ? body.questionTitle.trim().slice(0, 180)
          : `السؤال ${qIndex + 1}`;

      let nextCount = 1;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const existing = await getDoc<Record<string, unknown>>(cfg, `question_stats/${questionKey}`, {
            apiKey: cfg.apiKey,
          });
          if (!existing) {
            try {
              await createDoc(
                cfg,
                'question_stats',
                questionKey,
                {
                  questionKey,
                  grade,
                  section,
                  chapterNum,
                  qIndex,
                  questionTitle,
                  copyCount: 1,
                },
                ['updatedAt'],
                { apiKey: cfg.apiKey }
              );
              nextCount = 1;
              break;
            } catch (createErr) {
              if (isQuotaOrTransientDbError(createErr)) throw createErr;
              continue;
            }
          } else {
            nextCount = Math.max(0, Number(existing.data.copyCount || 0)) + 1;
            await patchDoc(
              cfg,
              `question_stats/${questionKey}`,
              { copyCount: nextCount, questionTitle },
              ['copyCount', 'questionTitle', 'updatedAt'],
              ['updatedAt'],
              { apiKey: cfg.apiKey },
              true
            );
            break;
          }
        }
      } catch (err) {
        if (isQuotaOrTransientDbError(err)) {
          return jsonResponse(ctx, { ok: true, questionKey, copyCount: 1, quotaDegraded: true });
        }
        throw err;
      }

      await recordAnalyticsEvent(cfg, {
        eventType: 'question_copy',
        visitorId,
        userId: currentUser?.id || null,
        path: `/library/${grade}/${section}/${chapterNum}`,
        grade,
        section,
        chapterNum,
      }).catch(() => {});

      incrementCachedQuestionStat(cfg, {
        questionKey,
        grade,
        section,
        chapterNum,
        qIndex,
        questionTitle,
        copyCount: nextCount,
      });
      return jsonResponse(ctx, { ok: true, questionKey, copyCount: nextCount });
    }

    if (method === 'POST' && path === '/api/questions/report') {
      const rlResp = await applyRateLimitOr429(ctx, 'q_rep', `${ipHash}:${visitorId}`, 10, 15 * 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      let input;
      try {
        input = validateQuestionReportPayload(body);
      } catch (err) {
        return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'بيانات البلاغ غير صالحة.' }, 400);
      }

      const actorKey = currentUser ? currentUser.id : visitorId;
      const reportHash = await sha256Hex(`${input.questionKey}::${actorKey}`);
      const id = `qrep_${reportHash.slice(0, 28)}`;

      try {
        const reportDocData: Record<string, unknown> = {
          id,
          reporterUid: currentUser ? currentUser.id : 'guest_report',
          questionKey: input.questionKey,
          grade: input.grade,
          section: input.section,
          chapterNum: input.chapterNum,
          qIndex: input.qIndex,
          questionTitle: input.questionTitle,
          description: input.description,
          status: 'pending',
        };
        if (input.reason) reportDocData.reason = input.reason;
        if (input.suggestedSolution) reportDocData.suggestedSolution = input.suggestedSolution;
        await createDoc(
          cfg,
          'question_reports',
          id,
          reportDocData,
          ['createdAt', 'updatedAt'],
          idToken ? { idToken } : { apiKey: cfg.apiKey }
        );
      } catch (err) {
        if (err instanceof FirestoreHttpError && err.status === 409) {
          return jsonResponse(ctx, { error: 'أنت بلغت عن السؤال ده قبل كده بالفعل، والبلاغ تحت المراجعة.' }, 409);
        }
        throw err;
      }

      return jsonResponse(
        ctx,
        {
          ok: true,
          reportId: id,
          message: 'شكرًا لك! وصل بلاغك وهيتم مراجعة الإجابة من الإدارة وتحديثها.',
        },
        201
      );
    }

    // ==================== PUSH NOTIFICATIONS ====================
    if (method === 'GET' && path === '/api/push/vapid-public-key') {
      const cfgRes = await safePublicWithFallback(mergeSiteConfig(null, env), () => getSiteConfigCached(cfg, env));
      const config = cfgRes.value;
      const vapid = await resolveVapidKeys(env);
      if (!vapid) {
        return jsonResponse(ctx, {
          publicKey: '',
          enabled: false,
          intervalDays: config.notificationsIntervalDays,
          error: 'مفاتيح VAPID غير مُعدّة في بيئة الإنتاج.',
          ...(cfgRes.degraded ? { quotaDegraded: true } : {}),
        });
      }
      return jsonResponse(ctx, {
        publicKey: vapid.publicKey,
        enabled: config.notificationsEnabled,
        intervalDays: config.notificationsIntervalDays,
        ...(cfgRes.degraded ? { quotaDegraded: true } : {}),
      });
    }

    if (method === 'GET' && path === '/api/push/status') {
      const cfgRes = await safePublicWithFallback(mergeSiteConfig(null, env), () => getSiteConfigCached(cfg, env));
      const config = cfgRes.value;
      const endpointHeader = (request.headers.get('x-crovo-push-endpoint') || '').trim();
      const adminCtx = await requireAdminContext(ctx);
      let subscribed = Boolean(endpointHeader && endpointHeader.startsWith('https://'));

      if (adminCtx && adminCtx.idToken && endpointHeader) {
        const subId = `sub_${(await sha256Hex(endpointHeader)).slice(0, 32)}`;
        const subDoc = await getDoc<Record<string, unknown>>(cfg, `push_subscriptions/${subId}`, {
          idToken: adminCtx.idToken,
        }).catch(() => null);
        if (subDoc) {
          subscribed = subDoc.data.enabled === true;
        }
      }

      return jsonResponse(ctx, {
        subscribed,
        notificationsEnabled: config.notificationsEnabled,
        intervalDays: config.notificationsIntervalDays,
        ...(cfgRes.degraded ? { quotaDegraded: true } : {}),
      });
    }

    if (method === 'POST' && path === '/api/push/subscribe') {
      const rlResp = await applyRateLimitOr429(ctx, 'push_sub', `${ipHash}:${visitorId}`, 15, 10 * 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      const keys = (body.keys && typeof body.keys === 'object' ? body.keys : {}) as Record<string, unknown>;
      const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
      const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
      const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';

      if (!endpoint.startsWith('https://') || endpoint.length < 16 || endpoint.length > 1000 || !p256dh || !auth) {
        return jsonResponse(ctx, { error: 'بيانات اشتراك الإشعارات غير صالحة.' }, 400);
      }

      const subId = `sub_${(await sha256Hex(endpoint)).slice(0, 32)}`;
      const createData: Record<string, unknown> = {
        id: subId,
        visitorId,
        endpoint,
        p256dh: p256dh.slice(0, 300),
        auth: auth.slice(0, 160),
        enabled: true,
      };
      if (currentUser?.id && VALID_ID_RE.test(currentUser.id)) {
        createData.userId = currentUser.id;
      }

      try {
        await createDoc(
          cfg,
          'push_subscriptions',
          subId,
          createData,
          ['createdAt', 'updatedAt'],
          idToken ? { idToken } : { apiKey: cfg.apiKey }
        );
      } catch (err) {
        if (err instanceof FirestoreHttpError && (err.status === 409 || err.status === 400)) {
          const updateData: Record<string, unknown> = {
            enabled: true,
            p256dh: p256dh.slice(0, 300),
            auth: auth.slice(0, 160),
            visitorId,
          };
          const updateMask = ['enabled', 'p256dh', 'auth', 'visitorId', 'updatedAt'];
          if (currentUser?.id && VALID_ID_RE.test(currentUser.id)) {
            updateData.userId = currentUser.id;
            updateMask.push('userId');
          }
          await patchDoc(
            cfg,
            `push_subscriptions/${subId}`,
            updateData,
            updateMask,
            ['updatedAt'],
            idToken ? { idToken } : { apiKey: cfg.apiKey },
            true
          );
        } else {
          throw err;
        }
      }

      return jsonResponse(ctx, { ok: true, subscribed: true }, 201);
    }

    if (method === 'POST' && path === '/api/push/unsubscribe') {
      const body = await readJsonBody(request);
      const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
      if (endpoint && endpoint.startsWith('https://')) {
        const subId = `sub_${(await sha256Hex(endpoint)).slice(0, 32)}`;
        await patchDoc(
          cfg,
          `push_subscriptions/${subId}`,
          { enabled: false },
          ['enabled', 'updatedAt'],
          ['updatedAt'],
          idToken ? { idToken } : { apiKey: cfg.apiKey },
          true
        ).catch(() => {});
      }
      return jsonResponse(ctx, { ok: true, subscribed: false });
    }

    if (method === 'POST' && path === '/api/push/log-error') {
      const body = await readJsonBody(request);
      const stage = typeof body.stage === 'string' ? body.stage.slice(0, 40) : 'unknown';
      const errorCode = typeof body.errorCode === 'string' ? body.errorCode.slice(0, 80) : 'unknown';
      await recordAnalyticsEvent(cfg, {
        eventType: 'push_error',
        visitorId,
        userId: currentUser?.id || null,
        path: `/push/${stage}/${errorCode}`.slice(0, 120),
      }).catch(() => {});
      return jsonResponse(ctx, { ok: true }, 202);
    }

    if (method === 'POST' && path === '/api/push/cron-dispatch') {
      const expected = (env.PUSH_CRON_SECRET || '').trim();
      const provided = String(request.headers.get('x-cron-secret') || '');
      if (!expected || !(await safeCompareStrings(provided, expected))) {
        return jsonResponse(ctx, { error: 'غير مصرح.' }, 401);
      }
      const adminCtx = await requireAdminContext(ctx);
      let cronIdToken = adminCtx?.idToken || null;
      if (!cronIdToken && env.ADMIN_FIREBASE_EMAIL && env.ADMIN_FIREBASE_PASSWORD && cfg.apiKey) {
        const signed = await signInFirebaseWithPassword(
          cfg.apiKey,
          env.ADMIN_FIREBASE_EMAIL.trim(),
          env.ADMIN_FIREBASE_PASSWORD
        );
        if (signed?.idToken) {
          const verified = await verifyFirebaseIdToken(signed.idToken);
          if (verified && (await resolveAdminStatus(cfg, verified, signed.idToken))) {
            cronIdToken = signed.idToken;
          }
        }
      }
      if (!cronIdToken) {
        return jsonResponse(
          ctx,
          {
            error:
              'على الباقة المجانية (Starter/Spark بدون مفتاح حساب خدمة)، يلزم تشغيل الإرسال الدوري من لوحة الإدارة أو تزويد رمز مصادقة المدير (أو ضبط ADMIN_FIREBASE_EMAIL و ADMIN_FIREBASE_PASSWORD).',
          },
          503
        );
      }
      const result = await dispatchNotificationsFirestore(cfg, env, cronIdToken, {
        mode: 'due',
        triggerType: 'scheduled_3d',
      });
      return jsonResponse(ctx, { ok: true, result });
    }

    // ==================== COMMENTS & REVIEWS ====================
    if (method === 'GET' && path === '/api/comments') {
      const docsRes = await safePublicWithFallback(
        [] as Array<{ id: string; data: Record<string, unknown>; createTime?: string }>,
        () => getApprovedCommentsCached(cfg)
      );
      const docs = docsRes.value;

      let likedSet = new Set<string>();
      if (currentUser && idToken && docs.length > 0) {
        likedSet = await getApprovedCommentLikesForUser(cfg, idToken, currentUser.id, docs).catch(
          () => new Set<string>()
        );
      }

      const comments = docs
        .map((d) => {
          const c = d.data;
          const beforeUrl = typeof c.attachmentBeforeDataUrl === 'string' ? c.attachmentBeforeDataUrl : null;
          const afterUrl = typeof c.attachmentAfterDataUrl === 'string' ? c.attachmentAfterDataUrl : null;
          return {
            id: d.id,
            authorName: String(c.authorName || ''),
            grade: String(c.grade || 'تانية بكالوريا'),
            rating: Number(c.rating || 5),
            content: String(c.content || ''),
            avatarUrl: typeof c.avatarDataUrl === 'string' ? c.avatarDataUrl : null,
            attachmentUrl: beforeUrl,
            attachmentBeforeUrl: beforeUrl,
            attachmentAfterUrl: afterUrl,
            contactPhone: null,
            showContactPublicly: false,
            isVerified: Boolean(c.isVerified),
            isOwner: Boolean(currentUser && c.authorUid === currentUser.id),
            likesCount: Math.max(0, Number(c.likesCount || 0)),
            hasLiked: likedSet.has(d.id),
            createdAt: normalizeIsoTimestamp(c.createdAt || d.createTime),
            updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : null,
          };
        })
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

      return jsonResponse(ctx, { comments, ...(docsRes.degraded ? { quotaDegraded: true } : {}) });
    }

    if (method === 'POST' && path === '/api/comments') {
      if (!currentUser || !idToken) {
        return jsonResponse(
          ctx,
          { error: 'سجّل دخولك الأول عشان تقدر تنشر تعليقك.', requiresAuth: true },
          401
        );
      }
      const rlResp = await applyRateLimitOr429(ctx, 'comment_create', `${ipHash}:${currentUser.id}`, 6, 10 * 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      let validated;
      try {
        validated = validateCommentPayload(body);
      } catch (err) {
        return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'بيانات التعليق غير صحيحة.' }, 400);
      }

      const avatarDataUrl = validated.avatarImage
        ? `data:${validated.avatarImage.mimeType};base64,${bytesToBase64(validated.avatarImage.bytes)}`
        : null;
      const beforeDataUrl = validated.attachmentBeforeImage
        ? `data:${validated.attachmentBeforeImage.mimeType};base64,${bytesToBase64(validated.attachmentBeforeImage.bytes)}`
        : null;
      const afterDataUrl = validated.attachmentAfterImage
        ? `data:${validated.attachmentAfterImage.mimeType};base64,${bytesToBase64(validated.attachmentAfterImage.bytes)}`
        : null;

      if (avatarDataUrl && avatarDataUrl.length > 120_000) {
        return jsonResponse(ctx, { error: 'الصورة الشخصية كبيرة جداً. صغّر حجمها لأقل من 90KB.' }, 400);
      }
      if ((beforeDataUrl && beforeDataUrl.length > 320_000) || (afterDataUrl && afterDataUrl.length > 320_000)) {
        return jsonResponse(ctx, { error: 'حجم صورة المرفق كبير جداً. الحد الأقصى 240KB للصورة.' }, 400);
      }

      if (validated.orderCode) {
        const existingForOrder = await runQuery<Record<string, unknown>>(
          cfg,
          'comments',
          {
            filters: [{ fieldPath: 'orderCode', op: 'EQUAL', value: validated.orderCode }],
            limit: 1,
          },
          { idToken }
        ).catch(() => []);
        if (existingForOrder.length > 0) {
          return jsonResponse(
            ctx,
            { error: `تم إرسال تقييم للطلب رقم #${validated.orderCode} من قبل بالفعل.` },
            409
          );
        }
      }

      const id = generateId('cmt');
      const commentStatus = validated.moderationPending ? 'pending' : 'approved';
      const commentDoc: Record<string, unknown> = {
        id,
        authorUid: currentUser.id,
        authorName: validated.authorName,
        grade: validated.grade,
        rating: validated.rating,
        content: validated.content,
        isVerified: false,
        status: commentStatus,
        likesCount: 0,
        reportsCount: 0,
      };
      if (validated.orderCode) commentDoc.orderCode = validated.orderCode;
      if (validated.source) commentDoc.source = validated.source;
      if (avatarDataUrl) commentDoc.avatarDataUrl = avatarDataUrl;
      if (beforeDataUrl) commentDoc.attachmentBeforeDataUrl = beforeDataUrl;
      if (afterDataUrl) commentDoc.attachmentAfterDataUrl = afterDataUrl;

      const writes = [
        {
          docPath: `comments/${id}`,
          data: commentDoc,
          serverTimeFields: ['createdAt'],
          exists: false,
        },
      ];
      if (validated.contactPhone) {
        writes.push({
          docPath: `comments/${id}/private/contact`,
          data: {
            commentId: id,
            authorUid: currentUser.id,
            contactPhone: validated.contactPhone,
          },
          serverTimeFields: ['createdAt'],
          exists: false,
        });
      }

      await commitWrites(cfg, writes, { idToken });
      clearPublicReadCache('comments_approved');

      return jsonResponse(
        ctx,
        {
          moderationPending: commentStatus === 'pending',
          message:
            commentStatus === 'pending'
              ? 'تم استلام تقييمك وهو الآن قيد المراجعة وسيظهر فور موافقة الإدارة.'
              : undefined,
          comment: {
            id,
            authorName: validated.authorName,
            grade: validated.grade,
            rating: validated.rating,
            content: validated.content,
            status: commentStatus,
            orderCode: validated.orderCode || null,
            avatarUrl: avatarDataUrl,
            attachmentUrl: beforeDataUrl,
            attachmentBeforeUrl: beforeDataUrl,
            attachmentAfterUrl: afterDataUrl,
            contactPhone: null,
            showContactPublicly: false,
            isVerified: false,
            isOwner: true,
            likesCount: 0,
            hasLiked: false,
            createdAt: new Date().toISOString(),
            updatedAt: null,
          },
        },
        201
      );
    }

    const commentIdMatch = path.match(/^\/api\/comments\/([a-zA-Z0-9_-]+)$/);
    if (commentIdMatch && method === 'PATCH') {
      if (!currentUser || !idToken) {
        return jsonResponse(ctx, { error: 'يلزم تسجيل الدخول أولاً.', requiresAuth: true }, 401);
      }
      const id = commentIdMatch[1];
      const existing = await getDoc<Record<string, unknown>>(cfg, `comments/${id}`, { idToken });
      if (!existing) return jsonResponse(ctx, { error: 'التعليق غير موجود.' }, 404);
      if (existing.data.authorUid !== currentUser.id && currentUser.role !== 'admin') {
        return jsonResponse(ctx, { error: 'مش مسموحلك تعدل تعليق غيرك.' }, 403);
      }

      const body = await readJsonBody(request);
      const validated = validateCommentPayload({
        authorName: body.authorName ?? existing.data.authorName,
        grade: body.grade ?? existing.data.grade,
        rating: body.rating ?? existing.data.rating,
        content: body.content ?? existing.data.content,
      });

      await patchDoc(
        cfg,
        `comments/${id}`,
        {
          authorName: validated.authorName,
          grade: validated.grade,
          rating: validated.rating,
          content: validated.content,
        },
        ['authorName', 'grade', 'rating', 'content', 'updatedAt'],
        ['updatedAt'],
        { idToken },
        true
      );
      clearPublicReadCache('comments_approved');
      return jsonResponse(ctx, { ok: true, updatedAt: new Date().toISOString() });
    }

    if (commentIdMatch && method === 'DELETE') {
      if (!currentUser || !idToken) {
        return jsonResponse(ctx, { error: 'يلزم تسجيل الدخول أولاً.', requiresAuth: true }, 401);
      }
      const id = commentIdMatch[1];
      const existing = await getDoc<Record<string, unknown>>(cfg, `comments/${id}`, { idToken });
      if (!existing) return jsonResponse(ctx, { error: 'التعليق غير موجود.' }, 404);
      if (existing.data.authorUid !== currentUser.id && currentUser.role !== 'admin') {
        return jsonResponse(ctx, { error: 'مش مسموحلك تحذف تعليق غيرك.' }, 403);
      }
      await deleteDoc(cfg, `comments/${id}`, { idToken });
      clearPublicReadCache('comments_approved');
      return jsonResponse(ctx, { ok: true });
    }

    const commentReportMatch = path.match(/^\/api\/comments\/([a-zA-Z0-9_-]+)\/report$/);
    if (commentReportMatch && method === 'POST') {
      if (!currentUser || !idToken) {
        return jsonResponse(ctx, { error: 'سجّل دخولك أولاً للإبلاغ.', requiresAuth: true }, 401);
      }
      const rlResp = await applyRateLimitOr429(ctx, 'report_cmt', `${ipHash}:${currentUser.id}`, 12, 10 * 60);
      if (rlResp) return rlResp;

      const id = commentReportMatch[1];
      const body = await readJsonBody(request);
      const reason =
        typeof body.reason === 'string' && body.reason.trim().length >= 2
          ? body.reason.trim().slice(0, 120)
          : 'محتوى غير مناسب';

      const [cmtDoc, existingRep] = await Promise.all([
        getDoc<Record<string, unknown>>(cfg, `comments/${id}`, { idToken }),
        getDoc(cfg, `comments/${id}/reports/${currentUser.id}`, { idToken }),
      ]);
      if (!cmtDoc) return jsonResponse(ctx, { error: 'التعليق غير موجود.' }, 404);
      if (existingRep) return jsonResponse(ctx, { error: 'أنت بلغت عن التعليق ده قبل كده بالفعل.' }, 409);

      const newReports = Math.max(0, Number(cmtDoc.data.reportsCount || 0)) + 1;
      const nextStatus = newReports >= 3 ? 'flagged' : 'approved';

      await commitWrites(
        cfg,
        [
          {
            docPath: `comments/${id}/reports/${currentUser.id}`,
            data: { commentId: id, userId: currentUser.id, reason },
            serverTimeFields: ['createdAt'],
            exists: false,
          },
          {
            docPath: `comments/${id}`,
            data: { reportsCount: newReports, status: nextStatus },
            updateMask: ['reportsCount', 'status'],
            exists: true,
          },
        ],
        { idToken }
      );

      return jsonResponse(ctx, {
        ok: true,
        flaggedForReview: nextStatus === 'flagged',
        message: 'تم استلام بلاغك وهيتم مراجعته من الإدارة.',
      });
    }

    // ==================== LIKES ====================
    if (method === 'GET' && path === '/api/likes') {
      const rawKey = url.searchParams.get('itemKey');
      const itemKey = rawKey && rawKey.trim() ? rawKey.trim().slice(0, 64) : 'tool';

      if (itemKey === 'tool') {
        const [countRes, likeDoc] = await Promise.all([
          safePublicWithFallback(0, () => getToolCounterCountCached(cfg)),
          currentUser && idToken
            ? getDoc(cfg, `tool_likes/${currentUser.id}`, { idToken }).catch(() => null)
            : Promise.resolve(null),
        ]);
        return jsonResponse(
          ctx,
          {
            itemKey: 'tool',
            count: countRes.value,
            liked: Boolean(likeDoc),
            ...(countRes.degraded ? { quotaDegraded: true } : {}),
          },
          200,
          publicCacheHeader(Boolean(currentUser))
        );
      }

      const commentMatch = itemKey.match(/^comment:([a-zA-Z0-9_-]{4,60})$/);
      if (commentMatch) {
        const cId = commentMatch[1];
        const [cDocRes, likeDoc] = await Promise.all([
          safePublicWithFallback(null, () =>
            getDoc<{ likesCount?: number }>(cfg, `comments/${cId}`, { apiKey: cfg.apiKey })
          ),
          currentUser && idToken
            ? getDoc(cfg, `comments/${cId}/likes/${currentUser.id}`, { idToken }).catch(() => null)
            : Promise.resolve(null),
        ]);
        return jsonResponse(ctx, {
          itemKey,
          count: Math.max(0, Number(cDocRes.value?.data.likesCount || 0)),
          liked: Boolean(likeDoc),
          ...(cDocRes.degraded ? { quotaDegraded: true } : {}),
        });
      }

      return jsonResponse(ctx, { itemKey, count: 0, liked: false });
    }

    if (method === 'POST' && path === '/api/likes/toggle') {
      if (!currentUser || !idToken) {
        return jsonResponse(
          ctx,
          { error: 'سجّل دخولك الأول عشان تضيف إعجابك ويُحسب باسمك.', requiresAuth: true },
          401
        );
      }
      const rlResp = await applyRateLimitOr429(ctx, 'like_toggle', `${ipHash}:${currentUser.id}`, 45, 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      const rawKey = typeof body.itemKey === 'string' ? body.itemKey.trim().slice(0, 64) : 'tool';
      const desiredLiked = typeof body.desiredLiked === 'boolean' ? body.desiredLiked : null;

      if (rawKey === 'tool') {
        const [counterDoc, likeDoc] = await Promise.all([
          getDoc<{ count?: number }>(cfg, 'counters/tool', { idToken }),
          getDoc(cfg, `tool_likes/${currentUser.id}`, { idToken }),
        ]);
        const curCount = Math.max(0, Number(counterDoc?.data.count || 0));
        const curLiked = Boolean(likeDoc);
        const shouldLike = desiredLiked !== null ? desiredLiked : !curLiked;

        if (shouldLike === curLiked) {
          return jsonResponse(ctx, { itemKey: 'tool', count: curCount, liked: curLiked });
        }

        const nextCount = shouldLike ? curCount + 1 : Math.max(0, curCount - 1);
        const writes = [];
        if (shouldLike) {
          writes.push({
            docPath: `tool_likes/${currentUser.id}`,
            data: { userId: currentUser.id },
            serverTimeFields: ['createdAt'],
            exists: false,
          });
          writes.push({
            docPath: 'counters/tool',
            data: { id: 'tool', count: nextCount },
            updateMask: counterDoc ? ['count', 'updatedAt'] : undefined,
            serverTimeFields: ['updatedAt'],
            exists: counterDoc ? true : false,
          });
        } else {
          writes.push({
            docPath: `tool_likes/${currentUser.id}`,
            isDelete: true,
            exists: true,
          });
          if (counterDoc) {
            writes.push({
              docPath: 'counters/tool',
              data: { count: nextCount },
              updateMask: ['count', 'updatedAt'],
              serverTimeFields: ['updatedAt'],
              exists: true,
            });
          }
        }
        await commitWrites(cfg, writes, { idToken });
        clearPublicReadCache('tool_counter');
        return jsonResponse(ctx, { itemKey: 'tool', count: nextCount, liked: shouldLike });
      }

      const commentMatch = rawKey.match(/^comment:([a-zA-Z0-9_-]{4,60})$/);
      if (!commentMatch) {
        return jsonResponse(ctx, { error: 'معرّف الإعجاب غير صالح.' }, 400);
      }
      const cId = commentMatch[1];
      const [cDoc, likeDoc] = await Promise.all([
        getDoc<Record<string, unknown>>(cfg, `comments/${cId}`, { idToken }),
        getDoc(cfg, `comments/${cId}/likes/${currentUser.id}`, { idToken }),
      ]);
      if (!cDoc) return jsonResponse(ctx, { error: 'التعليق غير موجود.' }, 404);

      const curCount = Math.max(0, Number(cDoc.data.likesCount || 0));
      const curLiked = Boolean(likeDoc);
      const shouldLike = desiredLiked !== null ? desiredLiked : !curLiked;
      if (shouldLike === curLiked) {
        return jsonResponse(ctx, { itemKey: rawKey, count: curCount, liked: curLiked });
      }

      const nextCount = shouldLike ? curCount + 1 : Math.max(0, curCount - 1);
      await commitWrites(
        cfg,
        [
          shouldLike
            ? {
                docPath: `comments/${cId}/likes/${currentUser.id}`,
                data: { commentId: cId, userId: currentUser.id },
                serverTimeFields: ['createdAt'],
                exists: false,
              }
            : {
                docPath: `comments/${cId}/likes/${currentUser.id}`,
                isDelete: true,
                exists: true,
              },
          {
            docPath: `comments/${cId}`,
            data: { likesCount: nextCount },
            updateMask: ['likesCount'],
            exists: true,
          },
        ],
        { idToken }
      );
      clearPublicReadCache('comments_approved');
      clearUserCommentLikesCache(cfg, currentUser.id);

      return jsonResponse(ctx, { itemKey: rawKey, count: nextCount, liked: shouldLike });
    }

    // ==================== POLL ====================
    if (method === 'GET' && path === '/api/poll') {
      const requestedPollId = (url.searchParams.get('pollId') || '').trim();
      const [siteCfgRes, pollDocsRes] = await Promise.all([
        safePublicWithFallback(mergeSiteConfig(null, env), () => getSiteConfigCached(cfg, env)),
        safePublicWithFallback([] as Array<{ id: string; data: Record<string, unknown>; createTime?: string }>, () =>
          getPollsCached(cfg)
        ),
      ]);
      const siteCfg = siteCfgRes.value;
      const pollDocs = pollDocsRes.value;

      const targetDoc =
        (requestedPollId ? pollDocs.find((p) => p.id === requestedPollId) : null) ||
        [...pollDocs].sort(
          (a, b) => Date.parse(normalizeIsoTimestamp(b.data.createdAt)) - Date.parse(normalizeIsoTimestamp(a.data.createdAt))
        )[0];

      if (!targetDoc) {
        return jsonResponse(
          ctx,
          {
            pollId: 'poll_extend_offer',
            question: 'إيه رأيكم نمد عرض الـ50%؟',
            closed: siteCfg.pollClosed,
            startsAt: null,
            endsAt: null,
            requiresAuth: true,
            totalVotes: 0,
            extendCount: 0,
            enoughCount: 0,
            extendPercent: 0,
            enoughPercent: 0,
            userChoice: null,
            options: [
              { key: 'extend', label: 'أيوة، مدهولنا شوية كمان 🙏', count: 0, percent: 0 },
              { key: 'enough', label: 'لا، كده كفاية 👍', count: 0, percent: 0 },
            ],
            ...(siteCfgRes.degraded || pollDocsRes.degraded ? { quotaDegraded: true } : {}),
          },
          200,
          publicCacheHeader(Boolean(currentUser))
        );
      }

      let userChoice: string | null = null;
      if (currentUser && idToken) {
        const voteDoc = await getDoc<{ choice?: string }>(
          cfg,
          `polls/${targetDoc.id}/votes/${currentUser.id}`,
          { idToken }
        ).catch(() => null);
        if (voteDoc?.data.choice) {
          userChoice = String(voteDoc.data.choice);
        }
      }

      return jsonResponse(
        ctx,
        {
          ...buildPollStateFromDoc(targetDoc.id, targetDoc.data, userChoice, siteCfg.pollClosed),
          ...(siteCfgRes.degraded || pollDocsRes.degraded ? { quotaDegraded: true } : {}),
        },
        200,
        publicCacheHeader(Boolean(currentUser))
      );
    }

    if (method === 'POST' && path === '/api/poll/vote') {
      if (!currentUser || !idToken) {
        return jsonResponse(
          ctx,
          { error: 'سجّل دخولك الأول عشان تصوت بصوت واحد حقيقي ومضمون.', requiresAuth: true },
          401
        );
      }
      const rlResp = await applyRateLimitOr429(ctx, 'poll_vote', `${ipHash}:${currentUser.id}`, 15, 10 * 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      const choice = typeof body.choice === 'string' ? body.choice.trim() : '';
      const requestedPollId = typeof body.pollId === 'string' ? body.pollId.trim() : '';

      const pollDocs = await listCollection<Record<string, unknown>>(
        cfg,
        'polls',
        { idToken },
        { pageSize: 50, maxDocs: 50 }
      );
      const targetDoc =
        (requestedPollId ? pollDocs.find((p) => p.id === requestedPollId) : null) ||
        pollDocs.sort(
          (a, b) => Date.parse(normalizeIsoTimestamp(b.data.createdAt)) - Date.parse(normalizeIsoTimestamp(a.data.createdAt))
        )[0];

      if (!targetDoc) return jsonResponse(ctx, { error: 'الاستفتاء غير موجود.' }, 404);
      if (targetDoc.data.isOpen === false) {
        return jsonResponse(ctx, { error: 'التصويت مغلق حالياً من الإدارة.' }, 403);
      }
      if (typeof targetDoc.data.endsAt === 'string' && targetDoc.data.endsAt && Date.parse(targetDoc.data.endsAt) <= Date.now()) {
        return jsonResponse(ctx, { error: 'انتهت مدة التصويت في هذا الاستفتاء.' }, 403);
      }

      const existingVote = await getDoc(cfg, `polls/${targetDoc.id}/votes/${currentUser.id}`, { idToken });
      if (existingVote) {
        return jsonResponse(ctx, { error: 'أنت صوّتت بالفعل في هذا الاستطلاع!' }, 409);
      }

      const rawOptions = Array.isArray(targetDoc.data.options)
        ? (targetDoc.data.options as Array<Record<string, unknown>>)
        : [];
      const optionExists = rawOptions.some((o) => o.key === choice);
      if (!optionExists) return jsonResponse(ctx, { error: 'اختيار التصويت غير صحيح.' }, 400);

      const updatedOptions = rawOptions.map((o) =>
        o.key === choice ? { ...o, count: Math.max(0, Number(o.count || 0)) + 1 } : o
      );
      const nextTotal = Math.max(0, Number(targetDoc.data.totalVotes || 0)) + 1;

      await commitWrites(
        cfg,
        [
          {
            docPath: `polls/${targetDoc.id}/votes/${currentUser.id}`,
            data: { pollId: targetDoc.id, userId: currentUser.id, choice },
            serverTimeFields: ['createdAt'],
            exists: false,
          },
          {
            docPath: `polls/${targetDoc.id}`,
            data: { options: updatedOptions, totalVotes: nextTotal },
            updateMask: ['options', 'totalVotes', 'updatedAt'],
            serverTimeFields: ['updatedAt'],
            exists: true,
          },
        ],
        { idToken }
      );
      clearPublicReadCache('polls');

      return jsonResponse(
        ctx,
        buildPollStateFromDoc(targetDoc.id, { ...targetDoc.data, options: updatedOptions, totalVotes: nextTotal }, choice)
      );
    }

    // ==================== ORDERS ====================
    if (method === 'POST' && path === '/api/orders') {
      const rlResp = await applyRateLimitOr429(ctx, 'order_create', `${ipHash}:${visitorId}`, 8, 15 * 60);
      if (rlResp) return rlResp;

      const siteCfgRes = await safePublicWithFallback(mergeSiteConfig(null, env), () => getSiteConfigCached(cfg, env));
      const siteCfg = siteCfgRes.value;

      if (!siteCfg.ordersEnabled) {
        return jsonResponse(ctx, { error: 'استقبال الطلبات متوقف مؤقتاً من الإدارة. حاول تاني بعد شوية.' }, 403);
      }

      const body = await readJsonBody(request);
      let validated;
      try {
        validated = validateOrderPayload(body);
      } catch (err) {
        return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'بيانات الطلب غير صالحة.' }, 400);
      }

      let pricing;
      try {
        pricing = calculateOrderPricing(
          { grade: validated.grade, platforms: validated.platforms, qureoSection: validated.qureoSection },
          siteCfg
        );
      } catch (err) {
        return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'خطأ في حساب السعر.' }, 400);
      }

      const sanitizedReqId = validated.clientRequestId
        ? validated.clientRequestId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
        : '';
      const orderId = sanitizedReqId ? `ord_${sanitizedReqId}` : generateId('ord');
      const kvIdemKey = sanitizedReqId ? `idem:order:${sanitizedReqId}` : null;

      if (kvIdemKey && env.RATE_LIMIT_KV) {
        const cached = await env.RATE_LIMIT_KV.get<Record<string, unknown>>(kvIdemKey, { type: 'json' }).catch(
          () => null
        );
        if (cached) {
          return jsonResponse(
            ctx,
            {
              deduplicated: true,
              savedToServer: true,
              pendingManualConfirmation: true,
              dbSaveStatus: 'saved',
              order: cached,
            },
            200
          );
        }
      }

      const encrypted = await encryptSecret(validated.platformPassword, encryptionKey);
      const orderCode = formatOrderCode(sanitizedReqId || undefined);
      const authorUid = currentUser ? currentUser.id : 'guest_order';
      const nowIso = new Date().toISOString();

      const orderDocData: Record<string, unknown> = {
        id: orderId,
        orderCode,
        authorUid,
        fullName: validated.fullName,
        grade: validated.grade,
        platformLabel: pricing.platformLabel,
        sectionDetails: pricing.sectionDetails,
        platformsJson: JSON.stringify({ platforms: validated.platforms, qureoSection: validated.qureoSection || null }),
        platformUsername: validated.platformUsername,
        encryptedPassword: encrypted.encrypted,
        passwordIv: encrypted.iv,
        passwordAuthTag: encrypted.authTag,
        credentialsPurged: false,
        oldPrice: Math.round(pricing.oldPrice),
        finalPrice: Math.round(pricing.finalPrice),
        offerApplied: pricing.offerApplied,
        paymentMethod: validated.paymentMethod,
        status: 'new',
        paymentStatus: 'pending_verification',
        subscriptionStatus: 'pending_confirmation',
        source: 'client_checkout',
        changeLog: [
          {
            at: nowIso,
            by: currentUser?.email || 'client',
            fromStatus: null,
            toStatus: 'new',
            paymentStatus: 'pending_verification',
            subscriptionStatus: 'pending_confirmation',
            note: 'طلب اشتراك جديد من نموذج الموقع',
          },
        ],
      };
      if (sanitizedReqId) orderDocData.clientRequestId = sanitizedReqId;
      if (currentUser?.serialNumber) orderDocData.userSerialNumber = currentUser.serialNumber;
      if (currentUser?.email) orderDocData.userEmail = currentUser.email;

      const receipt = {
        id: orderId,
        orderCode,
        fullName: validated.fullName,
        grade: validated.grade,
        platformLabel: pricing.platformLabel,
        sectionDetails: pricing.sectionDetails,
        oldPrice: Math.round(pricing.oldPrice),
        finalPrice: Math.round(pricing.finalPrice),
        offerApplied: pricing.offerApplied,
        paymentMethod: validated.paymentMethod,
        status: 'new' as const,
        paymentStatus: 'pending_verification' as const,
        subscriptionStatus: 'pending_confirmation' as const,
        serverRecorded: true,
        createdAt: nowIso,
      };

      try {
        await createDoc(
          cfg,
          'orders',
          orderId,
          orderDocData,
          ['createdAt', 'updatedAt'],
          idToken ? { idToken } : { apiKey: cfg.apiKey }
        );
      } catch (err) {
        if (err instanceof FirestoreHttpError && err.status === 409) {
          if (currentUser && idToken) {
            const existingOrder = await getDoc<Record<string, unknown>>(cfg, `orders/${orderId}`, { idToken }).catch(
              () => null
            );
            if (existingOrder) {
              const d = existingOrder.data;
              return jsonResponse(
                ctx,
                {
                  deduplicated: true,
                  savedToServer: true,
                  pendingManualConfirmation: true,
                  dbSaveStatus: 'saved',
                  order: {
                    id: existingOrder.id,
                    orderCode: String(d.orderCode || orderCode),
                    fullName: String(d.fullName || receipt.fullName),
                    grade: d.grade === 'bac2' ? 'bac2' : 'bac1',
                    platformLabel: String(d.platformLabel || receipt.platformLabel),
                    sectionDetails: String(d.sectionDetails || receipt.sectionDetails),
                    oldPrice: Number(d.oldPrice || receipt.oldPrice),
                    finalPrice: Number(d.finalPrice || receipt.finalPrice),
                    offerApplied: Boolean(d.offerApplied),
                    paymentMethod: String(d.paymentMethod || receipt.paymentMethod),
                    status: (d.status as 'new' | 'reviewing' | 'completed' | 'cancelled') || 'new',
                    paymentStatus: String(d.paymentStatus || 'pending_verification'),
                    subscriptionStatus: String(d.subscriptionStatus || 'pending_confirmation'),
                    serverRecorded: true,
                    createdAt: normalizeIsoTimestamp(d.createdAt),
                  },
                },
                200
              );
            }
          }
          return jsonResponse(
            ctx,
            {
              deduplicated: true,
              savedToServer: true,
              pendingManualConfirmation: true,
              dbSaveStatus: 'saved',
              order: receipt,
            },
            200
          );
        }

        const isQuota = isExplicitQuotaError(err);
        if (isQuota) {
          markQuotaExceeded(cfg);
        }
        // Decouple WhatsApp checkout conversion from Firestore availability/quota
        return jsonResponse(
          ctx,
          {
            deduplicated: false,
            savedToServer: false,
            pendingManualConfirmation: true,
            dbSaveStatus: isQuota ? 'quota_exceeded' : 'db_error',
            order: {
              ...receipt,
              serverRecorded: false,
            },
          },
          200
        );
      }

      if (kvIdemKey && env.RATE_LIMIT_KV) {
        await env.RATE_LIMIT_KV.put(kvIdemKey, JSON.stringify(receipt), { expirationTtl: 86_400 }).catch(() => {});
      }

      void recordAnalyticsEvent(cfg, {
        eventType: 'order_create',
        visitorId,
        userId: currentUser?.id || null,
        path: '/orders',
        grade: validated.grade,
      }).catch(() => {});

      return jsonResponse(
        ctx,
        {
          deduplicated: false,
          savedToServer: true,
          pendingManualConfirmation: true,
          dbSaveStatus: 'saved',
          order: receipt,
        },
        201
      );
    }

    // ==================== ADMIN AUTH & ENDPOINTS ====================
    if (method === 'GET' && path === '/api/admin/me') {
      const admin = await requireAdminContext(ctx);
      if (!admin) return jsonResponse(ctx, { authenticated: false });
      return jsonResponse(ctx, {
        authenticated: true,
        username: admin.username,
        hasFirebaseToken: admin.hasFirebaseToken,
      });
    }

    if (method === 'POST' && path === '/api/admin/login') {
      const rlResp = await applyRateLimitOr429(ctx, 'admin_login', ipHash, 10, 15 * 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!username || !password) {
        return jsonResponse(ctx, { error: 'أدخل اسم المستخدم وكلمة المرور.' }, 400);
      }

      const envAdminUser = (env.ADMIN_USERNAME || '').trim();
      const envAdminPass = env.ADMIN_PASSWORD || '';
      let matchedUsername: string | null = null;
      let fbTokens: FirebasePasswordSignInResult | null = null;

      if (envAdminUser && envAdminPass) {
        const userOk = await safeCompareStrings(username, envAdminUser);
        const passOk = await safeCompareStrings(password, envAdminPass);
        if (userOk && passOk) {
          matchedUsername = envAdminUser;
          const fbEmail = (env.ADMIN_FIREBASE_EMAIL || '').trim();
          const fbPass = env.ADMIN_FIREBASE_PASSWORD || '';
          if (fbEmail && fbPass && cfg.apiKey) {
            const signedIn = await signInFirebaseWithPassword(cfg.apiKey, fbEmail, fbPass);
            if (signedIn) {
              const verified = await verifyFirebaseIdToken(signedIn.idToken);
              if (verified && (await resolveAdminStatus(cfg, verified, signedIn.idToken))) {
                fbTokens = signedIn;
              }
            }
          }
        }
      }

      if (!matchedUsername && username.includes('@') && cfg.apiKey) {
        const signedIn = await signInFirebaseWithPassword(cfg.apiKey, username, password);
        if (signedIn) {
          const verified = await verifyFirebaseIdToken(signedIn.idToken);
          if (verified) {
            const isAdmin = await resolveAdminStatus(cfg, verified, signedIn.idToken);
            if (!isAdmin) {
              return jsonResponse(
                ctx,
                { error: 'هذا الحساب غير مصرح له بصلاحيات الإدارة (/admin).' },
                403
              );
            }
            matchedUsername = verified.email || username;
            fbTokens = signedIn;
            await ensureUserSerialAndProfile(cfg, verified, signedIn.idToken, {}).catch(() => {});
          }
        }
      }

      if (!matchedUsername) {
        if (!envAdminUser && !envAdminPass && !username.includes('@')) {
          return jsonResponse(
            ctx,
            {
              error:
                'بيانات دخول الإدارة غير مضبوطة في متغيرات الخادم (ADMIN_USERNAME / ADMIN_PASSWORD) — يمكنك الدخول بحساب Google المصرّح له أدناه.',
            },
            401
          );
        }
        return jsonResponse(ctx, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' }, 401);
      }

      const exp = Date.now() + 12 * 60 * 60 * 1000;
      const adminToken = await signToken(
        {
          role: 'admin',
          username: matchedUsername,
          ...(fbTokens?.refreshToken ? { fbRefreshToken: fbTokens.refreshToken } : {}),
          exp,
        },
        sessionSecret
      );
      setCookies.push(serializeCookie(request, 'crovo_admin_session', adminToken, 12 * 60 * 60, true));

      if (fbTokens?.idToken) {
        await logAdminAudit(cfg, fbTokens.idToken, matchedUsername, 'admin_login_password', 'session').catch(
          () => {}
        );
      }

      return jsonResponse(ctx, {
        ok: true,
        username: matchedUsername,
        hasFirebaseToken: Boolean(fbTokens?.idToken),
      });
    }

    if (method === 'POST' && path === '/api/admin/firebase-login') {
      const rlResp = await applyRateLimitOr429(ctx, 'admin_login', ipHash, 10, 15 * 60);
      if (rlResp) return rlResp;

      const body = await readJsonBody(request);
      const tokenCandidate = (typeof body.idToken === 'string' && body.idToken.trim()) || idToken || '';
      if (!tokenCandidate) {
        return jsonResponse(ctx, { error: 'رمز التحقق من Google / Firebase مطلوب.' }, 400);
      }

      const verified = await verifyFirebaseIdToken(tokenCandidate);
      if (!verified) {
        return jsonResponse(ctx, { error: 'تعذر التحقق من حساب Firebase أو انتهت الجلسة.' }, 401);
      }

      const isAdmin = isOwnerAdminUser(verified) || (await resolveAdminStatus(cfg, verified, tokenCandidate));
      if (!isAdmin) {
        return jsonResponse(
          ctx,
          { error: 'هذا الحساب غير مصرح له بصلاحيات الإدارة (/admin).' },
          403
        );
      }

      verifiedAdminRoleCache.set(verified.uid, Date.now());
      clearAuthUserCache(cfg, verified.uid);

      let userProfile: AuthUser;
      let quotaDegraded = false;
      try {
        userProfile = await ensureUserSerialAndProfile(cfg, verified, tokenCandidate, {});
      } catch (err) {
        if (!isQuotaOrTransientDbError(err)) throw err;
        quotaDegraded = true;
        userProfile = buildFallbackVerifiedUser(verified, true);
      }

      await logAdminAudit(cfg, tokenCandidate, verified.email || verified.uid, 'admin_login_firebase', 'session', null, {
        uid: verified.uid,
      }).catch(() => {});

      return jsonResponse(ctx, {
        ok: true,
        username: verified.email || verified.uid,
        user: userProfile,
        hasFirebaseToken: true,
        ...(quotaDegraded ? { quotaDegraded: true } : {}),
      });
    }

    if (method === 'POST' && path === '/api/admin/logout') {
      setCookies.push(serializeCookie(request, 'crovo_admin_session', '', 0, true));
      return jsonResponse(ctx, { ok: true });
    }

    if (path.startsWith('/api/admin/')) {
      const admin = await requireAdminContext(ctx);
      if (!admin) {
        return jsonResponse(ctx, { error: 'غير مصرح بالدخول. من فضلك سجل دخول الإدارة بحساب مصرح له.' }, 401);
      }

      const canReadWithoutFirebaseToken =
        method === 'GET' &&
        (path === '/api/admin/overview' ||
          path === '/api/admin/analytics' ||
          path === '/api/admin/users' ||
          path === '/api/admin/library' ||
          path === '/api/admin/library/export' ||
          path === '/api/admin/tool' ||
          path === '/api/admin/polls');

      if (!admin.idToken && !canReadWithoutFirebaseToken) {
        return jsonResponse(
          ctx,
          {
            error:
              'يلزم ربط جلسة Google/Firebase السحابية (أو ضبط ADMIN_FIREBASE_EMAIL و ADMIN_FIREBASE_PASSWORD) للوصول إلى البيانات المحمية وإجراء التعديلات في Firestore.',
            requiresFirebaseLink: true,
          },
          403
        );
      }

      if (method !== 'GET') {
        const rlResp = await applyRateLimitOr429(ctx, 'admin_mut', `${admin.username}:${ipHash}`, 60, 5 * 60);
        if (rlResp) return rlResp;
        clearTargetedCachesForAdminMutation(path);
      }

      const authObj = admin.idToken ? { idToken: admin.idToken } : { apiKey: cfg.apiKey };
      const publicOrAdminAuth = authObj;
      const scopeKey = dbScopeKey(cfg);

      // ---------- GET /api/admin/overview ----------
      if (method === 'GET' && path === '/api/admin/overview') {
        const overviewCacheKey = `${scopeKey}:overview:${admin.idToken ? 'auth' : 'pub'}`;
        if (!isMockedFetchActive() && url.searchParams.get('refresh') !== '1') {
          const hit = adminReadCache.get(overviewCacheKey);
          if (hit && hit.expiresAt > Date.now()) {
            return jsonResponse(ctx, hit.value);
          }
        }
        const failedCols: Array<{ col: string; status: 'quota_exceeded' | 'error'; message: string }> = [];

        const safeOp = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
          try {
            return await fn();
          } catch (err) {
            const c = classifyDbError(err);
            failedCols.push({ col: label, status: c.status, message: c.message });
            return fallback;
          }
        };

        const safeListIfAdmin = <T = Record<string, unknown>>(
          col: string,
          opts: { pageSize?: number; maxDocs?: number }
        ) =>
          admin.idToken
            ? safeOp(col, () => listCollection<T>(cfg, col, { idToken: admin.idToken! }, opts), [])
            : Promise.resolve([]);

        const [
          cfgDoc,
          orderDocs,
          commentDocs,
          reportDocs,
          pollDocs,
          questionStatDocs,
          pushDocs,
          notifLogDocs,
          userDocs,
          analyticsDocs,
          dailyDocs,
          toolRunDocs,
          toolCounterDoc,
          backupDocs,
          migrationDocs,
        ] = await Promise.all([
          safeOp('site_config', () => getDoc<Record<string, unknown>>(cfg, 'site_config/public', publicOrAdminAuth), null),
          safeListIfAdmin<Record<string, unknown>>('orders', { pageSize: 300, maxDocs: 2500 }),
          admin.idToken
            ? safeOp(
                'comments',
                () => listCollection<Record<string, unknown>>(cfg, 'comments', { idToken: admin.idToken! }, { pageSize: 300, maxDocs: 2500 }),
                []
              )
            : safeOp(
                'comments',
                () =>
                  runQuery<Record<string, unknown>>(
                    cfg,
                    'comments',
                    { filters: [{ fieldPath: 'status', op: 'EQUAL', value: 'approved' }], limit: 200 },
                    { apiKey: cfg.apiKey }
                  ),
                []
              ),
          safeListIfAdmin<Record<string, unknown>>('question_reports', { pageSize: 300, maxDocs: 500 }),
          safeOp('polls', () => listCollection<Record<string, unknown>>(cfg, 'polls', publicOrAdminAuth, { pageSize: 50, maxDocs: 50 }), []),
          safeOp('question_stats', () => listCollection<Record<string, unknown>>(cfg, 'question_stats', publicOrAdminAuth, { pageSize: 300, maxDocs: 800 }), []),
          safeListIfAdmin<Record<string, unknown>>('push_subscriptions', { pageSize: 300, maxDocs: 2500 }),
          safeListIfAdmin<Record<string, unknown>>('notification_logs', { pageSize: 100, maxDocs: 100 }),
          safeListIfAdmin<Record<string, unknown>>('users', { pageSize: 300, maxDocs: 2500 }),
          safeListIfAdmin<Record<string, unknown>>('analytics_events', { pageSize: 300, maxDocs: 800 }),
          safeListIfAdmin<Record<string, unknown>>('analytics_daily', { pageSize: 300, maxDocs: 500 }),
          Promise.resolve([] as Array<{ id: string; data: Record<string, unknown> }>),
          safeOp('counters', () => getDoc<{ count?: number }>(cfg, 'counters/tool', publicOrAdminAuth), null),
          safeListIfAdmin<Record<string, unknown>>('system_backups', { pageSize: 40, maxDocs: 40 }),
          safeListIfAdmin<Record<string, unknown>>('system_migrations', { pageSize: 20, maxDocs: 20 }),
        ]);

        const hasQuotaFailure = failedCols.some((f) => f.status === 'quota_exceeded');
        const dbStatus: DbStatusState =
          failedCols.length > 0
            ? hasQuotaFailure
              ? 'quota_exceeded'
              : 'error'
            : !admin.idToken
              ? 'auth_required'
              : 'ok';

        const dbError =
          failedCols.length > 0
            ? hasQuotaFailure
              ? 'تم بلوغ الحد اليومي لقراءة Firestore (Spark Quota Exceeded). يتم عرض آخر حالة محفوظة دون مسح أو تعديل أي بيانات.'
              : `تعذر قراءة بعض مجموعات Firestore (${failedCols.map((f) => f.col).join(', ')}): ${failedCols[0].message}`
            : !admin.idToken
              ? 'يلزم ربط جلسة Google/Firebase السحابية لعرض البيانات المحمية (المشتركين، الطلبات، النسخ الاحتياطية).'
              : null;

        // If DB read failed and we have a verified last-known-good server snapshot, preserve and serve it safely
        const cachedSnapshot = !isMockedFetchActive() ? lastKnownAdminOverviewMap.get(scopeKey) : undefined;
        if (failedCols.length > 0 && cachedSnapshot) {
          const prevStats = (cachedSnapshot.stats || {}) as Record<string, unknown>;
          return jsonResponse(ctx, {
            ...cachedSnapshot,
            dbStatus,
            dbError,
            staleSnapshot: true,
            stats: {
              ...prevStats,
              dbIntegrity: {
                ok: false,
                detail: dbError || 'Database read error — serving last known good state',
              },
            },
          });
        }

        const siteCfg = mergeSiteConfig(cfgDoc?.data || null, env);

        const decryptedOrders = await Promise.all(
          orderDocs.map(async (d) => {
            const o = d.data;
            let plainPassword: string | null = null;
            if (!o.credentialsPurged && typeof o.encryptedPassword === 'string' && typeof o.passwordIv === 'string' && typeof o.passwordAuthTag === 'string') {
              try {
                plainPassword = await decryptSecret(
                  {
                    encrypted: o.encryptedPassword,
                    iv: o.passwordIv,
                    authTag: o.passwordAuthTag,
                  },
                  encryptionKey
                );
              } catch {
                plainPassword = '[تعذر فك التشفير]';
              }
            }
            return {
              id: d.id,
              orderCode: String(o.orderCode || ''),
              userId: o.authorUid && o.authorUid !== 'guest_order' ? String(o.authorUid) : null,
              userSerialNumber: typeof o.userSerialNumber === 'string' ? o.userSerialNumber : null,
              userEmail: typeof o.userEmail === 'string' ? o.userEmail : null,
              fullName: String(o.fullName || ''),
              grade: (o.grade === 'bac2' ? 'bac2' : 'bac1') as 'bac1' | 'bac2',
              platformLabel: String(o.platformLabel || ''),
              sectionDetails: String(o.sectionDetails || ''),
              platformUsername: String(o.platformUsername || ''),
              platformPassword: plainPassword,
              credentialsPurged: Boolean(o.credentialsPurged),
              oldPrice: Number(o.oldPrice || 0),
              finalPrice: Number(o.finalPrice || 0),
              offerApplied: Boolean(o.offerApplied),
              paymentMethod: String(o.paymentMethod || ''),
              status: (o.status as 'new' | 'reviewing' | 'completed' | 'cancelled') || 'new',
              paymentStatus: (o.paymentStatus as string) || (o.status === 'completed' ? 'paid' : 'pending_verification'),
              subscriptionStatus: (o.subscriptionStatus as string) || (o.status === 'completed' ? 'active' : 'pending_confirmation'),
              source: typeof o.source === 'string' ? o.source : 'client_checkout',
              adminNote: typeof o.adminNote === 'string' ? o.adminNote : null,
              changeLog: Array.isArray(o.changeLog) ? o.changeLog : [],
              createdAt: normalizeIsoTimestamp(o.createdAt),
              updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
            };
          })
        );
        decryptedOrders.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        const comments = commentDocs
          .map((d) => {
            const c = d.data;
            const beforeUrl = typeof c.attachmentBeforeDataUrl === 'string' ? c.attachmentBeforeDataUrl : null;
            const afterUrl = typeof c.attachmentAfterDataUrl === 'string' ? c.attachmentAfterDataUrl : null;
            return {
              id: d.id,
              authorName: String(c.authorName || ''),
              grade: String(c.grade || ''),
              rating: Number(c.rating || 5),
              content: String(c.content || ''),
              avatarUrl: typeof c.avatarDataUrl === 'string' ? c.avatarDataUrl : null,
              attachmentUrl: beforeUrl,
              attachmentBeforeUrl: beforeUrl,
              attachmentAfterUrl: afterUrl,
              contactPhone: null,
              showContactPublicly: false,
              isVerified: Boolean(c.isVerified),
              status: (c.status as 'approved' | 'pending' | 'hidden' | 'flagged') || 'approved',
              orderCode: typeof c.orderCode === 'string' ? c.orderCode : null,
              source: typeof c.source === 'string' ? c.source : 'standard',
              likesCount: Math.max(0, Number(c.likesCount || 0)),
              reportsCount: Math.max(0, Number(c.reportsCount || 0)),
              reports: [] as Array<{ reason: string; createdAt: string }>,
              createdAt: normalizeIsoTimestamp(c.createdAt),
            };
          })
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        const questionReports = reportDocs
          .map((d) => {
            const r = d.data;
            return {
              id: d.id,
              questionKey: String(r.questionKey || ''),
              grade: (r.grade === 'bac2' ? 'bac2' : 'bac1') as 'bac1' | 'bac2',
              section: (r.section === 'py' || r.section === 'fin' ? String(r.section) : 'js') as 'js' | 'py' | 'fin',
              chapterNum: Number(r.chapterNum || 1),
              qIndex: Number(r.qIndex || 0),
              questionTitle: String(r.questionTitle || ''),
              description: String(r.description || ''),
              reason: typeof r.reason === 'string' ? r.reason : null,
              suggestedSolution: typeof r.suggestedSolution === 'string' ? r.suggestedSolution : null,
              status: (r.status as 'pending' | 'reviewed' | 'resolved' | 'dismissed') || 'pending',
              adminNote: typeof r.adminNote === 'string' ? r.adminNote : null,
              createdAt: normalizeIsoTimestamp(r.createdAt),
              updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
            };
          })
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        const latestPollDoc = pollDocs.sort(
          (a, b) => Date.parse(normalizeIsoTimestamp(b.data.createdAt)) - Date.parse(normalizeIsoTimestamp(a.data.createdAt))
        )[0];

        const pollState = latestPollDoc
          ? buildPollStateFromDoc(latestPollDoc.id, latestPollDoc.data, null, siteCfg.pollClosed)
          : buildPollStateFromDoc(
              'poll_extend_offer',
              {
                question: 'إيه رأيكم نمد عرض الـ50%؟',
                options: [
                  { key: 'extend', label: 'أيوة، مدهولنا شوية كمان 🙏', count: 0 },
                  { key: 'enough', label: 'لا، كده كفاية 👍', count: 0 },
                ],
                totalVotes: 0,
                isOpen: true,
              },
              null,
              siteCfg.pollClosed
            );

        const totalCopies = questionStatDocs.reduce((sum, s) => sum + Math.max(0, Number(s.data.copyCount || 0)), 0);
        const topQuestions = questionStatDocs
          .filter((s) => Number(s.data.copyCount || 0) > 0)
          .map((s) => ({
            questionKey: s.id,
            grade: String(s.data.grade || 'bac1'),
            section: String(s.data.section || 'js'),
            chapterNum: Number(s.data.chapterNum || 1),
            qIndex: Number(s.data.qIndex || 0),
            questionTitle: String(s.data.questionTitle || ''),
            copyCount: Number(s.data.copyCount || 0),
            lastCopiedAt: normalizeIsoTimestamp(s.data.updatedAt),
          }))
          .sort((a, b) => b.copyCount - a.copyCount)
          .slice(0, 6);

        const pushActiveCount = pushDocs.filter((p) => p.data.enabled === true).length;
        const toolLikesCount = Math.max(0, Number(toolCounterDoc?.data.count || 0));

        const analytics = computeDashboardAnalytics({
          range: '7d',
          trackingStartedAt: siteCfg.trackingStartedAt,
          events: analyticsDocs,
          dailyDocs,
          users: userDocs,
          orders: orderDocs,
          questionStats: questionStatDocs,
          toolRuns: toolRunDocs,
          comments: commentDocs,
          polls: pollDocs,
          toolLikesCount,
        });

        const notificationLogs = notifLogDocs
          .map((l) => ({
            id: l.id,
            messageId: String(l.data.messageId || ''),
            category: String(l.data.category || 'update'),
            title: String(l.data.title || ''),
            body: String(l.data.body || ''),
            sentCount: Number(l.data.sentCount || 0),
            failedCount: Number(l.data.failedCount || 0),
            triggerType: String(l.data.triggerType || 'manual'),
            errorDetail: typeof l.data.errorDetail === 'string' ? l.data.errorDetail : null,
            createdAt: normalizeIsoTimestamp(l.data.createdAt),
          }))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        const persistedBackups = backupDocs
          .map((b) => {
            const summaryStr = typeof b.data.summaryJson === 'string' ? b.data.summaryJson : '';
            const createdAt = normalizeIsoTimestamp(b.data.createdAt || b.createTime);
            return {
              filename: `${b.id} (${String(b.data.reason || 'snapshot')})`,
              reason: String(b.data.reason || 'snapshot'),
              actor: String(b.data.actor || 'admin'),
              sizeBytes: new TextEncoder().encode(summaryStr).byteLength,
              createdAt,
            };
          })
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        const migrations = migrationDocs
          .map((m) => ({
            id: m.id,
            version: String(m.data.version || m.id),
            status: String(m.data.status || 'applied'),
            actor: String(m.data.actor || 'admin'),
            appliedAt: normalizeIsoTimestamp(m.data.appliedAt || m.updateTime),
          }))
          .sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt));

        const payload = {
          dbStatus,
          dbError,
          staleSnapshot: false,
          orders: decryptedOrders,
          comments,
          questionReports,
          poll: pollState,
          likes: [{ itemKey: 'tool', count: toolLikesCount }],
          config: buildPublicConfigResponse(siteCfg),
          analytics,
          stats: {
            totalCopies,
            topQuestions,
            pendingQuestionReports: questionReports.filter((r) => r.status === 'pending').length,
            pushActiveCount,
            pushTotalCount: pushDocs.length,
            dbIntegrity: {
              ok: failedCols.length === 0 && Boolean(admin.idToken),
              detail:
                failedCols.length > 0
                  ? dbError || 'Database Error'
                  : !admin.idToken
                    ? 'يلزم ربط جلسة Google/Firebase السحابية'
                    : `Firebase Cloud Firestore (${cfg.databaseId}) · ${userDocs.length} حساب · ${orderDocs.length} طلب · ${commentDocs.length} تقييم`,
              counts: {
                users: userDocs.length,
                orders: orderDocs.length,
                comments: commentDocs.length,
                polls: pollDocs.length,
                questionStats: questionStatDocs.length,
                backups: persistedBackups.length,
              },
            },
            backups: persistedBackups,
            migrations,
            isEphemeralStorageNotice:
              'قاعدة البيانات الموحدة هي Firebase Cloud Firestore السحابية — جميع البيانات محمية بنسخ تلقائية قبل التعديل وفحص تكامل.',
            requiresFirebaseLink: !admin.idToken,
          },
          notifications: {
            enabled: siteCfg.notificationsEnabled,
            intervalDays: siteCfg.notificationsIntervalDays,
            templates: NOTIFICATION_TEMPLATES,
            logs: notificationLogs,
          },
        };

        if (dbStatus === 'ok' && !isMockedFetchActive()) {
          clearQuotaCooldown(cfg);
          lastKnownAdminOverviewMap.set(scopeKey, payload);
          const overviewCacheKey = `${scopeKey}:overview:${admin.idToken ? 'auth' : 'pub'}`;
          adminReadCache.set(overviewCacheKey, {
            value: payload,
            expiresAt: Date.now() + ADMIN_READ_CACHE_TTL_MS,
          });
          adminReadCache.set(`${scopeKey}:analytics:7d::`, {
            value: {
              ...analytics,
              dbStatus: 'ok' as DbStatusState,
              dbError: null,
              staleSnapshot: false,
            },
            expiresAt: Date.now() + ADMIN_READ_CACHE_TTL_MS,
          });

          // Warm shared public RAM caches from verified admin read so public site visitors get instant, synced data
          if (cfgDoc?.data) {
            warmPublicReadCache(cfg, 'site_config', cfgDoc.data);
          }
          warmPublicReadCache(cfg, 'tool_counter', toolLikesCount);
          if (pollDocs.length > 0) {
            warmPublicReadCache(cfg, 'polls', pollDocs);
          }
          const approvedForPublic = commentDocs
            .filter((d) => !d.data.status || d.data.status === 'approved')
            .slice(0, 200);
          if (approvedForPublic.length > 0) {
            warmPublicReadCache(cfg, 'comments_approved', approvedForPublic);
          }
        }

        return jsonResponse(ctx, payload);
      }

      // ---------- GET /api/admin/analytics ----------
      if (method === 'GET' && path === '/api/admin/analytics') {
        const range = url.searchParams.get('range') || '7d';
        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const analyticsCacheKey = `${scopeKey}:${range}:${fromParam || ''}:${toParam || ''}`;
        const adminAnalyticsMemKey = `${scopeKey}:analytics:${range}:${fromParam || ''}:${toParam || ''}`;

        if (admin.idToken && !isMockedFetchActive() && url.searchParams.get('refresh') !== '1') {
          const hit = adminReadCache.get(adminAnalyticsMemKey);
          if (hit && hit.expiresAt > Date.now()) {
            return jsonResponse(ctx, hit.value);
          }
        }

        if (!admin.idToken) {
          return jsonResponse(ctx, {
            ...computeDashboardAnalytics({
              range,
              fromParam,
              toParam,
              trackingStartedAt: '2026-01-01T00:00:00.000Z',
              events: [],
              dailyDocs: [],
              users: [],
              orders: [],
              questionStats: [],
              toolRuns: [],
              comments: [],
              polls: [],
              toolLikesCount: 0,
            }),
            dbStatus: 'auth_required',
            dbError: 'يلزم ربط جلسة Google/Firebase السحابية لعرض إحصائيات المستخدمين والزيارات الكاملة.',
            staleSnapshot: false,
            requiresFirebaseLink: true,
          });
        }

        const failedCols: Array<{ col: string; status: 'quota_exceeded' | 'error'; message: string }> = [];
        const safeOp = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
          try {
            return await fn();
          } catch (err) {
            const c = classifyDbError(err);
            failedCols.push({ col: label, status: c.status, message: c.message });
            return fallback;
          }
        };

        const [cfgDoc, eventDocs, dailyDocs, userDocs, orderDocs, qsDocs, trDocs, cmtDocs, pollDocs, toolCounterDoc] =
          await Promise.all([
            safeOp('site_config', () => getDoc<Record<string, unknown>>(cfg, 'site_config/public', authObj), null),
            safeOp('analytics_events', () => listCollection<Record<string, unknown>>(cfg, 'analytics_events', { idToken: admin.idToken! }, { pageSize: 300, maxDocs: 800 }), []),
            safeOp('analytics_daily', () => listCollection<Record<string, unknown>>(cfg, 'analytics_daily', { idToken: admin.idToken! }, { pageSize: 300, maxDocs: 500 }), []),
            safeOp('users', () => listCollection<Record<string, unknown>>(cfg, 'users', { idToken: admin.idToken! }, { pageSize: 300, maxDocs: 2500 }), []),
            safeOp('orders', () => listCollection<Record<string, unknown>>(cfg, 'orders', { idToken: admin.idToken! }, { pageSize: 300, maxDocs: 2500 }), []),
            safeOp('question_stats', () => listCollection<Record<string, unknown>>(cfg, 'question_stats', authObj, { pageSize: 300, maxDocs: 800 }), []),
            Promise.resolve([] as Array<{ id: string; data: Record<string, unknown> }>),
            safeOp('comments', () => listCollection<Record<string, unknown>>(cfg, 'comments', { idToken: admin.idToken! }, { pageSize: 300, maxDocs: 2500 }), []),
            safeOp('polls', () => listCollection<Record<string, unknown>>(cfg, 'polls', authObj, { pageSize: 50, maxDocs: 50 }), []),
            safeOp('counters', () => getDoc<{ count?: number }>(cfg, 'counters/tool', authObj), null),
          ]);

        if (failedCols.length > 0) {
          const hasQuota = failedCols.some((f) => f.status === 'quota_exceeded');
          const dbStatus: DbStatusState = hasQuota ? 'quota_exceeded' : 'error';
          const dbError = hasQuota
            ? 'تم بلوغ الحد اليومي لقراءة Firestore مؤقتاً. يتم الحفاظ على آخر إحصائيات محفوظة دون أي مسح للبيانات.'
            : `تعذر تحديث الإحصائيات: ${failedCols[0].message}`;
          const prev = !isMockedFetchActive() ? lastKnownAdminAnalyticsMap.get(analyticsCacheKey) : undefined;
          if (prev) {
            return jsonResponse(ctx, { ...prev, dbStatus, dbError, staleSnapshot: true });
          }
          const siteCfg = mergeSiteConfig(cfgDoc?.data || null, env);
          return jsonResponse(ctx, {
            ...computeDashboardAnalytics({
              range,
              fromParam,
              toParam,
              trackingStartedAt: siteCfg.trackingStartedAt,
              events: eventDocs,
              dailyDocs,
              users: userDocs,
              orders: orderDocs,
              questionStats: qsDocs,
              toolRuns: trDocs,
              comments: cmtDocs,
              polls: pollDocs,
              toolLikesCount: Math.max(0, Number(toolCounterDoc?.data.count || 0)),
            }),
            dbStatus,
            dbError,
            staleSnapshot: false,
          });
        }

        const siteCfg = mergeSiteConfig(cfgDoc?.data || null, env);
        const analyticsPayload = {
          ...computeDashboardAnalytics({
            range,
            fromParam,
            toParam,
            trackingStartedAt: siteCfg.trackingStartedAt,
            events: eventDocs,
            dailyDocs,
            users: userDocs,
            orders: orderDocs,
            questionStats: qsDocs,
            toolRuns: trDocs,
            comments: cmtDocs,
            polls: pollDocs,
            toolLikesCount: Math.max(0, Number(toolCounterDoc?.data.count || 0)),
          }),
          dbStatus: 'ok' as DbStatusState,
          dbError: null,
          staleSnapshot: false,
        };
        if (!isMockedFetchActive()) {
          lastKnownAdminAnalyticsMap.set(analyticsCacheKey, analyticsPayload);
          adminReadCache.set(adminAnalyticsMemKey, {
            value: analyticsPayload,
            expiresAt: Date.now() + ADMIN_READ_CACHE_TTL_MS,
          });
        }
        return jsonResponse(ctx, analyticsPayload);
      }

      // ---------- ADMIN USERS ----------
      if (method === 'GET' && path === '/api/admin/users') {
        if (!admin.idToken) {
          return jsonResponse(ctx, {
            users: [],
            counts: { total: 0, bac1: 0, bac2: 0, unclassified: 0 },
            dbStatus: 'auth_required' as DbStatusState,
            dbError: 'يلزم ربط جلسة Google/Firebase السحابية لعرض حسابات الطلاب.',
            staleSnapshot: false,
            requiresFirebaseLink: true,
          });
        }

        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        const roleFilter = (url.searchParams.get('role') || '').trim();
        const statusFilter = (url.searchParams.get('status') || '').trim();
        const gradeFilter = (url.searchParams.get('grade') || '').trim();
        const sortOrder = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
        const includeAll = url.searchParams.get('all') === '1';
        const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize')) || 25));
        const requestedPage = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const usersCacheKey = `${scopeKey}:users:${q}:${roleFilter}:${statusFilter}:${gradeFilter}:${sortOrder}:${includeAll ? 'all' : `${requestedPage}:${pageSize}`}`;

        if (!isMockedFetchActive() && url.searchParams.get('refresh') !== '1') {
          const hit = adminReadCache.get(usersCacheKey);
          if (hit && hit.expiresAt > Date.now()) {
            return jsonResponse(ctx, hit.value);
          }
        }

        try {
          const [userDocs, commentDocs, orderDocs] = await Promise.all([
            listCollection<Record<string, unknown>>(cfg, 'users', authObj, { pageSize: 300, maxDocs: 2500 }),
            listCollection<Record<string, unknown>>(cfg, 'comments', authObj, { pageSize: 300, maxDocs: 2500 }),
            listCollection<Record<string, unknown>>(cfg, 'orders', authObj, { pageSize: 300, maxDocs: 2500 }),
          ]);

          const reviewCountMap = new Map<string, number>();
          for (const c of commentDocs) {
            const uid = String(c.data.authorUid || '');
            reviewCountMap.set(uid, (reviewCountMap.get(uid) || 0) + 1);
          }
          const completedOrderMap = new Map<string, number>();
          for (const o of orderDocs) {
            if (o.data.status === 'completed' && typeof o.data.authorUid === 'string') {
              completedOrderMap.set(o.data.authorUid, (completedOrderMap.get(o.data.authorUid) || 0) + 1);
            }
          }

          const allMapped = userDocs.map((d) => {
            const u = d.data;
            const normalizedGrade = normalizeAdminGrade(u.grade);
            return {
              id: d.id,
              serialNumber: typeof u.serialNumber === 'string' ? u.serialNumber : null,
              name: String(u.name || ''),
              email: String(u.email || ''),
              grade: normalizedGrade,
              rawGrade: u.grade != null ? String(u.grade) : null,
              role: (u.role === 'admin' ? 'admin' : 'user') as 'user' | 'admin',
              status: (u.status === 'suspended' ? 'suspended' : 'active') as 'active' | 'suspended',
              suspendReason: typeof u.suspendReason === 'string' ? u.suspendReason : null,
              lastActiveAt: typeof u.updatedAt === 'string' ? u.updatedAt : null,
              createdAt: normalizeIsoTimestamp(u.createdAt),
              reviewsCount: reviewCountMap.get(d.id) || 0,
              votesCount: 0,
              completedOrdersCount: completedOrderMap.get(d.id) || 0,
            };
          });

          const counts = {
            total: allMapped.length,
            bac1: allMapped.filter((u) => u.grade === 'bac1').length,
            bac2: allMapped.filter((u) => u.grade === 'bac2').length,
            unclassified: allMapped.filter((u) => u.grade === 'unclassified').length,
          };

          const filteredUsers = allMapped
            .filter((u) => {
              if (roleFilter && u.role !== roleFilter) return false;
              if (statusFilter && u.status !== statusFilter) return false;
              if (gradeFilter && u.grade !== gradeFilter) return false;
              if (q) {
                return (
                  u.name.toLowerCase().includes(q) ||
                  u.email.toLowerCase().includes(q) ||
                  (u.serialNumber || '').toLowerCase().includes(q)
                );
              }
              return true;
            })
            .sort((a, b) =>
              sortOrder === 'oldest'
                ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
                : Date.parse(b.createdAt) - Date.parse(a.createdAt)
            );

          const totalMatching = filteredUsers.length;
          const totalPages = includeAll ? 1 : Math.max(1, Math.ceil(totalMatching / pageSize));
          const safePage = includeAll ? 1 : Math.min(requestedPage, totalPages);
          const users = includeAll
            ? filteredUsers
            : filteredUsers.slice((safePage - 1) * pageSize, safePage * pageSize);

          const fullUnfiltered = !q && !roleFilter && !statusFilter && !gradeFilter;
          const resultPayload = {
            users,
            page: safePage,
            pageSize: includeAll ? totalMatching : pageSize,
            totalMatching,
            totalPages,
            counts,
            dbStatus: 'ok' as DbStatusState,
            dbError: null,
            staleSnapshot: false,
          };

          if (fullUnfiltered && !isMockedFetchActive()) {
            lastKnownAdminUsersMap.set(scopeKey, resultPayload);
          }
          if (!isMockedFetchActive()) {
            adminReadCache.set(usersCacheKey, {
              value: resultPayload,
              expiresAt: Date.now() + ADMIN_READ_CACHE_TTL_MS,
            });
          }

          return jsonResponse(ctx, resultPayload);
        } catch (err) {
          const classified = classifyDbError(err);
          const dbError =
            classified.status === 'quota_exceeded'
              ? 'تم استهلاك حصة القراءة اليومية في Firestore. تم الاحتفاظ بآخر قائمة مستخدمين معروفة دون حذف أو تعديل.'
              : `تعذر تحميل حسابات الطلاب: ${classified.message}`;
          const prev = !isMockedFetchActive() ? lastKnownAdminUsersMap.get(scopeKey) : undefined;
          if (prev) {
            return jsonResponse(ctx, {
              ...prev,
              dbStatus: classified.status,
              dbError,
              staleSnapshot: true,
            });
          }
          return jsonResponse(ctx, {
            users: [],
            page: 1,
            pageSize,
            totalMatching: 0,
            totalPages: 1,
            counts: { total: 0, bac1: 0, bac2: 0, unclassified: 0 },
            dbStatus: classified.status,
            dbError,
            staleSnapshot: false,
          });
        }
      }

      const userMatch = path.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)$/);
      if (userMatch && method === 'PATCH') {
        const targetUid = userMatch[1];
        const targetDoc = await getDoc<Record<string, unknown>>(cfg, `users/${targetUid}`, authObj);
        if (!targetDoc) return jsonResponse(ctx, { error: 'المستخدم غير موجود.' }, 404);

        const body = await readJsonBody(request);
        const updates: Record<string, unknown> = {};
        const updateMask: string[] = ['updatedAt'];

        if (body.role === 'admin' || body.role === 'user') {
          updates.role = body.role;
          updateMask.push('role');
        }
        if (body.status === 'active' || body.status === 'suspended') {
          updates.status = body.status;
          updateMask.push('status');
        }
        if (body.grade === 'bac1' || body.grade === 'bac2') {
          updates.grade = body.grade;
          updateMask.push('grade');
        }
        if (typeof body.suspendReason === 'string' && body.suspendReason.trim()) {
          updates.suspendReason = body.suspendReason.trim().slice(0, 240);
          updateMask.push('suspendReason');
        }

        // Prevent self-escalation / self-demotion / self-suspension
        if (targetUid === ctx.fbUser?.uid && (updates.role !== undefined || updates.status !== undefined)) {
          return jsonResponse(ctx, { error: 'لا يمكنك تعديل صلاحياتك أو حالة حسابك بنفسك.' }, 403);
        }

        // Protect primary owner admin account from demotion or suspension
        const targetEmailLower = String(targetDoc.data.email || '').trim().toLowerCase();
        if (targetEmailLower === OWNER_ADMIN_EMAIL && (updates.role === 'user' || updates.status === 'suspended')) {
          return jsonResponse(ctx, { error: 'لا يمكن تخفيض صلاحيات أو إيقاف حساب المالك الرئيسي للنظام.' }, 403);
        }

        await patchDoc(cfg, `users/${targetUid}`, updates, updateMask, ['updatedAt'], authObj, true);

        if (updates.role === 'admin') {
          await setDoc(
            cfg,
            `admins/${targetUid}`,
            {
              uid: targetUid,
              email: String(targetDoc.data.email || targetUid),
            },
            ['createdAt'],
            authObj
          ).catch(() => {});
        } else if (updates.role === 'user' && targetUid !== ctx.fbUser?.uid) {
          await deleteDoc(cfg, `admins/${targetUid}`, authObj).catch(() => {});
          verifiedAdminRoleCache.delete(targetUid);
        }

        clearAuthUserCache(cfg, targetUid);
        adminReadCache.clear();
        await logAdminAudit(cfg, admin.idToken, admin.username, 'update_user', 'user', targetUid, body);
        return jsonResponse(ctx, { ok: true, user: { id: targetUid, ...updates } });
      }

      const userActMatch = path.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)\/activity$/);
      if (userActMatch && method === 'GET') {
        const targetUid = userActMatch[1];
        const targetDoc = await getDoc<Record<string, unknown>>(cfg, `users/${targetUid}`, authObj);
        if (!targetDoc) return jsonResponse(ctx, { error: 'المستخدم غير موجود.' }, 404);

        const [actDocs, commentDocs, orderDocs, pollDocs] = await Promise.all([
          listCollection<Record<string, unknown>>(cfg, `users/${targetUid}/activities`, authObj, { pageSize: 100, maxDocs: 200 }),
          listCollection<Record<string, unknown>>(cfg, 'comments', authObj, { pageSize: 200, maxDocs: 500 }),
          listCollection<Record<string, unknown>>(cfg, 'orders', authObj, { pageSize: 200, maxDocs: 500 }),
          listCollection<Record<string, unknown>>(cfg, 'polls', authObj, { pageSize: 30, maxDocs: 30 }),
        ]);

        const reviews = commentDocs
          .filter((c) => c.data.authorUid === targetUid)
          .map((c) => ({
            id: c.id,
            content: String(c.data.content || ''),
            rating: Number(c.data.rating || 5),
            status: String(c.data.status || 'approved'),
            createdAt: normalizeIsoTimestamp(c.data.createdAt),
          }));

        const orders = orderDocs
          .filter((o) => o.data.authorUid === targetUid)
          .map((o) => ({
            id: o.id,
            orderCode: String(o.data.orderCode || ''),
            platformLabel: String(o.data.platformLabel || ''),
            finalPrice: Number(o.data.finalPrice || 0),
            status: String(o.data.status || 'new'),
            createdAt: normalizeIsoTimestamp(o.data.createdAt),
          }));

        const votes: Array<{ pollId: string; question: string; optionKey: string; createdAt: string }> = [];
        for (const p of pollDocs) {
          const voteDoc = await getDoc<Record<string, unknown>>(cfg, `polls/${p.id}/votes/${targetUid}`, authObj).catch(
            () => null
          );
          if (voteDoc) {
            votes.push({
              pollId: p.id,
              question: String(p.data.question || ''),
              optionKey: String(voteDoc.data.choice || ''),
              createdAt: normalizeIsoTimestamp(voteDoc.data.createdAt),
            });
          }
        }

        const activities = actDocs
          .map((a) => ({
            id: a.id,
            eventType: String(a.data.eventType || 'activity'),
            path: typeof a.data.path === 'string' ? a.data.path : null,
            grade: null,
            section: null,
            chapterNum: null,
            query: typeof a.data.label === 'string' ? a.data.label : null,
            resultsCount: null,
            metaJson: typeof a.data.detail === 'string' && a.data.detail ? JSON.stringify({ detail: a.data.detail }) : null,
            createdAt: normalizeIsoTimestamp(a.data.createdAt),
          }))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        return jsonResponse(ctx, {
          user: {
            id: targetDoc.id,
            serialNumber: typeof targetDoc.data.serialNumber === 'string' ? targetDoc.data.serialNumber : null,
            name: String(targetDoc.data.name || ''),
            email: String(targetDoc.data.email || ''),
            grade: normalizeAdminGrade(targetDoc.data.grade),
            rawGrade: targetDoc.data.grade != null ? String(targetDoc.data.grade) : null,
            role: (targetDoc.data.role === 'admin' ? 'admin' : 'user') as 'user' | 'admin',
            status: (targetDoc.data.status === 'suspended' ? 'suspended' : 'active') as 'active' | 'suspended',
            suspendReason: typeof targetDoc.data.suspendReason === 'string' ? targetDoc.data.suspendReason : null,
            lastActiveAt: typeof targetDoc.data.updatedAt === 'string' ? targetDoc.data.updatedAt : null,
            createdAt: normalizeIsoTimestamp(targetDoc.data.createdAt),
            reviewsCount: reviews.length,
            votesCount: votes.length,
            completedOrdersCount: orders.filter((o) => o.status === 'completed').length,
          },
          reviews,
          votes,
          orders,
          toolRuns: [],
          activities,
        });
      }

      // ---------- ADMIN LIBRARY CMS ----------
      if (method === 'GET' && path === '/api/admin/library') {
        const gradeFilter = url.searchParams.get('grade') as 'bac1' | 'bac2' | '' | null;
        const sectionFilter = url.searchParams.get('section') as 'js' | 'py' | 'fin' | '' | null;
        const searchQ = (url.searchParams.get('q') || '').trim().toLowerCase();
        const onlyIncomplete = url.searchParams.get('incomplete') === '1';

        const allCombos: Array<{ grade: 'bac1' | 'bac2'; section: 'js' | 'py' | 'fin' }> = [
          { grade: 'bac1', section: 'js' },
          { grade: 'bac2', section: 'js' },
          { grade: 'bac2', section: 'py' },
          { grade: 'bac2', section: 'fin' },
        ];
        const combos = allCombos.filter(
          (c) => (!gradeFilter || c.grade === gradeFilter) && (!sectionFilter || c.section === sectionFilter)
        );

        const sectionsLoaded = await Promise.all(
          combos.map(async (c) => ({
            ...c,
            chapters: await loadMergedLibrarySection(cfg, c.grade, c.section),
          }))
        );

        const chaptersOut: Array<Record<string, unknown>> = [];
        const questionsOut: Array<Record<string, unknown>> = [];

        for (const sec of sectionsLoaded) {
          for (const ch of sec.chapters) {
            const chapterId = `ch_${sec.grade}_${sec.section}_${ch.num}`;
            chaptersOut.push({
              id: chapterId,
              grade: sec.grade,
              section: sec.section,
              chapterNum: ch.num,
              title: ch.title,
              sortOrder: ch.num,
              updatedAt: new Date().toISOString(),
              updatedBy: null,
            });
            for (const q of ch.qs) {
              const isIncomplete = !q.a.trim() || q.a.trim() === '-' || q.a.trim().length < 2;
              if (onlyIncomplete && !isIncomplete) continue;
              if (searchQ && !q.q.toLowerCase().includes(searchQ) && !q.a.toLowerCase().includes(searchQ)) {
                continue;
              }
              questionsOut.push({
                id: q.id || `lib_${sec.grade}_${sec.section}_${ch.num}_${q.qIndex ?? 0}`,
                chapterId,
                grade: sec.grade,
                section: sec.section,
                chapterNum: ch.num,
                qIndex: q.qIndex ?? 0,
                qText: q.q,
                aText: q.a,
                isCode: q.code,
                isIncomplete,
                updatedAt: new Date().toISOString(),
                updatedBy: null,
              });
            }
          }
        }

        return jsonResponse(ctx, {
          chapters: chaptersOut,
          questions: questionsOut.slice(0, 400),
          totalMatching: questionsOut.length,
        });
      }

      if (method === 'POST' && path === '/api/admin/library/questions') {
        const body = await readJsonBody(request);
        const grade: 'bac1' | 'bac2' = body.grade === 'bac2' ? 'bac2' : 'bac1';
        const section: 'js' | 'py' | 'fin' = body.section === 'py' || body.section === 'fin' ? body.section : 'js';
        const chapterNum = Math.max(1, Math.min(200, Math.round(Number(body.chapterNum) || 1)));
        const qText = typeof body.qText === 'string' ? body.qText.trim() : '';
        const aText = typeof body.aText === 'string' ? body.aText.trim() : '';
        const isCode = Boolean(body.isCode);
        if (!qText || !aText) return jsonResponse(ctx, { error: 'نص السؤال والإجابة مطلوبان.' }, 400);

        const chapters = await loadMergedLibrarySection(cfg, grade, section);
        const ch = chapters.find((c) => c.num === chapterNum);
        const nextIndex = ch ? ch.qs.reduce((m, item) => Math.max(m, (item.qIndex ?? 0) + 1), ch.qs.length) : 0;
        const id = `lib_${grade}_${section}_${chapterNum}_${nextIndex}`;

        await setDoc(
          cfg,
          `library_overrides/${id}`,
          {
            id,
            grade,
            section,
            chapterNum,
            qIndex: nextIndex,
            qText: qText.slice(0, 2000),
            aText: aText.slice(0, 8000),
            isCode,
            deleted: false,
            updatedBy: admin.username.slice(0, 160),
          },
          ['updatedAt'],
          authObj
        );

        await logAdminAudit(cfg, admin.idToken, admin.username, 'create_library_question', 'library_override', id);
        return jsonResponse(ctx, { ok: true, id }, 201);
      }

      const libQMatch = path.match(/^\/api\/admin\/library\/questions\/([a-zA-Z0-9_-]+)$/);
      if (libQMatch && method === 'PATCH') {
        const id = libQMatch[1];
        const parts = id.match(/^lib_(bac1|bac2)_(js|py|fin)_(\d+)_(\d+)$/);
        const body = await readJsonBody(request);
        const existingOv = await getDoc<StoredOverride>(cfg, `library_overrides/${id}`, authObj);

        const grade: 'bac1' | 'bac2' = parts ? (parts[1] as 'bac1' | 'bac2') : existingOv?.data.grade || 'bac1';
        const section: 'js' | 'py' | 'fin' = parts ? (parts[2] as 'js' | 'py' | 'fin') : existingOv?.data.section || 'js';
        const chapterNum = parts ? Number(parts[3]) : existingOv?.data.chapterNum || 1;
        const qIndex = parts ? Number(parts[4]) : existingOv?.data.qIndex || 0;

        let baseQ = existingOv?.data.qText || 'سؤال';
        let baseA = existingOv?.data.aText || '-';
        let baseCode = existingOv?.data.isCode ?? false;

        if (!existingOv) {
          const bundledCh = getBundledChapters(grade, section).find((c) => c.num === chapterNum);
          const bundledQ = bundledCh?.qs[qIndex];
          if (bundledQ) {
            baseQ = bundledQ.q;
            baseA = bundledQ.a;
            baseCode = Boolean(bundledQ.code);
          }
        }

        await setDoc(
          cfg,
          `library_overrides/${id}`,
          {
            id,
            grade,
            section,
            chapterNum,
            qIndex: typeof body.qIndex === 'number' ? Math.max(0, Math.round(body.qIndex)) : qIndex,
            qText: (typeof body.qText === 'string' && body.qText.trim() ? body.qText.trim() : baseQ).slice(0, 2000),
            aText: (typeof body.aText === 'string' && body.aText.trim() ? body.aText.trim() : baseA).slice(0, 8000),
            isCode: typeof body.isCode === 'boolean' ? body.isCode : baseCode,
            deleted: false,
            updatedBy: admin.username.slice(0, 160),
          },
          ['updatedAt'],
          authObj
        );

        await logAdminAudit(cfg, admin.idToken, admin.username, 'update_library_question', 'library_override', id);
        return jsonResponse(ctx, { ok: true, updatedAt: new Date().toISOString() });
      }

      if (libQMatch && method === 'DELETE') {
        const id = libQMatch[1];
        const parts = id.match(/^lib_(bac1|bac2)_(js|py|fin)_(\d+)_(\d+)$/);
        const existingOv = await getDoc<StoredOverride>(cfg, `library_overrides/${id}`, authObj);

        const grade: 'bac1' | 'bac2' = parts ? (parts[1] as 'bac1' | 'bac2') : existingOv?.data.grade || 'bac1';
        const section: 'js' | 'py' | 'fin' = parts ? (parts[2] as 'js' | 'py' | 'fin') : existingOv?.data.section || 'js';
        const chapterNum = parts ? Number(parts[3]) : existingOv?.data.chapterNum || 1;
        const qIndex = parts ? Number(parts[4]) : existingOv?.data.qIndex || 0;

        await setDoc(
          cfg,
          `library_overrides/${id}`,
          {
            id,
            grade,
            section,
            chapterNum,
            qIndex,
            qText: existingOv?.data.qText || 'deleted',
            aText: existingOv?.data.aText || '-',
            isCode: existingOv?.data.isCode ?? false,
            deleted: true,
            updatedBy: admin.username.slice(0, 160),
          },
          ['updatedAt'],
          authObj
        );

        await logAdminAudit(cfg, admin.idToken, admin.username, 'delete_library_question', 'library_override', id);
        return jsonResponse(ctx, { ok: true });
      }

      if (method === 'GET' && path === '/api/admin/library/export') {
        const combos: Array<{ grade: 'bac1' | 'bac2'; section: 'js' | 'py' | 'fin' }> = [
          { grade: 'bac1', section: 'js' },
          { grade: 'bac2', section: 'js' },
          { grade: 'bac2', section: 'py' },
          { grade: 'bac2', section: 'fin' },
        ];
        const chapters: Array<Record<string, unknown>> = [];
        const questions: Array<Record<string, unknown>> = [];
        for (const c of combos) {
          const loaded = await loadMergedLibrarySection(cfg, c.grade, c.section);
          for (const ch of loaded) {
            chapters.push({ grade: c.grade, section: c.section, chapterNum: ch.num, title: ch.title });
            for (const q of ch.qs) {
              questions.push({
                id: q.id,
                grade: c.grade,
                section: c.section,
                chapterNum: ch.num,
                qIndex: q.qIndex ?? 0,
                qText: q.q,
                aText: q.a,
                isCode: q.code,
              });
            }
          }
        }
        return jsonResponse(ctx, { exportedAt: new Date().toISOString(), chapters, questions });
      }

      if (method === 'POST' && path === '/api/admin/library/import') {
        const body = await readJsonBody(request);
        const list = Array.isArray(body.questions) ? (body.questions as Array<Record<string, unknown>>) : [];
        let importedCount = 0;

        for (const item of list.slice(0, 200)) {
          const grade: 'bac1' | 'bac2' = item.grade === 'bac2' ? 'bac2' : 'bac1';
          const section: 'js' | 'py' | 'fin' = item.section === 'py' || item.section === 'fin' ? item.section : 'js';
          const chapterNum = Math.max(1, Math.min(200, Math.round(Number(item.chapterNum) || 1)));
          const qIndex = Math.max(0, Math.min(1000, Math.round(Number(item.qIndex) || importedCount)));
          const qText = typeof item.qText === 'string' ? item.qText.trim() : '';
          const aText = typeof item.aText === 'string' ? item.aText.trim() : '';
          if (!qText || !aText) continue;

          const id = `lib_${grade}_${section}_${chapterNum}_${qIndex}`;
          await setDoc(
            cfg,
            `library_overrides/${id}`,
            {
              id,
              grade,
              section,
              chapterNum,
              qIndex,
              qText: qText.slice(0, 2000),
              aText: aText.slice(0, 8000),
              isCode: Boolean(item.isCode),
              deleted: false,
              updatedBy: admin.username.slice(0, 160),
            },
            ['updatedAt'],
            authObj
          );
          importedCount += 1;
        }

        await logAdminAudit(cfg, admin.idToken, admin.username, 'import_library', 'library_override', null, {
          importedCount,
        });
        return jsonResponse(ctx, { ok: true, importedCount });
      }

      // ---------- ADMIN TOOL & AD IMAGE ----------
      if (method === 'GET' && path === '/api/admin/tool') {
        const [cfgDoc, runDocs] = await Promise.all([
          getDoc<Record<string, unknown>>(cfg, 'site_config/public', authObj),
          admin.idToken
            ? listCollection<Record<string, unknown>>(cfg, 'tool_runs', { idToken: admin.idToken }, { pageSize: 100, maxDocs: 200 })
            : Promise.resolve([]),
        ]);
        const siteCfg = mergeSiteConfig(cfgDoc?.data || null, env);
        let succeeded = 0;
        let failed = 0;
        let dur = 0;
        const recentRuns = runDocs
          .map((r) => {
            if (r.data.status === 'success') succeeded += 1;
            else if (r.data.status === 'failed') failed += 1;
            dur += Math.max(0, Number(r.data.durationMs || 0));
            return {
              id: r.id,
              userId: null,
              serviceKey: String(r.data.serviceKey || ''),
              status: String(r.data.status || 'success'),
              durationMs: Number(r.data.durationMs || 0),
              errorMessage: typeof r.data.errorMessage === 'string' ? r.data.errorMessage : null,
              createdAt: normalizeIsoTimestamp(r.data.createdAt),
            };
          })
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, 25);

        return jsonResponse(ctx, {
          services: siteCfg.toolServices,
          videos: siteCfg.toolVideos,
          summary: {
            totalRuns: runDocs.length,
            succeededRuns: succeeded,
            failedRuns: failed,
            avgDurationMs: runDocs.length > 0 ? Math.round(dur / runDocs.length) : 0,
          },
          recentRuns,
        });
      }

      const svcMatch = path.match(/^\/api\/admin\/tool\/services\/([a-zA-Z0-9_-]+)$/);
      if (svcMatch && method === 'PATCH') {
        const key = svcMatch[1];
        const cfgDoc = await getDoc<Record<string, unknown>>(cfg, 'site_config/public', authObj);
        const siteCfg = mergeSiteConfig(cfgDoc?.data || null, env);
        const body = await readJsonBody(request);

        const nextServices = siteCfg.toolServices.map((s) =>
          s.key === key
            ? {
                ...s,
                name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : s.name,
                description:
                  typeof body.description === 'string' && body.description.trim()
                    ? body.description.trim().slice(0, 240)
                    : s.description,
                isVisible: typeof body.isVisible === 'boolean' ? body.isVisible : s.isVisible,
              }
            : s
        );

        await setDoc(
          cfg,
          'site_config/public',
          buildSiteConfigDocPayload({ ...siteCfg, toolServices: nextServices }),
          ['updatedAt'],
          authObj
        );
        await logAdminAudit(cfg, admin.idToken, admin.username, 'update_tool_service', 'tool_service', key);
        return jsonResponse(ctx, { ok: true });
      }

      if (method === 'PUT' && path === '/api/admin/tool/videos') {
        const cfgDoc = await getDoc<Record<string, unknown>>(cfg, 'site_config/public', authObj);
        const siteCfg = mergeSiteConfig(cfgDoc?.data || null, env);
        const body = await readJsonBody(request);
        const rawVideos = Array.isArray(body.videos) ? (body.videos as ToolVideoConfig[]) : siteCfg.toolVideos;
        const cleanVideos = rawVideos.slice(0, 30).map((v, idx) => ({
          id: String(v.id || `vid_${idx + 1}`).slice(0, 40),
          tag: String(v.tag || '').slice(0, 60),
          title: String(v.title || '').slice(0, 120),
          description: String(v.description || '').slice(0, 240),
          src: String(v.src || '').slice(0, 300),
          visible: Boolean(v.visible),
        }));

        await setDoc(
          cfg,
          'site_config/public',
          buildSiteConfigDocPayload({ ...siteCfg, toolVideos: cleanVideos }),
          ['updatedAt'],
          authObj
        );
        await logAdminAudit(cfg, admin.idToken, admin.username, 'update_tool_videos', 'tool_videos');
        return jsonResponse(ctx, { ok: true, videos: cleanVideos });
      }

      if (method === 'POST' && path === '/api/admin/ad-image') {
        const body = await readJsonBody(request);
        const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl.trim() : '';
        if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)) {
          return jsonResponse(ctx, { error: 'صيغة الصورة غير صالحة. المسموح PNG أو JPG أو WEBP.' }, 400);
        }
        if (imageDataUrl.length > 320_000) {
          return jsonResponse(ctx, { error: 'حجم الصورة المضغوطة كبير على وثيقة الإعدادات (الحد الأقصى 240KB).' }, 400);
        }
        await logAdminAudit(cfg, admin.idToken, admin.username, 'upload_ad_image', 'site_config');
        return jsonResponse(ctx, { ok: true, imageUrl: imageDataUrl });
      }

      // ---------- ADMIN POLLS ----------
      if (method === 'GET' && path === '/api/admin/polls') {
        const pollDocs = await listCollection<Record<string, unknown>>(cfg, 'polls', authObj, { pageSize: 50, maxDocs: 50 });
        const polls = pollDocs
          .map((d) => {
            const p = d.data;
            const rawOptions = Array.isArray(p.options) ? (p.options as Array<Record<string, unknown>>) : [];
            const totalVotes = rawOptions.reduce((sum, o) => sum + Math.max(0, Number(o.count || 0)), 0);
            return {
              id: d.id,
              slug: d.id,
              question: String(p.question || ''),
              isOpen: p.isOpen !== false,
              startsAt: typeof p.startsAt === 'string' ? p.startsAt : null,
              endsAt: typeof p.endsAt === 'string' ? p.endsAt : null,
              createdAt: normalizeIsoTimestamp(p.createdAt),
              updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : null,
              totalVotes,
              options: rawOptions.map((o, idx) => {
                const votes = Math.max(0, Number(o.count || 0));
                return {
                  key: String(o.key || `opt_${idx + 1}`),
                  label: String(o.label || ''),
                  sortOrder: idx,
                  votes,
                  percent: totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0,
                };
              }),
            };
          })
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        return jsonResponse(ctx, { polls });
      }

      if (method === 'POST' && path === '/api/admin/polls') {
        const body = await readJsonBody(request);
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        const rawOptions = Array.isArray(body.options) ? body.options : [];
        if (question.length < 3 || rawOptions.length < 2) {
          return jsonResponse(ctx, { error: 'اكتب سؤال واضح وخيارين على الأقل.' }, 400);
        }

        const id = generateId('poll');
        const options = rawOptions.slice(0, 12).map((lbl, idx) => ({
          key: `opt_${idx + 1}`,
          label: String(lbl || '').trim().slice(0, 100) || `خيار ${idx + 1}`,
          count: 0,
        }));

        const data: Record<string, unknown> = {
          id,
          question: question.slice(0, 240),
          options,
          totalVotes: 0,
          isOpen: true,
        };
        if (typeof body.startsAt === 'string' && body.startsAt.trim()) data.startsAt = body.startsAt.trim().slice(0, 64);
        if (typeof body.endsAt === 'string' && body.endsAt.trim()) data.endsAt = body.endsAt.trim().slice(0, 64);

        await createDoc(cfg, 'polls', id, data, ['createdAt', 'updatedAt'], authObj);
        await logAdminAudit(cfg, admin.idToken, admin.username, 'create_poll', 'poll', id);
        return jsonResponse(ctx, { ok: true, id }, 201);
      }

      const pollEditMatch = path.match(/^\/api\/admin\/polls\/([a-zA-Z0-9_-]+)$/);
      if (pollEditMatch && method === 'PATCH') {
        const id = pollEditMatch[1];
        const pollDoc = await getDoc<Record<string, unknown>>(cfg, `polls/${id}`, authObj);
        if (!pollDoc) return jsonResponse(ctx, { error: 'الاستفتاء غير موجود.' }, 404);

        const body = await readJsonBody(request);
        const updates: Record<string, unknown> = {};
        const updateMask: string[] = ['updatedAt'];

        if (typeof body.question === 'string' && body.question.trim().length >= 3) {
          updates.question = body.question.trim().slice(0, 240);
          updateMask.push('question');
        }
        if (typeof body.isOpen === 'boolean') {
          updates.isOpen = body.isOpen;
          updateMask.push('isOpen');
        }
        if (typeof body.startsAt === 'string' && body.startsAt.trim()) {
          updates.startsAt = body.startsAt.trim().slice(0, 64);
          updateMask.push('startsAt');
        }
        if (typeof body.endsAt === 'string' && body.endsAt.trim()) {
          updates.endsAt = body.endsAt.trim().slice(0, 64);
          updateMask.push('endsAt');
        }
        if (Array.isArray(body.options)) {
          const oldOpts = Array.isArray(pollDoc.data.options) ? (pollDoc.data.options as Array<Record<string, unknown>>) : [];
          const countMap = new Map<string, number>();
          for (const o of oldOpts) countMap.set(String(o.key || ''), Math.max(0, Number(o.count || 0)));

          updates.options = (body.options as Array<{ key: string; label: string }>).slice(0, 12).map((o) => ({
            key: o.key,
            label: String(o.label || '').trim().slice(0, 100),
            count: countMap.get(o.key) ?? 0,
          }));
          updateMask.push('options');
        }

        await patchDoc(cfg, `polls/${id}`, updates, updateMask, ['updatedAt'], authObj, true);
        await logAdminAudit(cfg, admin.idToken, admin.username, 'update_poll', 'poll', id);
        return jsonResponse(ctx, { ok: true });
      }

      const pollExportMatch = path.match(/^\/api\/admin\/polls\/([a-zA-Z0-9_-]+)\/export$/);
      if (pollExportMatch && method === 'GET') {
        const id = pollExportMatch[1];
        const [pollDoc, voteDocs] = await Promise.all([
          getDoc<Record<string, unknown>>(cfg, `polls/${id}`, authObj),
          listCollection<Record<string, unknown>>(cfg, `polls/${id}/votes`, authObj, { pageSize: 300, maxDocs: 1000 }),
        ]);
        if (!pollDoc) return jsonResponse(ctx, { error: 'الاستفتاء غير موجود.' }, 404);
        return jsonResponse(ctx, {
          exportedAt: new Date().toISOString(),
          poll: pollDoc.data,
          votes: voteDocs.map((v) => v.data),
        });
      }

      if (method === 'POST' && path === '/api/admin/poll/reset') {
        const body = await readJsonBody(request);
        const pollId = typeof body.pollId === 'string' && body.pollId.trim() ? body.pollId.trim() : 'poll_extend_offer';
        const pollDoc = await getDoc<Record<string, unknown>>(cfg, `polls/${pollId}`, authObj);

        if (pollDoc) {
          await createSystemBackupSnapshot(cfg, authObj, 'pre_poll_reset', admin.username, { pollId });
          const voteDocs = await listCollection<Record<string, unknown>>(cfg, `polls/${pollId}/votes`, authObj, {
            pageSize: 300,
            maxDocs: 500,
          });
          const oldOpts = Array.isArray(pollDoc.data.options) ? (pollDoc.data.options as Array<Record<string, unknown>>) : [];
          const resetOpts = oldOpts.map((o) => ({ key: String(o.key || ''), label: String(o.label || ''), count: 0 }));

          const writes: CommitWriteInput[] = voteDocs.slice(0, 450).map((v) => ({
            docPath: `polls/${pollId}/votes/${v.id}`,
            isDelete: true,
          }));
          writes.push({
            docPath: `polls/${pollId}`,
            data: { options: resetOpts, totalVotes: 0, isOpen: true },
            updateMask: ['options', 'totalVotes', 'isOpen', 'updatedAt'],
            serverTimeFields: ['updatedAt'],
            exists: true,
          });
          await commitWrites(cfg, writes, authObj);
          await logAdminAudit(cfg, admin.idToken, admin.username, 'reset_poll', 'poll', pollId);
          return jsonResponse(ctx, {
            ok: true,
            poll: buildPollStateFromDoc(pollId, { ...pollDoc.data, options: resetOpts, totalVotes: 0, isOpen: true }, null),
          });
        }

        const freshPoll = {
          id: pollId,
          question: 'إيه رأيكم نمد عرض الـ50%؟',
          options: [
            { key: 'extend', label: 'أيوة، مدهولنا شوية كمان 🙏', count: 0 },
            { key: 'enough', label: 'لا، كده كفاية 👍', count: 0 },
          ],
          totalVotes: 0,
          isOpen: true,
        };
        await createDoc(cfg, 'polls', pollId, freshPoll, ['createdAt', 'updatedAt'], authObj);
        return jsonResponse(ctx, { ok: true, poll: buildPollStateFromDoc(pollId, freshPoll, null) });
      }

      // ---------- ADMIN ORDERS ----------
      if (method === 'POST' && path === '/api/admin/orders/manual') {
        const body = await readJsonBody(request);
        const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
        if (fullName.length < 2 || fullName.length > 100) {
          return jsonResponse(ctx, { error: 'اسم العميل غير صالح (حرفين على الأقل).' }, 400);
        }
        const grade = body.grade === 'bac2' ? 'bac2' : 'bac1';
        const platforms = Array.isArray(body.platforms)
          ? (body.platforms.filter((p) => p === 'qureo' || p === 'financial') as ('qureo' | 'financial')[])
          : grade === 'bac1'
            ? (['qureo'] as const)
            : (['qureo'] as const);
        if (platforms.length === 0) {
          return jsonResponse(ctx, { error: 'اختر منصة واحدة على الأقل.' }, 400);
        }
        const cfgDoc = await getDoc<Record<string, unknown>>(cfg, 'site_config/public', authObj).catch(() => null);
        const siteCfg = mergeSiteConfig(cfgDoc?.data || null, env);
        let pricing;
        try {
          pricing = calculateOrderPricing(
            {
              grade,
              platforms: [...platforms],
              qureoSection: platforms.includes('qureo') && grade === 'bac2' ? 'java' : undefined,
            },
            siteCfg
          );
        } catch (err) {
          return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'بيانات الباقة غير صالحة.' }, 400);
        }

        const customCode =
          typeof body.orderCode === 'string' && body.orderCode.trim()
            ? body.orderCode.trim().toUpperCase().replace(/^#/, '').slice(0, 32)
            : formatOrderCode();
        if (!/^[A-Z0-9_-]{3,32}$/.test(customCode)) {
          return jsonResponse(ctx, { error: 'صيغة رقم الطلب غير صالحة.' }, 400);
        }

        // Duplicate orderCode guard
        const dupOrders = await runQuery<Record<string, unknown>>(
          cfg,
          'orders',
          { filters: [{ fieldPath: 'orderCode', op: 'EQUAL', value: customCode }], limit: 1 },
          authObj
        ).catch(() => []);
        if (dupOrders.length > 0) {
          return jsonResponse(
            ctx,
            { error: `يوجد طلب مسجل بالفعل بنفس الرقم (#${customCode}).`, conflict: true, existingId: dupOrders[0].id },
            409
          );
        }

        const platformUsername =
          typeof body.platformUsername === 'string' ? body.platformUsername.trim().slice(0, 120) : '';
        if (platformUsername.length < 2) {
          return jsonResponse(ctx, { error: 'اسم مستخدم المنصة مطلوب (حرفين على الأقل).' }, 400);
        }
        const paymentMethod =
          typeof body.paymentMethod === 'string' && body.paymentMethod.trim()
            ? body.paymentMethod.trim().slice(0, 80)
            : 'محفظة إلكترونية (كاش)';
        const status =
          body.status === 'reviewing' || body.status === 'completed' || body.status === 'cancelled'
            ? body.status
            : 'new';
        const paymentStatus =
          body.paymentStatus === 'paid' || body.paymentStatus === 'unpaid' || body.paymentStatus === 'refunded'
            ? body.paymentStatus
            : 'pending_verification';
        const subscriptionStatus =
          body.subscriptionStatus === 'active' ||
          body.subscriptionStatus === 'expired' ||
          body.subscriptionStatus === 'cancelled'
            ? body.subscriptionStatus
            : status === 'completed'
              ? 'active'
              : 'pending_confirmation';
        const finalPrice =
          typeof body.finalPrice === 'number' && body.finalPrice >= 0
            ? Math.round(body.finalPrice)
            : Math.round(pricing.finalPrice);
        const adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 500) : '';
        const orderId = generateId('ord_man');
        const nowIso = new Date().toISOString();

        const orderDocData: Record<string, unknown> = {
          id: orderId,
          orderCode: customCode,
          authorUid: 'admin_manual',
          fullName,
          grade,
          platformLabel: pricing.platformLabel,
          sectionDetails: pricing.sectionDetails,
          platformsJson: JSON.stringify({ platforms, qureoSection: platforms.includes('qureo') && grade === 'bac2' ? 'java' : null }),
          platformUsername,
          encryptedPassword: '',
          passwordIv: '',
          passwordAuthTag: '',
          credentialsPurged: true,
          oldPrice: Math.round(pricing.oldPrice),
          finalPrice,
          offerApplied: finalPrice < pricing.oldPrice,
          paymentMethod,
          status,
          paymentStatus,
          subscriptionStatus,
          source: 'admin_manual',
          ...(adminNote ? { adminNote } : {}),
          changeLog: [
            {
              at: nowIso,
              by: admin.username,
              fromStatus: null,
              toStatus: status,
              paymentStatus,
              subscriptionStatus,
              note: adminNote || 'تسجيل ومطابقة طلب يدوي من واتساب',
            },
          ],
        };

        await createDoc(cfg, 'orders', orderId, orderDocData, ['createdAt', 'updatedAt'], authObj);
        adminReadCache.clear();
        await logAdminAudit(cfg, admin.idToken, admin.username, 'create_manual_order', 'order', orderId, {
          orderCode: customCode,
          fullName,
          finalPrice,
          paymentStatus,
          subscriptionStatus,
        });

        return jsonResponse(
          ctx,
          {
            ok: true,
            order: {
              id: orderId,
              orderCode: customCode,
              fullName,
              grade,
              platformLabel: pricing.platformLabel,
              sectionDetails: pricing.sectionDetails,
              platformUsername,
              platformPassword: null,
              credentialsPurged: true,
              oldPrice: Math.round(pricing.oldPrice),
              finalPrice,
              offerApplied: finalPrice < pricing.oldPrice,
              paymentMethod,
              status,
              paymentStatus,
              subscriptionStatus,
              source: 'admin_manual',
              adminNote: adminNote || null,
              changeLog: orderDocData.changeLog,
              createdAt: nowIso,
              updatedAt: nowIso,
            },
          },
          201
        );
      }

      const orderAdminMatch = path.match(/^\/api\/admin\/orders\/([a-zA-Z0-9_-]+)$/);
      if (orderAdminMatch && method === 'PATCH') {
        const id = orderAdminMatch[1];
        const orderDoc = await getDoc<Record<string, unknown>>(cfg, `orders/${id}`, authObj);
        if (!orderDoc) return jsonResponse(ctx, { error: 'الطلب غير موجود.' }, 404);

        const body = await readJsonBody(request);
        const currentStatus = String(orderDoc.data.status || 'new');

        if (
          typeof body.expectedCurrentStatus === 'string' &&
          body.expectedCurrentStatus !== currentStatus
        ) {
          return jsonResponse(
            ctx,
            {
              error: `تم تغيير حالة الطلب مسبقاً إلى (${currentStatus}). حدّث البيانات قبل التعديل.`,
              conflict: true,
              currentStatus,
            },
            409
          );
        }

        const updates: Record<string, unknown> = {};
        const updateMask: string[] = ['updatedAt'];

        if (body.status === 'new' || body.status === 'reviewing' || body.status === 'completed' || body.status === 'cancelled') {
          updates.status = body.status;
          updateMask.push('status');
        }
        if (
          body.paymentStatus === 'pending_verification' ||
          body.paymentStatus === 'paid' ||
          body.paymentStatus === 'unpaid' ||
          body.paymentStatus === 'refunded'
        ) {
          updates.paymentStatus = body.paymentStatus;
          updateMask.push('paymentStatus');
        }
        if (
          body.subscriptionStatus === 'pending_confirmation' ||
          body.subscriptionStatus === 'active' ||
          body.subscriptionStatus === 'expired' ||
          body.subscriptionStatus === 'cancelled'
        ) {
          updates.subscriptionStatus = body.subscriptionStatus;
          updateMask.push('subscriptionStatus');
        }
        if (typeof body.adminNote === 'string') {
          updates.adminNote = body.adminNote.trim().slice(0, 500);
          updateMask.push('adminNote');
        }

        const shouldPurge = body.purgeCredentials === true || updates.status === 'completed' || updates.status === 'cancelled';
        if (shouldPurge) {
          updates.credentialsPurged = true;
          updates.encryptedPassword = '';
          updates.passwordIv = '';
          updates.passwordAuthTag = '';
          updateMask.push('credentialsPurged', 'encryptedPassword', 'passwordIv', 'passwordAuthTag');
        }

        const existingLog = Array.isArray(orderDoc.data.changeLog)
          ? (orderDoc.data.changeLog as Array<Record<string, unknown>>)
          : [];
        const nextStatus = String(updates.status || currentStatus);
        const nextPaymentStatus = String(updates.paymentStatus || orderDoc.data.paymentStatus || 'pending_verification');
        const nextSubscriptionStatus = String(
          updates.subscriptionStatus || orderDoc.data.subscriptionStatus || 'pending_confirmation'
        );
        const nextLog = [
          ...existingLog.slice(-19),
          {
            at: new Date().toISOString(),
            by: admin.username,
            fromStatus: currentStatus,
            toStatus: nextStatus,
            paymentStatus: nextPaymentStatus,
            subscriptionStatus: nextSubscriptionStatus,
            ...(typeof updates.adminNote === 'string' && updates.adminNote ? { note: updates.adminNote } : {}),
          },
        ];
        updates.changeLog = nextLog;
        updateMask.push('changeLog');

        await patchDoc(cfg, `orders/${id}`, updates, updateMask, ['updatedAt'], authObj, true);
        adminReadCache.clear();
        await logAdminAudit(cfg, admin.idToken, admin.username, 'update_order', 'order', id, updates);

        return jsonResponse(ctx, {
          ok: true,
          status: nextStatus,
          paymentStatus: nextPaymentStatus,
          subscriptionStatus: nextSubscriptionStatus,
          adminNote: typeof updates.adminNote === 'string' ? updates.adminNote : (orderDoc.data.adminNote as string | null) ?? null,
          changeLog: nextLog,
          credentialsPurged: Boolean(updates.credentialsPurged || orderDoc.data.credentialsPurged),
        });
      }

      if (orderAdminMatch && method === 'DELETE') {
        const id = orderAdminMatch[1];
        await deleteDoc(cfg, `orders/${id}`, authObj);
        adminReadCache.clear();
        await logAdminAudit(cfg, admin.idToken, admin.username, 'delete_order', 'order', id);
        return jsonResponse(ctx, { ok: true });
      }

      // ---------- ADMIN COMMENTS ----------
      const cmtAdminMatch = path.match(/^\/api\/admin\/comments\/([a-zA-Z0-9_-]+)$/);
      if (cmtAdminMatch && method === 'PATCH') {
        const id = cmtAdminMatch[1];
        const body = await readJsonBody(request);
        const updates: Record<string, unknown> = {};
        const updateMask: string[] = ['updatedAt'];

        if (typeof body.isVerified === 'boolean') {
          updates.isVerified = body.isVerified;
          updateMask.push('isVerified');
        }
        if (
          body.status === 'approved' ||
          body.status === 'pending' ||
          body.status === 'hidden' ||
          body.status === 'flagged'
        ) {
          updates.status = body.status;
          updateMask.push('status');
        }
        if (body.clearReports === true) {
          updates.reportsCount = 0;
          updateMask.push('reportsCount');
        }

        await patchDoc(cfg, `comments/${id}`, updates, updateMask, ['updatedAt'], authObj, true);
        clearPublicReadCache('comments_approved');
        adminReadCache.clear();
        await logAdminAudit(cfg, admin.idToken, admin.username, 'update_comment', 'comment', id, updates);
        return jsonResponse(ctx, { ok: true });
      }

      if (cmtAdminMatch && method === 'DELETE') {
        const id = cmtAdminMatch[1];
        await deleteDoc(cfg, `comments/${id}`, authObj);
        await logAdminAudit(cfg, admin.idToken, admin.username, 'delete_comment', 'comment', id);
        return jsonResponse(ctx, { ok: true });
      }

      // ---------- ADMIN QUESTION REPORTS ----------
      const qRepAdminMatch = path.match(/^\/api\/admin\/question-reports\/([a-zA-Z0-9_-]+)$/);
      if (qRepAdminMatch && method === 'PATCH') {
        const id = qRepAdminMatch[1];
        const body = await readJsonBody(request);
        const updates: Record<string, unknown> = {};
        const updateMask: string[] = ['updatedAt'];

        if (body.status === 'pending' || body.status === 'reviewed' || body.status === 'resolved' || body.status === 'dismissed') {
          updates.status = body.status;
          updateMask.push('status');
        }
        if (typeof body.adminNote === 'string') {
          updates.adminNote = body.adminNote.slice(0, 500);
          updateMask.push('adminNote');
        }

        await patchDoc(cfg, `question_reports/${id}`, updates, updateMask, ['updatedAt'], authObj, true);
        await logAdminAudit(cfg, admin.idToken, admin.username, 'update_question_report', 'question_report', id, updates);
        return jsonResponse(ctx, { ok: true, status: String(updates.status || 'pending') });
      }

      // ---------- ADMIN PUSH DISPATCH ----------
      if (method === 'POST' && path === '/api/admin/push/send') {
        const body = await readJsonBody(request);
        const mode =
          body.mode === 'due' || body.mode === 'broadcast_custom' ? body.mode : 'broadcast_next';
        const result = await dispatchNotificationsFirestore(cfg, env, admin.idToken!, {
          mode,
          triggerType: 'manual',
          customTitle: typeof body.title === 'string' ? body.title.trim() : undefined,
          customBody: typeof body.body === 'string' ? body.body.trim() : undefined,
          customCategory:
            body.category === 'offer' || body.category === 'service' ? body.category : 'update',
        });
        await logAdminAudit(cfg, admin.idToken, admin.username, 'send_push', 'notifications', null, { mode, ...result });
        return jsonResponse(ctx, { ok: true, result });
      }

      // ---------- ADMIN SETTINGS ----------
      if (method === 'PUT' && path === '/api/admin/settings') {
        let cfgDoc: { id: string; data: Record<string, unknown> } | null = null;
        try {
          cfgDoc = await getDoc<Record<string, unknown>>(cfg, 'site_config/public', authObj);
        } catch (readErr) {
          return jsonResponse(
            ctx,
            {
              error: `تم إلغاء الحفظ حمايةً للبيانات: تعذر قراءة الإعدادات الحالية من Firestore (${readErr instanceof Error ? readErr.message : 'DB Error'}).`,
            },
            503
          );
        }

        await createSystemBackupSnapshot(cfg, authObj, 'pre_settings_update', admin.username);
        const current = mergeSiteConfig(cfgDoc?.data || null, env);
        const body = await readJsonBody(request);
        const resetToRegular = body.resetToRegularPrices === true;

        const nextQureoOld =
          typeof body.qureoOldPrice === 'number' && body.qureoOldPrice >= 1 ? body.qureoOldPrice : current.qureoOldPrice;
        const nextFinOld =
          typeof body.finOldPrice === 'number' && body.finOldPrice >= 1 ? body.finOldPrice : current.finOldPrice;
        const nextBundleOld =
          typeof body.bundleOldPrice === 'number' && body.bundleOldPrice >= 1
            ? body.bundleOldPrice
            : current.bundleOldPrice;

        const nextAfterOfferMode: 'regular_price' | 'extended_offer' = resetToRegular
          ? 'regular_price'
          : body.afterOfferMode === 'regular_price'
            ? 'regular_price'
            : body.afterOfferMode === 'extended_offer'
              ? 'extended_offer'
              : current.afterOfferMode;

        const nextConfig: PublicSiteConfig = {
          ...current,
          qureoOldPrice: nextQureoOld,
          qureoOfferPrice: resetToRegular
            ? nextQureoOld
            : typeof body.qureoOfferPrice === 'number' && body.qureoOfferPrice >= 1
              ? body.qureoOfferPrice
              : current.qureoOfferPrice,
          finOldPrice: nextFinOld,
          finOfferPrice: resetToRegular
            ? nextFinOld
            : typeof body.finOfferPrice === 'number' && body.finOfferPrice >= 1
              ? body.finOfferPrice
              : current.finOfferPrice,
          bundleOldPrice: nextBundleOld,
          bundleOfferPrice: resetToRegular
            ? nextBundleOld
            : typeof body.bundleOfferPrice === 'number' && body.bundleOfferPrice >= 1
              ? body.bundleOfferPrice
              : current.bundleOfferPrice,
          offerEndsAt: resetToRegular
            ? typeof body.offerEndsAt === 'string' && body.offerEndsAt.trim()
              ? body.offerEndsAt.trim()
              : new Date(Date.now() - 60_000).toISOString()
            : typeof body.offerEndsAt === 'string' && body.offerEndsAt.trim()
              ? body.offerEndsAt.trim()
              : current.offerEndsAt,
          afterOfferMode: nextAfterOfferMode,
          ordersEnabled: typeof body.ordersEnabled === 'boolean' ? body.ordersEnabled : current.ordersEnabled,
          pollClosed: typeof body.pollClosed === 'boolean' ? body.pollClosed : current.pollClosed,
          whatsappNumber:
            typeof body.adminWhatsappDisplay === 'string' && body.adminWhatsappDisplay.trim().length >= 6
              ? body.adminWhatsappDisplay.trim().replace(/\D/g, '')
              : current.whatsappNumber,
          adminWhatsappDisplay:
            typeof body.adminWhatsappDisplay === 'string' && body.adminWhatsappDisplay.trim().length >= 6
              ? body.adminWhatsappDisplay.trim().replace(/\D/g, '')
              : current.adminWhatsappDisplay,
          offerText: resetToRegular
            ? `الأسعار العادية: المنصة بـ ${nextQureoOld} جنيه والمنصتين بـ ${nextBundleOld} جنيه`
            : typeof body.offerText === 'string'
              ? body.offerText.trim()
              : current.offerText,
          notificationsEnabled:
            typeof body.notificationsEnabled === 'boolean'
              ? body.notificationsEnabled
              : current.notificationsEnabled,
          notificationsIntervalDays:
            typeof body.notificationsIntervalDays === 'number'
              ? Math.max(1, Math.min(365, Math.round(body.notificationsIntervalDays)))
              : current.notificationsIntervalDays,
          heroPromo:
            body.heroPromo && typeof body.heroPromo === 'object'
              ? { ...current.heroPromo, ...(body.heroPromo as Partial<PublicSiteConfig['heroPromo']>) }
              : current.heroPromo,
          promoBanner:
            body.promoBanner && typeof body.promoBanner === 'object'
              ? { ...current.promoBanner, ...(body.promoBanner as Partial<PublicSiteConfig['promoBanner']>) }
              : current.promoBanner,
          libraryAd: (() => {
            if (resetToRegular) {
              return {
                ...current.libraryAd,
                priceText: `حل المنصة بالكامل بـ ${nextQureoOld} جنيه · المنصتين معاً بـ ${nextBundleOld} جنيه`,
              };
            }
            const wfAction =
              typeof body.libraryAdWorkflowAction === 'string' ? body.libraryAdWorkflowAction : null;
            const rawDraft =
              body.libraryAdDraft && typeof body.libraryAdDraft === 'object'
                ? (body.libraryAdDraft as Partial<LibraryAdDraftConfig>)
                : null;
            const rawLivePatch =
              body.libraryAd && typeof body.libraryAd === 'object'
                ? (body.libraryAd as Partial<PublicSiteConfig['libraryAd']>)
                : null;

            const existingDraft: LibraryAdDraftConfig = current.libraryAd.draft || {
              title: current.libraryAd.title,
              subtitle: current.libraryAd.subtitle,
              priceText: current.libraryAd.priceText,
              ctaText: current.libraryAd.ctaText,
              ctaLink: current.libraryAd.ctaLink,
              imageUrl: current.libraryAd.imageUrl,
              delaySeconds: current.libraryAd.delaySeconds,
              cooldownHours: current.libraryAd.cooldownHours,
              templateMode: current.libraryAd.templateMode,
              workflowStatus: (current.libraryAd.workflowStatus as AdWorkflowStatus) || 'published',
              updatedAt: new Date().toISOString(),
            };

            if (wfAction === 'save_draft' || wfAction === 'preview' || wfAction === 'approve') {
              const nextStatus: AdWorkflowStatus =
                wfAction === 'approve' ? 'approved' : wfAction === 'preview' ? 'preview' : 'draft';
              const nextDraft: LibraryAdDraftConfig = {
                ...existingDraft,
                ...(rawDraft || {}),
                ...(rawLivePatch
                  ? {
                      title: rawLivePatch.title ?? existingDraft.title,
                      subtitle: rawLivePatch.subtitle ?? existingDraft.subtitle,
                      priceText: rawLivePatch.priceText ?? existingDraft.priceText,
                      ctaText: rawLivePatch.ctaText ?? existingDraft.ctaText,
                      ctaLink: rawLivePatch.ctaLink ?? existingDraft.ctaLink,
                      imageUrl: rawLivePatch.imageUrl ?? existingDraft.imageUrl,
                      delaySeconds: rawLivePatch.delaySeconds ?? existingDraft.delaySeconds,
                      cooldownHours: rawLivePatch.cooldownHours ?? existingDraft.cooldownHours,
                      templateMode: rawLivePatch.templateMode ?? existingDraft.templateMode,
                    }
                  : {}),
                workflowStatus: nextStatus,
                updatedAt: new Date().toISOString(),
              };
              // Strict Draft/Preview/Approved workflow: do NOT overwrite live ad fields until published
              return {
                ...current.libraryAd,
                workflowStatus: nextStatus,
                draft: nextDraft,
              };
            }

            if (wfAction === 'archive') {
              return {
                ...current.libraryAd,
                enabled: false,
                workflowStatus: 'archived' as AdWorkflowStatus,
                draft: {
                  ...existingDraft,
                  workflowStatus: 'archived' as AdWorkflowStatus,
                  updatedAt: new Date().toISOString(),
                },
              };
            }

            if (wfAction === 'publish') {
              const source = rawDraft || rawLivePatch || existingDraft;
              const nextDraft: LibraryAdDraftConfig = {
                ...existingDraft,
                ...source,
                workflowStatus: 'published',
                updatedAt: new Date().toISOString(),
              };
              return {
                ...current.libraryAd,
                enabled: rawLivePatch?.enabled !== undefined ? Boolean(rawLivePatch.enabled) : true,
                title: nextDraft.title,
                subtitle: nextDraft.subtitle,
                priceText: nextDraft.priceText,
                ctaText: nextDraft.ctaText,
                ctaLink: nextDraft.ctaLink,
                imageUrl: nextDraft.imageUrl,
                delaySeconds: nextDraft.delaySeconds,
                cooldownHours: nextDraft.cooldownHours,
                templateMode: nextDraft.templateMode,
                workflowStatus: 'published' as AdWorkflowStatus,
                draft: nextDraft,
              };
            }

            if (rawLivePatch) {
              return {
                ...current.libraryAd,
                ...rawLivePatch,
              };
            }
            return current.libraryAd;
          })(),
        };

        // Process Centralized Ad Center operations & keep legacy fields <-> ads synchronized
        const nowIso = new Date().toISOString();
        let finalConfig: PublicSiteConfig = nextConfig;
        const adCenterAction = typeof body.adCenterAction === 'string' ? body.adCenterAction : null;
        const targetAdId = typeof body.adId === 'string' ? body.adId.trim() : '';

        if (adCenterAction) {
          let nextAds = [...(current.ads || [])];

          if (adCenterAction === 'save_draft' && body.adUnit && typeof body.adUnit === 'object') {
            const incomingClean = sanitizeAdUnit(body.adUnit);
            const idx = nextAds.findIndex((a) => a.id === incomingClean.id);
            if (idx >= 0) {
              const existing = nextAds[idx];
              nextAds[idx] = {
                ...existing,
                draft: {
                  name: incomingClean.name,
                  type: incomingClean.type,
                  placement: incomingClean.placement,
                  content: incomingClean.content,
                  design: incomingClean.design,
                  motion: incomingClean.motion,
                  behavior: incomingClean.behavior,
                  updatedAt: nowIso,
                },
                updatedAt: nowIso,
              };
            } else {
              if (nextAds.length >= 40) {
                return jsonResponse(ctx, { error: 'تم الوصول للحد الأقصى لعدد الوحدات الإعلانية (40 إعلاناً).' }, 400);
              }
              nextAds.unshift({
                ...incomingClean,
                status: 'draft',
                behavior: { ...incomingClean.behavior, enabled: false },
                draft: {
                  name: incomingClean.name,
                  type: incomingClean.type,
                  placement: incomingClean.placement,
                  content: incomingClean.content,
                  design: incomingClean.design,
                  motion: incomingClean.motion,
                  behavior: { ...incomingClean.behavior, enabled: false },
                  updatedAt: nowIso,
                },
                createdAt: nowIso,
                updatedAt: nowIso,
              });
            }
          } else if (adCenterAction === 'publish' && body.adUnit && typeof body.adUnit === 'object') {
            const incomingClean = sanitizeAdUnit(body.adUnit);
            const startMs = incomingClean.behavior.startAt ? Date.parse(incomingClean.behavior.startAt) : NaN;
            const computedStatus =
              incomingClean.status === 'archived'
                ? 'archived'
                : incomingClean.behavior.enabled === false
                ? 'paused'
                : Number.isFinite(startMs) && Date.now() < startMs
                ? 'scheduled'
                : 'active';

            const publishedUnit: AdUnitConfig = {
              ...incomingClean,
              status: computedStatus,
              behavior: {
                ...incomingClean.behavior,
                enabled: computedStatus === 'active' || computedStatus === 'scheduled',
              },
              draft: null,
              updatedAt: nowIso,
            };

            const idx = nextAds.findIndex((a) => a.id === publishedUnit.id);
            if (idx >= 0) {
              nextAds[idx] = { ...publishedUnit, createdAt: nextAds[idx].createdAt, isSystemDefault: nextAds[idx].isSystemDefault, systemKey: nextAds[idx].systemKey };
            } else {
              if (nextAds.length >= 40) {
                return jsonResponse(ctx, { error: 'تم الوصول للحد الأقصى لعدد الوحدات الإعلانية (40 إعلاناً).' }, 400);
              }
              nextAds.unshift({ ...publishedUnit, createdAt: nowIso });
            }
          } else if (adCenterAction === 'toggle' && targetAdId) {
            nextAds = nextAds.map((ad) => {
              if (ad.id !== targetAdId) return ad;
              const willEnable = !ad.behavior.enabled || ad.status === 'paused' || ad.status === 'draft' || ad.status === 'archived';
              const nextStatus = willEnable
                ? ad.behavior.startAt && Date.parse(ad.behavior.startAt) > Date.now()
                  ? 'scheduled'
                  : 'active'
                : 'paused';
              return {
                ...ad,
                status: nextStatus,
                behavior: { ...ad.behavior, enabled: willEnable },
                updatedAt: nowIso,
              };
            });
          } else if (adCenterAction === 'duplicate' && targetAdId) {
            if (nextAds.length >= 40) {
              return jsonResponse(ctx, { error: 'تم الوصول للحد الأقصى لعدد الوحدات الإعلانية (40 إعلاناً).' }, 400);
            }
            const source = nextAds.find((a) => a.id === targetAdId);
            if (source) {
              const clonedId = `ad_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
              const cloned: AdUnitConfig = sanitizeAdUnit({
                ...source,
                id: clonedId,
                name: `${source.name} (نسخة)`,
                status: 'draft',
                isSystemDefault: false,
                systemKey: undefined,
                behavior: { ...source.behavior, enabled: false },
                draft: null,
                createdAt: nowIso,
                updatedAt: nowIso,
              });
              nextAds.unshift(cloned);
            }
          } else if (adCenterAction === 'delete' && targetAdId) {
            const target = nextAds.find((a) => a.id === targetAdId);
            if (target?.isSystemDefault) {
              return jsonResponse(
                ctx,
                { error: 'لا يمكن حذف إعلان النظام الأساسي؛ يمكنك إيقافه أو استعادة إعداداته الافتراضية.' },
                400
              );
            }
            nextAds = nextAds.filter((a) => a.id !== targetAdId);
          } else if (adCenterAction === 'restore_default' && targetAdId) {
            const defaultSet = buildDefaultAdUnits();
            const factoryDefault = defaultSet.find((d) => d.id === targetAdId);
            if (!factoryDefault) {
              return jsonResponse(ctx, { error: 'لا توجد إعدادات افتراضية قياسية لهذا الإعلان.' }, 404);
            }
            nextAds = nextAds.map((a) =>
              a.id === targetAdId ? { ...factoryDefault, updatedAt: nowIso } : a
            );
          }

          const syncedLegacy = syncLegacyAdFieldsFromUnits(
            {
              promoBanner: nextConfig.promoBanner,
              heroPromo: nextConfig.heroPromo,
              libraryAd: {
                ...nextConfig.libraryAd,
                draft: (nextConfig.libraryAd.draft as Record<string, unknown> | null) ?? null,
              },
            },
            nextAds
          );
          finalConfig = {
            ...nextConfig,
            promoBanner: syncedLegacy.promoBanner,
            heroPromo: syncedLegacy.heroPromo,
            libraryAd: {
              ...nextConfig.libraryAd,
              ...syncedLegacy.libraryAd,
              draft: nextConfig.libraryAd.draft,
            },
            ads: nextAds,
          };
        } else {
          // Legacy settings update path (promoBanner, heroPromo, libraryAd, resetToRegularPrices)
          const syncedAds = syncUnitsFromLegacyAdFields(current.ads || [], {
            promoBanner: body.promoBanner ? finalConfig.promoBanner : undefined,
            heroPromo: body.heroPromo ? finalConfig.heroPromo : undefined,
            libraryAd:
              resetToRegular || body.libraryAd || body.libraryAdWorkflowAction
                ? finalConfig.libraryAd
                : undefined,
          });
          finalConfig = { ...finalConfig, ads: syncedAds };
        }

        const docPayload = buildSiteConfigDocPayload(finalConfig);
        if (JSON.stringify(docPayload).length > 880_000) {
          return jsonResponse(
            ctx,
            {
              error:
                'حجم الإعدادات وصور الإعلانات تجاوز الحد المسموح لوثيقة Firestore (880KB). استخدم روابط صور أو صوراً مضغوطة.',
            },
            400
          );
        }

        await setDoc(cfg, 'site_config/public', docPayload, ['updatedAt'], authObj);
        clearPublicReadCache('site_config');
        adminReadCache.clear();
        await logAdminAudit(
          cfg,
          admin.idToken,
          admin.username,
          adCenterAction ? `ad_center_${adCenterAction}` : 'update_settings',
          'site_config'
        );
        return jsonResponse(ctx, { ok: true, config: buildPublicConfigResponse(finalConfig) });
      }

      // ---------- ADMIN BACKUP & AUDIT LOGS ----------
      if (method === 'POST' && path === '/api/admin/backup') {
        const [
          siteCfg,
          users,
          orders,
          comments,
          polls,
          qStats,
          qReports,
          libOverrides,
          notifLogs,
          auditLogs,
          dailyDocs,
          pushDocs,
        ] = await Promise.all([
          getDoc(cfg, 'site_config/public', authObj),
          listCollection(cfg, 'users', authObj, { pageSize: 300, maxDocs: 2500 }),
          listCollection(cfg, 'orders', authObj, { pageSize: 300, maxDocs: 2500 }),
          listCollection(cfg, 'comments', authObj, { pageSize: 300, maxDocs: 2500 }),
          listCollection(cfg, 'polls', authObj, { pageSize: 50, maxDocs: 100 }),
          listCollection(cfg, 'question_stats', authObj, { pageSize: 300, maxDocs: 2500 }),
          listCollection(cfg, 'question_reports', authObj, { pageSize: 300, maxDocs: 1500 }),
          listCollection(cfg, 'library_overrides', authObj, { pageSize: 300, maxDocs: 2500 }),
          listCollection(cfg, 'notification_logs', authObj, { pageSize: 200, maxDocs: 500 }),
          listCollection(cfg, 'audit_logs', authObj, { pageSize: 200, maxDocs: 500 }),
          listCollection(cfg, 'analytics_daily', authObj, { pageSize: 300, maxDocs: 1500 }),
          listCollection(cfg, 'push_subscriptions', authObj, { pageSize: 300, maxDocs: 2500 }),
        ]);

        const snapshot = {
          exportedAt: new Date().toISOString(),
          engine: 'firebase-firestore',
          projectId: cfg.projectId,
          databaseId: cfg.databaseId,
          collections: {
            site_config: siteCfg?.data || null,
            users: users.map((d) => ({ id: d.id, ...d.data })),
            orders: orders.map((d) => ({ id: d.id, ...d.data })),
            comments: comments.map((d) => ({ id: d.id, ...d.data })),
            polls: polls.map((d) => ({ id: d.id, ...d.data })),
            question_stats: qStats.map((d) => ({ id: d.id, ...d.data })),
            question_reports: qReports.map((d) => ({ id: d.id, ...d.data })),
            library_overrides: libOverrides.map((d) => ({ id: d.id, ...d.data })),
            notification_logs: notifLogs.map((d) => ({ id: d.id, ...d.data })),
            audit_logs: auditLogs.map((d) => ({ id: d.id, ...d.data })),
            analytics_daily: dailyDocs.map((d) => ({ id: d.id, ...d.data })),
            push_subscriptions: pushDocs.map((d) => ({ id: d.id, ...d.data })),
          },
        };

        const rawJson = JSON.stringify(snapshot, null, 2);
        const filename = `crovo-firestore-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const sizeBytes = new TextEncoder().encode(rawJson).byteLength;

        await createSystemBackupSnapshot(cfg, authObj, 'manual_export', admin.username, {
          filename,
          fullExportSizeBytes: sizeBytes,
          collectionCounts: {
            users: users.length,
            orders: orders.length,
            comments: comments.length,
            polls: polls.length,
            question_stats: qStats.length,
            library_overrides: libOverrides.length,
            analytics_daily: dailyDocs.length,
            push_subscriptions: pushDocs.length,
          },
        });

        await logAdminAudit(cfg, admin.idToken, admin.username, 'create_backup', 'firestore', filename);

        return jsonResponse(ctx, {
          ok: true,
          backup: {
            filename,
            sizeBytes,
            createdAt: snapshot.exportedAt,
          },
          snapshot,
          backups: [
            {
              filename,
              sizeBytes,
              createdAt: snapshot.exportedAt,
            },
          ],
        });
      }

      if (method === 'GET' && path === '/api/admin/audit-logs') {
        const docs = await listCollection<Record<string, unknown>>(cfg, 'audit_logs', authObj, {
          pageSize: 150,
          maxDocs: 200,
        });
        const logs = docs
          .map((d) => ({
            id: d.id,
            actorUsername: String(d.data.actorUsername || ''),
            action: String(d.data.action || ''),
            targetType: String(d.data.targetType || ''),
            targetId: typeof d.data.targetId === 'string' ? d.data.targetId : null,
            detailsJson: typeof d.data.detailsJson === 'string' ? d.data.detailsJson : null,
            createdAt: normalizeIsoTimestamp(d.data.createdAt),
          }))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

        return jsonResponse(ctx, { logs });
      }

      // ---------- ADMIN VERSIONED NON-DESTRUCTIVE FIRESTORE BASELINE SYNC ----------
      if (method === 'POST' && path === '/api/admin/migrate-legacy') {
        const backupMeta = await createSystemBackupSnapshot(cfg, authObj, 'pre_legacy_sync', admin.username);
        const seeded: Record<string, number> = {
          siteConfig: 0,
          libraryBundles: 0,
          polls: 0,
          skippedExisting: 0,
        };

        // 1. Only initialize site_config/public if completely missing (NEVER overwrite existing settings!)
        const existingCfg = await getDoc<Record<string, unknown>>(cfg, 'site_config/public', authObj);
        if (!existingCfg) {
          await createDoc(
            cfg,
            'site_config',
            'public',
            buildSiteConfigDocPayload(buildDefaultSiteConfig(env.ADMIN_WHATSAPP_NUMBER)),
            ['updatedAt'],
            authObj
          );
          seeded.siteConfig = 1;
        } else {
          seeded.skippedExisting += 1;
        }

        // 2. Only create default poll if missing (NEVER reset or overwrite existing poll!)
        const existingPoll = await getDoc(cfg, 'polls/poll_extend_offer', authObj);
        if (!existingPoll) {
          await createDoc(
            cfg,
            'polls',
            'poll_extend_offer',
            {
              id: 'poll_extend_offer',
              question: 'إيه رأيكم نمد عرض الـ50%؟',
              options: [
                { key: 'extend', label: 'أيوة، مدهولنا شوية كمان 🙏', count: 0 },
                { key: 'enough', label: 'لا، كده كفاية 👍', count: 0 },
              ],
              totalVotes: 0,
              isOpen: true,
            },
            ['createdAt', 'updatedAt'],
            authObj
          );
          seeded.polls = 1;
        } else {
          seeded.skippedExisting += 1;
        }

        // 3. Only seed missing library_bundles documents (NEVER overwrite existing bundles!)
        const combos: Array<{ grade: 'bac1' | 'bac2'; section: 'js' | 'py' | 'fin' }> = [
          { grade: 'bac1', section: 'js' },
          { grade: 'bac2', section: 'js' },
          { grade: 'bac2', section: 'py' },
          { grade: 'bac2', section: 'fin' },
        ];
        for (const c of combos) {
          const bundleId = `${c.grade}_${c.section}`;
          const existingBundle = await getDoc<Record<string, unknown>>(cfg, `library_bundles/${bundleId}`, authObj);
          if (existingBundle && Array.isArray(existingBundle.data.chapters) && existingBundle.data.chapters.length > 0) {
            seeded.skippedExisting += 1;
            continue;
          }
          const chapters = getBundledChapters(c.grade, c.section);
          const chaptersList = chapters.map((ch) => ({
            num: ch.num,
            title: getChapterSectionDefaultTitle(c.grade, c.section, ch.num),
          }));
          const questionsList: Array<{ chapterNum: number; qIndex: number; q: string; a: string; code: boolean }> = [];
          for (const ch of chapters) {
            ch.qs.forEach((q, idx) => {
              questionsList.push({
                chapterNum: ch.num,
                qIndex: idx,
                q: q.q,
                a: q.a,
                code: Boolean(q.code),
              });
            });
          }
          await createDoc(
            cfg,
            'library_bundles',
            bundleId,
            {
              id: bundleId,
              grade: c.grade,
              section: c.section,
              chapters: chaptersList,
              questions: questionsList,
            },
            ['updatedAt'],
            authObj
          );
          seeded.libraryBundles += 1;
        }

        const totalNewWrites = seeded.siteConfig + seeded.polls + seeded.libraryBundles;
        await setDoc(
          cfg,
          'system_migrations/v1_firestore_baseline',
          {
            id: 'v1_firestore_baseline',
            version: 'v1.0',
            status: totalNewWrites > 0 ? 'applied' : 'verified',
            actor: admin.username.slice(0, 160),
            detailsJson: JSON.stringify({ seeded, backupId: backupMeta?.id || null }).slice(0, 3900),
          },
          ['appliedAt'],
          authObj
        ).catch(() => {});

        await logAdminAudit(cfg, admin.idToken, admin.username, 'migrate_legacy_sync', 'firestore', 'v1_firestore_baseline', seeded);
        return jsonResponse(ctx, { ok: true, seeded, backupId: backupMeta?.id || null });
      }

      // ---------- ADMIN ZERO-LOSS LIVE SITE / JSON SNAPSHOT MIGRATION ----------
      if (method === 'POST' && path === '/api/admin/import-live-migration') {
        const limited = await applyRateLimitOr429(ctx, 'admin_live_migration', admin.username, 20, 300);
        if (limited) return limited;

        if (!admin.idToken) {
          return jsonResponse(
            ctx,
            {
              error:
                'الجلسة الحالية دخلت باسم المستخدم وكلمة المرور فقط بدون ربط جلسة Google. من فضلك سجّل الخروج ثم اضغط «دخول الإدارة الآمن بحساب Google» بحساب (3mars7bry@gmail.com) لتنفيذ السحب والدمج في Cloud Firestore.',
              requiresFirebaseLink: true,
            },
            403
          );
        }

        const body = await readJsonBody(request);
        const mode = body.mode === 'import_snapshot' ? 'import_snapshot' : 'pull_remote';
        const dryRun = body.dryRun !== false;

        let rawPayload: Record<string, unknown>;
        let sourceLabel: string;

        if (mode === 'pull_remote') {
          const remoteUrl =
            typeof body.remoteUrl === 'string' && body.remoteUrl.trim()
              ? body.remoteUrl.trim()
              : 'https://crovo-space.ai.studio';
          const remoteUsername = typeof body.remoteUsername === 'string' ? body.remoteUsername.trim() : '';
          const remotePassword = typeof body.remotePassword === 'string' ? body.remotePassword : '';

          if (!remoteUsername || !remotePassword) {
            return jsonResponse(
              ctx,
              {
                error:
                  'اكتب اسم المستخدم وكلمة مرور الإدارة الخاصة بالنسخة المنشورة أولاً (يُستخدمان في الذاكرة فقط ولا يتم حفظهما).',
              },
              400
            );
          }

          try {
            rawPayload = await pullRemoteLiveSnapshot({
              remoteUrl,
              username: remoteUsername,
              password: remotePassword,
            });
            sourceLabel = remoteUrl;
          } catch (pullErr) {
            return jsonResponse(
              ctx,
              { error: pullErr instanceof Error ? pullErr.message : 'تعذر الاتصال بالنسخة المنشورة.' },
              400
            );
          }
        } else {
          const snapshot = body.snapshot;
          if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
            return jsonResponse(ctx, { error: 'ملف النسخة الاحتياطية JSON غير صالح.' }, 400);
          }
          rawPayload = snapshot as Record<string, unknown>;
          sourceLabel =
            typeof body.sourceLabel === 'string' && body.sourceLabel.trim()
              ? body.sourceLabel.trim().slice(0, 120)
              : 'uploaded-snapshot.json';
        }

        if (!dryRun) {
          await createSystemBackupSnapshot(cfg, authObj, 'pre_live_import', admin.username, {
            mode,
            sourceLabel,
          });
        }

        const result = await runLiveFirestoreMerge({
          cfg,
          idToken: admin.idToken,
          mode,
          sourceLabel,
          rawPayload,
          dryRun,
          includeExportedSnapshot: mode === 'pull_remote' && dryRun,
        });

        if (!dryRun) {
          clearPublicReadCache();
          const migrationDocId = `v_live_${Date.now()}`;
          await createDoc(
            cfg,
            'system_migrations',
            migrationDocId,
            {
              id: migrationDocId,
              version: 'live_merge_v1',
              status: 'applied',
              actor: admin.username.slice(0, 160),
              detailsJson: JSON.stringify({
                mode,
                sourceLabel,
                created: result.applied.created,
                mergedOrUpdated: result.applied.mergedOrUpdated,
                errors: result.applied.errors,
              }).slice(0, 3900),
            },
            ['appliedAt'],
            { idToken: admin.idToken }
          ).catch(() => {});

          await logAdminAudit(cfg, admin.idToken, admin.username, 'import_live_migration', 'firestore', mode, {
            sourceLabel,
            remoteUsers: result.remoteCounts.users,
            remoteLikes: result.remoteCounts.toolLikes,
            remoteCopies: result.remoteCounts.totalQuestionCopies,
            created: result.applied.created,
            mergedOrUpdated: result.applied.mergedOrUpdated,
            errors: result.applied.errors,
          }).catch(() => {});
        }

        return jsonResponse(ctx, result);
      }
    }

    return jsonResponse(ctx, { error: 'المسار غير موجود.' }, 404);
  } catch (err) {
    if (err instanceof FirestoreHttpError) {
      if (err.status === 429) {
        return jsonResponse(
          ctx,
          {
            error: `تم تجاوز الحصة اليومية لقراءة أو كتابة Firestore (429 Quota Exceeded). تتجدد الحصة تلقائياً غداً أو يمكنك الترقية إلى خطة Blaze من لوحة Firebase. (${err.message})`,
            code: 'quota_exceeded',
          },
          429
        );
      }
      return jsonResponse(ctx, { error: `Firestore Error (${err.status}): ${err.message}` }, err.status >= 400 ? err.status : 503);
    }
    return jsonResponse(
      ctx,
      { error: err instanceof Error ? err.message : 'حدث خطأ داخلي في الخادم.' },
      500
    );
  }
}

async function dispatchNotificationsFirestore(
  cfg: FirestoreConfig,
  env: Env,
  idToken: string,
  options: {
    mode: 'due' | 'broadcast_next' | 'broadcast_custom';
    triggerType: 'manual' | 'scheduled_3d';
    customTitle?: string;
    customBody?: string;
    customCategory?: 'offer' | 'service' | 'update';
  }
) {
  const cfgDoc = await getDoc<Record<string, unknown>>(cfg, 'site_config/public', { idToken });
  const siteCfg = mergeSiteConfig(cfgDoc?.data || null, env);
  if (options.mode === 'due' && !siteCfg.notificationsEnabled) {
    return { skippedDisabled: true, eligibleCount: 0, sentCount: 0, failedCount: 0, removedExpired: 0 };
  }

  const vapid = await resolveVapidKeys(env);
  if (!vapid) {
    throw new Error('مفاتيح VAPID غير مُعدّة في بيئة الإنتاج. أضف VAPID_PUBLIC_KEY و VAPID_PRIVATE_KEY.');
  }

  const allSubs = await listCollection<Record<string, unknown>>(cfg, 'push_subscriptions', { idToken }, {
    pageSize: 300,
    maxDocs: 1000,
  });

  const intervalMs = siteCfg.notificationsIntervalDays * 24 * 60 * 60 * 1000;
  const dueCutoffMs = Date.now() - intervalMs;

  const eligibleSubs = allSubs.filter((s) => {
    if (s.data.enabled !== true) return false;
    if (options.mode !== 'due') return true;
    const lastSent = typeof s.data.lastSentAt === 'string' ? Date.parse(s.data.lastSentAt) : 0;
    return !lastSent || lastSent <= dueCutoffMs;
  });

  if (eligibleSubs.length === 0) {
    return { eligibleCount: 0, sentCount: 0, failedCount: 0, removedExpired: 0 };
  }

  let sentCount = 0;
  let failedCount = 0;
  let removedExpired = 0;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < eligibleSubs.length; i++) {
    const subDoc = eligibleSubs[i];
    const template =
      options.mode === 'broadcast_custom' && options.customTitle && options.customBody
        ? {
            id: `custom_${Date.now()}`,
            category: options.customCategory || 'offer',
            title: options.customTitle,
            body: options.customBody,
            url: '/?offer=1',
          }
        : pickNextTemplateForSubscriber(
            typeof subDoc.data.lastMessageId === 'string' ? subDoc.data.lastMessageId : null,
            i
          );

    try {
      const sendRes = await sendWebPushMessage(
        {
          endpoint: String(subDoc.data.endpoint || ''),
          p256dh: String(subDoc.data.p256dh || ''),
          auth: String(subDoc.data.auth || ''),
        },
        {
          title: template.title,
          body: template.body,
          url: template.url,
          tag: `crovo-${template.id}`,
        },
        vapid
      );

      if (sendRes.ok) {
        sentCount += 1;
        await patchDoc(
          cfg,
          `push_subscriptions/${subDoc.id}`,
          { lastSentAt: nowIso, lastMessageId: template.id, lastError: '' },
          ['lastSentAt', 'lastMessageId', 'lastError', 'updatedAt'],
          ['updatedAt'],
          { idToken },
          true
        ).catch(() => {});
      } else if (sendRes.expired) {
        removedExpired += 1;
        await deleteDoc(cfg, `push_subscriptions/${subDoc.id}`, { idToken }).catch(() => {});
      } else {
        failedCount += 1;
        await patchDoc(
          cfg,
          `push_subscriptions/${subDoc.id}`,
          { lastError: (sendRes.error || 'Push error').slice(0, 240) },
          ['lastError', 'updatedAt'],
          ['updatedAt'],
          { idToken },
          true
        ).catch(() => {});
      }
    } catch (err) {
      failedCount += 1;
      await patchDoc(
        cfg,
        `push_subscriptions/${subDoc.id}`,
        { lastError: (err instanceof Error ? err.message : 'Push error').slice(0, 240) },
        ['lastError', 'updatedAt'],
        ['updatedAt'],
        { idToken },
        true
      ).catch(() => {});
    }
  }

  const logId = generateId('nlog');
  await createDoc(
    cfg,
    'notification_logs',
    logId,
    {
      id: logId,
      messageId: options.mode === 'broadcast_custom' ? 'custom' : 'rotation',
      category: options.customCategory || 'offer',
      title: options.customTitle || 'إشعار مجدول من CROVO SPACE',
      body: options.customBody || `تم الإرسال إلى ${sentCount} مشترك`,
      sentCount,
      failedCount,
      triggerType: options.triggerType,
    },
    ['createdAt'],
    { idToken }
  ).catch(() => {});

  return {
    eligibleCount: eligibleSubs.length,
    sentCount,
    failedCount,
    removedExpired,
  };
}
