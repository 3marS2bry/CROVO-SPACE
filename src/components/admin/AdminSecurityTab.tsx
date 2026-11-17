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

  const loadLogs = useCallback(async () => {
    try {
      const res = await api.adminAuditLogs();
      setLogs(res.logs);
    } catch {
      // Ignore transient error
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleBackup = async () => {
    if (creatingBackup) return;
    setCreatingBackup(true);
    try {
      const res = await api.adminCreateBackup();
      onNotice(`تم إنشاء نسخة احتياطية كاملة: ${res.backup.filename}`);
      onRefreshOverview();
      loadLogs();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر إنشاء النسخة الاحتياطية.');
    } finally {
      setCreatingBackup(false);
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
              حماية البيانات والنسخ الاحتياطي
            </h2>
          </div>

          <button
            type="button"
            disabled={creatingBackup}
            onClick={handleBackup}
            className="clay-apple-blue px-4 py-2 rounded-xl font-bold text-white flex items-center gap-1.5"
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>{creatingBackup ? 'جاري الإنشاء...' : 'نسخة احتياطية الآن'}</span>
          </button>
        </div>

        <div className="p-3 rounded-xl clay-inset flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold">فحص سلامة واستقرار التخزين:</span>
          <span className={`font-black font-mono ${dbIntegrity.ok ? 'text-indigo-700' : 'text-rose-600'}`}>
            {dbIntegrity.ok ? 'سليمة ✓ (OK)' : dbIntegrity.detail}
          </span>
        </div>

        <div className="p-3 rounded-xl clay-inset flex items-start gap-2 text-amber-800 font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{storageNotice}</span>
        </div>

        <div className="space-y-1.5">
          <div className="font-bold text-slate-600">النسخ الاحتياطية المحفوظة ({backups.length}):</div>
          {backups.length === 0 ? (
            <div className="p-3 rounded-xl clay-inset text-slate-500">لا توجد نسخ محفوظة بعد.</div>
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
