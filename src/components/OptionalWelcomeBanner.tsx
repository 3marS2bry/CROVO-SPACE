import React, { useEffect, useState } from 'react';
import { User, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  type AdUnitConfig,
  getAdCardStyle,
  renderDynamicAdText,
  resolveAdEffectiveStatus,
  sanitizeAdMediaUrl,
} from '../utils/adSystem';
import type { PublicConfig } from '../utils/api';
import { AdIcon } from './ads/AdIcon';
import { triggerAdCtaLink } from './ads/AdUnitRenderer';

const WELCOME_DISMISSED_KEY = 'crovo_dismissed_welcome_login';

interface OptionalWelcomeBannerProps {
  adUnit?: AdUnitConfig;
  config?: PublicConfig | null;
  onOpenSubscription?: () => void;
  onExploreTool?: () => void;
  onOpenReviews?: () => void;
  forceMobile?: boolean;
}

export const OptionalWelcomeBanner: React.FC<OptionalWelcomeBannerProps> = ({
  adUnit,
  config,
  onOpenSubscription,
  onExploreTool,
  onOpenReviews,
  forceMobile,
}) => {
  const { user, loading, openAuthModal } = useAuth();
  const [dismissed, setDismissed] = useState<boolean>(true);
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
    if (typeof window === 'undefined') return;
    if (forceMobile !== undefined) {
      setDismissed(false);
      return;
    }
    try {
      const isDismissed = localStorage.getItem(WELCOME_DISMISSED_KEY) === '1';
      setDismissed(isDismissed);
    } catch {
      setDismissed(false);
    }
  }, [forceMobile]);

  if (forceMobile === undefined && (loading || user || dismissed)) {
    return null;
  }

  if (adUnit && forceMobile === undefined) {
    const statusInfo = resolveAdEffectiveStatus(adUnit, Date.now());
    if (!statusInfo.isLive) return null;
    if (adUnit.behavior.deviceTarget === 'mobile' && !isMobileViewport) return null;
    if (adUnit.behavior.deviceTarget === 'desktop' && isMobileViewport) return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  };

  const pricingVars = {
    qureoOfferPrice: config?.qureoOfferPrice ?? 50,
    qureoOldPrice: config?.qureoOldPrice ?? 100,
    bundleOfferPrice: config?.bundleOfferPrice ?? 100,
    bundleOldPrice: config?.bundleOldPrice ?? 200,
  };

  const title = renderDynamicAdText(
    adUnit?.content.title || 'أهلاً بك في عالم CROVO SPACE 🎓',
    pricingVars
  );
  const badgeText = renderDynamicAdText(
    adUnit?.content.badgeText || 'تسجيل دخول اختياري',
    pricingVars
  );
  const subtitle = renderDynamicAdText(
    adUnit?.content.subtitle ||
      'يمكنك تصفح المكتبة والحلول بحرية تامة، أو إنشاء حساب مجاني لحفظ تقدمك ونقاطك (XP) والمشاركة في الاستفتاءات والتقييمات.',
    pricingVars
  );
  const ctaText = renderDynamicAdText(
    adUnit?.content.ctaText || 'تسجيل الدخول / إنشاء حساب',
    pricingVars
  );
  const secondaryText = renderDynamicAdText(
    adUnit?.content.secondaryCtaText || 'تخطي',
    pricingVars
  );

  const closable = adUnit ? adUnit.behavior.closable : true;
  const cardStyle = adUnit
    ? getAdCardStyle(adUnit.design, isMobileViewport)
    : undefined;
  const customBg = adUnit ? sanitizeAdMediaUrl(adUnit.design.customBgImageUrl) : '';

  const animClass =
    adUnit && !adUnit.motion.disableAnimation && adUnit.motion.entranceEffect !== 'none'
      ? `ad-anim-${adUnit.motion.entranceEffect}`
      : '';

  const handlePrimaryCta = () => {
    const link = adUnit?.content.ctaLink || '#auth';
    if (link === '#auth') {
      handleDismiss();
      openAuthModal('تسجيل دخول اختياري لحفظ تقدمك ومشاركاتك');
      return;
    }
    triggerAdCtaLink(link, {
      onOpenSubscription: onOpenSubscription || (() => {}),
      onExploreTool: onExploreTool || (() => {}),
      onOpenReviews: onOpenReviews || (() => {}),
      onOpenAuth: () => openAuthModal('تسجيل دخول اختياري لحفظ تقدمك ومشاركاتك'),
    });
  };

  return (
    <aside
      aria-label="ترحيب وتسجيل دخول اختياري"
      data-testid="optional-welcome-banner"
      dir={adUnit?.content.dir || 'rtl'}
      className="max-w-4xl mx-auto px-3 sm:px-6 my-4"
    >
      <div
        style={cardStyle}
        className={`relative overflow-hidden mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-right ${
          !cardStyle
            ? 'clay-card p-4 sm:p-5 bg-gradient-to-l from-indigo-50/90 via-purple-50/70 to-white border border-indigo-200/60 shadow-md'
            : ''
        } ${animClass}`}
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
              style={{
                backgroundColor: `rgba(15, 23, 42, ${adUnit?.design.bgImageOverlayOpacity ?? 0.25})`,
              }}
            />
          </>
        )}

        <div className="relative z-10 flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl clay-apple-blue flex items-center justify-center text-white shrink-0 shadow-sm">
            <AdIcon
              name={adUnit?.content.iconName || 'sparkles'}
              sizePx={20}
              color="#ffffff"
            />
          </div>
          <div className="space-y-0.5">
            <h2
              style={adUnit ? { color: adUnit.design.textColor } : undefined}
              className="text-xs sm:text-sm font-black font-decorative text-slate-900 flex flex-wrap items-center gap-1.5"
            >
              <span>{title}</span>
              {badgeText && (
                <span className="text-[10px] px-2 py-0.5 rounded-full clay-inset text-indigo-700 font-bold">
                  {badgeText}
                </span>
              )}
            </h2>
            <p
              style={adUnit ? { color: adUnit.design.subtitleColor } : undefined}
              className="text-[11px] sm:text-xs text-slate-600 font-ios leading-relaxed"
            >
              {subtitle}
            </p>
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
          <button
            type="button"
            data-testid="welcome-login-btn"
            onClick={handlePrimaryCta}
            style={
              adUnit
                ? {
                    backgroundColor: adUnit.design.ctaBgColor,
                    color: adUnit.design.ctaTextColor,
                  }
                : undefined
            }
            className="clay-apple-blue px-4 py-2.5 rounded-xl text-xs font-black font-ios flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform cursor-pointer"
          >
            <User className="w-3.5 h-3.5" />
            <span>{ctaText}</span>
          </button>

          {closable && (
            <button
              type="button"
              data-testid="welcome-dismiss-btn"
              onClick={handleDismiss}
              className="clay-btn px-3.5 py-2.5 rounded-xl text-xs font-bold text-slate-600 font-ios flex items-center gap-1 hover:text-rose-600 cursor-pointer"
              title="تخطي وتصفح بحرية"
            >
              <X className="w-3.5 h-3.5" />
              <span>{secondaryText}</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
