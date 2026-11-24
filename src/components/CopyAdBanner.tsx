import React, { useEffect } from 'react';
import { ArrowLeft, CheckCircle2, Sparkles, X, Zap } from 'lucide-react';
import type { PublicConfig } from '../utils/api';
import {
  type AdUnitConfig,
  getAdCardStyle,
  renderDynamicAdText,
  sanitizeAdMediaUrl,
} from '../utils/adSystem';
import { AdIcon } from './ads/AdIcon';
import { type AdActionHandlers, AdUnitRenderer, triggerAdCtaLink } from './ads/AdUnitRenderer';

interface CopyAdBannerProps {
  isVisible: boolean;
  onClose: () => void;
  adConfig?: PublicConfig['libraryAd'];
  fullAdUnit?: AdUnitConfig;
  config?: PublicConfig | null;
  onLearnMore: () => void;
  onOpenSubscription: () => void;
  actions?: AdActionHandlers;
  forceTemplateMode?: 'classic' | 'rich_crovo' | 'custom';
  forceMobile?: boolean;
  isPreview?: boolean;
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
  fullAdUnit,
  config,
  onLearnMore,
  onOpenSubscription,
  actions,
  forceTemplateMode,
  forceMobile,
  isPreview = false,
}) => {
  const unit =
    fullAdUnit ||
    config?.ads?.find((a) => a.systemKey === 'library_popup' || a.id === 'ad_library_popup');

  useEffect(() => {
    if (!isVisible) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (unit ? unit.behavior.closable : true)) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isVisible, onClose, unit]);

  if (!isVisible) return null;
  if (!forceTemplateMode && !isPreview && adConfig && !adConfig.enabled) return null;

  const templateMode =
    forceTemplateMode || unit?.content.templateMode || adConfig?.templateMode || 'classic';

  const effectiveActions: AdActionHandlers = actions || {
    onOpenSubscription,
    onExploreTool: onLearnMore,
    onOpenReviews: onLearnMore,
  };

  if (templateMode === 'custom' && unit) {
    return (
      <div
        data-testid="library-copy-ad-custom"
        role="dialog"
        aria-modal="true"
        onClick={() => {
          if (unit.behavior.closable) onClose();
        }}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-xl max-h-[92vh] overflow-y-auto"
        >
          <AdUnitRenderer
            ad={unit}
            config={config}
            forceMobile={forceMobile}
            onClose={unit.behavior.closable ? onClose : undefined}
            actions={effectiveActions}
            mode="modal"
            isPreview={isPreview}
          />
        </div>
      </div>
    );
  }

  const pricingVars = {
    qureoOfferPrice: config?.qureoOfferPrice ?? 50,
    qureoOldPrice: config?.qureoOldPrice ?? 100,
    bundleOfferPrice: config?.bundleOfferPrice ?? 100,
    bundleOldPrice: config?.bundleOldPrice ?? 200,
  };

  const imageUrl = sanitizeAdMediaUrl(
    unit?.content.mediaUrl || adConfig?.imageUrl,
    '/media/crovo-promo-ad.jpg'
  );
  const ctaLink = unit?.content.ctaLink || adConfig?.ctaLink || '#tool';
  const closable = unit ? unit.behavior.closable : true;

  const handleCtaAction = () => {
    triggerAdCtaLink(ctaLink, effectiveActions, onClose);
  };

  const isMobilePreview = Boolean(forceMobile);
  const customCardStyle = unit
    ? {
        ...getAdCardStyle(unit.design, isMobilePreview),
        marginTop: 0,
        marginBottom: 0,
      }
    : undefined;

  if (templateMode === 'rich_crovo') {
    const title = renderDynamicAdText(
      unit?.content.title || adConfig?.title || 'لسه بتضيع ساعات في حل المنصات؟',
      pricingVars
    );
    const subtitle = renderDynamicAdText(
      unit?.content.subtitle ||
        adConfig?.subtitle ||
        'مع CROVO SPACE، خلّص مهامك التعليمية بسهولة وفي وقت أقل.',
      pricingVars
    );
    const priceText = renderDynamicAdText(
      unit?.content.priceText || adConfig?.priceText || 'عرض الأداة بسعر 50 جنيه فقط.',
      pricingVars
    );
    const ctaText = renderDynamicAdText(
      unit?.content.ctaText || adConfig?.ctaText || 'اكتشف العرض الآن ⚡',
      pricingVars
    );
    const description = renderDynamicAdText(
      unit?.content.description ||
        'مكتبة حلول تعليمية منظمة تضم 87 فصلًا وأكثر من 600 سؤال في البرمجة والثقافة المالية، بالإضافة إلى أداة تساعدك على إنجاز المهام التعليمية بسرعة وكفاءة.',
      pricingVars
    );

    return (
      <div
        data-testid="library-copy-ad-rich"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rich-ad-title"
        onClick={() => {
          if (closable) onClose();
        }}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={
            customCardStyle
              ? {
                  ...customCardStyle,
                  background: unit?.design.gradientEnabled ? customCardStyle.background : unit?.design.backgroundColor || '#EEF2F7',
                }
              : undefined
          }
          className="w-full max-w-md sm:max-w-xl max-h-[92vh] overflow-y-auto clay-card bg-[#EEF2F7] p-4 sm:p-7 rounded-3xl border border-white/95 shadow-2xl relative text-right animate-modal-pop"
        >
          {closable && (
            <button
              type="button"
              data-testid="library-ad-close-btn"
              aria-label="إغلاق الإعلان"
              onClick={onClose}
              className="sticky sm:absolute top-3 left-3 float-left sm:float-none z-20 w-9 h-9 rounded-full clay-btn flex items-center justify-center text-slate-600 hover:text-rose-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
            {imageUrl && (
              <div className="w-full sm:w-44 shrink-0 rounded-2xl overflow-hidden clay-inset p-1.5 bg-white/90">
                <img
                  src={imageUrl}
                  alt="CROVO SPACE"
                  className="w-full h-36 sm:h-40 object-cover rounded-xl"
                />
              </div>
            )}

            <div className="flex-1 space-y-1.5 text-center sm:text-right">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-indigo-700 text-[11px] font-black shadow-sm border border-indigo-100 font-ios">
                <AdIcon
                  name={unit?.content.iconName || 'sparkles'}
                  sizePx={14}
                  color={unit?.design.iconColor || '#4f46e5'}
                />
                <span>{unit?.content.badgeText || 'CROVO SPACE'}</span>
              </div>

              <h2
                id="rich-ad-title"
                style={{ color: unit?.design.textColor }}
                className="text-lg sm:text-2xl font-black font-decorative text-slate-900 leading-snug"
              >
                {title}
              </h2>
              <p
                style={{ color: unit?.design.subtitleColor }}
                className="text-xs sm:text-sm font-bold text-indigo-700 font-ios leading-relaxed"
              >
                {subtitle}
              </p>
            </div>
          </div>

          <div className="clay-inset p-3.5 sm:p-4 rounded-2xl mb-4 space-y-3 bg-white/75">
            <p className="text-xs sm:text-sm font-medium text-slate-700 font-ios leading-relaxed">
              {description}
            </p>

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

          <div className="p-3.5 rounded-2xl bg-gradient-to-l from-indigo-600 via-purple-600 to-indigo-700 text-white text-center mb-4 shadow-md">
            <div className="inline-flex items-center justify-center gap-1.5 text-sm sm:text-base font-black font-ios">
              <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
              <span>{priceText}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <button
              type="button"
              data-testid="rich-ad-primary-cta"
              onClick={handleCtaAction}
              style={
                unit?.design
                  ? {
                      backgroundColor: unit.design.ctaBgColor,
                      color: unit.design.ctaTextColor,
                    }
                  : undefined
              }
              className="clay-apple-blue flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-black shadow-md font-ios flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{ctaText}</span>
              <ArrowLeft className="w-4 h-4" />
            </button>

            {closable && (
              <button
                type="button"
                onClick={onClose}
                className="clay-btn sm:w-36 py-3 px-4 rounded-2xl text-xs font-bold text-slate-600 hover:text-slate-900 font-ios text-center"
              >
                {unit?.content.secondaryCtaText || 'العودة للمكتبة'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Classic Ad Popup Template
  const title = renderDynamicAdText(
    unit?.content.title || adConfig?.title || 'لسه بتحل المنصة بنفسك؟',
    pricingVars
  );
  const subtitle = renderDynamicAdText(
    unit?.content.subtitle || adConfig?.subtitle || 'وفر وقتك مع أداة CROVO',
    pricingVars
  );
  const priceText = renderDynamicAdText(
    unit?.content.priceText || adConfig?.priceText || 'حل المنصة بالكامل بـ50 جنيه فقط',
    pricingVars
  );
  const ctaText = renderDynamicAdText(
    unit?.content.ctaText || adConfig?.ctaText || 'اعرف أكتر',
    pricingVars
  );

  return (
    <div
      data-testid="library-copy-ad"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-ad-title"
      onClick={() => {
        if (closable) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={
          customCardStyle
            ? {
                ...customCardStyle,
                background: unit?.design.gradientEnabled ? customCardStyle.background : unit?.design.backgroundColor || '#EEF2F7',
              }
            : undefined
        }
        className="w-full max-w-md sm:max-w-lg clay-card bg-[#EEF2F7] p-5 sm:p-8 rounded-3xl border border-white/95 shadow-2xl relative text-right animate-modal-pop"
      >
        {closable && (
          <button
            type="button"
            data-testid="library-ad-close-btn"
            aria-label="إغلاق الإعلان"
            onClick={onClose}
            className="absolute top-4 left-4 w-9 h-9 rounded-full clay-btn flex items-center justify-center text-slate-600 hover:text-rose-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="flex flex-col items-center text-center pt-1 mb-5">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg mb-2.5">
            {unit?.content.iconName ? (
              <AdIcon name={unit.content.iconName} sizePx={30} color={unit.design.iconColor || '#fcd34d'} />
            ) : (
              <Zap className="w-8 h-8 text-amber-300 fill-amber-300" />
            )}
          </div>
          <span className="px-3 py-0.5 rounded-full bg-white text-indigo-700 text-[10px] font-black shadow-sm border border-indigo-100 font-ios whitespace-nowrap">
            {unit?.content.badgeText || 'CROVO SPACE'}
          </span>

          <h2
            id="library-ad-title"
            style={{ color: unit?.design.textColor }}
            className="text-xl sm:text-2xl font-black font-decorative text-slate-900 mt-1.5"
          >
            {title}
          </h2>
          <p
            style={{ color: unit?.design.subtitleColor }}
            className="text-sm sm:text-base font-bold text-slate-600 font-ios mt-1.5"
          >
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
            className="clay-purple-soft flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-black shadow-md font-ios flex items-center justify-center gap-2 cursor-pointer"
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
            className="clay-whatsapp flex-1 py-3 px-4 rounded-2xl text-xs sm:text-sm font-black text-white shadow-md font-ios cursor-pointer"
          >
            عاوز اشترك يخوياااا
          </button>
        </div>

        {closable && (
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full py-2 text-center text-xs font-bold text-slate-500 hover:text-slate-800 font-ios transition-colors"
          >
            تخطي والعودة للمكتبة
          </button>
        )}
      </div>
    </div>
  );
};
