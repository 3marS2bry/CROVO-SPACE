import {
  type CommitWriteInput,
  type FirestoreAuth,
  type FirestoreConfig,
  type FirestoreDoc,
  commitWrites,
  getDoc,
  listCollection,
  setDoc,
} from './firestoreRest.ts';
import { buildDefaultSiteConfig, DEFAULT_TOOL_SERVICES, DEFAULT_TOOL_VIDEOS } from './defaults.ts';

export interface LiveMigrationPreviewCounts {
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
}

export interface LiveMigrationResult {
  ok: boolean;
  dryRun: boolean;
  mode: 'pull_remote' | 'import_snapshot';
  sourceLabel: string;
  remoteCounts: LiveMigrationPreviewCounts;
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

function normalizeUid(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.startsWith('fb_') && s.length > 3 ? s.slice(3) : s;
}

function safeValidId(raw: unknown, prefix: string, index: number, minLen = 4, maxLen = 80): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, maxLen);
  if (cleaned.length >= minLen && VALID_ID_RE.test(cleaned)) return cleaned;
  const padded = `${prefix}_m_${index}_${cleaned}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLen);
  return padded.length >= minLen ? padded : `${prefix}_mig_${index}`;
}

function parseBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  const s = String(val || '').trim().toLowerCase();
  return s === '1' || s === 'true';
}

function parseIntSafe(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function parseSerialNumeric(serial: unknown): number {
  if (typeof serial !== 'string') return 0;
  const m = serial.trim().match(/^CRV-(\d+)$/i);
  return m ? Number(m[1]) : 0;
}

export function validateSafeRemoteUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('رابط النسخة المنشورة غير صالح.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('يجب أن يبدأ رابط النسخة المنشورة بـ https:// للأمان.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.startsWith('[') ||
    host.includes(':')
  ) {
    throw new Error('لا يُسمح بسحب البيانات من عناوين داخلية أو محلية.');
  }
  return parsed;
}

async function fetchJsonSafe<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('json')) {
      const txt = await res.text();
      try {
        return JSON.parse(txt) as T;
      } catch {
        return null;
      }
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function extractCookiesFromResponse(res: Response): string {
  const headersAny = res.headers as Headers & { getSetCookie?: () => string[] };
  const list: string[] =
    typeof headersAny.getSetCookie === 'function'
      ? headersAny.getSetCookie()
      : res.headers.get('set-cookie')
      ? [res.headers.get('set-cookie') as string]
      : [];

  const pairs: string[] = [];
  for (const entry of list) {
    const first = entry.split(';')[0]?.trim();
    if (first && first.includes('=')) {
      pairs.push(first);
    }
  }
  return pairs.join('; ');
}

export async function pullRemoteLiveSnapshot(params: {
  remoteUrl: string;
  username: string;
  password: string;
}): Promise<Record<string, unknown>> {
  const parsedUrl = validateSafeRemoteUrl(params.remoteUrl);
  const origin = parsedUrl.origin;

  const loginRes = await fetch(`${origin}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: params.username.trim(),
      password: params.password,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!loginRes.ok) {
    const errJson = (await loginRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      errJson.error || `فشل تسجيل الدخول في النسخة المنشورة (${loginRes.status}). تأكد من اسم المستخدم وكلمة المرور.`
    );
  }

  const cookieHeader = extractCookiesFromResponse(loginRes);
  const loginBody = (await loginRes.json().catch(() => ({}))) as { token?: string };
  const authHeaders: Record<string, string> = {};
  if (cookieHeader) authHeaders.Cookie = cookieHeader;
  if (typeof loginBody.token === 'string' && loginBody.token) {
    authHeaders.Authorization = `Bearer ${loginBody.token}`;
  }

  const [backupRes, overviewRes, usersRes, analyticsRes, commentsRes, qStatsRes, pollRes, likesRes, configRes] =
    await Promise.all([
      fetchJsonSafe<Record<string, unknown>>(`${origin}/api/admin/backup`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: '{}',
      }),
      fetchJsonSafe<Record<string, unknown>>(`${origin}/api/admin/overview`, { headers: authHeaders }),
      fetchJsonSafe<Record<string, unknown>>(`${origin}/api/admin/users?limit=2000`, { headers: authHeaders }),
      fetchJsonSafe<Record<string, unknown>>(`${origin}/api/admin/analytics?range=all`, { headers: authHeaders }),
      fetchJsonSafe<Record<string, unknown>>(`${origin}/api/comments`),
      fetchJsonSafe<Record<string, unknown>>(`${origin}/api/questions/stats`),
      fetchJsonSafe<Record<string, unknown>>(`${origin}/api/poll`),
      fetchJsonSafe<Record<string, unknown>>(`${origin}/api/likes?itemKey=tool`),
      fetchJsonSafe<Record<string, unknown>>(`${origin}/api/config`),
    ]);

  let downloadedBackup: Record<string, unknown> | null = null;
  const filename =
    backupRes &&
    typeof backupRes.backup === 'object' &&
    backupRes.backup &&
    typeof (backupRes.backup as { filename?: unknown }).filename === 'string'
      ? String((backupRes.backup as { filename?: string }).filename)
      : null;

  if (backupRes && (backupRes.snapshot || backupRes.data || backupRes.collections)) {
    downloadedBackup = backupRes;
  } else if (filename) {
    const dl1 = await fetchJsonSafe<Record<string, unknown>>(
      `${origin}/api/admin/backups/${encodeURIComponent(filename)}`,
      { headers: authHeaders }
    );
    const dl2 = dl1
      ? dl1
      : await fetchJsonSafe<Record<string, unknown>>(
          `${origin}/api/admin/backup/${encodeURIComponent(filename)}`,
          { headers: authHeaders }
        );
    if (dl2) downloadedBackup = dl2;
  }

  if (!overviewRes && !usersRes && !downloadedBackup && !qStatsRes) {
    throw new Error('تعذر قراءة بيانات النسخة المنشورة. تحقق من الرابط وصلاحيات الجلسة.');
  }

  return {
    pulledAt: new Date().toISOString(),
    sourceOrigin: origin,
    backup: downloadedBackup || backupRes || null,
    overview: overviewRes || null,
    usersEndpoint: usersRes || null,
    analyticsEndpoint: analyticsRes || null,
    commentsEndpoint: commentsRes || null,
    questionStatsEndpoint: qStatsRes || null,
    pollEndpoint: pollRes || null,
    likesEndpoint: likesRes || null,
    configEndpoint: configRes || null,
  };
}

interface NormalizedBundle {
  users: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  questionStats: Array<{
    questionKey: string;
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qIndex: number;
    questionTitle: string;
    copyCount: number;
  }>;
  questionReports: Array<Record<string, unknown>>;
  polls: Array<{
    id: string;
    question: string;
    isOpen: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
    options: Array<{ key: string; label: string; count: number }>;
    totalVotes: number;
  }>;
  pollVotes: Array<{ pollId: string; userId: string; choice: string }>;
  toolLikesCount: number;
  analyticsEvents: Array<Record<string, unknown>>;
  dailyAnalytics: Array<{
    day: string;
    visits: number;
    uniqueVisitors: number;
    libraryOpens: number;
    searches: number;
  }>;
  reportedTotalVisits: number;
  reportedUniqueVisitors: number;
  pushSubscriptions: Array<Record<string, unknown>>;
  notificationLogs: Array<Record<string, unknown>>;
  toolRuns: Array<Record<string, unknown>>;
  settingsRows: Array<Record<string, unknown>>;
  serviceRows: Array<Record<string, unknown>>;
}

function inferQuestionMeta(questionKey: string, fallback?: Record<string, unknown>) {
  const parts = questionKey.split('-');
  const grade: 'bac1' | 'bac2' =
    fallback?.grade === 'bac2' || parts[0] === 'bac2' ? 'bac2' : 'bac1';
  const rawSec = fallback?.section || parts[1];
  const section: 'js' | 'py' | 'fin' =
    rawSec === 'py' || rawSec === 'fin' ? rawSec : 'js';
  const chFromKey = parts.length >= 3 && /^\d+$/.test(parts[2]) ? Number(parts[2]) + 1 : 1;
  const qFromKey = parts.length >= 4 && /^\d+$/.test(parts[3]) ? Number(parts[3]) : 0;
  const chapterNum = Math.max(1, Math.min(200, parseIntSafe(fallback?.chapterNum ?? fallback?.chapter_num, chFromKey)));
  const qIndex = Math.max(0, Math.min(1000, parseIntSafe(fallback?.qIndex ?? fallback?.q_index, qFromKey)));
  const questionTitle = String(
    fallback?.questionTitle ?? fallback?.question_title ?? `السؤال ${qIndex + 1}`
  ).slice(0, 300);

  return { questionKey, grade, section, chapterNum, qIndex, questionTitle };
}

function asArray(val: unknown): Array<Record<string, unknown>> {
  return Array.isArray(val)
    ? val.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
    : [];
}

function normalizeAnyInput(raw: Record<string, unknown>): NormalizedBundle {
  const backupObj = (raw.backup && typeof raw.backup === 'object' ? raw.backup : raw) as Record<string, unknown>;
  const snapObj = (
    backupObj.snapshot && typeof backupObj.snapshot === 'object' ? backupObj.snapshot : backupObj
  ) as Record<string, unknown>;
  const cols = (
    snapObj.collections && typeof snapObj.collections === 'object'
      ? snapObj.collections
      : snapObj.data && typeof snapObj.data === 'object'
      ? snapObj.data
      : snapObj
  ) as Record<string, unknown>;

  const overview = (raw.overview && typeof raw.overview === 'object' ? raw.overview : {}) as Record<string, unknown>;
  const usersEndpoint = (raw.usersEndpoint && typeof raw.usersEndpoint === 'object' ? raw.usersEndpoint : {}) as Record<string, unknown>;
  const analyticsEndpoint = (raw.analyticsEndpoint && typeof raw.analyticsEndpoint === 'object' ? raw.analyticsEndpoint : {}) as Record<string, unknown>;
  const commentsEndpoint = (raw.commentsEndpoint && typeof raw.commentsEndpoint === 'object' ? raw.commentsEndpoint : {}) as Record<string, unknown>;
  const qStatsEndpoint = (raw.questionStatsEndpoint && typeof raw.questionStatsEndpoint === 'object' ? raw.questionStatsEndpoint : {}) as Record<string, unknown>;
  const pollEndpoint = (raw.pollEndpoint && typeof raw.pollEndpoint === 'object' ? raw.pollEndpoint : {}) as Record<string, unknown>;
  const likesEndpoint = (raw.likesEndpoint && typeof raw.likesEndpoint === 'object' ? raw.likesEndpoint : {}) as Record<string, unknown>;

  // 1. Users (dedupe by UID or email)
  const usersMap = new Map<string, Record<string, unknown>>();
  for (const u of [...asArray(cols.users), ...asArray(usersEndpoint.users)]) {
    const idRaw = u.uid || u.id;
    const emailRaw = String(u.email || '').trim().toLowerCase();
    const key = normalizeUid(idRaw) || emailRaw || `u_${usersMap.size}`;
    const prev = usersMap.get(key) || {};
    usersMap.set(key, { ...prev, ...u });
  }

  // 2. Orders
  const ordersMap = new Map<string, Record<string, unknown>>();
  for (const o of [...asArray(cols.orders), ...asArray(overview.orders)]) {
    const id = String(o.id || o.orderCode || o.order_code || `ord_${ordersMap.size}`);
    const prev = ordersMap.get(id) || {};
    ordersMap.set(id, { ...prev, ...o });
  }

  // 3. Comments
  const commentsMap = new Map<string, Record<string, unknown>>();
  for (const c of [
    ...asArray(cols.comments),
    ...asArray(overview.comments),
    ...asArray(commentsEndpoint.comments),
  ]) {
    const id = String(c.id || `cmt_${commentsMap.size}`);
    const prev = commentsMap.get(id) || {};
    const likes = Math.max(
      parseIntSafe(prev.likesCount ?? prev.likes_count, 0),
      parseIntSafe(c.likesCount ?? c.likes_count, 0)
    );
    commentsMap.set(id, { ...prev, ...c, likesCount: likes });
  }

  // 4. Question stats
  const qStatsMap = new Map<string, NormalizedBundle['questionStats'][number]>();
  const upsertQStat = (key: string, copyCount: number, meta?: Record<string, unknown>) => {
    if (!key || !VALID_ID_RE.test(key)) return;
    const prev = qStatsMap.get(key);
    const inferred = inferQuestionMeta(key, meta);
    qStatsMap.set(key, {
      ...inferred,
      copyCount: Math.max(prev?.copyCount || 0, Math.max(0, copyCount)),
    });
  };
  for (const qs of asArray(cols.question_stats)) {
    const k = String(qs.questionKey || qs.question_key || '');
    upsertQStat(k, parseIntSafe(qs.copyCount ?? qs.copy_count, 0), qs);
  }
  const overviewStats = (overview.stats && typeof overview.stats === 'object' ? overview.stats : {}) as Record<string, unknown>;
  for (const qs of asArray(overviewStats.topQuestions)) {
    const k = String(qs.questionKey || '');
    upsertQStat(k, parseIntSafe(qs.copyCount, 0), qs);
  }
  if (qStatsEndpoint.copyCounts && typeof qStatsEndpoint.copyCounts === 'object') {
    for (const [k, v] of Object.entries(qStatsEndpoint.copyCounts as Record<string, unknown>)) {
      upsertQStat(k, parseIntSafe(v, 0));
    }
  }
  for (const qs of asArray(qStatsEndpoint.topQuestions)) {
    const k = String(qs.questionKey || '');
    upsertQStat(k, parseIntSafe(qs.copyCount, 0), qs);
  }

  // 5. Polls & Votes
  const rawPolls = asArray(cols.polls);
  const rawPollOptions = asArray(cols.poll_options);
  const rawVotes = [...asArray(cols.poll_votes), ...asArray(cols.user_poll_votes)];
  const pollVotes: NormalizedBundle['pollVotes'] = [];
  for (const v of rawVotes) {
    const pollId = String(v.poll_id || v.pollId || 'poll_extend_offer');
    const uid = normalizeUid(v.user_id || v.userId || v.visitor_id || v.visitorId);
    const choice = String(v.option_key || v.choice || '').slice(0, 64);
    if (uid && VALID_ID_RE.test(uid) && choice) {
      pollVotes.push({ pollId, userId: uid, choice });
    }
  }

  const pollsMap = new Map<string, NormalizedBundle['polls'][number]>();
  for (const p of rawPolls) {
    const pollId = String(p.id || 'poll_extend_offer');
    let options: Array<{ key: string; label: string; count: number }> = [];
    if (Array.isArray(p.options)) {
      options = p.options.map((o: Record<string, unknown>, idx: number) => ({
        key: String(o.key || `opt_${idx + 1}`).slice(0, 64),
        label: String(o.label || `خيار ${idx + 1}`).slice(0, 100),
        count: Math.max(0, parseIntSafe(o.count, 0)),
      }));
    } else {
      const opts = rawPollOptions
        .filter((o) => String(o.poll_id || '') === pollId)
        .sort((a, b) => parseIntSafe(a.sort_order) - parseIntSafe(b.sort_order));
      const votesForPoll = pollVotes.filter((v) => v.pollId === pollId);
      const counts = new Map<string, number>();
      for (const v of votesForPoll) counts.set(v.choice, (counts.get(v.choice) || 0) + 1);
      options = opts.map((o, idx) => {
        const key = String(o.option_key || `opt_${idx + 1}`).slice(0, 64);
        return {
          key,
          label: String(o.label || `خيار ${idx + 1}`).slice(0, 100),
          count: counts.get(key) || 0,
        };
      });
    }
    if (options.length >= 2) {
      pollsMap.set(pollId, {
        id: pollId,
        question: String(p.question || 'إيه رأيكم نمد العرض؟').slice(0, 240),
        isOpen: p.isOpen !== undefined ? Boolean(p.isOpen) : parseBool(p.is_open ?? true),
        startsAt: typeof (p.startsAt ?? p.starts_at) === 'string' ? String(p.startsAt ?? p.starts_at) : null,
        endsAt: typeof (p.endsAt ?? p.ends_at) === 'string' ? String(p.endsAt ?? p.ends_at) : null,
        options,
        totalVotes: options.reduce((s, o) => s + o.count, 0),
      });
    }
  }

  for (const pCandidate of [overview.poll, pollEndpoint]) {
    if (pCandidate && typeof pCandidate === 'object') {
      const p = pCandidate as Record<string, unknown>;
      const pollId = String(p.pollId || p.id || 'poll_extend_offer');
      const opts = asArray(p.options).map((o, idx) => ({
        key: String(o.key || `opt_${idx + 1}`).slice(0, 64),
        label: String(o.label || `خيار ${idx + 1}`).slice(0, 100),
        count: Math.max(0, parseIntSafe(o.count, 0)),
      }));
      if (opts.length >= 2) {
        const existing = pollsMap.get(pollId);
        if (!existing) {
          pollsMap.set(pollId, {
            id: pollId,
            question: String(p.question || 'إيه رأيكم نمد العرض؟').slice(0, 240),
            isOpen: p.closed !== true,
            startsAt: typeof p.startsAt === 'string' ? p.startsAt : null,
            endsAt: typeof p.endsAt === 'string' ? p.endsAt : null,
            options: opts,
            totalVotes: opts.reduce((s, o) => s + o.count, 0),
          });
        } else {
          const mergedOpts = existing.options.map((eo) => {
            const match = opts.find((o) => o.key === eo.key);
            return { ...eo, count: Math.max(eo.count, match?.count || 0) };
          });
          existing.options = mergedOpts;
          existing.totalVotes = mergedOpts.reduce((s, o) => s + o.count, 0);
        }
      }
    }
  }

  // 6. Tool likes count
  let toolLikesCount = 0;
  const rawLikesArr = asArray(cols.likes);
  if (rawLikesArr.length > 0) {
    const toolRow = rawLikesArr.find((l) => l.item_key === 'tool' || l.itemKey === 'tool');
    if (toolRow && typeof (toolRow.count ?? toolRow.likes_count) === 'number') {
      toolLikesCount = Math.max(toolLikesCount, parseIntSafe(toolRow.count ?? toolRow.likes_count, 0));
    } else {
      const counted = rawLikesArr.filter((l) => (l.item_key || l.itemKey || 'tool') === 'tool').length;
      toolLikesCount = Math.max(toolLikesCount, counted);
    }
  }
  for (const ovLike of asArray(overview.likes)) {
    if (ovLike.itemKey === 'tool') {
      toolLikesCount = Math.max(toolLikesCount, parseIntSafe(ovLike.count, 0));
    }
  }
  if (typeof likesEndpoint.count === 'number') {
    toolLikesCount = Math.max(toolLikesCount, parseIntSafe(likesEndpoint.count, 0));
  }

  // 7. Analytics Events & Daily Totals
  const analyticsEvents = asArray(cols.analytics_events);
  const dailyMap = new Map<
    string,
    { day: string; visits: number; uniqueVisitors: number; libraryOpens: number; searches: number }
  >();

  const addDailyRow = (row: Record<string, unknown>) => {
    const day = String(row.day || row.id || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const prev = dailyMap.get(day) || { day, visits: 0, uniqueVisitors: 0, libraryOpens: 0, searches: 0 };
    dailyMap.set(day, {
      day,
      visits: Math.max(prev.visits, parseIntSafe(row.visits, 0)),
      uniqueVisitors: Math.max(prev.uniqueVisitors, parseIntSafe(row.uniqueVisitors, 0)),
      libraryOpens: Math.max(prev.libraryOpens, parseIntSafe(row.libraryOpens, 0)),
      searches: Math.max(prev.searches, parseIntSafe(row.searches, 0)),
    });
  };

  for (const d of asArray(cols.analytics_daily)) addDailyRow(d);
  for (const aSource of [analyticsEndpoint, overview.analytics]) {
    if (aSource && typeof aSource === 'object') {
      const aObj = aSource as Record<string, unknown>;
      for (const row of asArray(aObj.timeline)) addDailyRow(row);
    }
  }

  const aVisitors = (
    (analyticsEndpoint.visitors && typeof analyticsEndpoint.visitors === 'object'
      ? analyticsEndpoint.visitors
      : (overview.analytics as Record<string, unknown> | undefined)?.visitors) || {}
  ) as Record<string, unknown>;
  const reportedTotalVisits = Math.max(
    parseIntSafe(aVisitors.totalVisits, 0),
    Array.from(dailyMap.values()).reduce((s, d) => s + d.visits, 0),
    analyticsEvents.filter((e) => (e.eventType || e.event_type) === 'page_view').length
  );
  const reportedUniqueVisitors = Math.max(
    parseIntSafe(aVisitors.uniqueVisitors, 0),
    Array.from(dailyMap.values()).reduce((s, d) => s + d.uniqueVisitors, 0)
  );

  // If remote site reported totalVisits > sum(dailyMap), anchor remaining legacy visits into today/tracking date daily doc
  const dailySumVisits = Array.from(dailyMap.values()).reduce((s, d) => s + d.visits, 0);
  if (reportedTotalVisits > dailySumVisits) {
    const anchorDay = new Date().toISOString().slice(0, 10);
    const prev = dailyMap.get(anchorDay) || {
      day: anchorDay,
      visits: 0,
      uniqueVisitors: 0,
      libraryOpens: 0,
      searches: 0,
    };
    prev.visits += reportedTotalVisits - dailySumVisits;
    prev.uniqueVisitors = Math.max(prev.uniqueVisitors, reportedUniqueVisitors);
    dailyMap.set(anchorDay, prev);
  }

  // 8. Question reports, push subscriptions, notification logs, tool runs
  const questionReports = [...asArray(cols.question_reports), ...asArray(overview.questionReports)];
  const pushSubscriptions = asArray(cols.push_subscriptions);
  const ovNotifs = (overview.notifications && typeof overview.notifications === 'object'
    ? (overview.notifications as Record<string, unknown>).logs
    : []) as unknown[];
  const notificationLogs = [...asArray(cols.notification_logs), ...asArray(ovNotifs)];
  const toolRuns = asArray(cols.tool_runs);

  return {
    users: Array.from(usersMap.values()),
    orders: Array.from(ordersMap.values()),
    comments: Array.from(commentsMap.values()),
    questionStats: Array.from(qStatsMap.values()),
    questionReports,
    polls: Array.from(pollsMap.values()),
    pollVotes,
    toolLikesCount,
    analyticsEvents,
    dailyAnalytics: Array.from(dailyMap.values()),
    reportedTotalVisits,
    reportedUniqueVisitors,
    pushSubscriptions,
    notificationLogs,
    toolRuns,
    settingsRows: asArray(cols.settings),
    serviceRows: asArray(cols.tool_services),
  };
}

async function commitChunkWithFallback(
  cfg: FirestoreConfig,
  writes: CommitWriteInput[],
  auth: FirestoreAuth,
  counters: { applied: number; errors: number; errorSamples: string[] },
  batchSize = 40
): Promise<void> {
  for (let i = 0; i < writes.length; i += batchSize) {
    const chunk = writes.slice(i, i + batchSize);
    try {
      await commitWrites(cfg, chunk, auth);
      counters.applied += chunk.length;
    } catch {
      for (const single of chunk) {
        try {
          await commitWrites(cfg, [single], auth);
          counters.applied += 1;
        } catch (err) {
          counters.errors += 1;
          if (counters.errorSamples.length < 8) {
            counters.errorSamples.push(
              `${single.docPath}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }
    }
  }
}

export async function runLiveFirestoreMerge(params: {
  cfg: FirestoreConfig;
  idToken: string;
  mode: 'pull_remote' | 'import_snapshot';
  sourceLabel: string;
  rawPayload: Record<string, unknown>;
  dryRun: boolean;
  includeExportedSnapshot?: boolean;
}): Promise<LiveMigrationResult> {
  const { cfg, idToken, mode, sourceLabel, rawPayload, dryRun } = params;
  const auth: FirestoreAuth = { idToken };
  const bundle = normalizeAnyInput(rawPayload);

  // Inspect existing Firestore documents to make merge 100% additive & non-destructive
  const [
    existingUsers,
    existingOrders,
    existingComments,
    existingQStats,
    existingReports,
    existingPolls,
    existingDaily,
    existingPush,
    existingNotifLogs,
    existingEvents,
    existingToolRuns,
    toolCounterDoc,
    serialCounterDoc,
  ] = await Promise.all([
    listCollection<Record<string, unknown>>(cfg, 'users', auth, { pageSize: 300, maxDocs: 2500 }),
    listCollection<Record<string, unknown>>(cfg, 'orders', auth, { pageSize: 300, maxDocs: 2500 }),
    listCollection<Record<string, unknown>>(cfg, 'comments', auth, { pageSize: 300, maxDocs: 2500 }),
    listCollection<Record<string, unknown>>(cfg, 'question_stats', auth, { pageSize: 300, maxDocs: 2500 }),
    listCollection<Record<string, unknown>>(cfg, 'question_reports', auth, { pageSize: 300, maxDocs: 1500 }),
    listCollection<Record<string, unknown>>(cfg, 'polls', auth, { pageSize: 50, maxDocs: 100 }),
    listCollection<Record<string, unknown>>(cfg, 'analytics_daily', auth, { pageSize: 300, maxDocs: 1500 }),
    listCollection<Record<string, unknown>>(cfg, 'push_subscriptions', auth, { pageSize: 300, maxDocs: 2500 }),
    listCollection<Record<string, unknown>>(cfg, 'notification_logs', auth, { pageSize: 200, maxDocs: 500 }),
    listCollection<Record<string, unknown>>(cfg, 'analytics_events', auth, { pageSize: 300, maxDocs: 2500 }),
    listCollection<Record<string, unknown>>(cfg, 'tool_runs', auth, { pageSize: 200, maxDocs: 1000 }),
    getDoc<{ count?: number }>(cfg, 'counters/tool', auth),
    getDoc<{ count?: number }>(cfg, 'counters/user_serial', auth),
  ]);

  const currentToolLikes = Math.max(0, Number(toolCounterDoc?.data.count || 0));
  const currentTotalCopies = existingQStats.reduce((s, d) => s + Math.max(0, Number(d.data.copyCount || 0)), 0);
  const currentPollVotes = existingPolls.reduce((s, d) => s + Math.max(0, Number(d.data.totalVotes || 0)), 0);

  const remoteCounts: LiveMigrationPreviewCounts = {
    users: bundle.users.length,
    orders: bundle.orders.length,
    comments: bundle.comments.length,
    questionStats: bundle.questionStats.length,
    questionReports: bundle.questionReports.length,
    polls: bundle.polls.length,
    toolLikes: bundle.toolLikesCount,
    totalQuestionCopies: bundle.questionStats.reduce((s, q) => s + q.copyCount, 0),
    totalVisits: bundle.reportedTotalVisits,
    uniqueVisitors: bundle.reportedUniqueVisitors,
    dailyAnalyticsDays: bundle.dailyAnalytics.length,
    analyticsEvents: bundle.analyticsEvents.length,
    pushSubscriptions: bundle.pushSubscriptions.length,
    notificationLogs: bundle.notificationLogs.length,
    toolRuns: bundle.toolRuns.length,
  };

  const currentFirestoreCounts = {
    users: existingUsers.length,
    orders: existingOrders.length,
    comments: existingComments.length,
    questionStats: existingQStats.length,
    toolLikes: currentToolLikes,
    totalQuestionCopies: currentTotalCopies,
    pollVotes: currentPollVotes,
    dailyAnalyticsDays: existingDaily.length,
    pushSubscriptions: existingPush.length,
  };

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      mode,
      sourceLabel,
      remoteCounts,
      currentFirestoreCounts,
      applied: {
        created: 0,
        mergedOrUpdated: 0,
        skippedExisting: 0,
        errors: 0,
        errorSamples: [],
      },
      ...(params.includeExportedSnapshot ? { exportedSnapshot: rawPayload } : {}),
    };
  }

  const createWrites: CommitWriteInput[] = [];
  const mergeWrites: CommitWriteInput[] = [];
  let skippedExisting = 0;

  // Build quick lookup maps
  const existingUserById = new Map<string, FirestoreDoc<Record<string, unknown>>>();
  const existingUserByEmail = new Map<string, FirestoreDoc<Record<string, unknown>>>();
  let maxSerialNumeric = Math.max(1000, Number(serialCounterDoc?.data.count || 1000));
  for (const u of existingUsers) {
    existingUserById.set(u.id, u);
    const em = String(u.data.email || '').trim().toLowerCase();
    if (em) existingUserByEmail.set(em, u);
    maxSerialNumeric = Math.max(maxSerialNumeric, parseSerialNumeric(u.data.serialNumber));
  }

  // 1. Users (create missing or fill missing serialNumber)
  for (let i = 0; i < bundle.users.length; i++) {
    const u = bundle.users[i];
    const rawId = normalizeUid(u.uid || u.id);
    const uid = rawId && VALID_ID_RE.test(rawId) ? rawId : safeValidId(u.email || u.id, 'user', i);
    const email = String(u.email || `${uid}@users.crovo.local`).trim().toLowerCase().slice(0, 160);
    const safeEmail = email.length >= 3 ? email : `${uid}@users.crovo.local`;
    const rawSerial = typeof (u.serialNumber ?? u.serial_number) === 'string'
      ? String(u.serialNumber ?? u.serial_number).trim().toUpperCase()
      : '';
    const validSerial = /^[A-Z0-9-]{2,32}$/.test(rawSerial) ? rawSerial : '';
    maxSerialNumeric = Math.max(maxSerialNumeric, parseSerialNumeric(validSerial));

    const matchDoc = existingUserById.get(uid) || existingUserByEmail.get(safeEmail);
    if (matchDoc) {
      if (validSerial && !matchDoc.data.serialNumber) {
        mergeWrites.push({
          docPath: `users/${matchDoc.id}`,
          data: { serialNumber: validSerial },
          updateMask: ['serialNumber', 'updatedAt'],
          serverTimeFields: ['updatedAt'],
          exists: true,
        });
      } else {
        skippedExisting += 1;
      }
      continue;
    }

    const rawName = String(u.name || safeEmail.split('@')[0] || 'طالب').trim().slice(0, 80);
    const safeName = rawName.length >= 2 ? rawName : `${rawName} طالب`.slice(0, 80);
    const payload: Record<string, unknown> = {
      uid,
      name: safeName,
      email: safeEmail,
      grade: u.grade === 'bac2' ? 'bac2' : 'bac1',
      role: u.role === 'admin' ? 'admin' : 'user',
      status: u.status === 'suspended' ? 'suspended' : 'active',
    };
    if (validSerial) payload.serialNumber = validSerial;
    if (typeof (u.suspendReason ?? u.suspend_reason) === 'string' && String(u.suspendReason ?? u.suspend_reason).trim()) {
      payload.suspendReason = String(u.suspendReason ?? u.suspend_reason).trim().slice(0, 240);
    }

    createWrites.push({
      docPath: `users/${uid}`,
      data: payload,
      serverTimeFields: ['createdAt', 'updatedAt'],
      exists: false,
    });
    existingUserById.set(uid, { id: uid, path: `users/${uid}`, data: payload });
    existingUserByEmail.set(safeEmail, { id: uid, path: `users/${uid}`, data: payload });
  }

  // Update user_serial counter cleanly if imported serials exceeded current counter
  if (maxSerialNumeric > Number(serialCounterDoc?.data.count || 0)) {
    mergeWrites.push({
      docPath: 'counters/user_serial',
      data: { id: 'user_serial', count: maxSerialNumeric },
      ...(serialCounterDoc ? { updateMask: ['count', 'updatedAt'], exists: true } : { exists: false }),
      serverTimeFields: ['updatedAt'],
    });
  }

  // 2. Orders
  const existingOrderIds = new Set(existingOrders.map((o) => o.id));
  for (let i = 0; i < bundle.orders.length; i++) {
    const o = bundle.orders[i];
    const id = safeValidId(o.id, 'ord', i);
    if (existingOrderIds.has(id)) {
      skippedExisting += 1;
      continue;
    }
    const authorUid = normalizeUid(o.authorUid ?? o.userId ?? o.user_id) || 'guest_order';
    const safeAuthor = VALID_ID_RE.test(authorUid) ? authorUid : 'guest_order';
    const fullName = String(o.fullName ?? o.full_name ?? 'طالب').trim().slice(0, 120);
    const orderCode = String(o.orderCode ?? o.order_code ?? `CRV-${1000 + i}`).trim().slice(0, 40);
    const platformLabel = String(o.platformLabel ?? o.platform_label ?? 'QUREO').trim().slice(0, 160) || 'QUREO';
    const platformUsername = String(o.platformUsername ?? o.platform_username ?? '-').trim().slice(0, 160) || '-';
    const paymentMethod = String(o.paymentMethod ?? o.payment_method ?? 'Vodafone Cash').trim().slice(0, 80) || 'Vodafone Cash';

    const payload: Record<string, unknown> = {
      id,
      orderCode: orderCode.length >= 3 ? orderCode : `CRV-${1000 + i}`,
      authorUid: safeAuthor,
      fullName: fullName.length >= 2 ? fullName : 'طالب CROVO',
      grade: o.grade === 'bac2' ? 'bac2' : 'bac1',
      platformLabel,
      sectionDetails: String(o.sectionDetails ?? o.section_details ?? '').slice(0, 240),
      platformUsername,
      credentialsPurged: parseBool(o.credentialsPurged ?? o.credentials_purged),
      oldPrice: Math.max(0, Math.min(100000, parseIntSafe(o.oldPrice ?? o.old_price, 100))),
      finalPrice: Math.max(0, Math.min(100000, parseIntSafe(o.finalPrice ?? o.final_price, 50))),
      offerApplied: parseBool(o.offerApplied ?? o.offer_applied),
      paymentMethod,
      status:
        o.status === 'reviewing' || o.status === 'completed' || o.status === 'cancelled' ? o.status : 'new',
    };
    if (typeof (o.userSerialNumber ?? o.user_serial_number) === 'string') {
      payload.userSerialNumber = String(o.userSerialNumber ?? o.user_serial_number).slice(0, 32);
    }
    if (typeof (o.userEmail ?? o.user_email) === 'string') {
      payload.userEmail = String(o.userEmail ?? o.user_email).slice(0, 160);
    }
    if (typeof (o.encryptedPassword ?? o.encrypted_password) === 'string' && String(o.encryptedPassword ?? o.encrypted_password)) {
      payload.encryptedPassword = String(o.encryptedPassword ?? o.encrypted_password).slice(0, 2000);
    }
    if (typeof (o.passwordIv ?? o.password_iv) === 'string' && String(o.passwordIv ?? o.password_iv)) {
      payload.passwordIv = String(o.passwordIv ?? o.password_iv).slice(0, 120);
    }
    if (typeof (o.passwordAuthTag ?? o.password_auth_tag) === 'string' && String(o.passwordAuthTag ?? o.password_auth_tag)) {
      payload.passwordAuthTag = String(o.passwordAuthTag ?? o.password_auth_tag).slice(0, 120);
    }

    createWrites.push({
      docPath: `orders/${id}`,
      data: payload,
      serverTimeFields: ['createdAt', 'updatedAt'],
      exists: false,
    });
    existingOrderIds.add(id);
  }

  // 3. Comments
  const existingCommentById = new Map(existingComments.map((c) => [c.id, c]));
  for (let i = 0; i < bundle.comments.length; i++) {
    const c = bundle.comments[i];
    const id = safeValidId(c.id, 'cmt', i);
    const likesCount = Math.max(0, parseIntSafe(c.likesCount ?? c.likes_count, 0));
    const existing = existingCommentById.get(id);
    if (existing) {
      const existingLikes = Math.max(0, Number(existing.data.likesCount || 0));
      if (likesCount > existingLikes) {
        mergeWrites.push({
          docPath: `comments/${id}`,
          data: { likesCount },
          updateMask: ['likesCount', 'updatedAt'],
          serverTimeFields: ['updatedAt'],
          exists: true,
        });
      } else {
        skippedExisting += 1;
      }
      continue;
    }

    const content = String(c.content || '').trim().slice(0, 600);
    if (content.length < 4) {
      skippedExisting += 1;
      continue;
    }
    const rawAuthorUid = normalizeUid(c.authorUid ?? c.userId ?? c.user_id ?? c.visitor_id) || 'legacy_user';
    const authorUid = VALID_ID_RE.test(rawAuthorUid) && rawAuthorUid.length >= 4 ? rawAuthorUid : 'legacy_user';
    const rawAuthorName = String(c.authorName ?? c.author_name ?? 'طالب').trim().slice(0, 60);
    const rawGrade = String(c.grade ?? 'أولى بكالوريا').trim().slice(0, 60);

    const payload: Record<string, unknown> = {
      id,
      authorUid,
      authorName: rawAuthorName.length >= 2 ? rawAuthorName : 'طالب',
      grade: rawGrade.length >= 2 ? rawGrade : 'أولى بكالوريا',
      rating: Math.max(1, Math.min(5, parseIntSafe(c.rating, 5))),
      content,
      isVerified: parseBool(c.isVerified ?? c.is_verified),
      status: c.status === 'hidden' || c.status === 'flagged' ? c.status : 'approved',
      likesCount,
      reportsCount: Math.max(0, parseIntSafe(c.reportsCount ?? c.reports_count, 0)),
    };
    const avatarUrl = c.avatarDataUrl ?? c.avatarUrl;
    if (typeof avatarUrl === 'string' && avatarUrl.length > 0 && avatarUrl.length <= 120000) {
      payload.avatarDataUrl = avatarUrl;
    }
    const beforeUrl = c.attachmentBeforeDataUrl ?? c.attachmentBeforeUrl ?? c.attachmentUrl;
    if (typeof beforeUrl === 'string' && beforeUrl.length > 0 && beforeUrl.length <= 320000) {
      payload.attachmentBeforeDataUrl = beforeUrl;
    }
    const afterUrl = c.attachmentAfterDataUrl ?? c.attachmentAfterUrl;
    if (typeof afterUrl === 'string' && afterUrl.length > 0 && afterUrl.length <= 320000) {
      payload.attachmentAfterDataUrl = afterUrl;
    }

    createWrites.push({
      docPath: `comments/${id}`,
      data: payload,
      serverTimeFields: ['createdAt', 'updatedAt'],
      exists: false,
    });
    existingCommentById.set(id, { id, path: `comments/${id}`, data: payload });
  }

  // 4. Question copy stats (take Math.max so zero copies are lost)
  const existingQStatMap = new Map(existingQStats.map((q) => [q.id, q]));
  for (const qs of bundle.questionStats) {
    const existing = existingQStatMap.get(qs.questionKey);
    if (existing) {
      const prevCount = Math.max(0, Number(existing.data.copyCount || 0));
      if (qs.copyCount > prevCount) {
        mergeWrites.push({
          docPath: `question_stats/${qs.questionKey}`,
          data: { copyCount: qs.copyCount },
          updateMask: ['copyCount', 'updatedAt'],
          serverTimeFields: ['updatedAt'],
          exists: true,
        });
      } else {
        skippedExisting += 1;
      }
      continue;
    }
    createWrites.push({
      docPath: `question_stats/${qs.questionKey}`,
      data: {
        questionKey: qs.questionKey,
        grade: qs.grade,
        section: qs.section,
        chapterNum: qs.chapterNum,
        qIndex: qs.qIndex,
        questionTitle: qs.questionTitle,
        copyCount: qs.copyCount,
      },
      serverTimeFields: ['updatedAt'],
      exists: false,
    });
  }

  // 5. Tool Likes Counter (Math.max)
  if (bundle.toolLikesCount > currentToolLikes) {
    mergeWrites.push({
      docPath: 'counters/tool',
      data: { id: 'tool', count: bundle.toolLikesCount },
      ...(toolCounterDoc ? { updateMask: ['count', 'updatedAt'], exists: true } : { exists: false }),
      serverTimeFields: ['updatedAt'],
    });
  }

  // 6. Polls (merge counts per option safely using Math.max)
  const existingPollMap = new Map(existingPolls.map((p) => [p.id, p]));
  for (const p of bundle.polls) {
    const pollId = safeValidId(p.id, 'poll', 0, 2, 80);
    const existing = existingPollMap.get(pollId);
    if (!existing) {
      createWrites.push({
        docPath: `polls/${pollId}`,
        data: {
          id: pollId,
          question: p.question,
          options: p.options,
          totalVotes: p.totalVotes,
          isOpen: p.isOpen,
          ...(p.startsAt ? { startsAt: p.startsAt.slice(0, 64) } : {}),
          ...(p.endsAt ? { endsAt: p.endsAt.slice(0, 64) } : {}),
        },
        serverTimeFields: ['createdAt', 'updatedAt'],
        exists: false,
      });
    } else {
      const existingOpts = Array.isArray(existing.data.options)
        ? (existing.data.options as Array<Record<string, unknown>>)
        : [];
      let changed = false;
      const mergedOpts = existingOpts.map((eo) => {
        const key = String(eo.key || '');
        const existingCount = Math.max(0, Number(eo.count || 0));
        const incoming = p.options.find((o) => o.key === key);
        const nextCount = Math.max(existingCount, incoming?.count || 0);
        if (nextCount !== existingCount) changed = true;
        return {
          key,
          label: String(eo.label || incoming?.label || key),
          count: nextCount,
        };
      });
      if (changed) {
        const totalVotes = mergedOpts.reduce((s, o) => s + o.count, 0);
        mergeWrites.push({
          docPath: `polls/${pollId}`,
          data: { options: mergedOpts, totalVotes },
          updateMask: ['options', 'totalVotes', 'updatedAt'],
          serverTimeFields: ['updatedAt'],
          exists: true,
        });
      }
    }
  }

  // 7. Analytics Daily (merge historical daily visits with Math.max)
  const existingDailyMap = new Map(existingDaily.map((d) => [d.id, d]));
  for (const d of bundle.dailyAnalytics) {
    const existing = existingDailyMap.get(d.day);
    if (!existing) {
      createWrites.push({
        docPath: `analytics_daily/${d.day}`,
        data: {
          id: d.day,
          visits: d.visits,
          uniqueVisitors: d.uniqueVisitors,
          libraryOpens: d.libraryOpens,
          searches: d.searches,
        },
        serverTimeFields: ['updatedAt'],
        exists: false,
      });
    } else {
      const nextVisits = Math.max(Number(existing.data.visits || 0), d.visits);
      const nextUnique = Math.max(Number(existing.data.uniqueVisitors || 0), d.uniqueVisitors);
      const nextOpens = Math.max(Number(existing.data.libraryOpens || 0), d.libraryOpens);
      const nextSearches = Math.max(Number(existing.data.searches || 0), d.searches);
      if (
        nextVisits > Number(existing.data.visits || 0) ||
        nextUnique > Number(existing.data.uniqueVisitors || 0) ||
        nextOpens > Number(existing.data.libraryOpens || 0) ||
        nextSearches > Number(existing.data.searches || 0)
      ) {
        mergeWrites.push({
          docPath: `analytics_daily/${d.day}`,
          data: {
            id: d.day,
            visits: nextVisits,
            uniqueVisitors: nextUnique,
            libraryOpens: nextOpens,
            searches: nextSearches,
          },
          updateMask: ['visits', 'uniqueVisitors', 'libraryOpens', 'searches', 'updatedAt'],
          serverTimeFields: ['updatedAt'],
          exists: true,
        });
      }
    }
  }

  // 8. Raw Analytics Events (capped sensibly to preserve recent events + avoid excess bloat)
  const existingEventIds = new Set(existingEvents.map((e) => e.id));
  for (let i = 0; i < bundle.analyticsEvents.length && i < 1200; i++) {
    const e = bundle.analyticsEvents[i];
    const eventType = String(e.eventType ?? e.event_type ?? '');
    if (!ALLOWED_ANALYTICS_EVENTS.has(eventType)) continue;
    const id = safeValidId(e.id, 'evt', i);
    if (existingEventIds.has(id)) {
      skippedExisting += 1;
      continue;
    }
    const visitorId = safeValidId(e.visitorId ?? e.visitor_id, 'v', i, 1, 80);
    const payload: Record<string, unknown> = { id, eventType, visitorId };
    const uid = normalizeUid(e.userId ?? e.user_id);
    if (uid && VALID_ID_RE.test(uid)) payload.userId = uid;
    if (typeof e.path === 'string' && e.path) payload.path = e.path.slice(0, 120);
    if (typeof e.grade === 'string' && e.grade) payload.grade = e.grade.slice(0, 16);
    if (typeof e.section === 'string' && e.section) payload.section = e.section.slice(0, 16);
    const chNum = e.chapterNum ?? e.chapter_num;
    if (typeof chNum === 'number' && Number.isFinite(chNum)) {
      payload.chapterNum = Math.max(0, Math.min(500, Math.round(chNum)));
    }
    if (typeof e.query === 'string' && e.query) payload.query = e.query.slice(0, 160);
    const rc = e.resultsCount ?? e.results_count;
    if (typeof rc === 'number' && Number.isFinite(rc)) {
      payload.resultsCount = Math.max(0, Math.min(5000, Math.round(rc)));
    }
    createWrites.push({
      docPath: `analytics_events/${id}`,
      data: payload,
      serverTimeFields: ['createdAt'],
      exists: false,
    });
    existingEventIds.add(id);
  }

  // 9. Push Subscriptions, Question Reports, Notification Logs, Tool Runs
  const existingPushIds = new Set(existingPush.map((p) => p.id));
  for (let i = 0; i < bundle.pushSubscriptions.length; i++) {
    const s = bundle.pushSubscriptions[i];
    const id = safeValidId(s.id, 'sub', i, 8, 80);
    if (existingPushIds.has(id)) {
      skippedExisting += 1;
      continue;
    }
    const endpoint = String(s.endpoint || '');
    const p256dh = String(s.p256dh || '');
    const authKey = String(s.auth || '');
    if (endpoint.length < 16 || p256dh.length < 8 || authKey.length < 4) continue;
    createWrites.push({
      docPath: `push_subscriptions/${id}`,
      data: {
        id,
        visitorId: safeValidId(s.visitorId ?? s.visitor_id, 'v', i, 1, 80),
        endpoint: endpoint.slice(0, 1000),
        p256dh: p256dh.slice(0, 300),
        auth: authKey.slice(0, 160),
        enabled: s.enabled !== undefined ? parseBool(s.enabled) : true,
      },
      serverTimeFields: ['createdAt', 'updatedAt'],
      exists: false,
    });
    existingPushIds.add(id);
  }

  const existingReportIds = new Set(existingReports.map((r) => r.id));
  for (let i = 0; i < bundle.questionReports.length; i++) {
    const r = bundle.questionReports[i];
    const id = safeValidId(r.id, 'qrep', i);
    if (existingReportIds.has(id)) {
      skippedExisting += 1;
      continue;
    }
    const qKey = safeValidId(r.questionKey ?? r.question_key, 'qkey', i);
    const desc = String(r.description || 'تبليغ عن إجابة').trim().slice(0, 600);
    createWrites.push({
      docPath: `question_reports/${id}`,
      data: {
        id,
        reporterUid: 'guest_report',
        questionKey: qKey,
        grade: r.grade === 'bac2' ? 'bac2' : 'bac1',
        section: r.section === 'py' || r.section === 'fin' ? r.section : 'js',
        chapterNum: Math.max(1, Math.min(200, parseIntSafe(r.chapterNum ?? r.chapter_num, 1))),
        qIndex: Math.max(0, Math.min(1000, parseIntSafe(r.qIndex ?? r.q_index, 0))),
        questionTitle: String(r.questionTitle ?? r.question_title ?? '').slice(0, 300),
        description: desc.length >= 4 ? desc : 'تبليغ عن إجابة',
        status:
          r.status === 'reviewed' || r.status === 'resolved' || r.status === 'dismissed' ? r.status : 'pending',
      },
      serverTimeFields: ['createdAt', 'updatedAt'],
      exists: false,
    });
    existingReportIds.add(id);
  }

  const existingNotifIds = new Set(existingNotifLogs.map((n) => n.id));
  for (let i = 0; i < bundle.notificationLogs.length; i++) {
    const l = bundle.notificationLogs[i];
    const id = safeValidId(l.id, 'nlog', i);
    if (existingNotifIds.has(id)) {
      skippedExisting += 1;
      continue;
    }
    createWrites.push({
      docPath: `notification_logs/${id}`,
      data: {
        id,
        messageId: String(l.messageId ?? l.message_id ?? 'migration').slice(0, 80),
        category: String(l.category || 'offer').slice(0, 32),
        title: String(l.title || '').slice(0, 160),
        body: String(l.body || '').slice(0, 400),
        sentCount: Math.max(0, parseIntSafe(l.sentCount ?? l.sent_count, 0)),
        failedCount: Math.max(0, parseIntSafe(l.failedCount ?? l.failed_count, 0)),
        triggerType: String(l.triggerType ?? l.trigger_type ?? 'manual').slice(0, 32),
      },
      serverTimeFields: ['createdAt'],
      exists: false,
    });
    existingNotifIds.add(id);
  }

  const existingRunIds = new Set(existingToolRuns.map((t) => t.id));
  for (let i = 0; i < bundle.toolRuns.length; i++) {
    const t = bundle.toolRuns[i];
    const id = safeValidId(t.id, 'trun', i);
    if (existingRunIds.has(id)) {
      skippedExisting += 1;
      continue;
    }
    createWrites.push({
      docPath: `tool_runs/${id}`,
      data: {
        id,
        serviceKey: String(t.serviceKey ?? t.service_key ?? 'qureo').slice(0, 64),
        status: t.status === 'failed' || t.status === 'running' ? t.status : 'success',
        durationMs: Math.max(0, Math.min(600000, parseIntSafe(t.durationMs ?? t.duration_ms, 0))),
      },
      serverTimeFields: ['createdAt'],
      exists: false,
    });
    existingRunIds.add(id);
  }

  const createCounter = { applied: 0, errors: 0, errorSamples: [] as string[] };
  const mergeCounter = { applied: 0, errors: 0, errorSamples: [] as string[] };

  await commitChunkWithFallback(cfg, createWrites, auth, createCounter);
  await commitChunkWithFallback(cfg, mergeWrites, auth, mergeCounter);

  // Ensure site_config/public exists if Firestore didn't have one yet
  const existingCfg = await getDoc(cfg, 'site_config/public', auth);
  if (!existingCfg && (bundle.settingsRows.length > 0 || bundle.serviceRows.length > 0)) {
    const base = buildDefaultSiteConfig();
    await setDoc(
      cfg,
      'site_config/public',
      {
        id: 'public',
        qureoOldPrice: base.qureoOldPrice,
        qureoOfferPrice: base.qureoOfferPrice,
        finOldPrice: base.finOldPrice,
        finOfferPrice: base.finOfferPrice,
        bundleOldPrice: base.bundleOldPrice,
        bundleOfferPrice: base.bundleOfferPrice,
        offerDurationHours: base.offerDurationHours,
        offerEndsAt: base.offerEndsAt,
        afterOfferMode: base.afterOfferMode,
        ordersEnabled: base.ordersEnabled,
        pollClosed: base.pollClosed,
        whatsappNumber: base.whatsappNumber,
        adminWhatsappDisplay: base.adminWhatsappDisplay,
        offerText: base.offerText,
        notificationsEnabled: base.notificationsEnabled,
        notificationsIntervalDays: base.notificationsIntervalDays,
        heroPromo: base.heroPromo,
        promoBanner: base.promoBanner,
        libraryAd: base.libraryAd,
        toolServices: DEFAULT_TOOL_SERVICES,
        toolVideos: DEFAULT_TOOL_VIDEOS,
        trackingStartedAt: base.trackingStartedAt,
      },
      ['updatedAt'],
      auth
    ).catch(() => {});
  }

  return {
    ok: true,
    dryRun: false,
    mode,
    sourceLabel,
    remoteCounts,
    currentFirestoreCounts,
    applied: {
      created: createCounter.applied,
      mergedOrUpdated: mergeCounter.applied,
      skippedExisting,
      errors: createCounter.errors + mergeCounter.errors,
      errorSamples: [...createCounter.errorSamples, ...mergeCounter.errorSamples].slice(0, 8),
    },
    ...(params.includeExportedSnapshot ? { exportedSnapshot: rawPayload } : {}),
  };
}
