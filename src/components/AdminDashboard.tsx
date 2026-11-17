import React, { useCallback, useEffect, useState } from 'react';
import {
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
  KeyRound,
  Lock,
  LogOut,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Users,
  Vote,
  Zap,
} from 'lucide-react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  deleteCommentAdminCloud,
  deleteOrderAdminCloud,
  getFirebaseIdToken,
  getFirebaseUid,
  listAllCommentsAdminCloud,
  listOrdersAdminCloud,
  listQuestionReportsAdminCloud,
  saveOrderMetadataCloud,
  saveQuestionReportCloud,
  signInWithGoogleCloud,
  syncSiteConfigToCloud,
  updateCommentAdminCloud,
  updateOrderAdminCloud,
  updateQuestionReportCloud,
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
  const { user } = useAuth();
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [googleLoggingIn, setGoogleLoggingIn] = useState(false);

  const [tab, setTab] = useState<AdminTab>('analytics');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Orders filter & password reveal tracking
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [revealedOrderPasswords, setRevealedOrderPasswords] = useState<Record<string, boolean>>({});

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

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationsIntervalDays, setNotificationsIntervalDays] = useState(3);
  const [customPushTitle, setCustomPushTitle] = useState('');
  const [customPushBody, setCustomPushBody] = useState('');
  const [customPushCategory, setCustomPushCategory] = useState<'offer' | 'service' | 'update'>('offer');
  const [pushSending, setPushSending] = useState(false);

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
      const [overview, cloudOrders, cloudComments, cloudReports] = await Promise.all([
        api.adminOverview(),
        listOrdersAdminCloud().catch(() => []),
        listAllCommentsAdminCloud().catch(() => []),
        listQuestionReportsAdminCloud().catch(() => []),
      ]);

      // Merge Orders (keep local encrypted/decrypted password when present + include cross-site orders)
      const ordersById = new Map<string, OverviewData['orders'][number]>();
      for (const co of cloudOrders) {
        ordersById.set(co.id, co);
      }
      for (const lo of overview.orders) {
        const cloudMatch = ordersById.get(lo.id);
        ordersById.set(lo.id, {
          ...lo,
          status: cloudMatch?.status || lo.status,
          credentialsPurged: Boolean(lo.credentialsPurged || cloudMatch?.credentialsPurged),
          userSerialNumber: lo.userSerialNumber || cloudMatch?.userSerialNumber || null,
          userEmail: lo.userEmail || cloudMatch?.userEmail || null,
        });
      }
      const mergedOrders = Array.from(ordersById.values()).sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
      );

      // Merge Comments (merge cloud moderation/likes + cross-site reviews)
      const commentsById = new Map<string, OverviewData['comments'][number]>();
      for (const cc of cloudComments) {
        commentsById.set(cc.id, cc);
      }
      for (const lc of overview.comments) {
        const cloudMatch = commentsById.get(lc.id);
        commentsById.set(lc.id, {
          ...lc,
          isVerified: Boolean(lc.isVerified || cloudMatch?.isVerified),
          status: cloudMatch?.status || lc.status,
          likesCount: Math.max(lc.likesCount || 0, cloudMatch?.likesCount || 0),
        });
      }
      const mergedComments = Array.from(commentsById.values()).sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
      );

      // Merge Question Reports
      const reportsById = new Map<string, OverviewData['questionReports'][number]>();
      for (const cr of cloudReports) {
        reportsById.set(cr.id, cr);
      }
      for (const lr of overview.questionReports) {
        const cloudMatch = reportsById.get(lr.id);
        reportsById.set(lr.id, {
          ...lr,
          status: cloudMatch?.status || lr.status,
          adminNote: cloudMatch?.adminNote ?? lr.adminNote,
        });
      }
      const mergedReports = Array.from(reportsById.values()).sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
      );

      const mergedOverview: OverviewData = {
        ...overview,
        orders: mergedOrders,
        comments: mergedComments,
        questionReports: mergedReports,
        stats: {
          ...overview.stats,
          pendingQuestionReports: mergedReports.filter(
            (r) => r.status === 'pending' || r.status === 'reviewed'
          ).length,
        },
      };

      setData(mergedOverview);
      syncSettingsFields(mergedOverview);

      // Background push of local items to Firestore so future republishes stay 100% synced
      if (getFirebaseUid()) {
        void syncSiteConfigToCloud(overview.config);
        const cloudOrderIds = new Set(cloudOrders.map((o) => o.id));
        for (const lo of overview.orders) {
          if (!cloudOrderIds.has(lo.id)) {
            void saveOrderMetadataCloud({
              order: {
                id: lo.id,
                orderCode: lo.orderCode,
                fullName: lo.fullName,
                grade: lo.grade,
                platformLabel: lo.platformLabel,
                sectionDetails: lo.sectionDetails,
                oldPrice: lo.oldPrice,
                finalPrice: lo.finalPrice,
                offerApplied: lo.offerApplied,
                paymentMethod: lo.paymentMethod,
                status: lo.status,
                createdAt: lo.createdAt,
              },
              authorUid: lo.userId || 'guest_order',
              userSerialNumber: lo.userSerialNumber,
              userEmail: lo.userEmail,
              platformUsername: lo.platformUsername,
              credentialsPurged: lo.credentialsPurged,
            });
          }
        }
        const cloudReportIds = new Set(cloudReports.map((r) => r.id));
        for (const lr of overview.questionReports) {
          if (!cloudReportIds.has(lr.id)) {
            void saveQuestionReportCloud({
              id: lr.id,
              reporterUid: 'guest_report',
              questionKey: lr.questionKey,
              grade: lr.grade,
              section: lr.section,
              chapterNum: lr.chapterNum,
              qIndex: lr.qIndex,
              questionTitle: lr.questionTitle,
              description: lr.description,
              status: lr.status,
              adminNote: lr.adminNote,
            });
          }
        }
      }
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر تحميل بيانات الإدارة.');
    } finally {
      setLoadingData(false);
    }
  }, [flashNotice, syncSettingsFields]);

  useEffect(() => {
    api
      .adminMe()
      .then((res) => {
        if (res.authenticated) {
          setAuthenticated(true);
          loadOverview();
        }
      })
      .catch(() => {
        setAuthenticated(false);
      })
      .finally(() => setAuthChecked(true));
  }, [loadOverview]);

  // Automatic Google Admin elevation across deployments if signed in as the verified owner email
  useEffect(() => {
    if (!authChecked || authenticated) return;
    if (!user || user.role !== 'admin' || user.email.toLowerCase() !== '3mars7bry@gmail.com') return;

    let cancelled = false;
    (async () => {
      const idToken = await getFirebaseIdToken();
      if (!idToken || cancelled) return;
      try {
        await api.adminFirebaseLogin(idToken);
        if (cancelled) return;
        setAuthenticated(true);
        await loadOverview();
      } catch {
        // Leave login form available
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authChecked, authenticated, user, loadOverview]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      await api.adminLogin(username, password);
      setPassword('');
      setAuthenticated(true);
      await loadOverview();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'فشل تسجيل الدخول.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleGoogleAdminLogin = async () => {
    if (googleLoggingIn) return;
    setGoogleLoggingIn(true);
    setLoginError(null);
    try {
      let idToken = await getFirebaseIdToken();
      if (!idToken || user?.email.toLowerCase() !== '3mars7bry@gmail.com') {
        await signInWithGoogleCloud('bac1');
        idToken = await getFirebaseIdToken();
      }
      if (!idToken) {
        throw new Error('تعذر الحصول على رمز التحقق من Google.');
      }
      await api.adminFirebaseLogin(idToken);
      setAuthenticated(true);
      await loadOverview();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'فشل تسجيل الدخول بحساب الإدارة.');
    } finally {
      setGoogleLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await api.adminLogout();
    setAuthenticated(false);
    setData(null);
  };

  const handleOrderStatusChange = async (
    id: string,
    status: 'new' | 'reviewing' | 'completed' | 'cancelled'
  ) => {
    try {
      await updateOrderAdminCloud(id, { status });
      await api.adminUpdateOrder(id, { status }).catch(() => {});
      flashNotice('تم تحديث حالة الطلب بنجاح.');
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر تحديث الطلب.');
    }
  };

  const handlePurgeCredentials = async (id: string) => {
    try {
      await updateOrderAdminCloud(id, { credentialsPurged: true });
      await api.adminUpdateOrder(id, { purgeCredentials: true }).catch(() => {});
      flashNotice('تم حذف كلمة السر نهائياً.');
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر مسح البيانات.');
    }
  };

  const handleDeleteOrder = async (id: string) => {
    try {
      await deleteOrderAdminCloud(id);
      await api.adminDeleteOrder(id).catch(() => {});
      setConfirmDeleteOrderId(null);
      flashNotice('تم حذف الطلب نهائياً.');
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر حذف الطلب.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.adminUpdateSettings({
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
      void syncSiteConfigToCloud(res.config);
      flashNotice('تم حفظ الإعدادات وتحديث الموقع للجميع فوراً.');
      onConfigUpdated();
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.');
    }
  };

  const handleCommentAction = async (
    id: string,
    payload: { isVerified?: boolean; status?: 'approved' | 'hidden'; clearReports?: boolean }
  ) => {
    try {
      await updateCommentAdminCloud(id, payload);
      await api.adminUpdateComment(id, payload).catch(() => {});
      flashNotice('تم تحديث التقييم.');
      await loadOverview();
    } catch (err) {
      flashNotice(err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const handleDeleteComment = async (id: string) => {
    try {
      await deleteCommentAdminCloud(id);
      await api.adminDeleteComment(id).catch(() => {});
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
      await updateQuestionReportCloud(id, { status, adminNote: note });
      await api
        .adminUpdateQuestionReport(id, {
          status,
          adminNote: note,
        })
        .catch(() => {});
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

        <form onSubmit={handleLogin} className="clay-card p-6 space-y-4 border border-white/80">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl clay-apple-blue flex items-center justify-center text-white">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-black font-decorative text-slate-900">
                تسجيل دخول لوحة الإدارة (/admin)
              </h1>
              <p className="text-xs text-slate-500 font-ios">CROVO SPACE — لصاحب الموقع فقط</p>
            </div>
          </div>

          {loginError && (
            <div className="p-2.5 rounded-xl clay-inset text-xs font-bold text-rose-600 font-ios">
              {loginError}
            </div>
          )}

          <div>
            <label htmlFor="adm-user" className="block text-xs font-bold mb-1 font-ios">
              اسم المستخدم:
            </label>
            <input
              id="adm-user"
              type="text"
              required
              autoComplete="username"
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin username"
              className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono clay-inset border-none outline-none text-left"
            />
          </div>

          <div>
            <label htmlFor="adm-pass" className="block text-xs font-bold mb-1 font-ios">
              كلمة المرور:
            </label>
            <input
              id="adm-pass"
              type="password"
              required
              autoComplete="current-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono clay-inset border-none outline-none text-left"
            />
          </div>

          <button
            type="submit"
            disabled={loggingIn || googleLoggingIn}
            className="w-full clay-apple-blue py-3 rounded-xl text-sm font-black text-white font-ios shadow-md disabled:opacity-60"
          >
            {loggingIn ? 'جاري التحقق...' : 'دخول الإدارة'}
          </button>

          <div className="relative flex items-center py-1">
            <div className="flex-1 border-t border-slate-300/70" />
            <span className="px-3 text-[11px] font-bold text-slate-500 font-ios">أو</span>
            <div className="flex-1 border-t border-slate-300/70" />
          </div>

          <button
            type="button"
            data-testid="admin-google-login-btn"
            disabled={loggingIn || googleLoggingIn}
            onClick={handleGoogleAdminLogin}
            className="w-full clay-btn py-2.5 rounded-xl text-xs font-black text-indigo-700 font-ios flex items-center justify-center gap-2 border border-indigo-200/80 disabled:opacity-60"
          >
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            <span>
              {googleLoggingIn
                ? 'جاري التحقق بحساب Google...'
                : 'دخول سريع بحساب Google الإدارة (3mars7bry@gmail.com)'}
            </span>
          </button>
        </form>
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
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <input
              type="text"
              data-testid="admin-orders-search"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="بحث برقم الطلب أو الرقم التسلسلي (CRV-1001) أو الاسم..."
              className="px-3.5 py-2 rounded-xl text-xs font-ios clay-inset border-none outline-none flex-1"
            />
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
          </div>

          {filteredOrders.length === 0 ? (
            <div className="p-8 rounded-2xl clay-inset text-center text-xs font-bold text-slate-500 font-ios">
              لا توجد طلبات مطابقة للبحث حالياً.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((ord) => {
                const isPassVisible = Boolean(revealedOrderPasswords[ord.id]);
                return (
                  <div
                    key={ord.id}
                    data-testid={`admin-order-${ord.orderCode}`}
                    className="clay-inset p-3.5 sm:p-4 rounded-2xl space-y-2.5 text-xs font-ios"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-black text-indigo-600">{ord.orderCode}</span>
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

                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-indigo-600">
                          {ord.finalPrice} جنيه (بدلاً من {ord.oldPrice})
                        </span>
                        <select
                          aria-label={`حالة الطلب ${ord.orderCode}`}
                          value={ord.status}
                          onChange={(e) =>
                            handleOrderStatusChange(
                              ord.id,
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-700">
                      <div>
                        <span className="font-bold">المنصة والقسم:</span> {ord.platformLabel} — {ord.sectionDetails}
                      </div>
                      <div>
                        <span className="font-bold">طريقة الدفع:</span> {ord.paymentMethod} ·{' '}
                        <span className="font-bold">تواصل واتساب:</span> رسالة جاهزة من العميل (Click-to-Chat)
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

                <div className="p-2.5 rounded-xl clay-card text-slate-800">
                  <span className="font-bold text-rose-600">وصف المشكلة:</span> {rep.description}
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
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                        cmt.status === 'approved'
                          ? 'bg-indigo-500/15 text-indigo-700'
                          : 'bg-rose-500/15 text-rose-700'
                      }`}
                    >
                      {cmt.status === 'approved'
                        ? 'ظاهر'
                        : cmt.status === 'flagged'
                        ? 'موقوف للمراجعة'
                        : 'مخفي'}
                    </span>
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
                      onClick={() =>
                        handleCommentAction(cmt.id, { status: 'approved', clearReports: true })
                      }
                      className="clay-btn px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-indigo-600"
                    >
                      إظهار
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCommentAction(cmt.id, { status: 'hidden' })}
                      className="clay-btn px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-amber-600"
                    >
                      إخفاء
                    </button>
                  )}

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
        <form onSubmit={handleSaveSettings} className="space-y-5 text-xs font-ios">
          <div className="clay-card p-4 sm:p-6 space-y-4">
            <h2 className="text-base font-black font-decorative">إدارة الأسعار، العرض وواتساب Click-to-Chat</h2>
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

            <button
              type="submit"
              className="clay-apple-blue px-6 py-3 rounded-xl text-sm font-black text-white flex items-center gap-2 shadow-md"
            >
              <Save className="w-4 h-4" />
              <span>حفظ الأسعار وإعدادات الطلبات</span>
            </button>
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

            <form onSubmit={handleSaveSettings} className="p-3 rounded-2xl clay-inset flex flex-wrap items-center gap-4">
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
          storageNotice={data?.stats.isEphemeralStorageNotice || ''}
          onNotice={flashNotice}
          onRefreshOverview={loadOverview}
        />
      )}
    </div>
  );
};
