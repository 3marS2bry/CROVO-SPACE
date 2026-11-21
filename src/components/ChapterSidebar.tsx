import React from 'react';
import { Search, X, CheckCircle, BookOpen, Layers, Code2, Sparkles } from 'lucide-react';
import { WhatsAppIcon } from './SocialIcons';
import { Chapter, AcademicGrade, SectionType } from '../types';

interface ChapterSidebarProps {
  chapters: Chapter[];
  currentChapterIdx: number;
  onSelectChapter: (idx: number) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  academicGrade: AcademicGrade;
  onSelectGrade: (grade: AcademicGrade) => void;
  activeSection: SectionType;
  onSelectSection: (sec: SectionType) => void;
  completedQuestions: Record<string, boolean>;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onOpenSubscription: () => void;
}

export const ChapterSidebar: React.FC<ChapterSidebarProps> = ({
  chapters,
  currentChapterIdx,
  onSelectChapter,
  searchQuery,
  onSearchChange,
  academicGrade,
  onSelectGrade,
  activeSection,
  onSelectSection,
  completedQuestions,
  isOpenMobile,
  onCloseMobile,
  onOpenSubscription,
}) => {

  const filteredChapters = chapters.map((ch, idx) => {
    const matchesSearch =
      !searchQuery.trim() ||
      String(ch.num).includes(searchQuery) ||
      `الفصل ${ch.num}`.includes(searchQuery) ||
      `المستوى ${ch.num}`.includes(searchQuery);
    return { ch, idx, matchesSearch };
  });

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-900/60 z-40 lg:hidden"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:sticky top-0 lg:top-24 right-0 h-screen lg:h-[calc(100vh-7rem)] w-[86vw] max-w-xs sm:w-88 clay-card z-50 lg:z-10 flex flex-col p-4 sm:p-5 transition-transform duration-300 border border-white/80 ${
          isOpenMobile
            ? 'translate-x-0 visible pointer-events-auto'
            : 'translate-x-full invisible pointer-events-none lg:translate-x-0 lg:visible lg:pointer-events-auto'
        }`}
      >
        {/* Top Header & Mobile Close */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-right">
            <h3 className="text-base font-bold font-decorative text-slate-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              <span>فهرس المستويات والفصول</span>
            </h3>
            <span className="text-[11px] text-slate-500 font-medium">
              {academicGrade === 'bac1' ? 'أولى بكالوريا (42 مستوى)' : 'تانية بكالوريا (مستويات متقدمة)'}
            </span>
          </div>

          <button
            onClick={onCloseMobile}
            className="lg:hidden p-2 rounded-xl clay-btn text-slate-500 hover:text-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Academic Grade Primary Tabs (أولى بكالوريا vs تانية بكالوريا) */}
        <div className="clay-pill-track grid grid-cols-2 gap-1 p-1 mb-3 text-xs font-bold font-decorative">
          <button
            type="button"
            onClick={() => onSelectGrade('bac1')}
            className={`py-2 px-2 rounded-full transition-all text-center flex items-center justify-center gap-1 text-xs font-bold ${
              academicGrade === 'bac1'
                ? 'clay-pill-active'
                : 'text-slate-600 hover:text-indigo-600'
            }`}
          >
            <span>أولى بكالوريا</span>
            <span className="text-[10px] opacity-80 font-mono">(42)</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectGrade('bac2')}
            className={`py-2 px-2 rounded-full transition-all text-center flex items-center justify-center gap-1 text-xs font-bold ${
              academicGrade === 'bac2'
                ? 'clay-pill-active'
                : 'text-slate-600 hover:text-indigo-600'
            }`}
          >
            <span>تانية بكالوريا</span>
            <span className="text-[10px] opacity-80 font-mono">(54+)</span>
          </button>
        </div>

        {/* 2. Secondary Subject Tabs (فقط في تانية بكالوريا) */}
        {academicGrade === 'bac2' ? (
          <div className="clay-pill-track grid grid-cols-3 gap-1 p-1 mb-3 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => onSelectSection('js')}
              className={`py-1.5 px-1 rounded-full transition-all text-center truncate ${
                activeSection === 'js'
                  ? 'clay-pill-active'
                  : 'text-slate-600 hover:text-indigo-600'
              }`}
            >
              جافا (1-54)
            </button>
            <button
              type="button"
              onClick={() => onSelectSection('py')}
              className={`py-1.5 px-1 rounded-full transition-all text-center truncate ${
                activeSection === 'py'
                  ? 'clay-pill-active'
                  : 'text-slate-600 hover:text-indigo-600'
              }`}
            >
              بايثون (25)
            </button>
            <button
              type="button"
              onClick={() => onSelectSection('fin')}
              className={`py-1.5 px-1 rounded-full transition-all text-center truncate ${
                activeSection === 'fin'
                  ? 'clay-pill-active'
                  : 'text-slate-600 hover:text-indigo-600'
              }`}
            >
              المالية (8)
            </button>
          </div>
        ) : (
          <div className="px-3 py-1.5 rounded-xl clay-inset mb-3 text-xs font-semibold text-slate-600 flex items-center justify-between">
            <span className="font-decorative">البرمجة بلغة جافا</span>
            <span className="text-[11px] text-indigo-600 font-bold font-mono">42 مستوى كامل</span>
          </div>
        )}

        {/* Search Input Field */}
        <div className="relative mb-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="ابحث برقم المستوى أو الفصل..."
            className="w-full pl-3 pr-9 py-2.5 rounded-full text-xs font-semibold text-slate-800 clay-inset border-none outline-none placeholder:text-slate-400"
          />
          <Search className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" />
        </div>

        {/* Chapters Scrollable List */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-2">
          {filteredChapters.map(({ ch, idx, matchesSearch }) => {
            if (!matchesSearch) return null;
            const isCurrent = idx === currentChapterIdx;

            // Calculate progress for this chapter
            const totalQs = ch.qs.length;
            let solvedCount = 0;
            for (let q = 0; q < totalQs; q++) {
              if (completedQuestions[`${academicGrade}-${activeSection}-${idx}-${q}`]) solvedCount++;
            }
            const progressPct = totalQs > 0 ? Math.round((solvedCount / totalQs) * 100) : 0;

            return (
              <div
                key={idx}
                onClick={() => {
                  onSelectChapter(idx);
                  onCloseMobile();
                }}
                className={`p-3 rounded-2xl cursor-pointer transition-all flex items-center justify-between gap-3 text-right ${
                  isCurrent
                    ? 'clay-purple-soft shadow-md'
                    : 'hover:bg-white/60'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0 transition-colors font-mono ${
                      progressPct === 100 || isCurrent
                        ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-sm'
                        : 'clay-inset text-indigo-700'
                    }`}
                  >
                    {progressPct === 100 ? <CheckCircle className="w-4 h-4" /> : ch.num}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate font-decorative">
                      {activeSection === 'js' ? `المستوى ${ch.num}` : `الفصل ${ch.num}`}
                    </div>
                    {/* Progress Bar */}
                    <div className="w-24 h-1.5 bg-slate-200 rounded-full mt-1.5 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-600 via-purple-500 to-indigo-400 rounded-full transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="text-[11px] font-bold text-slate-500 shrink-0 font-mono">
                  {totalQs} أسئلة
                </div>
              </div>
            );
          })}
        </div>

        {/* Omar Sabry Direct Contact Prompt */}
        <div className="mt-3 p-3.5 rounded-2xl clay-inset text-right border border-white/60">
          <div className="text-xs font-bold font-decorative text-slate-900 mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>محتاج الأداة تحللك البنك كله؟</span>
          </div>
          <p className="text-[11px] text-slate-600 mb-2 leading-relaxed">
            بتنفذ المهام بهدوء ومحاكاة بشرية وتوفر عليك ساعات من الحل. كلمني وأنا هظبطك:
          </p>
          <button
            type="button"
            onClick={() => {
              onCloseMobile();
              onOpenSubscription();
            }}
            className="w-full clay-whatsapp py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 text-white"
          >
            <WhatsAppIcon className="w-4 h-4" />
            <span>عاوز اشترك يخوياااا</span>
          </button>
        </div>
      </aside>
    </>
  );
};
