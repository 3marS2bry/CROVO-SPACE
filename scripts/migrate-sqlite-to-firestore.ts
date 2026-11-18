/**
 * Idempotent Migration Script: SQLite Snapshot JSON / Cloudflare D1 SQL Dump -> Firebase Cloud Firestore
 *
 * Strictly $0 / Zero-Billing compatible (Spark & Starter Tier):
 * - Uses Caller Firebase Admin ID Token (FIREBASE_ID_TOKEN env var) via Firestore REST v1 API.
 * - Zero Service Account JSON keys, zero Cloud Billing APIs, zero IAM changes.
 *
 * Usage:
 *   npm run migrate:firestore
 *   npm run migrate:firestore -- --snapshot=data/backups/pre-migration-snapshot-2026-11-18T01-54-00-937Z.json
 *   npm run migrate:firestore -- --d1-sql=d1-backup.sql
 *   FIREBASE_ID_TOKEN="<admin-id-token>" npm run migrate:firestore -- --apply
 */

import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import {
  buildDefaultSiteConfig,
  DEFAULT_TOOL_SERVICES,
  DEFAULT_TOOL_VIDEOS,
  getChapterSectionDefaultTitle,
  type ToolServiceConfig,
  type ToolVideoConfig,
} from '../functions/_lib/defaults';
import {
  createDoc,
  FirestoreHttpError,
  getDoc,
  resolveFirestoreConfig,
  setDoc,
} from '../functions/_lib/firestoreRest';

interface SnapshotBundle {
  analytics_events: Array<Record<string, unknown>>;
  audit_logs: Array<Record<string, unknown>>;
  comments: Array<Record<string, unknown>>;
  library_chapters: Array<Record<string, unknown>>;
  library_questions: Array<Record<string, unknown>>;
  likes: Array<Record<string, unknown>>;
  notification_logs: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  poll_options: Array<Record<string, unknown>>;
  poll_votes: Array<Record<string, unknown>>;
  user_poll_votes: Array<Record<string, unknown>>;
  polls: Array<Record<string, unknown>>;
  push_subscriptions: Array<Record<string, unknown>>;
  question_reports: Array<Record<string, unknown>>;
  question_stats: Array<Record<string, unknown>>;
  settings: Array<Record<string, unknown>>;
  tool_runs: Array<Record<string, unknown>>;
  tool_services: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
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

function safeValidId(raw: unknown, fallbackPrefix: string, index: number): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  if (cleaned && VALID_ID_RE.test(cleaned)) return cleaned;
  return `${fallbackPrefix}_mig_${index}`;
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

function emptyBundle(): SnapshotBundle {
  return {
    analytics_events: [],
    audit_logs: [],
    comments: [],
    library_chapters: [],
    library_questions: [],
    likes: [],
    notification_logs: [],
    orders: [],
    poll_options: [],
    poll_votes: [],
    user_poll_votes: [],
    polls: [],
    push_subscriptions: [],
    question_reports: [],
    question_stats: [],
    settings: [],
    tool_runs: [],
    tool_services: [],
    users: [],
  };
}

function loadJsonSnapshot(filePath: string): SnapshotBundle {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    data?: Partial<Record<keyof SnapshotBundle, unknown[]>>;
  };
  const bundle = emptyBundle();
  const source = (raw.data || raw) as Partial<Record<keyof SnapshotBundle, unknown[]>>;
  for (const key of Object.keys(bundle) as Array<keyof SnapshotBundle>) {
    const arr = source[key];
    if (Array.isArray(arr)) {
      bundle[key] = arr.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
    }
  }
  return bundle;
}

/**
 * Lightweight, SQL-injection-free parser for `wrangler d1 export --remote` SQL output.
 * Supports multi-row `INSERT [OR IGNORE] INTO "table" ("col1", "col2") VALUES (...), (...);`.
 */
export function parseD1SqlExport(sqlText: string): SnapshotBundle {
  const bundle = emptyBundle();
  const len = sqlText.length;
  let pos = 0;

  function skipWhitespace() {
    while (pos < len) {
      const ch = sqlText[pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        pos++;
      } else if (ch === '-' && sqlText[pos + 1] === '-') {
        while (pos < len && sqlText[pos] !== '\n') pos++;
      } else {
        break;
      }
    }
  }

  function parseStringLiteral(): string {
    pos++; // skip opening '
    let out = '';
    while (pos < len) {
      const ch = sqlText[pos];
      if (ch === "'") {
        if (sqlText[pos + 1] === "'") {
          out += "'";
          pos += 2;
        } else {
          pos++;
          break;
        }
      } else {
        out += ch;
        pos++;
      }
    }
    return out;
  }

  function parseValueToken(): unknown {
    skipWhitespace();
    if (pos >= len) return null;
    const ch = sqlText[pos];
    if (ch === "'") {
      return parseStringLiteral();
    }
    if ((ch === 'X' || ch === 'x') && sqlText[pos + 1] === "'") {
      pos++;
      return parseStringLiteral();
    }
    let token = '';
    while (pos < len && sqlText[pos] !== ',' && sqlText[pos] !== ')') {
      token += sqlText[pos];
      pos++;
    }
    const trimmed = token.trim();
    if (!trimmed || trimmed.toUpperCase() === 'NULL') return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }

  function parseValuesClause(columns: string[]): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    while (pos < len) {
      skipWhitespace();
      if (sqlText[pos] !== '(') break;
      pos++; // skip (
      const row: Record<string, unknown> = {};
      let colIdx = 0;
      while (pos < len) {
        const val = parseValueToken();
        if (colIdx < columns.length) {
          row[columns[colIdx]] = val;
        }
        colIdx++;
        skipWhitespace();
        if (sqlText[pos] === ',') {
          pos++;
          continue;
        }
        if (sqlText[pos] === ')') {
          pos++;
          break;
        }
        break;
      }
      rows.push(row);
      skipWhitespace();
      if (sqlText[pos] === ',') {
        pos++;
        continue;
      }
      if (sqlText[pos] === ';') {
        pos++;
      }
      break;
    }
    return rows;
  }

  const insertRe = /INSERT\s+(?:OR\s+IGNORE\s+|OR\s+REPLACE\s+)?INTO\s+["`]?([a-zA-Z0-9_]+)["`]?\s*\(([^)]+)\)\s*VALUES\s*/gi;
  let match: RegExpExecArray | null;
  while ((match = insertRe.exec(sqlText)) !== null) {
    const tableName = match[1] as keyof SnapshotBundle;
    const columns = match[2]
      .split(',')
      .map((c) => c.trim().replace(/^["`]|["`]$/g, ''))
      .filter(Boolean);
    pos = match.index + match[0].length;
    const rows = parseValuesClause(columns);
    if (tableName in bundle) {
      bundle[tableName].push(...rows);
    }
    insertRe.lastIndex = pos;
  }

  return bundle;
}

function buildSiteConfigFromSettings(
  settingsRows: Array<Record<string, unknown>>,
  serviceRows: Array<Record<string, unknown>>
): Record<string, unknown> {
  const map = new Map<string, string>();
  for (const r of settingsRows) {
    const k = String(r.key || '').trim();
    if (!k || k.startsWith('_runtime_')) continue; // NEVER copy runtime secrets to public site_config
    map.set(k, String(r.value ?? ''));
  }

  const base = buildDefaultSiteConfig(map.get('admin_whatsapp_display') || '201550324450');

  let toolVideos: ToolVideoConfig[] = DEFAULT_TOOL_VIDEOS;
  const rawVideos = map.get('tool_videos_json');
  if (rawVideos) {
    try {
      const parsed = JSON.parse(rawVideos);
      if (Array.isArray(parsed) && parsed.length > 0) {
        toolVideos = parsed.slice(0, 30);
      }
    } catch {
      // Keep default videos
    }
  }

  let toolServices: ToolServiceConfig[] = DEFAULT_TOOL_SERVICES;
  if (serviceRows.length > 0) {
    toolServices = serviceRows.slice(0, 30).map((s) => ({
      key: String(s.key || 'service'),
      name: String(s.name || ''),
      grade: String(s.grade || 'bac1'),
      description: String(s.description || ''),
      isVisible: parseBool(s.is_visible),
    }));
  }

  return {
    id: 'public',
    qureoOldPrice: parseIntSafe(map.get('qureo_old_price'), base.qureoOldPrice),
    qureoOfferPrice: parseIntSafe(map.get('qureo_offer_price'), base.qureoOfferPrice),
    finOldPrice: parseIntSafe(map.get('fin_old_price'), base.finOldPrice),
    finOfferPrice: parseIntSafe(map.get('fin_offer_price'), base.finOfferPrice),
    bundleOldPrice: parseIntSafe(map.get('bundle_old_price'), base.bundleOldPrice),
    bundleOfferPrice: parseIntSafe(map.get('bundle_offer_price'), base.bundleOfferPrice),
    offerDurationHours: base.offerDurationHours,
    offerEndsAt: (map.get('offer_ends_at') || base.offerEndsAt).slice(0, 64),
    afterOfferMode: map.get('after_offer_mode') === 'extended_offer' ? 'extended_offer' : 'regular_price',
    ordersEnabled: map.has('orders_enabled') ? parseBool(map.get('orders_enabled')) : base.ordersEnabled,
    pollClosed: map.has('poll_closed') ? parseBool(map.get('poll_closed')) : base.pollClosed,
    whatsappNumber: (map.get('admin_whatsapp_display') || base.whatsappNumber).replace(/\D/g, '').slice(0, 24) || base.whatsappNumber,
    adminWhatsappDisplay:
      (map.get('admin_whatsapp_display') || base.adminWhatsappDisplay).replace(/\D/g, '').slice(0, 24) ||
      base.adminWhatsappDisplay,
    offerText: (base.offerText || '').slice(0, 400),
    notificationsEnabled: map.has('notifications_enabled')
      ? parseBool(map.get('notifications_enabled'))
      : base.notificationsEnabled,
    notificationsIntervalDays: Math.max(
      1,
      Math.min(365, parseIntSafe(map.get('notifications_interval_days'), base.notificationsIntervalDays))
    ),
    heroPromo: {
      enabled: map.has('hero_promo_enabled') ? parseBool(map.get('hero_promo_enabled')) : base.heroPromo.enabled,
      title: (map.get('hero_promo_title') || base.heroPromo.title).slice(0, 200),
      subtitle: (map.get('hero_promo_subtitle') || base.heroPromo.subtitle).slice(0, 400),
    },
    promoBanner: {
      enabled: map.has('promo_banner_enabled') ? parseBool(map.get('promo_banner_enabled')) : base.promoBanner.enabled,
      text: (map.get('promo_banner_text') || base.promoBanner.text).slice(0, 400),
    },
    libraryAd: {
      ...base.libraryAd,
      enabled: map.has('library_ad_enabled') ? parseBool(map.get('library_ad_enabled')) : base.libraryAd.enabled,
      title: (map.get('library_ad_title') || base.libraryAd.title).slice(0, 200),
      subtitle: (map.get('library_ad_subtitle') || base.libraryAd.subtitle).slice(0, 400),
      priceText: (map.get('library_ad_price_text') || base.libraryAd.priceText).slice(0, 120),
      ctaText: (map.get('library_ad_cta') || base.libraryAd.ctaText).slice(0, 80),
      ctaLink: (map.get('library_ad_cta_link') || base.libraryAd.ctaLink || '/#order-section').slice(0, 200),
      imageUrl: map.get('library_ad_image_url') || '',
      delaySeconds: parseIntSafe(map.get('library_ad_delay_seconds'), base.libraryAd.delaySeconds || 18),
      cooldownHours: parseIntSafe(map.get('library_ad_cooldown_hours'), base.libraryAd.cooldownHours || 24),
      templateMode: map.get('library_ad_template_mode') === 'classic' ? 'classic' : 'rich_crovo',
    },
    toolServices,
    toolVideos,
    trackingStartedAt: (map.get('tracking_started_at') || base.trackingStartedAt).slice(0, 64),
  };
}

function buildLibraryBundles(
  chapters: Array<Record<string, unknown>>,
  questions: Array<Record<string, unknown>>
): Array<{ id: string; grade: 'bac1' | 'bac2'; section: 'js' | 'py' | 'fin'; chapters: Array<{ num: number; title: string }>; questions: Array<{ chapterNum: number; qIndex: number; q: string; a: string; code: boolean }> }> {
  const combos: Array<{ grade: 'bac1' | 'bac2'; section: 'js' | 'py' | 'fin' }> = [
    { grade: 'bac1', section: 'js' },
    { grade: 'bac2', section: 'js' },
    { grade: 'bac2', section: 'py' },
    { grade: 'bac2', section: 'fin' },
  ];

  return combos
    .map((c) => {
      const chRows = chapters
        .filter((r) => r.grade === c.grade && r.section === c.section)
        .sort((a, b) => parseIntSafe(a.chapter_num) - parseIntSafe(b.chapter_num))
        .slice(0, 200)
        .map((r) => ({
          num: Math.max(1, parseIntSafe(r.chapter_num, 1)),
          title: String(r.title || getChapterSectionDefaultTitle(c.grade, c.section, parseIntSafe(r.chapter_num, 1))),
        }));

      const qRows = questions
        .filter((q) => q.grade === c.grade && q.section === c.section)
        .sort((a, b) => {
          const chDiff = parseIntSafe(a.chapter_num) - parseIntSafe(b.chapter_num);
          return chDiff !== 0 ? chDiff : parseIntSafe(a.q_index) - parseIntSafe(b.q_index);
        })
        .slice(0, 1000)
        .map((q) => ({
          chapterNum: Math.max(1, parseIntSafe(q.chapter_num, 1)),
          qIndex: Math.max(0, parseIntSafe(q.q_index, 0)),
          q: String(q.q_text || ''),
          a: String(q.a_text || '-'),
          code: parseBool(q.is_code),
        }));

      return {
        id: `${c.grade}_${c.section}`,
        grade: c.grade,
        section: c.section,
        chapters: chRows,
        questions: qRows,
      };
    })
    .filter((b) => b.chapters.length > 0 && b.questions.length > 0);
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const overwriteExisting = args.includes('--overwrite');
  const snapshotArg = args.find((a) => a.startsWith('--snapshot='))?.split('=')[1];
  const d1SqlArg = args.find((a) => a.startsWith('--d1-sql='))?.split('=')[1];

  const defaultSnapshot = path.resolve(
    process.cwd(),
    'data/backups/pre-migration-snapshot-2026-11-18T01-54-00-937Z.json'
  );

  let bundle: SnapshotBundle;
  let sourceDescription: string;

  if (d1SqlArg) {
    const resolved = path.resolve(process.cwd(), d1SqlArg);
    if (!fs.existsSync(resolved)) {
      console.error(`D1 SQL file not found: ${resolved}`);
      process.exit(1);
    }
    bundle = parseD1SqlExport(fs.readFileSync(resolved, 'utf8'));
    sourceDescription = `D1 SQL dump (${resolved})`;
  } else {
    const resolved = path.resolve(process.cwd(), snapshotArg || defaultSnapshot);
    if (!fs.existsSync(resolved)) {
      console.error(`Snapshot JSON not found: ${resolved}`);
      process.exit(1);
    }
    bundle = loadJsonSnapshot(resolved);
    sourceDescription = `SQLite JSON snapshot (${resolved})`;
  }

  const libraryBundles = buildLibraryBundles(bundle.library_chapters, bundle.library_questions);
  const siteConfigPayload = buildSiteConfigFromSettings(bundle.settings, bundle.tool_services);
  const allPollVotes = [...bundle.user_poll_votes, ...bundle.poll_votes];

  const summary = {
    source: sourceDescription,
    mode: isApply ? 'APPLY (writing to Firestore)' : 'DRY-RUN (no network writes)',
    plannedDocuments: {
      site_config: bundle.settings.length > 0 || bundle.tool_services.length > 0 ? 1 : 0,
      library_bundles: libraryBundles.length,
      users: bundle.users.length,
      polls: bundle.polls.length,
      poll_votes: allPollVotes.length,
      comments: bundle.comments.length,
      orders: bundle.orders.length,
      question_stats: bundle.question_stats.length,
      question_reports: bundle.question_reports.length,
      analytics_events: bundle.analytics_events.filter((e) => ALLOWED_ANALYTICS_EVENTS.has(String(e.event_type || ''))).length,
      push_subscriptions: bundle.push_subscriptions.length,
      notification_logs: bundle.notification_logs.length,
      audit_logs: bundle.audit_logs.length,
      tool_runs: bundle.tool_runs.length,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!isApply) {
    console.log(
      '\nDry-run complete. To apply writes into Firestore, sign in as Admin and run:\n  FIREBASE_ID_TOKEN="<id_token>" npm run migrate:firestore -- --apply'
    );
    return;
  }

  const idToken = (process.env.FIREBASE_ID_TOKEN || '').trim();
  if (!idToken) {
    console.error('Missing FIREBASE_ID_TOKEN environment variable for --apply.');
    process.exit(1);
  }

  const cfg = resolveFirestoreConfig(process.env);
  const auth = { idToken };
  let created = 0;
  let skipped = 0;
  let errors = 0;

  async function writeIfNeeded(
    collectionPath: string,
    docId: string,
    data: Record<string, unknown>,
    serverTimeFields: string[]
  ) {
    try {
      const fullPath = `${collectionPath}/${docId}`;
      if (!overwriteExisting) {
        const existing = await getDoc(cfg, fullPath, auth);
        if (existing) {
          skipped += 1;
          return;
        }
      }
      await setDoc(cfg, fullPath, data, serverTimeFields, auth);
      created += 1;
    } catch (err) {
      errors += 1;
      const msg = err instanceof FirestoreHttpError ? `${err.status} ${err.code}: ${err.message}` : String(err);
      console.error(`[FAIL] ${collectionPath}/${docId}: ${msg}`);
    }
  }

  // 1. site_config/public
  if (summary.plannedDocuments.site_config > 0) {
    await writeIfNeeded('site_config', 'public', siteConfigPayload, ['updatedAt']);
  }

  // 2. library_bundles
  for (const b of libraryBundles) {
    await writeIfNeeded('library_bundles', b.id, b as unknown as Record<string, unknown>, ['updatedAt']);
  }

  // 3. users (+ admin marker)
  for (let i = 0; i < bundle.users.length; i++) {
    const u = bundle.users[i];
    const uid = normalizeUid(u.id);
    if (!uid || !VALID_ID_RE.test(uid)) {
      skipped += 1;
      continue;
    }
    const name = String(u.name || 'طالب').trim().slice(0, 80);
    const email = String(u.email || `${uid}@users.crovo.local`).trim().slice(0, 160);
    const userPayload: Record<string, unknown> = {
      uid,
      name: name.length >= 2 ? name : 'طالب CROVO',
      email: email.length >= 3 ? email : `${uid}@users.crovo.local`,
      grade: u.grade === 'bac2' ? 'bac2' : 'bac1',
      role: u.role === 'admin' ? 'admin' : 'user',
      status: u.status === 'suspended' ? 'suspended' : 'active',
    };
    if (typeof u.serial_number === 'string' && /^[A-Z0-9-]+$/.test(u.serial_number)) {
      userPayload.serialNumber = u.serial_number.slice(0, 32);
    }
    if (typeof u.suspend_reason === 'string' && u.suspend_reason.trim()) {
      userPayload.suspendReason = u.suspend_reason.trim().slice(0, 240);
    }
    await writeIfNeeded('users', uid, userPayload, ['createdAt', 'updatedAt']);

    if (userPayload.role === 'admin') {
      try {
        const existingAdmin = await getDoc(cfg, `admins/${uid}`, auth);
        if (!existingAdmin) {
          await createDoc(cfg, 'admins', uid, { uid, email: userPayload.email }, ['createdAt'], auth);
        }
      } catch {
        // Admin marker may already exist or require self-creation
      }
    }
  }

  // 4. polls + votes
  for (let i = 0; i < bundle.polls.length; i++) {
    const p = bundle.polls[i];
    const pollId = safeValidId(p.id, 'poll', i);
    const rawOptions = bundle.poll_options
      .filter((o) => o.poll_id === p.id)
      .sort((a, b) => parseIntSafe(a.sort_order) - parseIntSafe(b.sort_order));

    const pollVotes = allPollVotes.filter((v) => v.poll_id === p.id);
    const countsByKey = new Map<string, number>();
    for (const v of pollVotes) {
      const k = String(v.option_key || v.choice || '');
      if (k) countsByKey.set(k, (countsByKey.get(k) || 0) + 1);
    }

    const options =
      rawOptions.length >= 2
        ? rawOptions.slice(0, 12).map((o, idx) => {
            const key = String(o.option_key || `opt_${idx + 1}`).slice(0, 64);
            return {
              key,
              label: String(o.label || `خيار ${idx + 1}`).slice(0, 100),
              count: countsByKey.get(key) || 0,
            };
          })
        : [
            { key: 'extend', label: 'أيوة، مدهولنا شوية كمان 🙏', count: countsByKey.get('extend') || 0 },
            { key: 'enough', label: 'لا، كده كفاية 👍', count: countsByKey.get('enough') || 0 },
          ];

    const totalVotes = options.reduce((sum, o) => sum + o.count, 0);
    const pollPayload: Record<string, unknown> = {
      id: pollId,
      question: String(p.question || 'إيه رأيكم نمد العرض؟').slice(0, 240),
      options,
      totalVotes,
      isOpen: parseBool(p.is_open),
    };
    if (typeof p.starts_at === 'string' && p.starts_at) pollPayload.startsAt = p.starts_at.slice(0, 64);
    if (typeof p.ends_at === 'string' && p.ends_at) pollPayload.endsAt = p.ends_at.slice(0, 64);

    await writeIfNeeded('polls', pollId, pollPayload, ['createdAt', 'updatedAt']);

    for (const v of pollVotes) {
      const uid = normalizeUid(v.user_id || v.visitor_id);
      const choice = String(v.option_key || v.choice || '').slice(0, 64);
      if (!uid || !VALID_ID_RE.test(uid) || !choice) continue;
      await writeIfNeeded(
        `polls/${pollId}/votes`,
        uid,
        { pollId, userId: uid, choice },
        ['createdAt']
      );
    }
  }

  // 5. comments
  for (let i = 0; i < bundle.comments.length; i++) {
    const c = bundle.comments[i];
    const id = safeValidId(c.id, 'cmt', i);
    const authorUid = normalizeUid(c.user_id || c.visitor_id) || 'legacy_user';
    const content = String(c.content || '').trim().slice(0, 600);
    if (content.length < 4) continue;
    await writeIfNeeded(
      'comments',
      id,
      {
        id,
        authorUid,
        authorName: String(c.author_name || 'طالب').trim().slice(0, 60) || 'طالب',
        grade: String(c.grade || 'أولى بكالوريا').trim().slice(0, 60) || 'أولى بكالوريا',
        rating: Math.max(1, Math.min(5, parseIntSafe(c.rating, 5))),
        content,
        isVerified: parseBool(c.is_verified),
        status: c.status === 'hidden' || c.status === 'flagged' ? c.status : 'approved',
        likesCount: Math.max(0, parseIntSafe(c.likes_count, 0)),
        reportsCount: Math.max(0, parseIntSafe(c.reports_count, 0)),
      },
      ['createdAt', 'updatedAt']
    );
  }

  // 6. orders
  for (let i = 0; i < bundle.orders.length; i++) {
    const o = bundle.orders[i];
    const id = safeValidId(o.id, 'ord', i);
    const authorUid = normalizeUid(o.user_id) || 'guest_order';
    const payload: Record<string, unknown> = {
      id,
      orderCode: String(o.order_code || `CRV-${1000 + i}`).slice(0, 40),
      authorUid,
      fullName: String(o.full_name || 'طالب').trim().slice(0, 120) || 'طالب',
      grade: o.grade === 'bac2' ? 'bac2' : 'bac1',
      platformLabel: String(o.platform_label || 'QUREO').slice(0, 160),
      sectionDetails: String(o.section_details || '').slice(0, 240),
      platformUsername: String(o.platform_username || '-').slice(0, 160),
      encryptedPassword: String(o.encrypted_password || '').slice(0, 2000),
      passwordIv: String(o.password_iv || '').slice(0, 120),
      passwordAuthTag: String(o.password_auth_tag || '').slice(0, 120),
      credentialsPurged: parseBool(o.credentials_purged),
      oldPrice: Math.max(0, parseIntSafe(o.old_price, 100)),
      finalPrice: Math.max(0, parseIntSafe(o.final_price, 50)),
      offerApplied: parseBool(o.offer_applied),
      paymentMethod: String(o.payment_method || 'Vodafone Cash').slice(0, 80),
      status:
        o.status === 'reviewing' || o.status === 'completed' || o.status === 'cancelled' ? o.status : 'new',
    };
    if (typeof o.platforms_json === 'string') payload.platformsJson = o.platforms_json.slice(0, 240);
    await writeIfNeeded('orders', id, payload, ['createdAt', 'updatedAt']);
  }

  // 7. question_stats
  for (let i = 0; i < bundle.question_stats.length; i++) {
    const q = bundle.question_stats[i];
    const questionKey = safeValidId(q.question_key, 'qstat', i);
    await writeIfNeeded(
      'question_stats',
      questionKey,
      {
        questionKey,
        grade: q.grade === 'bac2' ? 'bac2' : 'bac1',
        section: q.section === 'py' || q.section === 'fin' ? q.section : 'js',
        chapterNum: Math.max(1, Math.min(200, parseIntSafe(q.chapter_num, 1))),
        qIndex: Math.max(0, Math.min(1000, parseIntSafe(q.q_index, 0))),
        questionTitle: String(q.question_title || '').slice(0, 300),
        copyCount: Math.max(0, parseIntSafe(q.copy_count, 0)),
      },
      ['updatedAt']
    );
  }

  // 8. question_reports
  for (let i = 0; i < bundle.question_reports.length; i++) {
    const r = bundle.question_reports[i];
    const id = safeValidId(r.id, 'qrep', i);
    const description = String(r.description || 'تبليغ عن إجابة').trim().slice(0, 600);
    await writeIfNeeded(
      'question_reports',
      id,
      {
        id,
        reporterUid: 'guest_report',
        questionKey: safeValidId(r.question_key, 'qkey', i),
        grade: r.grade === 'bac2' ? 'bac2' : 'bac1',
        section: r.section === 'py' || r.section === 'fin' ? r.section : 'js',
        chapterNum: Math.max(1, Math.min(200, parseIntSafe(r.chapter_num, 1))),
        qIndex: Math.max(0, Math.min(1000, parseIntSafe(r.q_index, 0))),
        questionTitle: String(r.question_title || '').slice(0, 300),
        description: description.length >= 4 ? description : 'تبليغ عن إجابة',
        status:
          r.status === 'reviewed' || r.status === 'resolved' || r.status === 'dismissed' ? r.status : 'pending',
      },
      ['createdAt', 'updatedAt']
    );
  }

  // 9. analytics_events
  for (let i = 0; i < bundle.analytics_events.length; i++) {
    const e = bundle.analytics_events[i];
    const eventType = String(e.event_type || '');
    if (!ALLOWED_ANALYTICS_EVENTS.has(eventType)) continue;
    const id = safeValidId(e.id, 'evt', i);
    const visitorId = safeValidId(e.visitor_id, 'v', i);
    const payload: Record<string, unknown> = { id, eventType, visitorId };
    const uid = normalizeUid(e.user_id);
    if (uid && VALID_ID_RE.test(uid)) payload.userId = uid;
    if (typeof e.path === 'string' && e.path) payload.path = e.path.slice(0, 120);
    if (typeof e.grade === 'string' && e.grade) payload.grade = e.grade.slice(0, 16);
    if (typeof e.section === 'string' && e.section) payload.section = e.section.slice(0, 16);
    if (typeof e.chapter_num === 'number') {
      payload.chapterNum = Math.max(0, Math.min(500, Math.round(e.chapter_num)));
    }
    if (typeof e.query === 'string' && e.query) payload.query = e.query.slice(0, 160);
    if (typeof e.results_count === 'number') {
      payload.resultsCount = Math.max(0, Math.min(5000, Math.round(e.results_count)));
    }
    await writeIfNeeded('analytics_events', id, payload, ['createdAt']);
  }

  // 10. notification_logs, audit_logs, tool_runs, push_subscriptions
  for (let i = 0; i < bundle.push_subscriptions.length; i++) {
    const s = bundle.push_subscriptions[i];
    const id = safeValidId(s.id, 'sub', i);
    if (id.length < 8) continue;
    const endpoint = String(s.endpoint || '');
    const p256dh = String(s.p256dh || '');
    const authKey = String(s.auth || '');
    if (endpoint.length < 16 || p256dh.length < 8 || authKey.length < 4) continue;
    await writeIfNeeded(
      'push_subscriptions',
      id,
      {
        id,
        visitorId: safeValidId(s.visitor_id, 'v', i),
        endpoint: endpoint.slice(0, 1000),
        p256dh: p256dh.slice(0, 300),
        auth: authKey.slice(0, 160),
        enabled: parseBool(s.enabled),
      },
      ['createdAt', 'updatedAt']
    );
  }

  for (let i = 0; i < bundle.notification_logs.length; i++) {
    const l = bundle.notification_logs[i];
    const id = safeValidId(l.id, 'nlog', i);
    await writeIfNeeded(
      'notification_logs',
      id,
      {
        id,
        messageId: String(l.message_id || 'migration').slice(0, 80),
        category: String(l.category || 'offer').slice(0, 32),
        title: String(l.title || '').slice(0, 160),
        body: String(l.body || '').slice(0, 400),
        sentCount: Math.max(0, parseIntSafe(l.sent_count, 0)),
        failedCount: Math.max(0, parseIntSafe(l.failed_count, 0)),
        triggerType: String(l.trigger_type || 'manual').slice(0, 32),
      },
      ['createdAt']
    );
  }

  for (let i = 0; i < bundle.audit_logs.length; i++) {
    const a = bundle.audit_logs[i];
    const id = safeValidId(a.id, 'aud', i);
    await writeIfNeeded(
      'audit_logs',
      id,
      {
        id,
        actorUsername: String(a.actor_username || 'admin').slice(0, 160),
        action: String(a.action || 'legacy_audit').slice(0, 80),
        targetType: String(a.target_type || 'system').slice(0, 80),
        ...(typeof a.target_id === 'string' && a.target_id ? { targetId: a.target_id.slice(0, 128) } : {}),
        ...(typeof a.details_json === 'string' && a.details_json ? { detailsJson: a.details_json.slice(0, 1500) } : {}),
      },
      ['createdAt']
    );
  }

  for (let i = 0; i < bundle.tool_runs.length; i++) {
    const t = bundle.tool_runs[i];
    const id = safeValidId(t.id, 'trun', i);
    await writeIfNeeded(
      'tool_runs',
      id,
      {
        id,
        serviceKey: String(t.service_key || 'qureo').slice(0, 64),
        status: t.status === 'failed' || t.status === 'running' ? t.status : 'success',
        durationMs: Math.max(0, Math.min(600_000, parseIntSafe(t.duration_ms, 0))),
      },
      ['createdAt']
    );
  }

  console.log(`\nMigration complete: created=${created}, skippedExisting=${skipped}, errors=${errors}`);
  if (errors > 0) process.exit(1);
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
