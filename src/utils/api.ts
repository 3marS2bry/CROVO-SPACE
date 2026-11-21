import type { ClientPricingConfig, OrderGrade, PlatformChoice, QureoSectionChoice } from './rules';
import type { AcademicGrade, Chapter, SectionType } from '../types';
import { getFirebaseIdToken, getFirebaseIdTokenIfReady } from './cloudStore';
import { classifyApiError, type ApiErrorKind } from './errorClassifier';

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

const VISITOR_TOKEN_STORAGE_KEY = 'crovo_visitor_token';
const OFFLINE_QUEUE_STORAGE_KEY = 'crovo_offline_queue';

export type DbStatusState = 'ok' | 'auth_required' | 'quota_exceeded' | 'error';

export interface AuthUser {
  id: string;
  serialNumber?: string | null;
  name: string;
  email: string;
  grade: 'bac1' | 'bac2';
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  suspendReason?: string | null;
}

export interface ToolVideoConfig {
  id: string;
  tag: string;
  title: string;
  description: string;
  src: string;
  visible: boolean;
}

export interface ToolServiceConfig {
  key: string;
  name: string;
  grade: string;
  description: string;
  isVisible: boolean;
}

export type AdWorkflowStatus = 'draft' | 'preview' | 'approved' | 'published' | 'archived';

export interface LibraryAdDraftConfig {
  title: string;
  subtitle: string;
  priceText: string;
  ctaText: string;
  ctaLink?: string;
  imageUrl?: string;
  delaySeconds?: number;
  cooldownHours?: number;
  templateMode?: 'classic' | 'rich_crovo';
  workflowStatus: AdWorkflowStatus;
  updatedAt?: string;
}

export interface PublicConfig extends ClientPricingConfig {
  ordersEnabled: boolean;
  pollClosed: boolean;
  offerActive: boolean;
  serverTime: string;
  libraryAd: {
    enabled: boolean;
    title: string;
    subtitle: string;
    priceText: string;
    ctaText: string;
    ctaLink?: string;
    imageUrl?: string;
    delaySeconds?: number;
    cooldownHours?: number;
    templateMode?: 'classic' | 'rich_crovo';
    workflowStatus?: AdWorkflowStatus;
    draft?: LibraryAdDraftConfig | null;
  };
  heroPromo: {
    enabled: boolean;
    title: string;
    subtitle: string;
  };
  promoBanner?: {
    enabled: boolean;
    text: string;
  };
  notificationsEnabled: boolean;
  notificationsIntervalDays: number;
  adminWhatsappDisplay: string;
  toolVideos?: ToolVideoConfig[];
  toolServices?: ToolServiceConfig[];
  quotaDegraded?: boolean;
}

export interface CommentItem {
  id: string;
  authorName: string;
  grade: string;
  rating: number;
  content: string;
  avatarUrl: string | null;
  attachmentUrl: string | null;
  attachmentBeforeUrl?: string | null;
  attachmentAfterUrl?: string | null;
  contactPhone: string | null;
  showContactPublicly: boolean;
  isVerified: boolean;
  isOwner: boolean;
  likesCount: number;
  hasLiked: boolean;
  createdAt: string;
  updatedAt: string | null;
  source?: 'cloud' | 'api';
}

export interface PollOptionState {
  key: string;
  label: string;
  count: number;
  percent: number;
}

export interface PollState {
  pollId?: string;
  question?: string;
  closed: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  requiresAuth?: boolean;
  totalVotes: number;
  extendCount: number;
  enoughCount: number;
  extendPercent: number;
  enoughPercent: number;
  userChoice: string | null;
  options?: PollOptionState[];
  quotaDegraded?: boolean;
}

export interface LikesState {
  itemKey: string;
  count: number;
  liked: boolean;
  quotaDegraded?: boolean;
}

export interface QuestionStatsResponse {
  totalCopies: number;
  copyCounts: Record<string, number>;
  topQuestions: Array<{
    questionKey: string;
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qIndex: number;
    questionTitle: string;
    copyCount: number;
  }>;
  quotaDegraded?: boolean;
}

export type OrderPaymentStatus = 'pending_verification' | 'paid' | 'unpaid' | 'refunded';
export type OrderSubscriptionStatus = 'pending_confirmation' | 'active' | 'expired' | 'cancelled';

export interface OrderChangeLogEntry {
  at: string;
  by: string;
  fromStatus: string | null;
  toStatus: string;
  paymentStatus?: string;
  subscriptionStatus?: string;
  note?: string;
}

export interface OrderReceipt {
  id: string;
  orderCode: string;
  fullName: string;
  grade: OrderGrade;
  platformLabel: string;
  sectionDetails: string;
  oldPrice: number;
  finalPrice: number;
  offerApplied: boolean;
  paymentMethod: string;
  status: 'new' | 'reviewing' | 'completed' | 'cancelled';
  paymentStatus?: OrderPaymentStatus;
  subscriptionStatus?: OrderSubscriptionStatus;
  serverRecorded?: boolean;
  createdAt: string;
}

export interface CreateOrderResponse {
  deduplicated: boolean;
  savedToServer?: boolean;
  pendingManualConfirmation?: boolean;
  dbSaveStatus?: 'saved' | 'quota_exceeded' | 'db_error' | 'timeout' | 'offline';
  order: OrderReceipt;
}

export interface AdminAnalyticsResponse {
  range: string;
  from: string;
  to: string;
  trackingStartedAt: string;
  visitors: {
    uniqueVisitors: number;
    prevUniqueVisitors: number;
    totalVisits: number;
    prevTotalVisits: number;
    sessions: number;
  };
  users: {
    totalRegistered: number;
    newInPeriod: number;
    prevNewInPeriod: number;
    activeUsers: number;
    completedSubscribers: number;
    totalOrders: number;
  };
  library: {
    opens: number;
    searches: number;
    zeroResultSearches: number;
    totalCopies: number;
    topLevels: Array<{ grade: string; section: string; chapterNum: number; views: number }>;
    topSearchTerms: Array<{ query: string; count: number; zeroResults: number }>;
  };
  tool: {
    totalRuns: number;
    succeededRuns: number;
    failedRuns: number;
    avgDurationMs: number;
    recentErrors: Array<{
      id: string;
      serviceKey: string;
      errorMessage: string | null;
      createdAt: string;
    }>;
  };
  engagement: {
    totalLikes: number;
    totalComments: number;
    totalPollVotes: number;
  };
  timeline: Array<{
    day: string;
    visits: number;
    uniqueVisitors: number;
    libraryOpens: number;
    searches: number;
  }>;
  dbStatus?: DbStatusState;
  dbError?: string | null;
  staleSnapshot?: boolean;
  requiresFirebaseLink?: boolean;
}

export interface BootstrapResponse {
  config: PublicConfig;
  likes: LikesState;
  library: { grade: AcademicGrade; section: SectionType; chapters: Chapter[] };
  poll: PollState;
  comments: CommentItem[];
  questionStats: QuestionStatsResponse;
  quotaDegraded?: boolean;
}

export interface AdminUserItem {
  id: string;
  serialNumber?: string | null;
  name: string;
  email: string;
  grade: 'bac1' | 'bac2' | 'unclassified';
  rawGrade?: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  suspendReason: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  reviewsCount: number;
  votesCount: number;
  completedOrdersCount: number;
}

export interface AdminPollItem {
  id: string;
  slug: string;
  question: string;
  isOpen: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  totalVotes: number;
  options: Array<{ key: string; label: string; sortOrder: number; votes: number; percent: number }>;
}

export interface AdminAuditLogItem {
  id: string;
  actorUsername: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detailsJson: string | null;
  createdAt: string;
}

export interface LiveMigrationResponse {
  ok: boolean;
  dryRun: boolean;
  mode: 'pull_remote' | 'import_snapshot';
  sourceLabel: string;
  remoteCounts: {
    users: number;
    orders: number;
    comments: number;
    questionStats: number;
    questionReports: number;
    polls: number;
    toolLikes: number;
    totalQuestionCopies: number;
    totalVisits: number;
    uniqueVisitors: number;
    dailyAnalyticsDays: number;
    analyticsEvents: number;
    pushSubscriptions: number;
    notificationLogs: number;
    toolRuns: number;
  };
  currentFirestoreCounts: {
    users: number;
    orders: number;
    comments: number;
    questionStats: number;
    toolLikes: number;
    totalQuestionCopies: number;
    pollVotes: number;
    dailyAnalyticsDays: number;
    pushSubscriptions: number;
  };
  applied: {
    created: number;
    mergedOrUpdated: number;
    skippedExisting: number;
    errors: number;
    errorSamples: string[];
  };
  exportedSnapshot?: Record<string, unknown>;
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage quota/privacy mode errors
  }
}

export function getStoredVisitorToken(): string | null {
  return readStorage(VISITOR_TOKEN_STORAGE_KEY);
}

interface QueuedTelemetryEvent {
  url: string;
  body: string;
  queuedAt: number;
}

function readOfflineQueue(): QueuedTelemetryEvent[] {
  const raw = readStorage(OFFLINE_QUEUE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-30) : [];
  } catch {
    return [];
  }
}

function enqueueOfflineEvent(url: string, body: string): void {
  const queue = readOfflineQueue();
  queue.push({ url, body, queuedAt: Date.now() });
  writeStorage(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(-30)));
}

let flushingQueue = false;
async function flushOfflineQueue(): Promise<void> {
  if (flushingQueue || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  const queue = readOfflineQueue();
  if (queue.length === 0) return;
  flushingQueue = true;
  try {
    const remaining: QueuedTelemetryEvent[] = [];
    const idToken = await getFirebaseIdToken();
    const visitorToken = readStorage(VISITOR_TOKEN_STORAGE_KEY);
    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i];
      if (Date.now() - item.queuedAt > 7 * 86_400_000) continue;
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (visitorToken) headers['X-Crovo-Visitor'] = visitorToken;
        if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
        const res = await fetch(item.url, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: item.body,
        });
        if (!res.ok && res.status >= 500) {
          remaining.push(item);
        }
      } catch {
        remaining.push(...queue.slice(i));
        break;
      }
    }
    writeStorage(
      OFFLINE_QUEUE_STORAGE_KEY,
      remaining.length > 0 ? JSON.stringify(remaining.slice(-30)) : null
    );
  } finally {
    flushingQueue = false;
  }
}

if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem('crovo_user_token');
    window.localStorage.removeItem('crovo_admin_token');
  } catch {
    // ignore storage errors
  }
  window.addEventListener('online', () => {
    void flushOfflineQueue();
  });
}

export class ApiError extends Error {
  status: number;
  requiresAuth?: boolean;
  kind: ApiErrorKind;
  retryable: boolean;
  constructor(message: string, status: number, requiresAuth?: boolean, kind?: ApiErrorKind, retryable = false) {
    super(message);
    this.status = status;
    this.requiresAuth = requiresAuth;
    this.kind = kind || classifyApiError(status, message).kind;
    this.retryable = retryable;
  }
}

const inflightGets = new Map<string, Promise<unknown>>();

export function notifyLikesUpdated(detail: LikesState): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('crovo:likes-updated', { detail }));
  }
}

export function notifyAuthUpdated(user: AuthUser | null): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('crovo:auth-updated', { detail: user }));
  }
}

function isPublicFastEndpoint(url: string): boolean {
  const path = url.split('?')[0];
  return (
    path === '/api/bootstrap' ||
    path === '/api/config' ||
    path === '/api/library' ||
    path === '/api/questions/stats' ||
    path === '/api/questions/copy' ||
    path === '/api/comments' ||
    path === '/api/poll' ||
    path === '/api/likes' ||
    path === '/api/push/vapid-public-key' ||
    path === '/api/push/status' ||
    path === '/api/analytics/event' ||
    path === '/api/push/log-error'
  );
}

async function apiFetch<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const canDedupe = method === 'GET' && !init?.signal;

  if (canDedupe && inflightGets.has(url)) {
    return inflightGets.get(url) as Promise<T>;
  }

  const execute = async (): Promise<T> => {
    const extraHeaders: Record<string, string> = {};
    const visitorToken = readStorage(VISITOR_TOKEN_STORAGE_KEY);
    const hasCustomAuthHeader = Boolean(
      init?.headers &&
        typeof init.headers === 'object' &&
        !Array.isArray(init.headers) &&
        ('Authorization' in init.headers || 'authorization' in init.headers)
    );
    const idToken = hasCustomAuthHeader
      ? null
      : isPublicFastEndpoint(url) && method === 'GET'
      ? await getFirebaseIdTokenIfReady()
      : isPublicFastEndpoint(url) && (url.startsWith('/api/analytics/') || url.startsWith('/api/push/') || url === '/api/questions/copy')
      ? await getFirebaseIdTokenIfReady()
      : await getFirebaseIdToken();

    if (visitorToken) extraHeaders['X-Crovo-Visitor'] = visitorToken;
    if (idToken) extraHeaders['Authorization'] = `Bearer ${idToken}`;

    const timeoutMs = typeof init?.timeoutMs === 'number' ? init.timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
    const timeoutCtrl = !init?.signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = timeoutCtrl ? setTimeout(() => timeoutCtrl.abort(), timeoutMs) : null;

    let response: Response;
    try {
      const { timeoutMs: _t, ...fetchInit } = init || {};
      response = await fetch(url, {
        credentials: 'include',
        ...fetchInit,
        signal: init?.signal || timeoutCtrl?.signal,
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
          ...(init?.headers || {}),
        },
      });
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (init?.signal?.aborted) {
          throw err;
        }
        const classified = classifyApiError(408, 'Request timed out');
        throw new ApiError(classified.userMessage, 408, false, 'timeout_error', true);
      }
      const classified = classifyApiError(0, err instanceof Error ? err.message : 'Network error');
      throw new ApiError(classified.userMessage, 0, false, classified.kind, classified.retryable);
    }
    if (timer) clearTimeout(timer);

    const returnedVisitorToken = response.headers.get('X-Crovo-Visitor-Token');
    if (returnedVisitorToken) {
      writeStorage(VISITOR_TOKEN_STORAGE_KEY, returnedVisitorToken);
    }

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON response
    }

    if (!response.ok) {
      const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      const rawErrMsg =
        obj && typeof obj.error === 'string'
          ? obj.error
          : `حدث خطأ غير متوقع (${response.status}).`;
      const classified = classifyApiError(response.status, rawErrMsg);
      const userFriendly =
        obj && typeof obj.error === 'string' && response.status < 500 && classified.kind !== 'quota_exceeded'
          ? obj.error
          : classified.userMessage;
      throw new ApiError(
        userFriendly,
        response.status,
        Boolean(obj?.requiresAuth),
        classified.kind,
        classified.retryable
      );
    }

    return data as T;
  };

  if (canDedupe) {
    const promise = execute().finally(() => {
      inflightGets.delete(url);
    });
    inflightGets.set(url, promise);
    return promise;
  }

  return execute();
}

export const api = {
  // User Account Auth (Firebase Authentication Only)
  authMe: () => apiFetch<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/me'),

  authCloudSync: async (payload: {
    idToken: string;
    name?: string;
    grade?: 'bac1' | 'bac2';
    serialNumber?: string | null;
  }) => {
    const res = await apiFetch<{ ok: boolean; token?: string; user: AuthUser }>('/api/auth/cloud-sync', {
      method: 'POST',
      headers: payload.idToken ? { Authorization: `Bearer ${payload.idToken}` } : undefined,
      body: JSON.stringify(payload),
    });
    notifyAuthUpdated(res.user);
    return res;
  },

  authLogout: async () => {
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      notifyAuthUpdated(null);
    }
  },

  // Public Config, Dynamic Library & Batched Bootstrap
  getBootstrap: (grade: AcademicGrade, section: SectionType) =>
    apiFetch<BootstrapResponse>(
      `/api/bootstrap?grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section)}`
    ),

  getConfig: () => apiFetch<PublicConfig>('/api/config'),

  getLibrary: (grade: AcademicGrade, section: SectionType, signal?: AbortSignal) =>
    apiFetch<{ grade: AcademicGrade; section: SectionType; chapters: Chapter[] }>(
      `/api/library?grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section)}`,
      signal ? { signal } : undefined
    ),

  trackEvent: async (payload: {
    eventType: 'page_view' | 'library_open' | 'level_view' | 'library_search' | 'tool_view';
    sessionId?: string;
    path?: string;
    grade?: AcademicGrade;
    section?: SectionType;
    chapterNum?: number;
    query?: string;
    resultsCount?: number;
  }) => {
    const body = JSON.stringify(payload);
    try {
      return await apiFetch<{ ok: boolean }>('/api/analytics/event', {
        method: 'POST',
        body,
      });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
        enqueueOfflineEvent('/api/analytics/event', body);
      }
      return { ok: false };
    }
  },

  getQuestionStats: () => apiFetch<QuestionStatsResponse>('/api/questions/stats'),

  recordQuestionCopy: (payload: {
    questionKey: string;
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qIndex: number;
    questionTitle: string;
  }) =>
    apiFetch<{ ok: boolean; questionKey: string; copyCount: number }>('/api/questions/copy', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reportQuestionIssue: (payload: {
    questionKey: string;
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qIndex: number;
    questionTitle: string;
    description: string;
    reason?: string;
    suggestedSolution?: string;
  }) =>
    apiFetch<{ ok: boolean; reportId: string; message: string }>('/api/questions/report', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getVapidPublicKey: () =>
    apiFetch<{ publicKey: string; enabled: boolean; intervalDays: number; error?: string }>(
      '/api/push/vapid-public-key'
    ),

  getPushStatus: (endpoint?: string) =>
    apiFetch<{ subscribed: boolean; notificationsEnabled: boolean; intervalDays: number }>(
      '/api/push/status',
      endpoint ? { headers: { 'X-Crovo-Push-Endpoint': endpoint } } : undefined
    ),

  subscribePush: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    apiFetch<{ ok: boolean; subscribed: boolean }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),

  unsubscribePush: (endpoint?: string) =>
    apiFetch<{ ok: boolean; subscribed: boolean }>('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),

  logPushError: async (payload: { stage: string; errorCode: string; detail?: string }) => {
    const body = JSON.stringify(payload);
    try {
      return await apiFetch<{ ok: boolean }>('/api/push/log-error', {
        method: 'POST',
        body,
      });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
        enqueueOfflineEvent('/api/push/log-error', body);
      }
      return { ok: false };
    }
  },

  getComments: () => apiFetch<{ comments: CommentItem[]; quotaDegraded?: boolean }>('/api/comments'),

  createComment: (payload: {
    authorName: string;
    grade: string;
    rating: number;
    content: string;
    contactPhone?: string;
    showContactPublicly?: boolean;
    moderationPending?: boolean;
    orderCode?: string;
    source?: 'standard' | 'post_whatsapp';
    avatarDataUrl?: string | null;
    attachmentDataUrl?: string | null;
    attachmentBeforeDataUrl?: string | null;
    attachmentAfterDataUrl?: string | null;
  }) =>
    apiFetch<{ comment: CommentItem; moderationPending?: boolean; message?: string }>('/api/comments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateComment: (
    id: string,
    payload: {
      authorName?: string;
      grade?: string;
      rating?: number;
      content?: string;
      contactPhone?: string;
      showContactPublicly?: boolean;
    }
  ) =>
    apiFetch<{ ok: boolean; updatedAt: string }>(`/api/comments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteComment: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/comments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  reportComment: (id: string, reason: string) =>
    apiFetch<{ ok: boolean; flaggedForReview: boolean; message: string }>(
      `/api/comments/${encodeURIComponent(id)}/report`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),

  getLikes: (itemKey = 'tool') =>
    apiFetch<LikesState>(`/api/likes?itemKey=${encodeURIComponent(itemKey)}`),

  toggleLike: async (itemKey = 'tool', desiredLiked?: boolean) => {
    const res = await apiFetch<LikesState>('/api/likes/toggle', {
      method: 'POST',
      body: JSON.stringify(
        typeof desiredLiked === 'boolean' ? { itemKey, desiredLiked } : { itemKey }
      ),
    });
    notifyLikesUpdated(res);
    return res;
  },

  getPoll: (pollId?: string) =>
    apiFetch<PollState>(pollId ? `/api/poll?pollId=${encodeURIComponent(pollId)}` : '/api/poll'),

  votePoll: (choice: string, pollId?: string) =>
    apiFetch<PollState>('/api/poll/vote', {
      method: 'POST',
      body: JSON.stringify({ choice, ...(pollId ? { pollId } : {}) }),
    }),

  createOrder: (payload: {
    fullName: string;
    grade: OrderGrade;
    platforms: PlatformChoice[];
    qureoSection?: QureoSectionChoice;
    platformUsername: string;
    platformPassword: string;
    paymentMethod: string;
    clientRequestId: string;
  }) =>
    apiFetch<CreateOrderResponse>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    }),

  // Admin Session (Username/Password + Google/Firebase Auth)
  adminLogin: (username: string, password: string) =>
    apiFetch<{ ok: boolean; username: string; hasFirebaseToken?: boolean }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  adminFirebaseLogin: async (idToken: string) => {
    const res = await apiFetch<{
      ok: boolean;
      username: string;
      user?: AuthUser;
      hasFirebaseToken?: boolean;
      quotaDegraded?: boolean;
    }>(
      '/api/admin/firebase-login',
      {
        method: 'POST',
        headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
        body: JSON.stringify({ idToken }),
      }
    );
    if (res.user) notifyAuthUpdated(res.user);
    return res;
  },

  adminLogout: async () => {
    await apiFetch<{ ok: boolean }>('/api/admin/logout', { method: 'POST' });
  },

  adminMe: () => apiFetch<{ authenticated: boolean; username?: string; hasFirebaseToken?: boolean }>('/api/admin/me'),

  adminOverview: () =>
    apiFetch<{
      dbStatus?: DbStatusState;
      dbError?: string | null;
      staleSnapshot?: boolean;
      orders: Array<{
        id: string;
        orderCode: string;
        userId?: string | null;
        userSerialNumber?: string | null;
        userEmail?: string | null;
        fullName: string;
        grade: OrderGrade;
        platformLabel: string;
        sectionDetails: string;
        platformUsername: string;
        platformPassword: string | null;
        credentialsPurged: boolean;
        oldPrice: number;
        finalPrice: number;
        offerApplied: boolean;
        paymentMethod: string;
        status: 'new' | 'reviewing' | 'completed' | 'cancelled';
        paymentStatus?: OrderPaymentStatus;
        subscriptionStatus?: OrderSubscriptionStatus;
        source?: string;
        adminNote?: string | null;
        changeLog?: OrderChangeLogEntry[];
        createdAt: string;
        updatedAt: string | null;
      }>;
      comments: Array<{
        id: string;
        authorName: string;
        grade: string;
        rating: number;
        content: string;
        avatarUrl: string | null;
        attachmentUrl: string | null;
        attachmentBeforeUrl?: string | null;
        attachmentAfterUrl?: string | null;
        contactPhone: string | null;
        showContactPublicly: boolean;
        isVerified: boolean;
        status: 'approved' | 'pending' | 'hidden' | 'flagged';
        orderCode?: string | null;
        source?: string;
        likesCount?: number;
        reportsCount: number;
        reports: Array<{ reason: string; createdAt: string }>;
        createdAt: string;
      }>;
      questionReports: Array<{
        id: string;
        questionKey: string;
        grade: 'bac1' | 'bac2';
        section: 'js' | 'py' | 'fin';
        chapterNum: number;
        qIndex: number;
        questionTitle: string;
        description: string;
        reason?: string | null;
        suggestedSolution?: string | null;
        status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
        adminNote: string | null;
        createdAt: string;
        updatedAt: string | null;
      }>;
      poll: PollState;
      likes: Array<{ itemKey: string; count: number }>;
      config: PublicConfig;
      analytics?: AdminAnalyticsResponse;
      stats: {
        totalCopies: number;
        topQuestions: Array<{
          questionKey: string;
          grade: string;
          section: string;
          chapterNum: number;
          qIndex: number;
          questionTitle: string;
          copyCount: number;
          lastCopiedAt: string;
        }>;
        pendingQuestionReports: number;
        pushActiveCount: number;
        pushTotalCount: number;
        dbIntegrity: { ok: boolean; detail: string; counts?: Record<string, number> };
        backups: Array<{
          filename: string;
          reason?: string;
          actor?: string;
          sizeBytes: number;
          createdAt: string;
        }>;
        migrations?: Array<{
          id: string;
          version: string;
          status: string;
          actor: string;
          appliedAt: string;
        }>;
        isEphemeralStorageNotice: string;
        requiresFirebaseLink?: boolean;
      };
      notifications: {
        enabled: boolean;
        intervalDays: number;
        templates: Array<{
          id: string;
          category: 'offer' | 'service' | 'update';
          title: string;
          body: string;
          url: string;
        }>;
        logs: Array<{
          id: string;
          messageId: string;
          category: string;
          title: string;
          body: string;
          sentCount: number;
          failedCount: number;
          triggerType: string;
          errorDetail?: string | null;
          createdAt: string;
        }>;
      };
    }>('/api/admin/overview'),

  adminAnalytics: (range = '7d', from?: string, to?: string) => {
    const params = new URLSearchParams({ range });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return apiFetch<AdminAnalyticsResponse>(`/api/admin/analytics?${params.toString()}`);
  },

  adminUsers: (params?: {
    q?: string;
    role?: string;
    status?: string;
    grade?: string;
    sort?: 'newest' | 'oldest';
    page?: number;
    pageSize?: number;
    all?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.role) qs.set('role', params.role);
    if (params?.status) qs.set('status', params.status);
    if (params?.grade) qs.set('grade', params.grade);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.all) qs.set('all', '1');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{
      users: AdminUserItem[];
      page?: number;
      pageSize?: number;
      totalMatching?: number;
      totalPages?: number;
      counts?: { total: number; bac1: number; bac2: number; unclassified: number };
      dbStatus?: DbStatusState;
      dbError?: string | null;
      staleSnapshot?: boolean;
      requiresFirebaseLink?: boolean;
    }>(`/api/admin/users${suffix}`);
  },

  adminUpdateUser: (
    id: string,
    payload: {
      role?: 'user' | 'admin';
      status?: 'active' | 'suspended';
      grade?: 'bac1' | 'bac2';
      suspendReason?: string;
    }
  ) =>
    apiFetch<{ ok: boolean; user: Partial<AdminUserItem> }>(
      `/api/admin/users/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  adminUserActivity: (id: string) =>
    apiFetch<{
      user: AdminUserItem;
      reviews: Array<{ id: string; content: string; rating: number; status: string; createdAt: string }>;
      votes: Array<{ pollId: string; question: string; optionKey: string; createdAt: string }>;
      orders: Array<{ id: string; orderCode: string; platformLabel: string; finalPrice: number; status: string; createdAt: string }>;
      toolRuns: Array<{ id: string; serviceKey: string; status: string; durationMs: number; errorMessage: string | null; createdAt: string }>;
      activities: Array<{
        id: string;
        eventType: string;
        path: string | null;
        grade: string | null;
        section: string | null;
        chapterNum: number | null;
        query: string | null;
        resultsCount: number | null;
        metaJson: string | null;
        createdAt: string;
      }>;
    }>(`/api/admin/users/${encodeURIComponent(id)}/activity`),

  adminLibrary: (params?: { grade?: string; section?: string; q?: string; incomplete?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.grade) qs.set('grade', params.grade);
    if (params?.section) qs.set('section', params.section);
    if (params?.q) qs.set('q', params.q);
    if (params?.incomplete) qs.set('incomplete', '1');
    return apiFetch<{
      chapters: Array<{
        id: string;
        grade: string;
        section: string;
        chapterNum: number;
        title: string;
        sortOrder: number;
        updatedAt: string;
        updatedBy: string | null;
      }>;
      questions: Array<{
        id: string;
        chapterId: string;
        grade: 'bac1' | 'bac2';
        section: 'js' | 'py' | 'fin';
        chapterNum: number;
        qIndex: number;
        qText: string;
        aText: string;
        isCode: boolean;
        isIncomplete: boolean;
        updatedAt: string;
        updatedBy: string | null;
      }>;
      totalMatching: number;
    }>(`/api/admin/library?${qs.toString()}`);
  },

  adminCreateLibraryQuestion: (payload: {
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qText: string;
    aText: string;
    isCode: boolean;
  }) =>
    apiFetch<{ ok: boolean; id: string }>('/api/admin/library/questions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdateLibraryQuestion: (
    id: string,
    payload: { qText?: string; aText?: string; isCode?: boolean; qIndex?: number }
  ) =>
    apiFetch<{ ok: boolean; updatedAt: string }>(
      `/api/admin/library/questions/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  adminDeleteLibraryQuestion: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/library/questions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  adminExportLibrary: () => apiFetch<Record<string, unknown>>('/api/admin/library/export'),

  adminImportLibrary: (questions: Array<Record<string, unknown>>) =>
    apiFetch<{ ok: boolean; importedCount: number }>('/api/admin/library/import', {
      method: 'POST',
      body: JSON.stringify({ questions }),
    }),

  adminToolOverview: () =>
    apiFetch<{
      services: ToolServiceConfig[];
      videos: ToolVideoConfig[];
      summary: { totalRuns: number; succeededRuns: number; failedRuns: number; avgDurationMs: number };
      recentRuns: Array<{
        id: string;
        userId: string | null;
        serviceKey: string;
        status: string;
        durationMs: number;
        errorMessage: string | null;
        createdAt: string;
      }>;
    }>('/api/admin/tool'),

  adminUpdateToolService: (
    key: string,
    payload: { name?: string; description?: string; isVisible?: boolean }
  ) =>
    apiFetch<{ ok: boolean }>(`/api/admin/tool/services/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminUpdateToolVideos: (videos: ToolVideoConfig[]) =>
    apiFetch<{ ok: boolean; videos: ToolVideoConfig[] }>('/api/admin/tool/videos', {
      method: 'PUT',
      body: JSON.stringify({ videos }),
    }),

  adminUploadAdImage: (imageDataUrl: string) =>
    apiFetch<{ ok: boolean; imageUrl: string }>('/api/admin/ad-image', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl }),
    }),

  adminPolls: () => apiFetch<{ polls: AdminPollItem[] }>('/api/admin/polls'),

  adminCreatePoll: (payload: {
    question: string;
    options: string[];
    startsAt?: string | null;
    endsAt?: string | null;
  }) =>
    apiFetch<{ ok: boolean; id: string }>('/api/admin/polls', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdatePoll: (
    id: string,
    payload: {
      question?: string;
      isOpen?: boolean;
      startsAt?: string | null;
      endsAt?: string | null;
      options?: Array<{ key: string; label: string }>;
    }
  ) =>
    apiFetch<{ ok: boolean }>(`/api/admin/polls/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminExportPollJson: (id: string) =>
    apiFetch<Record<string, unknown>>(`/api/admin/polls/${encodeURIComponent(id)}/export`),

  adminAuditLogs: () => apiFetch<{ logs: AdminAuditLogItem[] }>('/api/admin/audit-logs'),

  adminCreateManualOrder: (payload: {
    orderCode?: string;
    fullName: string;
    grade: OrderGrade;
    platforms: PlatformChoice[];
    platformUsername: string;
    paymentMethod?: string;
    finalPrice?: number;
    status?: 'new' | 'reviewing' | 'completed' | 'cancelled';
    paymentStatus?: OrderPaymentStatus;
    subscriptionStatus?: OrderSubscriptionStatus;
    adminNote?: string;
  }) =>
    apiFetch<{ ok: boolean; order: OrderReceipt }>('/api/admin/orders/manual', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdateOrder: (
    id: string,
    payload: {
      status?: 'new' | 'reviewing' | 'completed' | 'cancelled';
      expectedCurrentStatus?: string;
      paymentStatus?: OrderPaymentStatus;
      subscriptionStatus?: OrderSubscriptionStatus;
      adminNote?: string;
      purgeCredentials?: boolean;
    }
  ) =>
    apiFetch<{
      ok: boolean;
      status: string;
      paymentStatus?: OrderPaymentStatus;
      subscriptionStatus?: OrderSubscriptionStatus;
      adminNote?: string | null;
      changeLog?: OrderChangeLogEntry[];
      credentialsPurged: boolean;
    }>(
      `/api/admin/orders/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  adminDeleteOrder: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/orders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  adminUpdateComment: (
    id: string,
    payload: { isVerified?: boolean; status?: 'approved' | 'pending' | 'hidden' | 'flagged'; clearReports?: boolean }
  ) =>
    apiFetch<{ ok: boolean }>(`/api/admin/comments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminDeleteComment: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/comments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  adminUpdateQuestionReport: (
    id: string,
    payload: { status?: 'pending' | 'reviewed' | 'resolved' | 'dismissed'; adminNote?: string }
  ) =>
    apiFetch<{ ok: boolean; status: string }>(
      `/api/admin/question-reports/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  adminSendPush: (payload: {
    mode: 'due' | 'broadcast_next' | 'broadcast_custom';
    title?: string;
    body?: string;
    category?: 'offer' | 'service' | 'update';
  }) =>
    apiFetch<{
      ok: boolean;
      result: {
        skippedDisabled?: boolean;
        eligibleCount: number;
        sentCount: number;
        failedCount: number;
        removedExpired: number;
      };
    }>('/api/admin/push/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminCreateBackup: () =>
    apiFetch<{
      ok: boolean;
      backup: { filename: string; sizeBytes: number; createdAt: string };
      backups: Array<{ filename: string; sizeBytes: number; createdAt: string }>;
      snapshot?: Record<string, unknown>;
    }>('/api/admin/backup', {
      method: 'POST',
    }),

  adminMigrateLegacy: () =>
    apiFetch<{ ok: boolean; seeded: Record<string, number>; backupId?: string | null }>(
      '/api/admin/migrate-legacy',
      {
        method: 'POST',
      }
    ),

  adminImportLiveMigration: (payload: {
    mode: 'pull_remote' | 'import_snapshot';
    dryRun: boolean;
    remoteUrl?: string;
    remoteUsername?: string;
    remotePassword?: string;
    snapshot?: Record<string, unknown>;
    sourceLabel?: string;
  }) =>
    apiFetch<LiveMigrationResponse>('/api/admin/import-live-migration', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminResetPoll: (pollId = 'poll_extend_offer') =>
    apiFetch<{ ok: boolean; poll: PollState }>('/api/admin/poll/reset', {
      method: 'POST',
      body: JSON.stringify({ pollId }),
    }),

  adminUpdateSettings: (payload: Record<string, unknown> & { resetToRegularPrices?: boolean }) =>
    apiFetch<{ ok: boolean; config: PublicConfig }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};
