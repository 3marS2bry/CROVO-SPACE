import React, { useEffect, useState } from 'react';
import {
  type AdPlacement,
  getAdImpressionRecord,
  isAdEligibleForContext,
  recordAdDismissal,
  recordAdImpression,
} from '../../utils/adSystem';
import type { PublicConfig } from '../../utils/api';
import { type AdActionHandlers, AdUnitRenderer } from './AdUnitRenderer';

interface AdSlotProps {
  placement: AdPlacement;
  view: 'library' | 'toolDetails' | 'reviews' | 'admin';
  config: PublicConfig | null;
  serverOffsetMs: number;
  actions: AdActionHandlers;
}

const SYSTEM_BESPOKE_IDS = new Set([
  'ad_top_announcement',
  'ad_hero_promo',
  'ad_library_popup',
  'ad_welcome_banner',
]);

export const AdSlot: React.FC<AdSlotProps> = ({
  placement,
  view,
  config,
  serverOffsetMs,
  actions,
}) => {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>({});
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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
    const t = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const units = (config?.ads || [])
    .filter((ad) => ad.placement === placement && !SYSTEM_BESPOKE_IDS.has(ad.id))
    .filter((ad) => !dismissedIds[ad.id])
    .filter((ad) =>
      isAdEligibleForContext({
        ad,
        view,
        isMobile,
        nowMs: Date.now() + serverOffsetMs,
        elapsedSeconds,
        impressionRecord: getAdImpressionRecord(ad.id),
      })
    )
    .sort((a, b) => (b.behavior.priority || 50) - (a.behavior.priority || 50));

  useEffect(() => {
    if (units.length === 0) return;
    const key = `slot_imp_${units.map((u) => u.id).join(',')}`;
    if (typeof window !== 'undefined' && (window as unknown as Record<string, boolean>)[key]) return;
    if (typeof window !== 'undefined') (window as unknown as Record<string, boolean>)[key] = true;
    units.forEach((u) => recordAdImpression(u.id));
  }, [units]);

  if (units.length === 0) return null;

  return (
    <div
      data-testid={`ad-slot-${placement}`}
      className="max-w-6xl mx-auto px-3 sm:px-6 space-y-3"
    >
      {units.map((ad) => (
        <AdUnitRenderer
          key={ad.id}
          ad={ad}
          config={config}
          serverOffsetMs={serverOffsetMs}
          actions={actions}
          mode="inline"
          onClose={
            ad.behavior.closable
              ? () => {
                  recordAdDismissal(ad.id);
                  setDismissedIds((prev) => ({ ...prev, [ad.id]: true }));
                }
              : undefined
          }
        />
      ))}
    </div>
  );
};
