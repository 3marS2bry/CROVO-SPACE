import React, { useEffect } from 'react';
import { BadgeCheck, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { TelegramIcon } from './SocialIcons';
import { CROVO_TELEGRAM_URL, useTelegramModal } from '../context/TelegramModalContext';

export const TelegramInviteModal: React.FC = () => {
  const { isOpen, closeTelegramModal } = useTelegramModal();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        closeTelegramModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, closeTelegramModal]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="telegram-modal-title"
      data-testid="telegram-invite-modal"
      onClick={closeTelegramModal}
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-[2px] flex items-center justify-center p-3.5 sm:p-5 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md clay-card p-5 sm:p-6 text-right border border-white/90 shadow-2xl relative space-y-4 animate-modal-pop"
      >
        {/* Top Row: Close Button + Telegram Icon */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl clay-telegram text-white flex items-center justify-center shadow-md shrink-0">
              <TelegramIcon className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100/90 border border-sky-200 text-sky-800 text-[10px] font-bold mb-1">
                <BadgeCheck className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span dir="ltr" className="tracking-wide font-mono">
                  𓆩 𝐓𝐑𝐔𝐒𝐓𝐄𝐃 𝐂𝐇𝐀𝐍𝐍𝐄𝐋 𓆪
                </span>
              </div>
              <h3
                id="telegram-modal-title"
                className="text-base sm:text-lg font-black font-decorative text-slate-900 leading-snug"
              >
                قناة CROVO SPACE الرسمية
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={closeTelegramModal}
            aria-label="إغلاق نافذة التليجرام"
            data-testid="telegram-modal-close-icon"
            className="p-1.5 rounded-xl clay-btn text-slate-500 hover:text-slate-800 min-h-[34px] min-w-[34px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Description & Proofs Frame */}
        <div className="p-3.5 rounded-2xl clay-inset bg-sky-50/40 border border-sky-200/60 space-y-2">
          <p className="text-xs sm:text-sm text-slate-700 font-ios leading-relaxed">
            تابع قناة الإثباتات والتحديثات الرسمية لـ{' '}
            <span className="font-bold text-slate-900">CROVO SPACE</span> لمشاهدة نتائج تقفيل الامتحانات، إثباتات التعاملات، آراء الطلاب الحقيقية، وآخر التحديثات والعروض أولاً بأول.
          </p>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-800/90 font-ios">
            <ShieldCheck className="w-3.5 h-3.5 text-sky-600 shrink-0" />
            <span>شارة ثقة خاصة بقناة الإثباتات الرسمية لـ CROVO SPACE (@CrovoSpace)</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
          <a
            href={CROVO_TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="telegram-modal-subscribe-link"
            onClick={() => {
              window.setTimeout(() => closeTelegramModal(), 150);
            }}
            className="clay-telegram flex-1 py-3 px-4 rounded-xl text-xs sm:text-sm font-black text-white font-ios flex items-center justify-center gap-2 shadow-md hover:brightness-105 active:scale-95 transition-all"
          >
            <TelegramIcon className="w-4 h-4 shrink-0" />
            <span>اشترك في القناة</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-85 shrink-0" />
          </a>

          <button
            type="button"
            data-testid="telegram-modal-later-btn"
            onClick={closeTelegramModal}
            className="clay-btn py-3 px-5 rounded-xl text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-800 font-ios active:scale-95 transition-all"
          >
            لاحقًا
          </button>
        </div>
      </div>
    </div>
  );
};
