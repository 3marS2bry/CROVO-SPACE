import React, { useEffect, useState } from 'react';
import {
  type AdUnitConfig,
  getAdImpressionRecord,
  isAdEligibleForContext,
  recordAdDismissal,
  recordAdImpression,
} from '../../utils/adSystem';
import type { PublicConfig } from '../../utils/api';
import { type AdActionHandlers, AdUnitRenderer } from './AdUnitRenderer';

interface AdOverlayManagerProps {
  config: PublicConfig | null;
  activeView: 'library' | 'toolDetails' | 'reviews' | 'admin';
  serverOffsetMs: number;
  hasBlockingModalOpen: boolean;
  actions: AdActionHandlers;
}

const POSITION_CLASSES: Record<string, string> = {
  bottom_left: 'bottom-4 left-3 sm:left-5',
  bottom_right: 'bottom-4 right-3 sm:right-5',
  bottom_center: 'bottom-4 left-1/2 -translate-x-1/2',
  top_left: 'top-24 left-3 sm:left-5',
  top_right: 'top-24 right-3 sm:right-5',
  top_center: 'top-24 left-1/2 -translate-x-1/2',
  center: 'bottom-4 left-3 sm:left-5',
};

export const AdOverlayManager: React.FC<AdOverlayManagerProps> = ({
  config,
  activeView,
  serverOffsetMs,
  hasBlockingModalOpen,
  actions,
}) => {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [closedIds, setClosedIds] = useState<Record<string, boolean>>({});
  const [activeOverlayId, setActiveOverlayId] = useState<string | null>(null);
  const [shownOverlaySession, setShownOverlaySession] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const allAds = config?.ads || [];
  const nowMs = Date.now() + serverOffsetMs;

  // 1. Custom Modal / Popup / Interstitial Overlay Ads (excluding system ad_library_popup handled by CopyAdBanner)
  const overlayCandidates = allAds
    .filter(
      (ad) =>
        ad.id !== 'ad_library_popup' &&
        (ad.placement === 'overlay_timed' ||
          ad.placement === 'overlay_interstitial' ||
          ad.type === 'interstitial' ||
          ad.type === 'modal' ||
          ad.type === 'popup')
    )
    .filter((ad) => !closedIds[ad.id] && !shownOverlaySession[ad.id])
    .filter((ad) =>
      isAdEligibleForContext({
        ad,
        view: activeView,
        isMobile,
        nowMs,
        elapsedSeconds,
        impressionRecord: getAdImpressionRecord(ad.id),
      })
    )
    .sort((a, b) => (b.behavior.priority || 50) - (a.behavior.priority || 50));

  useEffect(() => {
    if (activeView === 'admin' || hasBlockingModalOpen || activeOverlayId) return;
    if (overlayCandidates.length > 0) {
      const next = overlayCandidates[0];
      setActiveOverlayId(next.id);
      setShownOverlaySession((prev) => ({ ...prev, [next.id]: true }));
      recordAdImpression(next.id, nowMs);
    }
  }, [activeView, hasBlockingModalOpen, activeOverlayId, overlayCandidates, nowMs]);

  const activeOverlayAd: AdUnitConfig | undefined = activeOverlayId
    ? allAds.find((a) => a.id === activeOverlayId)
    : undefined;

  // 2. Floating Corner Ad (highest-priority single unit to keep UI clutter-free & under mobile cap)
  const floatingCandidates = allAds
    .filter((ad) => ad.placement === 'floating_corner' || ad.type === 'floating')
    .filter((ad) => !closedIds[ad.id])
    .filter((ad) =>
      isAdEligibleForContext({
        ad,
        view: activeView,
        isMobile,
        nowMs,
        elapsedSeconds,
        impressionRecord: getAdImpressionRecord(ad.id),
      })
    )
    .sort((a, b) => (b.behavior.priority || 50) - (a.behavior.priority || 50));

  const floatingAd = !hasBlockingModalOpen && !activeOverlayAd ? floatingCandidates[0] : undefined;

  useEffect(() => {
    if (!floatingAd) return;
    const key = `float_imp_${floatingAd.id}`;
    if (typeof window !== 'undefined' && !(window as unknown as Record<string, boolean>)[key]) {
      (window as unknown as Record<string, boolean>)[key] = true;
      recordAdImpression(floatingAd.id);
    }
  }, [floatingAd]);

  useEffect(() => {
    if (!activeOverlayAd) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeOverlayAd.behavior.closable) {
        recordAdDismissal(activeOverlayAd.id);
        setClosedIds((prev) => ({ ...prev, [activeOverlayAd.id]: true }));
        setActiveOverlayId(null);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [activeOverlayAd]);

  if (activeView === 'admin') return null;

  return (
    <>
      {/* Custom Overlay / Modal / Interstitial Ad */}
      {activeOverlayAd && !hasBlockingModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid={`ad-overlay-backdrop-${activeOverlayAd.id}`}
          onClick={() => {
            if (!activeOverlayAd.behavior.closable) return;
            recordAdDismissal(activeOverlayAd.id);
            setClosedIds((prev) => ({ ...prev, [activeOverlayAd.id]: true }));
            setActiveOverlayId(null);
          }}
          className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 ${
            activeOverlayAd.type === 'interstitial'
              ? 'bg-slate-950/80 backdrop-blur-sm'
              : 'bg-slate-900/60 backdrop-blur-[2px]'
          }`}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto"
          >
            <AdUnitRenderer
              ad={activeOverlayAd}
              config={config}
              serverOffsetMs={serverOffsetMs}
              actions={actions}
              mode={activeOverlayAd.type === 'interstitial' ? 'interstitial' : 'modal'}
              onClose={() => {
                recordAdDismissal(activeOverlayAd.id);
                setClosedIds((prev) => ({ ...prev, [activeOverlayAd.id]: true }));
                setActiveOverlayId(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Floating Corner Ad */}
      {floatingAd && (
        <div
          data-testid={`ad-floating-container-${floatingAd.id}`}
          className={`fixed z-30 max-w-[calc(100vw-24px)] ${
            POSITION_CLASSES[floatingAd.design.position] || POSITION_CLASSES.bottom_left
          }`}
        >
          <AdUnitRenderer
            ad={floatingAd}
            config={config}
            serverOffsetMs={serverOffsetMs}
            actions={actions}
            mode="floating"
            onClose={() => {
              recordAdDismissal(floatingAd.id);
              setClosedIds((prev) => ({ ...prev, [floatingAd.id]: true }));
            }}
          />
        </div>
      )}
    </>
  );
};
