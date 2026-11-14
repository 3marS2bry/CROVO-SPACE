import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  createDatabase,
  getSiteConfig,
  setSetting,
  purgeExpiredOrderCredentials,
  withTransaction,
  checkDatabaseIntegrity,
  createDatabaseBackup,
  listDatabaseBackups,
  checkpointDatabase,
} from './server/db.ts';
import {
  encryptSecret,
  decryptSecret,
  signToken,
  verifyToken,
  hashIp,
  sha256Hex,
  generateId,
  safeCompareStrings,
  hashPassword,
  verifyPassword,
} from './server/crypto.ts';
import {
  calculateOrderPricing,
  isOfferCurrentlyActive,
  validateOrderPayload,
  validateCommentPayload,
  validateQuestionReportPayload,
  formatOrderCode,
} from './server/domain.ts';
import {
  ensureVapidKeys,
  dispatchDueNotifications,
  NOTIFICATION_TEMPLATES,
} from './server/push.ts';
import { ensureInitialSeedData } from './server/librarySeed.ts';
import { recordAnalyticsEvent, getDashboardAnalytics } from './server/analytics.ts';
import {
  registerExtendedAdminRoutes,
  logAdminAudit,
  type AdminRequestContext,
} from './server/adminRoutes.ts';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  grade: 'bac1' | 'bac2';
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  suspendReason: string | null;
}

interface RequestWithContext extends Request {
  visitorId?: string;
  visitorToken?: string;
  ipHash?: string;
  currentUser?: AuthUser | null;
  adminUsername?: string;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
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

function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const cutoff = now - windowMs;
    const list = (hits.get(key) || []).filter((ts) => ts > cutoff);
    if (list.length >= maxRequests) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    return true;
  };
}

function buildCookieOptions(req: Request, maxAge: number, httpOnly = true) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly,
    // Cross-site iframe previews on HTTPS require SameSite=None; Secure so cookies persist across requests/reloads
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    secure: isHttps,
    path: '/',
    maxAge,
  };
}

export interface CreateServerOptions {
  dbPath?: string;
  uploadsDir?: string;
  backupsDir?: string;
  skipVite?: boolean;
  sessionSecret?: string;
  encryptionKey?: string;
  adminUsername?: string;
  adminPassword?: string;
}

function resolveRuntimeSecrets(
  options: CreateServerOptions,
  dataDir: string,
  db: ReturnType<typeof createDatabase>
): { sessionSecret: string; encryptionKey: string } {
  const isProd = process.env.NODE_ENV === 'production';
  const envSession = (options.sessionSecret || process.env.SESSION_SECRET || '').trim();
  const envEncryption = (options.encryptionKey || process.env.CREDENTIAL_ENCRYPTION_KEY || '').trim();

  if (envSession && envEncryption) {
    if (isProd && envSession === envEncryption) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY must be independent from SESSION_SECRET in production.');
    }
    return { sessionSecret: envSession, encryptionKey: envEncryption };
  }

  const devSecretsFile = path.join(dataDir, '.local-dev-secrets.json');
  let stored: { sessionSecret?: string; encryptionKey?: string } = {};
  if (fs.existsSync(devSecretsFile)) {
    try {
      stored = JSON.parse(fs.readFileSync(devSecretsFile, 'utf8'));
    } catch {
      stored = {};
    }
  }

  const dbSessionRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('_runtime_session_secret') as
    | { value?: string }
    | undefined;
  const dbEncRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('_runtime_encryption_key') as
    | { value?: string }
    | undefined;

  const sessionSecret =
    envSession || dbSessionRow?.value || stored.sessionSecret || crypto.randomBytes(32).toString('hex');
  let encryptionKey =
    envEncryption || dbEncRow?.value || stored.encryptionKey || crypto.randomBytes(32).toString('hex');

  if (encryptionKey === sessionSecret) {
    encryptionKey = crypto.randomBytes(32).toString('hex');
  }

  if (!dbSessionRow?.value || !dbEncRow?.value) {
    try {
      setSetting(db, '_runtime_session_secret', sessionSecret);
      setSetting(db, '_runtime_encryption_key', encryptionKey);
    } catch {
      // Ignore if DB is read-only
    }
  }

  if (!stored.sessionSecret || !stored.encryptionKey) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(devSecretsFile, JSON.stringify({ sessionSecret, encryptionKey }, null, 2), {
        mode: 0o600,
      });
    } catch {
      // Ignore if ephemeral
    }
  }

  if (isProd && options.dbPath !== ':memory:' && (!envSession || !envEncryption)) {
    console.warn(
      'Notice: SESSION_SECRET / CREDENTIAL_ENCRYPTION_KEY not set in env; using persistent auto-generated SQLite runtime keys.'
    );
  }

  return { sessionSecret, encryptionKey };
}

export async function createCrovoApp(options: CreateServerOptions = {}) {
  const dbPath = options.dbPath || path.resolve(process.cwd(), 'data', 'crovo.db');
  const dataDir = dbPath === ':memory:' ? path.resolve(process.cwd(), 'data') : path.dirname(dbPath);
  const uploadsDir = options.uploadsDir || path.join(dataDir, 'uploads');
  const backupsDir = options.backupsDir || path.join(dataDir, 'backups');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const db = createDatabase(dbPath);
  ensureInitialSeedData(db);
  checkpointDatabase(db);

  const { sessionSecret, encryptionKey } = resolveRuntimeSecrets(options, dataDir, db);

  const adminUsername = (options.adminUsername ?? process.env.ADMIN_USERNAME ?? '').trim();
  const adminPassword = options.adminPassword ?? process.env.ADMIN_PASSWORD ?? '';

  ensureVapidKeys(db);

  const app = express();
  app.set('trust proxy', 1);

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '4mb' }));

  // Visitor & User session middleware (Cookie + signed Header token fallback for cross-origin iframes)
  app.use((req: RequestWithContext, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const headerVisitorToken =
      typeof req.headers['x-crovo-visitor'] === 'string' ? req.headers['x-crovo-visitor'].trim() : '';

    const candidateToken = cookies['crovo_visitor'] || headerVisitorToken;
    const parsed = candidateToken ? verifyToken<{ vid: string }>(candidateToken, sessionSecret) : null;

    if (parsed && typeof parsed.vid === 'string' && parsed.vid.length >= 6) {
      req.visitorId = parsed.vid;
      req.visitorToken = candidateToken;
      if (!cookies['crovo_visitor']) {
        res.cookie('crovo_visitor', candidateToken, buildCookieOptions(req, 365 * 24 * 60 * 60 * 1000));
      }
    } else {
      const vid = generateId('v');
      req.visitorId = vid;
      const signed = signToken({ vid }, sessionSecret);
      req.visitorToken = signed;
      res.cookie('crovo_visitor', signed, buildCookieOptions(req, 365 * 24 * 60 * 60 * 1000));
    }
    res.setHeader('X-Crovo-Visitor-Token', req.visitorToken);

    const clientIp =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.ip) || 'unknown';
    req.ipHash = hashIp(clientIp, sessionSecret);

    // Resolve signed-in user from HttpOnly cookie or Authorization: Bearer <token>
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const userRawToken = cookies['crovo_user'] || bearerToken;
    req.currentUser = null;

    if (userRawToken) {
      const tokenHash = sha256Hex(userRawToken);
      const sessionRow = db
        .prepare(
          `SELECT s.id as sessionId, s.expires_at as expiresAt,
                  u.id, u.name, u.email, u.grade, u.role, u.status, u.suspend_reason as suspendReason
           FROM user_sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ?`
        )
        .get(tokenHash) as
        | {
            sessionId: string;
            expiresAt: string;
            id: string;
            name: string;
            email: string;
            grade: 'bac1' | 'bac2';
            role: 'user' | 'admin';
            status: 'active' | 'suspended';
            suspendReason: string | null;
          }
        | undefined;

      if (sessionRow && Date.parse(sessionRow.expiresAt) > Date.now()) {
        if (sessionRow.status === 'active') {
          req.currentUser = {
            id: sessionRow.id,
            name: sessionRow.name,
            email: sessionRow.email,
            grade: sessionRow.grade,
            role: sessionRow.role,
            status: sessionRow.status,
            suspendReason: sessionRow.suspendReason,
          };
          const nowIso = new Date().toISOString();
          db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?').run(nowIso, sessionRow.sessionId);
          db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(nowIso, sessionRow.id);
        }
      }
    }

    next();
  });

  // Rate limiters
  const authLimiter = createRateLimiter(12, 15 * 60 * 1000);
  const commentLimiter = createRateLimiter(6, 10 * 60 * 1000);
  const reportLimiter = createRateLimiter(12, 10 * 60 * 1000);
  const likeLimiter = createRateLimiter(45, 60 * 1000);
  const pollLimiter = createRateLimiter(15, 10 * 60 * 1000);
  const orderLimiter = createRateLimiter(8, 15 * 60 * 1000);
  const loginLimiter = createRateLimiter(8, 15 * 60 * 1000);
  const copyLimiter = createRateLimiter(120, 60 * 1000);
  const questionReportLimiter = createRateLimiter(10, 15 * 60 * 1000);

  function getAdminSession(req: RequestWithContext): { username: string } | null {
    // 1. Check signed-in user with admin role
    if (req.currentUser && req.currentUser.role === 'admin' && req.currentUser.status === 'active') {
      return { username: req.currentUser.email };
    }

    // 2. Check crovo_admin cookie or X-Crovo-Admin-Token header
    const cookies = parseCookies(req.headers.cookie);
    const headerAdmin =
      typeof req.headers['x-crovo-admin-token'] === 'string' ? req.headers['x-crovo-admin-token'].trim() : '';
    const token = cookies['crovo_admin'] || headerAdmin;
    if (!token) return null;
    const payload = verifyToken<{ role: string; username: string; exp: number }>(token, sessionSecret);
    if (!payload || payload.role !== 'admin') return null;
    if (!adminUsername || !safeCompareStrings(payload.username || '', adminUsername)) return null;
    return { username: payload.username };
  }

  function requireAdmin(req: AdminRequestContext, res: Response, next: NextFunction) {
    const session = getAdminSession(req as RequestWithContext);
    if (!session) {
      res.status(401).json({ error: 'غير مصرح بالدخول. من فضلك سجل دخول الإدارة أولاً.' });
      return;
    }
    req.adminUsername = session.username;
    next();
  }

  function saveUploadedImage(data: { ext: string; mimeType: string; buffer: Buffer } | null): string | null {
    if (!data) return null;
    const filename = `${generateId('img')}.${data.ext}`;
    const nowIso = new Date().toISOString();

    db.prepare(
      'INSERT INTO uploaded_media (id, mime_type, data, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(filename, data.mimeType, data.buffer, data.buffer.length, nowIso);

    try {
      fs.writeFileSync(path.join(uploadsDir, filename), data.buffer);
    } catch {
      // Disk mirror is best-effort
    }

    return `/uploads/${filename}`;
  }

  function createUserSession(req: Request, res: Response, userId: string): string {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(rawToken);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(generateId('usess'), userId, tokenHash, expiresAt, nowIso, nowIso);

    res.cookie('crovo_user', rawToken, buildCookieOptions(req, 30 * 24 * 60 * 60 * 1000));
    return rawToken;
  }

  function migrateVisitorActivityToUser(visitorId: string, userId: string): void {
    // Preserve anonymous likes/comments when user registers or signs in from same browser
    try {
      const visitorLikes = db
        .prepare('SELECT item_key, created_at FROM likes WHERE visitor_id = ? AND user_id IS NULL')
        .all(visitorId) as Array<{ item_key: string; created_at: string }>;
      for (const l of visitorLikes) {
        const alreadyUserLiked = db
          .prepare('SELECT 1 FROM likes WHERE item_key = ? AND user_id = ?')
          .get(l.item_key, userId);
        if (!alreadyUserLiked) {
          db.prepare('UPDATE likes SET user_id = ? WHERE item_key = ? AND visitor_id = ?').run(
            userId,
            l.item_key,
            visitorId
          );
        }
      }
      db.prepare('UPDATE comments SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL').run(
        userId,
        visitorId
      );
      db.prepare('UPDATE push_subscriptions SET user_id = ? WHERE visitor_id = ? AND user_id IS NULL').run(
        userId,
        visitorId
      );
    } catch {
      // Ignore partial migration conflict
    }
  }

  // Serve uploaded images safely
  app.get('/uploads/:filename', (req: Request, res: Response) => {
    const filename = req.params.filename;
    if (!/^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(filename)) {
      res.status(404).end();
      return;
    }

    const row = db
      .prepare('SELECT mime_type, data FROM uploaded_media WHERE id = ?')
      .get(filename) as { mime_type: string; data: Uint8Array } | undefined;

    if (row && row.data) {
      res.setHeader('Content-Type', row.mime_type);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(row.data));
      return;
    }

    const targetPath = path.join(uploadsDir, filename);
    if (!fs.existsSync(targetPath)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(targetPath);
  });

  // 0. User Account Auth API
  app.post('/api/auth/register', (req: RequestWithContext, res: Response) => {
    if (!authLimiter(`reg:${req.ipHash}`)) {
      res.status(429).json({ error: 'محاولات تسجيل كثيرة، انتظر قليلاً.' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const grade = req.body?.grade === 'bac2' ? 'bac2' : 'bac1';

    if (name.length < 2 || name.length > 60) {
      res.status(400).json({ error: 'اكتب اسمك الكامل (حرفين على الأقل).' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
      res.status(400).json({ error: 'من فضلك اكتب بريد إلكتروني صحيح.' });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'كلمة المرور لازم تكون 6 أحرف على الأقل.' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      res.status(409).json({ error: 'البريد الإلكتروني مسجل بالفعل. جرب تسجيل الدخول.' });
      return;
    }

    const id = generateId('usr');
    const nowIso = new Date().toISOString();
    const passHash = hashPassword(password);

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO users (id, name, email, password_hash, grade, role, status, last_active_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'user', 'active', ?, ?)`
      ).run(id, name, email, passHash, grade, nowIso, nowIso);
      migrateVisitorActivityToUser(req.visitorId!, id);
    });

    const token = createUserSession(req, res, id);
    checkpointDatabase(db);

    res.status(201).json({
      ok: true,
      token,
      user: { id, name, email, grade, role: 'user', status: 'active' },
    });
  });

  app.post('/api/auth/login', (req: RequestWithContext, res: Response) => {
    if (!authLimiter(`log:${req.ipHash}`)) {
      res.status(429).json({ error: 'محاولات دخول كثيرة، استنى شوية وحاول تاني.' });
      return;
    }

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      res.status(400).json({ error: 'اكتب البريد الإلكتروني وكلمة المرور.' });
      return;
    }

    const userRow = db
      .prepare('SELECT id, name, email, password_hash, grade, role, status, suspend_reason FROM users WHERE email = ?')
      .get(email) as
      | {
          id: string;
          name: string;
          email: string;
          password_hash: string;
          grade: 'bac1' | 'bac2';
          role: 'user' | 'admin';
          status: 'active' | 'suspended';
          suspend_reason: string | null;
        }
      | undefined;

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' });
      return;
    }

    if (userRow.status === 'suspended') {
      res.status(403).json({
        error: `تم إيقاف هذا الحساب مؤقتًا: ${userRow.suspend_reason || 'تواصل مع الإدارة'}.`,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    withTransaction(db, () => {
      db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(nowIso, userRow.id);
      migrateVisitorActivityToUser(req.visitorId!, userRow.id);
    });

    const token = createUserSession(req, res, userRow.id);
    checkpointDatabase(db);

    res.json({
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
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const rawToken = cookies['crovo_user'] || bearerToken;
    if (rawToken) {
      db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(sha256Hex(rawToken));
    }
    res.clearCookie('crovo_user', buildCookieOptions(req, 0));
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req: RequestWithContext, res: Response) => {
    if (!req.currentUser) {
      res.json({ authenticated: false, user: null });
      return;
    }
    res.json({ authenticated: true, user: req.currentUser });
  });

  // 1. Public Config & Countdown
  app.get('/api/config', (_req: Request, res: Response) => {
    purgeExpiredOrderCredentials(db);
    const config = getSiteConfig(db);
    const nowMs = Date.now();
    const offerActive = isOfferCurrentlyActive(config, nowMs);
    res.json({
      ...config,
      offerActive,
      serverTime: new Date(nowMs).toISOString(),
    });
  });

  // 1B. Dynamic Library CMS Public Read
  app.get('/api/library', (req: Request, res: Response) => {
    const grade = req.query.grade === 'bac2' ? 'bac2' : 'bac1';
    const section =
      grade === 'bac1'
        ? 'js'
        : req.query.section === 'py' || req.query.section === 'fin'
        ? req.query.section
        : 'js';

    const chapterRows = db
      .prepare(
        `SELECT id, chapter_num as num, title
         FROM library_chapters
         WHERE grade = ? AND section = ?
         ORDER BY sort_order ASC, chapter_num ASC`
      )
      .all(grade, section) as Array<{ id: string; num: number; title: string }>;

    const questionRows = db
      .prepare(
        `SELECT chapter_num as chapterNum, q_text as q, a_text as a, is_code as isCode
         FROM library_questions
         WHERE grade = ? AND section = ?
         ORDER BY chapter_num ASC, q_index ASC`
      )
      .all(grade, section) as Array<{ chapterNum: number; q: string; a: string; isCode: number }>;

    const byChapter = new Map<number, Array<{ q: string; a: string; code: boolean }>>();
    for (const row of questionRows) {
      const arr = byChapter.get(row.chapterNum) || [];
      arr.push({ q: row.q, a: row.a, code: row.isCode === 1 });
      byChapter.set(row.chapterNum, arr);
    }

    const chapters = chapterRows.map((c) => ({
      num: c.num,
      title: c.title,
      qs: byChapter.get(c.num) || [],
    }));

    res.json({ grade, section, chapters });
  });

  // 1C. Public Analytics Event Tracking
  app.post('/api/analytics/event', (req: RequestWithContext, res: Response) => {
    const eventType = typeof req.body?.eventType === 'string' ? req.body.eventType.trim() : '';
    const allowed = ['page_view', 'library_open', 'level_view', 'library_search', 'tool_view'];
    if (!allowed.includes(eventType)) {
      res.status(400).json({ error: 'نوع الحدث غير مدعوم.' });
      return;
    }

    recordAnalyticsEvent(db, {
      eventType,
      visitorId: req.visitorId!,
      userId: req.currentUser?.id || null,
      sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : null,
      path: typeof req.body?.path === 'string' ? req.body.path : null,
      grade: req.body?.grade === 'bac2' ? 'bac2' : req.body?.grade === 'bac1' ? 'bac1' : null,
      section:
        req.body?.section === 'py' || req.body?.section === 'fin' || req.body?.section === 'js'
          ? req.body.section
          : null,
      chapterNum: typeof req.body?.chapterNum === 'number' ? req.body.chapterNum : null,
      query: typeof req.body?.query === 'string' ? req.body.query : null,
      resultsCount: typeof req.body?.resultsCount === 'number' ? req.body.resultsCount : null,
    });

    res.status(202).json({ ok: true });
  });

  // 2. Shared Library Copy Stats & Answer Issue Reporting
  app.get('/api/questions/stats', (_req: Request, res: Response) => {
    const totalRow = db
      .prepare('SELECT COALESCE(SUM(copy_count), 0) as totalCopies FROM question_stats')
      .get() as { totalCopies: number };

    const allRows = db
      .prepare('SELECT question_key, copy_count FROM question_stats WHERE copy_count > 0')
      .all() as Array<{ question_key: string; copy_count: number }>;

    const copyCounts: Record<string, number> = {};
    for (const r of allRows) {
      copyCounts[r.question_key] = Number(r.copy_count);
    }

    const topQuestions = db
      .prepare(
        `SELECT question_key as questionKey, grade, section, chapter_num as chapterNum,
                q_index as qIndex, question_title as questionTitle, copy_count as copyCount
         FROM question_stats
         WHERE copy_count > 0
         ORDER BY copy_count DESC, last_copied_at DESC
         LIMIT 6`
      )
      .all() as Array<{
      questionKey: string;
      grade: string;
      section: string;
      chapterNum: number;
      qIndex: number;
      questionTitle: string;
      copyCount: number;
    }>;

    res.json({
      totalCopies: Number(totalRow?.totalCopies || 0),
      copyCounts,
      topQuestions,
    });
  });

  app.post('/api/questions/copy', (req: RequestWithContext, res: Response) => {
    if (!copyLimiter(`copy:${req.ipHash}:${req.visitorId}`)) {
      res.status(429).json({ error: 'نسخ سريع جداً، انتظر لحظة.' });
      return;
    }

    const questionKey = typeof req.body?.questionKey === 'string' ? req.body.questionKey.trim() : '';
    if (!/^[a-zA-Z0-9_-]{4,60}$/.test(questionKey)) {
      res.status(400).json({ error: 'معرّف السؤال غير صالح.' });
      return;
    }

    const grade = req.body?.grade === 'bac2' ? 'bac2' : 'bac1';
    const section = req.body?.section === 'py' || req.body?.section === 'fin' ? req.body.section : 'js';
    const chapterNum = Math.max(1, Math.min(200, Math.round(Number(req.body?.chapterNum) || 1)));
    const qIndex = Math.max(0, Math.min(500, Math.round(Number(req.body?.qIndex) || 0)));
    const questionTitle =
      typeof req.body?.questionTitle === 'string' && req.body.questionTitle.trim()
        ? req.body.questionTitle.trim().slice(0, 180)
        : `السؤال ${qIndex + 1}`;
    const nowIso = new Date().toISOString();

    const copyCount = withTransaction(db, () => {
      db.prepare(
        `INSERT INTO question_stats (
          question_key, grade, section, chapter_num, q_index, question_title, copy_count, last_copied_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(question_key) DO UPDATE SET
          copy_count = question_stats.copy_count + 1,
          question_title = excluded.question_title,
          last_copied_at = excluded.last_copied_at`
      ).run(questionKey, grade, section, chapterNum, qIndex, questionTitle, nowIso);

      const row = db
        .prepare('SELECT copy_count FROM question_stats WHERE question_key = ?')
        .get(questionKey) as { copy_count: number };
      return Number(row?.copy_count || 1);
    });

    res.json({ ok: true, questionKey, copyCount });
  });

  app.post('/api/questions/report', (req: RequestWithContext, res: Response) => {
    if (!questionReportLimiter(`qrep:${req.ipHash}:${req.visitorId}`)) {
      res.status(429).json({ error: 'أرسلت بلاغات كتير في وقت قصير، حاول تاني بعد شوية.' });
      return;
    }

    try {
      const input = validateQuestionReportPayload(req.body || {});
      const id = generateId('qrep');
      const nowIso = new Date().toISOString();

      try {
        db.prepare(
          `INSERT INTO question_reports (
            id, question_key, grade, section, chapter_num, q_index, question_title,
            description, visitor_id, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
        ).run(
          id,
          input.questionKey,
          input.grade,
          input.section,
          input.chapterNum,
          input.qIndex,
          input.questionTitle,
          input.description,
          req.visitorId!,
          nowIso
        );
      } catch {
        res.status(409).json({ error: 'أنت بلغت عن السؤال ده قبل كده بالفعل، والبلاغ تحت المراجعة.' });
        return;
      }

      res.status(201).json({
        ok: true,
        reportId: id,
        message: 'شكرًا لك! وصل بلاغك وهيتم مراجعة الإجابة من الإدارة وتحديثها.',
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إرسال البلاغ.' });
    }
  });

  // 3. Free Standard Web Push Notifications API
  app.get('/api/push/vapid-public-key', (_req: Request, res: Response) => {
    const config = getSiteConfig(db);
    const keys = ensureVapidKeys(db);
    res.json({
      publicKey: keys.publicKey,
      enabled: config.notificationsEnabled,
      intervalDays: config.notificationsIntervalDays,
    });
  });

  app.get('/api/push/status', (req: RequestWithContext, res: Response) => {
    const config = getSiteConfig(db);
    const row = req.currentUser
      ? (db
          .prepare(
            'SELECT endpoint, enabled, updated_at FROM push_subscriptions WHERE (user_id = ? OR visitor_id = ?) AND enabled = 1 LIMIT 1'
          )
          .get(req.currentUser.id, req.visitorId!) as { endpoint: string } | undefined)
      : (db
          .prepare('SELECT endpoint, enabled, updated_at FROM push_subscriptions WHERE visitor_id = ? AND enabled = 1 LIMIT 1')
          .get(req.visitorId!) as { endpoint: string } | undefined);

    res.json({
      subscribed: Boolean(row),
      notificationsEnabled: config.notificationsEnabled,
      intervalDays: config.notificationsIntervalDays,
    });
  });

  app.post('/api/push/subscribe', (req: RequestWithContext, res: Response) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    const p256dh = typeof req.body?.keys?.p256dh === 'string' ? req.body.keys.p256dh.trim() : '';
    const auth = typeof req.body?.keys?.auth === 'string' ? req.body.keys.auth.trim() : '';

    if (!endpoint.startsWith('https://') || endpoint.length > 1000 || !p256dh || !auth) {
      res.status(400).json({ error: 'بيانات اشتراك الإشعارات غير صالحة.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const id = generateId('sub');

    db.prepare(
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
    ).run(id, req.visitorId!, req.currentUser?.id || null, endpoint, p256dh, auth, nowIso, nowIso);

    checkpointDatabase(db);
    res.status(201).json({ ok: true, subscribed: true });
  });

  app.post('/api/push/unsubscribe', (req: RequestWithContext, res: Response) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    const nowIso = new Date().toISOString();

    if (endpoint) {
      db.prepare('UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE endpoint = ?').run(
        nowIso,
        endpoint
      );
    } else if (req.currentUser) {
      db.prepare('UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE user_id = ? OR visitor_id = ?').run(
        nowIso,
        req.currentUser.id,
        req.visitorId!
      );
    } else {
      db.prepare('UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE visitor_id = ?').run(
        nowIso,
        req.visitorId!
      );
    }

    checkpointDatabase(db);
    res.json({ ok: true, subscribed: false });
  });

  // Safe client-side push failure diagnostic log (never accepts tokens/keys)
  app.post('/api/push/log-error', (req: RequestWithContext, res: Response) => {
    const stage = typeof req.body?.stage === 'string' ? req.body.stage.slice(0, 40) : 'unknown';
    const errorCode = typeof req.body?.errorCode === 'string' ? req.body.errorCode.slice(0, 80) : 'unknown';
    const detail = typeof req.body?.detail === 'string' ? req.body.detail.slice(0, 180) : '';
    try {
      db.prepare(
        `INSERT INTO notification_logs (id, message_id, category, title, body, sent_count, failed_count, trigger_type, error_detail, created_at)
         VALUES (?, 'client_diagnostic', 'update', ?, ?, 0, 1, 'client_error', ?, ?)`
      ).run(
        generateId('pusherr'),
        `فشل تفعيل إشعارات (${stage})`,
        detail || errorCode,
        `${stage}: ${errorCode}`,
        new Date().toISOString()
      );
    } catch {
      // Ignore logging error
    }
    res.status(202).json({ ok: true });
  });

  app.post('/api/push/cron-dispatch', async (req: Request, res: Response) => {
    const expected = (process.env.PUSH_CRON_SECRET || '').trim();
    const provided = String(req.headers['x-cron-secret'] || '');
    if (!expected || !safeCompareStrings(provided, expected)) {
      res.status(401).json({ error: 'غير مصرح.' });
      return;
    }
    const result = await dispatchDueNotifications(db, {
      mode: 'due',
      triggerType: 'scheduled_3d',
    });
    res.json({ ok: true, result });
  });

  // 4. Shared Comments / Customer Reviews API (Permanent DB Persistence)
  app.get('/api/comments', (req: RequestWithContext, res: Response) => {
    const rows = db
      .prepare(
        `SELECT id, visitor_id, user_id, author_name, grade, rating, content, avatar_url, attachment_url,
                contact_phone, show_contact_publicly, is_verified, status, reports_count, created_at, updated_at
         FROM comments
         WHERE status = 'approved'
         ORDER BY created_at DESC
         LIMIT 200`
      )
      .all() as Array<Record<string, unknown>>;

    const likeCountsRows = db
      .prepare(
        `SELECT item_key, COUNT(*) as cnt
         FROM likes
         WHERE item_key LIKE 'comment:%'
         GROUP BY item_key`
      )
      .all() as Array<{ item_key: string; cnt: number }>;

    const likesMap = new Map<string, number>();
    for (const lr of likeCountsRows) {
      likesMap.set(lr.item_key, Number(lr.cnt || 0));
    }

    const userLikedRows = req.currentUser
      ? (db
          .prepare(
            `SELECT item_key FROM likes WHERE item_key LIKE 'comment:%' AND (user_id = ? OR visitor_id = ?)`
          )
          .all(req.currentUser.id, req.visitorId!) as Array<{ item_key: string }>)
      : (db
          .prepare(`SELECT item_key FROM likes WHERE item_key LIKE 'comment:%' AND visitor_id = ?`)
          .all(req.visitorId!) as Array<{ item_key: string }>);
    const visitorLikedSet = new Set(userLikedRows.map((v) => v.item_key));

    const comments = rows.map((r) => {
      const likeKey = `comment:${String(r.id)}`;
      const isOwner =
        (req.currentUser && r.user_id && r.user_id === req.currentUser.id) ||
        r.visitor_id === req.visitorId;
      return {
        id: r.id,
        authorName: r.author_name,
        grade: r.grade,
        rating: r.rating,
        content: r.content,
        avatarUrl: r.avatar_url || null,
        attachmentUrl: r.attachment_url || null,
        contactPhone: null,
        showContactPublicly: false,
        isVerified: r.is_verified === 1,
        isOwner: Boolean(isOwner),
        likesCount: likesMap.get(likeKey) || 0,
        hasLiked: visitorLikedSet.has(likeKey),
        createdAt: r.created_at,
        updatedAt: r.updated_at || null,
      };
    });

    res.json({ comments });
  });

  app.post('/api/comments', (req: RequestWithContext, res: Response) => {
    const rateKey = `cmt:${req.ipHash}:${req.visitorId}`;
    if (!commentLimiter(rateKey)) {
      res.status(429).json({ error: 'أرسلت تعليقات كتير في وقت قصير، استنى شوية وحاول تاني.' });
      return;
    }

    try {
      const validated = validateCommentPayload(req.body || {});
      const contentHash = sha256Hex(`${validated.authorName.toLowerCase()}::${validated.content.toLowerCase()}`);

      const dup = db
        .prepare(
          `SELECT id FROM comments
           WHERE content_hash = ? AND (visitor_id = ? OR (user_id IS NOT NULL AND user_id = ?) OR created_at > ?)`
        )
        .get(contentHash, req.visitorId!, req.currentUser?.id || '', new Date(Date.now() - 10 * 60 * 1000).toISOString());

      if (dup) {
        res.status(409).json({ error: 'التعليق ده مكرر بالفعل! اكتب تجربة جديدة عشان تفيد زمايلك.' });
        return;
      }

      const completedOrder = db
        .prepare(
          "SELECT id FROM orders WHERE (visitor_id = ? OR (user_id IS NOT NULL AND user_id = ?)) AND status = 'completed' LIMIT 1"
        )
        .get(req.visitorId!, req.currentUser?.id || '');

      const avatarUrl = saveUploadedImage(validated.avatarImage);
      const attachmentUrl = saveUploadedImage(validated.attachmentImage);
      const id = generateId('cmt');
      const nowIso = new Date().toISOString();
      const isVerified = completedOrder ? 1 : 0;

      db.prepare(
        `INSERT INTO comments (
          id, visitor_id, user_id, author_name, grade, rating, content,
          avatar_url, attachment_url, contact_phone, show_contact_publicly,
          is_verified, status, reports_count, content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 0, ?, ?)`
      ).run(
        id,
        req.visitorId!,
        req.currentUser?.id || null,
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
      );

      checkpointDatabase(db);

      res.status(201).json({
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
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'بيانات التعليق غير صحيحة.' });
    }
  });

  app.patch('/api/comments/:id', (req: RequestWithContext, res: Response) => {
    const id = req.params.id;
    const existing = db
      .prepare('SELECT id, visitor_id, user_id, author_name, grade, rating, content, contact_phone, show_contact_publicly FROM comments WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!existing) {
      res.status(404).json({ error: 'التعليق غير موجود.' });
      return;
    }

    const ownsByUser = Boolean(req.currentUser && existing.user_id && existing.user_id === req.currentUser.id);
    const ownsByVisitor = existing.visitor_id === req.visitorId;
    if (!ownsByUser && !ownsByVisitor) {
      res.status(403).json({ error: 'مش مسموحلك تعدل تعليق غيرك.' });
      return;
    }

    try {
      const merged = {
        authorName: req.body?.authorName ?? existing.author_name,
        grade: req.body?.grade ?? existing.grade,
        rating: req.body?.rating ?? existing.rating,
        content: req.body?.content ?? existing.content,
        contactPhone: req.body?.contactPhone ?? existing.contact_phone,
        showContactPublicly:
          typeof req.body?.showContactPublicly === 'boolean'
            ? req.body.showContactPublicly
            : existing.show_contact_publicly === 1,
      };
      const validated = validateCommentPayload(merged);
      const nowIso = new Date().toISOString();
      const contentHash = sha256Hex(`${validated.authorName.toLowerCase()}::${validated.content.toLowerCase()}`);

      db.prepare(
        `UPDATE comments
         SET author_name = ?, grade = ?, rating = ?, content = ?,
             contact_phone = ?, show_contact_publicly = ?, content_hash = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        validated.authorName,
        validated.grade,
        validated.rating,
        validated.content,
        validated.contactPhone,
        validated.showContactPublicly ? 1 : 0,
        contentHash,
        nowIso,
        id
      );

      checkpointDatabase(db);
      res.json({ ok: true, updatedAt: nowIso });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر تعديل التعليق.' });
    }
  });

  app.delete('/api/comments/:id', (req: RequestWithContext, res: Response) => {
    const id = req.params.id;
    const existing = db
      .prepare('SELECT id, visitor_id, user_id FROM comments WHERE id = ?')
      .get(id) as { id: string; visitor_id: string; user_id: string | null } | undefined;

    if (!existing) {
      res.status(404).json({ error: 'التعليق غير موجود.' });
      return;
    }

    const ownsByUser = Boolean(req.currentUser && existing.user_id && existing.user_id === req.currentUser.id);
    const ownsByVisitor = existing.visitor_id === req.visitorId;
    if (!ownsByUser && !ownsByVisitor) {
      res.status(403).json({ error: 'مش مسموحلك تحذف تعليق غيرك.' });
      return;
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    checkpointDatabase(db);
    res.json({ ok: true });
  });

  app.post('/api/comments/:id/report', (req: RequestWithContext, res: Response) => {
    if (!reportLimiter(`rep:${req.ipHash}:${req.visitorId}`)) {
      res.status(429).json({ error: 'تم إرسال بلاغات كثيرة. حاول لاحقاً.' });
      return;
    }

    const id = req.params.id;
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 120)
        : 'محتوى غير مناسب';

    const comment = db
      .prepare('SELECT id, visitor_id, reports_count FROM comments WHERE id = ?')
      .get(id) as { id: string; visitor_id: string; reports_count: number } | undefined;

    if (!comment) {
      res.status(404).json({ error: 'التعليق غير موجود.' });
      return;
    }

    try {
      const flagged = withTransaction(db, () => {
        db.prepare(
          'INSERT INTO comment_reports (id, comment_id, visitor_id, reason, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(generateId('rep'), id, req.visitorId!, reason, new Date().toISOString());

        const newCount = comment.reports_count + 1;
        const nextStatus = newCount >= 3 ? 'flagged' : 'approved';
        db.prepare('UPDATE comments SET reports_count = ?, status = ? WHERE id = ?').run(
          newCount,
          nextStatus,
          id
        );
        return nextStatus === 'flagged';
      });

      res.json({
        ok: true,
        flaggedForReview: flagged,
        message: 'تم استلام بلاغك وهيتم مراجعته من الإدارة.',
      });
    } catch {
      res.status(409).json({ error: 'أنت بلغت عن التعليق ده قبل كده بالفعل.' });
    }
  });

  // 5. Shared Permanent Likes API
  app.get('/api/likes', (req: RequestWithContext, res: Response) => {
    const itemKey = typeof req.query.itemKey === 'string' && req.query.itemKey.trim()
      ? req.query.itemKey.trim().slice(0, 64)
      : 'tool';

    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM likes WHERE item_key = ?')
      .get(itemKey) as { cnt: number };

    const likedRow = req.currentUser
      ? db
          .prepare('SELECT 1 FROM likes WHERE item_key = ? AND (user_id = ? OR visitor_id = ?) LIMIT 1')
          .get(itemKey, req.currentUser.id, req.visitorId!)
      : db
          .prepare('SELECT 1 FROM likes WHERE item_key = ? AND visitor_id = ? LIMIT 1')
          .get(itemKey, req.visitorId!);

    res.json({
      itemKey,
      count: Number(countRow?.cnt || 0),
      liked: Boolean(likedRow),
    });
  });

  app.post('/api/likes/toggle', (req: RequestWithContext, res: Response) => {
    if (!likeLimiter(`like:${req.ipHash}:${req.visitorId}`)) {
      res.status(429).json({ error: 'ضغطت بسرعة زيادة، جرب تاني بعد ثانية.' });
      return;
    }

    const rawKey = typeof req.body?.itemKey === 'string' ? req.body.itemKey.trim().slice(0, 64) : 'tool';
    const isToolKey = rawKey === 'tool';
    const commentMatch = rawKey.match(/^comment:([a-zA-Z0-9_-]{4,60})$/);
    if (!isToolKey && !commentMatch) {
      res.status(400).json({ error: 'معرّف الإعجاب غير صالح.' });
      return;
    }

    const itemKey = rawKey;
    const desiredLiked =
      typeof req.body?.desiredLiked === 'boolean' ? req.body.desiredLiked : null;
    const actorVisitorKey = req.currentUser ? `u_${req.currentUser.id}` : req.visitorId!;

    try {
      const result = withTransaction(db, () => {
        if (commentMatch) {
          const commentRow = db
            .prepare("SELECT id FROM comments WHERE id = ? AND status = 'approved'")
            .get(commentMatch[1]);
          if (!commentRow) {
            throw new Error('COMMENT_NOT_FOUND');
          }
        }

        const existing = req.currentUser
          ? db
              .prepare('SELECT 1 FROM likes WHERE item_key = ? AND (user_id = ? OR visitor_id = ?)')
              .get(itemKey, req.currentUser.id, req.visitorId!)
          : db
              .prepare('SELECT 1 FROM likes WHERE item_key = ? AND visitor_id = ?')
              .get(itemKey, req.visitorId!);

        const shouldLike = desiredLiked !== null ? desiredLiked : !existing;
        let liked: boolean;

        if (shouldLike) {
          if (!existing) {
            db.prepare(
              'INSERT OR IGNORE INTO likes (item_key, visitor_id, user_id, created_at) VALUES (?, ?, ?, ?)'
            ).run(itemKey, actorVisitorKey, req.currentUser?.id || null, new Date().toISOString());
          }
          liked = true;
        } else {
          if (req.currentUser) {
            db.prepare('DELETE FROM likes WHERE item_key = ? AND (user_id = ? OR visitor_id = ?)').run(
              itemKey,
              req.currentUser.id,
              req.visitorId!
            );
          } else {
            db.prepare('DELETE FROM likes WHERE item_key = ? AND visitor_id = ?').run(
              itemKey,
              req.visitorId!
            );
          }
          liked = false;
        }

        const countRow = db
          .prepare('SELECT COUNT(*) as cnt FROM likes WHERE item_key = ?')
          .get(itemKey) as { cnt: number };

        return { count: Number(countRow?.cnt || 0), liked };
      });

      checkpointDatabase(db);
      res.json({
        itemKey,
        ...result,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'COMMENT_NOT_FOUND') {
        res.status(404).json({ error: 'التعليق غير موجود.' });
        return;
      }
      res.status(500).json({ error: 'حصل خطأ أثناء تحديث الإعجاب.' });
    }
  });

  // 6. Strict Account-Enforced Poll API (1 Vote per Account per Poll)
  function getPollSummary(userId?: string | null, pollIdArg?: string) {
    const config = getSiteConfig(db);
    const poll = (
      pollIdArg
        ? db.prepare('SELECT id, slug, question, is_open, starts_at, ends_at FROM polls WHERE id = ?').get(pollIdArg)
        : db.prepare('SELECT id, slug, question, is_open, starts_at, ends_at FROM polls ORDER BY created_at DESC LIMIT 1').get()
    ) as
      | {
          id: string;
          slug: string;
          question: string;
          is_open: number;
          starts_at: string | null;
          ends_at: string | null;
        }
      | undefined;

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

    const opts = db
      .prepare(
        `SELECT o.option_key as key, o.label, COUNT(v.id) as votes
         FROM poll_options o
         LEFT JOIN user_poll_votes v ON v.poll_id = o.poll_id AND v.option_key = o.option_key
         WHERE o.poll_id = ?
         GROUP BY o.id
         ORDER BY o.sort_order ASC`
      )
      .all(poll.id) as Array<{ key: string; label: string; votes: number }>;

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
      poll.is_open === 0 || (poll.id === 'poll_extend_offer' && config.pollClosed) || expiredBySchedule;

    let userChoice: string | null = null;
    if (userId) {
      const myVote = db
        .prepare('SELECT option_key FROM user_poll_votes WHERE poll_id = ? AND user_id = ?')
        .get(poll.id, userId) as { option_key: string } | undefined;
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

  app.get('/api/poll', (req: RequestWithContext, res: Response) => {
    const pollId = typeof req.query.pollId === 'string' ? req.query.pollId : undefined;
    res.json(getPollSummary(req.currentUser?.id || null, pollId));
  });

  app.post('/api/poll/vote', (req: RequestWithContext, res: Response) => {
    if (!pollLimiter(`poll:${req.ipHash}:${req.visitorId}`)) {
      res.status(429).json({ error: 'محاولات تصويت كثيرة. حاول لاحقاً.' });
      return;
    }

    if (!req.currentUser) {
      res.status(401).json({
        error: 'لازم تسجل دخول بحسابك الأول عشان تقدر تصوّت (صوت واحد لكل حساب).',
        requiresAuth: true,
      });
      return;
    }

    const pollId =
      typeof req.body?.pollId === 'string' && req.body.pollId.trim()
        ? req.body.pollId.trim()
        : (db.prepare('SELECT id FROM polls ORDER BY created_at DESC LIMIT 1').get() as { id: string } | undefined)?.id ||
          'poll_extend_offer';

    const choice = typeof req.body?.choice === 'string' ? req.body.choice.trim() : '';

    try {
      withTransaction(db, () => {
        const poll = db
          .prepare('SELECT id, is_open, starts_at, ends_at FROM polls WHERE id = ?')
          .get(pollId) as
          | { id: string; is_open: number; starts_at: string | null; ends_at: string | null }
          | undefined;

        if (!poll) throw new Error('POLL_NOT_FOUND');

        const config = getSiteConfig(db);
        const nowMs = Date.now();
        if (
          poll.is_open === 0 ||
          (poll.id === 'poll_extend_offer' && config.pollClosed) ||
          (poll.starts_at && Date.parse(poll.starts_at) > nowMs) ||
          (poll.ends_at && Date.parse(poll.ends_at) <= nowMs)
        ) {
          throw new Error('POLL_CLOSED');
        }

        const opt = db
          .prepare('SELECT 1 FROM poll_options WHERE poll_id = ? AND option_key = ?')
          .get(poll.id, choice);
        if (!opt) throw new Error('INVALID_CHOICE');

        const existingVote = db
          .prepare('SELECT option_key FROM user_poll_votes WHERE poll_id = ? AND user_id = ?')
          .get(poll.id, req.currentUser!.id) as { option_key: string } | undefined;
        if (existingVote) {
          throw new Error('DUP_VOTE');
        }

        db.prepare(
          `INSERT INTO user_poll_votes (id, poll_id, option_key, user_id, visitor_id, ip_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          generateId('pv'),
          poll.id,
          choice,
          req.currentUser!.id,
          req.visitorId!,
          req.ipHash!,
          new Date().toISOString()
        );
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'POLL_NOT_FOUND') {
        res.status(404).json({ error: 'الاستفتاء غير موجود.' });
        return;
      }
      if (code === 'POLL_CLOSED') {
        res.status(403).json({ error: 'التصويت مغلق حالياً.' });
        return;
      }
      if (code === 'INVALID_CHOICE') {
        res.status(400).json({ error: 'اختيار التصويت غير صحيح.' });
        return;
      }
      if (code === 'DUP_VOTE' || code.includes('UNIQUE')) {
        res.status(409).json({ error: 'سبق لك التصويت في هذا الاستفتاء. مسموح بصوت واحد فقط لكل حساب.' });
        return;
      }
      res.status(500).json({ error: 'تعذر تسجيل صوتك.' });
      return;
    }

    checkpointDatabase(db);
    res.status(201).json(getPollSummary(req.currentUser.id, pollId));
  });

  // 7. Subscription Orders API
  app.post('/api/orders', (req: RequestWithContext, res: Response) => {
    if (!orderLimiter(`ord:${req.ipHash}:${req.visitorId}`)) {
      res.status(429).json({ error: 'أرسلت طلبات كتير في وقت قصير، استنى شوية وجرب تاني.' });
      return;
    }

    const config = getSiteConfig(db);
    if (!config.ordersEnabled) {
      res.status(403).json({ error: 'استقبال طلبات الاشتراك متوقف مؤقتاً من الإدارة. حاول تاني بعد شوية.' });
      return;
    }

    try {
      const input = validateOrderPayload(req.body || {});

      if (input.clientRequestId) {
        const existing = db
          .prepare(
            `SELECT id, order_code, full_name, grade, platform_label, section_details, old_price, final_price, offer_applied, payment_method, status, created_at
             FROM orders WHERE client_request_id = ?`
          )
          .get(input.clientRequestId) as Record<string, unknown> | undefined;

        if (existing) {
          res.status(200).json({
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
              offerApplied: existing.offer_applied === 1,
              paymentMethod: existing.payment_method,
              status: existing.status,
              createdAt: existing.created_at,
            },
          });
          return;
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
      while (db.prepare('SELECT 1 FROM orders WHERE order_code = ?').get(orderCode)) {
        orderCode = formatOrderCode();
      }

      const encrypted = encryptSecret(input.platformPassword, encryptionKey);
      const nowIso = new Date().toISOString();

      db.prepare(
        `INSERT INTO orders (
          id, order_code, client_request_id, visitor_id, user_id, full_name, grade,
          platforms_json, platform_label, section_details, platform_username,
          encrypted_password, password_iv, password_auth_tag, credentials_purged,
          old_price, final_price, offer_applied, payment_method, status,
          whatsapp_status, whatsapp_error, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'new', 'click_to_chat', NULL, ?)`
      ).run(
        id,
        orderCode,
        input.clientRequestId || null,
        req.visitorId!,
        req.currentUser?.id || null,
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
      );

      checkpointDatabase(db);

      res.status(201).json({
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
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر إرسال الطلب.' });
    }
  });

  // 8. Admin Authentication & Protected Dashboard Endpoints
  app.post('/api/admin/login', (req: RequestWithContext, res: Response) => {
    if (!loginLimiter(`adm:${req.ipHash}`)) {
      res.status(429).json({ error: 'محاولات دخول كثيرة غلط. استنى 15 دقيقة وحاول تاني.' });
      return;
    }

    const user = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const pass = typeof req.body?.password === 'string' ? req.body.password : '';

    // Allow either env ADMIN_USERNAME/ADMIN_PASSWORD OR a DB user with role='admin' & active status
    let verifiedAdminName: string | null = null;

    if (
      adminUsername &&
      adminPassword &&
      safeCompareStrings(user, adminUsername) &&
      safeCompareStrings(pass, adminPassword)
    ) {
      verifiedAdminName = adminUsername;
    } else if (user.includes('@')) {
      const adminUserRow = db
        .prepare("SELECT email, password_hash, role, status FROM users WHERE email = ? AND role = 'admin'")
        .get(user.toLowerCase()) as
        | { email: string; password_hash: string; role: string; status: string }
        | undefined;
      if (adminUserRow && adminUserRow.status === 'active' && verifyPassword(pass, adminUserRow.password_hash)) {
        const tokenRaw = createUserSession(req, res, (db.prepare('SELECT id FROM users WHERE email = ?').get(adminUserRow.email) as { id: string }).id);
        logAdminAudit(db, {
          actorUsername: adminUserRow.email,
          action: 'admin_login',
          targetType: 'session',
          ipHash: req.ipHash,
        });
        res.json({ ok: true, username: adminUserRow.email, token: tokenRaw });
        return;
      }
    }

    if (!verifiedAdminName) {
      if (!adminUsername || !adminPassword) {
        res.status(503).json({
          error: 'بيانات دخول الإدارة غير مضبوطة في متغيرات البيئة (ADMIN_USERNAME / ADMIN_PASSWORD).',
        });
        return;
      }
      res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غلط.' });
      return;
    }

    const token = signToken(
      {
        role: 'admin',
        username: verifiedAdminName,
        exp: Date.now() + 12 * 60 * 60 * 1000,
      },
      sessionSecret
    );

    res.cookie('crovo_admin', token, buildCookieOptions(req, 12 * 60 * 60 * 1000));
    logAdminAudit(db, {
      actorUsername: verifiedAdminName,
      action: 'admin_login',
      targetType: 'session',
      ipHash: req.ipHash,
    });

    res.json({ ok: true, username: verifiedAdminName, adminToken: token });
  });

  app.post('/api/admin/logout', (req: Request, res: Response) => {
    res.clearCookie('crovo_admin', buildCookieOptions(req, 0));
    res.json({ ok: true });
  });

  app.get('/api/admin/me', (req: RequestWithContext, res: Response) => {
    const session = getAdminSession(req);
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, username: session.username });
  });

  app.get('/api/admin/overview', requireAdmin, (_req: Request, res: Response) => {
    purgeExpiredOrderCredentials(db);

    const orderRows = db
      .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200')
      .all() as Array<Record<string, unknown>>;

    const orders = orderRows.map((o) => {
      let platformPassword: string | null = null;
      if (
        o.credentials_purged === 0 &&
        typeof o.encrypted_password === 'string' &&
        typeof o.password_iv === 'string' &&
        typeof o.password_auth_tag === 'string'
      ) {
        try {
          platformPassword = decryptSecret(
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
        credentialsPurged: o.credentials_purged === 1,
        oldPrice: o.old_price,
        finalPrice: o.final_price,
        offerApplied: o.offer_applied === 1,
        paymentMethod: o.payment_method,
        status: o.status,
        createdAt: o.created_at,
        updatedAt: o.updated_at || null,
      };
    });

    const commentRows = db
      .prepare('SELECT * FROM comments ORDER BY created_at DESC LIMIT 200')
      .all() as Array<Record<string, unknown>>;

    const reportRows = db
      .prepare('SELECT comment_id, reason, created_at FROM comment_reports ORDER BY created_at DESC')
      .all() as Array<{ comment_id: string; reason: string; created_at: string }>;

    const reportsByComment = new Map<string, Array<{ reason: string; createdAt: string }>>();
    for (const r of reportRows) {
      const list = reportsByComment.get(r.comment_id) || [];
      list.push({ reason: r.reason, createdAt: r.created_at });
      reportsByComment.set(r.comment_id, list);
    }

    const likeCountsRows = db
      .prepare(`SELECT item_key, COUNT(*) as cnt FROM likes WHERE item_key LIKE 'comment:%' GROUP BY item_key`)
      .all() as Array<{ item_key: string; cnt: number }>;
    const commentLikesMap = new Map<string, number>();
    for (const lr of likeCountsRows) {
      commentLikesMap.set(lr.item_key, Number(lr.cnt || 0));
    }

    const comments = commentRows.map((c) => ({
      id: c.id,
      authorName: c.author_name,
      grade: c.grade,
      rating: c.rating,
      content: c.content,
      avatarUrl: c.avatar_url || null,
      attachmentUrl: c.attachment_url || null,
      contactPhone: c.contact_phone || null,
      showContactPublicly: c.show_contact_publicly === 1,
      isVerified: c.is_verified === 1,
      status: c.status,
      likesCount: commentLikesMap.get(`comment:${String(c.id)}`) || 0,
      reportsCount: c.reports_count,
      reports: reportsByComment.get(String(c.id)) || [],
      createdAt: c.created_at,
    }));

    const questionReportRows = db
      .prepare('SELECT * FROM question_reports ORDER BY created_at DESC LIMIT 200')
      .all() as Array<Record<string, unknown>>;

    const questionReports = questionReportRows.map((qr) => ({
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

    const likesByItem = db
      .prepare('SELECT item_key as itemKey, COUNT(*) as count FROM likes GROUP BY item_key')
      .all() as Array<{ itemKey: string; count: number }>;

    const totalCopiesRow = db
      .prepare('SELECT COALESCE(SUM(copy_count), 0) as totalCopies FROM question_stats')
      .get() as { totalCopies: number };

    const topQuestions = db
      .prepare(
        `SELECT question_key as questionKey, grade, section, chapter_num as chapterNum,
                q_index as qIndex, question_title as questionTitle, copy_count as copyCount, last_copied_at as lastCopiedAt
         FROM question_stats
         WHERE copy_count > 0
         ORDER BY copy_count DESC, last_copied_at DESC
         LIMIT 15`
      )
      .all() as Array<Record<string, unknown>>;

    const pushActiveRow = db
      .prepare('SELECT COUNT(*) as cnt FROM push_subscriptions WHERE enabled = 1')
      .get() as { cnt: number };

    const pushTotalRow = db
      .prepare('SELECT COUNT(*) as cnt FROM push_subscriptions')
      .get() as { cnt: number };

    const notificationLogs = db
      .prepare(
        `SELECT id, message_id as messageId, category, title, body, sent_count as sentCount,
                failed_count as failedCount, trigger_type as triggerType, error_detail as errorDetail, created_at as createdAt
         FROM notification_logs
         ORDER BY created_at DESC
         LIMIT 35`
      )
      .all() as Array<Record<string, unknown>>;

    const config = getSiteConfig(db);
    const analytics = getDashboardAnalytics(db, { range: '7d' });

    res.json({
      orders,
      comments,
      questionReports,
      poll: getPollSummary(null),
      likes: likesByItem,
      config,
      analytics,
      stats: {
        totalCopies: Number(totalCopiesRow?.totalCopies || 0),
        topQuestions,
        pendingQuestionReports: questionReports.filter((r) => r.status === 'pending').length,
        pushActiveCount: Number(pushActiveRow?.cnt || 0),
        pushTotalCount: Number(pushTotalRow?.cnt || 0),
        dbIntegrity: checkDatabaseIntegrity(db),
        backups: dbPath === ':memory:' ? [] : listDatabaseBackups(backupsDir),
        isEphemeralStorageNotice:
          'تعمل قاعدة SQLite الحالية على نظام ملفات الحاوية المحلي؛ البيانات تظل محفوظة مع تفعيل WAL checkpoint التلقائي عند الكتابة والإغلاق.',
      },
      notifications: {
        enabled: config.notificationsEnabled,
        intervalDays: config.notificationsIntervalDays,
        templates: NOTIFICATION_TEMPLATES,
        logs: notificationLogs,
      },
    });
  });

  app.patch('/api/admin/orders/:id', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const id = req.params.id;
    const existing = db.prepare('SELECT id, status, order_code FROM orders WHERE id = ?').get(id) as
      | { id: string; status: string; order_code: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'الطلب غير موجود.' });
      return;
    }

    const status = req.body?.status;
    const allowedStatuses = ['new', 'reviewing', 'completed', 'cancelled'];
    const nextStatus = allowedStatuses.includes(status) ? status : existing.status;
    const purgeCredentials =
      req.body?.purgeCredentials === true || nextStatus === 'completed' || nextStatus === 'cancelled';
    const nowIso = new Date().toISOString();

    withTransaction(db, () => {
      if (purgeCredentials) {
        db.prepare(
          `UPDATE orders
           SET status = ?,
               encrypted_password = NULL,
               password_iv = NULL,
               password_auth_tag = NULL,
               credentials_purged = 1,
               updated_at = ?
           WHERE id = ?`
        ).run(nextStatus, nowIso, id);
      } else {
        db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(
          nextStatus,
          nowIso,
          id
        );
      }

      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'order_update',
        targetType: 'order',
        targetId: id,
        details: { orderCode: existing.order_code, nextStatus, purgeCredentials },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true, status: nextStatus, credentialsPurged: purgeCredentials });
  });

  app.patch('/api/admin/comments/:id', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const id = req.params.id;
    const existing = db.prepare('SELECT id, is_verified, status FROM comments WHERE id = ?').get(id) as
      | { id: string; is_verified: number; status: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'التعليق غير موجود.' });
      return;
    }

    const isVerified =
      typeof req.body?.isVerified === 'boolean' ? (req.body.isVerified ? 1 : 0) : existing.is_verified;
    const allowedStatuses = ['approved', 'hidden', 'flagged'];
    const status = allowedStatuses.includes(req.body?.status) ? req.body.status : existing.status;

    withTransaction(db, () => {
      if (req.body?.clearReports === true) {
        db.prepare('DELETE FROM comment_reports WHERE comment_id = ?').run(id);
        db.prepare('UPDATE comments SET reports_count = 0 WHERE id = ?').run(id);
      }

      db.prepare('UPDATE comments SET is_verified = ?, status = ?, updated_at = ? WHERE id = ?').run(
        isVerified,
        status,
        new Date().toISOString(),
        id
      );

      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'comment_moderation',
        targetType: 'comment',
        targetId: id,
        details: { isVerified: isVerified === 1, status, clearReports: req.body?.clearReports === true },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true });
  });

  app.delete('/api/admin/comments/:id', requireAdmin, (req: AdminRequestContext, res: Response) => {
    withTransaction(db, () => {
      db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'comment_delete',
        targetType: 'comment',
        targetId: req.params.id,
        ipHash: req.ipHash,
      });
    });
    checkpointDatabase(db);
    res.json({ ok: true });
  });

  app.patch('/api/admin/question-reports/:id', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const id = req.params.id;
    const existing = db
      .prepare('SELECT id, status, admin_note FROM question_reports WHERE id = ?')
      .get(id) as { id: string; status: string; admin_note: string | null } | undefined;

    if (!existing) {
      res.status(404).json({ error: 'البلاغ غير موجود.' });
      return;
    }

    const allowed = ['pending', 'reviewed', 'resolved', 'dismissed'];
    const status = allowed.includes(req.body?.status) ? req.body.status : existing.status;
    const adminNote =
      typeof req.body?.adminNote === 'string' ? req.body.adminNote.trim().slice(0, 300) : existing.admin_note;

    withTransaction(db, () => {
      db.prepare('UPDATE question_reports SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?').run(
        status,
        adminNote,
        new Date().toISOString(),
        id
      );
      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'question_report_update',
        targetType: 'question_report',
        targetId: id,
        details: { status },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true, status });
  });

  app.post('/api/admin/push/send', requireAdmin, async (req: AdminRequestContext, res: Response) => {
    const modeRaw = req.body?.mode;
    const mode =
      modeRaw === 'broadcast_custom' || modeRaw === 'broadcast_next' ? modeRaw : 'due';

    if (mode === 'broadcast_custom') {
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (title.length < 3 || body.length < 5) {
        res.status(400).json({ error: 'اكتب عنوانًا ونصًا واضحين للإشعار.' });
        return;
      }
      const result = await dispatchDueNotifications(db, {
        mode: 'broadcast_custom',
        triggerType: 'manual',
        customTitle: title,
        customBody: body,
        customCategory: req.body?.category === 'service' || req.body?.category === 'update' ? req.body.category : 'offer',
      });
      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'push_broadcast_custom',
        targetType: 'push',
        details: { title, sentCount: result.sentCount },
        ipHash: req.ipHash,
      });
      res.json({ ok: true, result });
      return;
    }

    const result = await dispatchDueNotifications(db, {
      mode,
      triggerType: 'manual',
    });
    logAdminAudit(db, {
      actorUsername: req.adminUsername || 'admin',
      action: `push_${mode}`,
      targetType: 'push',
      details: { sentCount: result.sentCount },
      ipHash: req.ipHash,
    });
    res.json({ ok: true, result });
  });

  app.post('/api/admin/backup', requireAdmin, (req: AdminRequestContext, res: Response) => {
    if (dbPath === ':memory:') {
      res.status(400).json({ error: 'النسخ الاحتياطي غير متاح لقاعدة الذاكرة.' });
      return;
    }
    const backup = createDatabaseBackup(db, backupsDir);
    logAdminAudit(db, {
      actorUsername: req.adminUsername || 'admin',
      action: 'database_backup',
      targetType: 'database',
      targetId: backup.filename,
      ipHash: req.ipHash,
    });
    res.status(201).json({ ok: true, backup, backups: listDatabaseBackups(backupsDir) });
  });

  app.post('/api/admin/poll/reset', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const pollId = typeof req.body?.pollId === 'string' ? req.body.pollId : 'poll_extend_offer';
    withTransaction(db, () => {
      db.prepare('DELETE FROM user_poll_votes WHERE poll_id = ?').run(pollId);
      db.prepare('DELETE FROM poll_votes').run();
      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'poll_reset',
        targetType: 'poll',
        targetId: pollId,
        ipHash: req.ipHash,
      });
    });
    checkpointDatabase(db);
    res.json({ ok: true, poll: getPollSummary(null, pollId) });
  });

  app.put('/api/admin/settings', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const b = req.body || {};
    const updateNum = (field: unknown, key: string) => {
      if (field === undefined) return;
      const num = Number(field);
      if (Number.isFinite(num) && num >= 0 && num <= 10000) {
        setSetting(db, key, String(Math.round(num)));
      }
    };

    withTransaction(db, () => {
      updateNum(b.qureoOfferPrice, 'qureo_offer_price');
      updateNum(b.qureoOldPrice, 'qureo_old_price');
      updateNum(b.finOfferPrice, 'fin_offer_price');
      updateNum(b.finOldPrice, 'fin_old_price');
      updateNum(b.bundleOfferPrice, 'bundle_offer_price');
      updateNum(b.bundleOldPrice, 'bundle_old_price');

      if (typeof b.offerEndsAt === 'string' && Number.isFinite(Date.parse(b.offerEndsAt))) {
        setSetting(db, 'offer_ends_at', new Date(b.offerEndsAt).toISOString());
      }
      if (b.afterOfferMode === 'regular_price' || b.afterOfferMode === 'extended_offer') {
        setSetting(db, 'after_offer_mode', b.afterOfferMode);
      }
      if (typeof b.ordersEnabled === 'boolean') {
        setSetting(db, 'orders_enabled', String(b.ordersEnabled));
      }
      if (typeof b.pollClosed === 'boolean') {
        setSetting(db, 'poll_closed', String(b.pollClosed));
        db.prepare('UPDATE polls SET is_open = ?, updated_at = ? WHERE id = ?').run(
          b.pollClosed ? 0 : 1,
          new Date().toISOString(),
          'poll_extend_offer'
        );
      }
      if (typeof b.notificationsEnabled === 'boolean') {
        setSetting(db, 'notifications_enabled', String(b.notificationsEnabled));
      }
      if (b.notificationsIntervalDays !== undefined) {
        const days = Math.max(1, Math.min(30, Math.round(Number(b.notificationsIntervalDays) || 3)));
        setSetting(db, 'notifications_interval_days', String(days));
      }
      if (typeof b.adminWhatsappDisplay === 'string' && b.adminWhatsappDisplay.trim()) {
        setSetting(db, 'admin_whatsapp_display', b.adminWhatsappDisplay.replace(/[^\d]/g, '').slice(0, 20));
      }
      if (b.libraryAd && typeof b.libraryAd === 'object') {
        const ad = b.libraryAd as Record<string, unknown>;
        if (typeof ad.enabled === 'boolean') setSetting(db, 'library_ad_enabled', String(ad.enabled));
        if (typeof ad.title === 'string' && ad.title.trim()) setSetting(db, 'library_ad_title', ad.title.trim().slice(0, 140));
        if (typeof ad.subtitle === 'string' && ad.subtitle.trim()) setSetting(db, 'library_ad_subtitle', ad.subtitle.trim().slice(0, 240));
        if (typeof ad.priceText === 'string' && ad.priceText.trim()) setSetting(db, 'library_ad_price_text', ad.priceText.trim().slice(0, 140));
        if (typeof ad.ctaText === 'string' && ad.ctaText.trim()) setSetting(db, 'library_ad_cta', ad.ctaText.trim().slice(0, 60));
        if (typeof ad.ctaLink === 'string' && ad.ctaLink.trim()) setSetting(db, 'library_ad_cta_link', ad.ctaLink.trim().slice(0, 200));
        if (typeof ad.imageUrl === 'string' && ad.imageUrl.trim()) setSetting(db, 'library_ad_image_url', ad.imageUrl.trim().slice(0, 260));
        if (ad.delaySeconds !== undefined) {
          const delay = Math.max(5, Math.min(600, Math.round(Number(ad.delaySeconds) || 60)));
          setSetting(db, 'library_ad_delay_seconds', String(delay));
        }
        if (ad.cooldownHours !== undefined) {
          const cd = Math.max(1, Math.min(720, Math.round(Number(ad.cooldownHours) || 24)));
          setSetting(db, 'library_ad_cooldown_hours', String(cd));
        }
        if (ad.templateMode === 'classic' || ad.templateMode === 'rich_crovo') {
          setSetting(db, 'library_ad_template_mode', ad.templateMode);
        }
      }
      if (b.heroPromo && typeof b.heroPromo === 'object') {
        const hp = b.heroPromo as Record<string, unknown>;
        if (typeof hp.enabled === 'boolean') setSetting(db, 'hero_promo_enabled', String(hp.enabled));
        if (typeof hp.title === 'string' && hp.title.trim()) setSetting(db, 'hero_promo_title', hp.title.trim().slice(0, 140));
        if (typeof hp.subtitle === 'string' && hp.subtitle.trim()) setSetting(db, 'hero_promo_subtitle', hp.subtitle.trim().slice(0, 260));
      }
      if (b.promoBanner && typeof b.promoBanner === 'object') {
        const pb = b.promoBanner as Record<string, unknown>;
        if (typeof pb.enabled === 'boolean') setSetting(db, 'promo_banner_enabled', String(pb.enabled));
        if (typeof pb.text === 'string' && pb.text.trim()) setSetting(db, 'promo_banner_text', pb.text.trim().slice(0, 200));
      }

      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'settings_update',
        targetType: 'settings',
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true, config: getSiteConfig(db) });
  });

  // Register Extended Admin RBAC Routes
  registerExtendedAdminRoutes(app, { db, requireAdmin, saveUploadedImage });

  // Frontend middleware (Vite in dev, dist/ in prod)
  if (!options.skipVite) {
    if (process.env.NODE_ENV !== 'production') {
      const vite = await import('vite');
      const viteServer = await vite.createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(viteServer.middlewares);
    } else {
      const distDir = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distDir, { index: false }));
      app.get('*', (req: Request, res: Response) => {
        if (req.path.endsWith('.html') && req.path !== '/index.html') {
          const candidateDist = path.join(distDir, path.basename(req.path));
          if (fs.existsSync(candidateDist)) {
            res.sendFile(candidateDist);
            return;
          }
        }
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  return { app, db };
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectExecution) {
  const port = Number(process.env.PORT || 3000);
  createCrovoApp()
    .then(({ app, db }) => {
      const pushInterval = setInterval(() => {
        dispatchDueNotifications(db, { mode: 'due', triggerType: 'scheduled_3d' }).catch((err) => {
          console.error('Periodic push dispatch error:', err);
        });
      }, 60 * 60 * 1000);
      pushInterval.unref();

      const server = app.listen(port, '0.0.0.0', () => {
        console.log(`CROVO SPACE server running on http://0.0.0.0:${port}`);
      });

      const shutdown = () => {
        try {
          checkpointDatabase(db, true);
          db.close();
        } catch {
          // Ignore close errors
        }
        server.close(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
