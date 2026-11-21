import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  Flag,
  Heart,
  History,
  KeyRound,
  Lock,
  LogOut,
  Megaphone,
  MessageSquare,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Users,
  Vote,
  X,
  Zap,
} from 'lucide-react';
import {
  api,
  ApiError,
  OrderPaymentStatus,
  OrderSubscriptionStatus,
} from '../utils/api';
import { readAdminSnapshot, writeAdminSnapshot } from '../utils/adminSnapshotCache';
import { useAuth } from '../context/AuthContext';
import {
  getFirebaseIdToken,
  signInWithGoogleCloud,
} from '../utils/cloudStore';
import { AdminAnalyticsTab } from './admin/AdminAnalyticsTab';
import { AdminUsersTab } from './admin/AdminUsersTab';
import { AdminLibraryTab } from './admin/AdminLibraryTab';
import { AdminToolTab } from './admin/AdminToolTab';
import { AdminAdsTab } from './admin/AdminAdsTab';
import { AdminPollsTab } from './admin/AdminPollsTab';
import { AdminSecurityTab } from './admin/AdminSecurityTab';

interface AdminDashboardProps {
  onBackToSite: () => void;
  onConfigUpdated: () => void;
}

type OverviewData = Awaited<ReturnType<typeof api.adminOverview>>;
type AdminTab =
  | 'analytics'
  | 'orders'
  | 'users'
  | 'library'
  | 'tool'
  | 'ads'
  | 'polls'
  | 'comments'
  | 'reports'
  | 'settings'
  | 'notifications'
  | 'security';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onBackToSite,
  onConfigUpdated,
}) => {
  const { user, loading: authLoading, logout } = useAuth();
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [googleLoggingIn, setGoogleLoggingIn] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [passwordLoggingIn, setPasswordLoggingIn] = useState(false);

  const [tab, setTab] = useState<AdminTab>('analytics');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dbOutageWarning, setDbOutageWarning] = useState<{
    status: 'quota_exceeded' | 'error';
    message: string;
    snapshotTime?: string;
  } | null>(null);

  // Orders filter, manual order, inline confirmations & notes
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [revealedOrderPasswords, setRevealedOrderPasswords] = useState<Record<string, boolean>>({});
  const [orderNotes, setOrderNotes] = useState<Record<string, string>>({});
  const [expandedOrderLogId, setExpandedOrderLogId] = useState<string | null>(null);
  const [pendingOrderStatusConfirm, setPendingOrderStatusConfirm] = useState<{
    id: string;
    orderCode: string;
    expectedCurrentStatus: string;
    nextStatus: 'completed' | 'cancelled';
  } | null>(null);

  const [showManualOrderModal, setShowManualOrderModal] = useState(false);
  const [manualFullName, setManualFullName] = useState('');
  const [manualOrderCode, setManualOrderCode] = useState('');
  const [manualGrade, setManualGrade] = useState<'bac1' | 'bac2'>('bac1');
  const [manualPlatforms, setManualPlatforms] = useState<Array<'qureo' | 'financial'>>(['qureo']);
  const [manualPlatformUsername, setManualPlatformUsername] = useState('');
  const [manualPaymentMethod, setManualPaymentMethod] = useState('فودافون كاش');
  const [manualFinalPrice, setManualFinalPrice] = useState('');
  const [manualStatus, setManualStatus] = useState<'new' | 'reviewing' | 'completed' | 'cancelled'>('new');
  const [manualPaymentStatus, setManualPaymentStatus] = useState<OrderPaymentStatus>('pending_verification');
  const [manualSubscriptionStatus, setManualSubscriptionStatus] = useState<OrderSubscriptionStatus>('pending_confirmation');
  const [manualAdminNote, setManualAdminNote] = useState('');
  const [manualOrderSubmitting, setManualOrderSubmitting] = useState(false);
  const [manualOrderError, setManualOrderError] = useState<string | null>(null);

  // Question reports notes & delete confirmations
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);
  const [confirmDeleteOrderId, setConfirmDeleteOrderId] = useState<string | null>(null);

  // Editable pricing & countdown settings form state
  const [qureoOfferPrice, setQureoOfferPrice] = useState(50);
  const [qureoOldPrice, setQureoOldPrice] = useState(100);
  const [finOfferPrice, setFinOfferPrice] = useState(50);
  const [finOldPrice, setFinOldPrice] = useState(100);
  const [bundleOfferPrice, setBundleOfferPrice] = useState(100);
  const [bundleOldPrice, setBundleOldPrice] = useState(200);
  const [offerEndsLocal, setOfferEndsLocal] = useState('');
  const [afterOfferMode, setAfterOfferMode] = useState<'regular_price' | 'extended_offer'>('regular_price');
  const [ordersEnabled, setOrdersEnabled] = useState(true);
  const [adminWhatsappDisplay, setAdminWhatsappDisplay] = useState('201550324450');
  const [showSettingsConfirmPreview, setShowSettingsConfirmPreview] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationsIntervalDays, setNotificationsIntervalDays] = useState(3);
  const [customPushTitle, setCustomPushTitle] = useState('');
  const [customPushBody, setCustomPushBody] = useState('');
  const [customPushCategory, setCustomPushCategory] = useState<'offer' | 'service' | 'update'>('offer');
  const [pushSending, setPushSending] = useState(false);
  const [resettingPrices, setResettingPrices] = useState(false);

  const flashNotice = useCallback((msg: string) => {
    setStatusMessage(msg);
    window.setTimeout(() => setStatusMessage((prev) => (prev === msg ? null : prev)), 4500);
  }, []);

  const syncSettingsFields = useCallback((overview: OverviewData) => {
    const c = overview.config;
    setQureoOfferPrice(c.qureoOfferPrice);
    setQureoOldPrice(c.qureoOldPrice);
    setFinOfferPrice(c.finOfferPrice);
    setFinOldPrice(c.finOldPrice);
    setBundleOfferPrice(c.bundleOfferPrice);
    setBundleOldPrice(c.bundleOldPrice);
    setAfterOfferMode(c.afterOfferMode);
    setOrdersEnabled(c.ordersEnabled);
    setAdminWhatsappDisplay(c.adminWhatsappDisplay);
    setNotificationsEnabled(c.notificationsEnabled);
    setNotificationsIntervalDays(c.notificationsIntervalDays);

    try {
      const d = new Date(c.offerEndsAt);
      const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setOfferEndsLocal(localIso);
    } catch {
      setOfferEndsLocal('');
    }
  }, []);

  const loadOverview = useCallback(async () => {
    setLoadingData(true);
    try {
      const overview = await api.adminOverview();
      if (overview.dbStatus === 'quota_exceeded' || overview.dbStatus === 'error') {
        const localSnap = readAdminSnapshot<OverviewData>('overview');
        if (!overview.staleSnapshot && overview.orders.length === 0 && localSnap) {
          setData({
            ...localSnap.data,
            dbStatus: overview.dbStatus,
            dbError: overview.dbError,
            staleSnapshot: true,
          });
          syncSettingsFields(localSnap.data);
          setDbOutageWarning({
            status: overview.dbStatus,
            message:
              overview.dbError ||
              'تعذر الاتصال الكامل بقاعدة البيانات. يتم عرض آخر نسخة محفوظة لمنع أي فقدان ظاهري.',
            snapshotTime: localSnap.savedAt,
          });
        } else {
          setData(overview);
          syncSettingsFields(overview);
          setDbOutageWarning({
            status: overview.dbStatus,
            message:
              overview.dbError ||
              'تم الحفاظ على آخر حالة معروفة من قاعدة البيانات أثناء الانقطاع المؤقت.',
            snapshotTime: localSnap?.savedAt,
          });
        }
      } else {
        setData(overview);
        syncSettingsFields(overview);
        setDbOutageWarning(null);
        if (overview.dbStatus === 'ok' && !overview.staleSnapshot && !overview.stats?.requiresFirebaseLink) {
          writeAdminSnapshot('overview', overview);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر تحميل بيانات الإدارة.';
      const localSnap = readAdminSnapshot<OverviewData>('overview');
      if (localSnap) {
        setData((prev) => prev || { ...localSnap.data, dbStatus: 'error', dbError: msg, staleSnapshot: true });
        syncSettingsFields(localSnap.data);
        setDbOutageWarning({
          status: 'error',
          message: `${msg} — تم الإبقاء على آخر نسخة محفوظة محلياً بدلاً من تفريغ لوحة التحكم.`,
          snapshotTime: localSnap.savedAt,
        });
      } else {
        setDbOutageWarning({ status: 'error', message: msg });
      }
      flashNotice(msg);
    } finally {
      setLoadingData(false);
    }
  }, [flashNotice, syncSettingsFields]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    api
      .adminMe()
      .then((res) => {
        if (cancelled) return;
        if (res.authenticated) {
          setAuthenticated(true);
          loadOverview();
        }
      })
      .catch(() => {
        if (!cancelled) setAuthenticated(false);
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, loadOverview]);

  // Automatic Google Admin verification when signed in via Firebase as an admin
  useEffect(() => {
    if (!authChecked || authenticated || !user || user.role !== 'admin') return;

    let cancelled = false;
    (async () => {
      const idToken = await getFirebaseIdToken(true);
      if (!idToken || cancelled) return;
      try {
        await api.adminFirebaseLogin(idToken);
        if (cancelled) return;
        setAuthenticated(true);
        await loadOverview();
      } catch {
        // Leave Google login prompt available
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authChecked, authenticated, user, loadOverview]);

  const handleGoogleAdminLogin = async () => {
    if (googleLoggingIn) return;
    setGoogleLoggingIn(true);
    setLoginError(null);
    let openedPopup = false;
    try {
      let idToken = await getFirebaseIdToken(true);
      if (!idToken) {
        openedPopup = true;
        await signInWithGoogleCloud('bac1');
        idToken = await getFirebaseIdToken(true);
      }
      if (!idToken) {
        throw new Error('تعذر الحصول على رمز التحقق من Google.');
      }
      await api.adminFirebaseLogin(idToken);
      setAuthenticated(true);
      await loadOverview();
    } catch (err) {
      // Only re-open the Google account picker popup when a non-admin Google account returned 403
      const isWrongAccount403 = err instanceof ApiError && err.status === 403;
      if (!openedPopup && isWrongAccount403) {
        try {
          await signInWithGoogleCloud('bac1');
          const freshToken = await getFirebaseIdToken(true);
          if (!freshToken) {
            throw new Error('تعذر الحصول على رمز التحقق من Google.');
          }
          await api.adminFirebaseLogin(freshToken);
          setAuthenticated(true);
          await loadOverview();
          return;
        } catch (retryErr) {
          setLoginError(retryErr instanceof Error ? retryErr.message : 'فشل تسجيل الدخول بحساب الإدارة.');
          return;
        }
      }
      setLoginError(err instanceof Error ? err.message : 'فشل تسجيل الدخول بحساب الإدارة.');
    } finally {
      setGoogleLoggingIn(false);
    }
  };

  const handlePasswordAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordLoggingIn) return;
    if (!adminUsername.trim() || !adminPassword) {
      setLoginError('أدخل اسم المستخدم وكلمة المرور.');
      return;
    }
    setPasswordLoggingIn(true);
    setLoginError(null);
    try {
      await api.adminLogin(adminUsername.trim(), adminPassword);
      setAuthenticated(true);
      setAdminPassword('');
      await loadOverview();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'اسم المستخدم أو كلمة المرور غير صحيحة.');
    } finally {
      setPasswordLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await Promise.allSettled([api.adminLogout(), logout()]);
    setAuthenticated(false);
    setData(null);
  };

  const executeOrderUpdate = async (
    id: string,
    payload: {
      expectedCurrentStatus?: string;
      status?: 'new' | 'reviewing' | 'completed' | 'cancelled';
      paymentStatus?: OrderPaymentStatus;
      subscriptionStatus?: OrderSubscriptionStatus;
      adminNote?: string;
    }
  ) => {
    try {
      await api.adminUpdateOrder(id, payload);
      setPendingOrderStatusConfirm(null);
      flashNotice('تم تحديث الطلب وسجل التغييرات بنجاح.');
      await loadOverview();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setPendingOrderStatusConfirm(null);
        flashNotice('تعارض: تم تعديل حالة هذا الطلب مسبقاً — تم تحديث القائمة بآخر حالة.');
        await loadOverview();
        return;
      }
      flashNotice(err instanceof Error ? err.message : 'تعذر تحديث الطلب.');
    }
  };

  const handleOrderStatusSelect = (
    ord: OverviewData['orders'][number],
    nextStatus: 'new' | 'reviewing' | 'completed' | 'cancelled'
  ) => {
    if (nextStatus === ord.status) return;
    if (nextStatus === 'completed' || nextStatus === 'cancelled') {
      setPendingOrderStatusConfirm({
        id: ord.id,
        orderCode: ord.orderCode,
        expectedCurrentStatus: ord.status,
        nextStatus,
      });
      return;
    }
    void executeOrderUpdate(ord.id, {
      status: nextStatus,
      expectedCurrentStatus: ord.status,
    });
  };

  const handleCreateManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (manualOrderSubmitting) return;
    setManualOrderError(null);
    if (manualFullName.trim().length < 2) {
      setManualOrderError('اسم العميل مطلوب (حرفان على الأقل).');
      return;
    }
    if (manualPlatformUsername.trim().length < 2) {
      setManualOrderError('اسم المستخدم على المنصة مطلوب (حرفان على الأقل).');
      return;
    }
    const platformsToSend: Array<'qureo' | 'financial'> =
      manualGrade === 'bac1'
        ? ['qureo']
        : manualPlatforms.length > 0
          ? manualPlatforms
          : ['qureo'];
    setManualOrderSubmitting(true);
    try {
      const parsedPrice = manualFinalPrice.trim() ? Number(manualFinalPrice.trim()) : undefined;
      const res = await api.adminCreateManualOrder({
        orderCode: manualOrderCode.trim() || undefined,
        fullName: manualFullName.trim(),
        grade: manualGrade,
        platforms: platformsToSend,
        platformUsername: manualPlatformUsername.trim(),
        paymentMethod: manualPaymentMethod,
        finalPrice: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
        status: manualStatus,
        paymentStatus: manualPaymentStatus,
        subscriptionStatus: manualSubscriptionStatus,
        adminNote: manualAdminNote.trim() || undefined,
      });
      setShowManualOrderModal(false);
      setManualFullName('');
      setManualOrderCode('');
      setManualPlatformUsername('');
      setManualFinalPrice('');
      setManualAdminNote('');
      setManualStatus('new');
      setManualPaymentStatus('pending_verification');
      setManualSubscriptionStatus('pending_confirmation');
      flashNotice(`تم تسجيل الطلب اليدوي #${res.order.orderCode} بنجاح.`);
      await loadOverview();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setManualOrderError(err.message || 'يوجد طلب مسجل بنفس الرقم بالفعل — استخدم رقماً آخر أو عدّل الطلب الحالي.');
      } else {
        setManualOrderError(err instanceof Error ? err.message : 'تعذر تسجيل الطلب اليدوي.');
      }
    } finally {
      setManualOrderSubmitting(false);
    }
  };

  const handlePurgeCredentials = async (id: string) => {
    try {
      await api.adminUpdateOrder(id, { purgeCredentials: true });
      flashNotice('تم حذف كلمة السر نهائياً.');
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر مسح البيانات.');
    }
  };

  const handleDeleteOrder = async (id: string) => {
    try {
      await api.adminDeleteOrder(id);
      setConfirmDeleteOrderId(null);
      flashNotice('تم حذف الطلب نهائياً.');
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر حذف الطلب.');
    }
  };

  const handleRequestSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSettingsConfirmPreview(true);
  };

  const handleConfirmSaveSettings = async () => {
    try {
      await api.adminUpdateSettings({
        qureoOfferPrice,
        qureoOldPrice,
        finOfferPrice,
        finOldPrice,
        bundleOfferPrice,
        bundleOldPrice,
        offerEndsAt: offerEndsLocal ? new Date(offerEndsLocal).toISOString() : undefined,
        afterOfferMode,
        ordersEnabled,
        adminWhatsappDisplay,
        notificationsEnabled,
        notificationsIntervalDays,
      });
      setShowSettingsConfirmPreview(false);
      flashNotice('تم حفظ الإعدادات وتحديث الموقع للجميع فوراً.');
      onConfigUpdated();
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.');
    }
  };

  const handleResetRegularPrices = async () => {
    if (resettingPrices) return;
    setResettingPrices(true);
    try {
      const regQureo = Math.max(1, Math.round(Number(qureoOldPrice || 100)));
      const regFin = Math.max(1, Math.round(Number(finOldPrice || 100)));
      const regBundle = Math.max(1, Math.round(Number(bundleOldPrice || 200)));
      const endedIso = new Date(Date.now() - 60_000).toISOString();

      const res = await api.adminUpdateSettings({
        resetToRegularPrices: true,
        qureoOldPrice: regQureo,
        qureoOfferPrice: regQureo,
        finOldPrice: regFin,
        finOfferPrice: regFin,
        bundleOldPrice: regBundle,
        bundleOfferPrice: regBundle,
        afterOfferMode: 'regular_price',
        offerEndsAt: endedIso,
      });

      setQureoOldPrice(res.config.qureoOldPrice);
      setQureoOfferPrice(res.config.qureoOfferPrice);
      setFinOldPrice(res.config.finOldPrice);
      setFinOfferPrice(res.config.finOfferPrice);
      setBundleOldPrice(res.config.bundleOldPrice);
      setBundleOfferPrice(res.config.bundleOfferPrice);
      setAfterOfferMode('regular_price');
      try {
        const d = new Date(res.config.offerEndsAt);
        setOfferEndsLocal(
          new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        );
      } catch {
        // ignore date conversion error
      }
      flashNotice('تم إرجاع جميع الأسعار للأسعار العادية وحفظها فوراً في الموقع.');
      onConfigUpdated();
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر إرجاع الأسعار للعادية.');
    } finally {
      setResettingPrices(false);
    }
  };

  const handleCommentAction = async (
    id: string,
    payload: { isVerified?: boolean; status?: 'approved' | 'hidden'; clearReports?: boolean }
  ) => {
    try {
      await api.adminUpdateComment(id, payload);
      flashNotice('تم تحديث التقييم.');
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const handleDeleteComment = async (id: string) => {
    try {
      await api.adminDeleteComment(id);
      setConfirmDeleteCommentId(null);
      flashNotice('تم حذف التعليق نهائياً.');
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر الحذف.');
    }
  };

  const handleQuestionReportAction = async (
    id: string,
    status: 'pending' | 'reviewed' | 'resolved' | 'dismissed'
  ) => {
    try {
      const note = reportNotes[id] ?? undefined;
      await api.adminUpdateQuestionReport(id, {
        status,
        adminNote: note,
      });
      flashNotice('تم تحديث حالة بلاغ السؤال.');
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر تحديث البلاغ.');
    }
  };

  const handleSendPush = async (mode: 'due' | 'broadcast_next' | 'broadcast_custom') => {
    if (pushSending) return;
    setPushSending(true);
    try {
      const res = await api.adminSendPush({
        mode,
        title: customPushTitle || undefined,
        body: customPushBody || undefined,
        category: customPushCategory,
      });
      const r = res.result;
      flashNotice(
        `نتيجة الإرسال — مؤهل: ${r.eligibleCount} · وصل: ${r.sentCount} · فشل: ${r.failedCount} · أُزيل المنتهي: ${r.removedExpired}`
      );
      if (mode === 'broadcast_custom') {
        setCustomPushTitle('');
        setCustomPushBody('');
      }
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر إرسال الإشعارات.');
    } finally {
      setPushSending(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center font-ios text-sm text-slate-600">
        جاري التحقق من صلاحية الإدارة...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-right" data-testid="admin-login-view">
        <button
          type="button"
          onClick={onBackToSite}
          className="clay-btn px-4 py-2 rounded-xl text-xs font-bold text-indigo-600 flex items-center gap-1.5 mb-5 font-ios"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          <span>الرجوع للموقع</span>
        </button>

        <div className="clay-card p-6 space-y-4 border border-white/80">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl clay-apple-blue flex items-center justify-center text-white">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-black font-decorative text-slate-900">
                دخول لوحة الإدارة (/admin)
              </h1>
              <p className="text-xs text-slate-500 font-ios">
                محمي بصلاحيات Firebase Auth وقواعد Firestore Rules — للمدير المعتمد فقط
              </p>
            </div>
          </div>

          {user?.email && (
            <div
              data-testid="admin-active-google-banner"
              className={`p-3 rounded-xl text-xs font-ios border ${
                user.role === 'admin'
                  ? 'bg-emerald-50/90 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50/90 border-amber-200 text-amber-800'
              }`}
            >
              {user.role === 'admin' ? (
                <span>
                  مسجّل حالياً بحساب الإدارة: <strong dir="ltr">{user.email}</strong> — اضغط زر الدخول بحساب Google بالأسفل للمتابعة.
                </span>
              ) : (
                <span>
                  الحساب المسجّل حالياً في المتصفح: <strong dir="ltr">{user.email}</strong>. للدخول إلى لوحة الإدارة اضغط الزر بالأسفل واختر حساب الإدارة الرسمي.
                </span>
              )}
            </div>
          )}

          {loginError && (
            <div className="p-2.5 rounded-xl clay-inset text-xs font-bold text-rose-600 font-ios">
              {loginError}
            </div>
          )}

          <form onSubmit={handlePasswordAdminLogin} className="space-y-3 pt-1">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 font-ios">
                اسم المستخدم أو البريد الإلكتروني
              </label>
              <input
                type="text"
                data-testid="admin-username-input"
                dir="ltr"
                autoComplete="username"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                placeholder="admin"
                className="w-full px-3.5 py-2.5 rounded-xl clay-inset text-sm font-mono text-slate-900 border-none outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 font-ios">
                كلمة المرور
              </label>
              <div className="relative">
                <input
                  type={showAdminPassword ? 'text' : 'password'}
                  data-testid="admin-password-input"
                  dir="ltr"
                  autoComplete="current-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl clay-inset text-sm font-mono text-slate-900 border-none outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPassword((v) => !v)}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 p-1"
                  aria-label={showAdminPassword ? 'إخفاء كلمة المرور' : 'عرض كلمة المرور'}
                >
                  {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              data-testid="admin-login-submit"
              disabled={passwordLoggingIn}
              className="w-full clay-apple-blue py-3 rounded-xl text-sm font-black text-white font-ios flex items-center justify-center gap-2 shadow-md disabled:opacity-60"
            >
              <KeyRound className="w-4 h-4" />
              <span>{passwordLoggingIn ? 'جاري التحقق...' : 'دخول الإدارة'}</span>
            </button>
          </form>

          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-ios">
            <span className="flex-1 h-px bg-slate-200/80" />
            <span>أو الدخول بحساب Google المصرّح له</span>
            <span className="flex-1 h-px bg-slate-200/80" />
          </div>

          <button
            type="button"
            data-testid="admin-google-login-btn"
            disabled={googleLoggingIn}
            onClick={handleGoogleAdminLogin}
            className="w-full clay-btn py-2.5 rounded-xl text-xs font-black text-indigo-700 font-ios flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              {googleLoggingIn
                ? 'جاري التحقق بحساب Google...'
                : 'دخول الإدارة الآمن بحساب Google'}
            </span>
          </button>
        </div>
      </div>
    );
  }

  const filteredOrders = (data?.orders || []).filter((o) => {
    if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) return false;
    if (!orderSearch.trim()) return true;
    const q = orderSearch.trim().toLowerCase();
    return (
      o.orderCode.toLowerCase().includes(q) ||
      o.fullName.toLowerCase().includes(q) ||
      o.platformUsername.toLowerCase().includes(q) ||
      (o.userSerialNumber || '').toLowerCase().includes(q) ||
      (o.userEmail || '').toLowerCase().includes(q)
    );
  });

  const statusLabels: Record<string, string> = {
    new: 'جديد',
    reviewing: 'قيد المراجعة',
    completed: 'مكتمل',
    cancelled: 'ملغي',
  };

  const navTabs: Array<{ id: AdminTab; label: string; icon: React.ReactNode; testId?: string }> = [
    { id: 'analytics', label: 'لوحة الإحصائيات', icon: <BarChart3 className="w-3.5 h-3.5" />, testId: 'admin-tab-analytics' },
    { id: 'orders', label: `الطلبات (${data?.orders.length || 0})`, icon: <ShoppingBag className="w-3.5 h-3.5" />, testId: 'admin-tab-orders' },
    { id: 'users', label: 'المستخدمون', icon: <Users className="w-3.5 h-3.5" />, testId: 'admin-tab-users' },
    { id: 'library', label: 'إدارة المكتبة', icon: <BookOpen className="w-3.5 h-3.5" />, testId: 'admin-tab-library' },
    { id: 'tool', label: 'إدارة الأداة', icon: <Zap className="w-3.5 h-3.5" />, testId: 'admin-tab-tool' },
    { id: 'ads', label: 'الإعلانات والمعاينة', icon: <Megaphone className="w-3.5 h-3.5" />, testId: 'admin-tab-ads' },
    { id: 'polls', label: 'الاستفتاءات', icon: <Vote className="w-3.5 h-3.5" />, testId: 'admin-tab-polls' },
    { id: 'comments', label: `التقييمات (${data?.comments.length || 0})`, icon: <MessageSquare className="w-3.5 h-3.5" />, testId: 'admin-tab-comments' },
    { id: 'reports', label: `البلاغات (${data?.stats.pendingQuestionReports || 0})`, icon: <Flag className="w-3.5 h-3.5" />, testId: 'admin-tab-reports' },
    { id: 'settings', label: 'الأسعار والواتساب', icon: <Settings className="w-3.5 h-3.5" />, testId: 'admin-tab-settings' },
    { id: 'notifications', label: `الإشعارات (${data?.stats.pushActiveCount || 0})`, icon: <Bell className="w-3.5 h-3.5" />, testId: 'admin-tab-notifications' },
    { id: 'security', label: 'الأمان والنسخ', icon: <ShieldCheck className="w-3.5 h-3.5" />, testId: 'admin-tab-security' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-6 text-right" data-testid="admin-dashboard">
      {/* Top Bar */}
      <div className="clay-card p-4 sm:p-5 mb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-white/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-black font-decorative text-slate-900">
            مركز تحكم وإدارة CROVO SPACE
          </h1>
          <p className="text-xs text-slate-500 font-ios">
            إدارة كاملة: إحصائيات حقيقية، المستخدمين، المكتبة، الأداة، الإعلانات، الاستفتاءات، الإشعارات وسجل الأمان.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="quick-reset-regular-prices-btn"
            disabled={resettingPrices}
            onClick={handleResetRegularPrices}
            className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black flex items-center gap-1.5 font-ios shadow-sm disabled:opacity-60 cursor-pointer"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resettingPrices ? 'animate-spin' : ''}`} />
            <span>{resettingPrices ? 'جاري الإرجاع...' : 'إرجاع الأسعار للعادية'}</span>
          </button>

          <button
            type="button"
            onClick={loadOverview}
            className="clay-btn px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 font-ios"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          <button
            type="button"
            onClick={onBackToSite}
            className="clay-btn px-3 py-2 rounded-xl text-xs font-bold text-indigo-600 flex items-center gap-1.5 font-ios"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>الموقع</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="clay-btn px-3 py-2 rounded-xl text-xs font-bold text-rose-600 flex items-center gap-1.5 font-ios"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>خروج</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="mb-4 p-3 rounded-2xl clay-inset text-xs font-bold text-indigo-700 font-ios">
          {statusMessage}
        </div>
      )}

      {dbOutageWarning && (
        <div
          data-testid="admin-db-outage-banner"
          className="mb-4 p-3.5 rounded-2xl clay-card border border-rose-300/80 bg-rose-50/70 text-xs font-ios space-y-1.5"
        >
          <div className="font-black text-rose-800">
            {dbOutageWarning.status === 'quota_exceeded'
              ? 'تنبيه حصة قراءة Firestore (تم تفعيل الحماية والاحتفاظ بآخر نسخة محفوظة):'
              : 'تنبيه اتصال قاعدة البيانات (لم يتم حذف أي بيانات):'}
          </div>
          <p className="text-rose-700 font-semibold leading-relaxed">{dbOutageWarning.message}</p>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-rose-600">
            {dbOutageWarning.snapshotTime && (
              <span className="font-mono" dir="ltr">
                Last Verified Snapshot: {dbOutageWarning.snapshotTime.replace('T', ' ').slice(0, 19)} UTC
              </span>
            )}
            {dbOutageWarning.status === 'quota_exceeded' && (
              <a
                href="https://console.firebase.google.com/project/sincere-impact-wbvhw/firestore/databases/ai-studio-crovospace-2e8ccbb9-ef49-4649-ad68-54f754bd8410/data?openUpgradeDialog=true"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-bold text-indigo-700 hover:text-indigo-900"
              >
                فحص أو ترقية حصة Firestore في Firebase Console ↗
              </a>
            )}
          </div>
        </div>
      )}

      {data?.stats.requiresFirebaseLink && (
        <div className="mb-4 p-3.5 rounded-2xl clay-card border border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-ios">
          <div className="text-amber-900 font-bold">
            أنت مسجّل الآن باسم المستخدم وكلمة المرور. لعرض الطلبات وبيانات المشتركين وحفظ التعديلات في Firestore، اربط جلسة Google/Firebase السحابية بضغطة واحدة.
          </div>
          <button
            type="button"
            disabled={googleLoggingIn}
            onClick={handleGoogleAdminLogin}
            className="clay-apple-blue px-4 py-2 rounded-xl text-xs font-black text-white shrink-0 flex items-center gap-1.5 disabled:opacity-60"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{googleLoggingIn ? 'جاري الربط...' : 'ربط جلسة Google/Firebase'}</span>
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 p-2 rounded-2xl clay-inset mb-5 text-xs font-bold font-ios">
        {navTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={item.testId}
            onClick={() => setTab(item.id)}
            className={`px-3 py-2 rounded-xl flex items-center gap-1.5 transition-all ${
              tab === item.id ? 'clay-apple-blue text-white shadow-sm' : 'text-slate-600 hover:text-indigo-700'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* ANALYTICS DASHBOARD */}
      {tab === 'analytics' && <AdminAnalyticsTab initialData={data?.analytics} />}

      {/* ORDERS */}
      {tab === 'orders' && (
        <div className="clay-card p-4 sm:p-6 space-y-4">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5">
            <input
              type="text"
              data-testid="admin-orders-search"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="بحث برقم الطلب أو الرقم التسلسلي (CRV-1001) أو الاسم..."
              className="px-3.5 py-2 rounded-xl text-xs font-ios clay-inset border-none outline-none flex-1"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={orderStatusFilter}
                onChange={(e) => setOrderStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-xl text-xs font-ios clay-inset border-none outline-none"
              >
                <option value="all">كل الحالات</option>
                <option value="new">جديد</option>
                <option value="reviewing">قيد المراجعة</option>
                <option value="completed">مكتمل</option>
                <option value="cancelled">ملغي</option>
              </select>

              <button
                type="button"
                data-testid="open-manual-order-btn"
                onClick={() => {
                  setManualOrderError(null);
                  setShowManualOrderModal(true);
                }}
                className="clay-apple-blue px-3.5 py-2 rounded-xl text-xs font-black text-white flex items-center gap-1.5 shadow-sm"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ تسجيل طلب يدوي (واتساب)</span>
              </button>
            </div>
          </div>

          {showManualOrderModal && (
            <form
              onSubmit={handleCreateManualOrder}
              data-testid="manual-order-form"
              className="p-4 rounded-2xl border border-indigo-200 bg-white/85 space-y-3 text-xs font-ios"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black font-decorative text-indigo-900">
                  تسجيل ومطابقة طلب يدوي قادم من واتساب
                </h3>
                <button
                  type="button"
                  onClick={() => setShowManualOrderModal(false)}
                  className="clay-btn p-1.5 rounded-full"
                  aria-label="إغلاق"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {manualOrderError && (
                <div
                  data-testid="manual-order-error"
                  className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-bold flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{manualOrderError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                <label className="block">
                  <span className="font-bold text-slate-700">اسم الطالب / العميل *</span>
                  <input
                    type="text"
                    required
                    value={manualFullName}
                    onChange={(e) => setManualFullName(e.target.value)}
                    placeholder="الاسم الكامل"
                    className="w-full mt-1 px-3 py-2 rounded-xl clay-inset border-none outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-bold text-slate-700">كود الطلب من رسالة واتساب (اختياري)</span>
                  <input
                    type="text"
                    dir="ltr"
                    value={manualOrderCode}
                    onChange={(e) => setManualOrderCode(e.target.value)}
                    placeholder="مثال: CRV-7A9C21"
                    className="w-full mt-1 px-3 py-2 rounded-xl clay-inset border-none outline-none font-mono"
                  />
                </label>

                <label className="block">
                  <span className="font-bold text-slate-700">اسم المستخدم في المنصة *</span>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={manualPlatformUsername}
                    onChange={(e) => setManualPlatformUsername(e.target.value)}
                    placeholder="username"
                    className="w-full mt-1 px-3 py-2 rounded-xl clay-inset border-none outline-none font-mono"
                  />
                </label>

                <label className="block">
                  <span className="font-bold text-slate-700">المرحلة الدراسية</span>
                  <select
                    value={manualGrade}
                    onChange={(e) => {
                      const next = e.target.value === 'bac2' ? 'bac2' : 'bac1';
                      setManualGrade(next);
                      if (next === 'bac1') setManualPlatforms(['qureo']);
                    }}
                    className="w-full mt-1 px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                  >
                    <option value="bac1">أولى بكالوريا (QUREO)</option>
                    <option value="bac2">تانية بكالوريا</option>
                  </select>
                </label>

                <div className="block">
                  <span className="font-bold text-slate-700 block">المنصات المختارة</span>
                  <div className="mt-1.5 flex items-center gap-3 px-3 py-1.5 rounded-xl clay-inset">
                    <label className="flex items-center gap-1.5 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={manualPlatforms.includes('qureo')}
                        disabled={manualGrade === 'bac1'}
                        onChange={(e) =>
                          setManualPlatforms((prev) =>
                            e.target.checked
                              ? Array.from(new Set([...prev, 'qureo']))
                              : prev.filter((p) => p !== 'qureo')
                          )
                        }
                      />
                      <span>QUREO</span>
                    </label>
                    {manualGrade === 'bac2' && (
                      <label className="flex items-center gap-1.5 font-bold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={manualPlatforms.includes('financial')}
                          onChange={(e) =>
                            setManualPlatforms((prev) =>
                              e.target.checked
                                ? Array.from(new Set([...prev, 'financial']))
                                : prev.filter((p) => p !== 'financial')
                            )
                          }
                        />
                        <span>ثقافة مالية</span>
                      </label>
                    )}
                  </div>
                </div>

                <label className="block">
                  <span className="font-bold text-slate-700">طريقة الدفع والسعر النهائي</span>
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <select
                      value={manualPaymentMethod}
                      onChange={(e) => setManualPaymentMethod(e.target.value)}
                      className="px-2 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                    >
                      <option value="فودافون كاش">فودافون كاش</option>
                      <option value="إنستا باي">إنستا باي</option>
                      <option value="محفظة إلكترونية (كاش)">محفظة كاش</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      value={manualFinalPrice}
                      onChange={(e) => setManualFinalPrice(e.target.value)}
                      placeholder="تلقائي"
                      className="px-2.5 py-2 rounded-xl clay-inset border-none outline-none font-mono"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="font-bold text-slate-700">حالة الطلب</span>
                  <select
                    value={manualStatus}
                    onChange={(e) =>
                      setManualStatus(e.target.value as 'new' | 'reviewing' | 'completed' | 'cancelled')
                    }
                    className="w-full mt-1 px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                  >
                    <option value="new">جديد</option>
                    <option value="reviewing">قيد المراجعة</option>
                    <option value="completed">مكتمل</option>
                    <option value="cancelled">ملغي</option>
                  </select>
                </label>

                <label className="block">
                  <span className="font-bold text-slate-700">حالة الدفع</span>
                  <select
                    value={manualPaymentStatus}
                    onChange={(e) => setManualPaymentStatus(e.target.value as OrderPaymentStatus)}
                    className="w-full mt-1 px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                  >
                    <option value="pending_verification">بانتظار مراجعة الدفع</option>
                    <option value="paid">تم الدفع ✓</option>
                    <option value="unpaid">غير مدفوع</option>
                    <option value="refunded">مسترد</option>
                  </select>
                </label>

                <label className="block">
                  <span className="font-bold text-slate-700">حالة الاشتراك</span>
                  <select
                    value={manualSubscriptionStatus}
                    onChange={(e) =>
                      setManualSubscriptionStatus(e.target.value as OrderSubscriptionStatus)
                    }
                    className="w-full mt-1 px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                  >
                    <option value="pending_confirmation">بانتظار التأكيد اليدوي</option>
                    <option value="active">مفعّل ✓</option>
                    <option value="expired">منتهي</option>
                    <option value="cancelled">ملغي</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="font-bold text-slate-700">ملاحظة الإدارة (اختياري)</span>
                <input
                  type="text"
                  value={manualAdminNote}
                  onChange={(e) => setManualAdminNote(e.target.value)}
                  placeholder="تفاصيل التحويل أو أي ملاحظة..."
                  className="w-full mt-1 px-3 py-2 rounded-xl clay-inset border-none outline-none"
                />
              </label>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowManualOrderModal(false)}
                  className="clay-btn px-4 py-2 rounded-xl font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  data-testid="submit-manual-order-btn"
                  disabled={manualOrderSubmitting}
                  className="clay-apple-blue px-5 py-2 rounded-xl font-black text-white disabled:opacity-50"
                >
                  {manualOrderSubmitting ? 'جاري التسجيل...' : 'حفظ الطلب اليدوي'}
                </button>
              </div>
            </form>
          )}

          {filteredOrders.length === 0 ? (
            <div className="p-8 rounded-2xl clay-inset text-center text-xs font-bold text-slate-500 font-ios">
              لا توجد طلبات مطابقة للبحث حالياً.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((ord) => {
                const isPassVisible = Boolean(revealedOrderPasswords[ord.id]);
                const pStatus = ord.paymentStatus || 'pending_verification';
                const sStatus = ord.subscriptionStatus || 'pending_confirmation';
                const isConfirmingFinal = pendingOrderStatusConfirm?.id === ord.id;
                const noteDraft = orderNotes[ord.id] ?? ord.adminNote ?? '';
                const changeLogList = ord.changeLog || [];

                return (
                  <div
                    key={ord.id}
                    data-testid={`admin-order-${ord.orderCode}`}
                    className="clay-inset p-3.5 sm:p-4 rounded-2xl space-y-2.5 text-xs font-ios"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-black text-indigo-600">{ord.orderCode}</span>
                        {ord.source === 'admin_manual' && (
                          <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 text-[10px] font-bold">
                            يدوي (واتساب)
                          </span>
                        )}
                        {ord.userSerialNumber && (
                          <span
                            dir="ltr"
                            title={ord.userEmail || undefined}
                            className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-[10px] font-mono font-black"
                          >
                            {ord.userSerialNumber}
                          </span>
                        )}
                        <span className="font-black text-slate-900">{ord.fullName}</span>
                        <span className="text-slate-500">
                          ({ord.grade === 'bac1' ? 'أولى بكالوريا' : 'تانية بكالوريا'})
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-black text-indigo-600">
                          {ord.finalPrice} جنيه (بدلاً من {ord.oldPrice})
                        </span>
                        <select
                          aria-label={`حالة الطلب ${ord.orderCode}`}
                          value={ord.status}
                          onChange={(e) =>
                            handleOrderStatusSelect(
                              ord,
                              e.target.value as 'new' | 'reviewing' | 'completed' | 'cancelled'
                            )
                          }
                          className="px-2.5 py-1 rounded-xl clay-card text-xs font-bold"
                        >
                          {Object.entries(statusLabels).map(([val, lbl]) => (
                            <option key={val} value={val}>
                              {lbl}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {isConfirmingFinal && pendingOrderStatusConfirm && (
                      <div
                        data-testid={`confirm-order-status-${ord.orderCode}`}
                        className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="font-black text-amber-900">
                          {pendingOrderStatusConfirm.nextStatus === 'completed'
                            ? `تأكيد تحويل الطلب #${ord.orderCode} إلى «مكتمل»؟ (سيتم مسح كلمة سر المنصة تلقائياً)`
                            : `تأكيد إلغاء الطلب #${ord.orderCode} نهائياً؟`}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              void executeOrderUpdate(ord.id, {
                                status: pendingOrderStatusConfirm.nextStatus,
                                expectedCurrentStatus: pendingOrderStatusConfirm.expectedCurrentStatus,
                              })
                            }
                            className="px-3 py-1 rounded-lg bg-amber-600 text-white font-bold"
                          >
                            تأكيد التنفيذ
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingOrderStatusConfirm(null)}
                            className="clay-btn px-3 py-1 rounded-lg font-bold"
                          >
                            تراجع
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-700">
                      <div>
                        <span className="font-bold">المنصة والقسم:</span> {ord.platformLabel} — {ord.sectionDetails}
                      </div>
                      <div>
                        <span className="font-bold">طريقة الدفع:</span> {ord.paymentMethod} ·{' '}
                        <span className="font-bold">واتساب:</span> تأكيد يدوي (Click-to-Chat)
                      </div>
                    </div>

                    {/* Payment & Subscription Status Selectors + Admin Note */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-2.5 rounded-xl bg-white/60 text-[11px]">
                      <label className="flex flex-col gap-1">
                        <span className="font-bold text-slate-600">حالة الدفع:</span>
                        <select
                          aria-label={`حالة الدفع ${ord.orderCode}`}
                          value={pStatus}
                          onChange={(e) =>
                            void executeOrderUpdate(ord.id, {
                              expectedCurrentStatus: ord.status,
                              paymentStatus: e.target.value as OrderPaymentStatus,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg clay-card font-bold"
                        >
                          <option value="pending_verification">بانتظار مراجعة الدفع</option>
                          <option value="paid">تم الدفع ✓</option>
                          <option value="unpaid">غير مدفوع</option>
                          <option value="refunded">مسترد</option>
                        </select>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="font-bold text-slate-600">حالة الاشتراك:</span>
                        <select
                          aria-label={`حالة الاشتراك ${ord.orderCode}`}
                          value={sStatus}
                          onChange={(e) =>
                            void executeOrderUpdate(ord.id, {
                              expectedCurrentStatus: ord.status,
                              subscriptionStatus: e.target.value as OrderSubscriptionStatus,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg clay-card font-bold"
                        >
                          <option value="pending_confirmation">بانتظار التأكيد اليدوي</option>
                          <option value="active">مفعّل ✓</option>
                          <option value="expired">منتهي</option>
                          <option value="cancelled">ملغي</option>
                        </select>
                      </label>

                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-slate-600">ملاحظة الإدارة:</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={noteDraft}
                            onChange={(e) =>
                              setOrderNotes((prev) => ({ ...prev, [ord.id]: e.target.value }))
                            }
                            placeholder="أضف ملاحظة داخلية..."
                            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg clay-card border-none outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              void executeOrderUpdate(ord.id, {
                                expectedCurrentStatus: ord.status,
                                adminNote: noteDraft,
                              })
                            }
                            className="clay-btn px-2.5 py-1.5 rounded-lg font-bold text-indigo-700 shrink-0"
                          >
                            حفظ
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl clay-card flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-3">
                        <span>
                          <span className="font-bold">اسم المستخدم:</span>{' '}
                          <span className="font-mono font-bold text-indigo-600" dir="ltr">
                            {ord.platformUsername}
                          </span>
                        </span>

                        <span>
                          <span className="font-bold">كلمة السر:</span>{' '}
                          {ord.credentialsPurged ? (
                            <span className="text-indigo-600 font-bold">تم مسحها بأمان ✓</span>
                          ) : (
                            <span className="font-mono font-bold" dir="ltr">
                              {isPassVisible ? ord.platformPassword || '—' : '••••••••'}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {changeLogList.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedOrderLogId((prev) => (prev === ord.id ? null : ord.id))
                            }
                            className="clay-btn px-2.5 py-1 rounded-lg text-slate-700 flex items-center gap-1 font-bold"
                          >
                            <History className="w-3 h-3" />
                            <span>سجل التغييرات ({changeLogList.length})</span>
                          </button>
                        )}

                        {!ord.credentialsPurged && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedOrderPasswords((prev) => ({ ...prev, [ord.id]: !prev[ord.id] }))
                              }
                              className="clay-btn px-2.5 py-1 rounded-lg flex items-center gap-1 font-bold"
                            >
                              {isPassVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              <span>{isPassVisible ? 'إخفاء' : 'عرض'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePurgeCredentials(ord.id)}
                              className="clay-btn px-2.5 py-1 rounded-lg text-amber-700 flex items-center gap-1 font-bold"
                            >
                              <KeyRound className="w-3 h-3" />
                              <span>مسح كلمة السر</span>
                            </button>
                          </>
                        )}

                        {confirmDeleteOrderId === ord.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              data-testid={`confirm-delete-order-${ord.orderCode}`}
                              onClick={() => handleDeleteOrder(ord.id)}
                              className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold"
                            >
                              تأكيد حذف الطلب
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteOrderId(null)}
                              className="clay-btn px-2.5 py-1 rounded-lg font-bold"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            data-testid={`delete-order-${ord.orderCode}`}
                            onClick={() => setConfirmDeleteOrderId(ord.id)}
                            className="clay-btn px-2.5 py-1 rounded-lg text-rose-600 flex items-center gap-1 font-bold"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>حذف الطلب</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {expandedOrderLogId === ord.id && changeLogList.length > 0 && (
                      <div
                        data-testid={`order-changelog-${ord.orderCode}`}
                        className="p-2.5 rounded-xl bg-white/75 space-y-1 text-[10px] font-mono border border-slate-200/80"
                      >
                        {changeLogList.map((entry, idx) => (
                          <div
                            key={`${ord.id}-log-${idx}`}
                            className="flex flex-wrap items-center justify-between gap-2 border-b last:border-b-0 border-slate-100 pb-1 last:pb-0"
                          >
                            <span className="text-slate-800">
                              [{entry.by}] {entry.fromStatus ?? 'init'} ← {entry.toStatus}
                              {entry.paymentStatus ? ` · دفع: ${entry.paymentStatus}` : ''}
                              {entry.subscriptionStatus ? ` · اشتراك: ${entry.subscriptionStatus}` : ''}
                              {entry.note ? ` — "${entry.note}"` : ''}
                            </span>
                            <span className="text-slate-500" dir="ltr">
                              {entry.at.replace('T', ' ').slice(0, 19)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* USERS MANAGEMENT */}
      {tab === 'users' && <AdminUsersTab onNotice={flashNotice} />}

      {/* LIBRARY CMS */}
      {tab === 'library' && (
        <AdminLibraryTab onNotice={flashNotice} onLibraryChanged={onConfigUpdated} />
      )}

      {/* TOOL CONTROL */}
      {tab === 'tool' && (
        <AdminToolTab onNotice={flashNotice} onConfigUpdated={onConfigUpdated} />
      )}

      {/* ADS MANAGER + LIVE PREVIEW */}
      {tab === 'ads' && data?.config && (
        <AdminAdsTab
          config={data.config}
          onNotice={flashNotice}
          onConfigUpdated={() => {
            onConfigUpdated();
            loadOverview();
          }}
        />
      )}

      {/* POLLS MANAGER */}
      {tab === 'polls' && (
        <AdminPollsTab onNotice={flashNotice} onConfigUpdated={onConfigUpdated} />
      )}

      {/* QUESTION REPORTS */}
      {tab === 'reports' && (
        <div className="clay-card p-4 sm:p-6 space-y-3 text-xs font-ios">
          <h2 className="text-base font-black font-decorative">بلاغات الإجابات الخاطئة من الطلاب</h2>
          {(data?.questionReports || []).length === 0 ? (
            <div className="p-6 rounded-2xl clay-inset text-center text-slate-500">
              لا توجد بلاغات مسجلة حتى الآن.
            </div>
          ) : (
            data!.questionReports.map((rep) => (
              <div
                key={rep.id}
                data-testid={`admin-question-report-${rep.id}`}
                className="clay-inset p-3.5 rounded-2xl space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-black text-slate-900">{rep.questionTitle}</div>
                    <div className="text-[10px] font-mono text-indigo-600">
                      {rep.grade} · {rep.section} · الفصل {rep.chapterNum} · سؤال #{rep.qIndex + 1}
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-xl text-[10px] font-bold ${
                      rep.status === 'resolved'
                        ? 'bg-indigo-500/15 text-indigo-700'
                        : rep.status === 'dismissed'
                        ? 'bg-slate-500/15 text-slate-600'
                        : 'bg-amber-500/15 text-amber-700'
                    }`}
                  >
                    {rep.status === 'pending'
                      ? 'بانتظار المراجعة'
                      : rep.status === 'reviewed'
                      ? 'قيد الفحص'
                      : rep.status === 'resolved'
                      ? 'تمت المراجعة ✓'
                      : 'مرفوض'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl clay-card text-slate-800 space-y-1.5">
                  {rep.reason && (
                    <div>
                      <span className="font-bold text-indigo-700">سبب البلاغ:</span>{' '}
                      <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-900 font-bold">
                        {rep.reason}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="font-bold text-rose-600">وصف المشكلة:</span> {rep.description}
                  </div>
                  {rep.suggestedSolution && (
                    <div className="p-2 rounded-lg bg-emerald-50/90 border border-emerald-200/80 text-emerald-950 font-mono text-[11px]" dir="auto">
                      <span className="font-sans font-bold text-emerald-700 block mb-0.5">الحل المقترح من الطالب:</span>
                      {rep.suggestedSolution}
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="ملاحظة الإدارة (اختياري)..."
                    value={reportNotes[rep.id] ?? rep.adminNote ?? ''}
                    onChange={(e) =>
                      setReportNotes((prev) => ({ ...prev, [rep.id]: e.target.value }))
                    }
                    className="flex-1 px-3 py-1.5 rounded-xl clay-card border-none outline-none"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleQuestionReportAction(rep.id, 'reviewed')}
                      className="clay-btn px-2.5 py-1.5 rounded-xl font-bold text-indigo-600"
                    >
                      قيد الفحص
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuestionReportAction(rep.id, 'resolved')}
                      className="clay-apple-blue px-2.5 py-1.5 rounded-xl font-bold text-white"
                    >
                      تم الحل ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuestionReportAction(rep.id, 'dismissed')}
                      className="clay-btn px-2.5 py-1.5 rounded-xl font-bold text-slate-500"
                    >
                      رفض
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* COMMENTS & REVIEWS MODERATION */}
      {tab === 'comments' && (
        <div className="clay-card p-4 sm:p-6 space-y-3 text-xs font-ios">
          {(data?.comments || []).length === 0 ? (
            <div className="p-6 rounded-2xl clay-inset text-center text-slate-500">
              لا توجد تعليقات مسجلة حتى الآن.
            </div>
          ) : (
            data!.comments.map((cmt) => (
              <div
                key={cmt.id}
                className="clay-inset p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-slate-900">{cmt.authorName}</span>
                    <span className="text-slate-500">{cmt.grade}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg clay-card text-[10px] font-mono text-rose-600 font-bold">
                      <Heart className="w-3 h-3 fill-rose-500 text-rose-500" />
                      <span>{cmt.likesCount || 0}</span>
                    </span>
                    {cmt.isVerified && (
                      <span className="inline-flex items-center gap-0.5 text-indigo-600 font-bold">
                        <BadgeCheck className="w-3.5 h-3.5" />
                        <span>عميل موثّق</span>
                      </span>
                    )}
                    <span
                      data-testid={`comment-status-${cmt.id}`}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                        cmt.status === 'approved'
                          ? 'bg-indigo-500/15 text-indigo-700'
                          : cmt.status === 'pending'
                          ? 'bg-amber-500/15 text-amber-800'
                          : 'bg-rose-500/15 text-rose-700'
                      }`}
                    >
                      {cmt.status === 'approved'
                        ? 'ظاهر'
                        : cmt.status === 'pending'
                        ? 'بانتظار الموافقة'
                        : cmt.status === 'flagged'
                        ? 'موقوف للمراجعة'
                        : 'مخفي'}
                    </span>
                    {cmt.orderCode && (
                      <span className="px-2 py-0.5 rounded-lg bg-slate-200/80 text-slate-700 font-mono text-[10px] font-bold">
                        #{cmt.orderCode}
                      </span>
                    )}
                    {cmt.source === 'post_whatsapp' && (
                      <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-800 text-[10px] font-bold">
                        تجربة ما بعد واتساب
                      </span>
                    )}
                    {cmt.reportsCount > 0 && (
                      <span className="text-rose-600 font-bold">({cmt.reportsCount} بلاغ)</span>
                    )}
                  </div>
                  <p className="text-slate-700">{cmt.content}</p>
                  {(cmt.attachmentBeforeUrl || cmt.attachmentAfterUrl || cmt.attachmentUrl) && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {(cmt.attachmentBeforeUrl || cmt.attachmentUrl) && (
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg clay-card">
                          <img
                            src={(cmt.attachmentBeforeUrl || cmt.attachmentUrl)!}
                            alt="قبل الحل"
                            className="w-10 h-10 rounded object-cover"
                          />
                          <span className="text-[10px] font-bold text-amber-700">قبل الحل</span>
                        </div>
                      )}
                      {cmt.attachmentAfterUrl && (
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg clay-card">
                          <img
                            src={cmt.attachmentAfterUrl}
                            alt="بعد الحل"
                            className="w-10 h-10 rounded object-cover"
                          />
                          <span className="text-[10px] font-bold text-emerald-700">بعد الحل</span>
                        </div>
                      )}
                    </div>
                  )}
                  {cmt.reports.length > 0 && (
                    <div className="text-[10px] text-rose-600">
                      أسباب البلاغات: {cmt.reports.map((r) => r.reason).join(' · ')}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCommentAction(cmt.id, { isVerified: !cmt.isVerified })}
                    className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold ${
                      cmt.isVerified ? 'bg-indigo-600 text-white' : 'clay-btn text-slate-700'
                    }`}
                  >
                    {cmt.isVerified ? 'إلغاء التوثيق' : 'توثيق كعميل ✓'}
                  </button>

                  {cmt.status !== 'approved' ? (
                    <button
                      type="button"
                      data-testid={`approve-comment-${cmt.id}`}
                      onClick={() =>
                        handleCommentAction(cmt.id, { status: 'approved', clearReports: true })
                      }
                      className="clay-btn px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-emerald-700"
                    >
                      {cmt.status === 'pending' ? 'موافقة ونشر ✓' : 'إظهار'}
                    </button>
                  ) : null}
                  {cmt.status !== 'hidden' ? (
                    <button
                      type="button"
                      data-testid={`hide-comment-${cmt.id}`}
                      onClick={() => handleCommentAction(cmt.id, { status: 'hidden' })}
                      className="clay-btn px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-amber-600"
                    >
                      إخفاء
                    </button>
                  ) : null}

                  {confirmDeleteCommentId === cmt.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDeleteComment(cmt.id)}
                        className="px-2.5 py-1.5 rounded-xl bg-rose-600 text-white text-[11px] font-bold"
                      >
                        تأكيد الحذف
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteCommentId(null)}
                        className="clay-btn px-2 py-1.5 rounded-xl text-[11px] font-bold"
                      >
                        إلغاء
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteCommentId(cmt.id)}
                      className="clay-btn px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-rose-600 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>حذف</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* PRICING & WHATSAPP SETTINGS */}
      {tab === 'settings' && (
        <form onSubmit={handleRequestSaveSettings} className="space-y-5 text-xs font-ios">
          <div className="clay-card p-4 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-base font-black font-decorative">إدارة الأسعار، العرض وواتساب Click-to-Chat</h2>
              <button
                type="button"
                data-testid="reset-regular-prices-btn"
                disabled={resettingPrices}
                onClick={handleResetRegularPrices}
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-md disabled:opacity-60 cursor-pointer shrink-0"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${resettingPrices ? 'animate-spin' : ''}`} />
                <span>
                  {resettingPrices ? 'جاري الإرجاع والحفظ...' : 'إرجاع جميع الأسعار للعادية الآن'}
                </span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-2xl clay-inset space-y-2">
                <div className="font-black text-slate-900">QUREO (منفردة)</div>
                <label className="block">
                  <span className="text-[11px] font-bold">سعر العرض:</span>
                  <input
                    type="number"
                    value={qureoOfferPrice}
                    onChange={(e) => setQureoOfferPrice(Number(e.target.value))}
                    className="w-full mt-1 px-2.5 py-1.5 rounded-lg clay-card font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold">السعر العادي:</span>
                  <input
                    type="number"
                    value={qureoOldPrice}
                    onChange={(e) => setQureoOldPrice(Number(e.target.value))}
                    className="w-full mt-1 px-2.5 py-1.5 rounded-lg clay-card font-mono"
                  />
                </label>
              </div>

              <div className="p-3 rounded-2xl clay-inset space-y-2">
                <div className="font-black text-slate-900">ثقافة مالية (منفردة)</div>
                <label className="block">
                  <span className="text-[11px] font-bold">سعر العرض:</span>
                  <input
                    type="number"
                    value={finOfferPrice}
                    onChange={(e) => setFinOfferPrice(Number(e.target.value))}
                    className="w-full mt-1 px-2.5 py-1.5 rounded-lg clay-card font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold">السعر العادي:</span>
                  <input
                    type="number"
                    value={finOldPrice}
                    onChange={(e) => setFinOldPrice(Number(e.target.value))}
                    className="w-full mt-1 px-2.5 py-1.5 rounded-lg clay-card font-mono"
                  />
                </label>
              </div>

              <div className="p-3 rounded-2xl clay-inset space-y-2">
                <div className="font-black text-slate-900">المنصتين معاً</div>
                <label className="block">
                  <span className="text-[11px] font-bold">سعر العرض:</span>
                  <input
                    type="number"
                    value={bundleOfferPrice}
                    onChange={(e) => setBundleOfferPrice(Number(e.target.value))}
                    className="w-full mt-1 px-2.5 py-1.5 rounded-lg clay-card font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold">السعر العادي:</span>
                  <input
                    type="number"
                    value={bundleOldPrice}
                    onChange={(e) => setBundleOldPrice(Number(e.target.value))}
                    className="w-full mt-1 px-2.5 py-1.5 rounded-lg clay-card font-mono"
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block p-3 rounded-2xl clay-inset">
                <span className="font-bold block mb-1">موعد انتهاء العرض:</span>
                <input
                  type="datetime-local"
                  value={offerEndsLocal}
                  onChange={(e) => setOfferEndsLocal(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg clay-card font-mono"
                />
              </label>

              <label className="block p-3 rounded-2xl clay-inset">
                <span className="font-bold block mb-1">سلوك الأسعار بعد انتهاء العداد:</span>
                <select
                  value={afterOfferMode}
                  onChange={(e) =>
                    setAfterOfferMode(e.target.value as 'regular_price' | 'extended_offer')
                  }
                  className="w-full px-3 py-2 rounded-lg clay-card font-ios"
                >
                  <option value="regular_price">العودة للأسعار العادية</option>
                  <option value="extended_offer">الإبقاء على سعر العرض (تمديد تلقائي)</option>
                </select>
              </label>

              <label className="block p-3 rounded-2xl clay-inset">
                <span className="font-bold block mb-1">رقم واتساب استقبال رسائل العملاء (Click-to-Chat):</span>
                <input
                  type="text"
                  dir="ltr"
                  value={adminWhatsappDisplay}
                  onChange={(e) => setAdminWhatsappDisplay(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg clay-card font-mono text-left"
                />
              </label>

              <label className="p-3 rounded-2xl clay-inset flex items-center gap-2.5 cursor-pointer font-bold">
                <input
                  type="checkbox"
                  checked={ordersEnabled}
                  onChange={(e) => setOrdersEnabled(e.target.checked)}
                />
                <span>تشغيل استقبال طلبات الاشتراك الجديدة</span>
              </label>
            </div>

            {showSettingsConfirmPreview ? (
              <div
                data-testid="settings-confirm-preview"
                className="p-4 rounded-2xl bg-indigo-50/90 border border-indigo-200 space-y-3"
              >
                <div className="font-black text-indigo-950 text-sm">
                  مراجعة وتأكيد التعديلات قبل تطبيقها على الموقع للجميع:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px] font-mono">
                  <div className="p-2 rounded-xl bg-white/80">
                    QUREO: {qureoOfferPrice} ج (عادي {qureoOldPrice} ج)
                  </div>
                  <div className="p-2 rounded-xl bg-white/80">
                    ثقافة مالية: {finOfferPrice} ج (عادي {finOldPrice} ج)
                  </div>
                  <div className="p-2 rounded-xl bg-white/80">
                    المنصتين: {bundleOfferPrice} ج (عادي {bundleOldPrice} ج)
                  </div>
                  <div className="p-2 rounded-xl bg-white/80" dir="ltr">
                    WhatsApp: {adminWhatsappDisplay}
                  </div>
                  <div className="p-2 rounded-xl bg-white/80 font-sans font-bold">
                    بعد العداد: {afterOfferMode === 'regular_price' ? 'السعر العادي' : 'تمديد العرض'}
                  </div>
                  <div className="p-2 rounded-xl bg-white/80 font-sans font-bold">
                    استقبال الطلبات: {ordersEnabled ? 'مفعّل' : 'موقوف'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="confirm-save-settings-btn"
                    onClick={handleConfirmSaveSettings}
                    className="clay-apple-blue px-5 py-2.5 rounded-xl font-black text-white flex items-center gap-1.5 shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>تأكيد الحفظ النهائي</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSettingsConfirmPreview(false)}
                    className="clay-btn px-4 py-2.5 rounded-xl font-bold"
                  >
                    تعديل القيم
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="submit"
                data-testid="review-save-settings-btn"
                className="clay-apple-blue px-6 py-3 rounded-xl text-sm font-black text-white flex items-center gap-2 shadow-md"
              >
                <Save className="w-4 h-4" />
                <span>مراجعة وحفظ الأسعار وإعدادات الطلبات</span>
              </button>
            )}
          </div>
        </form>
      )}

      {/* WEB PUSH NOTIFICATIONS CONTROL */}
      {tab === 'notifications' && (
        <div className="space-y-5 text-xs font-ios">
          <div className="clay-card p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-black font-decorative">إدارة الإشعارات المجانية (Web Push VAPID)</h2>
                <p className="text-slate-500">
                  المشتركون النشطون حالياً: <span className="font-mono font-black text-indigo-600">{data?.stats.pushActiveCount || 0}</span> (إجمالي مسجّل: {data?.stats.pushTotalCount || 0})
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pushSending}
                  onClick={() => handleSendPush('due')}
                  className="clay-btn px-3.5 py-2 rounded-xl font-bold text-indigo-600"
                >
                  إرسال للمستحقين (مرور {notificationsIntervalDays} أيام)
                </button>
                <button
                  type="button"
                  disabled={pushSending}
                  onClick={() => handleSendPush('broadcast_next')}
                  className="clay-apple-blue px-4 py-2 rounded-xl font-bold text-white flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>إرسال رسالة ترويجية فورية للجميع</span>
                </button>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleConfirmSaveSettings();
              }}
              className="p-3 rounded-2xl clay-inset flex flex-wrap items-center gap-4"
            >
              <label className="flex items-center gap-2 cursor-pointer font-bold">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => setNotificationsEnabled(e.target.checked)}
                />
                <span>تشغيل نظام الإشعارات الدورية</span>
              </label>

              <label className="flex items-center gap-2 font-bold">
                <span>فترة التكرار (أيام):</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={notificationsIntervalDays}
                  onChange={(e) => setNotificationsIntervalDays(Math.max(1, Number(e.target.value)))}
                  className="w-16 px-2 py-1 rounded-lg clay-card font-mono text-center"
                />
              </label>

              <button type="submit" className="clay-btn px-3 py-1.5 rounded-xl font-bold text-indigo-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>حفظ فترة الإشعارات</span>
              </button>
            </form>

            <div className="p-3.5 rounded-2xl clay-inset space-y-2.5">
              <div className="font-black text-slate-900">إرسال إشعار مخصص لكل المشتركين:</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="عنوان الإشعار..."
                  value={customPushTitle}
                  onChange={(e) => setCustomPushTitle(e.target.value)}
                  className="px-3 py-2 rounded-xl clay-card"
                />
                <input
                  type="text"
                  placeholder="نص الإشعار..."
                  value={customPushBody}
                  onChange={(e) => setCustomPushBody(e.target.value)}
                  className="px-3 py-2 rounded-xl clay-card sm:col-span-2"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <select
                  value={customPushCategory}
                  onChange={(e) =>
                    setCustomPushCategory(e.target.value as 'offer' | 'service' | 'update')
                  }
                  className="px-3 py-1.5 rounded-xl clay-card font-bold"
                >
                  <option value="offer">عرض وتخفيض</option>
                  <option value="service">خدمة أداة CROVO</option>
                  <option value="update">تحديث بالمكتبة</option>
                </select>
                <button
                  type="button"
                  disabled={pushSending || !customPushTitle.trim() || !customPushBody.trim()}
                  onClick={() => handleSendPush('broadcast_custom')}
                  className="clay-apple-blue px-4 py-2 rounded-xl font-bold text-white disabled:opacity-50"
                >
                  إرسال الإشعار المخصص
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="clay-card p-4 space-y-2">
              <h3 className="text-sm font-black font-decorative">مكتبة الرسائل الدورية المتنوعة:</h3>
              {(data?.notifications.templates || []).map((t) => (
                <div key={t.id} className="p-2.5 rounded-xl clay-inset space-y-0.5">
                  <div className="font-black text-slate-900">{t.title}</div>
                  <div className="text-slate-600">{t.body}</div>
                </div>
              ))}
            </div>

            <div className="clay-card p-4 space-y-2">
              <h3 className="text-sm font-black font-decorative">سجل آخر الإرسالات والأخطاء:</h3>
              {(data?.notifications.logs || []).length === 0 ? (
                <div className="p-3 rounded-xl clay-inset text-slate-500">لم يتم إرسال أي إشعارات بعد.</div>
              ) : (
                data!.notifications.logs.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-xl clay-inset space-y-1">
                    <div className="flex items-center justify-between font-bold gap-2">
                      <span className="text-slate-900">{log.title}</span>
                      <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                        <span className="text-indigo-600">✓ {log.sentCount}</span>
                        {log.failedCount > 0 && (
                          <span className="text-rose-600">✗ {log.failedCount}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-slate-600">{log.body}</div>
                    {log.errorDetail && (
                      <div className="p-1.5 rounded-lg bg-rose-50 text-rose-700 font-mono text-[10px] break-all">
                        {log.errorDetail}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECURITY & AUDIT */}
      {tab === 'security' && (
        <AdminSecurityTab
          dbIntegrity={data?.stats.dbIntegrity || { ok: true, detail: 'ok' }}
          backups={data?.stats.backups || []}
          migrations={data?.stats.migrations || []}
          dbStatus={data?.dbStatus}
          dbError={data?.dbError}
          staleSnapshot={Boolean(data?.staleSnapshot)}
          storageNotice={data?.stats.isEphemeralStorageNotice || ''}
          onNotice={flashNotice}
          onRefreshOverview={loadOverview}
        />
      )}
    </div>
  );
};
