import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Database, HardDrive, ShieldCheck } from 'lucide-react';
import { AdminAuditLogItem, api } from '../../utils/api';

interface AdminSecurityTabProps {
  dbIntegrity: { ok: boolean; detail: string };
  backups: Array<{ filename: string; sizeBytes: number; createdAt: string }>;
  storageNotice: string;
  onNotice: (msg: string) => void;
  onRefreshOverview: () => void;
}

export const AdminSecurityTab: React.FC<AdminSecurityTabProps> = ({
  dbIntegrity,
  backups,
  storageNotice,
  onNotice,
  onRefreshOverview,
}) => {
  const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [syncingLegacy, setSyncingLegacy] = useState(false);

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

  const handleBackup = async () => {
    if (creatingBackup) return;
    setCreatingBackup(true);
    try {
      const res = await api.adminCreateBackup();
      if (res.snapshot) {
        const blob = new Blob([JSON.stringify(res.snapshot, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.backup.filename || `crovo-firestore-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
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

  return (
    <div className="space-y-5 text-xs font-ios" data-testid="admin-security-tab">
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
            {dbIntegrity.ok ? 'متصل وسليم ✓ (Firestore OK)' : dbIntegrity.detail}
          </span>
        </div>

        <div className="p-3 rounded-xl clay-inset flex items-start gap-2 text-indigo-800 font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600" />
          <span>{storageNotice}</span>
        </div>

        <div className="space-y-1.5">
          <div className="font-bold text-slate-600">سجل النسخ المُصدّرة ({backups.length}):</div>
          {backups.length === 0 ? (
            <div className="p-3 rounded-xl clay-inset text-slate-500">لا توجد نسخ مُصدّرة بعد. اضغط «تصدير نسخة احتياطية JSON» لتحميل نسخة كاملة فوراً.</div>
          ) : (
            backups.map((b) => (
              <div
                key={b.filename}
                className="p-2.5 rounded-xl clay-inset flex items-center justify-between font-mono text-[11px]"
              >
                <span>{b.filename}</span>
                <span>{Math.round(b.sizeBytes / 1024)} KB</span>
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
