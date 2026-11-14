import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Download, Lock, Plus, RotateCcw, Unlock } from 'lucide-react';
import { AdminPollItem, api } from '../../utils/api';

interface AdminPollsTabProps {
  onNotice: (msg: string) => void;
  onConfigUpdated: () => void;
}

export const AdminPollsTab: React.FC<AdminPollsTabProps> = ({ onNotice, onConfigUpdated }) => {
  const [polls, setPolls] = useState<AdminPollItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [newQuestion, setNewQuestion] = useState('');
  const [newOpt1, setNewOpt1] = useState('');
  const [newOpt2, setNewOpt2] = useState('');
  const [newOpt3, setNewOpt3] = useState('');
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);

  const loadPolls = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminPolls();
      setPolls(res.polls);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تحميل الاستفتاءات.');
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    loadPolls();
  }, [loadPolls]);

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    const opts = [newOpt1, newOpt2, newOpt3].map((s) => s.trim()).filter(Boolean);
    if (opts.length < 2) {
      onNotice('اكتب خيارين على الأقل للاستفتاء.');
      return;
    }
    try {
      await api.adminCreatePoll({ question: newQuestion, options: opts });
      setNewQuestion('');
      setNewOpt1('');
      setNewOpt2('');
      setNewOpt3('');
      onNotice('تم إنشاء الاستفتاء ونشره بنجاح.');
      onConfigUpdated();
      loadPolls();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر إنشاء الاستفتاء.');
    }
  };

  const handleToggleOpen = async (poll: AdminPollItem) => {
    try {
      await api.adminUpdatePoll(poll.id, { isOpen: !poll.isOpen });
      onNotice(poll.isOpen ? 'تم إغلاق التصويت.' : 'تم فتح التصويت.');
      onConfigUpdated();
      loadPolls();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const handleReset = async (id: string) => {
    try {
      await api.adminResetPoll(id);
      setConfirmResetId(null);
      onNotice('تم تصفير أصوات الاستفتاء بنجاح.');
      loadPolls();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر التصفير.');
    }
  };

  const handleExportJson = async (poll: AdminPollItem) => {
    try {
      const data = await api.adminExportPollJson(poll.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `poll-${poll.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر التصدير.');
    }
  };

  const handleExportCsv = (poll: AdminPollItem) => {
    const header = 'option_key,label,votes,percent';
    const lines = poll.options.map(
      (o) => `${o.key},"${o.label.replace(/"/g, '""')}",${o.votes},${o.percent}%`
    );
    const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poll-${poll.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 text-xs font-ios" data-testid="admin-polls-tab">
      {/* Create New Poll */}
      <form onSubmit={handleCreatePoll} className="clay-card p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2 font-black font-decorative text-sm text-slate-900">
          <Plus className="w-4 h-4 text-indigo-600" />
          <span>إنشاء استفتاء جديد (يظهر تلقائياً في الموقع)</span>
        </div>

        <input
          type="text"
          required
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          placeholder="السؤال — مثال: تحبوا نضيف شروحات فيديو لبايثون؟"
          className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            required
            value={newOpt1}
            onChange={(e) => setNewOpt1(e.target.value)}
            placeholder="الخيار الأول (إلزامي)"
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none"
          />
          <input
            type="text"
            required
            value={newOpt2}
            onChange={(e) => setNewOpt2(e.target.value)}
            placeholder="الخيار الثاني (إلزامي)"
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none"
          />
          <input
            type="text"
            value={newOpt3}
            onChange={(e) => setNewOpt3(e.target.value)}
            placeholder="خيار ثالث (اختياري)"
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none"
          />
        </div>

        <button
          type="submit"
          className="clay-apple-blue px-4 py-2 rounded-xl font-bold text-white flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>نشر الاستفتاء</span>
        </button>
      </form>

      {/* Polls List */}
      <div className="space-y-3">
        {loading && polls.length === 0 ? (
          <div className="clay-card p-6 text-center text-slate-500">جاري تحميل الاستفتاءات...</div>
        ) : (
          polls.map((poll) => (
            <div key={poll.id} className="clay-card p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-sm sm:text-base font-black font-decorative text-slate-900">
                      {poll.question}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        poll.isOpen
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {poll.isOpen ? 'مفتوح' : 'مغلق'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    إجمالي الأصوات: {poll.totalVotes} صوت مسجّل بالحسابات
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleToggleOpen(poll)}
                    className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 ${
                      poll.isOpen ? 'clay-btn text-rose-600' : 'clay-apple-blue text-white'
                    }`}
                  >
                    {poll.isOpen ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    <span>{poll.isOpen ? 'إغلاق' : 'فتح'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportCsv(poll)}
                    className="clay-btn px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 text-indigo-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportJson(poll)}
                    className="clay-btn px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 text-purple-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>JSON</span>
                  </button>

                  {confirmResetId === poll.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleReset(poll.id)}
                        className="px-3 py-1.5 rounded-xl bg-rose-600 text-white font-bold"
                      >
                        تأكيد التصفير
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmResetId(null)}
                        className="clay-btn px-2.5 py-1.5 rounded-xl"
                      >
                        إلغاء
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmResetId(poll.id)}
                      className="clay-btn px-2.5 py-1.5 rounded-xl text-slate-600 flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>تصفير</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {poll.options.map((opt) => (
                  <div key={opt.key} className="p-2.5 rounded-xl clay-inset space-y-1">
                    <div className="flex items-center justify-between font-bold">
                      <span>{opt.label}</span>
                      <span className="font-mono text-indigo-700">
                        {opt.votes} صوت ({opt.percent}%)
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-l from-indigo-600 to-purple-500 rounded-full"
                        style={{ width: `${opt.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
