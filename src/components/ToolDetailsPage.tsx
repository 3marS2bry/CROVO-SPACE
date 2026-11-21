import React, { useState, useEffect } from 'react';
import { ArrowLeft, Play, ShieldCheck, Zap, Sparkles, Flame, Eye, X, ThumbsUp, MessageSquare } from 'lucide-react';
import { WhatsAppIcon, TelegramIcon } from './SocialIcons';
import { toolVideos as fallbackVideos, toolScreenshots, examSolverFaqs } from '../data/chaptersData';
import { api, ApiError, notifyLikesUpdated, PublicConfig } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { getFirebaseUid, logCloudActivity, toggleToolLikeCloud } from '../utils/cloudStore';
import { getCachedToolLikes, hasCompletedInitialBootstrap, setFastToolLikes, subscribeFastStore } from '../utils/fastStore';
import confetti from 'canvas-confetti';

interface ToolDetailsPageProps {
  onBackToLibrary: () => void;
  onOpenSubscription: () => void;
  config?: PublicConfig | null;
}

// مكون الصورة مع هيكل التحميل (UX Skeleton / Shimmer Loader) للشبكات الضعيفة
const ImageWithSkeleton: React.FC<{
  src: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}> = ({ src, alt, className = '', loading = 'lazy' }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-200">
      {!isLoaded && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-pulse p-2 text-center">
          <div className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mb-1 opacity-80" />
          <span className="text-[9px] font-bold font-ios text-slate-400">جاري التحميل...</span>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        loading={loading}
        onLoad={() => setIsLoaded(true)}
        className={`${className} transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
};

export const ToolDetailsPage: React.FC<ToolDetailsPageProps> = ({
  onBackToLibrary,
  onOpenSubscription,
  config,
}) => {
  const visibleVideos =
    config?.toolVideos && config.toolVideos.length > 0
      ? config.toolVideos.filter((v) => v.visible !== false)
      : fallbackVideos;
  const videosList = visibleVideos.length > 0 ? visibleVideos : fallbackVideos;

  const visibleServices = config?.toolServices?.filter((s) => s.isVisible) || [];

  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isCardsExpanded, setIsCardsExpanded] = useState(false);

  const safeVideoIdx = activeVideoIdx >= videosList.length ? 0 : activeVideoIdx;
  const activeVideo = videosList[safeVideoIdx] || videosList[0];

  const { user, isCloudUser, openAuthModal } = useAuth();
  const [cloudLikesCount, setCloudLikesCount] = useState<number>(() => getCachedToolLikes().count);
  const [cloudHasLiked, setCloudHasLiked] = useState<boolean>(false);
  const [apiLikesCount, setApiLikesCount] = useState<number>(() => getCachedToolLikes().count);
  const [apiHasLiked, setApiHasLiked] = useState<boolean>(() => getCachedToolLikes().liked);
  const [liking, setLiking] = useState<boolean>(false);
  const [likeError, setLikeError] = useState<string | null>(null);

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
      }
    });

    if (user?.id || (hasCompletedInitialBootstrap() && !getCachedToolLikes().resolved)) {
      api
        .getLikes('tool')
        .then((res) => {
          if (!mounted) return;
          setApiLikesCount(res.count);
          setApiHasLiked(res.liked);
          setFastToolLikes(res);
        })
        .catch(() => {});
    }

    const onLikesUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<{ itemKey: string; count: number; liked: boolean }>).detail;
      if (detail?.itemKey === 'tool') {
        setApiLikesCount(detail.count);
        setApiHasLiked(detail.liked);
      }
    };
    window.addEventListener('crovo:likes-updated', onLikesUpdated);
    return () => {
      mounted = false;
      unsubFast();
      window.removeEventListener('crovo:likes-updated', onLikesUpdated);
    };
  }, [user?.id]);

  const handleToggleLike = async () => {
    if (liking) return;
    setLiking(true);
    setLikeError(null);
    const nextDesired = !hasLiked;
    try {
      let nextLiked = nextDesired;
      try {
        const res = await api.toggleLike('tool', nextDesired);
        setApiLikesCount(res.count);
        setApiHasLiked(res.liked);
        setCloudLikesCount(res.count);
        setCloudHasLiked(res.liked);
        setFastToolLikes(res);
        notifyLikesUpdated(res);
        nextLiked = res.liked;
      } catch (apiErr) {
        if (apiErr instanceof ApiError && apiErr.status === 401) {
          openAuthModal('سجّل دخولك الأول عشان تضيف إعجابك بالأداة ويُحسب باسمك.');
          return;
        }
        const fbUid = getFirebaseUid();
        if (!fbUid) throw apiErr;
        const cloudRes = await toggleToolLikeCloud(fbUid, nextDesired);
        setCloudLikesCount(cloudRes.count);
        setCloudHasLiked(cloudRes.liked);
        setFastToolLikes({ itemKey: 'tool', count: cloudRes.count, liked: cloudRes.liked });
        nextLiked = cloudRes.liked;
      }

      const fbUid = getFirebaseUid();
      if (fbUid) {
        void logCloudActivity(fbUid, {
          eventType: nextLiked ? 'tool_like' : 'tool_unlike',
          label: nextLiked ? 'إعجاب بالأداة' : 'إلغاء الإعجاب بالأداة',
          path: '/tool',
        });
      }

      if (nextLiked) {
        try {
          confetti({
            particleCount: 25,
            spread: 45,
            origin: { y: 0.6 },
            colors: ['#4F46E5', '#6366F1', '#8B5CF6'],
            disableForReducedMotion: true,
          });
        } catch {}
      }
    } catch (err) {
      setLikeError(err instanceof Error ? err.message : 'تعذر تسجيل الإعجاب.');
    } finally {
      setLiking(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-12 text-right animate-in fade-in duration-300">
      {/* 1. Top Breadcrumb & Back Button */}
      <div className="flex items-center justify-between mb-6 sm:mb-8">
        <button
          onClick={onBackToLibrary}
          className="clay-btn py-2 px-4 sm:px-5 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-ios"
        >
          <ArrowLeft className="w-4 h-4 rotate-180" />
          <span>الرجوع لمكتبة الحلول</span>
        </button>

        <div className="text-xs sm:text-sm font-semibold font-decorative text-slate-500">
          تطوير: <span className="text-indigo-600 font-bold">عُـمـر صَـبـري</span>
        </div>
      </div>

      {/* 2. Main Pitch Hero Banner (الفكرة باختصار من غير لف ودوران) */}
      <div className="clay-card p-4 sm:p-8 mb-6 sm:mb-8 relative overflow-hidden border border-white/80">
        <div className="max-w-4xl space-y-3 sm:space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full clay-inset text-amber-700 text-xs font-bold font-decorative">
              <Flame className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
              <span>صلي على النبي بقى 🤍</span>
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full clay-inset text-slate-700 text-xs font-bold font-decorative">
              <span className="text-indigo-600 font-bold">𝕯𝖊𝖛 : عُـمـر صَـبـري</span>
            </div>
          </div>

          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black font-decorative text-slate-900 leading-[1.3] tracking-tight">
            الفكرة باختصار{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-600">
              (من غير لف ودوران)
            </span>
          </h1>

          <div className="p-3.5 sm:p-5 rounded-2xl clay-inset text-slate-700 text-xs sm:text-base leading-relaxed space-y-2.5">
            <p className="font-bold font-decorative text-slate-900 text-sm sm:text-lg">
              بص يا مدير.. إحنا عارفين الحوار وما فيه؛
            </p>
            <p className="font-ios text-xs sm:text-base text-slate-700 leading-relaxed">
              قدامك 87 فصل وأكتر من 600 سؤال وكود مطلوبين منك، يا إما تقعد تسحل نفسك ليل نهار نسخ ولصق وتدعك عينك وتضيع يومك كله..{' '}
              <span className="font-bold text-indigo-600">يا إما تشغل دماغك!</span>
            </p>
            <div className="pt-1">
              <span className="font-bold text-xs sm:text-lg font-decorative">
                عملتلك أداة بتوفّر وقتك وتنجز المهام بهدوء ودقة! ✨
              </span>
            </div>
          </div>

          {/* Dynamic Admin-Managed Tool Services Badges (when configured) */}
          {visibleServices.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {visibleServices.map((svc) => (
                <div
                  key={svc.key}
                  className="px-3 py-1.5 rounded-xl clay-inset text-[11px] font-bold text-slate-700 font-ios flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>{svc.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Quick CTA Buttons & Real Shared Like Counter */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={onOpenSubscription}
              className="clay-whatsapp px-4 sm:px-5 py-2.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-md text-white font-ios"
            >
              <WhatsAppIcon className="w-4 h-4" />
              <span>عاوز اشترك يخوياااا</span>
            </button>

            <button
              type="button"
              onClick={onOpenSubscription}
              data-testid="tool-hero-telegram-btn"
              className="clay-telegram px-3.5 sm:px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-2 text-white font-ios cursor-pointer"
            >
              <TelegramIcon className="w-4 h-4" />
              <span>اشتراك تليجرام</span>
            </button>

            {/* Real Shared DB Like Toggle */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={liking}
                onClick={handleToggleLike}
                data-testid="tool-like-btn"
                className={`px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-transform font-ios shadow-sm disabled:opacity-60 ${
                  hasLiked
                    ? 'bg-gradient-to-r from-indigo-600 to-sky-600 text-white shadow-md'
                    : 'clay-btn text-slate-800 hover:text-indigo-600'
                }`}
              >
                <ThumbsUp className={`w-4 h-4 ${hasLiked ? 'fill-white text-white' : 'text-indigo-600'}`} />
                <span>{hasLiked ? 'تم الإعجاب ✓' : 'إعجاب بالأداة'}</span>
                <span
                  data-testid="tool-likes-count"
                  className="font-mono px-2 py-0.5 rounded-lg bg-black/10 font-black text-xs tabular-nums"
                >
                  {likesCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('student-comments');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="clay-btn px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 text-slate-700 font-ios"
              >
                <MessageSquare className="w-4 h-4 text-indigo-500" />
                <span>التعليقات</span>
              </button>
            </div>
          </div>
          {likeError && (
            <p className="text-xs font-bold text-rose-600 font-ios pt-1">
              {likeError}
            </p>
          )}
        </div>
      </div>

      {/* 3. The Mechanism Breakdown */}
      <div className="clay-card p-4 sm:p-5 mb-5 sm:mb-7 border border-white/80">
        <div className="text-right max-w-3xl mb-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full clay-inset text-indigo-700 text-[11px] font-bold mb-1 font-decorative">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
            <span>حماية الحساب ومحاكاة السلوك البشري الطبيعي</span>
          </div>
          <h2 className="text-base sm:text-xl font-black font-decorative text-slate-900">
            الميكانيزم شغال إزاي؟
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-600 font-ios mt-0.5 leading-relaxed">
            مش مجرد سكربت أعمى بيرمي حلول؛ بيانات دخولك بتتحول لجلسة دخول آمنة مع محاكاة دقيقة لحركة وتفكير الطالب البشري.
          </p>
        </div>

        {/* 3 Core Mechanism Steps Compact Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div className="clay-inset p-3 rounded-2xl space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl clay-apple-blue flex items-center justify-center text-white font-bold text-xs shadow-sm font-mono shrink-0">
                1
              </div>
              <h3 className="text-xs sm:text-sm font-bold font-ios text-slate-900">
                دخول آمن بدون كشف البيانات
              </h3>
            </div>
            <p className="text-[11px] text-slate-600 font-ios leading-normal">
              دخولك بيتأمّن بجلسة مؤقتة وبتسجل دخول كأنك أنت بالظبط من متصفحك الطبيعي بدون أي كشف لكلمة السر.
            </p>
          </div>

          <div className="clay-inset p-3 rounded-2xl space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-sm font-mono shrink-0">
                2
              </div>
              <h3 className="text-xs sm:text-sm font-bold font-ios text-slate-900">
                محاكاة السلوك البشري الطبيعي
              </h3>
            </div>
            <p className="text-[11px] text-slate-600 font-ios leading-normal">
              الأداة بتكتب كود خطوة بخطوة بالراحة، وتوقف تفكر في المسائل المقالية وتتنقل بنعومة، والمنصة تحلف إنك أينشتاين ومفيش أي شك!
            </p>
          </div>

          <div className="clay-inset p-3 rounded-2xl space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-sm font-mono shrink-0">
                3
              </div>
              <h3 className="text-xs sm:text-sm font-bold font-ios text-slate-900">
                توفير الوقت وإنجاز أسرع
              </h3>
            </div>
            <p className="text-[11px] text-slate-600 font-ios leading-normal">
              الأداة بتنفذ المهام بـ {config ? (config.offerActive ? config.qureoOfferPrice : config.qureoOldPrice) : 50}ج فقط بعد تأكيد الطلب، وبتساعدك تنهي الفصول بسرعة وانتظام (مع توفر Python قريباً للأداة).
            </p>
          </div>
        </div>
      </div>

      {/* 4. Vertical Video Demonstrations */}
      <div className="clay-card p-5 sm:p-10 mb-8 sm:mb-10 border border-white/80">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6 sm:mb-8">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl clay-inset text-indigo-600 text-xs font-bold mb-1 font-decorative">
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>فيديوهات الشاشة الحقيقية أثناء الحل</span>
            </div>
            <h2 className="text-xl sm:text-3xl font-black font-ios text-slate-900">
              شاهد تسجيل الشاشة الحقيقي للأداة أثناء حل الامتحان
            </h2>
          </div>

          <div className="clay-pill-track flex items-center gap-1 p-1 text-xs font-bold font-decorative">
            {videosList.map((vid, idx) => (
              <button
                key={idx}
                type="button"
                data-testid={`tool-video-tab-${idx}`}
                onClick={() => setActiveVideoIdx(idx)}
                className={`px-3.5 py-1.5 rounded-full transition-transform duration-150 ${
                  safeVideoIdx === idx
                    ? 'clay-pill-active'
                    : 'text-slate-600 hover:text-indigo-600'
                }`}
              >
                {vid.tag}
              </button>
            ))}
          </div>
        </div>

        <div className="py-4 sm:py-6 flex flex-col items-center">
          <div className="w-full max-w-[310px] sm:max-w-[340px] rounded-[2.5rem] p-3 sm:p-4 clay-inset bg-white border border-slate-200/80 shadow-xl relative">
            <div className="w-24 h-4 bg-slate-300 rounded-full mx-auto mb-2 flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="w-8 h-1.5 rounded-full bg-slate-400/80" />
            </div>

            <div className="aspect-[9/16] w-full rounded-2xl overflow-hidden bg-black relative flex items-center justify-center shadow-inner">
              <video
                key={activeVideo.src}
                controls
                playsInline
                preload="metadata"
                className="w-full h-full object-cover"
                poster="/media/screenshots/Screenshot_20261031-100300.jpg"
              >
                <source src={activeVideo.src} type="video/mp4" />
                متصفحك لا يدعم تشغيل الفيديو.
              </video>
            </div>

            <div className="pt-3 px-1 text-right">
              <h3 className="text-xs sm:text-sm font-bold font-ios text-slate-900">
                {activeVideo.title}
              </h3>
              <p className="text-[11px] text-slate-500 font-ios mt-1 leading-relaxed">
                {activeVideo.description}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Gallery */}
      <div className="clay-card p-5 sm:p-10 mb-8 sm:mb-10 border border-white/80 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="text-right max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl clay-inset text-indigo-600 text-xs font-bold mb-1 font-decorative">
              <Eye className="w-3.5 h-3.5" />
              <span>معرض إثباتات ونتائج الطلاب</span>
            </div>
            <h2 className="text-xl sm:text-3xl font-black font-decorative text-slate-900">
              معرض إثباتات وتجارب الطلاب الفعلية بالهاتف
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 font-ios mt-1">
              لقطات حقيقية لنتائج حل المستويات والامتحانات. اضغط على أي صورة لمعاينتها بأريحية!
            </p>
          </div>

          <button
            onClick={() => setIsCardsExpanded((prev) => !prev)}
            className="clay-btn px-4 py-2.5 rounded-2xl text-xs font-bold text-indigo-600 font-decorative flex items-center justify-center gap-2 shrink-0 shadow-sm"
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>{isCardsExpanded ? 'عرض مضغوط ⚡' : 'الانتشار كبطاقات تفاعلية 🎴'}</span>
          </button>
        </div>

        {isCardsExpanded ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 pt-2">
            {toolScreenshots.map((item, idx) => (
              <div
                key={`grid-${idx}`}
                onClick={() => setSelectedImage(item.src)}
                className="clay-btn p-2 rounded-2xl cursor-pointer group hover:scale-[1.03] transition-transform text-right overflow-hidden border border-indigo-200/40"
              >
                <div className="aspect-[9/16] rounded-xl overflow-hidden bg-slate-900 relative mb-2">
                  <ImageWithSkeleton
                    src={item.src}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="px-1">
                  <div className="text-[11px] font-bold font-decorative text-slate-900 truncate">
                    {item.title}
                  </div>
                  <div className="text-[10px] text-slate-500 font-ios line-clamp-1 mt-0.5">
                    {item.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4 pt-2">
            {toolScreenshots.map((item, idx) => (
              <div
                key={`compact-${idx}`}
                onClick={() => setIsCardsExpanded(true)}
                className="w-28 shrink-0 clay-btn p-1.5 rounded-xl cursor-pointer group hover:scale-[1.02] transition-transform overflow-hidden"
              >
                <div className="aspect-[9/16] rounded-lg overflow-hidden bg-slate-900 relative">
                  <ImageWithSkeleton
                    src={item.src}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox Modal (lightweight overlay without heavy backdrop-blur) */}
      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-3 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-sm sm:max-w-md w-full max-h-[90vh] rounded-3xl overflow-hidden clay-card p-3 bg-slate-900 text-white flex flex-col animate-modal-pop"
          >
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 left-4 p-2 rounded-full bg-black/60 hover:bg-black/90 text-white z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <ImageWithSkeleton
              src={selectedImage}
              alt="Screenshot full view"
              className="w-full h-auto max-h-[82vh] object-contain rounded-2xl"
            />
          </div>
        </div>
      )}

      {/* 6. FAQ Section */}
      <div className="clay-card p-4 sm:p-6 mb-6 sm:mb-8 border border-white/80">
        <h2 className="text-base sm:text-xl font-black font-ios text-slate-900 mb-4">
          الأسئلة اللي في بالك وإجابتها ع البلاطة:
        </h2>

        <div className="space-y-3">
          {examSolverFaqs.map((faq, idx) => (
            <div key={idx} className="clay-inset p-3 sm:p-4 rounded-xl text-right space-y-1">
              <h3 className="text-xs sm:text-sm font-bold font-ios text-slate-900 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span>{faq.q}</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-600 font-ios leading-relaxed pr-3">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 7. Final Conversion CTA */}
      <div className="clay-card p-5 sm:p-8 text-center bg-gradient-to-r from-indigo-50/90 via-sky-50/80 to-purple-50/90 border border-white/80">
        <h2 className="text-xl sm:text-3xl font-black font-decorative text-slate-900 mb-2">
          عايز تشترك وتريح جمجمتك؟
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 font-ios max-w-xl mx-auto mb-4 leading-relaxed">
          اضغط زر"عاوز اشترك يخوياااا" عشان تختار سنتك الدراسية والمنصات وتسجل طلبك في ثواني، أو تابع قناة الإثباتات والتحديثات على تليجرام: @CrovoSpace.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onOpenSubscription}
            className="clay-whatsapp inline-flex items-center gap-2 px-5 sm:px-6 py-3 rounded-2xl text-xs sm:text-sm font-bold shadow-lg hover:scale-105 active:scale-95 transition-transform text-white font-ios"
          >
            <WhatsAppIcon className="w-4 h-4 shrink-0" />
            <span>عاوز اشترك يخوياااا</span>
          </button>

          <button
            type="button"
            onClick={onOpenSubscription}
            data-testid="tool-cta-telegram-btn"
            className="clay-telegram inline-flex items-center gap-2 px-4 sm:px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold shadow-md hover:scale-105 active:scale-95 transition-transform text-white font-ios cursor-pointer"
          >
            <TelegramIcon className="w-4 h-4 shrink-0" />
            <span>اشتراك تليجرام</span>
          </button>
        </div>
      </div>
    </div>
  );
};
