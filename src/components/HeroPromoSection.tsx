import React, { useEffect, useState } from 'react';
import { BellOff, CheckCircle2, MessageSquare, Sparkles, Zap } from 'lucide-react';
import { PublicConfig } from '../utils/api';
import {
  type AdUnitConfig,
  buildDefaultAdUnits,
  getAdCardStyle,
  renderDynamicAdText,
  resolveAdEffectiveStatus,
  sanitizeAdMediaUrl,
} from '../utils/adSystem';
import { AdIcon } from './ads/AdIcon';
import { triggerAdCtaLink } from './ads/AdUnitRenderer';

interface HeroPromoSectionProps {
  config: PublicConfig | null;
  onExploreTool: () => void;
  onOpenSubscription: () => void;
  onOpenReviews: () => void;
  onScrollToLibrary?: () => void;
  onScrollToHelp?: () => void;
  forceAdUnit?: AdUnitConfig;
  forceMobile?: boolean;
}

const SNOOZE_STORAGE_KEY = 'crovo_hero_promo_snooze_until';
const SNOOZE_DAYS = 4;

export const HeroPromoSection: React.FC<HeroPromoSectionProps> = ({
  config,
  onExploreTool,
  onOpenSubscription,
  onOpenReviews,
  onScrollToLibrary,
  onScrollToHelp,
  forceAdUnit,
  forceMobile,
}) => {
  const [snoozed, setSnoozed] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof forceMobile === 'boolean') return forceMobile;
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 640;
  });

  useEffect(() => {
    if (typeof forceMobile === 'boolean') {
      setIsMobileViewport(forceMobile);
      return;
    }
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsMobileViewport(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [forceMobile]);

  useEffect(() => {
    if (forceAdUnit) return;
    try {
      const saved = localStorage.getItem(SNOOZE_STORAGE_KEY);
      if (saved) {
        const until = Number(saved);
        if (Number.isFinite(until) && Date.now() < until) {
          setSnoozed(true);
        } else {
          localStorage.removeItem(SNOOZE_STORAGE_KEY);
        }
      }
    } catch {
      // Ignore storage failures
    }
  }, [forceAdUnit]);

  if (!forceAdUnit && config && !config.heroPromo.enabled) {
    return null;
  }

  const unit: AdUnitConfig =
    forceAdUnit ||
    config?.ads?.find(
      (a) => a.systemKey === 'hero_promo' || a.id === 'ad_hero_promo'
    ) ||
    buildDefaultAdUnits({ heroPromo: config?.heroPromo })[1];

  if (!forceAdUnit) {
    const statusInfo = resolveAdEffectiveStatus(unit, Date.now());
    if (!statusInfo.isLive) return null;
    if (unit.behavior.deviceTarget === 'mobile' && !isMobileViewport) return null;
    if (unit.behavior.deviceTarget === 'desktop' && isMobileViewport) return null;
  }

  const offerActive = config?.offerActive ?? true;
  const qureoPrice = offerActive ? config?.qureoOfferPrice ?? 50 : config?.qureoOldPrice ?? 100;
  const qureoOld = config?.qureoOldPrice ?? 100;
  const bundlePrice = offerActive ? config?.bundleOfferPrice ?? 100 : config?.bundleOldPrice ?? 200;

  const pricingVars = {
    qureoOfferPrice: qureoPrice,
    qureoOldPrice: qureoOld,
    bundleOfferPrice: bundlePrice,
    bundleOldPrice: config?.bundleOldPrice ?? 200,
  };

  const title = renderDynamicAdText(
    unit.content.title || config?.heroPromo.title || 'أداة CROVO الذكية — حل سريع ومنظّم لفصول المنصة بمحاكاة بشرية',
    pricingVars
  );
  const subtitle = renderDynamicAdText(
    unit.content.subtitle ||
      config?.heroPromo.subtitle ||
      'بدل ما تقضي ساعات في النسخ والحل سؤال بسؤال، أداتي بتشتغل بهدوء وتحل لك منصة QUREO أو الثقافة المالية بأمان وتشفير لبياناتك.',
    pricingVars
  );
  const badgeLabel = renderDynamicAdText(
    unit.content.badgeText || (offerActive ? 'عرض متاح لفترة محدودة' : 'الأسعار الحالية'),
    pricingVars
  );
  const primaryCtaText = renderDynamicAdText(unit.content.ctaText || 'اشترك الآن', pricingVars);
  const secondaryCtaText = renderDynamicAdText(unit.content.secondaryCtaText || 'اكتشف الأداة', pricingVars);

  const handleSnooze = () => {
    const until = Date.now() + SNOOZE_DAYS * 86400 * 1000;
    try {
      localStorage.setItem(SNOOZE_STORAGE_KEY, String(until));
    } catch {
      // Ignore storage failure
    }
    setSnoozed(true);
  };

  const handleRestore = () => {
    try {
      localStorage.removeItem(SNOOZE_STORAGE_KEY);
    } catch {
      // Ignore
    }
    setSnoozed(false);
  };

  if (snoozed && !forceAdUnit) {
    return (
      <div className="max-w-6xl mx-auto px-3 sm:px-6 mb-3 flex justify-end">
        <button
          type="button"
          onClick={handleRestore}
          className="clay-btn px-3 py-1.5 rounded-xl text-[11px] font-bold text-indigo-600 font-ios flex items-center gap-1.5"
        >
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          <span>عرض باقة أداة CROVO ({qureoPrice} جنيه)</span>
        </button>
      </div>
    );
  }

  const { design, motion, content, behavior } = unit;
  const cardStyle = getAdCardStyle(design, isMobileViewport);
  const customBg = sanitizeAdMediaUrl(design.customBgImageUrl);
  const mediaUrl = sanitizeAdMediaUrl(content.mediaUrl);

  const fontClass =
    design.fontFamily === 'decorative'
      ? 'font-decorative'
      : design.fontFamily === 'mono'
      ? 'font-mono'
      : 'font-ios';

  const animClass =
    !motion.disableAnimation && motion.entranceEffect !== 'none'
      ? `ad-anim-${motion.entranceEffect}`
      : '';
  const ambientClass =
    !motion.disableAnimation && motion.ambientEffect === 'float_gentle'
      ? 'ad-ambient-float_gentle'
      : !motion.disableAnimation && motion.ambientEffect === 'soft_pulse'
      ? 'ad-ambient-soft_pulse'
      : !motion.disableAnimation && motion.ambientEffect === 'light_sweep'
      ? 'promo-light-sweep'
      : '';

  const actions = {
    onOpenSubscription,
    onExploreTool,
    onOpenReviews,
    onScrollToLibrary,
    onScrollToHelp,
  };

  return (
    <section
      aria-label="الإعلان الرئيسي لأداة CROVO"
      data-testid="hero-promo-card"
      dir={content.dir}
      className="max-w-6xl mx-auto px-3 sm:px-6 mb-4 sm:mb-6"
    >
      <div
        style={cardStyle}
        className={`mx-auto relative overflow-hidden ${animClass} ${ambientClass} ${
          content.textAlign === 'center' ? 'text-center' : content.textAlign === 'left' ? 'text-left' : 'text-right'
        }`}
      >
        {customBg && (
          <>
            <img
              src={customBg}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none"
              style={{ backgroundColor: `rgba(15, 23, 42, ${design.bgImageOverlayOpacity})` }}
            />
          </>
        )}

        <div className="relative z-10 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 sm:gap-6">
          {/* Content Column */}
          <div className="flex-1 space-y-2.5">
            <div className={`flex flex-wrap items-center gap-2 ${content.textAlign === 'center' ? 'justify-center' : ''}`}>
              {badgeLabel && (
                <span
                  style={{ color: design.accentColor }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl clay-inset text-[11px] font-black font-decorative"
                >
                  <AdIcon name={content.iconName} sizePx={14} color={design.iconColor} />
                  <span>{badgeLabel}</span>
                </span>
              )}

              <span
                style={{ color: design.accentColor }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl clay-inset text-xs font-black font-ios"
              >
                <Sparkles className="w-3.5 h-3.5" style={{ color: design.iconColor }} />
                <span>
                  {offerActive && qureoOld > qureoPrice ? (
                    <>
                      بـ {qureoPrice} جنيه بس{' '}
                      <span className="line-through text-slate-400 font-mono text-[11px] mr-1">
                        {qureoOld} جنيه
                      </span>
                    </>
                  ) : (
                    `بـ ${qureoPrice} جنيه للمنصة`
                  )}
                </span>
              </span>

              <span
                style={{ color: design.subtitleColor }}
                className="text-[11px] font-bold font-ios opacity-85"
              >
                · الباقة الكاملة ({bundlePrice} جنيه)
              </span>
            </div>

            {content.mediaType === 'image' && mediaUrl && (
              <div className="w-full max-w-sm rounded-2xl overflow-hidden border border-white/40">
                <img src={mediaUrl} alt={title} className="w-full h-36 object-cover" />
              </div>
            )}

            <h2
              style={{
                fontSize: `${isMobileViewport ? design.fontSizeMobile : design.fontSizeDesktop}px`,
                fontWeight: design.fontWeight,
                color: design.textColor,
              }}
              className={`${fontClass} leading-snug`}
            >
              {title}
            </h2>

            <p
              style={{
                fontSize: `${isMobileViewport ? design.subtitleSizeMobile : design.subtitleSizeDesktop}px`,
                color: design.subtitleColor,
              }}
              className="font-ios leading-relaxed max-w-3xl"
            >
              {subtitle}
            </p>

            <div
              style={{ color: design.subtitleColor }}
              className={`flex flex-wrap items-center gap-3 text-[11px] font-bold font-ios opacity-90 ${
                content.textAlign === 'center' ? 'justify-center' : ''
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" />
                حماية وأمان كامل لبيانات حسابك
              </span>
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-purple-500" />
                متابعة مباشرة عبر واتساب بدون خطوات معقدة
              </span>
            </div>
          </div>

          {/* Actions Column */}
          <div className="flex flex-col gap-2 shrink-0 w-full lg:w-64">
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
              <button
                type="button"
                data-testid="promo-subscribe-btn"
                onClick={() => triggerAdCtaLink(content.ctaLink || '#subscribe', actions)}
                style={{
                  backgroundColor: design.ctaBgColor,
                  color: design.ctaTextColor,
                }}
                className="py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-black flex items-center justify-center gap-1.5 shadow-md hover:brightness-105 active:scale-95 transition-all font-ios cursor-pointer"
              >
                <Zap className="w-4 h-4 fill-amber-300 text-amber-300" />
                <span>{primaryCtaText}</span>
              </button>

              {secondaryCtaText && (
                <button
                  type="button"
                  data-testid="promo-explore-btn"
                  onClick={() => triggerAdCtaLink(content.secondaryCtaLink || '#tool', actions)}
                  className="clay-apple-blue py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-bold text-white flex items-center justify-center gap-1.5 shadow-sm font-ios cursor-pointer"
                >
                  <span>{secondaryCtaText}</span>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <button
                type="button"
                data-testid="promo-reviews-btn"
                onClick={onOpenReviews}
                className="clay-btn flex-1 py-2 px-3 rounded-xl text-[11px] font-bold text-slate-700 flex items-center justify-center gap-1.5 font-ios"
              >
                <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                <span>آراء عملائنا</span>
              </button>

              {behavior.closable && (
                <button
                  type="button"
                  data-testid="promo-snooze-btn"
                  onClick={handleSnooze}
                  title="إخفاء الإعلان مؤقتاً وتذكيري بعد كام يوم"
                  className="clay-btn py-2 px-2.5 rounded-xl text-[11px] font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1 font-ios"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  <span>لاحقاً</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
