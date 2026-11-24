import React, { useEffect, useState } from 'react';
import { ArrowLeft, Clock, X } from 'lucide-react';
import {
  type AdElementKey,
  type AdUnitConfig,
  DEFAULT_ELEMENT_ORDER,
  getAdCardStyle,
  renderDynamicAdText,
  sanitizeAdLinkUrl,
  sanitizeAdMediaUrl,
} from '../../utils/adSystem';
import { formatCountdownParts } from '../../utils/rules';
import type { PublicConfig } from '../../utils/api';
import { AdIcon } from './AdIcon';

export interface AdActionHandlers {
  onOpenSubscription: () => void;
  onExploreTool: () => void;
  onOpenReviews: () => void;
  onScrollToLibrary?: () => void;
  onScrollToHelp?: () => void;
  onOpenAuth?: () => void;
}

interface AdUnitRendererProps {
  ad: AdUnitConfig;
  config?: PublicConfig | null;
  serverOffsetMs?: number;
  forceMobile?: boolean;
  onClose?: () => void;
  actions: AdActionHandlers;
  mode?: 'inline' | 'floating' | 'modal' | 'interstitial';
  isPreview?: boolean;
}

function useViewportIsMobile(forceMobile?: boolean): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof forceMobile === 'boolean') return forceMobile;
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 640;
  });

  useEffect(() => {
    if (typeof forceMobile === 'boolean') {
      setIsMobile(forceMobile);
      return;
    }
    const mq = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [forceMobile]);

  return isMobile;
}

export function triggerAdCtaLink(
  rawLink: string,
  actions: AdActionHandlers,
  onAfter?: () => void
): void {
  const link = sanitizeAdLinkUrl(rawLink, '#subscribe');
  onAfter?.();

  if (link === '#subscribe' || link === '/#order-section') {
    actions.onOpenSubscription();
    return;
  }
  if (link === '#tool' || link === '/tool') {
    actions.onExploreTool();
    return;
  }
  if (link === '#reviews' || link === '/reviews') {
    actions.onOpenReviews();
    return;
  }
  if (link === '#library') {
    actions.onScrollToLibrary?.();
    return;
  }
  if (link === '#help') {
    actions.onScrollToHelp?.();
    return;
  }
  if (link === '#auth') {
    actions.onOpenAuth?.();
    return;
  }
  if (link.startsWith('http://') || link.startsWith('https://')) {
    window.open(link, '_blank', 'noopener,noreferrer');
    return;
  }
  if (link.startsWith('/')) {
    window.location.href = link;
  }
}

export const AdUnitRenderer: React.FC<AdUnitRendererProps> = ({
  ad,
  config,
  serverOffsetMs = 0,
  forceMobile,
  onClose,
  actions,
  mode = 'inline',
  isPreview = false,
}) => {
  const isMobile = useViewportIsMobile(forceMobile);
  const [nowMs, setNowMs] = useState<number>(() => Date.now() + serverOffsetMs);

  useEffect(() => {
    if (!ad.content.showCountdown) return;
    setNowMs(Date.now() + serverOffsetMs);
    const id = window.setInterval(() => setNowMs(Date.now() + serverOffsetMs), 1000);
    return () => window.clearInterval(id);
  }, [ad.content.showCountdown, serverOffsetMs]);

  useEffect(() => {
    if (isPreview || !ad.motion.autoHideSeconds || ad.motion.autoHideSeconds <= 0 || !onClose) {
      return;
    }
    const timer = window.setTimeout(() => onClose(), ad.motion.autoHideSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [ad.motion.autoHideSeconds, isPreview, onClose]);

  const { content, design, motion, behavior } = ad;
  const pricingVars = {
    qureoOfferPrice: config?.qureoOfferPrice ?? 50,
    qureoOldPrice: config?.qureoOldPrice ?? 100,
    bundleOfferPrice: config?.bundleOfferPrice ?? 100,
    bundleOldPrice: config?.bundleOldPrice ?? 200,
  };

  const title = renderDynamicAdText(content.title, pricingVars);
  const subtitle = renderDynamicAdText(content.subtitle, pricingVars);
  const description = renderDynamicAdText(content.description, pricingVars);
  const priceText = renderDynamicAdText(content.priceText, pricingVars);
  const badgeText = renderDynamicAdText(content.badgeText, pricingVars);
  const ctaText = renderDynamicAdText(content.ctaText, pricingVars);
  const secondaryCtaText = renderDynamicAdText(content.secondaryCtaText, pricingVars);

  const fontClass =
    design.fontFamily === 'decorative'
      ? 'font-decorative'
      : design.fontFamily === 'mono'
      ? 'font-mono'
      : 'font-ios';

  const alignClass =
    content.textAlign === 'center'
      ? 'text-center items-center'
      : content.textAlign === 'left'
      ? 'text-left items-start'
      : 'text-right items-start';

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

  const cardStyle: React.CSSProperties = {
    ...getAdCardStyle(design, isMobile),
    animationDuration: !motion.disableAnimation ? `${motion.transitionDurationMs}ms` : undefined,
    fontWeight: design.fontWeight,
  };

  if (mode === 'floating') {
    cardStyle.marginTop = 0;
    cardStyle.marginBottom = 0;
  }

  const countdown = config?.offerEndsAt ? formatCountdownParts(config.offerEndsAt, nowMs) : null;
  const pad = (n: number) => String(n).padStart(2, '0');

  const mediaUrl = sanitizeAdMediaUrl(content.mediaUrl);
  const bgUrl = sanitizeAdMediaUrl(design.customBgImageUrl);
  const order: AdElementKey[] =
    content.elementOrder && content.elementOrder.length > 0
      ? content.elementOrder
      : DEFAULT_ELEMENT_ORDER;

  const renderElement = (key: AdElementKey) => {
    switch (key) {
      case 'badge':
        if (!badgeText && content.iconName === 'none') return null;
        return (
          <div
            key="badge"
            className={`flex flex-wrap items-center gap-1.5 ${
              content.textAlign === 'center' ? 'justify-center' : ''
            }`}
          >
            {badgeText && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black shadow-2xs"
                style={{
                  backgroundColor: `${design.accentColor}22`,
                  color: design.textColor,
                  border: `1px solid ${design.accentColor}55`,
                }}
              >
                <AdIcon
                  name={content.iconName}
                  sizePx={Math.max(12, Math.min(22, isMobile ? design.iconSizeMobile : design.iconSizeDesktop))}
                  color={design.iconColor}
                />
                <span>{badgeText}</span>
              </span>
            )}
            {!badgeText && content.iconName !== 'none' && (
              <span className="inline-flex items-center justify-center p-1.5 rounded-xl bg-white/20">
                <AdIcon
                  name={content.iconName}
                  sizePx={isMobile ? design.iconSizeMobile : design.iconSizeDesktop}
                  color={design.iconColor}
                />
              </span>
            )}
          </div>
        );

      case 'media':
        if (content.mediaType === 'none' || !mediaUrl) return null;
        if (content.mediaType === 'video') {
          return (
            <div key="media" className="w-full overflow-hidden rounded-2xl border border-white/30 bg-black/10">
              <video
                src={mediaUrl}
                controls
                playsInline
                className="w-full max-h-56 object-cover rounded-2xl"
              />
            </div>
          );
        }
        return (
          <div key="media" className="w-full overflow-hidden rounded-2xl border border-white/40 bg-white/25">
            <img
              src={mediaUrl}
              alt={title || ad.name}
              loading="lazy"
              className="w-full max-h-52 object-cover rounded-2xl"
            />
          </div>
        );

      case 'title':
        if (!title) return null;
        if (motion.marqueeEnabled && mode === 'inline') {
          return (
            <div
              key="title"
              className={`crovo-marquee-viewport w-full ${motion.marqueePauseOnHover ? 'pause-on-hover' : ''}`}
            >
              <div
                className={`crovo-marquee-track ${motion.marqueeDirection === 'ltr' ? 'dir-ltr' : 'dir-rtl'}`}
                style={{
                  animationDuration: `${motion.marqueeSpeedSec}s`,
                  animationPlayState: motion.disableAnimation ? 'paused' : 'running',
                }}
              >
                <span
                  className={`${fontClass} leading-snug px-6 whitespace-nowrap`}
                  style={{
                    fontSize: `${isMobile ? design.fontSizeMobile : design.fontSizeDesktop}px`,
                    color: design.textColor,
                  }}
                >
                  {title}
                </span>
                <span
                  aria-hidden="true"
                  className={`${fontClass} leading-snug px-6 whitespace-nowrap`}
                  style={{
                    fontSize: `${isMobile ? design.fontSizeMobile : design.fontSizeDesktop}px`,
                    color: design.textColor,
                  }}
                >
                  {title}
                </span>
              </div>
            </div>
          );
        }
        return (
          <h3
            key="title"
            className={`${fontClass} leading-snug w-full`}
            style={{
              fontSize: `${isMobile ? design.fontSizeMobile : design.fontSizeDesktop}px`,
              fontWeight: design.fontWeight,
              color: design.textColor,
            }}
          >
            {title}
          </h3>
        );

      case 'subtitle':
        if (!subtitle) return null;
        return (
          <p
            key="subtitle"
            className="font-ios leading-relaxed w-full"
            style={{
              fontSize: `${isMobile ? design.subtitleSizeMobile : design.subtitleSizeDesktop}px`,
              color: design.subtitleColor,
              fontWeight: 700,
            }}
          >
            {subtitle}
          </p>
        );

      case 'description':
        if (!description) return null;
        return (
          <p
            key="description"
            className="font-ios text-xs sm:text-sm leading-relaxed w-full opacity-90"
            style={{ color: design.subtitleColor }}
          >
            {description}
          </p>
        );

      case 'price':
        if (!priceText) return null;
        return (
          <div
            key="price"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-black font-ios shadow-2xs"
            style={{
              backgroundColor: `${design.accentColor}20`,
              color: design.textColor,
              border: `1px solid ${design.accentColor}45`,
            }}
          >
            <AdIcon name="sparkles" sizePx={14} color={design.iconColor} />
            <span>{priceText}</span>
          </div>
        );

      case 'countdown':
        if (!content.showCountdown || !countdown || countdown.expired) return null;
        return (
          <div
            key="countdown"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/20 border border-white/20 text-[11px] font-mono tabular-nums"
            style={{ color: design.accentColor }}
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {countdown.days > 0 && <span>{countdown.days}ي ·</span>}
            <span dir="ltr">
              {pad(countdown.hours)}:{pad(countdown.minutes)}:{pad(countdown.seconds)}
            </span>
          </div>
        );

      case 'cta':
        if (!ctaText && !secondaryCtaText) return null;
        return (
          <div
            key="cta"
            className={`flex flex-wrap items-center gap-2 pt-1 w-full ${
              content.textAlign === 'center' ? 'justify-center' : ''
            }`}
          >
            {ctaText && (
              <button
                type="button"
                onClick={() =>
                  triggerAdCtaLink(
                    content.ctaLink,
                    actions,
                    mode === 'modal' || mode === 'interstitial' ? onClose : undefined
                  )
                }
                className="px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-black font-ios shadow-md hover:brightness-105 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                style={{
                  backgroundColor: design.ctaBgColor,
                  color: design.ctaTextColor,
                }}
              >
                <span>{ctaText}</span>
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
            {secondaryCtaText && (
              <button
                type="button"
                onClick={() =>
                  triggerAdCtaLink(content.secondaryCtaLink || '#tool', actions, onClose)
                }
                className="px-3.5 py-2 rounded-2xl text-xs font-bold font-ios bg-white/20 hover:bg-white/30 border border-white/30 transition-all cursor-pointer"
                style={{ color: design.textColor }}
              >
                {secondaryCtaText}
              </button>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      data-testid={`ad-unit-${ad.id}`}
      dir={content.dir}
      style={cardStyle}
      className={`relative overflow-hidden mx-auto ${animClass} ${ambientClass}`}
    >
      {bgUrl && (
        <>
          <img
            src={bgUrl}
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

      {behavior.closable && onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق الإعلان"
          data-testid={`ad-close-${ad.id}`}
          className="absolute top-2.5 left-2.5 z-20 w-8 h-8 rounded-full bg-white/85 hover:bg-white text-slate-700 hover:text-rose-600 flex items-center justify-center shadow-sm transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className={`relative z-10 flex flex-col gap-2.5 ${alignClass}`}>
        {order.map((k) => renderElement(k))}
      </div>
    </div>
  );
};
