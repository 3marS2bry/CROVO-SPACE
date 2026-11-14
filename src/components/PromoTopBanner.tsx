import React, { useEffect, useState } from 'react';
import { Clock, Sparkles, Tag } from 'lucide-react';
import type { PublicConfig } from '../utils/api';
import {
  calculateDiscountPercent,
  formatCountdownParts,
  isOfferActiveClient,
} from '../utils/rules';

interface PromoTopBannerProps {
  config: PublicConfig | null;
  serverOffsetMs: number;
  onOpenSubscription: () => void;
}

export const PromoTopBanner: React.FC<PromoTopBannerProps> = ({
  config,
  serverOffsetMs,
  onOpenSubscription,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now() + serverOffsetMs);

  useEffect(() => {
    setNowMs(Date.now() + serverOffsetMs);
    const timer = window.setInterval(() => {
      setNowMs(Date.now() + serverOffsetMs);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [serverOffsetMs]);

  if (config?.promoBanner && !config.promoBanner.enabled) {
    return null;
  }

  // Render exact-height compact banner immediately before async /api/config resolves to eliminate CLS (0.25 -> 0.00)
  if (!config) {
    return (
      <div
        data-testid="promo-top-banner"
        className="relative overflow-hidden bg-gradient-to-l from-indigo-600 via-purple-600 to-indigo-700 text-white border-b border-white/25 min-h-[28px] sm:min-h-[36px] flex items-center"
      >
        <div className="max-w-7xl w-full mx-auto px-2 sm:px-6 py-0.5 sm:py-1.5 flex items-center justify-between gap-2 text-right text-[9.5px] sm:text-xs font-ios">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-300 text-slate-900 font-black whitespace-nowrap shrink-0 text-[8.5px] sm:text-[11px]">
              <Tag className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
              <span>خصم 50%</span>
            </span>
            <span className="font-bold text-white/95 truncate">
              حل المنصة بالكامل للترمين بـ50 جنيه فقط · المنصتين مع بعض بـ100 جنيه فقط
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenSubscription}
            className="px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-white text-indigo-700 text-[9.5px] sm:text-xs font-black font-ios whitespace-nowrap shrink-0"
          >
            اشترك الآن
          </button>
        </div>
      </div>
    );
  }

  const offerActive = isOfferActiveClient(config, nowMs);
  const countdown = formatCountdownParts(config.offerEndsAt, nowMs);
  const pad = (n: number) => String(n).padStart(2, '0');

  const actualDiscountPercent = calculateDiscountPercent(
    config.qureoOldPrice,
    config.qureoOfferPrice
  );

  const template =
    config.promoBanner?.text?.trim() ||
    'حل المنصة بالكامل للترمين بـ{price} جنيه فقط · المنصتين مع بعض بـ{bundle} جنيه فقط';

  const renderedOfferText = template
    .replace(/\{price\}/g, String(config.qureoOfferPrice))
    .replace(/\{bundle\}/g, String(config.bundleOfferPrice))
    .replace(/\{percent\}/g, String(actualDiscountPercent));

  return (
    <div
      data-testid="promo-top-banner"
      className="promo-light-sweep relative overflow-hidden bg-gradient-to-l from-indigo-600 via-purple-600 to-indigo-700 text-white border-b border-white/25 min-h-[28px] sm:min-h-[36px] flex items-center"
    >
      <div className="max-w-7xl w-full mx-auto px-2 sm:px-6 py-0.5 sm:py-1.5 flex items-center justify-between gap-1.5 sm:gap-2 relative z-10 text-right">
        {/* Compact Offer Headline */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 text-[9.5px] sm:text-xs font-ios">
          {offerActive ? (
            <>
              {actualDiscountPercent > 0 && (
                <span
                  data-testid="promo-discount-badge"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-300 text-slate-900 font-black whitespace-nowrap shrink-0 text-[8.5px] sm:text-[11px]"
                >
                  <Tag className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                  <span>خصم {actualDiscountPercent}%</span>
                </span>
              )}
              <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/15 font-bold font-decorative whitespace-nowrap shrink-0 text-[11px]">
                <Sparkles className="w-3 h-3 text-amber-300" />
                <span>CROVO SPACE</span>
              </span>
              <span
                data-testid="promo-banner-text"
                className="font-bold text-white/95 truncate"
                title={renderedOfferText}
              >
                {renderedOfferText}
              </span>
            </>
          ) : (
            <span className="font-bold text-amber-200 truncate">
              انتهى العرض المؤقت — المنصة بـ{config.qureoOldPrice}ج والمنصتين بـ{config.bundleOldPrice}ج
            </span>
          )}
        </div>

        {/* Compact Synchronized Countdown + Action Button */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {!countdown.expired && (
            <div
              data-testid="offer-countdown"
              className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full bg-black/20 border border-white/15 text-[9.5px] sm:text-xs font-mono tabular-nums"
              title="العد التنازلي الموحد لجميع الزوار"
            >
              <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-300 shrink-0" />
              {countdown.days > 0 && (
                <span className="hidden sm:inline font-ios font-bold text-amber-200">
                  {countdown.days}ي ·
                </span>
              )}
              <span className="font-bold text-amber-200" dir="ltr">
                {pad(countdown.hours)}:{pad(countdown.minutes)}:{pad(countdown.seconds)}
              </span>
            </div>
          )}

          <button
            type="button"
            data-testid="promo-subscribe-cta"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSubscription();
            }}
            className="px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-white text-indigo-700 hover:bg-amber-300 hover:text-slate-900 active:scale-95 text-[9.5px] sm:text-xs font-black font-ios transition-all shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
          >
            اشترك الآن
          </button>
        </div>
      </div>
    </div>
  );
};
