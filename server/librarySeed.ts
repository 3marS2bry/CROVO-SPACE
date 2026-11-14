import type { DatabaseSync } from 'node:sqlite';
import {
  chaptersBac1Js,
  chaptersBac2Js,
  chaptersPy,
  chaptersFin,
  toolVideos,
} from '../src/data/chaptersData.ts';
import type { Chapter } from '../src/types/index.ts';
import { generateId } from './crypto.ts';
import { setSetting, getSetting, withTransaction } from './db.ts';

function seedSection(
  db: DatabaseSync,
  grade: 'bac1' | 'bac2',
  section: 'js' | 'py' | 'fin',
  chapters: Chapter[],
  nowIso: string
) {
  const insertChapter = db.prepare(
    `INSERT INTO library_chapters (id, grade, section, chapter_num, title, sort_order, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'system_seed')`
  );
  const insertQuestion = db.prepare(
    `INSERT INTO library_questions (id, chapter_id, grade, section, chapter_num, q_index, q_text, a_text, is_code, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system_seed')`
  );

  chapters.forEach((ch, cIdx) => {
    const chapterId = `${grade}_${section}_${ch.num}`;
    const labelPrefix = section === 'js' ? 'المستوى' : 'الفصل';
    insertChapter.run(
      chapterId,
      grade,
      section,
      ch.num,
      `${labelPrefix} ${ch.num}`,
      cIdx + 1,
      nowIso
    );

    ch.qs.forEach((q, qIdx) => {
      insertQuestion.run(
        generateId('lq'),
        chapterId,
        grade,
        section,
        ch.num,
        qIdx,
        q.q,
        q.a,
        q.code ? 1 : 0,
        nowIso
      );
    });
  });
}

export function ensureInitialSeedData(db: DatabaseSync): void {
  const nowIso = new Date().toISOString();

  // 1. Seed educational library from chaptersData.ts if empty (preserving any edits once seeded)
  const existingChaptersRow = db
    .prepare('SELECT COUNT(*) as cnt FROM library_chapters')
    .get() as { cnt: number };

  if (Number(existingChaptersRow?.cnt || 0) === 0) {
    withTransaction(db, () => {
      seedSection(db, 'bac1', 'js', chaptersBac1Js, nowIso);
      seedSection(db, 'bac2', 'js', chaptersBac2Js, nowIso);
      seedSection(db, 'bac2', 'py', chaptersPy, nowIso);
      seedSection(db, 'bac2', 'fin', chaptersFin, nowIso);
    });
  }

  // 2. Seed primary poll ("إيه رأيكم نمد العرض؟") if none exist
  const existingPollsRow = db.prepare('SELECT COUNT(*) as cnt FROM polls').get() as { cnt: number };
  if (Number(existingPollsRow?.cnt || 0) === 0) {
    const pollClosed = getSetting(db, 'poll_closed') === 'true';
    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO polls (id, slug, question, is_open, starts_at, ends_at, created_at, updated_at)
         VALUES ('poll_extend_offer', 'extend-offer', 'إيه رأيكم نمد العرض؟', ?, ?, NULL, ?, ?)`
      ).run(pollClosed ? 0 : 1, nowIso, nowIso, nowIso);

      db.prepare(
        `INSERT INTO poll_options (id, poll_id, option_key, label, sort_order)
         VALUES ('opt_extend', 'poll_extend_offer', 'extend', 'أيوه، نمد العرض.', 1),
                ('opt_enough', 'poll_extend_offer', 'enough', 'لا، العرض كفاية.', 2)`
      ).run();
    });
  }

  // 3. Seed tool services if empty
  const existingServicesRow = db
    .prepare('SELECT COUNT(*) as cnt FROM tool_services')
    .get() as { cnt: number };
  if (Number(existingServicesRow?.cnt || 0) === 0) {
    const initialServices = [
      {
        key: 'qureo_bac1',
        name: 'أداة حل منصة QUREO — أولى بكالوريا',
        grade: 'bac1',
        description: 'إنهاء جميع مستويات جافا (42 مستوى) بمحاكاة بشرية كاملة.',
        isVisible: 1,
      },
      {
        key: 'qureo_bac2_java',
        name: 'أداة حل منصة QUREO (Java) — تانية بكالوريا',
        grade: 'bac2',
        description: 'حل 54 مستوى جافا متقدمة أوتوماتيكياً بأمان تام.',
        isVisible: 1,
      },
      {
        key: 'qureo_bac2_python',
        name: 'قسم بايثون Python — تانية بكالوريا',
        grade: 'bac2',
        description: 'متاح قريباً للتنفيذ الأوتوماتيكي الكامل.',
        isVisible: 0,
      },
      {
        key: 'financial_bac2',
        name: 'أداة حل الثقافة المالية — تانية بكالوريا',
        grade: 'bac2',
        description: 'حل جميع فصول الثقافة المالية والاختبارات النهائية بنسبة 100%.',
        isVisible: 1,
      },
    ];
    const insertSvc = db.prepare(
      `INSERT INTO tool_services (key, name, grade, description, is_visible, config_json, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?)`
    );
    for (const s of initialServices) {
      insertSvc.run(s.key, s.name, s.grade, s.description, s.isVisible, nowIso);
    }
  }

  // 4. Seed tool videos setting if missing
  if (!getSetting(db, 'tool_videos_json')) {
    const videosWithVisibility = toolVideos.map((v, idx) => ({
      id: `vid_${idx + 1}`,
      tag: v.tag,
      title: v.title,
      description: v.description,
      src: v.src,
      visible: true,
    }));
    setSetting(db, 'tool_videos_json', JSON.stringify(videosWithVisibility));
  }
}
