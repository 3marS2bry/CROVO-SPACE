import React, { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Eye, Search, Shield, UserCheck, Users, X } from 'lucide-react';
import { AdminUserItem, api } from '../../utils/api';
import {
  fetchUserActivitiesCloud,
  listAllUsersAdminCloud,
  updateUserAdminCloud,
} from '../../utils/cloudStore';

interface AdminUsersTabProps {
  onNotice: (msg: string) => void;
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({ onNotice }) => {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [suspendingUser, setSuspendingUser] = useState<AdminUserItem | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [confirmRoleUser, setConfirmRoleUser] = useState<{ user: AdminUserItem; nextRole: 'user' | 'admin' } | null>(
    null
  );
  const [activityModal, setActivityModal] = useState<Awaited<
    ReturnType<typeof api.adminUserActivity>
  > | null>(null);

  const [apiIdByUserId, setApiIdByUserId] = useState<Record<string, string>>({});

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [apiRes, cloudList] = await Promise.all([
        api.adminUsers({ q, role: roleFilter, status: statusFilter }).catch(() => ({ users: [] as AdminUserItem[] })),
        listAllUsersAdminCloud().catch(() => [] as AdminUserItem[]),
      ]);

      const mergedMap = new Map<string, AdminUserItem>();
      const emailIndex = new Map<string, string>();
      const nextApiIdMap: Record<string, string> = {};

      for (const cu of cloudList) {
        mergedMap.set(cu.id, cu);
        if (cu.email) emailIndex.set(cu.email.toLowerCase(), cu.id);
      }

      for (const au of apiRes.users) {
        const rawFbKey = au.id.startsWith('fb_') ? au.id.slice(3) : null;
        const matchByEmailKey = au.email ? emailIndex.get(au.email.toLowerCase()) : undefined;
        const targetKey = mergedMap.has(au.id)
          ? au.id
          : rawFbKey && mergedMap.has(rawFbKey)
          ? rawFbKey
          : matchByEmailKey;
        if (targetKey) {
          const cu = mergedMap.get(targetKey)!;
          nextApiIdMap[targetKey] = au.id;
          mergedMap.set(targetKey, {
            ...cu,
            serialNumber: cu.serialNumber || au.serialNumber || null,
            name: au.name || cu.name,
            role: cu.role === 'admin' || au.role === 'admin' ? 'admin' : 'user',
            status: au.status === 'suspended' || cu.status === 'suspended' ? 'suspended' : 'active',
            suspendReason: au.suspendReason || cu.suspendReason || null,
            reviewsCount: Math.max(au.reviewsCount, cu.reviewsCount),
            votesCount: Math.max(au.votesCount, cu.votesCount),
            completedOrdersCount: Math.max(au.completedOrdersCount, cu.completedOrdersCount),
            lastActiveAt: au.lastActiveAt || cu.lastActiveAt,
          });
        } else {
          nextApiIdMap[au.id] = au.id;
          mergedMap.set(au.id, au);
        }
      }

      setApiIdByUserId(nextApiIdMap);

      const needle = q.trim().toLowerCase();
      const merged = Array.from(mergedMap.values())
        .filter((u) => {
          if (roleFilter !== 'all' && u.role !== roleFilter) return false;
          if (statusFilter !== 'all' && u.status !== statusFilter) return false;
          if (!needle) return true;
          return (
            u.name.toLowerCase().includes(needle) ||
            u.email.toLowerCase().includes(needle) ||
            (u.serialNumber || '').toLowerCase().includes(needle)
          );
        })
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

      setUsers(merged);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تحميل المستخدمين.');
    } finally {
      setLoading(false);
    }
  }, [q, roleFilter, statusFilter, onNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadUsers();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  const handleToggleSuspend = async (user: AdminUserItem) => {
    if (user.status === 'active') {
      setSuspendingUser(user);
      setSuspendReason('');
      return;
    }
    try {
      const apiTargetId = apiIdByUserId[user.id] || user.id;
      await updateUserAdminCloud(user.id, { status: 'active' });
      await api.adminUpdateUser(apiTargetId, { status: 'active' }).catch(() => {});
      onNotice(`تم تفعيل حساب ${user.name} بنجاح.`);
      loadUsers();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const confirmSuspend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendingUser) return;
    try {
      const apiTargetId = apiIdByUserId[suspendingUser.id] || suspendingUser.id;
      await updateUserAdminCloud(suspendingUser.id, { status: 'suspended' });
      await api
        .adminUpdateUser(apiTargetId, {
          status: 'suspended',
          suspendReason: suspendReason.trim() || 'مخالفة شروط الاستخدام',
        })
        .catch(() => {});
      onNotice(`تم إيقاف حساب ${suspendingUser.name}.`);
      setSuspendingUser(null);
      loadUsers();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر إيقاف الحساب.');
    }
  };

  const handleConfirmRoleChange = async () => {
    if (!confirmRoleUser) return;
    try {
      const apiTargetId = apiIdByUserId[confirmRoleUser.user.id] || confirmRoleUser.user.id;
      await updateUserAdminCloud(confirmRoleUser.user.id, { role: confirmRoleUser.nextRole });
      await api
        .adminUpdateUser(apiTargetId, { role: confirmRoleUser.nextRole })
        .catch(() => {});
      onNotice(`تم تعديل صلاحية ${confirmRoleUser.user.name}.`);
      setConfirmRoleUser(null);
      loadUsers();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تعديل الصلاحية.');
    }
  };

  const openActivity = async (id: string) => {
    try {
      const apiTargetId = apiIdByUserId[id] || id;
      const [apiRes, cloudActs] = await Promise.all([
        api.adminUserActivity(apiTargetId).catch(() => null),
        fetchUserActivitiesCloud(id).catch(() => []),
      ]);
      const baseUser = apiRes?.user || users.find((u) => u.id === id);
      if (!baseUser) {
        onNotice('تعذر العثور على بيانات المستخدم.');
        return;
      }
      const combinedMap = new Map<string, NonNullable<typeof apiRes>['activities'][number]>();
      for (const ca of cloudActs) combinedMap.set(ca.id, ca);
      for (const aa of apiRes?.activities || []) combinedMap.set(aa.id, aa);

      setActivityModal({
        user: baseUser,
        reviews: apiRes?.reviews || [],
        votes: apiRes?.votes || [],
        orders: apiRes?.orders || [],
        toolRuns: apiRes?.toolRuns || [],
        activities: Array.from(combinedMap.values()).sort(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
        ),
      });
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تحميل نشاط المستخدم.');
    }
  };

  return (
    <div className="clay-card p-4 sm:p-6 space-y-4 text-xs font-ios" data-testid="admin-users-tab">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-600" />
          <h2 className="text-base font-black font-decorative text-slate-900">
            إدارة حسابات الطلاب والمشتركين ({users.length})
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <input
              type="text"
              data-testid="admin-users-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث بالرقم التسلسلي (CRV-1001) أو الاسم أو البريد..."
              className="pl-3 pr-8 py-2 rounded-xl clay-inset border-none outline-none min-w-[230px]"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
          >
            <option value="all">كل الصلاحيات</option>
            <option value="user">طالب</option>
            <option value="admin">مدير</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
          >
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="suspended">موقوف</option>
          </select>
        </div>
      </div>

      {loading && users.length === 0 ? (
        <div className="p-6 rounded-2xl clay-inset text-center text-slate-500">جاري التحميل...</div>
      ) : users.length === 0 ? (
        <div className="p-6 rounded-2xl clay-inset text-center text-slate-500">
          لا توجد حسابات مطابقة حالياً.
        </div>
      ) : (
        <div className="space-y-2.5">
          {users.map((u) => (
            <div
              key={u.id}
              data-testid={`admin-user-${u.id}`}
              className="clay-inset p-3.5 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {u.serialNumber && (
                    <span
                      data-testid={`user-serial-${u.id}`}
                      dir="ltr"
                      className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-[10px] font-mono font-black tracking-wide"
                    >
                      {u.serialNumber}
                    </span>
                  )}
                  <span className="font-black text-slate-900">{u.name}</span>
                  <span className="font-mono text-indigo-700" dir="ltr">
                    {u.email}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-white text-[10px] font-bold">
                    {u.grade === 'bac2' ? 'تانية بكالوريا' : 'أولى بكالوريا'}
                  </span>
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

                <div className="text-[11px] text-slate-500 flex flex-wrap gap-3 font-mono">
                  <span>تقييمات: {u.reviewsCount}</span>
                  <span>أصوات: {u.votesCount}</span>
                  <span>اشتراكات مكتملة: {u.completedOrdersCount}</span>
                  {u.suspendReason && u.status === 'suspended' && (
                    <span className="text-rose-600 font-bold">السبب: {u.suspendReason}</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
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
              </div>
            </div>
          ))}
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
                    act.grade === 'bac1' ? 'أولى بكالوريا' : act.grade === 'bac2' ? 'تانية بكالوريا' : act.grade,
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
              <div className="font-bold text-indigo-700">التقييمات ({activityModal.reviews.length})</div>
              {activityModal.reviews.map((r) => (
                <div key={r.id} className="text-[11px]">
                  ★ {r.rating} — {r.content}
                </div>
              ))}
              {activityModal.reviews.length === 0 && <div className="text-slate-500">لا يوجد.</div>}
            </div>
            <div className="p-3 rounded-xl clay-inset space-y-1">
              <div className="font-bold text-indigo-700">أصوات الاستفتاءات ({activityModal.votes.length})</div>
              {activityModal.votes.map((v, i) => (
                <div key={i} className="text-[11px] flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-indigo-600" />
                  <span>{v.question} ← {v.optionKey}</span>
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
