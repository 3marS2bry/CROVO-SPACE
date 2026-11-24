import React, { useEffect, useState } from 'react';
import { Clock, X } from 'lucide-react';
import type { PublicConfig } from '../utils/api';
import {
  type AdUnitConfig,
  buildDefaultAdUnits,
  renderDynamicAdText,
  resolveAdEffectiveStatus,
  sanitizeAdMediaUrl,
} from '../utils/adSystem';
import {
  calculateDiscountPercent,
  formatCountdownParts,
  isOfferActiveClient,
} from '../utils/rules';
import { AdIcon } from './ads/AdIcon';
import { triggerAdCtaLink } from './ads/AdUnitRenderer';

interface PromoTopBannerProps {
  config: PublicConfig | null;
  serverOffsetMs: number;
  onOpenSubscription: () => void;
  onExploreTool?: () => void;
  onOpenReviews?: () => void;
  onScrollToLibrary?: () => void;
  onScrollToHelp?: () => void;
  activeView?: 'library' | 'toolDetails' | 'reviews' | 'admin';
  forceAdUnit?: AdUnitConfig;
  forceMobile?: boolean;
}

export const PromoTopBanner: React.FC<PromoTopBannerProps> = ({
  config,
  serverOffsetMs,
  onOpenSubscription,
  onExploreTool,
  onOpenReviews,
  onScrollToLibrary,
  onScrollToHelp,
  activeView = 'library',
  forceAdUnit,
  forceMobile,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now() + serverOffsetMs);
  const [dismissed, setDismissed] = useState(false);
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
    setNowMs(Date.now() + serverOffsetMs);
    const timer = window.setInterval(() => {
      setNowMs(Date.now() + serverOffsetMs);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [serverOffsetMs]);

  if (!forceAdUnit && config?.promoBanner && !config.promoBanner.enabled) {
    return null;
  }

  // Render exact-height compact banner immediately before async /api/config resolves to eliminate CLS (0.25 -> 0.00)
  if (!config && !forceAdUnit) {
    return (
      <div
        data-testid="promo-top-banner"
        className="relative overflow-hidden bg-gradient-to-l from-indigo-600 via-purple-600 to-indigo-700 text-white border-b border-white/25 min-h-[28px] sm:min-h-[36px] flex items-center"
      >
        <div className="max-w-7xl w-full mx-auto px-2 sm:px-6 py-0.5 sm:py-1.5 flex items-center justify-between gap-2 text-right text-[9.5px] sm:text-xs font-ios">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-300 text-slate-900 font-black whitespace-nowrap shrink-0 text-[8.5px] sm:text-[11px]">
              <AdIcon name="tag" sizePx={11} color="#0f172a" />
              <span>خصم 50%</span>
            </span>
            <span className="font-bold text-white/95 truncate">
              حل المنصة بالكامل للترمين بـ50 جنيه فقط · المنصتين مع بعض بـ100 جنيه فقط
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpenSubscription()}
            className="px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-white text-indigo-700 text-[9.5px] sm:text-xs font-black font-ios whitespace-nowrap shrink-0"
          >
            اشترك الآن
          </button>
        </div>
      </div>
    );
  }

  const unit: AdUnitConfig =
    forceAdUnit ||
    config?.ads?.find(
      (a) => a.systemKey === 'top_announcement' || a.id === 'ad_top_announcement'
    ) ||
    buildDefaultAdUnits({ promoBanner: config?.promoBanner })[0];

  if (!forceAdUnit) {
    if (dismissed) return null;
    const statusInfo = resolveAdEffectiveStatus(unit, nowMs);
    if (!statusInfo.isLive) return null;
    if (unit.behavior.deviceTarget === 'mobile' && !isMobileViewport) return null;
    if (unit.behavior.deviceTarget === 'desktop' && isMobileViewport) return null;
    const pages = unit.behavior.pages || ['all'];
    const currentPage = activeView === 'admin' ? 'library' : activeView;
    if (!pages.includes('all') && !pages.includes(currentPage)) return null;
  }

  const offerActive = config ? isOfferActiveClient(config, nowMs) : true;
  const countdown = config
    ? formatCountdownParts(config.offerEndsAt, nowMs)
    : { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const pad = (n: number) => String(n).padStart(2, '0');

  const qOffer = config?.qureoOfferPrice ?? 50;
  const qOld = config?.qureoOldPrice ?? 100;
  const bOffer = config?.bundleOfferPrice ?? 100;
  const bOld = config?.bundleOldPrice ?? 200;

  const actualDiscountPercent = calculateDiscountPercent(qOld, qOffer);
  const pricingVars = {
    qureoOfferPrice: qOffer,
    qureoOldPrice: qOld,
    bundleOfferPrice: bOffer,
    bundleOldPrice: bOld,
  };

  const rawTitle =
    unit.content.title?.trim() ||
    config?.promoBanner?.text?.trim() ||
    'حل المنصة بالكامل للترمين بـ{price} جنيه فقط · المنصتين مع بعض بـ{bundle} جنيه فقط';

  const renderedOfferText = offerActive
    ? renderDynamicAdText(rawTitle, pricingVars)
    : `انتهى العرض المؤقت — المنصة بـ${qOld}ج والمنصتين بـ${bOld}ج`;

  const badgeRendered = renderDynamicAdText(unit.content.badgeText || 'خصم {percent}%', pricingVars);
  const brandPill = renderDynamicAdText(unit.content.subtitle || '', pricingVars);
  const ctaText = renderDynamicAdText(unit.content.ctaText || 'اشترك الآن', pricingVars);

  const { design, motion, content, behavior } = unit;
  const bgGradient = design.gradientEnabled
    ? design.gradientVia
      ? `linear-gradient(${design.gradientAngle}deg, ${design.gradientFrom}, ${design.gradientVia}, ${design.gradientTo})`
      : `linear-gradient(${design.gradientAngle}deg, ${design.gradientFrom}, ${design.gradientTo})`
    : design.backgroundColor;

  const customBg = sanitizeAdMediaUrl(design.customBgImageUrl);
  const fontClass =
    design.fontFamily === 'decorative'
      ? 'font-decorative'
      : design.fontFamily === 'mono'
      ? 'font-mono'
      : 'font-ios';

  const textFontSize = isMobileViewport ? design.fontSizeMobile : design.fontSizeDesktop;
  const padX = isMobileViewport ? design.paddingXMobile : design.paddingXDesktop;
  const padY = isMobileViewport ? design.paddingYMobile : design.paddingYDesktop;
  const iconSize = isMobileViewport ? design.iconSizeMobile : design.iconSizeDesktop;

  const ambientClass =
    !motion.disableAnimation && motion.ambientEffect === 'light_sweep'
      ? 'promo-light-sweep'
      : !motion.disableAnimation && motion.ambientEffect === 'soft_pulse'
      ? 'ad-ambient-soft_pulse'
      : '';

  const useMarquee = motion.marqueeEnabled && !motion.disableAnimation;

  const handleCtaClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerAdCtaLink(content.ctaLink || '#subscribe', {
      onOpenSubscription,
      onExploreTool: onExploreTool || onOpenSubscription,
      onOpenReviews: onOpenReviews || onOpenSubscription,
      onScrollToLibrary,
      onScrollToHelp,
    });
  };

  return (
    <div
      data-testid="promo-top-banner"
      dir={content.dir}
      style={{
        background: bgGradient,
        color: design.textColor,
        opacity: design.opacity,
        borderBottomWidth: `${design.borderWidth}px`,
        borderBottomStyle: design.borderWidth > 0 ? 'solid' : 'none',
        borderBottomColor: design.borderColor,
        marginTop: `${design.marginTop}px`,
        marginBottom: `${design.marginBottom}px`,
      }}
      className={`${ambientClass} relative overflow-hidden min-h-[30px] sm:min-h-[38px] flex items-center`}
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

      <div
        style={{
          paddingLeft: `${padX}px`,
          paddingRight: `${padX}px`,
          paddingTop: `${padY}px`,
          paddingBottom: `${padY}px`,
        }}
        className="max-w-7xl w-full mx-auto flex items-center justify-between gap-1.5 sm:gap-2 relative z-10 text-right"
      >
        {/* Offer Headline (Marquee OR Clean Static) */}
        <div className={`flex items-center gap-1.5 min-w-0 flex-1 ${fontClass}`}>
          {offerActive ? (
            <>
              {(actualDiscountPercent > 0 || (badgeRendered && !badgeRendered.includes('%'))) && badgeRendered && (
                <span
                  data-testid="promo-discount-badge"
                  style={{
                    backgroundColor: design.accentColor,
                    color: '#0f172a',
                  }}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-black whitespace-nowrap shrink-0 text-[8.5px] sm:text-[11px]"
                >
                  <AdIcon name={content.iconName} sizePx={Math.max(10, Math.min(14, iconSize))} color="#0f172a" />
                  <span>{badgeRendered}</span>
                </span>
              )}

              {brandPill && (
                <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/15 font-bold font-decorative whitespace-nowrap shrink-0 text-[11px]">
                  <AdIcon name="sparkles" sizePx={12} color={design.iconColor} />
                  <span>{brandPill}</span>
                </span>
              )}

              {useMarquee ? (
                <div
                  data-testid="promo-marquee-viewport"
                  className={`crovo-marquee-viewport flex-1 min-w-0 ${
                    motion.marqueePauseOnHover ? 'pause-on-hover' : ''
                  }`}
                >
                  <div
                    className={`crovo-marquee-track ${
                      motion.marqueeDirection === 'ltr' ? 'dir-ltr' : 'dir-rtl'
                    }`}
                    style={{
                      animationDuration: `${motion.marqueeSpeedSec}s`,
                    }}
                  >
                    <span
                      data-testid="promo-banner-text"
                      style={{
                        fontSize: `${textFontSize}px`,
                        fontWeight: design.fontWeight,
                        color: design.textColor,
                      }}
                      className="whitespace-nowrap px-5"
                    >
                      {renderedOfferText}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        fontSize: `${textFontSize}px`,
                        fontWeight: design.fontWeight,
                        color: design.textColor,
                      }}
                      className="whitespace-nowrap px-5"
                    >
                      {renderedOfferText}
                    </span>
                  </div>
                </div>
              ) : (
                <span
                  data-testid="promo-banner-text"
                  style={{
                    fontSize: `${textFontSize}px`,
                    fontWeight: design.fontWeight,
                    color: design.textColor,
                  }}
                  className="truncate"
                  title={renderedOfferText}
                >
                  {renderedOfferText}
                </span>
              )}
            </>
          ) : (
            <span
              style={{
                fontSize: `${textFontSize}px`,
                fontWeight: design.fontWeight,
                color: design.accentColor,
              }}
              className="truncate"
            >
              {renderedOfferText}
            </span>
          )}
        </div>

        {/* Synchronized Countdown + Action Button + Optional Close */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {content.showCountdown && !countdown.expired && (
            <div
              data-testid="offer-countdown"
              className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full bg-black/20 border border-white/15 text-[9.5px] sm:text-xs font-mono tabular-nums"
              title="العد التنازلي الموحد لجميع الزوار"
            >
              <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" style={{ color: design.accentColor }} />
              {countdown.days > 0 && (
                <span className="hidden sm:inline font-ios font-bold" style={{ color: design.accentColor }}>
                  {countdown.days}ي ·
                </span>
              )}
              <span className="font-bold" style={{ color: design.accentColor }} dir="ltr">
                {pad(countdown.hours)}:{pad(countdown.minutes)}:{pad(countdown.seconds)}
              </span>
            </div>
          )}

          {ctaText && (
            <button
              type="button"
              data-testid="promo-subscribe-cta"
              onClick={handleCtaClick}
              style={{
                backgroundColor: design.ctaBgColor,
                color: design.ctaTextColor,
              }}
              className="px-2 sm:px-3 py-0.5 sm:py-1 rounded-full hover:brightness-95 active:scale-95 text-[9.5px] sm:text-xs font-black font-ios transition-all shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
            >
              {ctaText}
            </button>
          )}

          {behavior.closable && !forceAdUnit && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="إغلاق الشريط العلوي"
              className="w-5 h-5 rounded-full bg-black/20 hover:bg-black/35 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
              style={{ color: design.textColor }}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
