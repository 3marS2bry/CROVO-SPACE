import React, { useEffect } from 'react';
import { ArrowLeft, CheckCircle2, Sparkles, X, Zap } from 'lucide-react';
import type { PublicConfig } from '../utils/api';

interface CopyAdBannerProps {
  isVisible: boolean;
  onClose: () => void;
  adConfig?: PublicConfig['libraryAd'];
  onLearnMore: () => void;
  onOpenSubscription: () => void;
  forceTemplateMode?: 'classic' | 'rich_crovo';
}

const RICH_AD_FEATURES = [
  'توفير كبير في الوقت والمجهود',
  'محاكاة بشرية ذكية وآمنة',
  'تشفير البيانات وحمايتها',
  'مكتبة حلول مجانية ومنظمة',
  'مناسبة لطلاب أولى وتانية بكالوريا',
];

export const CopyAdBanner: React.FC<CopyAdBannerProps> = ({
  isVisible,
  onClose,
  adConfig,
  onLearnMore,
  onOpenSubscription,
  forceTemplateMode,
}) => {
  useEffect(() => {
    if (!isVisible) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isVisible, onClose]);

  if (!isVisible) return null;
  if (!forceTemplateMode && adConfig && !adConfig.enabled) return null;

  const templateMode = forceTemplateMode || adConfig?.templateMode || 'classic';
  const imageUrl = adConfig?.imageUrl || '/media/crovo-promo-ad.jpg';
  const ctaLink = adConfig?.ctaLink || '#tool';

  const handleCtaAction = () => {
    onClose();
    if (ctaLink === '#subscribe') {
      onOpenSubscription();
    } else if (ctaLink.startsWith('http://') || ctaLink.startsWith('https://')) {
      window.location.href = ctaLink;
    } else {
      onLearnMore();
    }
  };

  if (templateMode === 'rich_crovo') {
    const title = adConfig?.title || 'لسه بتضيع ساعات في حل المنصات؟';
    const subtitle =
      adConfig?.subtitle || 'مع CROVO SPACE، خلّص مهامك التعليمية بسهولة وفي وقت أقل.';
    const priceText = adConfig?.priceText || 'عرض الأداة بسعر 50 جنيه فقط.';
    const ctaText = adConfig?.ctaText || 'اكتشف العرض الآن ⚡';

    return (
      <div
        data-testid="library-copy-ad-rich"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rich-ad-title"
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md sm:max-w-xl max-h-[92vh] overflow-y-auto clay-card bg-[#EEF2F7] p-4 sm:p-7 rounded-3xl border border-white/95 shadow-2xl relative text-right animate-modal-pop"
        >
          {/* Prominent Close Button */}
          <button
            type="button"
            data-testid="library-ad-close-btn"
            aria-label="إغلاق الإعلان"
            onClick={onClose}
            className="sticky sm:absolute top-3 left-3 float-left sm:float-none z-20 w-9 h-9 rounded-full clay-btn flex items-center justify-center text-slate-600 hover:text-rose-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Brand & Hero Illustration */}
          <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
            <div className="w-full sm:w-44 shrink-0 rounded-2xl overflow-hidden clay-inset p-1.5 bg-white/90">
              <img
                src={imageUrl}
                alt="CROVO SPACE"
                className="w-full h-36 sm:h-40 object-cover rounded-xl"
              />
            </div>

            <div className="flex-1 space-y-1.5 text-center sm:text-right">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-indigo-700 text-[11px] font-black shadow-sm border border-indigo-100 font-ios">
                <img
                  src="/icon-192.png"
                  alt=""
                  className="w-4 h-4 rounded-sm object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
                <span>CROVO SPACE</span>
              </div>

              <h2
                id="rich-ad-title"
                className="text-lg sm:text-2xl font-black font-decorative text-slate-900 leading-snug"
              >
                {title}
              </h2>
              <p className="text-xs sm:text-sm font-bold text-indigo-700 font-ios leading-relaxed">
                {subtitle}
              </p>
            </div>
          </div>

          {/* Core Educational Body Copy */}
          <div className="clay-inset p-3.5 sm:p-4 rounded-2xl mb-4 space-y-3 bg-white/75">
            <p className="text-xs sm:text-sm font-medium text-slate-700 font-ios leading-relaxed">
              مكتبة حلول تعليمية منظمة تضم 87 فصلًا وأكثر من 600 سؤال في البرمجة والثقافة المالية، بالإضافة إلى أداة تساعدك على إنجاز المهام التعليمية بسرعة وكفاءة.
            </p>

            {/* 5 Highlights */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
              {RICH_AD_FEATURES.map((feat, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-slate-800 font-ios"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>{feat}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Offer Price Box */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-l from-indigo-600 via-purple-600 to-indigo-700 text-white text-center mb-4 shadow-md">
            <div className="inline-flex items-center justify-center gap-1.5 text-sm sm:text-base font-black font-ios">
              <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
              <span>{priceText}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <button
              type="button"
              data-testid="rich-ad-primary-cta"
              onClick={handleCtaAction}
              className="clay-apple-blue flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-black shadow-md font-ios flex items-center justify-center gap-2"
            >
              <span>{ctaText}</span>
              <ArrowLeft className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="clay-btn sm:w-36 py-3 px-4 rounded-2xl text-xs font-bold text-slate-600 hover:text-slate-900 font-ios text-center"
            >
              العودة للمكتبة
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Classic Ad Popup Template
  const title = adConfig?.title || 'لسه بتحل المنصة بنفسك؟';
  const subtitle = adConfig?.subtitle || 'وفر وقتك مع أداة CROVO';
  const priceText = adConfig?.priceText || 'حل المنصة بالكامل بـ50 جنيه فقط';
  const ctaText = adConfig?.ctaText || 'اعرف أكتر';

  return (
    <div
      data-testid="library-copy-ad"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-ad-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md sm:max-w-lg clay-card bg-[#EEF2F7] p-5 sm:p-8 rounded-3xl border border-white/95 shadow-2xl relative text-right animate-modal-pop"
      >
        <button
          type="button"
          data-testid="library-ad-close-btn"
          aria-label="إغلاق الإعلان"
          onClick={onClose}
          className="absolute top-4 left-4 w-9 h-9 rounded-full clay-btn flex items-center justify-center text-slate-600 hover:text-rose-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center text-center pt-1 mb-5">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg mb-2.5">
            <Zap className="w-8 h-8 text-amber-300 fill-amber-300" />
          </div>
          <span className="px-3 py-0.5 rounded-full bg-white text-indigo-700 text-[10px] font-black shadow-sm border border-indigo-100 font-ios whitespace-nowrap">
            CROVO SPACE
          </span>

          <h2
            id="library-ad-title"
            className="text-xl sm:text-2xl font-black font-decorative text-slate-900 mt-1.5"
          >
            {title}
          </h2>
          <p className="text-sm sm:text-base font-bold text-slate-600 font-ios mt-1.5">
            {subtitle}
          </p>
        </div>

        <div className="clay-inset p-4 rounded-2xl text-center mb-5 bg-gradient-to-r from-indigo-50/90 via-white/80 to-purple-50/90">
          <div className="inline-flex items-center justify-center gap-1.5 text-sm sm:text-base font-black text-indigo-700 font-ios">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
            <span>{priceText}</span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 font-ios mt-1">
            تنفيذ أوتوماتيكي بمحاكاة بشرية هادئة — يخلصلك كل الفصول في دقايق.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <button
            type="button"
            onClick={handleCtaAction}
            className="clay-purple-soft flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-black shadow-md font-ios flex items-center justify-center gap-2"
          >
            <span>{ctaText}</span>
            <ArrowLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSubscription();
            }}
            className="clay-whatsapp flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-black text-white shadow-md font-ios"
          >
            عاوز اشترك يخوياااا
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full py-2 text-center text-xs font-bold text-slate-500 hover:text-slate-800 font-ios transition-colors"
        >
          تخطي والعودة للمكتبة
        </button>
      </div>
    </div>
  );
};
