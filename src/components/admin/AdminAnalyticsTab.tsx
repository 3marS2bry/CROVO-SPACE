import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Calendar,
  Heart,
  Search,
  ShoppingBag,
  Users,
  Zap,
} from 'lucide-react';
import { AdminAnalyticsResponse, api } from '../../utils/api';

interface AdminAnalyticsTabProps {
  initialData?: AdminAnalyticsResponse;
}

function DeltaBadge({ current, prev }: { current: number; prev: number }) {
  if (prev === 0 && current === 0) {
    return <span className="text-[10px] font-mono text-slate-400">0% مقابل الفترة السابقة</span>;
  }
  if (prev === 0) {
    return <span className="text-[10px] font-mono font-bold text-indigo-600">جديد ({current}+)</span>;
  }
  const diffPct = Math.round(((current - prev) / prev) * 100);
  return (
    <span
      className={`text-[10px] font-mono font-bold ${
        diffPct >= 0 ? 'text-indigo-600' : 'text-rose-600'
      }`}
    >
      {diffPct >= 0 ? `+${diffPct}%` : `${diffPct}%`} مقابل الفترة السابقة
    </span>
  );
}

export const AdminAnalyticsTab: React.FC<AdminAnalyticsTabProps> = ({ initialData }) => {
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'year' | 'custom'>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(initialData || null);
  const [loading, setLoading] = useState(false);

  const loadAnalytics = useCallback(
    async (nextRange = range, f = customFrom, t = customTo) => {
      setLoading(true);
      try {
        const res = await api.adminAnalytics(
          nextRange,
          nextRange === 'custom' && f ? new Date(f).toISOString() : undefined,
          nextRange === 'custom' && t ? new Date(t + 'T23:59:59').toISOString() : undefined
        );
        setAnalytics(res);
      } catch {
        // Keep previous snapshot cleanly
      } finally {
        setLoading(false);
      }
    },
    [range, customFrom, customTo]
  );

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const timeline = analytics?.timeline || [];
  const maxVal = Math.max(1, ...timeline.map((d) => Math.max(d.visits, d.libraryOpens, 1)));

  return (
    <div className="space-y-5 text-xs font-ios" data-testid="admin-analytics-tab">
      {/* Period Selector */}
      <div className="clay-card p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['today', 'اليوم'],
              ['7d', 'آخر 7 أيام'],
              ['30d', 'آخر 30 يوم'],
              ['year', 'السنة'],
              ['custom', 'فترة مخصصة'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setRange(key);
                if (key !== 'custom') loadAnalytics(key);
              }}
              className={`px-3 py-1.5 rounded-full font-bold transition-transform ${
                range === key ? 'clay-pill-active' : 'clay-btn text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {range === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2.5 py-1 rounded-xl clay-inset border-none outline-none font-mono"
              />
              <span className="text-slate-400">إلى</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2.5 py-1 rounded-xl clay-inset border-none outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => loadAnalytics('custom', customFrom, customTo)}
                className="clay-apple-blue px-3 py-1.5 rounded-xl font-bold text-white"
              >
                تطبيق
              </button>
            </>
          )}
          {analytics?.trackingStartedAt && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full clay-inset text-[10px] font-bold text-slate-600">
              <Calendar className="w-3 h-3 text-indigo-500" />
              <span>بداية القياس الفعلي: {analytics.trackingStartedAt.slice(0, 10)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Top Real KPIs Grid */}
      <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${loading ? 'opacity-70' : ''}`}>
        <div className="clay-card p-4 space-y-1">
          <div className="flex items-center justify-between text-slate-500 font-bold">
            <span>إجمالي الزيارات</span>
            <Activity className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-900">
            {analytics?.visitors?.totalVisits ?? 0}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 font-mono">
              زوار فريدون: {analytics?.visitors?.uniqueVisitors ?? 0}
            </span>
            {analytics?.visitors && (
              <DeltaBadge
                current={analytics.visitors.totalVisits ?? 0}
                prev={analytics.visitors.prevTotalVisits ?? 0}
              />
            )}
          </div>
        </div>

        <div className="clay-card p-4 space-y-1">
          <div className="flex items-center justify-between text-slate-500 font-bold">
            <span>الحسابات المسجّلة</span>
            <Users className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-black font-mono text-indigo-700">
            {analytics?.users?.totalRegistered ?? 0}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 font-mono">
              نشطون: {analytics?.users?.activeUsers ?? 0}
            </span>
            {analytics?.users && (
              <DeltaBadge
                current={analytics.users.newInPeriod ?? 0}
                prev={analytics.users.prevNewInPeriod ?? 0}
              />
            )}
          </div>
        </div>

        <div className="clay-card p-4 space-y-1">
          <div className="flex items-center justify-between text-slate-500 font-bold">
            <span>المشتركون المكتملون</span>
            <ShoppingBag className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-2xl font-black font-mono text-slate-900">
            {analytics?.users?.completedSubscribers ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            إجمالي الطلبات المسجّلة: {analytics?.users?.totalOrders ?? 0}
          </div>
        </div>

        <div className="clay-card p-4 space-y-1">
          <div className="flex items-center justify-between text-slate-500 font-bold">
            <span>تفاعل المكتبة والنسخ</span>
            <BookOpen className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-black font-mono text-indigo-700">
            {analytics?.library?.totalCopies ?? 0}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            فتح المكتبة: {analytics?.library?.opens ?? 0} · بحث: {analytics?.library?.searches ?? 0}
          </div>
        </div>
      </div>

      {/* SVG Real Timeline Chart */}
      <div className="clay-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm sm:text-base font-black font-decorative text-slate-900">
              النشاط اليومي الفعلي (الزيارات vs فتح المكتبة والبحث)
            </h2>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-bold">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-600 inline-block" /> الزيارات
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-purple-400 inline-block" /> المكتبة والبحث
            </span>
          </div>
        </div>

        {timeline.length === 0 ? (
          <div className="p-8 rounded-2xl clay-inset text-center text-slate-500 font-bold">
            لا توجد أحداث مسجّلة في هذه الفترة الزمنية بعد — يتم التحديث فور تصفح الزوار للموقع.
          </div>
        ) : (
          <div className="clay-inset p-3 sm:p-4 rounded-2xl overflow-x-auto">
            <svg
              viewBox={`0 0 ${Math.max(320, timeline.length * 46)} 150`}
              className="w-full h-40 min-w-[300px]"
            >
              {timeline.map((pt, idx) => {
                const x = idx * 46 + 12;
                const vH = Math.max(4, Math.round((pt.visits / maxVal) * 100));
                const lH = Math.max(4, Math.round(((pt.libraryOpens + pt.searches) / maxVal) * 100));
                return (
                  <g key={pt.day}>
                    <rect x={x} y={118 - vH} width={12} height={vH} rx={4} fill="#4F46E5" />
                    <rect x={x + 15} y={118 - lH} width={12} height={lH} rx={4} fill="#A855F7" />
                    <text x={x + 13} y={136} textAnchor="middle" fontSize="9" fill="#64748B">
                      {pt.day.slice(5)}
                    </text>
                    <text x={x + 6} y={114 - vH} textAnchor="middle" fontSize="8" fill="#312E81">
                      {pt.visits}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>

      {/* Detailed Panels: Search Terms + Levels + Tool + Engagement */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Library Search & Levels */}
        <div className="clay-card p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black font-decorative flex items-center gap-1.5">
              <Search className="w-4 h-4 text-indigo-600" />
              <span>أكثر كلمات البحث بالمكتبة</span>
            </h3>
            <span className="text-[10px] font-mono text-rose-600 font-bold">
              بلا نتائج: {analytics?.library?.zeroResultSearches ?? 0}
            </span>
          </div>
          {(analytics?.library?.topSearchTerms || []).length === 0 ? (
            <div className="p-3 rounded-xl clay-inset text-slate-500">لم يتم تسجيل عمليات بحث بعد.</div>
          ) : (
            analytics!.library.topSearchTerms.map((term) => (
              <div
                key={term.query}
                className="p-2.5 rounded-xl clay-inset flex items-center justify-between gap-2"
              >
                <span className="font-bold text-slate-800 truncate">{term.query}</span>
                <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                  <span className="text-indigo-700 font-black">{term.count}×</span>
                  {term.zeroResults > 0 && (
                    <span className="text-rose-600 font-bold">({term.zeroResults} فارغ)</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Tool Runs Summary */}
        <div className="clay-card p-4 space-y-2.5">
          <h3 className="text-sm font-black font-decorative flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-500" />
            <span>إحصائيات تشغيل الأداة</span>
          </h3>
          <div className="grid grid-cols-2 gap-2 font-mono">
            <div className="p-2.5 rounded-xl clay-inset">
              <div className="text-[10px] text-slate-500">إجمالي التشغيل</div>
              <div className="text-base font-black text-slate-900">
                {analytics?.tool?.totalRuns ?? 0}
              </div>
            </div>
            <div className="p-2.5 rounded-xl clay-inset">
              <div className="text-[10px] text-slate-500">متوسط المدة</div>
              <div className="text-base font-black text-indigo-700">
                {Math.round((analytics?.tool?.avgDurationMs ?? 0) / 1000)} ث
              </div>
            </div>
            <div className="p-2.5 rounded-xl clay-inset">
              <div className="text-[10px] text-slate-500">مكتملة بنجاح</div>
              <div className="text-base font-black text-indigo-600">
                {analytics?.tool?.succeededRuns ?? 0}
              </div>
            </div>
            <div className="p-2.5 rounded-xl clay-inset">
              <div className="text-[10px] text-slate-500">فاشلة</div>
              <div className="text-base font-black text-rose-600">
                {analytics?.tool?.failedRuns ?? 0}
              </div>
            </div>
          </div>
        </div>

        {/* Engagement Summary */}
        <div className="clay-card p-4 space-y-2.5">
          <h3 className="text-sm font-black font-decorative flex items-center gap-1.5">
            <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
            <span>التفاعل العام والمجتمع</span>
          </h3>
          <div className="space-y-2">
            <div className="p-2.5 rounded-xl clay-inset flex items-center justify-between font-bold">
              <span>إجمالي الإعجابات الحقيقية</span>
              <span className="font-mono text-indigo-700">
                {analytics?.engagement?.totalLikes ?? 0}
              </span>
            </div>
            <div className="p-2.5 rounded-xl clay-inset flex items-center justify-between font-bold">
              <span>التعليقات والتقييمات</span>
              <span className="font-mono text-indigo-700">
                {analytics?.engagement?.totalComments ?? 0}
              </span>
            </div>
            <div className="p-2.5 rounded-xl clay-inset flex items-center justify-between font-bold">
              <span>أصوات الاستفتاء المسجّلة</span>
              <span className="font-mono text-indigo-700">
                {analytics?.engagement?.totalPollVotes ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
