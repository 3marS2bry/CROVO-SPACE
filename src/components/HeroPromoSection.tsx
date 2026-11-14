import React, { useEffect, useState } from 'react';
import { BellOff, CheckCircle2, MessageSquare, Sparkles, Tag, Zap } from 'lucide-react';
import { PublicConfig } from '../utils/api';

interface HeroPromoSectionProps {
  config: PublicConfig | null;
  onExploreTool: () => void;
  onOpenSubscription: () => void;
  onOpenReviews: () => void;
}

const SNOOZE_STORAGE_KEY = 'crovo_hero_promo_snooze_until';
const SNOOZE_DAYS = 4;

export const HeroPromoSection: React.FC<HeroPromoSectionProps> = ({
  config,
  onExploreTool,
  onOpenSubscription,
  onOpenReviews,
}) => {
  const [snoozed, setSnoozed] = useState(false);

  useEffect(() => {
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
  }, []);

  if (config && !config.heroPromo.enabled) {
    return null;
  }

  const offerActive = config?.offerActive ?? true;
  const qureoPrice = offerActive ? config?.qureoOfferPrice ?? 50 : config?.qureoOldPrice ?? 100;
  const qureoOld = config?.qureoOldPrice ?? 100;
  const bundlePrice = offerActive ? config?.bundleOfferPrice ?? 100 : config?.bundleOldPrice ?? 200;

  const title =
    config?.heroPromo.title || 'أداة CROVO الذكية — خلّص كل الفصول في 4 دقايق بمحاكاة بشرية';
  const subtitle =
    config?.heroPromo.subtitle ||
    'بدل ما تقضي ساعات في النسخ والحل سؤال بسؤال، أداتي بتشتغل بهدوء وتحل لك منصة QUREO أو الثقافة المالية بأمان وتشفير لبياناتك.';

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

  if (snoozed) {
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

  return (
    <section
      aria-label="الإعلان الرئيسي لأداة CROVO"
      data-testid="hero-promo-card"
      className="max-w-6xl mx-auto px-3 sm:px-6 mb-4 sm:mb-6"
    >
      <div className="clay-card p-4 sm:p-6 bg-gradient-to-br from-indigo-50/90 via-white/90 to-purple-50/85 border border-indigo-200/70 text-right relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 sm:gap-6">
          {/* Content Column */}
          <div className="flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl clay-inset text-[11px] font-black text-indigo-700 font-decorative">
                <Tag className="w-3.5 h-3.5 text-amber-500" />
                <span>{offerActive ? 'عرض متاح لفترة محدودة' : 'الأسعار الحالية'}</span>
              </span>

              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl clay-inset text-xs font-black font-ios text-indigo-700">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
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

              <span className="text-[11px] font-bold text-slate-600 font-ios">
                · الباقة الكاملة ({bundlePrice} جنيه)
              </span>
            </div>

            <h2 className="text-base sm:text-xl font-black font-decorative text-slate-900 leading-snug">
              {title}
            </h2>

            <p className="text-xs sm:text-sm text-slate-700 font-ios leading-relaxed max-w-3xl">
              {subtitle}
            </p>

            <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold text-slate-600 font-ios">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" />
                تشفير كامل لبيانات المنصة قبل الحفظ
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
                onClick={onOpenSubscription}
                className="clay-whatsapp py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-black text-white flex items-center justify-center gap-1.5 shadow-md font-ios"
              >
                <Zap className="w-4 h-4 fill-amber-300 text-amber-300" />
                <span>اشترك الآن</span>
              </button>

              <button
                type="button"
                data-testid="promo-explore-btn"
                onClick={onExploreTool}
                className="clay-apple-blue py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-bold text-white flex items-center justify-center gap-1.5 shadow-sm font-ios"
              >
                <span>اكتشف الأداة</span>
              </button>
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
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
