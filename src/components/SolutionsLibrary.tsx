import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  ChevronLeft,
  ChevronRight,
  Flame,
  Layers,
  Search,
  X,
  Zap,
} from 'lucide-react';
import { WhatsAppIcon } from './SocialIcons';
import { Chapter, AcademicGrade, SectionType } from '../types';
import { QuestionCard } from './QuestionCard';
import { ChapterSidebar } from './ChapterSidebar';
import { api, QuestionStatsResponse } from '../utils/api';
import {
  buildQuestionKey,
  filterAndSortLibraryQuestions,
  getLibrarySectionTotals,
} from '../utils/rules';

interface SolutionsLibraryProps {
  chapters: Chapter[];
  loadingChapters?: boolean;
  academicGrade: AcademicGrade;
  onSelectGrade: (grade: AcademicGrade) => void;
  activeSection: SectionType;
  onSelectSection: (sec: SectionType) => void;
  completedQuestions: Record<string, boolean>;
  onCompleteQuestion: (key: string) => void;
  onCopyTrigger?: () => void;
  onOpenToolDetails: () => void;
  onOpenSubscription: () => void;
}

export const SolutionsLibrary: React.FC<SolutionsLibraryProps> = ({
  chapters,
  loadingChapters = false,
  academicGrade,
  onSelectGrade,
  activeSection,
  onSelectSection,
  completedQuestions,
  onCompleteQuestion,
  onCopyTrigger,
  onOpenToolDetails,
  onOpenSubscription,
}) => {
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [questionSearch, setQuestionSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchAllChapters, setSearchAllChapters] = useState(false);
  const [isOpenMobile, setIsOpenMobile] = useState(false);
  const [isQuickGridOpen, setIsQuickGridOpen] = useState(false);
  const [levelBtnBurst, setLevelBtnBurst] = useState(false);
  const lastLoggedLevelRef = useRef<string>('');
  const lastLoggedSearchRef = useRef<string>('');

  // Debounce search input by 180ms for silky responsiveness across 600+ questions
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(questionSearch);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [questionSearch]);

  // Real DB stats (total copy counts per question + top copied questions)
  const [stats, setStats] = useState<QuestionStatsResponse>({
    totalCopies: 0,
    copyCounts: {},
    topQuestions: [],
  });

  const loadStats = useCallback(async () => {
    try {
      const res = await api.getQuestionStats();
      setStats(res);
    } catch {
      // Keep previous stats safely
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Finite attention highlight on Choose Level button when entering or switching grade/section
  useEffect(() => {
    setLevelBtnBurst(true);
    const timer = window.setTimeout(() => {
      setLevelBtnBurst(false);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [academicGrade, activeSection]);

  const safeIdx = currentChapterIdx >= chapters.length ? 0 : currentChapterIdx;
  const currentChapter = chapters[safeIdx] || chapters[0];

  // Track real level view cleanly without duplicate spam
  useEffect(() => {
    if (!currentChapter) return;
    const key = `${academicGrade}:${activeSection}:${currentChapter.num}`;
    if (lastLoggedLevelRef.current !== key) {
      lastLoggedLevelRef.current = key;
      api.trackEvent({
        eventType: 'level_view',
        grade: academicGrade,
        section: activeSection,
        chapterNum: currentChapter.num,
      });
    }
  }, [academicGrade, activeSection, currentChapter]);

  const sectionTotals = useMemo(() => getLibrarySectionTotals(chapters), [chapters]);

  const totalQs = currentChapter ? currentChapter.qs.length : 0;
  let solvedCount = 0;
  if (currentChapter) {
    for (let q = 0; q < totalQs; q++) {
      if (completedQuestions[buildQuestionKey(academicGrade, activeSection, safeIdx, q)]) {
        solvedCount++;
      }
    }
  }
  const chapterProgress = totalQs > 0 ? Math.round((solvedCount / totalQs) * 100) : 0;

  const displayedQuestions = useMemo(
    () =>
      filterAndSortLibraryQuestions({
        chapters,
        grade: academicGrade,
        section: activeSection,
        activeChapterIdx: safeIdx,
        searchQuery: debouncedSearch,
        searchAllChapters,
        filterMode: 'all',
        sortMode: 'original',
        copyCounts: stats.copyCounts,
        completedQuestions,
      }),
    [
      chapters,
      academicGrade,
      activeSection,
      safeIdx,
      debouncedSearch,
      searchAllChapters,
      stats.copyCounts,
      completedQuestions,
    ]
  );

  // Track real search term & zero-result analytics after debounce
  useEffect(() => {
    const clean = debouncedSearch.trim();
    if (clean.length < 2) return;
    const searchSig = `${academicGrade}:${activeSection}:${clean}:${displayedQuestions.length}`;
    if (lastLoggedSearchRef.current === searchSig) return;
    lastLoggedSearchRef.current = searchSig;
    api.trackEvent({
      eventType: 'library_search',
      grade: academicGrade,
      section: activeSection,
      query: clean,
      resultsCount: displayedQuestions.length,
    });
  }, [debouncedSearch, displayedQuestions.length, academicGrade, activeSection]);

  const scrollToActiveChapter = () => {
    window.setTimeout(() => {
      const el = document.getElementById('questions-list-top');
      if (el) {
        const yOffset = -80;
        const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    }, 40);
  };

  const handleChapterNav = (newIdx: number) => {
    setCurrentChapterIdx(newIdx);
    setIsQuickGridOpen(false);
    scrollToActiveChapter();
  };

  const handleOpenLevelSelector = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsOpenMobile(true);
    } else {
      setIsQuickGridOpen((prev) => !prev);
    }
  };

  const handleCopyRecorded = async (
    questionKey: string,
    questionTitle: string,
    chapterNum: number,
    qIndex: number
  ) => {
    setStats((prev) => ({
      ...prev,
      totalCopies: prev.totalCopies + 1,
      copyCounts: {
        ...prev.copyCounts,
        [questionKey]: (prev.copyCounts[questionKey] || 0) + 1,
      },
    }));

    if (onCopyTrigger) {
      onCopyTrigger();
    }

    try {
      const saved = await api.recordQuestionCopy({
        questionKey,
        grade: academicGrade,
        section: activeSection,
        chapterNum,
        qIndex,
        questionTitle,
      });
      setStats((prev) => ({
        ...prev,
        copyCounts: {
          ...prev.copyCounts,
          [saved.questionKey]: saved.copyCount,
        },
      }));
      api.getQuestionStats().then(setStats).catch(() => {});
    } catch {
      // Offline / transient network error doesn't block user copy
    }
  };

  const handleJumpToPopularQuestion = (item: QuestionStatsResponse['topQuestions'][number]) => {
    if (item.grade !== academicGrade) {
      onSelectGrade(item.grade);
    }
    if (item.grade === 'bac2' && item.section !== activeSection) {
      onSelectSection(item.section);
    }
    setQuestionSearch('');
    setDebouncedSearch('');
    const targetIdx = Math.max(0, item.chapterNum - 1);
    setCurrentChapterIdx(targetIdx);
    scrollToActiveChapter();
  };

  const getSectionTitle = () => {
    if (academicGrade === 'bac1') {
      return `أولى بكالوريا — جافا (${sectionTotals.totalChapters} مستوى · ${sectionTotals.totalQuestions} سؤال)`;
    }
    if (activeSection === 'js') {
      return `تانية بكالوريا — جافا المتقدمة (${sectionTotals.totalChapters} مستوى · ${sectionTotals.totalQuestions} سؤال)`;
    }
    if (activeSection === 'py') {
      return `تانية بكالوريا — بايثون Python (${sectionTotals.totalChapters} فصل · ${sectionTotals.totalQuestions} سؤال)`;
    }
    return `تانية بكالوريا — الثقافة المالية (${sectionTotals.totalChapters} فصول · ${sectionTotals.totalQuestions} سؤال)`;
  };

  const levelUnitLabel = activeSection === 'js' ? 'المستوى' : 'الفصل';

  return (
    <section id="solutions-library" className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
      {/* 1. Academic Grade & Subject Header Banner */}
      <div className="clay-card p-4 sm:p-6 mb-4 sm:mb-6 text-right relative overflow-hidden border border-white/85">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3.5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-2xl font-black font-ios text-slate-900">
                مكتبة الحلول المعتمدة
              </h2>

              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full clay-inset text-[11px] sm:text-xs font-bold text-indigo-700 font-decorative w-fit">
                <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>
                  {sectionTotals.totalQuestions} سؤال ({sectionTotals.totalChapters} {levelUnitLabel})
                </span>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 font-ios font-medium leading-relaxed">
              تصفح جميع المستويات وحلول الأكواد النموذجية الجاهزة للنسخ بنقرة واحدة.
            </p>
          </div>

          {/* Curved White & Purple Pill Grade Switcher */}
          <div className="clay-pill-track flex items-center gap-1 p-1 w-full md:w-auto shrink-0">
            <button
              type="button"
              data-testid="grade-bac1-btn"
              onClick={() => {
                onSelectGrade('bac1');
                setCurrentChapterIdx(0);
              }}
              className={`flex-1 md:flex-initial px-3 sm:px-5 py-2 rounded-full text-xs sm:text-sm font-bold font-decorative transition-transform duration-150 flex items-center justify-center gap-1.5 ${
                academicGrade === 'bac1'
                  ? 'clay-pill-active'
                  : 'text-slate-600 hover:text-indigo-600'
              }`}
            >
              <span>أولى بكالوريا</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                  academicGrade === 'bac1' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-300/60 text-slate-600'
                }`}
              >
                (42)
              </span>
            </button>

            <button
              type="button"
              data-testid="grade-bac2-btn"
              onClick={() => {
                onSelectGrade('bac2');
                setCurrentChapterIdx(0);
              }}
              className={`flex-1 md:flex-initial px-3 sm:px-5 py-2 rounded-full text-xs sm:text-sm font-bold font-decorative transition-transform duration-150 flex items-center justify-center gap-1.5 ${
                academicGrade === 'bac2'
                  ? 'clay-pill-active'
                  : 'text-slate-600 hover:text-indigo-600'
              }`}
            >
              <span>تانية بكالوريا</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                  academicGrade === 'bac2' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-300/60 text-slate-600'
                }`}
              >
                (54+)
              </span>
            </button>
          </div>
        </div>

        {/* Bac2 Secondary Subject Switcher */}
        {academicGrade === 'bac2' && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 pt-3 mt-3 border-t border-slate-200/70">
            <span className="text-xs font-bold text-slate-500 font-decorative shrink-0">
              المادة الدراسية:
            </span>

            <div className="clay-pill-track grid grid-cols-3 gap-1 p-1 w-full sm:w-auto flex-1">
              <button
                type="button"
                data-testid="section-js-btn"
                onClick={() => {
                  onSelectSection('js');
                  setCurrentChapterIdx(0);
                }}
                className={`py-1.5 px-2.5 rounded-full text-xs font-bold transition-transform duration-150 font-ios text-center ${
                  activeSection === 'js'
                    ? 'clay-pill-active'
                    : 'text-slate-600 hover:text-indigo-600'
                }`}
              >
                جافا (54 مستوى)
              </button>

              <button
                type="button"
                data-testid="section-py-btn"
                onClick={() => {
                  onSelectSection('py');
                  setCurrentChapterIdx(0);
                }}
                className={`py-1.5 px-2.5 rounded-full text-xs font-bold transition-transform duration-150 font-ios text-center ${
                  activeSection === 'py'
                    ? 'clay-pill-active'
                    : 'text-slate-600 hover:text-indigo-600'
                }`}
              >
                بايثون (25)
              </button>

              <button
                type="button"
                data-testid="section-fin-btn"
                onClick={() => {
                  onSelectSection('fin');
                  setCurrentChapterIdx(0);
                }}
                className={`py-1.5 px-2.5 rounded-full text-xs font-bold transition-transform duration-150 font-ios text-center ${
                  activeSection === 'fin'
                    ? 'clay-pill-active'
                    : 'text-slate-600 hover:text-indigo-600'
                }`}
              >
                المالية (8)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Main Grid: Questions Area + Chapter Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-7 items-start">
        <div className="lg:col-span-8 flex flex-col gap-4 order-1">
          <div
            id="active-chapter-container"
            className="clay-card p-3.5 sm:p-5 text-right border border-white/85 scroll-mt-20 space-y-3"
          >
            {/* Prominent Choose Level Row */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  data-testid="choose-level-btn"
                  onClick={handleOpenLevelSelector}
                  className={`clay-purple-soft px-3.5 sm:px-4 py-2 rounded-2xl text-xs sm:text-sm font-black flex items-center gap-2 shrink-0 font-ios ${
                    levelBtnBurst ? 'is-attention-burst ring-2 ring-indigo-400/50' : ''
                  }`}
                >
                  <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>اختر {levelUnitLabel}</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-mono text-[11px] font-black">
                    {currentChapter?.num || 1}
                  </span>
                </button>

                <div className="min-w-0">
                  <h2 className="text-sm sm:text-xl font-black font-ios text-slate-900 truncate">
                    حلول {levelUnitLabel} {currentChapter?.num || 1} ({totalQs} أسئلة)
                  </h2>
                  <span className="text-[11px] text-indigo-600 font-bold font-decorative block truncate">
                    {getSectionTitle()}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-end">
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full clay-inset text-[11px] font-bold text-slate-700 font-ios">
                  <span>إنجاز:</span>
                  <span className="text-indigo-700 font-mono">
                    {solvedCount}/{totalQs}
                  </span>
                  <span className="text-indigo-600 font-mono">({chapterProgress}%)</span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={safeIdx === 0}
                    onClick={() => handleChapterNav(Math.max(0, safeIdx - 1))}
                    aria-label="المستوى السابق"
                    className="clay-btn p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 flex items-center gap-0.5 font-ios"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">السابق</span>
                  </button>
                  <button
                    type="button"
                    disabled={safeIdx >= chapters.length - 1}
                    onClick={() => handleChapterNav(Math.min(Math.max(0, chapters.length - 1), safeIdx + 1))}
                    aria-label="المستوى القادم"
                    className="clay-btn p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-bold text-slate-700 disabled:opacity-40 flex items-center gap-0.5 font-ios"
                  >
                    <span className="hidden sm:inline">التالي</span>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {isQuickGridOpen && (
              <div
                data-testid="desktop-quick-level-grid"
                className="clay-inset p-3 rounded-2xl grid grid-cols-6 sm:grid-cols-9 gap-1.5 max-h-56 overflow-y-auto"
              >
                {chapters.map((ch, idx) => (
                  <button
                    key={ch.num}
                    type="button"
                    onClick={() => handleChapterNav(idx)}
                    className={`py-1.5 rounded-full text-xs font-mono font-bold transition-transform ${
                      idx === safeIdx
                        ? 'clay-pill-active'
                        : 'clay-btn text-slate-700 hover:text-indigo-600'
                    }`}
                  >
                    {ch.num}
                  </button>
                ))}
              </div>
            )}

            {/* Brand Indigo/Purple Progress Bar (GPU-friendly scaleX) */}
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden clay-inset">
              <div
                className="h-full w-full bg-gradient-to-r from-indigo-600 via-purple-500 to-indigo-400 rounded-full origin-right transition-transform duration-300"
                style={{ transform: `scaleX(${chapterProgress / 100})` }}
              />
            </div>

            {/* Clean Classic Single-Row Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
              <div className="relative flex-1">
                <input
                  type="text"
                  data-testid="question-search-input"
                  value={questionSearch}
                  onChange={(e) => setQuestionSearch(e.target.value)}
                  placeholder="ابحث عن أي سؤال، كود، أو رقم مستوى..."
                  className="w-full pl-9 pr-9 py-2 rounded-full text-xs font-semibold text-slate-800 clay-inset border-none outline-none placeholder:text-slate-400 font-ios"
                />
                <Search className="w-3.5 h-3.5 absolute right-3.5 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" />
                {questionSearch && (
                  <button
                    type="button"
                    aria-label="مسح البحث"
                    onClick={() => {
                      setQuestionSearch('');
                      setDebouncedSearch('');
                    }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-rose-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="clay-pill-track flex items-center gap-0.5 p-0.5 shrink-0 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setSearchAllChapters(false)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold font-ios transition-transform ${
                    !searchAllChapters ? 'clay-pill-active' : 'text-slate-600 hover:text-indigo-600'
                  }`}
                >
                  {levelUnitLabel} {currentChapter?.num || 1}
                </button>
                <button
                  type="button"
                  data-testid="search-all-chapters-toggle"
                  onClick={() => setSearchAllChapters(true)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold font-ios transition-transform ${
                    searchAllChapters ? 'clay-pill-active' : 'text-slate-600 hover:text-indigo-600'
                  }`}
                >
                  المادة كلها
                </button>
              </div>
            </div>
          </div>

          {/* 3. Direct Questions List */}
          <div id="questions-list-top" className="flex flex-col gap-3 sm:gap-3.5 min-h-[260px]">
            {loadingChapters && chapters.length === 0 ? (
              <div className="space-y-3">
                {[1, 2, 3].map((k) => (
                  <div key={k} className="clay-card p-5 h-36 animate-pulse bg-white/70" />
                ))}
              </div>
            ) : displayedQuestions.length === 0 ? (
              <div className="clay-card p-6 text-center space-y-2">
                <p className="text-sm font-bold font-ios text-slate-700">
                  مفيش أسئلة مطابقة لبحثك في{' '}
                  {searchAllChapters && debouncedSearch.trim() ? 'المادة' : 'المستوى ده'}.
                </p>
                <div className="flex items-center justify-center gap-2">
                  {!searchAllChapters && debouncedSearch.trim() && (
                    <button
                      type="button"
                      onClick={() => setSearchAllChapters(true)}
                      className="clay-purple-soft px-3.5 py-1.5 rounded-full text-xs font-bold font-ios"
                    >
                      ابحث في المادة كلها
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setQuestionSearch('');
                      setDebouncedSearch('');
                    }}
                    className="clay-btn px-3.5 py-1.5 rounded-full text-xs font-bold text-slate-700 font-ios"
                  >
                    إظهار جميع الأسئلة
                  </button>
                </div>
              </div>
            ) : (
              displayedQuestions.map((entry) => (
                <QuestionCard
                  key={entry.questionKey}
                  question={entry.question}
                  index={entry.qIdx}
                  chapterIndex={entry.chapterIdx}
                  chapterNum={entry.chapterNum}
                  grade={academicGrade}
                  section={activeSection}
                  questionKey={entry.questionKey}
                  copyCount={entry.copyCount}
                  chapterBadge={
                    searchAllChapters && debouncedSearch.trim()
                      ? `${activeSection === 'js' ? 'المستوى' : 'الفصل'} ${entry.chapterNum}`
                      : undefined
                  }
                  isCompleted={entry.isCompleted}
                  onComplete={() => onCompleteQuestion(entry.questionKey)}
                  onCopyRecorded={handleCopyRecorded}
                />
              ))
            )}
          </div>

          {/* 4. Bottom Chapter Navigation Bar */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={safeIdx === 0}
              onClick={() => handleChapterNav(Math.max(0, safeIdx - 1))}
              className="clay-btn px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed font-ios whitespace-nowrap"
            >
              المستوى السابق
            </button>

            <span className="text-[11px] sm:text-xs font-bold font-decorative text-slate-500 text-center px-1">
              {chapters.length > 0 ? `${safeIdx + 1} / ${chapters.length}` : '—'}
            </span>

            <button
              type="button"
              disabled={safeIdx >= chapters.length - 1}
              onClick={() => handleChapterNav(Math.min(Math.max(0, chapters.length - 1), safeIdx + 1))}
              className="clay-btn px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed font-ios whitespace-nowrap"
            >
              المستوى القادم
            </button>
          </div>

          {/* 5. Non-intrusive Tool Promo Card below Questions */}
          <div className="clay-card p-4 sm:p-5 bg-gradient-to-r from-indigo-50/90 via-sky-50/80 to-purple-50/90 border border-indigo-200/70 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 text-right">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl clay-apple-blue flex items-center justify-center shrink-0 shadow-md">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300 fill-amber-300" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs sm:text-sm font-bold font-ios text-slate-900">
                    عايز تخلص كل الفصول دي في 4 دقايق بمحاكاة بشرية تامة؟
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-600 font-ios mt-0.5 leading-relaxed">
                  أداتي بتسجل كأنك أنت بالظبط وتكتب وتجاوب بنعومة تامة بدون كشفك في المنصة.
                </p>
              </div>
            </div>

            <div className="flex flex-row items-center gap-2 shrink-0 w-full sm:w-auto">
              <button
                type="button"
                onClick={onOpenToolDetails}
                className="clay-btn flex-1 sm:flex-initial py-2 px-3 text-xs font-bold text-indigo-600 font-ios text-center whitespace-nowrap"
              >
                شرح الميكانيزم
              </button>
              <button
                type="button"
                onClick={onOpenSubscription}
                className="clay-whatsapp flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 font-ios whitespace-nowrap"
              >
                <WhatsAppIcon className="w-4 h-4" />
                <span>عاوز اشترك يخوياااا</span>
              </button>
            </div>
          </div>

          {/* 6. Real Most Copied Questions Strip */}
          <div
            data-testid="most-copied-section"
            className="clay-card p-3.5 sm:p-4 text-right border border-white/80"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl clay-inset flex items-center justify-center text-amber-500">
                  <Flame className="w-4 h-4 fill-amber-500" />
                </div>
                <h3 className="text-xs sm:text-sm font-black font-decorative text-slate-900">
                  الأسئلة الأكثر نسخاً دلوقتي
                </h3>
              </div>
              <span className="text-[11px] font-mono font-bold text-indigo-600 clay-inset px-2.5 py-1 rounded-xl">
                إجمالي النسخ بالمكتبة: {stats.totalCopies}
              </span>
            </div>

            {stats.topQuestions.length === 0 ? (
              <p className="text-[11px] text-slate-500 font-ios">
                أول ما الطلاب ينسخوا أسئلة من المكتبة، الأسئلة الأكثر طلباً هتظهر هنا بالأرقام الحقيقية.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stats.topQuestions.slice(0, 5).map((item) => (
                  <button
                    key={item.questionKey}
                    type="button"
                    onClick={() => handleJumpToPopularQuestion(item)}
                    className="clay-inset hover:ring-1 hover:ring-indigo-400 px-3 py-1.5 rounded-xl text-[11px] font-ios flex items-center gap-2 text-right max-w-full"
                  >
                    <span className="font-mono font-black text-indigo-600 shrink-0">
                      {item.copyCount}×
                    </span>
                    <span className="text-slate-800 font-bold truncate max-w-[210px] sm:max-w-[260px]">
                      {item.questionTitle}
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                      (ف{item.chapterNum})
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Left Column: Chapter Sidebar */}
        <div className="lg:col-span-4 order-2">
          <ChapterSidebar
            chapters={chapters}
            currentChapterIdx={safeIdx}
            onSelectChapter={(idx) => handleChapterNav(idx)}
            searchQuery={sidebarSearch}
            onSearchChange={(q) => setSidebarSearch(q)}
            academicGrade={academicGrade}
            onSelectGrade={onSelectGrade}
            activeSection={activeSection}
            onSelectSection={(sec) => {
              onSelectSection(sec);
              setCurrentChapterIdx(0);
            }}
            completedQuestions={completedQuestions}
            isOpenMobile={isOpenMobile}
            onCloseMobile={() => setIsOpenMobile(false)}
            onOpenSubscription={onOpenSubscription}
          />
        </div>
      </div>
    </section>
  );
};
