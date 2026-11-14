import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Play, Save, Zap } from 'lucide-react';
import { api, ToolServiceConfig, ToolVideoConfig } from '../../utils/api';

interface AdminToolTabProps {
  onNotice: (msg: string) => void;
  onConfigUpdated: () => void;
}

export const AdminToolTab: React.FC<AdminToolTabProps> = ({ onNotice, onConfigUpdated }) => {
  const [services, setServices] = useState<ToolServiceConfig[]>([]);
  const [videos, setVideos] = useState<ToolVideoConfig[]>([]);
  const [summary, setSummary] = useState<{
    totalRuns: number;
    succeededRuns: number;
    failedRuns: number;
    avgDurationMs: number;
  }>({ totalRuns: 0, succeededRuns: 0, failedRuns: 0, avgDurationMs: 0 });
  const [recentRuns, setRecentRuns] = useState<
    Array<{
      id: string;
      serviceKey: string;
      status: string;
      durationMs: number;
      errorMessage: string | null;
      createdAt: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  const loadTool = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminToolOverview();
      setServices(res.services);
      setVideos(res.videos);
      setSummary(res.summary);
      setRecentRuns(res.recentRuns);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تحميل إعدادات الأداة.');
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    loadTool();
  }, [loadTool]);

  const handleToggleService = async (svc: ToolServiceConfig) => {
    try {
      await api.adminUpdateToolService(svc.key, { isVisible: !svc.isVisible });
      onNotice(`تم تحديث ظهور خدمة: ${svc.name}`);
      onConfigUpdated();
      loadTool();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر التحديث.');
    }
  };

  const handleSaveServiceText = async (svc: ToolServiceConfig) => {
    try {
      await api.adminUpdateToolService(svc.key, {
        name: svc.name,
        description: svc.description,
      });
      onNotice(`تم حفظ بيانات ${svc.key}.`);
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر الحفظ.');
    }
  };

  const handleSaveVideos = async () => {
    try {
      await api.adminUpdateToolVideos(videos);
      onNotice('تم حفظ فيديوهات صفحة الأداة وتحديثها فوراً.');
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر حفظ الفيديوهات.');
    }
  };

  if (loading && services.length === 0) {
    return <div className="p-8 text-center text-xs text-slate-500 font-ios">جاري تحميل بيانات الأداة...</div>;
  }

  return (
    <div className="space-y-5 text-xs font-ios" data-testid="admin-tool-tab">
      {/* Services Visibility & Description Controls */}
      <div className="clay-card p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-indigo-600" />
          <h2 className="text-base font-black font-decorative">التحكم في خدمات الأداة</h2>
        </div>

        <div className="space-y-2.5">
          {services.map((svc, idx) => (
            <div key={svc.key} className="p-3.5 rounded-2xl clay-inset space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-bold text-indigo-700">{svc.key}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleService(svc)}
                    className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 ${
                      svc.isVisible ? 'clay-apple-blue text-white' : 'clay-btn text-slate-500'
                    }`}
                  >
                    {svc.isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    <span>{svc.isVisible ? 'ظاهرة في الموقع' : 'مخفية'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveServiceText(svc)}
                    className="clay-btn px-3 py-1.5 rounded-xl font-bold text-indigo-600 flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>حفظ النص</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={svc.name}
                  onChange={(e) =>
                    setServices((prev) =>
                      prev.map((s, i) => (i === idx ? { ...s, name: e.target.value } : s))
                    )
                  }
                  className="px-3 py-2 rounded-xl clay-card border-none outline-none font-bold"
                />
                <input
                  type="text"
                  value={svc.description}
                  onChange={(e) =>
                    setServices((prev) =>
                      prev.map((s, i) => (i === idx ? { ...s, description: e.target.value } : s))
                    )
                  }
                  className="px-3 py-2 rounded-xl clay-card border-none outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tool Videos Editor */}
      <div className="clay-card p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-purple-600" />
            <h2 className="text-base font-black font-decorative">إدارة الفيديوهات التوضيحية</h2>
          </div>
          <button
            type="button"
            onClick={handleSaveVideos}
            className="clay-apple-blue px-4 py-2 rounded-xl font-bold text-white flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>حفظ الفيديوهات</span>
          </button>
        </div>

        <div className="space-y-3">
          {videos.map((vid, idx) => (
            <div key={vid.id} className="p-3.5 rounded-2xl clay-inset space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-bold text-indigo-700">{vid.id}</span>
                <label className="flex items-center gap-1.5 font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={vid.visible}
                    onChange={(e) =>
                      setVideos((prev) =>
                        prev.map((v, i) => (i === idx ? { ...v, visible: e.target.checked } : v))
                      )
                    }
                  />
                  <span>عرض الفيديو للزوار</span>
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={vid.tag}
                  onChange={(e) =>
                    setVideos((prev) =>
                      prev.map((v, i) => (i === idx ? { ...v, tag: e.target.value } : v))
                    )
                  }
                  placeholder="الوسم"
                  className="px-3 py-2 rounded-xl clay-card border-none outline-none font-bold"
                />
                <input
                  type="text"
                  value={vid.title}
                  onChange={(e) =>
                    setVideos((prev) =>
                      prev.map((v, i) => (i === idx ? { ...v, title: e.target.value } : v))
                    )
                  }
                  placeholder="العنوان"
                  className="px-3 py-2 rounded-xl clay-card border-none outline-none font-bold"
                />
                <input
                  type="text"
                  dir="ltr"
                  value={vid.src}
                  onChange={(e) =>
                    setVideos((prev) =>
                      prev.map((v, i) => (i === idx ? { ...v, src: e.target.value } : v))
                    )
                  }
                  placeholder="/media/videos/..."
                  className="px-3 py-2 rounded-xl clay-card border-none outline-none font-mono text-left"
                />
              </div>
              <input
                type="text"
                value={vid.description}
                onChange={(e) =>
                  setVideos((prev) =>
                    prev.map((v, i) => (i === idx ? { ...v, description: e.target.value } : v))
                  )
                }
                placeholder="الوصف"
                className="w-full px-3 py-2 rounded-xl clay-card border-none outline-none"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Tool Run Stats & Errors Log */}
      <div className="clay-card p-4 sm:p-5 space-y-3">
        <h2 className="text-base font-black font-decorative">سجلات تشغيل الأداة والأخطاء</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
          <div className="p-3 rounded-xl clay-inset">إجمالي التشغيل: {summary.totalRuns}</div>
          <div className="p-3 rounded-xl clay-inset text-indigo-700">ناجحة: {summary.succeededRuns}</div>
          <div className="p-3 rounded-xl clay-inset text-rose-600">فاشلة: {summary.failedRuns}</div>
          <div className="p-3 rounded-xl clay-inset">متوسط الوقت: {Math.round((summary.avgDurationMs || 0) / 1000)}ث</div>
        </div>
        {recentRuns.length === 0 ? (
          <div className="p-4 rounded-xl clay-inset text-center text-slate-500">
            لا توجد سجلات تشغيل مسجّلة حتى الآن.
          </div>
        ) : (
          <div className="space-y-1.5">
            {recentRuns.slice(0, 20).map((run) => (
              <div
                key={run.id}
                className="p-2.5 rounded-xl clay-inset flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]"
              >
                <span>{run.serviceKey}</span>
                <span className={run.status === 'failed' ? 'text-rose-600 font-bold' : 'text-indigo-700'}>
                  {run.status} ({run.durationMs}ms)
                </span>
                {run.errorMessage && <span className="text-rose-600">{run.errorMessage}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
