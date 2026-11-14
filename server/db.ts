import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PricingConfig } from './domain.ts';

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

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors if transaction already closed
    }
    throw err;
  }
}

function safeAddColumn(db: DatabaseSync, table: string, columnDef: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch {
    // Column already exists
  }
}

export function checkpointDatabase(db: DatabaseSync, truncate = false): void {
  try {
    db.exec(truncate ? 'PRAGMA wal_checkpoint(TRUNCATE)' : 'PRAGMA wal_checkpoint(PASSIVE)');
  } catch {
    // Ignore on :memory:
  }
}

export function createDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = FULL;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Registered Users & RBAC
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      grade TEXT NOT NULL DEFAULT 'bac1',
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      suspend_reason TEXT,
      last_active_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      user_id TEXT,
      author_name TEXT NOT NULL,
      grade TEXT NOT NULL,
      rating INTEGER NOT NULL,
      content TEXT NOT NULL,
      avatar_url TEXT,
      attachment_url TEXT,
      contact_phone TEXT,
      show_contact_publicly INTEGER NOT NULL DEFAULT 0,
      is_verified INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'approved',
      moderation_note TEXT,
      reports_count INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_comments_status_created ON comments(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_visitor ON comments(visitor_id);

    CREATE TABLE IF NOT EXISTS comment_reports (
      id TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(comment_id, visitor_id),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS likes (
      item_key TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (item_key, visitor_id)
    );

    -- Legacy poll_votes preserved if present; new strict poll system uses polls/poll_options/user_poll_votes
    CREATE TABLE IF NOT EXISTS poll_votes (
      visitor_id TEXT PRIMARY KEY,
      choice TEXT NOT NULL CHECK (choice IN ('extend', 'enough')),
      ip_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      question TEXT NOT NULL,
      is_open INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      option_key TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(poll_id, option_key),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_poll_votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      option_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(poll_id, user_id),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_poll_votes_poll ON user_poll_votes(poll_id, option_key);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_code TEXT UNIQUE NOT NULL,
      client_request_id TEXT UNIQUE,
      visitor_id TEXT NOT NULL,
      user_id TEXT,
      full_name TEXT NOT NULL,
      grade TEXT NOT NULL,
      platforms_json TEXT NOT NULL,
      platform_label TEXT NOT NULL,
      section_details TEXT NOT NULL,
      platform_username TEXT NOT NULL,
      encrypted_password TEXT,
      password_iv TEXT,
      password_auth_tag TEXT,
      credentials_purged INTEGER NOT NULL DEFAULT 0,
      old_price INTEGER NOT NULL,
      final_price INTEGER NOT NULL,
      offer_applied INTEGER NOT NULL DEFAULT 1,
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      whatsapp_status TEXT NOT NULL DEFAULT 'click_to_chat',
      whatsapp_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_visitor ON orders(visitor_id);

    CREATE TABLE IF NOT EXISTS uploaded_media (
      id TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_stats (
      question_key TEXT PRIMARY KEY,
      grade TEXT NOT NULL,
      section TEXT NOT NULL,
      chapter_num INTEGER NOT NULL,
      q_index INTEGER NOT NULL,
      question_title TEXT NOT NULL,
      copy_count INTEGER NOT NULL DEFAULT 0,
      last_copied_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_question_stats_copies ON question_stats(copy_count DESC);

    CREATE TABLE IF NOT EXISTS question_reports (
      id TEXT PRIMARY KEY,
      question_key TEXT NOT NULL,
      grade TEXT NOT NULL,
      section TEXT NOT NULL,
      chapter_num INTEGER NOT NULL,
      q_index INTEGER NOT NULL,
      question_title TEXT NOT NULL,
      description TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      UNIQUE(question_key, visitor_id)
    );

    CREATE INDEX IF NOT EXISTS idx_qreports_status_created ON question_reports(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      user_id TEXT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_sent_at TEXT,
      last_message_id TEXT,
      last_error TEXT,
      last_error_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_push_enabled ON push_subscriptions(enabled, last_sent_at);

    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      trigger_type TEXT NOT NULL,
      error_detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notif_logs_created ON notification_logs(created_at DESC);

    -- Solutions Library CMS
    CREATE TABLE IF NOT EXISTS library_chapters (
      id TEXT PRIMARY KEY,
      grade TEXT NOT NULL,
      section TEXT NOT NULL,
      chapter_num INTEGER NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      UNIQUE(grade, section, chapter_num)
    );

    CREATE INDEX IF NOT EXISTS idx_lib_chapters_gs ON library_chapters(grade, section, sort_order);

    CREATE TABLE IF NOT EXISTS library_questions (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      grade TEXT NOT NULL,
      section TEXT NOT NULL,
      chapter_num INTEGER NOT NULL,
      q_index INTEGER NOT NULL,
      q_text TEXT NOT NULL,
      a_text TEXT NOT NULL,
      is_code INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      FOREIGN KEY (chapter_id) REFERENCES library_chapters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_lib_questions_lookup ON library_questions(grade, section, chapter_num, q_index);

    -- Tool Services & Execution Tracking
    CREATE TABLE IF NOT EXISTS tool_services (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      grade TEXT NOT NULL,
      description TEXT NOT NULL,
      is_visible INTEGER NOT NULL DEFAULT 1,
      config_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      visitor_id TEXT,
      service_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'running')),
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_runs_created ON tool_runs(created_at DESC);

    -- Real Visitor & Behavior Analytics (Never Mocked)
    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      user_id TEXT,
      session_id TEXT,
      path TEXT,
      grade TEXT,
      section TEXT,
      chapter_num INTEGER,
      query TEXT,
      results_count INTEGER,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_type_created ON analytics_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_visitor_created ON analytics_events(visitor_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);

    -- Admin Audit Log
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details_json TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
  `);

  // Safe migrations on existing DB columns
  safeAddColumn(db, 'comments', 'user_id TEXT');
  safeAddColumn(db, 'comments', 'moderation_note TEXT');
  safeAddColumn(db, 'likes', 'user_id TEXT');
  safeAddColumn(db, 'orders', 'user_id TEXT');
  safeAddColumn(db, 'push_subscriptions', 'user_id TEXT');
  safeAddColumn(db, 'push_subscriptions', 'last_error TEXT');
  safeAddColumn(db, 'push_subscriptions', 'last_error_at TEXT');
  safeAddColumn(db, 'notification_logs', 'error_detail TEXT');

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_item_user ON likes(item_key, user_id) WHERE user_id IS NOT NULL`);
  } catch {
    // Ignore if index already exists
  }

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
    ['admin_whatsapp_display', process.env.ADMIN_WHATSAPP_NUMBER || '201550324450'],
    ['tracking_started_at', nowIso],
    ['phase2_test_cleanup_done', nowIso],
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) {
    insertSetting.run(k, v);
  }

  return db;
}

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function getSiteConfig(db: DatabaseSync): PublicSiteConfig {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const map = new Map<string, string>();
  for (const r of rows) {
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

  let services: PublicSiteConfig['toolServices'] = [];
  try {
    const svcRows = db
      .prepare('SELECT key, name, grade, description, is_visible FROM tool_services ORDER BY grade ASC, key ASC')
      .all() as Array<{ key: string; name: string; grade: string; description: string; is_visible: number }>;
    services = svcRows.map((s) => ({
      key: s.key,
      name: s.name,
      grade: s.grade,
      description: s.description,
      isVisible: s.is_visible === 1,
    }));
  } catch {
    services = [];
  }

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

export function purgeExpiredOrderCredentials(db: DatabaseSync, maxAgeHours = 168): number {
  const cutoffIso = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
  const result = db
    .prepare(
      `UPDATE orders
       SET encrypted_password = NULL,
           password_iv = NULL,
           password_auth_tag = NULL,
           credentials_purged = 1,
           updated_at = ?
       WHERE credentials_purged = 0
         AND (status IN ('completed', 'cancelled') OR created_at < ?)`
    )
    .run(new Date().toISOString(), cutoffIso);
  return Number(result.changes || 0);
}

export function checkDatabaseIntegrity(db: DatabaseSync): { ok: boolean; detail: string } {
  try {
    const row = db.prepare('PRAGMA quick_check').get() as Record<string, string> | undefined;
    const val = row ? Object.values(row)[0] : 'unknown';
    return { ok: val === 'ok', detail: String(val) };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'error' };
  }
}

export function createDatabaseBackup(
  db: DatabaseSync,
  backupsDir: string
): { filename: string; sizeBytes: number; createdAt: string } {
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `crovo-backup-${stamp}.db`;
  const target = path.join(backupsDir, filename);

  const escaped = target.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);

  const stat = fs.statSync(target);

  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith('crovo-backup-') && f.endsWith('.db'))
    .sort()
    .reverse();

  for (const old of files.slice(5)) {
    try {
      fs.unlinkSync(path.join(backupsDir, old));
    } catch {
      // Ignore cleanup errors
    }
  }

  return {
    filename,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
  };
}

export function listDatabaseBackups(
  backupsDir: string
): Array<{ filename: string; sizeBytes: number; createdAt: string }> {
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith('crovo-backup-') && f.endsWith('.db'))
    .sort()
    .reverse()
    .map((filename) => {
      const stat = fs.statSync(path.join(backupsDir, filename));
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    });
}
