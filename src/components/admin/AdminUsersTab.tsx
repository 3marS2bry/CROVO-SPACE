import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  GraduationCap,
  RefreshCw,
  Search,
  Shield,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { AdminUserItem, api, DbStatusState } from '../../utils/api';
import { readAdminSnapshot, writeAdminSnapshot } from '../../utils/adminSnapshotCache';

interface AdminUsersTabProps {
  onNotice: (msg: string) => void;
}

interface UsersSnapshotPayload {
  users: AdminUserItem[];
  counts: { total: number; bac1: number; bac2: number; unclassified: number };
}

const PAGE_SIZE = 8;

function formatRegDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({ onNotice }) => {
  const [allUsers, setAllUsers] = useState<AdminUserItem[]>([]);
  const [serverCounts, setServerCounts] = useState<UsersSnapshotPayload['counts']>({
    total: 0,
    bac1: 0,
    bac2: 0,
    unclassified: 0,
  });
  const [dbStatus, setDbStatus] = useState<DbStatusState>('ok');
  const [dbError, setDbError] = useState<string | null>(null);
  const [staleSnapshot, setStaleSnapshot] = useState(false);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'admin'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [stageFocus, setStageFocus] = useState<'all' | 'bac1' | 'bac2' | 'unclassified'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  const [bac1Page, setBac1Page] = useState(1);
  const [bac2Page, setBac2Page] = useState(1);

  const [suspendingUser, setSuspendingUser] = useState<AdminUserItem | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [confirmRoleUser, setConfirmRoleUser] = useState<{
    user: AdminUserItem;
    nextRole: 'user' | 'admin';
  } | null>(null);
  const [updatingGradeId, setUpdatingGradeId] = useState<string | null>(null);
  const [activityModal, setActivityModal] = useState<Awaited<
    ReturnType<typeof api.adminUserActivity>
  > | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const apiRes = await api.adminUsers();
      const status = apiRes.dbStatus || (apiRes.requiresFirebaseLink ? 'auth_required' : 'ok');

      if (status === 'quota_exceeded' || status === 'error') {
        const localSnap = readAdminSnapshot<UsersSnapshotPayload>('users');
        if (!apiRes.staleSnapshot && apiRes.users.length === 0 && localSnap) {
          setAllUsers(localSnap.data.users);
          setServerCounts(localSnap.data.counts);
          setDbStatus(status);
          setDbError(
            apiRes.dbError ||
              'تم الحفاظ على آخر نسخة محفوظة من قائمة العملاء أثناء تعذر القراءة من Firestore.'
          );
          setStaleSnapshot(true);
        } else {
          setAllUsers(apiRes.users);
          setServerCounts(
            apiRes.counts || {
              total: apiRes.users.length,
              bac1: apiRes.users.filter((u) => u.grade === 'bac1').length,
              bac2: apiRes.users.filter((u) => u.grade === 'bac2').length,
              unclassified: apiRes.users.filter((u) => u.grade === 'unclassified').length,
            }
          );
          setDbStatus(status);
          setDbError(apiRes.dbError || null);
          setStaleSnapshot(Boolean(apiRes.staleSnapshot));
        }
        return;
      }

      const computedCounts = apiRes.counts || {
        total: apiRes.users.length,
        bac1: apiRes.users.filter((u) => u.grade === 'bac1').length,
        bac2: apiRes.users.filter((u) => u.grade === 'bac2').length,
        unclassified: apiRes.users.filter((u) => u.grade === 'unclassified').length,
      };
      setAllUsers(apiRes.users);
      setServerCounts(computedCounts);
      setDbStatus(status);
      setDbError(apiRes.dbError || null);
      setStaleSnapshot(Boolean(apiRes.staleSnapshot));

      if (status === 'ok' && !apiRes.staleSnapshot) {
        writeAdminSnapshot<UsersSnapshotPayload>('users', {
          users: apiRes.users,
          counts: computedCounts,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر تحميل المستخدمين.';
      const localSnap = readAdminSnapshot<UsersSnapshotPayload>('users');
      if (localSnap) {
        setAllUsers(localSnap.data.users);
        setServerCounts(localSnap.data.counts);
        setDbStatus('error');
        setDbError(`${msg} — يتم عرض آخر نسخة محفوظة محلياً لحماية البيانات من الاختفاء.`);
        setStaleSnapshot(true);
      } else {
        setDbStatus('error');
        setDbError(msg);
      }
      onNotice(msg);
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // Reset pagination whenever filters/search/sort change
  useEffect(() => {
    setBac1Page(1);
    setBac2Page(1);
  }, [q, roleFilter, statusFilter, sortOrder]);

  const filteredSorted = useMemo(() => {
    const query = q.trim().toLowerCase();
    return allUsers
      .filter((u) => {
        if (roleFilter !== 'all' && u.role !== roleFilter) return false;
        if (statusFilter !== 'all' && u.status !== statusFilter) return false;
        if (query) {
          const matches =
            u.name.toLowerCase().includes(query) ||
            u.email.toLowerCase().includes(query) ||
            (u.serialNumber || '').toLowerCase().includes(query);
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
        return sortOrder === 'oldest' ? diff : -diff;
      });
  }, [allUsers, q, roleFilter, statusFilter, sortOrder]);

  const bac1Users = useMemo(
    () => filteredSorted.filter((u) => u.grade === 'bac1'),
    [filteredSorted]
  );
  const bac2Users = useMemo(
    () => filteredSorted.filter((u) => u.grade === 'bac2'),
    [filteredSorted]
  );
  const unclassifiedUsers = useMemo(
    () => filteredSorted.filter((u) => u.grade === 'unclassified'),
    [filteredSorted]
  );

  const bac1TotalPages = Math.max(1, Math.ceil(bac1Users.length / PAGE_SIZE));
  const bac2TotalPages = Math.max(1, Math.ceil(bac2Users.length / PAGE_SIZE));
  const safeBac1Page = Math.min(bac1Page, bac1TotalPages);
  const safeBac2Page = Math.min(bac2Page, bac2TotalPages);

  const bac1PageItems = useMemo(
    () => bac1Users.slice((safeBac1Page - 1) * PAGE_SIZE, safeBac1Page * PAGE_SIZE),
    [bac1Users, safeBac1Page]
  );
  const bac2PageItems = useMemo(
    () => bac2Users.slice((safeBac2Page - 1) * PAGE_SIZE, safeBac2Page * PAGE_SIZE),
    [bac2Users, safeBac2Page]
  );

  const handleToggleSuspend = async (user: AdminUserItem) => {
    if (user.status === 'active') {
      setSuspendingUser(user);
      setSuspendReason('');
      return;
    }
    try {
      await api.adminUpdateUser(user.id, { status: 'active' });
      onNotice(`تم تفعيل حساب ${user.name} بنجاح.`);
      void loadUsers();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const confirmSuspend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendingUser) return;
    try {
      await api.adminUpdateUser(suspendingUser.id, {
        status: 'suspended',
        suspendReason: suspendReason.trim() || 'مخالفة شروط الاستخدام',
      });
      onNotice(`تم إيقاف حساب ${suspendingUser.name}.`);
      setSuspendingUser(null);
      void loadUsers();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر إيقاف الحساب.');
    }
  };

  const handleConfirmRoleChange = async () => {
    if (!confirmRoleUser) return;
    try {
      await api.adminUpdateUser(confirmRoleUser.user.id, { role: confirmRoleUser.nextRole });
      onNotice(`تم تعديل صلاحية ${confirmRoleUser.user.name}.`);
      setConfirmRoleUser(null);
      void loadUsers();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تعديل الصلاحية.');
    }
  };

  const handleAssignGrade = async (user: AdminUserItem, grade: 'bac1' | 'bac2') => {
    if (updatingGradeId) return;
    setUpdatingGradeId(user.id);
    try {
      await api.adminUpdateUser(user.id, { grade });
      onNotice(
        `تم تصنيف ${user.name} إلى ${grade === 'bac1' ? 'أولى بكالوريا' : 'تانية بكالوريا'} بنجاح.`
      );
      await loadUsers();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تحديث المرحلة الدراسية.');
    } finally {
      setUpdatingGradeId(null);
    }
  };

  const openActivity = async (id: string) => {
    try {
      const apiRes = await api.adminUserActivity(id);
      setActivityModal(apiRes);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تحميل نشاط المستخدم.');
    }
  };

  const renderUserCard = (u: AdminUserItem) => (
    <div
      key={u.id}
      data-testid={`admin-user-${u.id}`}
      className="clay-inset p-3.5 rounded-2xl space-y-2.5 border border-white/60"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {u.serialNumber && (
              <span
                data-testid={`user-serial-${u.id}`}
                dir="ltr"
                className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-[10px] font-mono font-black tracking-wide"
              >
                {u.serialNumber}
              </span>
            )}
            <span className="font-black text-slate-900 truncate max-w-[180px]">{u.name}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                u.role === 'admin'
                  ? 'bg-purple-100 text-purple-800'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {u.role === 'admin' ? 'مدير' : 'طالب'}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                u.status === 'active'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-rose-100 text-rose-700'
              }`}
            >
              {u.status === 'active' ? 'نشط' : 'موقوف'}
            </span>
          </div>

          <div className="font-mono text-[11px] text-indigo-700 break-all" dir="ltr">
            {u.email}
          </div>
        </div>

        <span className="text-[10px] font-mono text-slate-500 shrink-0">
          {formatRegDate(u.createdAt)}
        </span>
      </div>

      <div className="text-[11px] text-slate-600 flex flex-wrap gap-3 font-mono">
        <span>تقييمات: {u.reviewsCount}</span>
        <span>أصوات: {u.votesCount}</span>
        <span>اشتراكات مكتملة: {u.completedOrdersCount}</span>
        {u.suspendReason && u.status === 'suspended' && (
          <span className="text-rose-600 font-bold">السبب: {u.suspendReason}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200/60">
        <button
          type="button"
          onClick={() => openActivity(u.id)}
          className="clay-btn px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 text-indigo-600"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>النشاط</span>
        </button>

        <button
          type="button"
          onClick={() =>
            setConfirmRoleUser({
              user: u,
              nextRole: u.role === 'admin' ? 'user' : 'admin',
            })
          }
          className="clay-btn px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 text-purple-700"
        >
          <Shield className="w-3.5 h-3.5" />
          <span>{u.role === 'admin' ? 'تحويل لطالب' : 'ترقية لمدير'}</span>
        </button>

        <button
          type="button"
          onClick={() => handleToggleSuspend(u)}
          className={`px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 ${
            u.status === 'active'
              ? 'clay-btn text-rose-600'
              : 'clay-apple-blue text-white'
          }`}
        >
          {u.status === 'active' ? (
            <>
              <Ban className="w-3.5 h-3.5" />
              <span>إيقاف الحساب</span>
            </>
          ) : (
            <>
              <UserCheck className="w-3.5 h-3.5" />
              <span>إعادة تفعيل</span>
            </>
          )}
        </button>

        {u.grade !== 'unclassified' && (
          <button
            type="button"
            disabled={updatingGradeId === u.id}
            onClick={() => handleAssignGrade(u, u.grade === 'bac1' ? 'bac2' : 'bac1')}
            className="clay-btn px-2.5 py-1.5 rounded-xl font-bold text-slate-600 hover:text-indigo-700 disabled:opacity-50"
            title="نقل للمرحلة الأخرى"
          >
            <span>{u.grade === 'bac1' ? 'نقل لتانية ←' : 'نقل لأولى ←'}</span>
          </button>
        )}
      </div>
    </div>
  );

  const showBac1 = stageFocus === 'all' || stageFocus === 'bac1';
  const showBac2 = stageFocus === 'all' || stageFocus === 'bac2';
  const showUnclassified =
    unclassifiedUsers.length > 0 && (stageFocus === 'all' || stageFocus === 'unclassified');

  return (
    <div className="clay-card p-4 sm:p-6 space-y-5 text-xs font-ios" data-testid="admin-users-tab">
      {/* Header + Category KPI Badges */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" />
            <h2 className="text-base font-black font-decorative text-slate-900">
              إدارة وتصنيف حسابات الطلاب حسب المرحلة ({serverCounts.total || allUsers.length})
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
              أولى بكالوريا: {serverCounts.bac1}
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800">
              تانية بكالوريا: {serverCounts.bac2}
            </span>
            {serverCounts.unclassified > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                غير مصنّف (محمي): {serverCounts.unclassified}
              </span>
            )}
          </div>
        </div>

        {/* Search, Filter, Stage Focus & Registration Date Sort */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[210px] sm:flex-initial">
            <input
              type="text"
              data-testid="admin-users-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث بالرقم التسلسلي (CRV-1001) أو الاسم أو البريد..."
              className="w-full pl-3 pr-8 py-2 rounded-xl clay-inset border-none outline-none min-w-[220px]"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
          </div>

          <select
            aria-label="تصفية حسب المرحلة"
            value={stageFocus}
            onChange={(e) =>
              setStageFocus(e.target.value as 'all' | 'bac1' | 'bac2' | 'unclassified')
            }
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
          >
            <option value="all">كل المراحل (جنباً إلى جنب)</option>
            <option value="bac1">أولى بكالوريا فقط</option>
            <option value="bac2">تانية بكالوريا فقط</option>
            {serverCounts.unclassified > 0 && <option value="unclassified">غير مصنّف</option>}
          </select>

          <select
            aria-label="تصفية حسب الصلاحية"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | 'user' | 'admin')}
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
          >
            <option value="all">كل الصلاحيات</option>
            <option value="user">طالب</option>
            <option value="admin">مدير</option>
          </select>

          <select
            aria-label="تصفية حسب الحالة"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'suspended')}
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
          >
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="suspended">موقوف</option>
          </select>

          <button
            type="button"
            onClick={() => setSortOrder((s) => (s === 'newest' ? 'oldest' : 'newest'))}
            className="clay-btn px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 text-slate-700"
            title="الترتيب حسب تاريخ التسجيل"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600" />
            <span>{sortOrder === 'newest' ? 'الأحدث تسجيلاً' : 'الأقدم تسجيلاً'}</span>
          </button>

          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={loading}
            className="clay-btn p-2 rounded-xl text-indigo-600 disabled:opacity-60"
            aria-label="تحديث قائمة الطلاب"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Explicit DB Error / Auth / Stale Snapshot Status */}
      {(dbStatus === 'auth_required' || dbStatus === 'quota_exceeded' || dbStatus === 'error') && (
        <div
          data-testid="admin-users-db-status"
          className={`p-3.5 rounded-2xl clay-inset flex items-start gap-2.5 font-bold ${
            dbStatus === 'auth_required'
              ? 'text-amber-900 border border-amber-200/80'
              : 'text-rose-800 border border-rose-200/80'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div>
              {dbError ||
                (dbStatus === 'auth_required'
                  ? 'يلزم ربط جلسة Google/Firebase السحابية من الشريط العلوي لعرض حسابات الطلاب.'
                  : 'تعذر قراءة بيانات الحسابات من قاعدة البيانات.')}
            </div>
            {staleSnapshot && (
              <div className="text-[11px] font-semibold opacity-90">
                يتم حالياً عرض آخر نسخة محفوظة بنجاح لضمان عدم فقدان بيانات العملاء الظاهرة.
              </div>
            )}
          </div>
        </div>
      )}

      {loading && allUsers.length === 0 ? (
        <div className="p-6 rounded-2xl clay-inset text-center text-slate-500">جاري تحميل حسابات الطلاب...</div>
      ) : dbStatus === 'auth_required' && allUsers.length === 0 ? (
        <div className="p-6 rounded-2xl clay-inset text-center text-slate-600 font-bold">
          اربط جلسة Google/Firebase السحابية من أعلى لوحة الإدارة لعرض الحسابات وتصنيفها تلقائياً.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Safe Unclassified Bucket (missing/invalid academic-stage values preserved without deletion or forced bac1 misclassification) */}
          {showUnclassified && (
            <section
              data-testid="admin-users-unclassified"
              className="p-4 rounded-2xl clay-inset border border-amber-300/70 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-amber-900 font-black">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>
                    حسابات تحتاج تحديد المرحلة ({unclassifiedUsers.length}) — محفوظة بأمان دون حذف أو تصنيف خاطئ
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {unclassifiedUsers.map((u) => (
                  <div
                    key={u.id}
                    data-testid={`admin-user-${u.id}`}
                    className="clay-card p-3 rounded-2xl space-y-2 border border-amber-200/70"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {u.serialNumber && (
                            <span
                              data-testid={`user-serial-${u.id}`}
                              dir="ltr"
                              className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-[10px] font-mono font-black"
                            >
                              {u.serialNumber}
                            </span>
                          )}
                          <span className="font-black text-slate-900">{u.name}</span>
                        </div>
                        <div className="font-mono text-[11px] text-indigo-700 break-all" dir="ltr">
                          {u.email}
                        </div>
                        <div className="text-[10px] text-amber-800 font-bold">
                          القيمة المسجلة حالياً: {u.rawGrade ? `"${u.rawGrade}"` : 'غير محددة'}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {formatRegDate(u.createdAt)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        disabled={updatingGradeId === u.id}
                        onClick={() => handleAssignGrade(u, 'bac1')}
                        className="clay-apple-blue px-2.5 py-1.5 rounded-xl font-bold text-white text-[11px] disabled:opacity-50"
                      >
                        تعيين: أولى بكالوريا
                      </button>
                      <button
                        type="button"
                        disabled={updatingGradeId === u.id}
                        onClick={() => handleAssignGrade(u, 'bac2')}
                        className="clay-btn px-2.5 py-1.5 rounded-xl font-bold text-purple-700 text-[11px] disabled:opacity-50"
                      >
                        تعيين: تانية بكالوريا
                      </button>
                      <button
                        type="button"
                        onClick={() => openActivity(u.id)}
                        className="clay-btn px-2.5 py-1.5 rounded-xl font-bold text-indigo-600 text-[11px] flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" />
                        <span>النشاط</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Side-by-Side Stage Sections (Desktop: 2 columns, Mobile: 1 column) */}
          {(showBac1 || showBac2) && (
            <div
              className={`grid grid-cols-1 ${
                showBac1 && showBac2 ? 'xl:grid-cols-2' : ''
              } gap-4 items-start`}
            >
              {/* Section 1: أولى بكالوريا */}
              {showBac1 && (
                <section
                  data-testid="admin-users-bac1-section"
                  className="clay-card p-4 rounded-2xl space-y-3 border border-indigo-100/80"
                >
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/70">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl clay-apple-blue text-white flex items-center justify-center">
                        <GraduationCap className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-black font-decorative text-slate-900">
                          أولى بكالوريا
                        </h3>
                        <p className="text-[10px] text-slate-500">
                          الصف الأول الثانوي — مسار QUREO Java
                        </p>
                      </div>
                    </div>
                    <span
                      data-testid="bac1-users-count"
                      className="px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-800 font-mono font-black text-[11px]"
                    >
                      {bac1Users.length} طالب
                    </span>
                  </div>

                  {bac1PageItems.length === 0 ? (
                    <div className="p-6 rounded-2xl clay-inset text-center text-slate-500 font-bold">
                      لا يوجد طلاب في أولى بكالوريا مطابقون للتصفية الحالية.
                    </div>
                  ) : (
                    <div className="space-y-2.5">{bac1PageItems.map(renderUserCard)}</div>
                  )}

                  {bac1TotalPages > 1 && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-[11px]">
                      <button
                        type="button"
                        disabled={safeBac1Page <= 1}
                        onClick={() => setBac1Page((p) => Math.max(1, p - 1))}
                        className="clay-btn px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 disabled:opacity-40"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                        <span>السابق</span>
                      </button>
                      <span className="font-mono font-bold text-slate-600">
                        صفحة {safeBac1Page} من {bac1TotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={safeBac1Page >= bac1TotalPages}
                        onClick={() => setBac1Page((p) => Math.min(bac1TotalPages, p + 1))}
                        className="clay-btn px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 disabled:opacity-40"
                      >
                        <span>التالي</span>
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </section>
              )}

              {/* Section 2: تانية بكالوريا */}
              {showBac2 && (
                <section
                  data-testid="admin-users-bac2-section"
                  className="clay-card p-4 rounded-2xl space-y-3 border border-purple-100/80"
                >
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/70">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white flex items-center justify-center shadow-sm">
                        <GraduationCap className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-black font-decorative text-slate-900">
                          تانية بكالوريا
                        </h3>
                        <p className="text-[10px] text-slate-500">
                          الصف الثاني الثانوي — Java وPython والثقافة المالية
                        </p>
                      </div>
                    </div>
                    <span
                      data-testid="bac2-users-count"
                      className="px-2.5 py-1 rounded-full bg-purple-100 text-purple-800 font-mono font-black text-[11px]"
                    >
                      {bac2Users.length} طالب
                    </span>
                  </div>

                  {bac2PageItems.length === 0 ? (
                    <div className="p-6 rounded-2xl clay-inset text-center text-slate-500 font-bold">
                      لا يوجد طلاب في تانية بكالوريا مطابقون للتصفية الحالية.
                    </div>
                  ) : (
                    <div className="space-y-2.5">{bac2PageItems.map(renderUserCard)}</div>
                  )}

                  {bac2TotalPages > 1 && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-[11px]">
                      <button
                        type="button"
                        disabled={safeBac2Page <= 1}
                        onClick={() => setBac2Page((p) => Math.max(1, p - 1))}
                        className="clay-btn px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 disabled:opacity-40"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                        <span>السابق</span>
                      </button>
                      <span className="font-mono font-bold text-slate-600">
                        صفحة {safeBac2Page} من {bac2TotalPages}
                      </span>
                      <button
                        type="button"
                        disabled={safeBac2Page >= bac2TotalPages}
                        onClick={() => setBac2Page((p) => Math.min(bac2TotalPages, p + 1))}
                        className="clay-btn px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 disabled:opacity-40"
                      >
                        <span>التالي</span>
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {/* Suspend Reason Modal */}
      {suspendingUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4">
          <form
            onSubmit={confirmSuspend}
            className="w-full max-w-sm clay-card p-5 space-y-3 bg-[#EEF2F7]"
          >
            <h3 className="text-sm font-black font-decorative text-slate-900">
              تأكيد إيقاف حساب {suspendingUser.name}
            </h3>
            <input
              type="text"
              required
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="اكتب سبب الإيقاف..."
              className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl bg-rose-600 text-white font-bold"
              >
                تأكيد الإيقاف
              </button>
              <button
                type="button"
                onClick={() => setSuspendingUser(null)}
                className="clay-btn px-4 py-2 rounded-xl font-bold"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Role Change Modal */}
      {confirmRoleUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4">
          <div className="w-full max-w-sm clay-card p-5 space-y-3 bg-[#EEF2F7]">
            <h3 className="text-sm font-black font-decorative text-slate-900">
              تأكيد تعديل الصلاحية
            </h3>
            <p className="text-xs text-slate-700">
              هل تريد تغيير صلاحية <b>{confirmRoleUser.user.name}</b> إلى{' '}
              <b>{confirmRoleUser.nextRole === 'admin' ? 'مدير (Admin)' : 'طالب (User)'}</b>؟
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmRoleChange}
                className="flex-1 clay-apple-blue py-2 rounded-xl text-white font-bold"
              >
                تأكيد
              </button>
              <button
                type="button"
                onClick={() => setConfirmRoleUser(null)}
                className="clay-btn px-4 py-2 rounded-xl font-bold"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activity Inspector Modal */}
      {activityModal && (
        <div
          onClick={() => setActivityModal(null)}
          className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            data-testid="user-activity-modal"
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto clay-card p-5 bg-[#EEF2F7] space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-black font-decorative text-slate-900">
                  سجل نشاط: {activityModal.user.name}
                </h3>
                {activityModal.user.serialNumber && (
                  <span
                    dir="ltr"
                    className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-[11px] font-mono font-black"
                  >
                    {activityModal.user.serialNumber}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-bold text-slate-700">
                  {activityModal.user.grade === 'bac1'
                    ? 'أولى بكالوريا'
                    : activityModal.user.grade === 'bac2'
                      ? 'تانية بكالوريا'
                      : 'غير مصنّف'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActivityModal(null)}
                className="clay-btn p-1.5 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl clay-inset space-y-1.5">
              <div className="font-bold text-indigo-700">
                السجل الكامل لنشاط المستخدم على الموقع ({activityModal.activities?.length || 0})
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {(activityModal.activities || []).map((act) => {
                  const labels: Record<string, string> = {
                    user_register: 'إنشاء الحساب',
                    user_login: 'تسجيل الدخول',
                    page_view: 'تصفح صفحة',
                    library_open: 'فتح المكتبة',
                    level_view: 'فتح مستوى في المكتبة',
                    library_search: 'بحث داخل المكتبة',
                    tool_view: 'فتح صفحة الأداة',
                    question_copy: 'نسخ سؤال/حل',
                    question_report: 'بلاغ عن سؤال',
                    tool_like: 'إعجاب بالأداة',
                    tool_unlike: 'إلغاء الإعجاب بالأداة',
                    comment_like: 'إعجاب بتعليق',
                    comment_unlike: 'إلغاء الإعجاب بتعليق',
                    comment_create: 'كتابة تعليق',
                    comment_edit: 'تعديل تعليق',
                    comment_delete: 'حذف تعليق',
                    comment_report: 'بلاغ عن تعليق',
                    poll_vote: 'تصويت في استفتاء',
                    order_create: 'إرسال طلب اشتراك',
                    push_subscribe: 'تفعيل الإشعارات',
                  };
                  const detailParts = [
                    act.grade === 'bac1'
                      ? 'أولى بكالوريا'
                      : act.grade === 'bac2'
                        ? 'تانية بكالوريا'
                        : act.grade,
                    act.section,
                    act.chapterNum ? `فصل ${act.chapterNum}` : null,
                    act.query ? `بحث: "${act.query}"` : null,
                    act.path,
                  ].filter(Boolean);
                  let formattedTime = act.createdAt;
                  try {
                    formattedTime = new Intl.DateTimeFormat('ar-EG', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(act.createdAt));
                  } catch {}
                  return (
                    <div
                      key={act.id}
                      className="p-2 rounded-lg clay-card bg-white/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]"
                    >
                      <div>
                        <span className="font-black text-slate-900">
                          {labels[act.eventType] || act.eventType}
                        </span>
                        {detailParts.length > 0 && (
                          <span className="text-slate-600 mr-2">· {detailParts.join(' · ')}</span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0" dir="ltr">
                        {formattedTime}
                      </span>
                    </div>
                  );
                })}
                {(!activityModal.activities || activityModal.activities.length === 0) && (
                  <div className="text-slate-500">لا توجد أنشطة مسجلة بعد.</div>
                )}
              </div>
            </div>

            <div className="p-3 rounded-xl clay-inset space-y-1">
              <div className="font-bold text-indigo-700">الطلبات ({activityModal.orders.length})</div>
              {activityModal.orders.map((o) => (
                <div key={o.id} className="text-[11px] font-mono">
                  #{o.orderCode} · {o.platformLabel} · {o.finalPrice}ج · {o.status}
                </div>
              ))}
              {activityModal.orders.length === 0 && <div className="text-slate-500">لا يوجد.</div>}
            </div>
            <div className="p-3 rounded-xl clay-inset space-y-1">
              <div className="font-bold text-indigo-700">
                التقييمات ({activityModal.reviews.length})
              </div>
              {activityModal.reviews.map((r) => (
                <div key={r.id} className="text-[11px]">
                  ★ {r.rating} — {r.content}
                </div>
              ))}
              {activityModal.reviews.length === 0 && <div className="text-slate-500">لا يوجد.</div>}
            </div>
            <div className="p-3 rounded-xl clay-inset space-y-1">
              <div className="font-bold text-indigo-700">
                أصوات الاستفتاءات ({activityModal.votes.length})
              </div>
              {activityModal.votes.map((v, i) => (
                <div key={i} className="text-[11px] flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-indigo-600" />
                  <span>
                    {v.question} ← {v.optionKey}
                  </span>
                </div>
              ))}
              {activityModal.votes.length === 0 && <div className="text-slate-500">لا يوجد.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
