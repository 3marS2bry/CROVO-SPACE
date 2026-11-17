import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BellOff,
  CheckCircle2,
  ExternalLink,
  Info,
  WifiOff,
  X,
} from 'lucide-react';
import { api } from '../utils/api';

const DISMISS_KEY = 'crovo_push_prompt_dismissed_until';
const ACTIVATED_ONCE_KEY = 'crovo_push_activated_once';
const OPTED_OUT_KEY = 'crovo_push_opted_out';
const PUSH_UPDATED_EVENT = 'crovo:push-updated';
const DISMISS_DAYS = 3;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isPushBrowserSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    window.isSecureContext
  );
}

function getStorageFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStorageFlag(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage restriction
  }
}

function emitPushUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PUSH_UPDATED_EVENT));
}

function translatePushError(err: unknown): { code: string; message: string; isIframeBlock?: boolean } {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : 'Error';
  const msg = err instanceof Error ? err.message : String(err || '');
  const inIframe = isRunningInIframe();

  if (!navigator.onLine) {
    return {
      code: 'OfflineError',
      message: 'لا يوجد اتصال بالإنترنت حالياً. تأكد من الاتصال وحاول تاني لتفعيل الإشعارات.',
    };
  }

  if (name === 'NotAllowedError' || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('permission')) {
    if (inIframe) {
      return {
        code: 'IframePermissionBlocked',
        isIframeBlock: true,
        message:
          'المتصفح يمنع طلب إذن الإشعارات داخل نافذة المعاينة المصغّرة. افتح الموقع في صفحة مستقلة واضغط تفعيل الإشعارات.',
      };
    }
    return {
      code: 'NotAllowedError',
      message:
        'تم منع الإشعارات من إعدادات المتصفح. اضغط على أيقونة القفل بجانب عنوان الموقع بالأعلى واختر "السماح بالإشعارات" ثم حاول تاني.',
    };
  }

  if (name === 'AbortError' || msg.toLowerCase().includes('push service')) {
    return {
      code: 'PushServiceAbortError',
      message:
        'تعذر الاتصال بخدمة إشعارات المتصفح حالياً. تأكد من اتصال الإنترنت أو عدم حجب الإشعارات بواسطة مانع الإعلانات وحاول تاني.',
    };
  }

  if (name === 'InvalidStateError') {
    return {
      code: 'InvalidStateError',
      message: 'خدمة الإشعارات بتجهّز في الخلفية حالياً. انتظر لحظة وأعد المحاولة.',
    };
  }

  if (inIframe) {
    return {
      code: name || 'IframePushError',
      isIframeBlock: true,
      message:
        'المتصفح قيّد تفعيل الإشعارات داخل الإطار المضمّن. افتح الموقع في نافذة مستقلة لتفعيل الإشعارات بضغطة واحدة.',
    };
  }

  return {
    code: name || 'UnknownPushError',
    message: msg || 'تعذر تفعيل الإشعارات حالياً. جرب تاني بعد ثواني.',
  };
}

async function waitForActiveServiceWorker(reg: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (reg.active?.state === 'activated') return reg;
  const installingOrWaiting = reg.installing || reg.waiting;
  if (installingOrWaiting) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => resolve(), 4500);
      const onStateChange = () => {
        if (installingOrWaiting.state === 'activated' || installingOrWaiting.state === 'redundant') {
          window.clearTimeout(timeout);
          installingOrWaiting.removeEventListener('statechange', onStateChange);
          resolve();
        }
      };
      installingOrWaiting.addEventListener('statechange', onStateChange);
    });
  }
  return await navigator.serviceWorker.ready;
}

async function ensureBrowserPushSubscription(): Promise<{
  ok: true;
  intervalDays: number;
} | {
  ok: false;
  message: string;
  requiresStandaloneWindow?: boolean;
}> {
  const vapid = await api.getVapidPublicKey();
  if (!vapid.enabled || !vapid.publicKey) {
    return {
      ok: false,
      message: 'الإشعارات متوقفة مؤقتاً من لوحة الإدارة.',
    };
  }

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const readyReg = await waitForActiveServiceWorker(reg);
  const appServerKey = urlBase64ToUint8Array(vapid.publicKey);

  let subscription = await readyReg.pushManager.getSubscription();
  if (subscription) {
    try {
      const existingKey = subscription.options?.applicationServerKey;
      if (existingKey) {
        const existingBytes = new Uint8Array(existingKey);
        const mismatch =
          existingBytes.length !== appServerKey.length ||
          existingBytes.some((b, i) => b !== appServerKey[i]);
        if (mismatch) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
    } catch {
      // Ignore key comparison edge cases
    }
  }

  if (!subscription) {
    try {
      subscription = await readyReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
    } catch (subErr) {
      const existing = await readyReg.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe().catch(() => {});
      }
      subscription = await readyReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
      if (!subscription && subErr) throw subErr;
    }
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    api.logPushError({ stage: 'extractKeys', errorCode: 'MissingPushKeys' });
    return { ok: false, message: 'تعذر قراءة مفتاح الاشتراك من المتصفح.' };
  }

  await api.subscribePush({
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  });

  return { ok: true, intervalDays: vapid.intervalDays };
}

let inFlightSilentSync: Promise<boolean> | null = null;

export async function syncPushSubscriptionSilently(): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator.onLine) return false;
  if (!isPushBrowserSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  if (getStorageFlag(OPTED_OUT_KEY) === '1') return false;

  if (inFlightSilentSync) return inFlightSilentSync;

  inFlightSilentSync = (async () => {
    try {
      const res = await ensureBrowserPushSubscription();
      if (res.ok) {
        setStorageFlag(ACTIVATED_ONCE_KEY, '1');
        emitPushUpdated();
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      inFlightSilentSync = null;
    }
  })();

  return inFlightSilentSync;
}

export async function subscribeBrowserToPush(): Promise<{
  ok: boolean;
  message: string;
  requiresStandaloneWindow?: boolean;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      message: 'أنت غير متصل بالإنترنت حالياً. يرجى الاتصال أولاً ثم الضغط على تفعيل الإشعارات.',
    };
  }

  if (!isPushBrowserSupported()) {
    return {
      ok: false,
      message:
        'متصفحك الحالي أو وضع التصفح لا يدعم إشعارات الويب المباشرة (على iPhone يلزم فتح الموقع من Safari وإضافته للشاشة الرئيسية أولاً).',
    };
  }

  if (Notification.permission === 'denied') {
    api.logPushError({ stage: 'precheck', errorCode: 'PermissionAlreadyDenied' });
    return {
      ok: false,
      message:
        'إذن الإشعارات مرفوض مسبقاً في المتصفح. افتح إعدادات الموقع (أيقونة القفل بالرابط بالأعلى) واسمح بالإشعارات ثم جرب تاني.',
    };
  }

  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch (err) {
      const translated = translatePushError(err);
      api.logPushError({ stage: 'requestPermission', errorCode: translated.code, detail: translated.message });
      return {
        ok: false,
        message: translated.message,
        requiresStandaloneWindow: translated.isIframeBlock,
      };
    }
  }

  if (permission === 'denied') {
    api.logPushError({ stage: 'requestPermission', errorCode: 'UserDenied' });
    return {
      ok: false,
      message:
        'تم رفض إذن الإشعارات. تقدر تفعّلها في أي وقت من إعدادات الموقع في المتصفح.',
    };
  }

  if (permission !== 'granted') {
    const inIframe = isRunningInIframe();
    api.logPushError({
      stage: 'requestPermission',
      errorCode: inIframe ? 'IframeSilentDefault' : 'PermissionDismissed',
    });
    return {
      ok: false,
      requiresStandaloneWindow: inIframe,
      message: inIframe
        ? 'المتصفح لا يعرض نافذة إذن الإشعارات داخل المعاينة المضمّنة. افتح الصفحة في نافذة مستقلة لتفعيلها بضغطة واحدة.'
        : 'تم إغلاق نافذة الإذن بدون موافقة. اضغط تفعيل واختر "السماح" لإتمام الاشتراك.',
    };
  }

  try {
    setStorageFlag(OPTED_OUT_KEY, null);
    const res = await ensureBrowserPushSubscription();
    if (!res.ok) {
      return {
        ok: false,
        message: res.message,
        requiresStandaloneWindow: res.requiresStandaloneWindow,
      };
    }

    setStorageFlag(ACTIVATED_ONCE_KEY, '1');
    setStorageFlag(DISMISS_KEY, null);
    emitPushUpdated();

    return {
      ok: true,
      message: `تم تفعيل إشعارات العروض بنجاح! هتوصلك عروضنا وتحديثاتنا الجديدة كل ${res.intervalDays} أيام تلقائياً.`,
    };
  } catch (err) {
    const translated = translatePushError(err);
    api.logPushError({ stage: 'subscribe', errorCode: translated.code, detail: translated.message });
    return {
      ok: false,
      message: translated.message,
      requiresStandaloneWindow: translated.isIframeBlock,
    };
  }
}

export async function unsubscribeBrowserFromPush(): Promise<{ ok: boolean; message: string }> {
  let endpoint: string | undefined;
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        endpoint = sub.endpoint;
        await sub.unsubscribe();
      }
    } catch {
      // Fall back to DB unsubscribe by visitor/user
    }
  }

  await api.unsubscribePush(endpoint);
  setStorageFlag(OPTED_OUT_KEY, '1');
  setStorageFlag(ACTIVATED_ONCE_KEY, null);
  emitPushUpdated();
  return {
    ok: true,
    message: 'تم إلغاء اشتراك الإشعارات وحذفه من قائمة الإرسال بنجاح. تقدر ترجّعه في أي وقت.',
  };
}

export const NotificationPrompt: React.FC<{ notificationsEnabled?: boolean }> = ({
  notificationsEnabled = true,
}) => {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; standalone?: boolean } | null>(
    null
  );

  useEffect(() => {
    if (!notificationsEnabled || !isPushBrowserSupported()) return;

    const runSyncOrPrompt = async () => {
      if (Notification.permission === 'granted') {
        setVisible(false);
        await syncPushSubscriptionSilently();
        return true;
      }
      return false;
    };

    const onAuthOrOnline = () => {
      void runSyncOrPrompt();
    };
    const onPushUpdated = () => {
      if (Notification.permission === 'granted' && getStorageFlag(ACTIVATED_ONCE_KEY) === '1') {
        setVisible((prev) => (prev ? prev : false));
      }
    };
    window.addEventListener('crovo:auth-updated', onAuthOrOnline);
    window.addEventListener('online', onAuthOrOnline);
    window.addEventListener(PUSH_UPDATED_EVENT, onPushUpdated);

    let cancelled = false;
    let timerId: number | null = null;

    const scheduleCheck = async () => {
      if (cancelled) return;
      const synced = await runSyncOrPrompt();
      if (synced || cancelled) return;
      if (Notification.permission !== 'default') return;
      if (getStorageFlag(OPTED_OUT_KEY) === '1') return;

      const dismissedUntil = Number(getStorageFlag(DISMISS_KEY) || '0');
      if (dismissedUntil > Date.now()) return;

      const tryShow = async () => {
        if (cancelled) return;
        const welcomeOpen = Boolean(document.querySelector('[data-testid="first-visit-welcome-modal"]'));
        if (welcomeOpen) {
          timerId = window.setTimeout(() => void tryShow(), 700);
          return;
        }
        try {
          const status = await api.getPushStatus();
          if (cancelled) return;
          if (status.subscribed) {
            setStorageFlag(ACTIVATED_ONCE_KEY, '1');
            setVisible(false);
            return;
          }
          if (status.notificationsEnabled && Notification.permission === 'default') {
            setVisible(true);
          }
        } catch {
          // Silent fail
        }
      };

      timerId = window.setTimeout(() => void tryShow(), 1500);
    };

    void scheduleCheck();

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener('crovo:auth-updated', onAuthOrOnline);
      window.removeEventListener('online', onAuthOrOnline);
      window.removeEventListener(PUSH_UPDATED_EVENT, onPushUpdated);
    };
  }, [notificationsEnabled]);

  const handleDismiss = () => {
    setStorageFlag(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400 * 1000));
    setVisible(false);
  };

  const handleEnable = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await subscribeBrowserToPush();
      setFeedback({
        ok: res.ok,
        text: res.message,
        standalone: res.requiresStandaloneWindow,
      });
      if (res.ok) {
        window.setTimeout(() => setVisible(false), 1100);
      }
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'تعذر تفعيل الإشعارات.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      data-testid="notification-prompt"
      className="fixed bottom-4 left-4 right-4 sm:left-6 sm:right-auto z-40 sm:max-w-sm animate-modal-pop"
    >
      <div className="clay-card p-4 bg-white border border-indigo-200/70 shadow-2xl text-right">
        <button
          type="button"
          aria-label="إغلاق"
          onClick={handleDismiss}
          className="absolute top-3 left-3 p-1.5 rounded-xl clay-btn text-slate-400 hover:text-slate-700"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-start gap-3 pl-6">
          <div className="w-9 h-9 rounded-2xl clay-apple-blue flex items-center justify-center text-white shrink-0 shadow-sm">
            <Bell className="w-4 h-4" />
          </div>

          <div className="space-y-2 flex-1">
            <h3 className="text-sm font-black font-decorative text-slate-900">
              فعّل إشعارات العروض والخصومات
            </h3>
            <p className="text-[11px] text-slate-600 font-ios leading-relaxed">
              اضغط موافقة مرة واحدة بس عشان يوصلك كل جديد وعروض المنصة أول بأول.
            </p>

            {feedback && (
              <div
                className={`p-2.5 rounded-xl clay-inset text-[11px] font-bold font-ios space-y-1.5 ${
                  feedback.ok ? 'text-indigo-700' : 'text-rose-600'
                }`}
              >
                <p>{feedback.text}</p>
                {feedback.standalone && typeof window !== 'undefined' && (
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-700 underline"
                  >
                    <span>فتح في نافذة مستقلة</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={handleEnable}
                data-testid="enable-notifications-btn"
                className="clay-apple-blue px-3.5 py-2 rounded-xl text-xs font-black text-white font-ios flex-1 disabled:opacity-60"
              >
                {busy ? 'جاري التفعيل...' : 'تفعيل مرة واحدة الآن'}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                data-testid="dismiss-notifications-btn"
                className="clay-btn px-3 py-2 rounded-xl text-xs font-bold text-slate-600 font-ios"
              >
                مش دلوقتي
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PushPreferenceWidget: React.FC = () => {
  const [supported] = useState(() => isPushBrowserSupported());
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [permState, setPermState] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [intervalDays, setIntervalDays] = useState(3);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string; standalone?: boolean } | null>(null);

  const refreshStatus = useCallback(async () => {
    const currentPerm =
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'unsupported';
    setPermState(currentPerm);

    try {
      const status = await api.getPushStatus();
      if (
        !status.subscribed &&
        status.notificationsEnabled &&
        currentPerm === 'granted' &&
        getStorageFlag(OPTED_OUT_KEY) !== '1'
      ) {
        const synced = await syncPushSubscriptionSilently();
        if (synced) {
          const updated = await api.getPushStatus();
          setSubscribed(updated.subscribed);
          setNotificationsEnabled(updated.notificationsEnabled);
          setIntervalDays(updated.intervalDays);
          return;
        }
      }
      setSubscribed(status.subscribed);
      setNotificationsEnabled(status.notificationsEnabled);
      setIntervalDays(status.intervalDays);
    } catch {
      // Ignore transient failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const onOnline = () => {
      setIsOnline(true);
      void refreshStatus();
    };
    const onOffline = () => setIsOnline(false);
    const onPushUpdated = () => {
      void refreshStatus();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(PUSH_UPDATED_EVENT, onPushUpdated);
    window.addEventListener('crovo:auth-updated', onPushUpdated);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(PUSH_UPDATED_EVENT, onPushUpdated);
      window.removeEventListener('crovo:auth-updated', onPushUpdated);
    };
  }, [refreshStatus]);

  const handleSubscribe = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await subscribeBrowserToPush();
      setNote({
        ok: res.ok,
        text: res.message,
        standalone: res.requiresStandaloneWindow,
      });
      await refreshStatus();
    } catch (err) {
      setNote({
        ok: false,
        text: err instanceof Error ? err.message : 'تعذر تفعيل الإشعارات.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUnsubscribe = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await unsubscribeBrowserFromPush();
      setNote({ ok: res.ok, text: res.message });
      await refreshStatus();
    } catch (err) {
      setNote({
        ok: false,
        text: err instanceof Error ? err.message : 'تعذر إلغاء الإشعارات.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="push-preference-widget"
      className="p-3.5 sm:p-4 rounded-2xl clay-inset space-y-2.5 text-right"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {subscribed ? (
            <Bell className="w-4 h-4 text-indigo-600" />
          ) : (
            <BellOff className="w-4 h-4 text-slate-400" />
          )}
          <span className="text-xs sm:text-sm font-black font-ios text-slate-900">
            تنبيهات عروض وتحديثات CROVO SPACE
          </span>
        </div>

        <span
          data-testid="push-status-label"
          className={`text-[11px] font-bold font-ios px-2.5 py-0.5 rounded-full ${
            subscribed
              ? 'bg-indigo-100 text-indigo-700'
              : permState === 'denied'
              ? 'bg-rose-100 text-rose-700'
              : 'bg-slate-200/80 text-slate-600'
          }`}
        >
          {loading
            ? 'جاري التحقق...'
            : !isOnline
            ? 'غير متصل'
            : subscribed
            ? `مفعّلة تلقائياً (كل ${intervalDays} أيام)`
            : permState === 'denied'
            ? 'مرفوضة من المتصفح'
            : 'غير مفعّلة'}
        </span>
      </div>

      {!isOnline && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-700 font-bold font-ios">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>أنت غير متصل بالإنترنت حالياً؛ تأكد من الاتصال لتعديل حالة الإشعارات.</span>
        </div>
      )}

      {!supported ? (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 font-ios">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            متصفحك الحالي مش داعم إشعارات الويب (Web Push) مباشرة. على iPhone بتحتاج تفتح الموقع من Safari وتضيفه للشاشة الرئيسية (Add to Home Screen)، أو تستخدم Chrome على Android والكمبيوتر.
          </span>
        </div>
      ) : permState === 'denied' ? (
        <div className="p-2.5 rounded-xl bg-rose-50/90 border border-rose-200/70 text-[11px] font-bold text-rose-700 font-ios leading-relaxed">
          تم حظر الإشعارات لهذا الموقع في إعدادات متصفحك. لتفعيلها: اضغط على أيقونة الإعدادات أو القفل بجانب رابط الموقع بالأعلى ← الإشعارات (Notifications) ← سماح (Allow) ثم أعد المحاولة.
        </div>
      ) : !notificationsEnabled ? (
        <div className="text-[11px] font-bold text-slate-500 font-ios">
          الإشعارات موقوفة مؤقتاً من لوحة الإدارة.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {subscribed ? (
            <button
              type="button"
              disabled={busy || !isOnline}
              onClick={handleUnsubscribe}
              data-testid="push-unsubscribe-btn"
              className="clay-btn px-3.5 py-2 rounded-xl text-xs font-bold text-rose-600 flex items-center gap-1.5 font-ios disabled:opacity-50"
            >
              <BellOff className="w-3.5 h-3.5" />
              <span>{busy ? 'جاري الإلغاء...' : 'إلغاء الإشعارات'}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !isOnline}
              onClick={handleSubscribe}
              data-testid="push-resubscribe-btn"
              className="clay-apple-blue px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 font-ios shadow-sm disabled:opacity-50"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>{busy ? 'جاري التفعيل...' : 'تفعيل إشعارات العروض مرة واحدة'}</span>
            </button>
          )}
        </div>
      )}

      {note && (
        <div
          data-testid="push-feedback-note"
          className={`flex items-start gap-1.5 text-[11px] font-bold font-ios p-2.5 rounded-xl ${
            note.ok
              ? 'bg-indigo-50/90 text-indigo-800 border border-indigo-200/60'
              : 'bg-rose-50/90 text-rose-700 border border-rose-200/60'
          }`}
        >
          {note.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-indigo-600 mt-0.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 mt-0.5" />
          )}
          <div className="space-y-1">
            <p>{note.text}</p>
            {note.standalone && typeof window !== 'undefined' && (
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-700 underline"
              >
                <span>فتح في صفحة مستقلة لتفعيل الإشعارات</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
