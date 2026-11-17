import type { D1Database, Env } from './types';
import type { PricingConfig } from './domain';
import { generateId } from './crypto';

export interface PublicSiteConfig extends PricingConfig {
  ordersEnabled: boolean;
  pollClosed: boolean;
  libraryAd: {
    enabled: boolean;
    title: string;
    subtitle: string;
    priceText: string;
    ctaText: string;
    ctaLink: string;
    imageUrl: string;
    delaySeconds: number;
    cooldownHours: number;
    templateMode: 'classic' | 'rich_crovo';
  };
  heroPromo: {
    enabled: boolean;
    title: string;
    subtitle: string;
  };
  promoBanner: {
    enabled: boolean;
    text: string;
  };
  notificationsEnabled: boolean;
  notificationsIntervalDays: number;
  adminWhatsappDisplay: string;
  toolVideos: Array<{
    id: string;
    tag: string;
    title: string;
    description: string;
    src: string;
    visible: boolean;
  }>;
  toolServices: Array<{
    key: string;
    name: string;
    grade: string;
    description: string;
    isVisible: boolean;
  }>;
}

export interface NotificationTemplate {
  id: string;
  category: 'offer' | 'service' | 'update';
  title: string;
  body: string;
  url: string;
}

export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  {
    id: 'offer-50',
    category: 'offer',
    title: 'عرض الـ50% من CROVO SPACE لسه شغال! ⚡',
    body: 'حل منصة QUREO بالكامل للترمين بـ50 جنيه بدل 100 جنيه — وفر وقتك وذاكر براحتك.',
    url: '/?offer=1',
  },
  {
    id: 'service-bundle',
    category: 'service',
    title: 'باقة تانية بكالوريا: QUREO + ثقافة مالية 🎯',
    body: 'ممكن تشترك في المنصتين مع بعض بـ100 جنيه بدل 200 جنيه بمحاكاة بشرية كاملة بدون أي كشف.',
    url: '/',
  },
  {
    id: 'update-library-search',
    category: 'update',
    title: 'تحديث جديد في مكتبة CROVO SPACE 📚',
    body: 'ضفنا بحث فوري عن الأسئلة وفلترة بالمادة والمستوى وترتيب بالأكثر نسخًا عشان توصل لحلك في ثواني.',
    url: '/#solutions-library',
  },
  {
    id: 'offer-time-saver',
    category: 'offer',
    title: 'خلّص 600+ سؤال في 4 دقايق بدل السهر! ⏱️',
    body: 'أداة CROVO بتدخل تكتب وتجاوب بهدوء وبنفس أسلوب الطالب العادي بنسبة نجاح 100%.',
    url: '/',
  },
  {
    id: 'service-reviews',
    category: 'service',
    title: 'شوف آراء زمايلك الموثّقين على CROVO SPACE ⭐',
    body: 'اطلع على تجارب طلاب أولى وتانية بكالوريا الحقيقية قبل ما تاخد قرارك.',
    url: '/reviews',
  },
  {
    id: 'update-help-center',
    category: 'update',
    title: 'مكتبة الحلول المجانية جاهزة ومحدثة بالكامل ✅',
    body: 'جميع مستويات أولى بكالوريا (42 مستوى) وتانية بكالوريا (54 جافا + 25 بايثون + 8 مالية) متاحة للنسخ.',
    url: '/#solutions-library',
  },
  {
    id: 'offer-poll',
    category: 'offer',
    title: 'شاركنا رأيك: تحب نمد عرض الـ50%؟ 🗳️',
    body: 'صوّت في الاستفتاء المباشر على الموقع وتابع النسبة الحقيقية بين الطلاب.',
    url: '/#poll-section',
  },
  {
    id: 'service-security',
    category: 'service',
    title: 'خصوصيتك وأمان حسابك أولوية في CROVO 🔒',
    body: 'بيانات الدخول مشفرة بـ AES-256-GCM وتُحذف تلقائيًا فور إتمام طلب الاشتراك.',
    url: '/#help-center',
  },
];

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? row.value : null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

let commentImageColsChecked = false;

export async function ensureCommentImageColumns(db: D1Database): Promise<void> {
  if (commentImageColsChecked) return;
  commentImageColsChecked = true;
  for (const colDef of ['attachment_before_url TEXT', 'attachment_after_url TEXT']) {
    try {
      await db.prepare(`ALTER TABLE comments ADD COLUMN ${colDef}`).run();
    } catch {
      // Column already exists
    }
  }
}

let serialSchemaChecked = false;

export async function ensureUserSerialNumberSchema(db: D1Database): Promise<void> {
  if (!serialSchemaChecked) {
    serialSchemaChecked = true;
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN serial_number TEXT').run();
    } catch {
      // Column already exists
    }
    try {
      await db
        .prepare(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_serial_number ON users(serial_number) WHERE serial_number IS NOT NULL'
        )
        .run();
    } catch {
      // Index already exists
    }
    try {
      await db
        .prepare('CREATE INDEX IF NOT EXISTS idx_analytics_user_created ON analytics_events(user_id, created_at DESC)')
        .run();
    } catch {
      // Index already exists
    }
  }

  try {
    const missing = await db
      .prepare(
        `SELECT id FROM users
         WHERE serial_number IS NULL OR trim(serial_number) = ''
         ORDER BY created_at ASC
         LIMIT 200`
      )
      .all<{ id: string }>();
    for (const row of missing.results || []) {
      const serial = await allocateNextUserSerial(db);
      await db.prepare('UPDATE users SET serial_number = ? WHERE id = ?').bind(serial, row.id).run();
    }
  } catch {
    // Best-effort backfill
  }
}

export async function allocateNextUserSerial(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'user_serial_seq'").first<{ value: string }>();
  let seq = Number(row?.value);
  if (!Number.isFinite(seq) || seq < 1000) {
    seq = 1000;
  }

  try {
    const maxRow = await db
      .prepare(
        `SELECT MAX(CAST(REPLACE(serial_number, 'CRV-', '') AS INTEGER)) as maxNum
         FROM users
         WHERE serial_number LIKE 'CRV-%'`
      )
      .first<{ maxNum: number | null }>();
    if (maxRow && typeof maxRow.maxNum === 'number' && maxRow.maxNum > seq) {
      seq = maxRow.maxNum;
    }
  } catch {
    // Ignore if serial_number column is just being created
  }

  let candidate = '';
  do {
    seq += 1;
    candidate = `CRV-${seq}`;
  } while (await db.prepare('SELECT 1 FROM users WHERE serial_number = ?').bind(candidate).first());

  await setSetting(db, 'user_serial_seq', String(seq));
  return candidate;
}

export async function ensureDefaultSettingsIfNeeded(db: D1Database, env?: Env): Promise<void> {
  await ensureCommentImageColumns(db);
  await ensureUserSerialNumberSchema(db);
  const marker = await getSetting(db, 'tracking_started_at');
  if (marker) return;

  const defaultOfferEnds = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  const defaults: Array<[string, string]> = [
    ['qureo_offer_price', '50'],
    ['qureo_old_price', '100'],
    ['fin_offer_price', '50'],
    ['fin_old_price', '100'],
    ['bundle_offer_price', '100'],
    ['bundle_old_price', '200'],
    ['offer_ends_at', defaultOfferEnds],
    ['after_offer_mode', 'regular_price'],
    ['orders_enabled', 'true'],
    ['poll_closed', 'false'],
    ['library_ad_enabled', 'true'],
    ['library_ad_title', 'لسه بتحل المنصة بنفسك؟'],
    ['library_ad_subtitle', 'وفر وقتك مع أداة CROVO'],
    ['library_ad_price_text', 'حل المنصة بالكامل بـ50 جنيه فقط'],
    ['library_ad_cta', 'اعرف أكتر'],
    ['library_ad_cta_link', '/tool'],
    ['library_ad_image_url', '/media/crovo-promo-ad.jpg'],
    ['library_ad_delay_seconds', '60'],
    ['library_ad_cooldown_hours', '24'],
    ['library_ad_template_mode', 'classic'],
    ['hero_promo_enabled', 'true'],
    ['hero_promo_title', 'أداة CROVO الذكية — خلّص المنصة كلها في 4 دقايق'],
    ['hero_promo_subtitle', 'بتسجل دخولك بمحاكاة بشرية كاملة وتكتب وتجاوب بدقة 100% من غير ما المنصة تشك في أي حاجة.'],
    ['promo_banner_enabled', 'true'],
    ['promo_banner_text', 'حل المنصة بالكامل للترمين بـ{price} جنيه فقط · المنصتين مع بعض بـ{bundle} جنيه فقط'],
    ['notifications_enabled', 'true'],
    ['notifications_interval_days', '3'],
    ['admin_whatsapp_display', env?.ADMIN_WHATSAPP_NUMBER || '201550324450'],
    ['tracking_started_at', nowIso],
  ];

  const stmts = defaults.map(([k, v]) =>
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(k, v)
  );
  stmts.push(
    db
      .prepare(
        `INSERT OR IGNORE INTO polls (id, slug, question, is_open, starts_at, ends_at, created_at, updated_at)
         VALUES ('poll_extend_offer', 'extend-offer', 'إيه رأيكم نمد العرض؟', 1, ?, NULL, ?, ?)`
      )
      .bind(nowIso, nowIso, nowIso),
    db
      .prepare(
        `INSERT OR IGNORE INTO poll_options (id, poll_id, option_key, label, sort_order)
         VALUES ('opt_extend', 'poll_extend_offer', 'extend', 'موافق نمد العرض 🔥', 1)`
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO poll_options (id, poll_id, option_key, label, sort_order)
         VALUES ('opt_enough', 'poll_extend_offer', 'enough', 'كفاية كده 👍', 2)`
      )
  );

  await db.batch(stmts);
}

export async function getSiteConfig(db: D1Database): Promise<PublicSiteConfig> {
  const [settingsRes, servicesRes] = await Promise.all([
    db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>(),
    db
      .prepare('SELECT key, name, grade, description, is_visible FROM tool_services ORDER BY grade ASC, key ASC')
      .all<{ key: string; name: string; grade: string; description: string; is_visible: number }>()
      .catch(() => ({ results: [] as Array<{ key: string; name: string; grade: string; description: string; is_visible: number }> })),
  ]);

  const map = new Map<string, string>();
  for (const r of settingsRes.results || []) {
    map.set(r.key, r.value);
  }

  const num = (key: string, fallback: number): number => {
    const val = Number(map.get(key));
    return Number.isFinite(val) && val >= 0 ? val : fallback;
  };

  let parsedVideos: PublicSiteConfig['toolVideos'] = [];
  const rawVideos = map.get('tool_videos_json');
  if (rawVideos) {
    try {
      const arr = JSON.parse(rawVideos);
      if (Array.isArray(arr)) parsedVideos = arr;
    } catch {
      parsedVideos = [];
    }
  }

  const services = (servicesRes.results || []).map((s) => ({
    key: s.key,
    name: s.name,
    grade: s.grade,
    description: s.description,
    isVisible: Number(s.is_visible) === 1,
  }));

  return {
    qureoOfferPrice: num('qureo_offer_price', 50),
    qureoOldPrice: num('qureo_old_price', 100),
    finOfferPrice: num('fin_offer_price', 50),
    finOldPrice: num('fin_old_price', 100),
    bundleOfferPrice: num('bundle_offer_price', 100),
    bundleOldPrice: num('bundle_old_price', 200),
    offerEndsAt: map.get('offer_ends_at') || new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    afterOfferMode: map.get('after_offer_mode') === 'extended_offer' ? 'extended_offer' : 'regular_price',
    ordersEnabled: map.get('orders_enabled') !== 'false',
    pollClosed: map.get('poll_closed') === 'true',
    libraryAd: {
      enabled: map.get('library_ad_enabled') !== 'false',
      title: map.get('library_ad_title') || 'لسه بتحل المنصة بنفسك؟',
      subtitle: map.get('library_ad_subtitle') || 'وفر وقتك مع أداة CROVO',
      priceText: map.get('library_ad_price_text') || 'حل المنصة بالكامل بـ50 جنيه فقط',
      ctaText: map.get('library_ad_cta') || 'اعرف أكتر',
      ctaLink: map.get('library_ad_cta_link') || '/tool',
      imageUrl: map.get('library_ad_image_url') || '/media/crovo-promo-ad.jpg',
      delaySeconds: Math.max(5, Math.min(600, num('library_ad_delay_seconds', 60))),
      cooldownHours: Math.max(1, Math.min(720, num('library_ad_cooldown_hours', 24))),
      templateMode: map.get('library_ad_template_mode') === 'rich_crovo' ? 'rich_crovo' : 'classic',
    },
    heroPromo: {
      enabled: map.get('hero_promo_enabled') !== 'false',
      title: map.get('hero_promo_title') || 'أداة CROVO الذكية — خلّص المنصة كلها في 4 دقايق',
      subtitle:
        map.get('hero_promo_subtitle') ||
        'بتسجل دخولك بمحاكاة بشرية كاملة وتكتب وتجاوب بدقة 100% من غير ما المنصة تشك في أي حاجة.',
    },
    promoBanner: {
      enabled: map.get('promo_banner_enabled') !== 'false',
      text:
        map.get('promo_banner_text') ||
        'حل المنصة بالكامل للترمين بـ{price} جنيه فقط · المنصتين مع بعض بـ{bundle} جنيه فقط',
    },
    notificationsEnabled: map.get('notifications_enabled') !== 'false',
    notificationsIntervalDays: Math.max(1, Math.min(30, num('notifications_interval_days', 3))),
    adminWhatsappDisplay: map.get('admin_whatsapp_display') || '201550324450',
    toolVideos: parsedVideos,
    toolServices: services,
  };
}

export async function purgeExpiredOrderCredentials(_db: D1Database, _maxAgeHours = 168): Promise<number> {
  // Never auto-purge orders or credentials; kept permanently until admin explicitly deletes/purges them.
  return 0;
}

export async function getPollSummary(db: D1Database, userId?: string | null, pollIdArg?: string) {
  const config = await getSiteConfig(db);
  const poll = pollIdArg
    ? await db
        .prepare('SELECT id, slug, question, is_open, starts_at, ends_at FROM polls WHERE id = ?')
        .bind(pollIdArg)
        .first<{ id: string; slug: string; question: string; is_open: number; starts_at: string | null; ends_at: string | null }>()
    : await db
        .prepare('SELECT id, slug, question, is_open, starts_at, ends_at FROM polls ORDER BY created_at DESC LIMIT 1')
        .first<{ id: string; slug: string; question: string; is_open: number; starts_at: string | null; ends_at: string | null }>();

  if (!poll) {
    return {
      pollId: 'poll_extend_offer',
      question: 'إيه رأيكم نمد العرض؟',
      closed: config.pollClosed,
      requiresAuth: true,
      totalVotes: 0,
      extendCount: 0,
      enoughCount: 0,
      extendPercent: 0,
      enoughPercent: 0,
      userChoice: null,
      options: [],
    };
  }

  const optsRes = await db
    .prepare(
      `SELECT o.option_key as key, o.label, COUNT(v.id) as votes
       FROM poll_options o
       LEFT JOIN user_poll_votes v ON v.poll_id = o.poll_id AND v.option_key = o.option_key
       WHERE o.poll_id = ?
       GROUP BY o.id
       ORDER BY o.sort_order ASC`
    )
    .bind(poll.id)
    .all<{ key: string; label: string; votes: number }>();

  const opts = optsRes.results || [];
  const totalVotes = opts.reduce((s, o) => s + Number(o.votes || 0), 0);
  const enrichedOptions = opts.map((o) => ({
    key: o.key,
    label: o.label,
    count: Number(o.votes || 0),
    percent: totalVotes > 0 ? Math.round((Number(o.votes || 0) / totalVotes) * 100) : 0,
  }));

  const nowMs = Date.now();
  const expiredBySchedule = Boolean(poll.ends_at && Date.parse(poll.ends_at) <= nowMs);
  const closed =
    Number(poll.is_open) === 0 || (poll.id === 'poll_extend_offer' && config.pollClosed) || expiredBySchedule;

  let userChoice: string | null = null;
  if (userId) {
    const myVote = await db
      .prepare('SELECT option_key FROM user_poll_votes WHERE poll_id = ? AND user_id = ?')
      .bind(poll.id, userId)
      .first<{ option_key: string }>();
    if (myVote) userChoice = myVote.option_key;
  }

  const ext = enrichedOptions.find((o) => o.key === 'extend') || enrichedOptions[0];
  const eno = enrichedOptions.find((o) => o.key === 'enough') || enrichedOptions[1];

  return {
    pollId: poll.id,
    question: poll.question,
    closed,
    startsAt: poll.starts_at,
    endsAt: poll.ends_at,
    requiresAuth: true,
    totalVotes,
    extendCount: ext?.count || 0,
    enoughCount: eno?.count || 0,
    extendPercent: ext?.percent || 0,
    enoughPercent: eno?.percent || 0,
    userChoice,
    options: enrichedOptions,
  };
}

export async function recordAnalyticsEvent(
  db: D1Database,
  input: {
    eventType: string;
    visitorId: string;
    userId?: string | null;
    sessionId?: string | null;
    path?: string | null;
    grade?: string | null;
    section?: string | null;
    chapterNum?: number | null;
    query?: string | null;
    resultsCount?: number | null;
    meta?: Record<string, unknown> | null;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO analytics_events (
          id, event_type, visitor_id, user_id, session_id, path,
          grade, section, chapter_num, query, results_count, meta_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateId('evt'),
        input.eventType.slice(0, 48),
        input.visitorId.slice(0, 64),
        input.userId || null,
        input.sessionId ? String(input.sessionId).slice(0, 64) : null,
        input.path ? String(input.path).slice(0, 120) : null,
        input.grade ? String(input.grade).slice(0, 16) : null,
        input.section ? String(input.section).slice(0, 16) : null,
        typeof input.chapterNum === 'number' && Number.isFinite(input.chapterNum)
          ? Math.round(input.chapterNum)
          : null,
        input.query ? String(input.query).trim().slice(0, 120) : null,
        typeof input.resultsCount === 'number' && Number.isFinite(input.resultsCount)
          ? Math.round(input.resultsCount)
          : null,
        input.meta ? JSON.stringify(input.meta).slice(0, 1000) : null,
        new Date().toISOString()
      )
      .run();
  } catch {
    // Analytics must never crash primary request flow
  }
}

export async function logAdminAudit(
  db: D1Database,
  params: {
    actorUsername: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    details?: Record<string, unknown> | null;
    ipHash?: string | null;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (id, actor_username, action, target_type, target_id, details_json, ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateId('aud'),
        params.actorUsername,
        params.action,
        params.targetType,
        params.targetId || null,
        params.details ? JSON.stringify(params.details).slice(0, 1000) : null,
        params.ipHash || null,
        new Date().toISOString()
      )
      .run();
  } catch {
    // Best-effort audit logging
  }
}

export async function migrateVisitorActivityToUser(
  db: D1Database,
  visitorId: string,
  userId: string
): Promise<void> {
  try {
    const likesRes = await db
      .prepare('SELECT item_key FROM likes WHERE visitor_id = ? AND user_id IS NULL')
      .bind(visitorId)
      .all<{ item_key: string }>();

    for (const l of likesRes.results || []) {
      const exists = await db
        .prepare('SELECT 1 FROM likes WHERE item_key = ? AND user_id = ?')
        .bind(l.item_key, userId)
        .first();
      if (!exists) {
        await db
          .prepare('UPDATE likes SET user_id = ? WHERE item_key = ? AND visitor_id = ?')
          .bind(userId, l.item_key, visitorId)
          .run();
      }
    }

    await db.batch([
      db.prepare('UPDATE comments SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL').bind(userId, visitorId),
      db.prepare('UPDATE orders SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL').bind(userId, visitorId),
      db
        .prepare('UPDATE push_subscriptions SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL')
        .bind(userId, visitorId),
      db
        .prepare('UPDATE analytics_events SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL')
        .bind(userId, visitorId),
    ]);
  } catch {
    // Ignore partial migration conflict
  }
}

export type AnalyticsRange = 'today' | '7d' | '30d' | 'year' | 'custom';

function resolveDateBounds(params: { range?: string; from?: string; to?: string }) {
  const now = new Date();
  const rangeRaw = params.range;
  const range: AnalyticsRange =
    rangeRaw === 'today' ||
    rangeRaw === '7d' ||
    rangeRaw === '30d' ||
    rangeRaw === 'year' ||
    rangeRaw === 'custom'
      ? rangeRaw
      : '7d';

  let startMs: number;
  let endMs: number = now.getTime();

  if (range === 'today') {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    startMs = start.getTime();
  } else if (range === '30d') {
    startMs = endMs - 30 * 86400_000;
  } else if (range === 'year') {
    startMs = endMs - 365 * 86400_000;
  } else if (range === 'custom' && params.from && params.to) {
    const parsedFrom = Date.parse(params.from);
    const parsedTo = Date.parse(params.to);
    if (Number.isFinite(parsedFrom) && Number.isFinite(parsedTo) && parsedTo >= parsedFrom) {
      startMs = parsedFrom;
      endMs = params.to.length <= 10 ? parsedTo + 86400_000 - 1 : parsedTo;
    } else {
      startMs = endMs - 7 * 86400_000;
    }
  } else {
    startMs = endMs - 7 * 86400_000;
  }

  const span = Math.max(60_000, endMs - startMs);
  const prevEndMs = startMs - 1;
  const prevStartMs = prevEndMs - span;

  return {
    range,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    prevStartIso: new Date(prevStartMs).toISOString(),
    prevEndIso: new Date(prevEndMs).toISOString(),
  };
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0 && curr === 0) return 0;
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

export async function getDashboardAnalytics(
  db: D1Database,
  params: { range?: string; from?: string; to?: string }
) {
  const bounds = resolveDateBounds(params);
  const { startIso, endIso, prevStartIso, prevEndIso } = bounds;
  const now = Date.now();
  const todayStartIso = (() => {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  })();
  const weekStartIso = new Date(now - 7 * 86400_000).toISOString();
  const monthStartIso = new Date(now - 30 * 86400_000).toISOString();
  const activeWindowIso = new Date(now - 5 * 60_000).toISOString();

  const [
    periodVisitsRow,
    prevVisitsRow,
    activeNowRow,
    todayVisitsRow,
    weekVisitsRow,
    monthVisitsRow,
    allTimeVisitsRow,
    topPagesRes,
    dailySeriesRes,
    totalAccountsRow,
    newAccountsRow,
    prevNewAccountsRow,
    activeAccountsRow,
    ordersStatsRow,
    allCompletedSubscribersRow,
    libraryUsersRow,
    returningVisitorsRow,
    libraryOpensRow,
    topLevelsRes,
    topSectionsRes,
    topSearchesRes,
    missingSearchesRes,
    libInventoryRow,
    totalCopiesRow,
    toolStatsRow,
    topToolOpsRes,
    reviewsInPeriodRow,
    totalReviewsRow,
    totalLikesRow,
    likesInPeriodRow,
    pollVotesRow,
    pollVotesPeriodRow,
    topLikedRes,
    searchesRow,
    timelineRes,
    recentToolErrorsRes,
    trackingStartedAt,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) as totalVisits, COUNT(DISTINCT visitor_id) as uniqueVisitors
         FROM analytics_events WHERE event_type = 'page_view' AND created_at BETWEEN ? AND ?`
      )
      .bind(startIso, endIso)
      .first<{ totalVisits: number; uniqueVisitors: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as totalVisits, COUNT(DISTINCT visitor_id) as uniqueVisitors
         FROM analytics_events WHERE event_type = 'page_view' AND created_at BETWEEN ? AND ?`
      )
      .bind(prevStartIso, prevEndIso)
      .first<{ totalVisits: number; uniqueVisitors: number }>(),
    db
      .prepare(`SELECT COUNT(DISTINCT visitor_id) as activeNow FROM analytics_events WHERE created_at >= ?`)
      .bind(activeWindowIso)
      .first<{ activeNow: number }>(),
    db
      .prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE event_type = 'page_view' AND created_at >= ?`)
      .bind(todayStartIso)
      .first<{ cnt: number }>(),
    db
      .prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE event_type = 'page_view' AND created_at >= ?`)
      .bind(weekStartIso)
      .first<{ cnt: number }>(),
    db
      .prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE event_type = 'page_view' AND created_at >= ?`)
      .bind(monthStartIso)
      .first<{ cnt: number }>(),
    db
      .prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT visitor_id) as uniqueAll FROM analytics_events WHERE event_type = 'page_view'`)
      .first<{ total: number; uniqueAll: number }>(),
    db
      .prepare(
        `SELECT COALESCE(path, '/') as path, COUNT(*) as views, COUNT(DISTINCT visitor_id) as uniqueVisitors
         FROM analytics_events WHERE event_type = 'page_view' AND created_at BETWEEN ? AND ?
         GROUP BY COALESCE(path, '/') ORDER BY views DESC LIMIT 8`
      )
      .bind(startIso, endIso)
      .all<{ path: string; views: number; uniqueVisitors: number }>(),
    db
      .prepare(
        `SELECT substr(created_at, 1, 10) as day, COUNT(*) as visits, COUNT(DISTINCT visitor_id) as uniqueVisitors
         FROM analytics_events WHERE event_type = 'page_view' AND created_at BETWEEN ? AND ?
         GROUP BY substr(created_at, 1, 10) ORDER BY day ASC LIMIT 60`
      )
      .bind(startIso, endIso)
      .all<{ day: string; visits: number; uniqueVisitors: number }>(),
    db.prepare('SELECT COUNT(*) as cnt FROM users').first<{ cnt: number }>(),
    db
      .prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at BETWEEN ? AND ?')
      .bind(startIso, endIso)
      .first<{ cnt: number }>(),
    db
      .prepare('SELECT COUNT(*) as cnt FROM users WHERE created_at BETWEEN ? AND ?')
      .bind(prevStartIso, prevEndIso)
      .first<{ cnt: number }>(),
    db
      .prepare('SELECT COUNT(*) as cnt FROM users WHERE last_active_at BETWEEN ? AND ?')
      .bind(startIso, endIso)
      .first<{ cnt: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as totalOrders,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedOrders,
                SUM(CASE WHEN status IN ('new', 'reviewing') THEN 1 ELSE 0 END) as pendingOrders,
                COUNT(DISTINCT CASE WHEN status = 'completed' THEN COALESCE(user_id, visitor_id, platform_username) END) as actualSubscribers
         FROM orders WHERE created_at BETWEEN ? AND ?`
      )
      .bind(startIso, endIso)
      .first<{ totalOrders: number; completedOrders: number; pendingOrders: number; actualSubscribers: number }>(),
    db
      .prepare(`SELECT COUNT(DISTINCT COALESCE(user_id, visitor_id, platform_username)) as cnt FROM orders WHERE status = 'completed'`)
      .first<{ cnt: number }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT visitor_id) as cnt FROM analytics_events
         WHERE event_type IN ('library_open', 'level_view', 'library_search') AND created_at BETWEEN ? AND ?`
      )
      .bind(startIso, endIso)
      .first<{ cnt: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as returningCnt FROM (
           SELECT visitor_id FROM analytics_events WHERE created_at BETWEEN ? AND ?
           GROUP BY visitor_id HAVING COUNT(DISTINCT substr(created_at, 1, 10)) >= 2
         )`
      )
      .bind(startIso, endIso)
      .first<{ returningCnt: number }>(),
    db
      .prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE event_type = 'library_open' AND created_at BETWEEN ? AND ?`)
      .bind(startIso, endIso)
      .first<{ cnt: number }>(),
    db
      .prepare(
        `SELECT grade, section, chapter_num as chapterNum, COUNT(*) as views
         FROM analytics_events
         WHERE event_type = 'level_view' AND chapter_num IS NOT NULL AND created_at BETWEEN ? AND ?
         GROUP BY grade, section, chapter_num ORDER BY views DESC LIMIT 8`
      )
      .bind(startIso, endIso)
      .all<{ grade: string; section: string; chapterNum: number; views: number }>(),
    db
      .prepare(
        `SELECT grade, section, COUNT(*) as views
         FROM analytics_events
         WHERE event_type = 'level_view' AND section IS NOT NULL AND created_at BETWEEN ? AND ?
         GROUP BY grade, section ORDER BY views DESC`
      )
      .bind(startIso, endIso)
      .all<{ grade: string; section: string; views: number }>(),
    db
      .prepare(
        `SELECT query, COUNT(*) as count, MAX(results_count) as lastResults
         FROM analytics_events
         WHERE event_type = 'library_search' AND query IS NOT NULL AND query != '' AND created_at BETWEEN ? AND ?
         GROUP BY query ORDER BY count DESC LIMIT 10`
      )
      .bind(startIso, endIso)
      .all<{ query: string; count: number; lastResults: number }>(),
    db
      .prepare(
        `SELECT query, COUNT(*) as count
         FROM analytics_events
         WHERE event_type = 'library_search' AND query IS NOT NULL AND query != '' AND results_count = 0 AND created_at BETWEEN ? AND ?
         GROUP BY query ORDER BY count DESC LIMIT 10`
      )
      .bind(startIso, endIso)
      .all<{ query: string; count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as totalQuestions,
                SUM(CASE WHEN length(trim(a_text)) < 3 OR trim(a_text) IN ('/', '-', 'TODO', 'قريبا') THEN 1 ELSE 0 END) as incompleteQuestions
         FROM library_questions`
      )
      .first<{ totalQuestions: number; incompleteQuestions: number }>(),
    db.prepare('SELECT COALESCE(SUM(copy_count), 0) as cnt FROM question_stats').first<{ cnt: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as totalRuns,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as succeededRuns,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedRuns,
                COALESCE(AVG(NULLIF(duration_ms, 0)), 0) as avgDurationMs,
                COUNT(DISTINCT COALESCE(user_id, visitor_id)) as toolUsers
         FROM tool_runs WHERE created_at BETWEEN ? AND ?`
      )
      .bind(startIso, endIso)
      .first<{ totalRuns: number; succeededRuns: number; failedRuns: number; avgDurationMs: number; toolUsers: number }>(),
    db
      .prepare(
        `SELECT service_key as serviceKey, COUNT(*) as count,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as succeeded,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM tool_runs WHERE created_at BETWEEN ? AND ?
         GROUP BY service_key ORDER BY count DESC`
      )
      .bind(startIso, endIso)
      .all<{ serviceKey: string; count: number; succeeded: number; failed: number }>(),
    db
      .prepare(`SELECT COUNT(*) as cnt FROM comments WHERE created_at BETWEEN ? AND ?`)
      .bind(startIso, endIso)
      .first<{ cnt: number }>(),
    db
      .prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified FROM comments`)
      .first<{ total: number; verified: number }>(),
    db.prepare(`SELECT COUNT(*) as total FROM likes`).first<{ total: number }>(),
    db
      .prepare(`SELECT COUNT(*) as cnt FROM likes WHERE created_at BETWEEN ? AND ?`)
      .bind(startIso, endIso)
      .first<{ cnt: number }>(),
    db.prepare(`SELECT COUNT(*) as total FROM user_poll_votes`).first<{ total: number }>(),
    db
      .prepare(`SELECT COUNT(*) as cnt FROM user_poll_votes WHERE created_at BETWEEN ? AND ?`)
      .bind(startIso, endIso)
      .first<{ cnt: number }>(),
    db
      .prepare(
        `SELECT c.id, c.author_name as authorName, c.content, c.rating, COUNT(l.item_key) as likesCount
         FROM comments c
         LEFT JOIN likes l ON l.item_key = 'comment:' || c.id
         WHERE c.status = 'approved'
         GROUP BY c.id
         ORDER BY likesCount DESC, c.created_at DESC
         LIMIT 5`
      )
      .all<{ id: string; authorName: string; content: string; rating: number; likesCount: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as totalSearches,
                SUM(CASE WHEN results_count = 0 THEN 1 ELSE 0 END) as zeroResults
         FROM analytics_events WHERE event_type = 'library_search' AND created_at BETWEEN ? AND ?`
      )
      .bind(startIso, endIso)
      .first<{ totalSearches: number; zeroResults: number }>(),
    db
      .prepare(
        `SELECT substr(created_at, 1, 10) as day,
                SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) as visits,
                COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_id END) as uniqueVisitors,
                SUM(CASE WHEN event_type = 'library_open' THEN 1 ELSE 0 END) as libraryOpens,
                SUM(CASE WHEN event_type = 'library_search' THEN 1 ELSE 0 END) as searches
         FROM analytics_events
         WHERE created_at BETWEEN ? AND ?
         GROUP BY substr(created_at, 1, 10) ORDER BY day ASC LIMIT 60`
      )
      .bind(startIso, endIso)
      .all<{ day: string; visits: number; uniqueVisitors: number; libraryOpens: number; searches: number }>(),
    db
      .prepare(
        `SELECT id, service_key as serviceKey, error_message as errorMessage, created_at as createdAt
         FROM tool_runs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`
      )
      .all<{ id: string; serviceKey: string; errorMessage: string | null; createdAt: string }>(),
    getSetting(db, 'tracking_started_at'),
  ]);

  const totalVisitsPeriod = Number(periodVisitsRow?.totalVisits || 0);
  const uniqueInPeriod = Number(periodVisitsRow?.uniqueVisitors || 0);
  const uniqueInPrevPeriod = Number(prevVisitsRow?.uniqueVisitors || 0);
  const interactionsPeriod =
    Number(reviewsInPeriodRow?.cnt || 0) +
    Number(likesInPeriodRow?.cnt || 0) +
    Number(pollVotesPeriodRow?.cnt || 0);

  const returnRatePercent =
    uniqueInPeriod > 0
      ? Math.round((Number(returningVisitorsRow?.returningCnt || 0) / uniqueInPeriod) * 100)
      : 0;

  const topSearches = topSearchesRes.results || [];

  return {
    range: bounds.range,
    from: startIso,
    to: endIso,
    startIso,
    endIso,
    trackingStartedAt: trackingStartedAt || startIso,
    visitors: {
      totalVisits: totalVisitsPeriod,
      prevTotalVisits: Number(prevVisitsRow?.totalVisits || 0),
      visitsDeltaPercent: pctDelta(totalVisitsPeriod, Number(prevVisitsRow?.totalVisits || 0)),
      uniqueVisitors: uniqueInPeriod,
      prevUniqueVisitors: uniqueInPrevPeriod,
      uniqueDeltaPercent: pctDelta(uniqueInPeriod, uniqueInPrevPeriod),
      sessions: Number(activeNowRow?.activeNow || 0),
      activeNow: Number(activeNowRow?.activeNow || 0),
      activeNowWindowLabel: 'آخر 5 دقائق',
      todayVisits: Number(todayVisitsRow?.cnt || 0),
      weekVisits: Number(weekVisitsRow?.cnt || 0),
      monthVisits: Number(monthVisitsRow?.cnt || 0),
      allTimeVisits: Number(allTimeVisitsRow?.total || 0),
      allTimeUnique: Number(allTimeVisitsRow?.uniqueAll || 0),
      topPages: topPagesRes.results || [],
      dailySeries: dailySeriesRes.results || [],
    },
    users: {
      totalRegistered: Number(totalAccountsRow?.cnt || 0),
      newInPeriod: Number(newAccountsRow?.cnt || 0),
      prevNewInPeriod: Number(prevNewAccountsRow?.cnt || 0),
      activeUsers: Number(activeAccountsRow?.cnt || 0),
      completedSubscribers: Number(allCompletedSubscribersRow?.cnt || 0),
      totalOrders: Number(ordersStatsRow?.totalOrders || 0),
    },
    usersAndSubscribers: {
      totalRegisteredUsers: Number(totalAccountsRow?.cnt || 0),
      newUsersInPeriod: Number(newAccountsRow?.cnt || 0),
      newUsersDeltaPercent: pctDelta(
        Number(newAccountsRow?.cnt || 0),
        Number(prevNewAccountsRow?.cnt || 0)
      ),
      activeRegisteredUsers: Number(activeAccountsRow?.cnt || 0),
      actualSubscribersAllTime: Number(allCompletedSubscribersRow?.cnt || 0),
      actualSubscribersInPeriod: Number(ordersStatsRow?.actualSubscribers || 0),
      completedOrdersInPeriod: Number(ordersStatsRow?.completedOrders || 0),
      pendingOrdersInPeriod: Number(ordersStatsRow?.pendingOrders || 0),
      libraryUsersInPeriod: Number(libraryUsersRow?.cnt || 0),
      toolUsersInPeriod: Number(toolStatsRow?.toolUsers || 0),
      returnRatePercent,
    },
    library: {
      opens: Number(libraryOpensRow?.cnt || 0),
      opensInPeriod: Number(libraryOpensRow?.cnt || 0),
      searches: Number(searchesRow?.totalSearches || 0),
      zeroResultSearches: Number(searchesRow?.zeroResults || 0),
      totalCopies: Number(totalCopiesRow?.cnt || 0),
      totalCopiesAllTime: Number(totalCopiesRow?.cnt || 0),
      totalQuestionsCount: Number(libInventoryRow?.totalQuestions || 0),
      incompleteQuestionsCount: Number(libInventoryRow?.incompleteQuestions || 0),
      topLevels: topLevelsRes.results || [],
      topSections: topSectionsRes.results || [],
      topSearchTerms: topSearches.map((t) => ({
        query: t.query,
        count: Number(t.count || 0),
        zeroResults: Number(t.lastResults || 0) === 0 ? 1 : 0,
      })),
      topSearches,
      missingSearches: missingSearchesRes.results || [],
    },
    tool: {
      totalRuns: Number(toolStatsRow?.totalRuns || 0),
      succeededRuns: Number(toolStatsRow?.succeededRuns || 0),
      failedRuns: Number(toolStatsRow?.failedRuns || 0),
      avgDurationMs: Math.round(Number(toolStatsRow?.avgDurationMs || 0)),
      topOperations: topToolOpsRes.results || [],
      recentErrors: recentToolErrorsRes.results || [],
    },
    engagement: {
      totalReviews: Number(totalReviewsRow?.total || 0),
      totalComments: Number(totalReviewsRow?.total || 0),
      verifiedReviews: Number(totalReviewsRow?.verified || 0),
      reviewsInPeriod: Number(reviewsInPeriodRow?.cnt || 0),
      totalLikes: Number(totalLikesRow?.total || 0),
      likesInPeriod: Number(likesInPeriodRow?.cnt || 0),
      totalPollVotes: Number(pollVotesRow?.total || 0),
      pollVotesInPeriod: Number(pollVotesPeriodRow?.cnt || 0),
      engagementRatePercent:
        totalVisitsPeriod > 0
          ? Math.min(100, Math.round((interactionsPeriod / totalVisitsPeriod) * 100))
          : 0,
      topLikedComments: topLikedRes.results || [],
    },
    timeline: (timelineRes.results || []).map((row) => ({
      day: row.day,
      visits: Number(row.visits || 0),
      uniqueVisitors: Number(row.uniqueVisitors || 0),
      libraryOpens: Number(row.libraryOpens || 0),
      searches: Number(row.searches || 0),
    })),
  };
}
