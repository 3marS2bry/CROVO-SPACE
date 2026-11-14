import type { AuthUser, D1Database, Env, PagesFunction } from '../_lib/types';
import {
  decryptSecret,
  encryptSecret,
  generateId,
  hashIp,
  hashPassword,
  randomHex,
  safeCompareStrings,
  sha256Hex,
  signToken,
  verifyPassword,
  verifyToken,
} from '../_lib/crypto';
import {
  calculateOrderPricing,
  formatOrderCode,
  isOfferCurrentlyActive,
  validateBase64Image,
  validateCommentPayload,
  validateOrderPayload,
  validateQuestionReportPayload,
} from '../_lib/domain';
import {
  ensureDefaultSettingsIfNeeded,
  getDashboardAnalytics,
  getPollSummary,
  getSetting,
  getSiteConfig,
  logAdminAudit,
  migrateVisitorActivityToUser,
  NOTIFICATION_TEMPLATES,
  purgeExpiredOrderCredentials,
  recordAnalyticsEvent,
  setSetting,
} from '../_lib/db';

interface RequestCtx {
  request: Request;
  url: URL;
  path: string;
  method: string;
  env: Env;
  db: D1Database;
  visitorId: string;
  visitorToken: string;
  ipHash: string;
  currentUser: AuthUser | null;
  sessionSecret: string;
  encryptionKey: string;
  adminUsername: string;
  adminPassword: string;
  cookies: Record<string, string>;
  setCookies: string[];
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

async function resolveSecrets(db: D1Database, env: Env): Promise<{ sessionSecret: string; encryptionKey: string }> {
  const envSession = (env.SESSION_SECRET || '').trim();
  const envEnc = (env.CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (envSession && envEnc) {
    return { sessionSecret: envSession, encryptionKey: envEnc };
  }

  let sessionSecret = envSession || (await getSetting(db, '_edge_session_secret')) || '';
  let encryptionKey = envEnc || (await getSetting(db, '_edge_encryption_key')) || '';

  if (!sessionSecret) {
    sessionSecret = randomHex(32);
    await setSetting(db, '_edge_session_secret', sessionSecret);
  }
  if (!encryptionKey) {
    encryptionKey = randomHex(32);
    await setSetting(db, '_edge_encryption_key', encryptionKey);
  }

  return { sessionSecret, encryptionKey };
}

async function createUserSession(ctx: RequestCtx, userId: string): Promise<string> {
  const rawToken = randomHex(32);
  const tokenHash = await sha256Hex(rawToken);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await ctx.db
    .prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(generateId('usess'), userId, tokenHash, expiresAt, nowIso, nowIso)
    .run();

  ctx.setCookies.push(serializeCookie(ctx.request, 'crovo_user', rawToken, 30 * 24 * 60 * 60));
  return rawToken;
}

async function getAdminSession(ctx: RequestCtx): Promise<{ username: string } | null> {
  if (ctx.currentUser && ctx.currentUser.role === 'admin' && ctx.currentUser.status === 'active') {
    return { username: ctx.currentUser.email };
  }

  const headerAdmin = (ctx.request.headers.get('x-crovo-admin-token') || '').trim();
  const token = ctx.cookies['crovo_admin'] || headerAdmin;
  if (!token) return null;

  const payload = await verifyToken<{ role?: string; username?: string; exp?: number }>(token, ctx.sessionSecret);
  if (!payload || payload.role !== 'admin') return null;
  if (!ctx.adminUsername || !(await safeCompareStrings(payload.username || '', ctx.adminUsername))) {
    return null;
  }
  return { username: payload.username || ctx.adminUsername };
}

async function saveUploadedImage(
  db: D1Database,
  data: { ext: string; mimeType: string; bytes: Uint8Array } | null
): Promise<string | null> {
  if (!data) return null;
  const filename = `${generateId('img')}.${data.ext}`;
  const nowIso = new Date().toISOString();

  await db
    .prepare('INSERT INTO uploaded_media (id, mime_type, data, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(filename, data.mimeType, data.bytes, data.bytes.byteLength, nowIso)
    .run();

  return `/uploads/${filename}`;
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const db = env.DB;
  if (!db) {
    return new Response(
      JSON.stringify({ error: 'Cloudflare D1 binding (DB) is not configured.' }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  await ensureDefaultSettingsIfNeeded(db, env);
  const { sessionSecret, encryptionKey } = await resolveSecrets(db, env);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const cookies = parseCookies(request.headers.get('cookie'));
  const setCookies: string[] = [];

  // Resolve visitor token
  const headerVisitor = (request.headers.get('x-crovo-visitor') || '').trim();
  const candidateVisitor = cookies['crovo_visitor'] || headerVisitor;
  const parsedVisitor = candidateVisitor
    ? await verifyToken<{ vid?: string }>(candidateVisitor, sessionSecret)
    : null;

  let visitorId: string;
  let visitorToken: string;
  if (parsedVisitor && typeof parsedVisitor.vid === 'string' && parsedVisitor.vid.length >= 6) {
    visitorId = parsedVisitor.vid;
    visitorToken = candidateVisitor;
    if (!cookies['crovo_visitor']) {
      setCookies.push(serializeCookie(request, 'crovo_visitor', candidateVisitor, 365 * 24 * 60 * 60));
    }
  } else {
    visitorId = generateId('v');
    visitorToken = await signToken({ vid: visitorId }, sessionSecret);
    setCookies.push(serializeCookie(request, 'crovo_visitor', visitorToken, 365 * 24 * 60 * 60));
  }

  const clientIp =
    (request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown');
  const ipHash = await hashIp(clientIp, sessionSecret);

  // Resolve authenticated user
  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const userRawToken = cookies['crovo_user'] || bearerToken;
  let currentUser: AuthUser | null = null;

  if (userRawToken) {
    const tokenHash = await sha256Hex(userRawToken);
    const sessionRow = await db
      .prepare(
        `SELECT s.id as sessionId, s.expires_at as expiresAt,
                u.id, u.name, u.email, u.grade, u.role, u.status, u.suspend_reason as suspendReason
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .bind(tokenHash)
      .first<{
        sessionId: string;
        expiresAt: string;
        id: string;
        name: string;
        email: string;
        grade: 'bac1' | 'bac2';
        role: 'user' | 'admin';
        status: 'active' | 'suspended';
        suspendReason: string | null;
      }>();

    if (sessionRow && Date.parse(sessionRow.expiresAt) > Date.now() && sessionRow.status === 'active') {
      currentUser = {
        id: sessionRow.id,
        name: sessionRow.name,
        email: sessionRow.email,
        grade: sessionRow.grade,
        role: sessionRow.role,
        status: sessionRow.status,
        suspendReason: sessionRow.suspendReason,
      };
      const nowIso = new Date().toISOString();
      await db.batch([
        db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?').bind(nowIso, sessionRow.sessionId),
        db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').bind(nowIso, sessionRow.id),
      ]);
    }
  }

  const ctx: RequestCtx = {
    request,
    url,
    path,
    method,
    env,
    db,
    visitorId,
    visitorToken,
    ipHash,
    currentUser,
    sessionSecret,
    encryptionKey,
    adminUsername: (env.ADMIN_USERNAME || '').trim(),
    adminPassword: env.ADMIN_PASSWORD || '',
    cookies,
    setCookies,
  };

  // Health Check
  if (method === 'GET' && path === '/api/health') {
    const probe = await db.prepare('SELECT 1 as ok').first<{ ok: number }>();
    return jsonResponse(ctx, { ok: probe?.ok === 1, engine: 'cloudflare-d1', serverTime: new Date().toISOString() });
  }

  // ==================== AUTH ROUTES ====================
  if (method === 'POST' && path === '/api/auth/register') {
    const body = await readJsonBody(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const grade = body.grade === 'bac2' ? 'bac2' : 'bac1';

    if (name.length < 2 || name.length > 60) {
      return jsonResponse(ctx, { error: 'اكتب اسمك الكامل (حرفين على الأقل).' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
      return jsonResponse(ctx, { error: 'من فضلك اكتب بريد إلكتروني صحيح.' }, 400);
    }
    if (password.length < 6 || password.length > 128) {
      return jsonResponse(ctx, { error: 'كلمة المرور لازم تكون 6 أحرف على الأقل.' }, 400);
    }

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) {
      return jsonResponse(ctx, { error: 'البريد الإلكتروني مسجل بالفعل. جرب تسجيل الدخول.' }, 409);
    }

    const id = generateId('usr');
    const nowIso = new Date().toISOString();
    const passHash = await hashPassword(password);

    await db
      .prepare(
        `INSERT INTO users (id, name, email, password_hash, grade, role, status, last_active_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`
      )
      .bind(id, name, email, passHash, grade, nowIso, nowIso)
      .run();

    await migrateVisitorActivityToUser(db, visitorId, id);
    const token = await createUserSession(ctx, id);

    return jsonResponse(
      ctx,
      {
        ok: true,
        token,
        user: { id, name, email, grade, role: 'user', status: 'active' },
      },
      201
    );
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const body = await readJsonBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return jsonResponse(ctx, { error: 'اكتب البريد الإلكتروني وكلمة المرور.' }, 400);
    }

    const userRow = await db
      .prepare('SELECT id, name, email, password_hash, grade, role, status, suspend_reason FROM users WHERE email = ?')
      .bind(email)
      .first<{
        id: string;
        name: string;
        email: string;
        password_hash: string;
        grade: 'bac1' | 'bac2';
        role: 'user' | 'admin';
        status: 'active' | 'suspended';
        suspend_reason: string | null;
      }>();

    if (!userRow || !(await verifyPassword(password, userRow.password_hash))) {
      return jsonResponse(ctx, { error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' }, 401);
    }

    if (userRow.status === 'suspended') {
      return jsonResponse(
        ctx,
        { error: `تم إيقاف هذا الحساب مؤقتًا: ${userRow.suspend_reason || 'تواصل مع الإدارة'}.` },
        403
      );
    }

    await db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').bind(new Date().toISOString(), userRow.id).run();
    await migrateVisitorActivityToUser(db, visitorId, userRow.id);
    const token = await createUserSession(ctx, userRow.id);

    return jsonResponse(ctx, {
      ok: true,
      token,
      user: {
        id: userRow.id,
        name: userRow.name,
        email: userRow.email,
        grade: userRow.grade,
        role: userRow.role,
        status: userRow.status,
      },
    });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    if (userRawToken) {
      await db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').bind(await sha256Hex(userRawToken)).run();
    }
    ctx.setCookies.push(serializeCookie(request, 'crovo_user', '', 0));
    return jsonResponse(ctx, { ok: true });
  }

  if (method === 'GET' && path === '/api/auth/me') {
    if (!currentUser) {
      return jsonResponse(ctx, { authenticated: false, user: null });
    }
    return jsonResponse(ctx, { authenticated: true, user: currentUser });
  }

  // ==================== PUBLIC CONFIG / LIBRARY / ANALYTICS ====================
  if (method === 'GET' && path === '/api/config') {
    await purgeExpiredOrderCredentials(db);
    const config = await getSiteConfig(db);
    const nowMs = Date.now();
    return jsonResponse(ctx, {
      ...config,
      offerActive: isOfferCurrentlyActive(config, nowMs),
      serverTime: new Date(nowMs).toISOString(),
    });
  }

  if (method === 'GET' && path === '/api/library') {
    const grade = url.searchParams.get('grade') === 'bac2' ? 'bac2' : 'bac1';
    const secParam = url.searchParams.get('section');
    const section =
      grade === 'bac1' ? 'js' : secParam === 'py' || secParam === 'fin' ? secParam : 'js';

    const [chapterRes, questionRes] = await Promise.all([
      db
        .prepare(
          `SELECT id, chapter_num as num, title
           FROM library_chapters
           WHERE grade = ? AND section = ?
           ORDER BY sort_order ASC, chapter_num ASC`
        )
        .bind(grade, section)
        .all<{ id: string; num: number; title: string }>(),
      db
        .prepare(
          `SELECT chapter_num as chapterNum, q_text as q, a_text as a, is_code as isCode
           FROM library_questions
           WHERE grade = ? AND section = ?
           ORDER BY chapter_num ASC, q_index ASC`
        )
        .bind(grade, section)
        .all<{ chapterNum: number; q: string; a: string; isCode: number }>(),
    ]);

    const byChapter = new Map<number, Array<{ q: string; a: string; code: boolean }>>();
    for (const row of questionRes.results || []) {
      const arr = byChapter.get(row.chapterNum) || [];
      arr.push({ q: row.q, a: row.a, code: Number(row.isCode) === 1 });
      byChapter.set(row.chapterNum, arr);
    }

    const chapters = (chapterRes.results || []).map((c) => ({
      num: c.num,
      title: c.title,
      qs: byChapter.get(c.num) || [],
    }));

    return jsonResponse(ctx, { grade, section, chapters });
  }

  if (method === 'POST' && path === '/api/analytics/event') {
    const body = await readJsonBody(request);
    const eventType = typeof body.eventType === 'string' ? body.eventType.trim() : '';
    const allowed = ['page_view', 'library_open', 'level_view', 'library_search', 'tool_view'];
    if (!allowed.includes(eventType)) {
      return jsonResponse(ctx, { error: 'نوع الحدث غير مدعوم.' }, 400);
    }

    await recordAnalyticsEvent(db, {
      eventType,
      visitorId,
      userId: currentUser?.id || null,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      path: typeof body.path === 'string' ? body.path : null,
      grade: body.grade === 'bac2' ? 'bac2' : body.grade === 'bac1' ? 'bac1' : null,
      section:
        body.section === 'py' || body.section === 'fin' || body.section === 'js'
          ? body.section
          : null,
      chapterNum: typeof body.chapterNum === 'number' ? body.chapterNum : null,
      query: typeof body.query === 'string' ? body.query : null,
      resultsCount: typeof body.resultsCount === 'number' ? body.resultsCount : null,
    });

    return jsonResponse(ctx, { ok: true }, 202);
  }

  // ==================== QUESTION STATS & REPORTS ====================
  if (method === 'GET' && path === '/api/questions/stats') {
    const [totalRow, allRes, topRes] = await Promise.all([
      db.prepare('SELECT COALESCE(SUM(copy_count), 0) as totalCopies FROM question_stats').first<{ totalCopies: number }>(),
      db.prepare('SELECT question_key, copy_count FROM question_stats WHERE copy_count > 0').all<{
        question_key: string;
        copy_count: number;
      }>(),
      db
        .prepare(
          `SELECT question_key as questionKey, grade, section, chapter_num as chapterNum,
                  q_index as qIndex, question_title as questionTitle, copy_count as copyCount
           FROM question_stats
           WHERE copy_count > 0
           ORDER BY copy_count DESC, last_copied_at DESC
           LIMIT 6`
        )
        .all<{
          questionKey: string;
          grade: string;
          section: string;
          chapterNum: number;
          qIndex: number;
          questionTitle: string;
          copyCount: number;
        }>(),
    ]);

    const copyCounts: Record<string, number> = {};
    for (const r of allRes.results || []) {
      copyCounts[r.question_key] = Number(r.copy_count);
    }

    return jsonResponse(ctx, {
      totalCopies: Number(totalRow?.totalCopies || 0),
      copyCounts,
      topQuestions: topRes.results || [],
    });
  }

  if (method === 'POST' && path === '/api/questions/copy') {
    const body = await readJsonBody(request);
    const questionKey = typeof body.questionKey === 'string' ? body.questionKey.trim() : '';
    if (!/^[a-zA-Z0-9_-]{4,60}$/.test(questionKey)) {
      return jsonResponse(ctx, { error: 'معرّف السؤال غير صالح.' }, 400);
    }

    const grade = body.grade === 'bac2' ? 'bac2' : 'bac1';
    const section = body.section === 'py' || body.section === 'fin' ? body.section : 'js';
    const chapterNum = Math.max(1, Math.min(200, Math.round(Number(body.chapterNum) || 1)));
    const qIndex = Math.max(0, Math.min(500, Math.round(Number(body.qIndex) || 0)));
    const questionTitle =
      typeof body.questionTitle === 'string' && body.questionTitle.trim()
        ? body.questionTitle.trim().slice(0, 180)
        : `السؤال ${qIndex + 1}`;
    const nowIso = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO question_stats (
          question_key, grade, section, chapter_num, q_index, question_title, copy_count, last_copied_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(question_key) DO UPDATE SET
          copy_count = question_stats.copy_count + 1,
          question_title = excluded.question_title,
          last_copied_at = excluded.last_copied_at`
      )
      .bind(questionKey, grade, section, chapterNum, qIndex, questionTitle, nowIso)
      .run();

    const row = await db
      .prepare('SELECT copy_count FROM question_stats WHERE question_key = ?')
      .bind(questionKey)
      .first<{ copy_count: number }>();

    return jsonResponse(ctx, { ok: true, questionKey, copyCount: Number(row?.copy_count || 1) });
  }

  if (method === 'POST' && path === '/api/questions/report') {
    const body = await readJsonBody(request);
    try {
      const input = validateQuestionReportPayload(body);
      const id = generateId('qrep');
      const nowIso = new Date().toISOString();

      try {
        await db
          .prepare(
            `INSERT INTO question_reports (
              id, question_key, grade, section, chapter_num, q_index, question_title,
              description, visitor_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
          )
          .bind(
            id,
            input.questionKey,
            input.grade,
            input.section,
            input.chapterNum,
            input.qIndex,
            input.questionTitle,
            input.description,
            visitorId,
            nowIso
          )
          .run();
      } catch {
        return jsonResponse(ctx, { error: 'أنت بلغت عن السؤال ده قبل كده بالفعل، والبلاغ تحت المراجعة.' }, 409);
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
    } catch (err) {
      return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'تعذر إرسال البلاغ.' }, 400);
    }
  }

  // ==================== PUSH NOTIFICATIONS ====================
  if (method === 'GET' && path === '/api/push/vapid-public-key') {
    const config = await getSiteConfig(db);
    const pubKey = (env.VAPID_PUBLIC_KEY || (await getSetting(db, 'vapid_public_key')) || '').trim();
    return jsonResponse(ctx, {
      publicKey: pubKey,
      enabled: config.notificationsEnabled,
      intervalDays: config.notificationsIntervalDays,
    });
  }

  if (method === 'GET' && path === '/api/push/status') {
    const config = await getSiteConfig(db);
    const row = currentUser
      ? await db
          .prepare(
            'SELECT endpoint, enabled, updated_at FROM push_subscriptions WHERE (user_id = ? OR visitor_id = ?) AND enabled = 1 LIMIT 1'
          )
          .bind(currentUser.id, visitorId)
          .first<{ endpoint: string }>()
      : await db
          .prepare('SELECT endpoint, enabled, updated_at FROM push_subscriptions WHERE visitor_id = ? AND enabled = 1 LIMIT 1')
          .bind(visitorId)
          .first<{ endpoint: string }>();

    return jsonResponse(ctx, {
      subscribed: Boolean(row),
      notificationsEnabled: config.notificationsEnabled,
      intervalDays: config.notificationsIntervalDays,
    });
  }

  if (method === 'POST' && path === '/api/push/subscribe') {
    const body = await readJsonBody(request);
    const keys = (body.keys && typeof body.keys === 'object' ? body.keys : {}) as Record<string, unknown>;
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
    const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';

    if (!endpoint.startsWith('https://') || endpoint.length > 1000 || !p256dh || !auth) {
      return jsonResponse(ctx, { error: 'بيانات اشتراك الإشعارات غير صالحة.' }, 400);
    }

    const nowIso = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO push_subscriptions (id, visitor_id, user_id, endpoint, p256dh, auth, enabled, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           visitor_id = excluded.visitor_id,
           user_id = COALESCE(excluded.user_id, push_subscriptions.user_id),
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           enabled = 1,
           last_error = NULL,
           updated_at = excluded.updated_at`
      )
      .bind(generateId('sub'), visitorId, currentUser?.id || null, endpoint, p256dh, auth, nowIso, nowIso)
      .run();

    return jsonResponse(ctx, { ok: true, subscribed: true }, 201);
  }

  if (method === 'POST' && path === '/api/push/unsubscribe') {
    const body = await readJsonBody(request);
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
    const nowIso = new Date().toISOString();

    if (endpoint) {
      await db.prepare('UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE endpoint = ?').bind(nowIso, endpoint).run();
    } else if (currentUser) {
      await db
        .prepare('UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE user_id = ? OR visitor_id = ?')
        .bind(nowIso, currentUser.id, visitorId)
        .run();
    } else {
      await db.prepare('UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE visitor_id = ?').bind(nowIso, visitorId).run();
    }

    return jsonResponse(ctx, { ok: true, subscribed: false });
  }

  if (method === 'POST' && path === '/api/push/log-error') {
    const body = await readJsonBody(request);
    const stage = typeof body.stage === 'string' ? body.stage.slice(0, 40) : 'unknown';
    const errorCode = typeof body.errorCode === 'string' ? body.errorCode.slice(0, 80) : 'unknown';
    const detail = typeof body.detail === 'string' ? body.detail.slice(0, 180) : '';
    try {
      await db
        .prepare(
          `INSERT INTO notification_logs (id, message_id, category, title, body, sent_count, failed_count, trigger_type, error_detail, created_at)
           VALUES (?, 'client_diagnostic', 'update', ?, ?, 0, 1, 'client_error', ?, ?)`
        )
        .bind(
          generateId('pusherr'),
          `فشل تفعيل إشعارات (${stage})`,
          detail || errorCode,
          `${stage}: ${errorCode}`,
          new Date().toISOString()
        )
        .run();
    } catch {
      // Ignore diagnostic logging error
    }
    return jsonResponse(ctx, { ok: true }, 202);
  }

  // ==================== COMMENTS & REPORTS ====================
  if (method === 'GET' && path === '/api/comments') {
    const [rowsRes, likeCountsRes, userLikedRes] = await Promise.all([
      db
        .prepare(
          `SELECT id, visitor_id, user_id, author_name, grade, rating, content, avatar_url, attachment_url,
                  contact_phone, show_contact_publicly, is_verified, status, reports_count, created_at, updated_at
           FROM comments
           WHERE status = 'approved'
           ORDER BY created_at DESC
           LIMIT 200`
        )
        .all<Record<string, unknown>>(),
      db
        .prepare(`SELECT item_key, COUNT(*) as cnt FROM likes WHERE item_key LIKE 'comment:%' GROUP BY item_key`)
        .all<{ item_key: string; cnt: number }>(),
      currentUser
        ? db
            .prepare(`SELECT item_key FROM likes WHERE item_key LIKE 'comment:%' AND (user_id = ? OR visitor_id = ?)`)
            .bind(currentUser.id, visitorId)
            .all<{ item_key: string }>()
        : db
            .prepare(`SELECT item_key FROM likes WHERE item_key LIKE 'comment:%' AND visitor_id = ?`)
            .bind(visitorId)
            .all<{ item_key: string }>(),
    ]);

    const likesMap = new Map<string, number>();
    for (const lr of likeCountsRes.results || []) {
      likesMap.set(lr.item_key, Number(lr.cnt || 0));
    }
    const visitorLikedSet = new Set((userLikedRes.results || []).map((v) => v.item_key));

    const comments = (rowsRes.results || []).map((r) => {
      const likeKey = `comment:${String(r.id)}`;
      const isOwner =
        Boolean(currentUser && r.user_id && r.user_id === currentUser.id) ||
        r.visitor_id === visitorId;
      return {
        id: r.id,
        authorName: r.author_name,
        grade: r.grade,
        rating: Number(r.rating),
        content: r.content,
        avatarUrl: r.avatar_url || null,
        attachmentUrl: r.attachment_url || null,
        contactPhone: null,
        showContactPublicly: false,
        isVerified: Number(r.is_verified) === 1,
        isOwner,
        likesCount: likesMap.get(likeKey) || 0,
        hasLiked: visitorLikedSet.has(likeKey),
        createdAt: r.created_at,
        updatedAt: r.updated_at || null,
      };
    });

    return jsonResponse(ctx, { comments });
  }

  if (method === 'POST' && path === '/api/comments') {
    const body = await readJsonBody(request);
    try {
      const validated = validateCommentPayload(body);
      const contentHash = await sha256Hex(`${validated.authorName.toLowerCase()}::${validated.content.toLowerCase()}`);

      const dup = await db
        .prepare(
          `SELECT id FROM comments
           WHERE content_hash = ? AND (visitor_id = ? OR (user_id IS NOT NULL AND user_id = ?) OR created_at > ?)`
        )
        .bind(contentHash, visitorId, currentUser?.id || '', new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .first();

      if (dup) {
        return jsonResponse(ctx, { error: 'التعليق ده مكرر بالفعل! اكتب تجربة جديدة عشان تفيد زمايلك.' }, 409);
      }

      const completedOrder = await db
        .prepare(
          "SELECT id FROM orders WHERE (visitor_id = ? OR (user_id IS NOT NULL AND user_id = ?)) AND status = 'completed' LIMIT 1"
        )
        .bind(visitorId, currentUser?.id || '')
        .first();

      const avatarUrl = await saveUploadedImage(db, validated.avatarImage);
      const attachmentUrl = await saveUploadedImage(db, validated.attachmentImage);
      const id = generateId('cmt');
      const nowIso = new Date().toISOString();
      const isVerified = completedOrder ? 1 : 0;

      await db
        .prepare(
          `INSERT INTO comments (
            id, visitor_id, user_id, author_name, grade, rating, content,
            avatar_url, attachment_url, contact_phone, show_contact_publicly,
            is_verified, status, reports_count, content_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 0, ?, ?)`
        )
        .bind(
          id,
          visitorId,
          currentUser?.id || null,
          validated.authorName,
          validated.grade,
          validated.rating,
          validated.content,
          avatarUrl,
          attachmentUrl,
          validated.contactPhone,
          validated.showContactPublicly ? 1 : 0,
          isVerified,
          contentHash,
          nowIso
        )
        .run();

      return jsonResponse(
        ctx,
        {
          comment: {
            id,
            authorName: validated.authorName,
            grade: validated.grade,
            rating: validated.rating,
            content: validated.content,
            avatarUrl,
            attachmentUrl,
            contactPhone: null,
            showContactPublicly: false,
            isVerified: isVerified === 1,
            isOwner: true,
            likesCount: 0,
            hasLiked: false,
            createdAt: nowIso,
            updatedAt: null,
          },
        },
        201
      );
    } catch (err) {
      return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'بيانات التعليق غير صحيحة.' }, 400);
    }
  }

  const commentIdMatch = path.match(/^\/api\/comments\/([a-zA-Z0-9_-]+)$/);
  if (commentIdMatch && method === 'PATCH') {
    const id = commentIdMatch[1];
    const existing = await db
      .prepare(
        'SELECT id, visitor_id, user_id, author_name, grade, rating, content, contact_phone, show_contact_publicly FROM comments WHERE id = ?'
      )
      .bind(id)
      .first<Record<string, unknown>>();

    if (!existing) {
      return jsonResponse(ctx, { error: 'التعليق غير موجود.' }, 404);
    }

    const ownsByUser = Boolean(currentUser && existing.user_id && existing.user_id === currentUser.id);
    const ownsByVisitor = existing.visitor_id === visitorId;
    if (!ownsByUser && !ownsByVisitor) {
      return jsonResponse(ctx, { error: 'مش مسموحلك تعدل تعليق غيرك.' }, 403);
    }

    const body = await readJsonBody(request);
    try {
      const merged = {
        authorName: body.authorName ?? existing.author_name,
        grade: body.grade ?? existing.grade,
        rating: body.rating ?? existing.rating,
        content: body.content ?? existing.content,
        contactPhone: body.contactPhone ?? existing.contact_phone,
        showContactPublicly:
          typeof body.showContactPublicly === 'boolean'
            ? body.showContactPublicly
            : Number(existing.show_contact_publicly) === 1,
      };
      const validated = validateCommentPayload(merged);
      const nowIso = new Date().toISOString();
      const contentHash = await sha256Hex(`${validated.authorName.toLowerCase()}::${validated.content.toLowerCase()}`);

      await db
        .prepare(
          `UPDATE comments
           SET author_name = ?, grade = ?, rating = ?, content = ?,
               contact_phone = ?, show_contact_publicly = ?, content_hash = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          validated.authorName,
          validated.grade,
          validated.rating,
          validated.content,
          validated.contactPhone,
          validated.showContactPublicly ? 1 : 0,
          contentHash,
          nowIso,
          id
        )
        .run();

      return jsonResponse(ctx, { ok: true, updatedAt: nowIso });
    } catch (err) {
      return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'تعذر تعديل التعليق.' }, 400);
    }
  }

  if (commentIdMatch && method === 'DELETE') {
    const id = commentIdMatch[1];
    const existing = await db
      .prepare('SELECT id, visitor_id, user_id FROM comments WHERE id = ?')
      .bind(id)
      .first<{ id: string; visitor_id: string; user_id: string | null }>();

    if (!existing) {
      return jsonResponse(ctx, { error: 'التعليق غير موجود.' }, 404);
    }

    const ownsByUser = Boolean(currentUser && existing.user_id && existing.user_id === currentUser.id);
    const ownsByVisitor = existing.visitor_id === visitorId;
    if (!ownsByUser && !ownsByVisitor) {
      return jsonResponse(ctx, { error: 'مش مسموحلك تحذف تعليق غيرك.' }, 403);
    }

    await db.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
    return jsonResponse(ctx, { ok: true });
  }

  const commentReportMatch = path.match(/^\/api\/comments\/([a-zA-Z0-9_-]+)\/report$/);
  if (commentReportMatch && method === 'POST') {
    const id = commentReportMatch[1];
    const body = await readJsonBody(request);
    const reason =
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 120) : 'محتوى غير مناسب';

    const comment = await db
      .prepare('SELECT id, reports_count FROM comments WHERE id = ?')
      .bind(id)
      .first<{ id: string; reports_count: number }>();

    if (!comment) {
      return jsonResponse(ctx, { error: 'التعليق غير موجود.' }, 404);
    }

    try {
      await db
        .prepare('INSERT INTO comment_reports (id, comment_id, visitor_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(generateId('rep'), id, visitorId, reason, new Date().toISOString())
        .run();

      const newCount = Number(comment.reports_count || 0) + 1;
      const nextStatus = newCount >= 3 ? 'flagged' : 'approved';
      await db.prepare('UPDATE comments SET reports_count = ?, status = ? WHERE id = ?').bind(newCount, nextStatus, id).run();

      return jsonResponse(ctx, {
        ok: true,
        flaggedForReview: nextStatus === 'flagged',
        message: 'تم استلام بلاغك وهيتم مراجعته من الإدارة.',
      });
    } catch {
      return jsonResponse(ctx, { error: 'أنت بلغت عن التعليق ده قبل كده بالفعل.' }, 409);
    }
  }

  // ==================== LIKES ====================
  if (method === 'GET' && path === '/api/likes') {
    const rawKey = url.searchParams.get('itemKey');
    const itemKey = rawKey && rawKey.trim() ? rawKey.trim().slice(0, 64) : 'tool';

    const [countRow, likedRow] = await Promise.all([
      db.prepare('SELECT COUNT(*) as cnt FROM likes WHERE item_key = ?').bind(itemKey).first<{ cnt: number }>(),
      currentUser
        ? db
            .prepare('SELECT 1 FROM likes WHERE item_key = ? AND (user_id = ? OR visitor_id = ?) LIMIT 1')
            .bind(itemKey, currentUser.id, visitorId)
            .first()
        : db
            .prepare('SELECT 1 FROM likes WHERE item_key = ? AND visitor_id = ? LIMIT 1')
            .bind(itemKey, visitorId)
            .first(),
    ]);

    return jsonResponse(ctx, {
      itemKey,
      count: Number(countRow?.cnt || 0),
      liked: Boolean(likedRow),
    });
  }

  if (method === 'POST' && path === '/api/likes/toggle') {
    const body = await readJsonBody(request);
    const rawKey = typeof body.itemKey === 'string' ? body.itemKey.trim().slice(0, 64) : 'tool';
    const isToolKey = rawKey === 'tool';
    const commentMatch = rawKey.match(/^comment:([a-zA-Z0-9_-]{4,60})$/);
    if (!isToolKey && !commentMatch) {
      return jsonResponse(ctx, { error: 'معرّف الإعجاب غير صالح.' }, 400);
    }

    if (commentMatch) {
      const commentRow = await db
        .prepare("SELECT id FROM comments WHERE id = ? AND status = 'approved'")
        .bind(commentMatch[1])
        .first();
      if (!commentRow) {
        return jsonResponse(ctx, { error: 'التعليق غير موجود.' }, 404);
      }
    }

    const desiredLiked = typeof body.desiredLiked === 'boolean' ? body.desiredLiked : null;
    const actorVisitorKey = currentUser ? `u_${currentUser.id}` : visitorId;

    const existing = currentUser
      ? await db
          .prepare('SELECT 1 FROM likes WHERE item_key = ? AND (user_id = ? OR visitor_id = ?)')
          .bind(rawKey, currentUser.id, visitorId)
          .first()
      : await db
          .prepare('SELECT 1 FROM likes WHERE item_key = ? AND visitor_id = ?')
          .bind(rawKey, visitorId)
          .first();

    const shouldLike = desiredLiked !== null ? desiredLiked : !existing;
    let liked: boolean;

    if (shouldLike) {
      if (!existing) {
        await db
          .prepare('INSERT OR IGNORE INTO likes (item_key, visitor_id, user_id, created_at) VALUES (?, ?, ?, ?)')
          .bind(rawKey, actorVisitorKey, currentUser?.id || null, new Date().toISOString())
          .run();
      }
      liked = true;
    } else {
      if (currentUser) {
        await db
          .prepare('DELETE FROM likes WHERE item_key = ? AND (user_id = ? OR visitor_id = ?)')
          .bind(rawKey, currentUser.id, visitorId)
          .run();
      } else {
        await db.prepare('DELETE FROM likes WHERE item_key = ? AND visitor_id = ?').bind(rawKey, visitorId).run();
      }
      liked = false;
    }

    const countRow = await db.prepare('SELECT COUNT(*) as cnt FROM likes WHERE item_key = ?').bind(rawKey).first<{ cnt: number }>();
    return jsonResponse(ctx, { itemKey: rawKey, count: Number(countRow?.cnt || 0), liked });
  }

  // ==================== POLLS (STRICT ACCOUNT VOTING) ====================
  if (method === 'GET' && path === '/api/poll') {
    const pollId = url.searchParams.get('pollId') || undefined;
    return jsonResponse(ctx, await getPollSummary(db, currentUser?.id || null, pollId));
  }

  if (method === 'POST' && path === '/api/poll/vote') {
    if (!currentUser) {
      return jsonResponse(
        ctx,
        {
          error: 'لازم تسجل دخول بحسابك الأول عشان تقدر تصوّت (صوت واحد لكل حساب).',
          requiresAuth: true,
        },
        401
      );
    }

    const body = await readJsonBody(request);
    let pollId = typeof body.pollId === 'string' && body.pollId.trim() ? body.pollId.trim() : '';
    if (!pollId) {
      const latest = await db.prepare('SELECT id FROM polls ORDER BY created_at DESC LIMIT 1').first<{ id: string }>();
      pollId = latest?.id || 'poll_extend_offer';
    }
    const choice = typeof body.choice === 'string' ? body.choice.trim() : '';

    const poll = await db
      .prepare('SELECT id, is_open, starts_at, ends_at FROM polls WHERE id = ?')
      .bind(pollId)
      .first<{ id: string; is_open: number; starts_at: string | null; ends_at: string | null }>();

    if (!poll) {
      return jsonResponse(ctx, { error: 'الاستفتاء غير موجود.' }, 404);
    }

    const config = await getSiteConfig(db);
    const nowMs = Date.now();
    if (
      Number(poll.is_open) === 0 ||
      (poll.id === 'poll_extend_offer' && config.pollClosed) ||
      (poll.starts_at && Date.parse(poll.starts_at) > nowMs) ||
      (poll.ends_at && Date.parse(poll.ends_at) <= nowMs)
    ) {
      return jsonResponse(ctx, { error: 'التصويت مغلق حالياً.' }, 403);
    }

    const opt = await db
      .prepare('SELECT 1 FROM poll_options WHERE poll_id = ? AND option_key = ?')
      .bind(poll.id, choice)
      .first();
    if (!opt) {
      return jsonResponse(ctx, { error: 'اختيار التصويت غير صحيح.' }, 400);
    }

    const existingVote = await db
      .prepare('SELECT option_key FROM user_poll_votes WHERE poll_id = ? AND user_id = ?')
      .bind(poll.id, currentUser.id)
      .first<{ option_key: string }>();

    if (existingVote) {
      return jsonResponse(ctx, { error: 'سبق لك التصويت في هذا الاستفتاء. مسموح بصوت واحد فقط لكل حساب.' }, 409);
    }

    try {
      await db
        .prepare(
          `INSERT INTO user_poll_votes (id, poll_id, option_key, user_id, visitor_id, ip_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(generateId('pv'), poll.id, choice, currentUser.id, visitorId, ipHash, new Date().toISOString())
        .run();
    } catch {
      return jsonResponse(ctx, { error: 'سبق لك التصويت في هذا الاستفتاء. مسموح بصوت واحد فقط لكل حساب.' }, 409);
    }

    return jsonResponse(ctx, await getPollSummary(db, currentUser.id, poll.id), 201);
  }

  // ==================== ORDERS ====================
  if (method === 'POST' && path === '/api/orders') {
    const config = await getSiteConfig(db);
    if (!config.ordersEnabled) {
      return jsonResponse(ctx, { error: 'استقبال طلبات الاشتراك متوقف مؤقتاً من الإدارة. حاول تاني بعد شوية.' }, 403);
    }

    const body = await readJsonBody(request);
    try {
      const input = validateOrderPayload(body);

      if (input.clientRequestId) {
        const existing = await db
          .prepare(
            `SELECT id, order_code, full_name, grade, platform_label, section_details, old_price, final_price, offer_applied, payment_method, status, created_at
             FROM orders WHERE client_request_id = ?`
          )
          .bind(input.clientRequestId)
          .first<Record<string, unknown>>();

        if (existing) {
          return jsonResponse(ctx, {
            deduplicated: true,
            order: {
              id: existing.id,
              orderCode: existing.order_code,
              fullName: existing.full_name,
              grade: existing.grade,
              platformLabel: existing.platform_label,
              sectionDetails: existing.section_details,
              oldPrice: existing.old_price,
              finalPrice: existing.final_price,
              offerApplied: Number(existing.offer_applied) === 1,
              paymentMethod: existing.payment_method,
              status: existing.status,
              createdAt: existing.created_at,
            },
          });
        }
      }

      const pricing = calculateOrderPricing(
        {
          grade: input.grade,
          platforms: input.platforms,
          qureoSection: input.qureoSection,
        },
        config,
        Date.now()
      );

      const id = generateId('ord');
      let orderCode = formatOrderCode();
      while (await db.prepare('SELECT 1 FROM orders WHERE order_code = ?').bind(orderCode).first()) {
        orderCode = formatOrderCode();
      }

      const encrypted = await encryptSecret(input.platformPassword, encryptionKey);
      const nowIso = new Date().toISOString();

      await db
        .prepare(
          `INSERT INTO orders (
            id, order_code, client_request_id, visitor_id, user_id, full_name, grade,
            platforms_json, platform_label, section_details, platform_username,
            encrypted_password, password_iv, password_auth_tag, credentials_purged,
            old_price, final_price, offer_applied, payment_method, status,
            whatsapp_status, whatsapp_error, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'new', 'click_to_chat', NULL, ?)`
        )
        .bind(
          id,
          orderCode,
          input.clientRequestId || null,
          visitorId,
          currentUser?.id || null,
          input.fullName,
          input.grade,
          JSON.stringify(input.platforms),
          pricing.platformLabel,
          pricing.sectionDetails,
          input.platformUsername,
          encrypted.encrypted,
          encrypted.iv,
          encrypted.authTag,
          pricing.oldPrice,
          pricing.finalPrice,
          pricing.offerApplied ? 1 : 0,
          input.paymentMethod,
          nowIso
        )
        .run();

      return jsonResponse(
        ctx,
        {
          deduplicated: false,
          order: {
            id,
            orderCode,
            fullName: input.fullName,
            grade: input.grade,
            platformLabel: pricing.platformLabel,
            sectionDetails: pricing.sectionDetails,
            oldPrice: pricing.oldPrice,
            finalPrice: pricing.finalPrice,
            offerApplied: pricing.offerApplied,
            paymentMethod: input.paymentMethod,
            status: 'new',
            createdAt: nowIso,
          },
        },
        201
      );
    } catch (err) {
      return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'تعذر إرسال الطلب.' }, 400);
    }
  }

  // ==================== ADMIN AUTH ROUTES ====================
  if (method === 'POST' && path === '/api/admin/login') {
    const body = await readJsonBody(request);
    const user = typeof body.username === 'string' ? body.username.trim() : '';
    const pass = typeof body.password === 'string' ? body.password : '';

    let verifiedAdminName: string | null = null;
    if (
      ctx.adminUsername &&
      ctx.adminPassword &&
      (await safeCompareStrings(user, ctx.adminUsername)) &&
      (await safeCompareStrings(pass, ctx.adminPassword))
    ) {
      verifiedAdminName = ctx.adminUsername;
    } else if (user.includes('@')) {
      const adminUserRow = await db
        .prepare("SELECT id, email, password_hash, role, status FROM users WHERE email = ? AND role = 'admin'")
        .bind(user.toLowerCase())
        .first<{ id: string; email: string; password_hash: string; role: string; status: string }>();

      if (adminUserRow && adminUserRow.status === 'active' && (await verifyPassword(pass, adminUserRow.password_hash))) {
        const tokenRaw = await createUserSession(ctx, adminUserRow.id);
        await logAdminAudit(db, {
          actorUsername: adminUserRow.email,
          action: 'admin_login',
          targetType: 'session',
          ipHash,
        });
        return jsonResponse(ctx, { ok: true, username: adminUserRow.email, token: tokenRaw });
      }
    }

    if (!verifiedAdminName) {
      if (!ctx.adminUsername || !ctx.adminPassword) {
        return jsonResponse(
          ctx,
          { error: 'بيانات دخول الإدارة غير مضبوطة في متغيرات البيئة (ADMIN_USERNAME / ADMIN_PASSWORD).' },
          503
        );
      }
      return jsonResponse(ctx, { error: 'اسم المستخدم أو كلمة المرور غلط.' }, 401);
    }

    const token = await signToken(
      {
        role: 'admin',
        username: verifiedAdminName,
        exp: Date.now() + 12 * 60 * 60 * 1000,
      },
      sessionSecret
    );

    ctx.setCookies.push(serializeCookie(request, 'crovo_admin', token, 12 * 60 * 60));
    await logAdminAudit(db, {
      actorUsername: verifiedAdminName,
      action: 'admin_login',
      targetType: 'session',
      ipHash,
    });

    return jsonResponse(ctx, { ok: true, username: verifiedAdminName, adminToken: token });
  }

  if (method === 'POST' && path === '/api/admin/logout') {
    ctx.setCookies.push(serializeCookie(request, 'crovo_admin', '', 0));
    return jsonResponse(ctx, { ok: true });
  }

  if (method === 'GET' && path === '/api/admin/me') {
    const session = await getAdminSession(ctx);
    if (!session) {
      return jsonResponse(ctx, { authenticated: false });
    }
    return jsonResponse(ctx, { authenticated: true, username: session.username });
  }

  // ==================== ADMIN PROTECTED RBAC ROUTES ====================
  if (path.startsWith('/api/admin/')) {
    const adminSession = await getAdminSession(ctx);
    if (!adminSession) {
      return jsonResponse(ctx, { error: 'غير مصرح بالدخول. من فضلك سجل دخول الإدارة أولاً.' }, 401);
    }
    const actor = adminSession.username;

    if (method === 'GET' && path === '/api/admin/overview') {
      await purgeExpiredOrderCredentials(db);

      const [
        ordersRes,
        commentsRes,
        reportsRes,
        commentLikesRes,
        qReportsRes,
        likesByItemRes,
        totalCopiesRow,
        topQuestionsRes,
        pushActiveRow,
        pushTotalRow,
        notifLogsRes,
        config,
        analytics,
      ] = await Promise.all([
        db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all<Record<string, unknown>>(),
        db.prepare('SELECT * FROM comments ORDER BY created_at DESC LIMIT 200').all<Record<string, unknown>>(),
        db.prepare('SELECT comment_id, reason, created_at FROM comment_reports ORDER BY created_at DESC').all<{
          comment_id: string;
          reason: string;
          created_at: string;
        }>(),
        db
          .prepare(`SELECT item_key, COUNT(*) as cnt FROM likes WHERE item_key LIKE 'comment:%' GROUP BY item_key`)
          .all<{ item_key: string; cnt: number }>(),
        db.prepare('SELECT * FROM question_reports ORDER BY created_at DESC LIMIT 200').all<Record<string, unknown>>(),
        db.prepare('SELECT item_key as itemKey, COUNT(*) as count FROM likes GROUP BY item_key').all<{
          itemKey: string;
          count: number;
        }>(),
        db.prepare('SELECT COALESCE(SUM(copy_count), 0) as totalCopies FROM question_stats').first<{ totalCopies: number }>(),
        db
          .prepare(
            `SELECT question_key as questionKey, grade, section, chapter_num as chapterNum,
                    q_index as qIndex, question_title as questionTitle, copy_count as copyCount, last_copied_at as lastCopiedAt
             FROM question_stats
             WHERE copy_count > 0
             ORDER BY copy_count DESC, last_copied_at DESC
             LIMIT 15`
          )
          .all<Record<string, unknown>>(),
        db.prepare('SELECT COUNT(*) as cnt FROM push_subscriptions WHERE enabled = 1').first<{ cnt: number }>(),
        db.prepare('SELECT COUNT(*) as cnt FROM push_subscriptions').first<{ cnt: number }>(),
        db
          .prepare(
            `SELECT id, message_id as messageId, category, title, body, sent_count as sentCount,
                    failed_count as failedCount, trigger_type as triggerType, error_detail as errorDetail, created_at as createdAt
             FROM notification_logs
             ORDER BY created_at DESC
             LIMIT 35`
          )
          .all<Record<string, unknown>>(),
        getSiteConfig(db),
        getDashboardAnalytics(db, { range: '7d' }),
      ]);

      const orders = await Promise.all(
        (ordersRes.results || []).map(async (o) => {
          let platformPassword: string | null = null;
          if (
            Number(o.credentials_purged) === 0 &&
            typeof o.encrypted_password === 'string' &&
            typeof o.password_iv === 'string' &&
            typeof o.password_auth_tag === 'string'
          ) {
            try {
              platformPassword = await decryptSecret(
                {
                  encrypted: o.encrypted_password,
                  iv: o.password_iv,
                  authTag: o.password_auth_tag,
                },
                encryptionKey
              );
            } catch {
              platformPassword = '[تعذر فك التشفير - تأكد من ثبات CREDENTIAL_ENCRYPTION_KEY]';
            }
          }
          return {
            id: o.id,
            orderCode: o.order_code,
            fullName: o.full_name,
            grade: o.grade,
            platformLabel: o.platform_label,
            sectionDetails: o.section_details,
            platformUsername: o.platform_username,
            platformPassword,
            credentialsPurged: Number(o.credentials_purged) === 1,
            oldPrice: o.old_price,
            finalPrice: o.final_price,
            offerApplied: Number(o.offer_applied) === 1,
            paymentMethod: o.payment_method,
            status: o.status,
            createdAt: o.created_at,
            updatedAt: o.updated_at || null,
          };
        })
      );

      const reportsByComment = new Map<string, Array<{ reason: string; createdAt: string }>>();
      for (const r of reportsRes.results || []) {
        const list = reportsByComment.get(r.comment_id) || [];
        list.push({ reason: r.reason, createdAt: r.created_at });
        reportsByComment.set(r.comment_id, list);
      }

      const commentLikesMap = new Map<string, number>();
      for (const lr of commentLikesRes.results || []) {
        commentLikesMap.set(lr.item_key, Number(lr.cnt || 0));
      }

      const comments = (commentsRes.results || []).map((c) => ({
        id: c.id,
        authorName: c.author_name,
        grade: c.grade,
        rating: c.rating,
        content: c.content,
        avatarUrl: c.avatar_url || null,
        attachmentUrl: c.attachment_url || null,
        contactPhone: c.contact_phone || null,
        showContactPublicly: Number(c.show_contact_publicly) === 1,
        isVerified: Number(c.is_verified) === 1,
        status: c.status,
        likesCount: commentLikesMap.get(`comment:${String(c.id)}`) || 0,
        reportsCount: c.reports_count,
        reports: reportsByComment.get(String(c.id)) || [],
        createdAt: c.created_at,
      }));

      const questionReports = (qReportsRes.results || []).map((qr) => ({
        id: qr.id,
        questionKey: qr.question_key,
        grade: qr.grade,
        section: qr.section,
        chapterNum: qr.chapter_num,
        qIndex: qr.q_index,
        questionTitle: qr.question_title,
        description: qr.description,
        status: qr.status,
        adminNote: qr.admin_note || null,
        createdAt: qr.created_at,
        updatedAt: qr.updated_at || null,
      }));

      return jsonResponse(ctx, {
        orders,
        comments,
        questionReports,
        poll: await getPollSummary(db, null),
        likes: likesByItemRes.results || [],
        config,
        analytics,
        stats: {
          totalCopies: Number(totalCopiesRow?.totalCopies || 0),
          topQuestions: topQuestionsRes.results || [],
          pendingQuestionReports: questionReports.filter((r) => r.status === 'pending').length,
          pushActiveCount: Number(pushActiveRow?.cnt || 0),
          pushTotalCount: Number(pushTotalRow?.cnt || 0),
          dbIntegrity: { ok: true, detail: 'Cloudflare D1 Durable SQL' },
          backups: [],
          isEphemeralStorageNotice:
            'تعمل قاعدة البيانات الدائمة على Cloudflare D1 SQL الموزعة مع حفظ مستمر للبيانات بدون فقدان.',
        },
        notifications: {
          enabled: config.notificationsEnabled,
          intervalDays: config.notificationsIntervalDays,
          templates: NOTIFICATION_TEMPLATES,
          logs: notifLogsRes.results || [],
        },
      });
    }

    if (method === 'GET' && path === '/api/admin/analytics') {
      const range = url.searchParams.get('range') || '7d';
      const from = url.searchParams.get('from') || undefined;
      const to = url.searchParams.get('to') || undefined;
      return jsonResponse(ctx, await getDashboardAnalytics(db, { range, from, to }));
    }

    if (method === 'GET' && path === '/api/admin/users') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const role = url.searchParams.get('role') || 'all';
      const status = url.searchParams.get('status') || 'all';

      const rowsRes = await db
        .prepare(
          `SELECT u.id, u.name, u.email, u.grade, u.role, u.status, u.suspend_reason as suspendReason,
                  u.last_active_at as lastActiveAt, u.created_at as createdAt,
                  (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) as reviewsCount,
                  (SELECT COUNT(*) FROM user_poll_votes pv WHERE pv.user_id = u.id) as votesCount,
                  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'completed') as completedOrdersCount
           FROM users u
           ORDER BY u.created_at DESC
           LIMIT 500`
        )
        .all<Record<string, unknown>>();

      const filtered = (rowsRes.results || []).filter((u) => {
        if (role !== 'all' && u.role !== role) return false;
        if (status !== 'all' && u.status !== status) return false;
        if (q) {
          const hay = `${String(u.name)} ${String(u.email)} ${String(u.grade)}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      return jsonResponse(ctx, { users: filtered });
    }

    const adminUserPatchMatch = path.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)$/);
    if (adminUserPatchMatch && method === 'PATCH') {
      const id = adminUserPatchMatch[1];
      const target = await db
        .prepare('SELECT id, name, email, role, status, grade, suspend_reason FROM users WHERE id = ?')
        .bind(id)
        .first<{
          id: string;
          name: string;
          email: string;
          role: 'user' | 'admin';
          status: 'active' | 'suspended';
          grade: string;
          suspend_reason: string | null;
        }>();

      if (!target) {
        return jsonResponse(ctx, { error: 'المستخدم غير موجود.' }, 404);
      }

      const body = await readJsonBody(request);
      const nextRole = body.role === 'admin' || body.role === 'user' ? body.role : target.role;
      const nextStatus =
        body.status === 'suspended' || body.status === 'active' ? body.status : target.status;
      const nextGrade = body.grade === 'bac1' || body.grade === 'bac2' ? body.grade : target.grade;
      const suspendReason =
        nextStatus === 'suspended'
          ? typeof body.suspendReason === 'string' && body.suspendReason.trim()
            ? body.suspendReason.trim().slice(0, 240)
            : target.suspend_reason || 'إيقاف إداري'
          : null;

      await db
        .prepare('UPDATE users SET role = ?, status = ?, grade = ?, suspend_reason = ? WHERE id = ?')
        .bind(nextRole, nextStatus, nextGrade, suspendReason, id)
        .run();

      if (nextStatus === 'suspended') {
        await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(id).run();
      }

      await logAdminAudit(db, {
        actorUsername: actor,
        action: nextStatus !== target.status ? `user_${nextStatus}` : 'user_update',
        targetType: 'user',
        targetId: id,
        details: { email: target.email, nextRole, nextStatus, suspendReason },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true, user: { id, role: nextRole, status: nextStatus, grade: nextGrade, suspendReason } });
    }

    const adminUserActivityMatch = path.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)\/activity$/);
    if (adminUserActivityMatch && method === 'GET') {
      const id = adminUserActivityMatch[1];
      const user = await db
        .prepare(
          'SELECT id, name, email, grade, role, status, suspend_reason as suspendReason, last_active_at as lastActiveAt, created_at as createdAt FROM users WHERE id = ?'
        )
        .bind(id)
        .first();
      if (!user) {
        return jsonResponse(ctx, { error: 'المستخدم غير موجود.' }, 404);
      }

      const [reviewsRes, votesRes, ordersRes, toolRunsRes] = await Promise.all([
        db
          .prepare('SELECT id, content, rating, status, created_at as createdAt FROM comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
          .bind(id)
          .all(),
        db
          .prepare(
            `SELECT v.poll_id as pollId, p.question, v.option_key as optionKey, v.created_at as createdAt
             FROM user_poll_votes v LEFT JOIN polls p ON p.id = v.poll_id
             WHERE v.user_id = ? ORDER BY v.created_at DESC LIMIT 20`
          )
          .bind(id)
          .all(),
        db
          .prepare(
            `SELECT id, order_code as orderCode, platform_label as platformLabel, final_price as finalPrice, status, created_at as createdAt
             FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
          )
          .bind(id)
          .all(),
        db
          .prepare(
            `SELECT id, service_key as serviceKey, status, duration_ms as durationMs, error_message as errorMessage, created_at as createdAt
             FROM tool_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
          )
          .bind(id)
          .all(),
      ]);

      return jsonResponse(ctx, {
        user,
        reviews: reviewsRes.results || [],
        votes: votesRes.results || [],
        orders: ordersRes.results || [],
        toolRuns: toolRunsRes.results || [],
      });
    }

    // Library CMS routes
    if (method === 'GET' && path === '/api/admin/library') {
      const gradeParam = url.searchParams.get('grade');
      const secParam = url.searchParams.get('section');
      const grade = gradeParam === 'bac2' ? 'bac2' : gradeParam === 'bac1' ? 'bac1' : 'all';
      const section =
        secParam === 'py' || secParam === 'fin' || secParam === 'js' ? secParam : 'all';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const onlyIncomplete = url.searchParams.get('incomplete') === '1';

      const [chaptersRes, questionsRes] = await Promise.all([
        db
          .prepare(
            `SELECT id, grade, section, chapter_num as chapterNum, title, sort_order as sortOrder,
                    updated_at as updatedAt, updated_by as updatedBy
             FROM library_chapters
             ORDER BY grade ASC, section ASC, sort_order ASC, chapter_num ASC`
          )
          .all<{
            id: string;
            grade: string;
            section: string;
            chapterNum: number;
            title: string;
            sortOrder: number;
            updatedAt: string;
            updatedBy: string | null;
          }>(),
        db
          .prepare(
            `SELECT id, chapter_id as chapterId, grade, section, chapter_num as chapterNum, q_index as qIndex,
                    q_text as qText, a_text as aText, is_code as isCode, updated_at as updatedAt, updated_by as updatedBy
             FROM library_questions
             ORDER BY grade ASC, section ASC, chapter_num ASC, q_index ASC`
          )
          .all<{
            id: string;
            chapterId: string;
            grade: string;
            section: string;
            chapterNum: number;
            qIndex: number;
            qText: string;
            aText: string;
            isCode: number;
            updatedAt: string;
            updatedBy: string | null;
          }>(),
      ]);

      const filteredQuestions = (questionsRes.results || []).filter((item) => {
        if (grade !== 'all' && item.grade !== grade) return false;
        if (section !== 'all' && item.section !== section) return false;
        const trimmedA = item.aText.trim();
        const isIncomplete =
          trimmedA.length < 3 || trimmedA === '/' || trimmedA === '-' || trimmedA.toLowerCase() === 'todo';
        if (onlyIncomplete && !isIncomplete) return false;
        if (q) {
          const hay = `${item.qText} ${item.aText} ${item.chapterNum}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      return jsonResponse(ctx, {
        chapters: (chaptersRes.results || []).filter(
          (c) => (grade === 'all' || c.grade === grade) && (section === 'all' || c.section === section)
        ),
        questions: filteredQuestions.slice(0, 400).map((item) => ({
          ...item,
          isCode: Number(item.isCode) === 1,
          isIncomplete:
            item.aText.trim().length < 3 ||
            item.aText.trim() === '/' ||
            item.aText.trim() === '-' ||
            item.aText.trim().toLowerCase() === 'todo',
        })),
        totalMatching: filteredQuestions.length,
      });
    }

    if (method === 'POST' && path === '/api/admin/library/questions') {
      const body = await readJsonBody(request);
      const grade = body.grade === 'bac2' ? 'bac2' : 'bac1';
      const section = body.section === 'py' || body.section === 'fin' ? body.section : 'js';
      const chapterNum = Math.max(1, Math.min(200, Math.round(Number(body.chapterNum) || 1)));
      const qText = typeof body.qText === 'string' ? body.qText.trim() : '';
      const aText = typeof body.aText === 'string' ? body.aText : '';
      const isCode = body.isCode === true;

      if (qText.length < 2 || aText.trim().length < 1) {
        return jsonResponse(ctx, { error: 'اكتب نص السؤال والإجابة بشكل واضح.' }, 400);
      }

      const nowIso = new Date().toISOString();
      const chapterId = `${grade}_${section}_${chapterNum}`;
      const existingCh = await db.prepare('SELECT id FROM library_chapters WHERE id = ?').bind(chapterId).first();
      if (!existingCh) {
        const label = section === 'js' ? `المستوى ${chapterNum}` : `الفصل ${chapterNum}`;
        await db
          .prepare(
            `INSERT INTO library_chapters (id, grade, section, chapter_num, title, sort_order, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(chapterId, grade, section, chapterNum, label, chapterNum, nowIso, actor)
          .run();
      }

      const maxRow = await db
        .prepare('SELECT COALESCE(MAX(q_index), -1) as maxIdx FROM library_questions WHERE chapter_id = ?')
        .bind(chapterId)
        .first<{ maxIdx: number }>();
      const nextIndex = Number(maxRow?.maxIdx ?? -1) + 1;
      const id = generateId('lq');

      await db
        .prepare(
          `INSERT INTO library_questions (id, chapter_id, grade, section, chapter_num, q_index, q_text, a_text, is_code, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, chapterId, grade, section, chapterNum, nextIndex, qText, aText, isCode ? 1 : 0, nowIso, actor)
        .run();

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'library_question_create',
        targetType: 'library_question',
        targetId: id,
        details: { grade, section, chapterNum, qText },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true, id }, 201);
    }

    const adminLibQuestionMatch = path.match(/^\/api\/admin\/library\/questions\/([a-zA-Z0-9_-]+)$/);
    if (adminLibQuestionMatch && method === 'PATCH') {
      const id = adminLibQuestionMatch[1];
      const existing = await db
        .prepare('SELECT id, q_text, a_text, is_code, q_index FROM library_questions WHERE id = ?')
        .bind(id)
        .first<{ id: string; q_text: string; a_text: string; is_code: number; q_index: number }>();

      if (!existing) {
        return jsonResponse(ctx, { error: 'السؤال غير موجود في المكتبة.' }, 404);
      }

      const body = await readJsonBody(request);
      const qText = typeof body.qText === 'string' && body.qText.trim() ? body.qText.trim() : existing.q_text;
      const aText = typeof body.aText === 'string' && body.aText.trim() ? body.aText : existing.a_text;
      const isCode = typeof body.isCode === 'boolean' ? (body.isCode ? 1 : 0) : existing.is_code;
      const qIndex = Number.isInteger(body.qIndex) ? Math.max(0, Number(body.qIndex)) : existing.q_index;
      const nowIso = new Date().toISOString();

      await db
        .prepare(
          `UPDATE library_questions SET q_text = ?, a_text = ?, is_code = ?, q_index = ?, updated_at = ?, updated_by = ? WHERE id = ?`
        )
        .bind(qText, aText, isCode, qIndex, nowIso, actor, id)
        .run();

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'library_question_update',
        targetType: 'library_question',
        targetId: id,
        details: { qText },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true, updatedAt: nowIso });
    }

    if (adminLibQuestionMatch && method === 'DELETE') {
      const id = adminLibQuestionMatch[1];
      const existing = await db
        .prepare('SELECT id, grade, section, chapter_num, q_text FROM library_questions WHERE id = ?')
        .bind(id)
        .first<Record<string, unknown>>();
      if (!existing) {
        return jsonResponse(ctx, { error: 'السؤال غير موجود.' }, 404);
      }

      await db.prepare('DELETE FROM library_questions WHERE id = ?').bind(id).run();
      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'library_question_delete',
        targetType: 'library_question',
        targetId: id,
        details: { qText: existing.q_text, chapterNum: existing.chapter_num },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true });
    }

    if (method === 'GET' && path === '/api/admin/library/export') {
      const [chaptersRes, questionsRes] = await Promise.all([
        db
          .prepare('SELECT id, grade, section, chapter_num as chapterNum, title, sort_order as sortOrder FROM library_chapters ORDER BY grade, section, sort_order')
          .all(),
        db
          .prepare('SELECT id, chapter_id as chapterId, grade, section, chapter_num as chapterNum, q_index as qIndex, q_text as qText, a_text as aText, is_code as isCode FROM library_questions ORDER BY grade, section, chapter_num, q_index')
          .all(),
      ]);
      return jsonResponse(ctx, {
        exportedAt: new Date().toISOString(),
        chapters: chaptersRes.results || [],
        questions: questionsRes.results || [],
      });
    }

    if (method === 'POST' && path === '/api/admin/library/import') {
      const body = await readJsonBody(request);
      const items = Array.isArray(body.questions) ? body.questions : null;
      if (!items || items.length === 0 || items.length > 500) {
        return jsonResponse(ctx, { error: 'أرسل مصفوفة صالحة تحتوي من 1 إلى 500 سؤال.' }, 400);
      }

      const nowIso = new Date().toISOString();
      let importedCount = 0;

      for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const grade = r.grade === 'bac2' ? 'bac2' : 'bac1';
        const section = r.section === 'py' || r.section === 'fin' ? r.section : 'js';
        const chapterNum = Math.max(1, Math.min(200, Math.round(Number(r.chapterNum) || 1)));
        const qText = typeof r.qText === 'string' ? r.qText.trim() : '';
        const aText = typeof r.aText === 'string' ? r.aText : '';
        if (!qText || !aText.trim()) continue;

        const chapterId = `${grade}_${section}_${chapterNum}`;
        if (!(await db.prepare('SELECT id FROM library_chapters WHERE id = ?').bind(chapterId).first())) {
          const label = section === 'js' ? `المستوى ${chapterNum}` : `الفصل ${chapterNum}`;
          await db
            .prepare(
              `INSERT INTO library_chapters (id, grade, section, chapter_num, title, sort_order, updated_at, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(chapterId, grade, section, chapterNum, label, chapterNum, nowIso, actor)
            .run();
        }

        const maxRow = await db
          .prepare('SELECT COALESCE(MAX(q_index), -1) as maxIdx FROM library_questions WHERE chapter_id = ?')
          .bind(chapterId)
          .first<{ maxIdx: number }>();

        await db
          .prepare(
            `INSERT INTO library_questions (id, chapter_id, grade, section, chapter_num, q_index, q_text, a_text, is_code, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            generateId('lq'),
            chapterId,
            grade,
            section,
            chapterNum,
            Number(maxRow?.maxIdx ?? -1) + 1,
            qText,
            aText,
            r.isCode === true ? 1 : 0,
            nowIso,
            actor
          )
          .run();
        importedCount += 1;
      }

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'library_import',
        targetType: 'library',
        details: { importedCount },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true, importedCount });
    }

    // Tool management
    if (method === 'GET' && path === '/api/admin/tool') {
      const [config, recentRunsRes, summaryRow] = await Promise.all([
        getSiteConfig(db),
        db
          .prepare(
            `SELECT id, user_id as userId, service_key as serviceKey, status, duration_ms as durationMs,
                    error_message as errorMessage, created_at as createdAt
             FROM tool_runs ORDER BY created_at DESC LIMIT 50`
          )
          .all(),
        db
          .prepare(
            `SELECT COUNT(*) as totalRuns,
                    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as succeededRuns,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedRuns,
                    COALESCE(AVG(NULLIF(duration_ms, 0)), 0) as avgDurationMs
             FROM tool_runs`
          )
          .first(),
      ]);

      return jsonResponse(ctx, {
        services: config.toolServices,
        videos: config.toolVideos,
        summary: summaryRow || { totalRuns: 0, succeededRuns: 0, failedRuns: 0, avgDurationMs: 0 },
        recentRuns: recentRunsRes.results || [],
      });
    }

    const adminToolServiceMatch = path.match(/^\/api\/admin\/tool\/services\/([a-zA-Z0-9_-]+)$/);
    if (adminToolServiceMatch && method === 'PATCH') {
      const key = adminToolServiceMatch[1];
      const existing = await db
        .prepare('SELECT key, name, description, is_visible FROM tool_services WHERE key = ?')
        .bind(key)
        .first<{ key: string; name: string; description: string; is_visible: number }>();

      if (!existing) {
        return jsonResponse(ctx, { error: 'الخدمة غير موجودة.' }, 404);
      }

      const body = await readJsonBody(request);
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : existing.name;
      const description =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim().slice(0, 260)
          : existing.description;
      const isVisible = typeof body.isVisible === 'boolean' ? (body.isVisible ? 1 : 0) : existing.is_visible;

      await db
        .prepare('UPDATE tool_services SET name = ?, description = ?, is_visible = ?, updated_at = ? WHERE key = ?')
        .bind(name, description, isVisible, new Date().toISOString(), key)
        .run();

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'tool_service_update',
        targetType: 'tool_service',
        targetId: key,
        details: { name, isVisible: Number(isVisible) === 1 },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true });
    }

    if (method === 'PUT' && path === '/api/admin/tool/videos') {
      const body = await readJsonBody(request);
      const videos = Array.isArray(body.videos) ? body.videos : null;
      if (!videos || videos.length === 0 || videos.length > 20) {
        return jsonResponse(ctx, { error: 'بيانات الفيديوهات غير صالحة.' }, 400);
      }

      const sanitized = videos.map((v: Record<string, unknown>, idx: number) => ({
        id: typeof v.id === 'string' && v.id.trim() ? v.id.trim() : `vid_${idx + 1}`,
        tag: typeof v.tag === 'string' ? v.tag.trim().slice(0, 60) : 'فيديو',
        title: typeof v.title === 'string' ? v.title.trim().slice(0, 140) : 'فيديو الأداة',
        description: typeof v.description === 'string' ? v.description.trim().slice(0, 320) : '',
        src: typeof v.src === 'string' ? v.src.trim().slice(0, 260) : '',
        visible: v.visible !== false,
      }));

      await setSetting(db, 'tool_videos_json', JSON.stringify(sanitized));
      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'tool_videos_update',
        targetType: 'tool_videos',
        details: { count: sanitized.length },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true, videos: sanitized });
    }

    if (method === 'POST' && path === '/api/admin/ad-image') {
      const body = await readJsonBody(request);
      try {
        const validated = validateBase64Image(body.imageDataUrl, 1_500_000);
        if (!validated) {
          return jsonResponse(ctx, { error: 'يرجى اختيار صورة صالحة (PNG / JPG / WEBP).' }, 400);
        }
        const imageUrl = await saveUploadedImage(db, validated);
        await logAdminAudit(db, {
          actorUsername: actor,
          action: 'ad_image_upload',
          targetType: 'library_ad',
          details: { url: imageUrl },
          ipHash,
        });
        return jsonResponse(ctx, { ok: true, imageUrl }, 201);
      } catch (err) {
        return jsonResponse(ctx, { error: err instanceof Error ? err.message : 'تعذر رفع الصورة.' }, 400);
      }
    }

    // Polls management
    if (method === 'GET' && path === '/api/admin/polls') {
      const pollsRes = await db
        .prepare(
          'SELECT id, slug, question, is_open as isOpen, starts_at as startsAt, ends_at as endsAt, created_at as createdAt, updated_at as updatedAt FROM polls ORDER BY created_at DESC'
        )
        .all<Record<string, unknown>>();

      const enriched = await Promise.all(
        (pollsRes.results || []).map(async (p) => {
          const optsRes = await db
            .prepare(
              `SELECT o.option_key as key, o.label, o.sort_order as sortOrder, COUNT(v.id) as votes
               FROM poll_options o
               LEFT JOIN user_poll_votes v ON v.poll_id = o.poll_id AND v.option_key = o.option_key
               WHERE o.poll_id = ?
               GROUP BY o.id
               ORDER BY o.sort_order ASC`
            )
            .bind(String(p.id))
            .all<{ key: string; label: string; sortOrder: number; votes: number }>();

          const opts = optsRes.results || [];
          const totalVotes = opts.reduce((s, o) => s + Number(o.votes || 0), 0);
          return {
            ...p,
            isOpen: Number(p.isOpen) === 1,
            totalVotes,
            options: opts.map((o) => ({
              ...o,
              votes: Number(o.votes || 0),
              percent: totalVotes > 0 ? Math.round((Number(o.votes || 0) / totalVotes) * 100) : 0,
            })),
          };
        })
      );

      return jsonResponse(ctx, { polls: enriched });
    }

    if (method === 'POST' && path === '/api/admin/polls') {
      const body = await readJsonBody(request);
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      const optionsRaw = Array.isArray(body.options) ? body.options : [];
      const options = optionsRaw
        .map((o: unknown) => (typeof o === 'string' ? o.trim() : ''))
        .filter((o: string) => o.length >= 2)
        .slice(0, 6);

      if (question.length < 4 || options.length < 2) {
        return jsonResponse(ctx, { error: 'اكتب سؤالًا واضحًا وخيارين على الأقل.' }, 400);
      }

      const nowIso = new Date().toISOString();
      const id = generateId('poll');
      const slug = `poll-${Date.now()}`;
      const startsAt =
        typeof body.startsAt === 'string' && Number.isFinite(Date.parse(body.startsAt))
          ? new Date(body.startsAt).toISOString()
          : nowIso;
      const endsAt =
        typeof body.endsAt === 'string' && Number.isFinite(Date.parse(body.endsAt))
          ? new Date(body.endsAt).toISOString()
          : null;

      const stmts = [
        db
          .prepare(
            `INSERT INTO polls (id, slug, question, is_open, starts_at, ends_at, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
          )
          .bind(id, slug, question.slice(0, 200), startsAt, endsAt, nowIso, nowIso),
        ...options.map((label: string, idx: number) =>
          db
            .prepare(
              `INSERT INTO poll_options (id, poll_id, option_key, label, sort_order)
               VALUES (?, ?, ?, ?, ?)`
            )
            .bind(generateId('opt'), id, `opt_${idx + 1}`, label.slice(0, 100), idx + 1)
        ),
      ];
      await db.batch(stmts);

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'poll_create',
        targetType: 'poll',
        targetId: id,
        details: { question, optionsCount: options.length },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true, id }, 201);
    }

    const adminPollExportMatch = path.match(/^\/api\/admin\/polls\/([a-zA-Z0-9_-]+)\/export$/);
    if (adminPollExportMatch && method === 'GET') {
      const id = adminPollExportMatch[1];
      const poll = await db
        .prepare('SELECT id, question FROM polls WHERE id = ?')
        .bind(id)
        .first<{ id: string; question: string }>();
      if (!poll) {
        return jsonResponse(ctx, { error: 'الاستفتاء غير موجود.' }, 404);
      }

      const optsRes = await db
        .prepare(
          `SELECT o.option_key as optionKey, o.label, COUNT(v.id) as votes
           FROM poll_options o
           LEFT JOIN user_poll_votes v ON v.poll_id = o.poll_id AND v.option_key = o.option_key
           WHERE o.poll_id = ?
           GROUP BY o.id
           ORDER BY o.sort_order ASC`
        )
        .bind(id)
        .all<{ optionKey: string; label: string; votes: number }>();

      const opts = optsRes.results || [];
      const totalVotes = opts.reduce((s, o) => s + Number(o.votes || 0), 0);

      if (url.searchParams.get('format') === 'csv') {
        const header = 'option_key,label,votes,percent';
        const lines = opts.map((o) => {
          const pct = totalVotes > 0 ? Math.round((Number(o.votes || 0) / totalVotes) * 100) : 0;
          const safeLabel = `"${String(o.label).replace(/"/g, '""')}"`;
          return `${o.optionKey},${safeLabel},${o.votes},${pct}%`;
        });
        return new Response('\uFEFF' + [header, ...lines].join('\n'), {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="poll-${id}.csv"`,
            'X-Crovo-Visitor-Token': visitorToken,
          },
        });
      }

      return jsonResponse(ctx, {
        pollId: poll.id,
        question: poll.question,
        totalVotes,
        exportedAt: new Date().toISOString(),
        results: opts.map((o) => ({
          ...o,
          percent: totalVotes > 0 ? Math.round((Number(o.votes || 0) / totalVotes) * 100) : 0,
        })),
      });
    }

    const adminPollPatchMatch = path.match(/^\/api\/admin\/polls\/([a-zA-Z0-9_-]+)$/);
    if (adminPollPatchMatch && method === 'PATCH') {
      const id = adminPollPatchMatch[1];
      const existing = await db
        .prepare('SELECT id, question, is_open, starts_at, ends_at FROM polls WHERE id = ?')
        .bind(id)
        .first<{ id: string; question: string; is_open: number; starts_at: string | null; ends_at: string | null }>();

      if (!existing) {
        return jsonResponse(ctx, { error: 'الاستفتاء غير موجود.' }, 404);
      }

      const body = await readJsonBody(request);
      const question =
        typeof body.question === 'string' && body.question.trim()
          ? body.question.trim().slice(0, 200)
          : existing.question;
      const isOpen = typeof body.isOpen === 'boolean' ? (body.isOpen ? 1 : 0) : existing.is_open;
      const startsAt =
        body.startsAt === null
          ? null
          : typeof body.startsAt === 'string' && Number.isFinite(Date.parse(body.startsAt))
          ? new Date(body.startsAt).toISOString()
          : existing.starts_at;
      const endsAt =
        body.endsAt === null
          ? null
          : typeof body.endsAt === 'string' && Number.isFinite(Date.parse(body.endsAt))
          ? new Date(body.endsAt).toISOString()
          : existing.ends_at;

      await db
        .prepare('UPDATE polls SET question = ?, is_open = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?')
        .bind(question, isOpen, startsAt, endsAt, new Date().toISOString(), id)
        .run();

      if (id === 'poll_extend_offer') {
        await setSetting(db, 'poll_closed', String(Number(isOpen) === 0));
      }

      if (Array.isArray(body.options)) {
        for (const opt of body.options as Array<{ key?: string; label?: string }>) {
          if (opt && typeof opt.key === 'string' && typeof opt.label === 'string' && opt.label.trim()) {
            await db
              .prepare('UPDATE poll_options SET label = ? WHERE poll_id = ? AND option_key = ?')
              .bind(opt.label.trim().slice(0, 100), id, opt.key)
              .run();
          }
        }
      }

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'poll_update',
        targetType: 'poll',
        targetId: id,
        details: { question, isOpen: Number(isOpen) === 1 },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true });
    }

    if (method === 'POST' && path === '/api/admin/poll/reset') {
      const body = await readJsonBody(request);
      const pollId = typeof body.pollId === 'string' ? body.pollId : 'poll_extend_offer';
      await db.batch([
        db.prepare('DELETE FROM user_poll_votes WHERE poll_id = ?').bind(pollId),
        db.prepare('DELETE FROM poll_votes'),
      ]);
      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'poll_reset',
        targetType: 'poll',
        targetId: pollId,
        ipHash,
      });
      return jsonResponse(ctx, { ok: true, poll: await getPollSummary(db, null, pollId) });
    }

    // Orders moderation
    const adminOrderPatchMatch = path.match(/^\/api\/admin\/orders\/([a-zA-Z0-9_-]+)$/);
    if (adminOrderPatchMatch && method === 'PATCH') {
      const id = adminOrderPatchMatch[1];
      const existing = await db
        .prepare('SELECT id, status, order_code FROM orders WHERE id = ?')
        .bind(id)
        .first<{ id: string; status: string; order_code: string }>();

      if (!existing) {
        return jsonResponse(ctx, { error: 'الطلب غير موجود.' }, 404);
      }

      const body = await readJsonBody(request);
      const allowedStatuses = ['new', 'reviewing', 'completed', 'cancelled'];
      const nextStatus =
        typeof body.status === 'string' && allowedStatuses.includes(body.status) ? body.status : existing.status;
      const purgeCredentials =
        body.purgeCredentials === true || nextStatus === 'completed' || nextStatus === 'cancelled';
      const nowIso = new Date().toISOString();

      if (purgeCredentials) {
        await db
          .prepare(
            `UPDATE orders
             SET status = ?, encrypted_password = NULL, password_iv = NULL, password_auth_tag = NULL,
                 credentials_purged = 1, updated_at = ?
             WHERE id = ?`
          )
          .bind(nextStatus, nowIso, id)
          .run();
      } else {
        await db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').bind(nextStatus, nowIso, id).run();
      }

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'order_update',
        targetType: 'order',
        targetId: id,
        details: { orderCode: existing.order_code, nextStatus, purgeCredentials },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true, status: nextStatus, credentialsPurged: purgeCredentials });
    }

    // Comments moderation
    const adminCommentMatch = path.match(/^\/api\/admin\/comments\/([a-zA-Z0-9_-]+)$/);
    if (adminCommentMatch && method === 'PATCH') {
      const id = adminCommentMatch[1];
      const existing = await db
        .prepare('SELECT id, is_verified, status FROM comments WHERE id = ?')
        .bind(id)
        .first<{ id: string; is_verified: number; status: string }>();

      if (!existing) {
        return jsonResponse(ctx, { error: 'التعليق غير موجود.' }, 404);
      }

      const body = await readJsonBody(request);
      const isVerified = typeof body.isVerified === 'boolean' ? (body.isVerified ? 1 : 0) : existing.is_verified;
      const allowedStatuses = ['approved', 'hidden', 'flagged'];
      const status =
        typeof body.status === 'string' && allowedStatuses.includes(body.status) ? body.status : existing.status;

      const ops = [
        db
          .prepare('UPDATE comments SET is_verified = ?, status = ?, updated_at = ? WHERE id = ?')
          .bind(isVerified, status, new Date().toISOString(), id),
      ];
      if (body.clearReports === true) {
        ops.push(
          db.prepare('DELETE FROM comment_reports WHERE comment_id = ?').bind(id),
          db.prepare('UPDATE comments SET reports_count = 0 WHERE id = ?').bind(id)
        );
      }
      await db.batch(ops);

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'comment_moderation',
        targetType: 'comment',
        targetId: id,
        details: { isVerified: Number(isVerified) === 1, status, clearReports: body.clearReports === true },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true });
    }

    if (adminCommentMatch && method === 'DELETE') {
      const id = adminCommentMatch[1];
      await db.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'comment_delete',
        targetType: 'comment',
        targetId: id,
        ipHash,
      });
      return jsonResponse(ctx, { ok: true });
    }

    // Question reports moderation
    const adminQReportMatch = path.match(/^\/api\/admin\/question-reports\/([a-zA-Z0-9_-]+)$/);
    if (adminQReportMatch && method === 'PATCH') {
      const id = adminQReportMatch[1];
      const existing = await db
        .prepare('SELECT id, status, admin_note FROM question_reports WHERE id = ?')
        .bind(id)
        .first<{ id: string; status: string; admin_note: string | null }>();

      if (!existing) {
        return jsonResponse(ctx, { error: 'البلاغ غير موجود.' }, 404);
      }

      const body = await readJsonBody(request);
      const allowed = ['pending', 'reviewed', 'resolved', 'dismissed'];
      const status = typeof body.status === 'string' && allowed.includes(body.status) ? body.status : existing.status;
      const adminNote =
        typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 300) : existing.admin_note;

      await db
        .prepare('UPDATE question_reports SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?')
        .bind(status, adminNote, new Date().toISOString(), id)
        .run();

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'question_report_update',
        targetType: 'question_report',
        targetId: id,
        details: { status },
        ipHash,
      });

      return jsonResponse(ctx, { ok: true, status });
    }

    // Settings update
    if (method === 'PUT' && path === '/api/admin/settings') {
      const b = await readJsonBody(request);
      const ops: Array<[string, string]> = [];
      const addNum = (field: unknown, key: string) => {
        if (field === undefined) return;
        const num = Number(field);
        if (Number.isFinite(num) && num >= 0 && num <= 10000) {
          ops.push([key, String(Math.round(num))]);
        }
      };

      addNum(b.qureoOfferPrice, 'qureo_offer_price');
      addNum(b.qureoOldPrice, 'qureo_old_price');
      addNum(b.finOfferPrice, 'fin_offer_price');
      addNum(b.finOldPrice, 'fin_old_price');
      addNum(b.bundleOfferPrice, 'bundle_offer_price');
      addNum(b.bundleOldPrice, 'bundle_old_price');

      if (typeof b.offerEndsAt === 'string' && Number.isFinite(Date.parse(b.offerEndsAt))) {
        ops.push(['offer_ends_at', new Date(b.offerEndsAt).toISOString()]);
      }
      if (b.afterOfferMode === 'regular_price' || b.afterOfferMode === 'extended_offer') {
        ops.push(['after_offer_mode', b.afterOfferMode]);
      }
      if (typeof b.ordersEnabled === 'boolean') ops.push(['orders_enabled', String(b.ordersEnabled)]);
      if (typeof b.pollClosed === 'boolean') {
        ops.push(['poll_closed', String(b.pollClosed)]);
        await db
          .prepare('UPDATE polls SET is_open = ?, updated_at = ? WHERE id = ?')
          .bind(b.pollClosed ? 0 : 1, new Date().toISOString(), 'poll_extend_offer')
          .run();
      }
      if (typeof b.notificationsEnabled === 'boolean') ops.push(['notifications_enabled', String(b.notificationsEnabled)]);
      if (b.notificationsIntervalDays !== undefined) {
        const days = Math.max(1, Math.min(30, Math.round(Number(b.notificationsIntervalDays) || 3)));
        ops.push(['notifications_interval_days', String(days)]);
      }
      if (typeof b.adminWhatsappDisplay === 'string' && b.adminWhatsappDisplay.trim()) {
        ops.push(['admin_whatsapp_display', b.adminWhatsappDisplay.replace(/[^\d]/g, '').slice(0, 20)]);
      }

      if (b.libraryAd && typeof b.libraryAd === 'object') {
        const ad = b.libraryAd as Record<string, unknown>;
        if (typeof ad.enabled === 'boolean') ops.push(['library_ad_enabled', String(ad.enabled)]);
        if (typeof ad.title === 'string' && ad.title.trim()) ops.push(['library_ad_title', ad.title.trim().slice(0, 140)]);
        if (typeof ad.subtitle === 'string' && ad.subtitle.trim()) ops.push(['library_ad_subtitle', ad.subtitle.trim().slice(0, 240)]);
        if (typeof ad.priceText === 'string' && ad.priceText.trim()) ops.push(['library_ad_price_text', ad.priceText.trim().slice(0, 140)]);
        if (typeof ad.ctaText === 'string' && ad.ctaText.trim()) ops.push(['library_ad_cta', ad.ctaText.trim().slice(0, 60)]);
        if (typeof ad.ctaLink === 'string' && ad.ctaLink.trim()) ops.push(['library_ad_cta_link', ad.ctaLink.trim().slice(0, 200)]);
        if (typeof ad.imageUrl === 'string' && ad.imageUrl.trim()) ops.push(['library_ad_image_url', ad.imageUrl.trim().slice(0, 260)]);
        if (ad.delaySeconds !== undefined) {
          ops.push(['library_ad_delay_seconds', String(Math.max(5, Math.min(600, Math.round(Number(ad.delaySeconds) || 60))))]);
        }
        if (ad.cooldownHours !== undefined) {
          ops.push(['library_ad_cooldown_hours', String(Math.max(1, Math.min(720, Math.round(Number(ad.cooldownHours) || 24))))]);
        }
        if (ad.templateMode === 'classic' || ad.templateMode === 'rich_crovo') {
          ops.push(['library_ad_template_mode', ad.templateMode]);
        }
      }

      if (b.heroPromo && typeof b.heroPromo === 'object') {
        const hp = b.heroPromo as Record<string, unknown>;
        if (typeof hp.enabled === 'boolean') ops.push(['hero_promo_enabled', String(hp.enabled)]);
        if (typeof hp.title === 'string' && hp.title.trim()) ops.push(['hero_promo_title', hp.title.trim().slice(0, 140)]);
        if (typeof hp.subtitle === 'string' && hp.subtitle.trim()) ops.push(['hero_promo_subtitle', hp.subtitle.trim().slice(0, 260)]);
      }

      if (b.promoBanner && typeof b.promoBanner === 'object') {
        const pb = b.promoBanner as Record<string, unknown>;
        if (typeof pb.enabled === 'boolean') ops.push(['promo_banner_enabled', String(pb.enabled)]);
        if (typeof pb.text === 'string' && pb.text.trim()) ops.push(['promo_banner_text', pb.text.trim().slice(0, 200)]);
      }

      if (ops.length > 0) {
        await db.batch(
          ops.map(([k, v]) =>
            db
              .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
              .bind(k, v)
          )
        );
      }

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'settings_update',
        targetType: 'settings',
        ipHash,
      });

      return jsonResponse(ctx, { ok: true, config: await getSiteConfig(db) });
    }

    if (method === 'POST' && path === '/api/admin/push/send') {
      const body = await readJsonBody(request);
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : NOTIFICATION_TEMPLATES[0].title;
      const msgBody = typeof body.body === 'string' && body.body.trim() ? body.body.trim() : NOTIFICATION_TEMPLATES[0].body;
      const category =
        body.category === 'service' || body.category === 'update' ? body.category : 'offer';

      await db
        .prepare(
          `INSERT INTO notification_logs (id, message_id, category, title, body, sent_count, failed_count, trigger_type, error_detail, created_at)
           VALUES (?, ?, ?, ?, ?, 0, 0, 'manual', 'Edge D1 log recorded (use Node worker/trigger for WebPush VAPID delivery)', ?)`
        )
        .bind(generateId('nlog'), 'edge_manual', category, title.slice(0, 120), msgBody.slice(0, 300), new Date().toISOString())
        .run();

      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'push_log_recorded',
        targetType: 'push',
        details: { title },
        ipHash,
      });

      return jsonResponse(ctx, {
        ok: true,
        result: { sentCount: 0, failedCount: 0, note: 'Recorded in D1 notification logs' },
      });
    }

    if (method === 'POST' && path === '/api/admin/backup') {
      const tables = ['settings', 'users', 'comments', 'likes', 'polls', 'poll_options', 'user_poll_votes', 'orders', 'question_stats', 'question_reports', 'library_chapters', 'library_questions'];
      const counts: Record<string, number> = {};
      for (const tbl of tables) {
        const row = await db.prepare(`SELECT COUNT(*) as cnt FROM ${tbl}`).first<{ cnt: number }>();
        counts[tbl] = Number(row?.cnt || 0);
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await logAdminAudit(db, {
        actorUsername: actor,
        action: 'd1_snapshot_checked',
        targetType: 'database',
        targetId: `crovo-d1-${stamp}`,
        details: counts,
        ipHash,
      });
      return jsonResponse(ctx, {
        ok: true,
        backup: { filename: `crovo-d1-${stamp}.json`, sizeBytes: JSON.stringify(counts).length, createdAt: new Date().toISOString() },
        counts,
        backups: [],
      }, 201);
    }

    if (method === 'GET' && path === '/api/admin/audit-logs') {
      const logsRes = await db
        .prepare(
          `SELECT id, actor_username as actorUsername, action, target_type as targetType,
                  target_id as targetId, details_json as detailsJson, created_at as createdAt
           FROM audit_logs
           ORDER BY created_at DESC
           LIMIT 150`
        )
        .all();
      return jsonResponse(ctx, { logs: logsRes.results || [] });
    }
  }

  return jsonResponse(ctx, { error: 'المسار المطلوب غير موجود.' }, 404);
}

export const onRequest: PagesFunction = async (context) => {
  return handleApiRequest(context.request, context.env);
};
