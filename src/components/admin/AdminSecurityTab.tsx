import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Database,
  Download,
  HardDrive,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { AdminAuditLogItem, api, DbStatusState, LiveMigrationResponse } from '../../utils/api';

interface AdminSecurityTabProps {
  dbIntegrity: { ok: boolean; detail: string; counts?: Record<string, number> };
  backups: Array<{
    filename: string;
    reason?: string;
    actor?: string;
    sizeBytes: number;
    createdAt: string;
  }>;
  migrations?: Array<{
    id: string;
    version: string;
    status: string;
    actor: string;
    appliedAt: string;
  }>;
  dbStatus?: DbStatusState;
  dbError?: string | null;
  storageNotice: string;
  onNotice: (msg: string) => void;
  onRefreshOverview: () => void;
}

export const AdminSecurityTab: React.FC<AdminSecurityTabProps> = ({
  dbIntegrity,
  backups,
  migrations = [],
  dbStatus,
  dbError,
  storageNotice,
  onNotice,
  onRefreshOverview,
}) => {
  const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [syncingLegacy, setSyncingLegacy] = useState(false);

  // Live published migration state
  const [remoteUrl, setRemoteUrl] = useState('https://crovo-space.ai.studio');
  const [remoteUsername, setRemoteUsername] = useState('');
  const [remotePassword, setRemotePassword] = useState('');
  const [pulledSnapshot, setPulledSnapshot] = useState<Record<string, unknown> | null>(null);
  const [snapshotSourceLabel, setSnapshotSourceLabel] = useState('');
  const [migrationPreview, setMigrationPreview] = useState<LiveMigrationResponse | null>(null);
  const [pullingRemote, setPullingRemote] = useState(false);
  const [applyingMerge, setApplyingMerge] = useState(false);

  const loadLogs = useCallback(async () => {
    try {
      const res = await api.adminAuditLogs();
      setLogs(res.logs);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تحميل سجل الإجراءات.');
    }
  }, [onNotice]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const downloadJsonObject = (obj: Record<string, unknown>, filename: string) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBackup = async () => {
    if (creatingBackup) return;
    setCreatingBackup(true);
    try {
      const res = await api.adminCreateBackup();
      if (res.snapshot) {
        downloadJsonObject(
          res.snapshot,
          res.backup.filename || `crovo-firestore-backup-${Date.now()}.json`
        );
      }
      onNotice(`تم تصدير نسخة احتياطية كاملة من Firestore: ${res.backup.filename}`);
      onRefreshOverview();
      loadLogs();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر إنشاء النسخة الاحتياطية.');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleMigrateLegacy = async () => {
    if (syncingLegacy) return;
    setSyncingLegacy(true);
    try {
      const res = await api.adminMigrateLegacy();
      const total = Object.values(res.seeded || {}).reduce((a, b) => a + b, 0);
      onNotice(`تم توحيد ومزامنة البيانات الافتراضية والمكتبة مع Firestore بنجاح (${total} سجل).`);
      onRefreshOverview();
      loadLogs();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر مزامنة البيانات مع Firestore.');
    } finally {
      setSyncingLegacy(false);
    }
  };

  const handlePullRemotePreview = async () => {
    if (pullingRemote) return;
    if (!remoteUsername.trim() || !remotePassword) {
      onNotice('اكتب اسم المستخدم وكلمة مرور الإدارة الخاصة بالنسخة المنشورة أولاً.');
      return;
    }
    setPullingRemote(true);
    try {
      const res = await api.adminImportLiveMigration({
        mode: 'pull_remote',
        dryRun: true,
        remoteUrl: remoteUrl.trim() || 'https://crovo-space.ai.studio',
        remoteUsername: remoteUsername.trim(),
        remotePassword,
      });
      setMigrationPreview(res);
      if (res.exportedSnapshot) {
        setPulledSnapshot(res.exportedSnapshot);
        setSnapshotSourceLabel(res.sourceLabel);
      }
      onNotice(
        `تم سحب المعاينة من ${res.sourceLabel} بنجاح (${res.remoteCounts.users} مستخدم، ${res.remoteCounts.toolLikes} إعجاب، ${res.remoteCounts.totalQuestionCopies} نسخ أسئلة). راجع الأرقام وحمّل نسخة الأمان قبل تطبيق الدمج.`
      );
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر سحب البيانات من النسخة المنشورة.');
    } finally {
      setPullingRemote(false);
    }
  };

  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPullingRemote(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const res = await api.adminImportLiveMigration({
        mode: 'import_snapshot',
        dryRun: true,
        snapshot: parsed,
        sourceLabel: file.name,
      });
      setPulledSnapshot(parsed);
      setSnapshotSourceLabel(file.name);
      setMigrationPreview(res);
      onNotice(`تم تحليل ملف النسخة الاحتياطية (${file.name}) بنجاح. راجع المعاينة ثم أكّد الدمج.`);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'ملف JSON غير صالح أو تعذر قراءته.');
    } finally {
      setPullingRemote(false);
    }
  };

  const handleApplySafeMerge = async () => {
    if (applyingMerge) return;
    if (!pulledSnapshot && (!remoteUsername.trim() || !remotePassword)) {
      onNotice('اسحب المعاينة أو ارفع ملف JSON أولاً قبل تأكيد الدمج.');
      return;
    }
    setApplyingMerge(true);
    try {
      const res = pulledSnapshot
        ? await api.adminImportLiveMigration({
            mode: 'import_snapshot',
            dryRun: false,
            snapshot: pulledSnapshot,
            sourceLabel: snapshotSourceLabel || remoteUrl,
          })
        : await api.adminImportLiveMigration({
            mode: 'pull_remote',
            dryRun: false,
            remoteUrl: remoteUrl.trim() || 'https://crovo-space.ai.studio',
            remoteUsername: remoteUsername.trim(),
            remotePassword,
          });
      setMigrationPreview(res);
      onNotice(
        `اكتمل الدمج الآمن في Firestore: +${res.applied.created} سجل جديد، و${res.applied.mergedOrUpdated} تحديث لأعلى رقم، و${res.applied.skippedExisting} موجود مسبقاً بدون أي حذف.`
      );
      onRefreshOverview();
      loadLogs();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ الدمج في Firestore.');
    } finally {
      setApplyingMerge(false);
    }
  };

  return (
    <div className="space-y-5 text-xs font-ios" data-testid="admin-security-tab">
      {/* Zero-Loss Pre-Publish Migration Card */}
      <div className="clay-card p-4 sm:p-5 space-y-4 border border-amber-300/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CloudDownload className="w-4 h-4 text-amber-600" />
            <h2 className="text-base font-black font-decorative text-slate-900">
              الخطوة الإلزامية قبل إعادة النشر: سحب ودمج بيانات النسخة المنشورة إلى Firestore
            </h2>
          </div>
          <span className="font-mono text-[10px] font-bold px-2.5 py-1 rounded-lg clay-inset text-amber-800">
            بدون حذف أو مسح (Additive + Max Merge)
          </span>
        </div>

        <div className="p-3 rounded-xl clay-inset text-slate-700 leading-relaxed font-semibold">
          النسخة المنشورة حالياً على <span className="font-mono text-indigo-700">crovo-space.ai.studio</span> ما زالت تحتفظ ببيانات SQLite (أكثر من 300 عميل، الطلبات، الزيارات، التعليقات، نسخ الأسئلة، والإعجابات).
          اسحب البيانات من هنا أولاً وادمجها في Cloud Firestore <span className="font-black text-slate-900">قبل الضغط على Publish / Deploy</span> حتى لا تُفقد أي بيانات قديمة.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="block font-bold text-slate-700">رابط النسخة المنشورة</label>
            <input
              type="url"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              dir="ltr"
              placeholder="https://crovo-space.ai.studio"
              className="w-full px-3 py-2 rounded-xl clay-inset text-slate-800 font-mono text-[11px] focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="block font-bold text-slate-700">اسم مستخدم الإدارة (في المنشورة)</label>
            <input
              type="text"
              value={remoteUsername}
              onChange={(e) => setRemoteUsername(e.target.value)}
              dir="ltr"
              autoComplete="off"
              placeholder="Admin username"
              className="w-full px-3 py-2 rounded-xl clay-inset text-slate-800 font-mono text-[11px] focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="block font-bold text-slate-700">كلمة مرور الإدارة (لا تُحفظ إطلاقاً)</label>
            <input
              type="password"
              value={remotePassword}
              onChange={(e) => setRemotePassword(e.target.value)}
              dir="ltr"
              autoComplete="new-password"
              placeholder="••••••••"
              className="w-full px-3 py-2 rounded-xl clay-inset text-slate-800 font-mono text-[11px] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={pullingRemote || applyingMerge}
            onClick={handlePullRemotePreview}
            data-testid="pull-live-preview-btn"
            className="clay-apple-blue px-4 py-2.5 rounded-xl font-bold text-white flex items-center gap-1.5"
          >
            <CloudDownload className="w-4 h-4" />
            <span>{pullingRemote ? 'جاري السحب والمعاينة...' : '1. سحب ومعاينة البيانات من النسخة المنشورة'}</span>
          </button>

          <label className="clay-btn px-3.5 py-2.5 rounded-xl font-bold text-indigo-700 flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-4 h-4" />
            <span>أو استيراد ملف نسخة JSON جاهز</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleJsonUpload}
              className="hidden"
            />
          </label>

          {pulledSnapshot && (
            <button
              type="button"
              onClick={() =>
                downloadJsonObject(
                  pulledSnapshot,
                  `crovo-live-pulled-safety-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
                )
              }
              className="clay-btn px-3.5 py-2.5 rounded-xl font-bold text-emerald-700 flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>تحميل نسخة أمان JSON المسحوبة</span>
            </button>
          )}
        </div>

        {migrationPreview && (
          <div className="p-3.5 rounded-2xl clay-inset space-y-3" data-testid="migration-preview-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-black text-slate-800">
                مقارنة البيانات قبل الدمج — المصدر: <span className="font-mono text-indigo-700">{migrationPreview.sourceLabel}</span>
              </div>
              <span className="font-mono text-[10px] font-bold text-slate-500">
                {migrationPreview.dryRun ? 'معاينة فقط (لم يتم التعديل بعد)' : 'تم التنفيذ الفعلي ✓'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[
                {
                  label: 'العملاء المسجلين',
                  remote: migrationPreview.remoteCounts.users,
                  local: migrationPreview.currentFirestoreCounts.users,
                },
                {
                  label: 'الطلبات',
                  remote: migrationPreview.remoteCounts.orders,
                  local: migrationPreview.currentFirestoreCounts.orders,
                },
                {
                  label: 'التعليقات',
                  remote: migrationPreview.remoteCounts.comments,
                  local: migrationPreview.currentFirestoreCounts.comments,
                },
                {
                  label: 'إعجابات الأداة',
                  remote: migrationPreview.remoteCounts.toolLikes,
                  local: migrationPreview.currentFirestoreCounts.toolLikes,
                },
                {
                  label: 'إجمالي نسخ الأسئلة',
                  remote: migrationPreview.remoteCounts.totalQuestionCopies,
                  local: migrationPreview.currentFirestoreCounts.totalQuestionCopies,
                },
                {
                  label: 'الزيارات المرصودة',
                  remote: migrationPreview.remoteCounts.totalVisits,
                  local: migrationPreview.currentFirestoreCounts.dailyAnalyticsDays,
                  localSuffix: ' يوم',
                },
                {
                  label: 'اشتراكات الإشعارات',
                  remote: migrationPreview.remoteCounts.pushSubscriptions,
                  local: migrationPreview.currentFirestoreCounts.pushSubscriptions,
                },
                {
                  label: 'أصوات الاستفتاء',
                  remote: `${migrationPreview.remoteCounts.polls} استفتاء`,
                  local: `${migrationPreview.currentFirestoreCounts.pollVotes} صوت`,
                },
              ].map((stat) => (
                <div key={stat.label} className="p-2.5 rounded-xl bg-white/60 space-y-1">
                  <div className="text-[10px] font-bold text-slate-500">{stat.label}</div>
                  <div className="font-mono font-black text-indigo-700 text-xs">
                    المنشورة: {stat.remote}
                  </div>
                  <div className="font-mono text-[10px] text-slate-600">
                    Firestore حالياً: {stat.local}
                    {'localSuffix' in stat && stat.localSuffix ? stat.localSuffix : ''}
                  </div>
                </div>
              ))}
            </div>

            {migrationPreview.dryRun ? (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-[11px] font-bold text-slate-600">
                  يُضاف كل سجل مفقود وتُحفظ أعلى قيمة للعدادات (Math.max) دون المساس بأي بيانات حالية في Firestore.
                </span>
                <button
                  type="button"
                  disabled={applyingMerge}
                  onClick={handleApplySafeMerge}
                  data-testid="apply-safe-merge-btn"
                  className="clay-apple-blue px-4 py-2.5 rounded-xl font-black text-white flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{applyingMerge ? 'جاري الدمج في Firestore...' : '2. تأكيد الدمج الآمن في Firestore'}</span>
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-1">
                <div className="font-black">
                  نتيجة الدمج الفعلي في Firestore: +{migrationPreview.applied.created} سجل جديد،{' '}
                  {migrationPreview.applied.mergedOrUpdated} تحديث عدادات/أرقام،{' '}
                  {migrationPreview.applied.skippedExisting} موجود مسبقاً،{' '}
                  {migrationPreview.applied.errors} أخطاء.
                </div>
                {migrationPreview.applied.errorSamples.length > 0 && (
                  <div className="font-mono text-[10px] text-rose-700 break-all">
                    {migrationPreview.applied.errorSamples.join(' | ')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Database Health & Backups */}
      <div className="clay-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-600" />
            <h2 className="text-base font-black font-decorative">
              قاعدة بيانات Firestore الموحدة والنسخ الاحتياطي
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={syncingLegacy}
              onClick={handleMigrateLegacy}
              className="clay-btn px-3.5 py-2 rounded-xl font-bold text-indigo-700 flex items-center gap-1.5"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{syncingLegacy ? 'جاري المزامنة...' : 'توحيد ومزامنة المكتبة والإعدادات مع Firestore'}</span>
            </button>

            <button
              type="button"
              disabled={creatingBackup}
              onClick={handleBackup}
              className="clay-apple-blue px-4 py-2 rounded-xl font-bold text-white flex items-center gap-1.5"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>{creatingBackup ? 'جاري التصدير...' : 'تصدير نسخة احتياطية JSON'}</span>
            </button>
          </div>
        </div>

        <div className="p-3 rounded-xl clay-inset flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold">فحص اتصال وسلامة Cloud Firestore:</span>
          <span className={`font-black font-mono ${dbIntegrity.ok ? 'text-indigo-700' : 'text-rose-600'}`}>
            {dbIntegrity.ok ? dbIntegrity.detail || 'متصل وسليم ✓ (Firestore OK)' : dbIntegrity.detail}
          </span>
        </div>

        {(dbStatus === 'quota_exceeded' || dbError) && (
          <div className="p-3 rounded-xl clay-inset border border-rose-200 text-rose-800 space-y-1">
            <div className="font-black">
              {dbStatus === 'quota_exceeded'
                ? 'تم بلوغ الحد اليومي المجاني للقراءة في Firestore (Spark Plan Quota).'
                : 'تنبيه حالة قاعدة البيانات:'}
            </div>
            {dbError && <div className="text-[11px] font-semibold">{dbError}</div>}
          </div>
        )}

        <div className="p-3 rounded-xl clay-inset flex items-start gap-2 text-indigo-800 font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600" />
          <span>{storageNotice}</span>
        </div>

        <div className="space-y-1.5">
          <div className="font-bold text-slate-600">
            سجل النسخ الاحتياطية والنسخ التلقائية قبل التعديلات ({backups.length}):
          </div>
          {backups.length === 0 ? (
            <div className="p-3 rounded-xl clay-inset text-slate-500">
              لا توجد نسخ محفوظة بعد. يتم إنشاء نسخة تلقائية قبل أي تغيير حساس أو عند الضغط على «تصدير نسخة احتياطية JSON».
            </div>
          ) : (
            backups.map((b) => (
              <div
                key={b.filename}
                className="p-2.5 rounded-xl clay-inset flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-800">{b.filename}</span>
                  {b.reason && (
                    <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                      {b.reason}
                    </span>
                  )}
                  {b.actor && <span className="text-[10px] text-slate-500">({b.actor})</span>}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-600">
                  <span>{b.createdAt.replace('T', ' ').slice(0, 19)}</span>
                  <span>{Math.max(1, Math.round(b.sizeBytes / 1024))} KB</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-1.5 pt-2">
          <div className="font-bold text-slate-600">
            سجل الترحيل الآمن غير المدمّر (Versioned Migrations: {migrations.length}):
          </div>
          {migrations.length === 0 ? (
            <div className="p-3 rounded-xl clay-inset text-slate-500">
              لم يتم تسجيل عمليات ترحيل جديدة بعد — كافة المجموعات محمية بنظام عدم الكتابة فوق الموجود.
            </div>
          ) : (
            migrations.map((m) => (
              <div
                key={m.id}
                className="p-2.5 rounded-xl clay-inset flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-indigo-700">{m.id}</span>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    {m.status} · {m.version}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500">
                  {m.actor} · {m.appliedAt.replace('T', ' ').slice(0, 19)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Audit Log */}
      <div className="clay-card p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-600" />
          <h2 className="text-base font-black font-decorative">
            سجل الإجراءات الإدارية (Audit Log)
          </h2>
        </div>

        {logs.length === 0 ? (
          <div className="p-4 rounded-xl clay-inset text-center text-slate-500">
            لا توجد سجلات إدارية مسجّلة حتى الآن.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {logs.map((log) => (
              <div
                key={log.id}
                className="p-2.5 rounded-xl clay-inset flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold text-indigo-700">{log.action}</span>
                  <span className="text-slate-600">({log.targetType})</span>
                  <span className="font-bold text-slate-800">بواسطة: {log.actorUsername}</span>
                </div>
                <span className="font-mono text-slate-500 text-[10px]">
                  {log.createdAt.replace('T', ' ').slice(0, 19)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
