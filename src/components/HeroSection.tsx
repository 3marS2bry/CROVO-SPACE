import React, { useEffect, useState } from 'react';
import { ArrowDown, Zap, CheckCircle2, ShieldCheck, Sparkles, BookOpen, ThumbsUp } from 'lucide-react';
import { WhatsAppIcon, TelegramIcon } from './SocialIcons';
import { api, ApiError, notifyLikesUpdated } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { getFirebaseUid, logCloudActivity, toggleToolLikeCloud } from '../utils/cloudStore';
import { getCachedToolLikes, hasCompletedInitialBootstrap, setFastToolLikes, subscribeFastStore } from '../utils/fastStore';

interface HeroSectionProps {
  onScrollToLibrary: () => void;
  onOpenToolDetails: () => void;
  onOpenSubscription: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onScrollToLibrary,
  onOpenToolDetails,
  onOpenSubscription,
}) => {
  const { user, isCloudUser, openAuthModal } = useAuth();
  const [cloudLikesCount, setCloudLikesCount] = useState(() => getCachedToolLikes().count);
  const [cloudHasLiked, setCloudHasLiked] = useState(false);
  const [apiLikesCount, setApiLikesCount] = useState(() => getCachedToolLikes().count);
  const [apiHasLiked, setApiHasLiked] = useState(() => getCachedToolLikes().liked);
  const [likesResolved, setLikesResolved] = useState(() => getCachedToolLikes().resolved);
  const [liking, setLiking] = useState(false);
  const [browseBurst, setBrowseBurst] = useState(false);

  const likesCount = Math.max(apiLikesCount, cloudLikesCount);
  const hasLiked = isCloudUser ? (apiHasLiked || cloudHasLiked) : apiHasLiked;

  useEffect(() => {
    let mounted = true;

    const unsubFast = subscribeFastStore(() => {
      if (!mounted) return;
      const cached = getCachedToolLikes();
      if (cached.resolved) {
        setApiLikesCount(cached.count);
        setApiHasLiked(cached.liked);
        setLikesResolved(true);
      }
    });

    // Only fetch /api/likes independently if user signed in (for personalized liked flag) or bootstrap already completed without resolving likes
    if (user?.id || (hasCompletedInitialBootstrap() && !getCachedToolLikes().resolved)) {
      api
        .getLikes('tool')
        .then((res) => {
          if (!mounted) return;
          if (res.quotaDegraded && res.count === 0 && getCachedToolLikes().count > 0) {
            setApiHasLiked(res.liked);
            setLikesResolved(true);
            return;
          }
          setApiLikesCount(res.count);
          setApiHasLiked(res.liked);
          setLikesResolved(true);
          if (!res.quotaDegraded || res.count > 0) {
            setFastToolLikes(res);
          }
        })
        .catch(() => {});
    }

    const onLikesUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<{ itemKey: string; count: number; liked: boolean }>).detail;
      if (detail?.itemKey === 'tool') {
        setApiLikesCount(detail.count);
        setApiHasLiked(detail.liked);
        setLikesResolved(true);
      }
    };
    window.addEventListener('crovo:likes-updated', onLikesUpdated);
    return () => {
      mounted = false;
      unsubFast();
      window.removeEventListener('crovo:likes-updated', onLikesUpdated);
    };
  }, [user?.id]);

  // Finite attention bursts for "تصفح مكتبة الحلول المجانية" (plays 4 times spaced apart, then rests naturally)
  useEffect(() => {
    let burstCount = 0;
    const maxBursts = 4;
    let hideTimer: number | undefined;
    let intervalTimer: number | undefined;

    const triggerBurst = () => {
      if (burstCount >= maxBursts) {
        if (intervalTimer) window.clearInterval(intervalTimer);
        return;
      }
      burstCount += 1;
      setBrowseBurst(true);
      hideTimer = window.setTimeout(() => {
        setBrowseBurst(false);
      }, 1250);
    };

    const startTimer = window.setTimeout(() => {
      triggerBurst();
      intervalTimer = window.setInterval(triggerBurst, 8000);
    }, 1200);

    return () => {
      window.clearTimeout(startTimer);
      if (hideTimer) window.clearTimeout(hideTimer);
      if (intervalTimer) window.clearInterval(intervalTimer);
    };
  }, []);

  const handleToggleLike = async () => {
    if (liking) return;
    setLiking(true);
    const nextDesired = !hasLiked;
    try {
      const res = await api.toggleLike('tool', nextDesired);
      setApiLikesCount(res.count);
      setApiHasLiked(res.liked);
      setCloudLikesCount(res.count);
      setCloudHasLiked(res.liked);
      setLikesResolved(true);
      setFastToolLikes(res);
      notifyLikesUpdated(res);
      const fbUid = getFirebaseUid();
      if (fbUid) {
        void logCloudActivity(fbUid, {
          eventType: res.liked ? 'tool_like' : 'tool_unlike',
          label: res.liked ? 'إعجاب بالأداة' : 'إلغاء الإعجاب بالأداة',
          path: '/',
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        openAuthModal('سجّل دخولك الأول عشان تضيف إعجابك بالأداة ويُحسب باسمك.');
        return;
      }
      const fbUid = getFirebaseUid();
      if (fbUid) {
        try {
          const cloudRes = await toggleToolLikeCloud(fbUid, nextDesired);
          setCloudLikesCount(cloudRes.count);
          setCloudHasLiked(cloudRes.liked);
          setLikesResolved(true);
          setFastToolLikes({ itemKey: 'tool', count: cloudRes.count, liked: cloudRes.liked });
        } catch {}
      }
    } finally {
      setLiking(false);
    }
  };

  return (
    <section className="relative overflow-hidden py-4 sm:py-8 px-3 sm:px-6">
      <div className="max-w-6xl mx-auto clay-card p-5 sm:p-10 relative overflow-hidden text-right border border-white/80">
        {/* Subtle Ambient Soft Indigo/Purple Glow in Corner (zero filter-blur cost) */}
        <div className="hidden sm:block absolute top-0 left-0 w-80 h-80 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.12),rgba(168,85,247,0.06)_50%,transparent_75%)] pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-6 sm:gap-8">
          {/* Main Content Side */}
          <div className="flex-1 space-y-3.5 sm:space-y-4">
            {/* Top Badges Row */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Badge: صلي على النبي بقى */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-2xl clay-inset text-xs font-bold text-indigo-700 font-decorative">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>صلي على النبي بقى 🤍</span>
              </div>

              {/* Tag: 𝕯𝖊𝖛 : عُـمـر صَـبـري */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-2xl clay-inset text-xs font-bold text-indigo-600 font-decorative">
                <span>𝕯𝖊𝖛 : عُـمـر صَـبـري</span>
              </div>

              {/* Tag: حلول منظمة ومعتمدة */}
              <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-2xl clay-inset text-xs font-bold text-indigo-700 font-decorative">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                <span>حلول منظمة ومراجعة</span>
              </div>
            </div>

            {/* Main Punchy Headline in Decorative Arabic Calligraphy Font */}
            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black font-decorative text-slate-900 leading-[1.3] sm:leading-[1.35] tracking-tight">
              بص يا مدير.. إحنا عارفين الحوار وما فيه،
              <span className="block mt-1">
                عملتلك أداة بتوفّر وقتك وتنجز المنصة بسلاسة! ✨
              </span>
            </h1>

            {/* Expressive Display Paragraph */}
            <p className="text-xs sm:text-sm md:text-base text-slate-700 font-medium leading-relaxed max-w-2xl font-ios">
              قدامك 87 فصل وأكتر من 600 سؤال وكود مطلوبين منك في أولى وتانية بكالوريا؛ بدل ما تقضي ساعات في النسخ والبحث، جهزتلك مكتبة حلول نموذجية مجانية بالكامل، وأداة ذكية مصممة بمحاكاة بشرية هادئة لتسهيل إنجاز المهام بسرعة وأمان.
            </p>

            {/* Tactile Highlights Badges with decorative font */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-bold text-slate-700 font-decorative">
              <div className="px-3 py-1.5 rounded-xl clay-inset flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>أولى بكالوريا: 42 مستوى جافا</span>
              </div>
              <div className="px-3 py-1.5 rounded-xl clay-inset flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span>تانية بكالوريا: جافا + مالية (بايثون قريباً للأداة)</span>
              </div>
              <div className="px-3 py-1.5 rounded-xl clay-inset flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                <span>محاكاة بشرية هادئة لحسابك</span>
              </div>
            </div>
          </div>

          {/* Action Callouts Buttons with Deep Apple Claymorphism */}
          <div className="flex flex-col gap-2.5 sm:gap-3 shrink-0 w-full lg:w-72 pt-2 lg:pt-0">
            <button
              type="button"
              onClick={onOpenToolDetails}
              className="clay-apple-blue py-3 sm:py-3.5 px-4 sm:px-5 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-lg text-white font-ios"
            >
              <Zap className="w-4 h-4 fill-amber-300 text-amber-300" />
              <span>إزاي الأداة بتشتغل؟</span>
            </button>

            <button
              type="button"
              onClick={onScrollToLibrary}
              data-testid="hero-browse-library-btn"
              className={`clay-purple-soft py-2.5 sm:py-3 px-4 sm:px-5 rounded-2xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 font-ios ${
                browseBurst ? 'is-attention-burst ring-2 ring-indigo-400/50' : ''
              }`}
            >
              <BookOpen className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>تصفح مكتبة الحلول المجانية</span>
              <ArrowDown className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            </button>

            {/* Quick Chat Strip */}
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={onOpenSubscription}
                title="اشترك الآن عبر نافذة الاشتراك"
                className="clay-whatsapp flex-1 py-2 sm:py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 text-white font-ios"
              >
                <WhatsAppIcon className="w-4 h-4 shrink-0" />
                <span className="truncate">عاوز اشترك يخوياااا</span>
              </button>

              <button
                type="button"
                onClick={onOpenSubscription}
                data-testid="hero-telegram-btn"
                title="تواصل مع المطور للاشتراك عبر تليجرام"
                aria-label="تواصل مع المطور للاشتراك عبر تليجرام"
                className="clay-telegram p-2 sm:py-2.5 px-3 rounded-xl flex items-center justify-center text-white shrink-0 cursor-pointer"
              >
                <TelegramIcon className="w-4 h-4" />
              </button>

              <button
                type="button"
                disabled={liking}
                onClick={handleToggleLike}
                data-testid="hero-like-btn"
                title={hasLiked ? 'إلغاء الإعجاب' : 'أعجبني CROVO SPACE'}
                className={`py-2 sm:py-2.5 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 font-ios transition-all ${
                  hasLiked
                    ? 'clay-apple-blue text-white shadow-sm'
                    : 'clay-btn text-slate-700 hover:text-indigo-600'
                }`}
              >
                <ThumbsUp className={`w-3.5 h-3.5 ${hasLiked ? 'fill-white text-white' : ''}`} />
                <span data-testid="hero-likes-count" className="font-mono tabular-nums min-w-[1ch] text-center">
                  {likesResolved || likesCount > 0 ? likesCount : '···'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
