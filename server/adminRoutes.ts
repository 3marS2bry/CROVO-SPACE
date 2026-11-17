import type { Express, NextFunction, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { generateId } from './crypto.ts';
import { getSiteConfig, setSetting, withTransaction, checkpointDatabase } from './db.ts';
import { getDashboardAnalytics } from './analytics.ts';
import { validateBase64Image } from './domain.ts';

export interface AdminRequestContext extends Request {
  adminUsername?: string;
  ipHash?: string;
}

export function logAdminAudit(
  db: DatabaseSync,
  params: {
    actorUsername: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    details?: Record<string, unknown> | null;
    ipHash?: string | null;
  }
): void {
  try {
    db.prepare(
      `INSERT INTO audit_logs (id, actor_username, action, target_type, target_id, details_json, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateId('aud'),
      params.actorUsername,
      params.action,
      params.targetType,
      params.targetId || null,
      params.details ? JSON.stringify(params.details).slice(0, 1000) : null,
      params.ipHash || null,
      new Date().toISOString()
    );
  } catch {
    // Audit logging is best-effort but schema should always accept it
  }
}

export function registerExtendedAdminRoutes(
  app: Express,
  deps: {
    db: DatabaseSync;
    requireAdmin: (req: AdminRequestContext, res: Response, next: NextFunction) => void;
    saveUploadedImage: (data: { ext: string; mimeType: string; buffer: Buffer } | null) => string | null;
  }
): void {
  const { db, requireAdmin, saveUploadedImage } = deps;

  // 1. Real Analytics Overview (period filter + previous comparison)
  app.get('/api/admin/analytics', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const range = typeof req.query.range === 'string' ? req.query.range : '7d';
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const data = getDashboardAnalytics(db, { range, from, to });
    res.json(data);
  });

  // 2. Registered Users Management
  app.get('/api/admin/users', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const role = typeof req.query.role === 'string' ? req.query.role : 'all';
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';

    const rows = db
      .prepare(
        `SELECT u.id, u.serial_number as serialNumber, u.name, u.email, u.grade, u.role, u.status, u.suspend_reason as suspendReason,
                u.last_active_at as lastActiveAt, u.created_at as createdAt,
                (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) as reviewsCount,
                (SELECT COUNT(*) FROM user_poll_votes pv WHERE pv.user_id = u.id) as votesCount,
                (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'completed') as completedOrdersCount
         FROM users u
         ORDER BY u.created_at DESC
         LIMIT 500`
      )
      .all() as Array<Record<string, unknown>>;

    const filtered = rows.filter((u) => {
      if (role !== 'all' && u.role !== role) return false;
      if (status !== 'all' && u.status !== status) return false;
      if (q) {
        const hay = `${String(u.serialNumber || '')} ${String(u.name)} ${String(u.email)} ${String(u.grade)} ${String(u.id)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    res.json({ users: filtered });
  });

  app.patch('/api/admin/users/:id', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const id = req.params.id;
    const target = db
      .prepare('SELECT id, name, email, role, status, grade, suspend_reason FROM users WHERE id = ?')
      .get(id) as
      | {
          id: string;
          name: string;
          email: string;
          role: 'user' | 'admin';
          status: 'active' | 'suspended';
          grade: string;
          suspend_reason: string | null;
        }
      | undefined;

    if (!target) {
      res.status(404).json({ error: 'المستخدم غير موجود.' });
      return;
    }

    const nextRole =
      req.body?.role === 'admin' || req.body?.role === 'user' ? req.body.role : target.role;
    const nextStatus =
      req.body?.status === 'suspended' || req.body?.status === 'active'
        ? req.body.status
        : target.status;
    const nextGrade =
      req.body?.grade === 'bac1' || req.body?.grade === 'bac2' ? req.body.grade : target.grade;
    const suspendReason =
      nextStatus === 'suspended'
        ? typeof req.body?.suspendReason === 'string' && req.body.suspendReason.trim()
          ? req.body.suspendReason.trim().slice(0, 240)
          : target.suspend_reason || 'إيقاف إداري'
        : null;

    withTransaction(db, () => {
      db.prepare(
        `UPDATE users SET role = ?, status = ?, grade = ?, suspend_reason = ? WHERE id = ?`
      ).run(nextRole, nextStatus, nextGrade, suspendReason, id);

      if (nextStatus === 'suspended') {
        db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      }

      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: nextStatus !== target.status ? `user_${nextStatus}` : 'user_update',
        targetType: 'user',
        targetId: id,
        details: {
          email: target.email,
          prevRole: target.role,
          nextRole,
          prevStatus: target.status,
          nextStatus,
          suspendReason,
        },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true, user: { id, role: nextRole, status: nextStatus, grade: nextGrade, suspendReason } });
  });

  app.get('/api/admin/users/:id/activity', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const id = req.params.id;
    const user = db
      .prepare('SELECT id, serial_number as serialNumber, name, email, grade, role, status, suspend_reason as suspendReason, last_active_at as lastActiveAt, created_at as createdAt FROM users WHERE id = ?')
      .get(id);
    if (!user) {
      res.status(404).json({ error: 'المستخدم غير موجود.' });
      return;
    }

    const reviews = db
      .prepare('SELECT id, content, rating, status, created_at as createdAt FROM comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(id);
    const votes = db
      .prepare(
        `SELECT v.poll_id as pollId, p.question, v.option_key as optionKey, v.created_at as createdAt
         FROM user_poll_votes v
         LEFT JOIN polls p ON p.id = v.poll_id
         WHERE v.user_id = ?
         ORDER BY v.created_at DESC LIMIT 20`
      )
      .all(id);
    const orders = db
      .prepare(
        `SELECT id, order_code as orderCode, platform_label as platformLabel, final_price as finalPrice, status, created_at as createdAt
         FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
      )
      .all(id);
    const toolRuns = db
      .prepare(
        `SELECT id, service_key as serviceKey, status, duration_ms as durationMs, error_message as errorMessage, created_at as createdAt
         FROM tool_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
      )
      .all(id);
    const activities = db
      .prepare(
        `SELECT id, event_type as eventType, path, grade, section, chapter_num as chapterNum, query, results_count as resultsCount, meta_json as metaJson, created_at as createdAt
         FROM analytics_events
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 100`
      )
      .all(id);

    res.json({ user, reviews, votes, orders, toolRuns, activities });
  });

  // 3. Solutions Library CMS
  app.get('/api/admin/library', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const grade = req.query.grade === 'bac2' ? 'bac2' : req.query.grade === 'bac1' ? 'bac1' : 'all';
    const section =
      req.query.section === 'py' || req.query.section === 'fin' || req.query.section === 'js'
        ? req.query.section
        : 'all';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const onlyIncomplete = req.query.incomplete === '1';

    const chapters = db
      .prepare(
        `SELECT id, grade, section, chapter_num as chapterNum, title, sort_order as sortOrder,
                updated_at as updatedAt, updated_by as updatedBy
         FROM library_chapters
         ORDER BY grade ASC, section ASC, sort_order ASC, chapter_num ASC`
      )
      .all() as Array<{
      id: string;
      grade: string;
      section: string;
      chapterNum: number;
      title: string;
      sortOrder: number;
      updatedAt: string;
      updatedBy: string | null;
    }>;

    const questions = db
      .prepare(
        `SELECT id, chapter_id as chapterId, grade, section, chapter_num as chapterNum, q_index as qIndex,
                q_text as qText, a_text as aText, is_code as isCode, updated_at as updatedAt, updated_by as updatedBy
         FROM library_questions
         ORDER BY grade ASC, section ASC, chapter_num ASC, q_index ASC`
      )
      .all() as Array<{
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
    }>;

    const filteredQuestions = questions.filter((item) => {
      if (grade !== 'all' && item.grade !== grade) return false;
      if (section !== 'all' && item.section !== section) return false;
      const trimmedA = item.aText.trim();
      const isIncomplete = trimmedA.length < 3 || trimmedA === '/' || trimmedA === '-' || trimmedA.toLowerCase() === 'todo';
      if (onlyIncomplete && !isIncomplete) return false;
      if (q) {
        const hay = `${item.qText} ${item.aText} ${item.chapterNum}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    res.json({
      chapters: chapters.filter((c) => (grade === 'all' || c.grade === grade) && (section === 'all' || c.section === section)),
      questions: filteredQuestions.slice(0, 400).map((item) => ({
        ...item,
        isCode: item.isCode === 1,
        isIncomplete:
          item.aText.trim().length < 3 ||
          item.aText.trim() === '/' ||
          item.aText.trim() === '-' ||
          item.aText.trim().toLowerCase() === 'todo',
      })),
      totalMatching: filteredQuestions.length,
    });
  });

  app.post('/api/admin/library/questions', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const grade = req.body?.grade === 'bac2' ? 'bac2' : 'bac1';
    const section = req.body?.section === 'py' || req.body?.section === 'fin' ? req.body.section : 'js';
    const chapterNum = Math.max(1, Math.min(200, Math.round(Number(req.body?.chapterNum) || 1)));
    const qText = typeof req.body?.qText === 'string' ? req.body.qText.trim() : '';
    const aText = typeof req.body?.aText === 'string' ? req.body.aText : '';
    const isCode = req.body?.isCode === true;

    if (qText.length < 2 || aText.trim().length < 1) {
      res.status(400).json({ error: 'اكتب نص السؤال والإجابة بشكل واضح.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const actor = req.adminUsername || 'admin';
    const chapterId = `${grade}_${section}_${chapterNum}`;

    const createdId = withTransaction(db, () => {
      const existingCh = db.prepare('SELECT id FROM library_chapters WHERE id = ?').get(chapterId);
      if (!existingCh) {
        const label = section === 'js' ? `المستوى ${chapterNum}` : `الفصل ${chapterNum}`;
        db.prepare(
          `INSERT INTO library_chapters (id, grade, section, chapter_num, title, sort_order, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(chapterId, grade, section, chapterNum, label, chapterNum, nowIso, actor);
      }

      const maxRow = db
        .prepare('SELECT COALESCE(MAX(q_index), -1) as maxIdx FROM library_questions WHERE chapter_id = ?')
        .get(chapterId) as { maxIdx: number };
      const nextIndex = Number(maxRow?.maxIdx ?? -1) + 1;
      const id = generateId('lq');

      db.prepare(
        `INSERT INTO library_questions (id, chapter_id, grade, section, chapter_num, q_index, q_text, a_text, is_code, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, chapterId, grade, section, chapterNum, nextIndex, qText, aText, isCode ? 1 : 0, nowIso, actor);

      logAdminAudit(db, {
        actorUsername: actor,
        action: 'library_question_create',
        targetType: 'library_question',
        targetId: id,
        details: { grade, section, chapterNum, qText },
        ipHash: req.ipHash,
      });

      return id;
    });

    checkpointDatabase(db);
    res.status(201).json({ ok: true, id: createdId });
  });

  app.patch('/api/admin/library/questions/:id', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const id = req.params.id;
    const existing = db
      .prepare('SELECT id, q_text, a_text, is_code, q_index FROM library_questions WHERE id = ?')
      .get(id) as
      | { id: string; q_text: string; a_text: string; is_code: number; q_index: number }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'السؤال غير موجود في المكتبة.' });
      return;
    }

    const qText = typeof req.body?.qText === 'string' && req.body.qText.trim() ? req.body.qText.trim() : existing.q_text;
    const aText = typeof req.body?.aText === 'string' && req.body.aText.trim() ? req.body.aText : existing.a_text;
    const isCode = typeof req.body?.isCode === 'boolean' ? (req.body.isCode ? 1 : 0) : existing.is_code;
    const qIndex = Number.isInteger(req.body?.qIndex) ? Math.max(0, Number(req.body.qIndex)) : existing.q_index;
    const nowIso = new Date().toISOString();
    const actor = req.adminUsername || 'admin';

    withTransaction(db, () => {
      db.prepare(
        `UPDATE library_questions
         SET q_text = ?, a_text = ?, is_code = ?, q_index = ?, updated_at = ?, updated_by = ?
         WHERE id = ?`
      ).run(qText, aText, isCode, qIndex, nowIso, actor, id);

      logAdminAudit(db, {
        actorUsername: actor,
        action: 'library_question_update',
        targetType: 'library_question',
        targetId: id,
        details: { qText },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true, updatedAt: nowIso });
  });

  app.delete('/api/admin/library/questions/:id', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const id = req.params.id;
    const existing = db
      .prepare('SELECT id, grade, section, chapter_num, q_text FROM library_questions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'السؤال غير موجود.' });
      return;
    }

    withTransaction(db, () => {
      db.prepare('DELETE FROM library_questions WHERE id = ?').run(id);
      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'library_question_delete',
        targetType: 'library_question',
        targetId: id,
        details: { qText: existing.q_text, chapterNum: existing.chapter_num },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true });
  });

  app.get('/api/admin/library/export', requireAdmin, (_req: AdminRequestContext, res: Response) => {
    const chapters = db
      .prepare('SELECT id, grade, section, chapter_num as chapterNum, title, sort_order as sortOrder FROM library_chapters ORDER BY grade, section, sort_order')
      .all();
    const questions = db
      .prepare('SELECT id, chapter_id as chapterId, grade, section, chapter_num as chapterNum, q_index as qIndex, q_text as qText, a_text as aText, is_code as isCode FROM library_questions ORDER BY grade, section, chapter_num, q_index')
      .all();
    res.json({ exportedAt: new Date().toISOString(), chapters, questions });
  });

  app.post('/api/admin/library/import', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const items = Array.isArray(req.body?.questions) ? req.body.questions : null;
    if (!items || items.length === 0 || items.length > 500) {
      res.status(400).json({ error: 'أرسل مصفوفة صالحة تحتوي من 1 إلى 500 سؤال.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const actor = req.adminUsername || 'admin';
    let importedCount = 0;

    withTransaction(db, () => {
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
        if (!db.prepare('SELECT id FROM library_chapters WHERE id = ?').get(chapterId)) {
          const label = section === 'js' ? `المستوى ${chapterNum}` : `الفصل ${chapterNum}`;
          db.prepare(
            `INSERT INTO library_chapters (id, grade, section, chapter_num, title, sort_order, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(chapterId, grade, section, chapterNum, label, chapterNum, nowIso, actor);
        }

        const maxRow = db
          .prepare('SELECT COALESCE(MAX(q_index), -1) as maxIdx FROM library_questions WHERE chapter_id = ?')
          .get(chapterId) as { maxIdx: number };

        db.prepare(
          `INSERT INTO library_questions (id, chapter_id, grade, section, chapter_num, q_index, q_text, a_text, is_code, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
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
        );
        importedCount += 1;
      }

      logAdminAudit(db, {
        actorUsername: actor,
        action: 'library_import',
        targetType: 'library',
        details: { importedCount },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true, importedCount });
  });

  // 4. Tool Management (services, videos, execution stats & error logs)
  app.get('/api/admin/tool', requireAdmin, (_req: AdminRequestContext, res: Response) => {
    const config = getSiteConfig(db);
    const recentRuns = db
      .prepare(
        `SELECT id, user_id as userId, service_key as serviceKey, status, duration_ms as durationMs,
                error_message as errorMessage, created_at as createdAt
         FROM tool_runs
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .all();

    const summary = db
      .prepare(
        `SELECT COUNT(*) as totalRuns,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as succeededRuns,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedRuns,
                COALESCE(AVG(NULLIF(duration_ms, 0)), 0) as avgDurationMs
         FROM tool_runs`
      )
      .get();

    res.json({
      services: config.toolServices,
      videos: config.toolVideos,
      summary,
      recentRuns,
    });
  });

  app.patch('/api/admin/tool/services/:key', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const key = req.params.key;
    const existing = db.prepare('SELECT key, name, description, is_visible FROM tool_services WHERE key = ?').get(key) as
      | { key: string; name: string; description: string; is_visible: number }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'الخدمة غير موجودة.' });
      return;
    }

    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 120) : existing.name;
    const description =
      typeof req.body?.description === 'string' && req.body.description.trim()
        ? req.body.description.trim().slice(0, 260)
        : existing.description;
    const isVisible = typeof req.body?.isVisible === 'boolean' ? (req.body.isVisible ? 1 : 0) : existing.is_visible;

    withTransaction(db, () => {
      db.prepare('UPDATE tool_services SET name = ?, description = ?, is_visible = ?, updated_at = ? WHERE key = ?').run(
        name,
        description,
        isVisible,
        new Date().toISOString(),
        key
      );
      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'tool_service_update',
        targetType: 'tool_service',
        targetId: key,
        details: { name, isVisible: isVisible === 1 },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true });
  });

  app.put('/api/admin/tool/videos', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const videos = Array.isArray(req.body?.videos) ? req.body.videos : null;
    if (!videos || videos.length === 0 || videos.length > 20) {
      res.status(400).json({ error: 'بيانات الفيديوهات غير صالحة.' });
      return;
    }

    const sanitized = videos.map((v: Record<string, unknown>, idx: number) => ({
      id: typeof v.id === 'string' && v.id.trim() ? v.id.trim() : `vid_${idx + 1}`,
      tag: typeof v.tag === 'string' ? v.tag.trim().slice(0, 60) : 'فيديو',
      title: typeof v.title === 'string' ? v.title.trim().slice(0, 140) : 'فيديو الأداة',
      description: typeof v.description === 'string' ? v.description.trim().slice(0, 320) : '',
      src: typeof v.src === 'string' ? v.src.trim().slice(0, 260) : '',
      visible: v.visible !== false,
    }));

    withTransaction(db, () => {
      setSetting(db, 'tool_videos_json', JSON.stringify(sanitized));
      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'tool_videos_update',
        targetType: 'tool_videos',
        details: { count: sanitized.length },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true, videos: sanitized });
  });

  // 5. Ad Image Upload to SQLite uploaded_media
  app.post('/api/admin/ad-image', requireAdmin, (req: AdminRequestContext, res: Response) => {
    try {
      const validated = validateBase64Image(req.body?.imageDataUrl, 1_500_000);
      if (!validated) {
        res.status(400).json({ error: 'يرجى اختيار صورة صالحة (PNG / JPG / WEBP).' });
        return;
      }
      const url = saveUploadedImage(validated);
      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'ad_image_upload',
        targetType: 'library_ad',
        details: { url },
        ipHash: req.ipHash,
      });
      res.status(201).json({ ok: true, imageUrl: url });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر رفع الصورة.' });
    }
  });

  // 6. Polls Management (CRUD + Export CSV/JSON)
  app.get('/api/admin/polls', requireAdmin, (_req: AdminRequestContext, res: Response) => {
    const polls = db
      .prepare('SELECT id, slug, question, is_open as isOpen, starts_at as startsAt, ends_at as endsAt, created_at as createdAt, updated_at as updatedAt FROM polls ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;

    const enriched = polls.map((p) => {
      const opts = db
        .prepare(
          `SELECT o.option_key as key, o.label, o.sort_order as sortOrder, COUNT(v.id) as votes
           FROM poll_options o
           LEFT JOIN user_poll_votes v ON v.poll_id = o.poll_id AND v.option_key = o.option_key
           WHERE o.poll_id = ?
           GROUP BY o.id
           ORDER BY o.sort_order ASC`
        )
        .all(String(p.id)) as Array<{ key: string; label: string; sortOrder: number; votes: number }>;

      const totalVotes = opts.reduce((s, o) => s + Number(o.votes || 0), 0);
      return {
        ...p,
        isOpen: p.isOpen === 1,
        totalVotes,
        options: opts.map((o) => ({
          ...o,
          votes: Number(o.votes || 0),
          percent: totalVotes > 0 ? Math.round((Number(o.votes || 0) / totalVotes) * 100) : 0,
        })),
      };
    });

    res.json({ polls: enriched });
  });

  app.post('/api/admin/polls', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const optionsRaw = Array.isArray(req.body?.options) ? req.body.options : [];
    const options = optionsRaw
      .map((o: unknown) => (typeof o === 'string' ? o.trim() : ''))
      .filter((o: string) => o.length >= 2)
      .slice(0, 6);

    if (question.length < 4 || options.length < 2) {
      res.status(400).json({ error: 'اكتب سؤالًا واضحًا وخيارين على الأقل.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const id = generateId('poll');
    const slug = `poll-${Date.now()}`;
    const startsAt =
      typeof req.body?.startsAt === 'string' && Number.isFinite(Date.parse(req.body.startsAt))
        ? new Date(req.body.startsAt).toISOString()
        : nowIso;
    const endsAt =
      typeof req.body?.endsAt === 'string' && Number.isFinite(Date.parse(req.body.endsAt))
        ? new Date(req.body.endsAt).toISOString()
        : null;

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO polls (id, slug, question, is_open, starts_at, ends_at, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(id, slug, question.slice(0, 200), startsAt, endsAt, nowIso, nowIso);

      options.forEach((label: string, idx: number) => {
        db.prepare(
          `INSERT INTO poll_options (id, poll_id, option_key, label, sort_order)
           VALUES (?, ?, ?, ?, ?)`
        ).run(generateId('opt'), id, `opt_${idx + 1}`, label.slice(0, 100), idx + 1);
      });

      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'poll_create',
        targetType: 'poll',
        targetId: id,
        details: { question, optionsCount: options.length },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.status(201).json({ ok: true, id });
  });

  app.patch('/api/admin/polls/:id', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const id = req.params.id;
    const existing = db.prepare('SELECT id, question, is_open, starts_at, ends_at FROM polls WHERE id = ?').get(id) as
      | { id: string; question: string; is_open: number; starts_at: string | null; ends_at: string | null }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'الاستفتاء غير موجود.' });
      return;
    }

    const question =
      typeof req.body?.question === 'string' && req.body.question.trim()
        ? req.body.question.trim().slice(0, 200)
        : existing.question;
    const isOpen = typeof req.body?.isOpen === 'boolean' ? (req.body.isOpen ? 1 : 0) : existing.is_open;
    const startsAt =
      req.body?.startsAt === null
        ? null
        : typeof req.body?.startsAt === 'string' && Number.isFinite(Date.parse(req.body.startsAt))
        ? new Date(req.body.startsAt).toISOString()
        : existing.starts_at;
    const endsAt =
      req.body?.endsAt === null
        ? null
        : typeof req.body?.endsAt === 'string' && Number.isFinite(Date.parse(req.body.endsAt))
        ? new Date(req.body.endsAt).toISOString()
        : existing.ends_at;

    withTransaction(db, () => {
      db.prepare('UPDATE polls SET question = ?, is_open = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?').run(
        question,
        isOpen,
        startsAt,
        endsAt,
        new Date().toISOString(),
        id
      );

      if (id === 'poll_extend_offer') {
        setSetting(db, 'poll_closed', String(isOpen === 0));
      }

      if (Array.isArray(req.body?.options)) {
        for (const opt of req.body.options as Array<{ key?: string; label?: string }>) {
          if (opt && typeof opt.key === 'string' && typeof opt.label === 'string' && opt.label.trim()) {
            db.prepare('UPDATE poll_options SET label = ? WHERE poll_id = ? AND option_key = ?').run(
              opt.label.trim().slice(0, 100),
              id,
              opt.key
            );
          }
        }
      }

      logAdminAudit(db, {
        actorUsername: req.adminUsername || 'admin',
        action: 'poll_update',
        targetType: 'poll',
        targetId: id,
        details: { question, isOpen: isOpen === 1 },
        ipHash: req.ipHash,
      });
    });

    checkpointDatabase(db);
    res.json({ ok: true });
  });

  app.get('/api/admin/polls/:id/export', requireAdmin, (req: AdminRequestContext, res: Response) => {
    const id = req.params.id;
    const poll = db.prepare('SELECT id, question FROM polls WHERE id = ?').get(id) as
      | { id: string; question: string }
      | undefined;
    if (!poll) {
      res.status(404).json({ error: 'الاستفتاء غير موجود.' });
      return;
    }

    const opts = db
      .prepare(
        `SELECT o.option_key as optionKey, o.label, COUNT(v.id) as votes
         FROM poll_options o
         LEFT JOIN user_poll_votes v ON v.poll_id = o.poll_id AND v.option_key = o.option_key
         WHERE o.poll_id = ?
         GROUP BY o.id
         ORDER BY o.sort_order ASC`
      )
      .all(id) as Array<{ optionKey: string; label: string; votes: number }>;

    const totalVotes = opts.reduce((s, o) => s + Number(o.votes || 0), 0);

    if (req.query.format === 'csv') {
      const header = 'option_key,label,votes,percent';
      const lines = opts.map((o) => {
        const pct = totalVotes > 0 ? Math.round((Number(o.votes || 0) / totalVotes) * 100) : 0;
        const safeLabel = `"${String(o.label).replace(/"/g, '""')}"`;
        return `${o.optionKey},${safeLabel},${o.votes},${pct}%`;
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="poll-${id}.csv"`);
      res.send('\uFEFF' + [header, ...lines].join('\n'));
      return;
    }

    res.json({
      pollId: poll.id,
      question: poll.question,
      totalVotes,
      exportedAt: new Date().toISOString(),
      results: opts.map((o) => ({
        ...o,
        percent: totalVotes > 0 ? Math.round((Number(o.votes || 0) / totalVotes) * 100) : 0,
      })),
    });
  });

  // 7. Audit Log
  app.get('/api/admin/audit-logs', requireAdmin, (_req: AdminRequestContext, res: Response) => {
    const logs = db
      .prepare(
        `SELECT id, actor_username as actorUsername, action, target_type as targetType,
                target_id as targetId, details_json as detailsJson, created_at as createdAt
         FROM audit_logs
         ORDER BY created_at DESC
         LIMIT 150`
      )
      .all();
    res.json({ logs });
  });
}
