/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { AppView, Navbar } from './components/Navbar';
import { PromoTopBanner } from './components/PromoTopBanner';
import { HeroSection } from './components/HeroSection';
import { HeroPromoSection } from './components/HeroPromoSection';
import { SolutionsLibrary } from './components/SolutionsLibrary';
import { PollSection } from './components/PollSection';
import { NotificationPrompt } from './components/NotificationPrompt';
import { CopyAdBanner } from './components/CopyAdBanner';
import { ContactFooter } from './components/ContactFooter';
import { AuthProvider } from './context/AuthContext';
import { TelegramModalProvider } from './context/TelegramModalContext';
import { AuthModal } from './components/AuthModal';
import { OptionalWelcomeBanner } from './components/OptionalWelcomeBanner';
import { CommunitySection } from './components/CommunitySection';
import { FirstVisitWelcomeModal } from './components/FirstVisitWelcomeModal';
import { TelegramInviteModal } from './components/TelegramInviteModal';
import { CommentsSection } from './components/CommentsSection';
import { HelpCenterSection } from './components/HelpCenterSection';
import { AcademicGrade, Chapter, SectionType } from './types';
import { api, PublicConfig } from './utils/api';
import {
  LibraryOverrideItem,
  subscribeLibraryOverridesCloud,
  subscribeSiteConfigCloud,
} from './utils/cloudStore';
import {
  isOfferActiveClient,
  LIBRARY_AD_DELAY_MS,
  shouldShowTimedLibraryAd,
} from './utils/rules';
import { applyRouteSeo } from './utils/seo';

function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await importer();
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw lastError;
  });
}

class LazyErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-3xl mx-auto px-4 my-8" dir="rtl">
          <div className="clay-card p-6 text-center space-y-3">
            <p className="text-sm font-bold text-slate-800">
              حدث انقطاع مؤقت أثناء تحميل هذا القسم.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="clay-btn px-5 py-2.5 rounded-2xl text-xs font-bold text-indigo-600"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Lazy-loaded secondary views and modals with automatic retry
const ToolDetailsPage = lazyWithRetry(() =>
  import('./components/ToolDetailsPage').then((m) => ({ default: m.ToolDetailsPage }))
);
const AdminDashboard = lazyWithRetry(() =>
  import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const SubscriptionModal = lazyWithRetry(() =>
  import('./components/SubscriptionModal').then((m) => ({ default: m.SubscriptionModal }))
);
const QuranPlayer = lazyWithRetry(() =>
  import('./components/QuranPlayer').then((m) => ({ default: m.QuranPlayer }))
);

const LIBRARY_AD_DISMISSED_KEY = 'crovo_library_ad_dismissed_at';

function resolveInitialView(): AppView {
  if (typeof window === 'undefined') return 'library';
  const path = window.location.pathname.toLowerCase();
  if (
    path === '/admin' ||
    path.startsWith('/admin/') ||
    window.location.hash === '#admin' ||
    window.location.search.includes('admin=1')
  ) {
    return 'admin';
  }
  if (path === '/reviews') return 'reviews';
  if (path === '/tool') return 'toolDetails';
  return 'library';
}

const SectionSkeleton: React.FC = () => (
  <div className="max-w-5xl mx-auto px-3 sm:px-6 my-6">
    <div className="clay-card p-6 h-40 animate-pulse bg-white/75" />
  </div>
);

function AppContent() {
  const [activeView, setActiveView] = useState<AppView>(resolveInitialView);

  const [siteConfig, setSiteConfig] = useState<PublicConfig | null>(null);
  const [cloudConfigPatch, setCloudConfigPatch] = useState<Partial<PublicConfig> | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState<number>(0);

  const loadSiteConfig = useCallback(async () => {
    try {
      const cfg = await api.getConfig();
      setSiteConfig(cfg);
      const serverMs = Date.parse(cfg.serverTime);
      if (Number.isFinite(serverMs)) {
        setServerOffsetMs(serverMs - Date.now());
      }
    } catch {
      // Keep previous config safely if transient fetch fails
    }
  }, []);

  useEffect(() => {
    loadSiteConfig();
    const timer = window.setInterval(loadSiteConfig, 60000);
    const unsubCloud = subscribeSiteConfigCloud((patch) => {
      setCloudConfigPatch(patch);
    });
    return () => {
      window.clearInterval(timer);
      unsubCloud();
    };
  }, [loadSiteConfig]);

  const effectiveConfig: PublicConfig | null = React.useMemo(() => {
    if (!siteConfig) return null;
    if (!cloudConfigPatch) return siteConfig;
    const merged: PublicConfig = {
      ...siteConfig,
      ...cloudConfigPatch,
      libraryAd: cloudConfigPatch.libraryAd
        ? { ...siteConfig.libraryAd, ...cloudConfigPatch.libraryAd }
        : siteConfig.libraryAd,
      promoBanner: cloudConfigPatch.promoBanner
        ? { ...(siteConfig.promoBanner || { enabled: true, text: '' }), ...cloudConfigPatch.promoBanner }
        : siteConfig.promoBanner,
    };
    merged.offerActive = isOfferActiveClient(merged, Date.now() + serverOffsetMs);
    return merged;
  }, [siteConfig, cloudConfigPatch, serverOffsetMs]);

  useEffect(() => {
    applyRouteSeo(activeView);
  }, [activeView]);

  // Real visit tracking (once per initial load & view switch)
  const trackedInitialRef = useRef(false);
  useEffect(() => {
    if (trackedInitialRef.current) return;
    trackedInitialRef.current = true;
    api.trackEvent({
      eventType: 'page_view',
      path: typeof window !== 'undefined' ? window.location.pathname : '/',
    });
    if (activeView === 'library') {
      api.trackEvent({ eventType: 'library_open' });
    } else if (activeView === 'toolDetails') {
      api.trackEvent({ eventType: 'tool_view' });
    }
  }, [activeView]);

  const navigateToView = useCallback((view: AppView) => {
    setActiveView(view);
    if (typeof window !== 'undefined') {
      const targetPath =
        view === 'admin'
          ? '/admin'
          : view === 'toolDetails'
          ? '/tool'
          : view === 'reviews'
          ? '/reviews'
          : '/';
      if (window.location.pathname !== targetPath || window.location.hash === '#admin') {
        window.history.pushState(null, '', targetPath);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (view === 'toolDetails') {
        api.trackEvent({ eventType: 'tool_view', path: '/tool' });
      } else if (view === 'library') {
        api.trackEvent({ eventType: 'library_open', path: '/' });
      }
    }
  }, []);

  useEffect(() => {
    const syncFromBrowser = () => {
      setActiveView(resolveInitialView());
    };
    window.addEventListener('popstate', syncFromBrowser);
    window.addEventListener('hashchange', syncFromBrowser);
    return () => {
      window.removeEventListener('popstate', syncFromBrowser);
      window.removeEventListener('hashchange', syncFromBrowser);
    };
  }, []);

  const [academicGrade, setAcademicGrade] = useState<AcademicGrade>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('student_academic_grade') as AcademicGrade;
      return saved === 'bac2' ? 'bac2' : 'bac1';
    }
    return 'bac1';
  });

  const [activeSection, setActiveSection] = useState<SectionType>('js');

  // Dynamic Library Loader with AbortController cancelling stale switches + memory cache
  const effectiveSection: SectionType = academicGrade === 'bac1' ? 'js' : activeSection;
  const libraryCacheRef = useRef<Map<string, Chapter[]>>(new Map());
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [libraryOverrides, setLibraryOverrides] = useState<LibraryOverrideItem[]>([]);
  const [loadingChapters, setLoadingChapters] = useState<boolean>(true);

  useEffect(() => {
    return subscribeLibraryOverridesCloud((items) => {
      setLibraryOverrides(items);
    });
  }, []);

  const effectiveChapters = React.useMemo(() => {
    if (libraryOverrides.length === 0) return chapters;
    const relevant = libraryOverrides.filter(
      (item) => item.grade === academicGrade && item.section === effectiveSection
    );
    if (relevant.length === 0) return chapters;

    const cloned = chapters.map((ch) => ({ ...ch, qs: [...ch.qs] }));
    for (const ov of relevant) {
      const ch = cloned.find((c) => c.num === ov.chapterNum);
      if (!ch) continue;
      if (ov.deleted) {
        if (ov.qIndex >= 0 && ov.qIndex < ch.qs.length) {
          ch.qs = ch.qs.filter((_, idx) => idx !== ov.qIndex);
        }
      } else if (ov.qIndex >= 0 && ov.qIndex < ch.qs.length) {
        ch.qs[ov.qIndex] = { q: ov.qText, a: ov.aText, code: ov.isCode };
      } else {
        ch.qs.push({ q: ov.qText, a: ov.aText, code: ov.isCode });
      }
    }
    return cloned;
  }, [chapters, libraryOverrides, academicGrade, effectiveSection]);

  const loadLibrarySection = useCallback(
    async (grade: AcademicGrade, section: SectionType, signal?: AbortSignal, bypassCache = false) => {
      const cacheKey = `${grade}:${section}`;
      if (!bypassCache && libraryCacheRef.current.has(cacheKey)) {
        setChapters(libraryCacheRef.current.get(cacheKey) || []);
        setLoadingChapters(false);
        return;
      }

      setLoadingChapters(true);
      try {
        const res = await api.getLibrary(grade, section, signal);
        if (signal?.aborted) return;
        libraryCacheRef.current.set(cacheKey, res.chapters);
        setChapters(res.chapters);
        setLoadingChapters(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Fallback: lazily import static data module only if API unavailable
        try {
          const mod = await import('./data/chaptersData');
          if (signal?.aborted) return;
          const fallback =
            grade === 'bac1'
              ? mod.chaptersBac1Js
              : section === 'js'
              ? mod.chaptersBac2Js
              : section === 'py'
              ? mod.chaptersPy
              : mod.chaptersFin;
          libraryCacheRef.current.set(cacheKey, fallback);
          setChapters(fallback);
        } catch {
          // ignore
        } finally {
          if (!signal?.aborted) setLoadingChapters(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (activeView === 'admin') return;
    const controller = new AbortController();
    loadLibrarySection(academicGrade, effectiveSection, controller.signal);
    return () => controller.abort();
  }, [academicGrade, effectiveSection, activeView, loadLibrarySection]);

  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [isQuranModalOpen, setIsQuranModalOpen] = useState(false);

  const isPreviewRichAd =
    typeof window !== 'undefined' && window.location.search.includes('adPreview=1');

  const [copyCount, setCopyCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('student_copy_count');
      return saved ? parseInt(saved, 10) : 0;
    }
    return 0;
  });
  const [showCopyAd, setShowCopyAd] = useState<boolean>(isPreviewRichAd);
  const [hasReachedAdDelay, setHasReachedAdDelay] = useState(false);
  const [hasShownAdThisVisit, setHasShownAdThisVisit] = useState(isPreviewRichAd);

  const delayMs =
    typeof effectiveConfig?.libraryAd?.delaySeconds === 'number' && effectiveConfig.libraryAd.delaySeconds >= 5
      ? effectiveConfig.libraryAd.delaySeconds * 1000
      : LIBRARY_AD_DELAY_MS;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHasReachedAdDelay(true);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  useEffect(() => {
    if (!hasReachedAdDelay || hasShownAdThisVisit) return;
    let lastDismissedAtMs: number | null = null;
    try {
      const raw = localStorage.getItem(LIBRARY_AD_DISMISSED_KEY);
      if (raw !== null) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) lastDismissedAtMs = parsed;
      }
    } catch {
      // Ignore storage read errors
    }

    const canShow = shouldShowTimedLibraryAd({
      enabled: effectiveConfig?.libraryAd.enabled ?? true,
      isAdminView: activeView === 'admin',
      hasOtherModalOpen: isSubModalOpen || isQuranModalOpen,
      lastDismissedAtMs,
      cooldownHours: effectiveConfig?.libraryAd?.cooldownHours,
    });

    if (canShow) {
      setShowCopyAd(true);
      setHasShownAdThisVisit(true);
    }
  }, [
    hasReachedAdDelay,
    hasShownAdThisVisit,
    effectiveConfig?.libraryAd.enabled,
    effectiveConfig?.libraryAd?.cooldownHours,
    activeView,
    isSubModalOpen,
    isQuranModalOpen,
  ]);

  const handleCloseTimedLibraryAd = useCallback(() => {
    setShowCopyAd(false);
    setHasShownAdThisVisit(true);
    try {
      localStorage.setItem(LIBRARY_AD_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Ignore storage write errors
    }
  }, []);

  const [xp, setXp] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('student_xp');
      return saved ? parseInt(saved, 10) : 50;
    }
    return 50;
  });

  const [completedQuestions, setCompletedQuestions] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('student_completed_qs');
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  const currentLevel = Math.floor(xp / 100) + 1;

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('dark');
      try {
        localStorage.removeItem('smart_theme');
      } catch {
        // ignore storage errors
      }
    }
  }, []);

  const handleSelectGrade = (grade: AcademicGrade) => {
    setAcademicGrade(grade);
    localStorage.setItem('student_academic_grade', grade);
    if (grade === 'bac1') {
      setActiveSection('js');
    }
  };

  const handleCompleteQuestion = (key: string) => {
    if (!completedQuestions[key]) {
      const nextCompleted = { ...completedQuestions, [key]: true };
      setCompletedQuestions(nextCompleted);
      localStorage.setItem('student_completed_qs', JSON.stringify(nextCompleted));

      const nextXp = xp + 25;
      setXp(nextXp);
      localStorage.setItem('student_xp', String(nextXp));
    }
  };

  const handleCopyTrigger = () => {
    const nextCount = copyCount + 1;
    setCopyCount(nextCount);
    localStorage.setItem('student_copy_count', String(nextCount));
  };

  const scrollToLibrary = () => {
    if (activeView !== 'library') {
      navigateToView('library');
    }
    window.setTimeout(() => {
      const el = document.getElementById('solutions-library');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 60);
  };

  const scrollToHelp = () => {
    if (activeView !== 'library') {
      navigateToView('library');
    }
    window.setTimeout(() => {
      const el = document.getElementById('help-center');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 80);
  };

  const openToolDetails = () => navigateToView('toolDetails');
  const openReviewsPage = () => navigateToView('reviews');
  const openAdminView = () => navigateToView('admin');
  const exitAdminView = () => navigateToView('library');
  const openSubscriptionModal = () => setIsSubModalOpen(true);

  const handleAdminConfigUpdated = useCallback(() => {
    libraryCacheRef.current.clear();
    loadSiteConfig();
    loadLibrarySection(academicGrade, effectiveSection, undefined, true);
  }, [loadSiteConfig, loadLibrarySection, academicGrade, effectiveSection]);

  return (
    <div className="min-h-screen bg-[#EEF2F7] text-slate-800 font-['iOS15Arabic',_'Cairo',_sans-serif] flex flex-col relative selection:bg-indigo-500 selection:text-white">
      <div className="sticky top-0 z-40 w-full">
        {activeView !== 'admin' && (
          <div className="w-full shadow-xs">
            <PromoTopBanner
              config={effectiveConfig}
              serverOffsetMs={serverOffsetMs}
              onOpenSubscription={openSubscriptionModal}
            />
          </div>
        )}

        <div className="w-full">
          <Navbar
            activeView={activeView}
            onSelectView={navigateToView}
            onOpenHelp={scrollToHelp}
            xp={xp}
            level={currentLevel}
          />
        </div>
      </div>

      <main className="flex-1">
        {activeView === 'admin' ? (
          <LazyErrorBoundary>
            <Suspense fallback={<SectionSkeleton />}>
              <AdminDashboard onBackToSite={exitAdminView} onConfigUpdated={handleAdminConfigUpdated} />
            </Suspense>
          </LazyErrorBoundary>
        ) : activeView === 'reviews' ? (
          <CommentsSection fullPageMode onBackToLibrary={() => navigateToView('library')} />
        ) : (
          <>
            {activeView === 'toolDetails' ? (
              <LazyErrorBoundary>
                <Suspense fallback={<SectionSkeleton />}>
                  <ToolDetailsPage
                    config={effectiveConfig}
                    onBackToLibrary={() => navigateToView('library')}
                    onOpenSubscription={openSubscriptionModal}
                  />
                </Suspense>
              </LazyErrorBoundary>
            ) : (
              <>
                <OptionalWelcomeBanner />
                <HeroSection
                  onScrollToLibrary={scrollToLibrary}
                  onOpenToolDetails={openToolDetails}
                  onOpenSubscription={openSubscriptionModal}
                />

                <HeroPromoSection
                  config={effectiveConfig}
                  onExploreTool={openToolDetails}
                  onOpenSubscription={openSubscriptionModal}
                  onOpenReviews={openReviewsPage}
                />

                <SolutionsLibrary
                  chapters={effectiveChapters}
                  loadingChapters={loadingChapters}
                  academicGrade={academicGrade}
                  onSelectGrade={handleSelectGrade}
                  activeSection={activeSection}
                  onSelectSection={(sec) => setActiveSection(sec)}
                  completedQuestions={completedQuestions}
                  onCompleteQuestion={handleCompleteQuestion}
                  onCopyTrigger={handleCopyTrigger}
                  onOpenToolDetails={openToolDetails}
                  onOpenSubscription={openSubscriptionModal}
                />
              </>
            )}

            <PollSection />

            <CommentsSection onOpenAllReviews={openReviewsPage} />

            <HelpCenterSection
              adminWhatsappDisplay={effectiveConfig?.adminWhatsappDisplay || '201550324450'}
              onOpenToolDetails={openToolDetails}
              onOpenSubscription={openSubscriptionModal}
            />

            <CommunitySection />
          </>
        )}
      </main>

      <ContactFooter
        onOpenQuran={() => setIsQuranModalOpen(true)}
        onOpenDemo={openToolDetails}
        onOpenReviews={openReviewsPage}
        onOpenHelp={scrollToHelp}
        onOpenSubscription={openSubscriptionModal}
        onOpenAdmin={openAdminView}
      />

      {activeView !== 'admin' && (
        <NotificationPrompt notificationsEnabled={effectiveConfig?.notificationsEnabled ?? true} />
      )}

      <CopyAdBanner
        isVisible={showCopyAd}
        onClose={handleCloseTimedLibraryAd}
        adConfig={effectiveConfig?.libraryAd}
        onLearnMore={openToolDetails}
        onOpenSubscription={openSubscriptionModal}
        forceTemplateMode={isPreviewRichAd ? 'rich_crovo' : undefined}
      />

      <AuthModal />
      <FirstVisitWelcomeModal />
      <TelegramInviteModal />

      {isSubModalOpen && (
        <LazyErrorBoundary>
          <Suspense fallback={null}>
            <SubscriptionModal
              isOpen={isSubModalOpen}
              onClose={() => setIsSubModalOpen(false)}
              config={effectiveConfig}
              serverOffsetMs={serverOffsetMs}
            />
          </Suspense>
        </LazyErrorBoundary>
      )}

      {isQuranModalOpen && (
        <LazyErrorBoundary>
          <Suspense fallback={null}>
            <QuranPlayer
              isOpen={isQuranModalOpen}
              onClose={() => setIsQuranModalOpen(false)}
            />
          </Suspense>
        </LazyErrorBoundary>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TelegramModalProvider>
        <AppContent />
      </TelegramModalProvider>
    </AuthProvider>
  );
}
