import { createRequire } from 'node:module';
import type * as WebPushType from 'web-push';
import type { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const webpush = require('web-push') as typeof WebPushType;
import { getSetting, getSiteConfig, setSetting } from './db.ts';
import { generateId } from './crypto.ts';

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

export function ensureVapidKeys(db: DatabaseSync): { publicKey: string; privateKey: string; subject: string } {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@crovo.space';

  if (envPublic && envPrivate) {
    return { publicKey: envPublic, privateKey: envPrivate, subject };
  }

  let storedPub = getSetting(db, 'vapid_public_key');
  let storedPriv = getSetting(db, 'vapid_private_key');

  if (!storedPub || !storedPriv) {
    const generated = webpush.generateVAPIDKeys();
    storedPub = generated.publicKey;
    storedPriv = generated.privateKey;
    setSetting(db, 'vapid_public_key', storedPub);
    setSetting(db, 'vapid_private_key', storedPriv);
  }

  return { publicKey: storedPub, privateKey: storedPriv, subject };
}

export function pickNextTemplateForSubscriber(lastMessageId: string | null, globalOffset: number): NotificationTemplate {
  const startIdx = Math.abs(globalOffset) % NOTIFICATION_TEMPLATES.length;
  for (let i = 0; i < NOTIFICATION_TEMPLATES.length; i++) {
    const candidate = NOTIFICATION_TEMPLATES[(startIdx + i) % NOTIFICATION_TEMPLATES.length];
    if (candidate.id !== lastMessageId) {
      return candidate;
    }
  }
  return NOTIFICATION_TEMPLATES[0];
}

export async function dispatchDueNotifications(
  db: DatabaseSync,
  options: {
    mode: 'due' | 'broadcast_next' | 'broadcast_custom';
    triggerType: 'manual' | 'scheduled_3d';
    customTitle?: string;
    customBody?: string;
    customCategory?: 'offer' | 'service' | 'update';
  }
): Promise<{
  skippedDisabled?: boolean;
  eligibleCount: number;
  sentCount: number;
  failedCount: number;
  removedExpired: number;
}> {
  const config = getSiteConfig(db);
  if (options.mode === 'due' && !config.notificationsEnabled) {
    return { skippedDisabled: true, eligibleCount: 0, sentCount: 0, failedCount: 0, removedExpired: 0 };
  }

  const keys = ensureVapidKeys(db);
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);

  const intervalMs = config.notificationsIntervalDays * 24 * 60 * 60 * 1000;
  const dueCutoffIso = new Date(Date.now() - intervalMs).toISOString();

  const subs =
    options.mode === 'due'
      ? (db
          .prepare(
            `SELECT id, endpoint, p256dh, auth, last_message_id
             FROM push_subscriptions
             WHERE enabled = 1 AND (last_sent_at IS NULL OR last_sent_at <= ?)`
          )
          .all(dueCutoffIso) as Array<{
          id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          last_message_id: string | null;
        }>)
      : (db
          .prepare(
            `SELECT id, endpoint, p256dh, auth, last_message_id
             FROM push_subscriptions
             WHERE enabled = 1`
          )
          .all() as Array<{
          id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          last_message_id: string | null;
        }>);

  if (subs.length === 0) {
    return { eligibleCount: 0, sentCount: 0, failedCount: 0, removedExpired: 0 };
  }

  const rotationIdx = Number(getSetting(db, 'last_push_rotation_idx') || '0') || 0;
  const nowIso = new Date().toISOString();

  let sentCount = 0;
  let failedCount = 0;
  let removedExpired = 0;
  let lastUsedTemplate = NOTIFICATION_TEMPLATES[rotationIdx % NOTIFICATION_TEMPLATES.length];

  for (const sub of subs) {
    let tpl: NotificationTemplate;
    if (options.mode === 'broadcast_custom' && options.customTitle && options.customBody) {
      tpl = {
        id: `custom_${Date.now()}`,
        category: options.customCategory || 'offer',
        title: options.customTitle.trim(),
        body: options.customBody.trim(),
        url: '/',
      };
    } else {
      tpl = pickNextTemplateForSubscriber(sub.last_message_id, rotationIdx);
    }
    lastUsedTemplate = tpl;

    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        JSON.stringify({
          title: tpl.title,
          body: tpl.body,
          url: tpl.url,
          tag: `crovo-${tpl.category}`,
        }),
        { TTL: 60 * 60 * 12 }
      );

      sentCount += 1;
      db.prepare(
        'UPDATE push_subscriptions SET last_sent_at = ?, last_message_id = ?, updated_at = ? WHERE id = ?'
      ).run(nowIso, tpl.id, nowIso, sub.id);
    } catch (err: unknown) {
      failedCount += 1;
      const errMsg = err instanceof Error ? err.message.slice(0, 180) : 'Push dispatch error';
      const statusCode =
        err && typeof err === 'object' && 'statusCode' in err ? Number((err as { statusCode: number }).statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        removedExpired += 1;
      } else {
        db.prepare(
          'UPDATE push_subscriptions SET last_error = ?, last_error_at = ?, updated_at = ? WHERE id = ?'
        ).run(errMsg, nowIso, nowIso, sub.id);
      }
    }
  }

  if (options.mode !== 'broadcast_custom') {
    setSetting(db, 'last_push_rotation_idx', String((rotationIdx + 1) % NOTIFICATION_TEMPLATES.length));
  }

  db.prepare(
    `INSERT INTO notification_logs (id, message_id, category, title, body, sent_count, failed_count, trigger_type, error_detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateId('push'),
    lastUsedTemplate.id,
    lastUsedTemplate.category,
    lastUsedTemplate.title,
    lastUsedTemplate.body,
    sentCount,
    failedCount,
    options.triggerType,
    failedCount > 0 ? `${failedCount} failed, ${removedExpired} expired` : null,
    nowIso
  );

  return {
    eligibleCount: subs.length,
    sentCount,
    failedCount,
    removedExpired,
  };
}
