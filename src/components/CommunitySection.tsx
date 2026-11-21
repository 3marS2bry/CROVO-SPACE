import React from 'react';
import { BadgeCheck, ExternalLink, ShieldCheck, Users } from 'lucide-react';
import { WhatsAppIcon, TelegramIcon } from './SocialIcons';
import { useTelegramModal } from '../context/TelegramModalContext';

export const WHATSAPP_COMMUNITY_URL =
  'https://chat.whatsapp.com/L6gwIToEm2R3vnrkZrwVNu?s=cl&p=a&iam=2';

export const CommunitySection: React.FC = () => {
  const { openTelegramModal } = useTelegramModal();

  return (
    <section
      id="crovo-community"
      data-testid="community-section"
      className="max-w-5xl mx-auto px-3 sm:px-6 my-6 sm:my-10"
    >
      <div className="clay-card p-4 sm:p-7 text-right border border-white/85 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-200/65">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-xl clay-inset text-emerald-700 text-[11px] font-bold mb-1.5 font-decorative">
              <Users className="w-3.5 h-3.5" />
              <span>القنوات المعتمدة والروابط المباشرة</span>
            </div>
            <h2 className="text-lg sm:text-2xl font-black font-decorative text-slate-900">
              القنوات الرسمية — مجتمع CROVO SPACE
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 font-ios mt-1">
              تابع أحدث إثباتات الحلول والدرجات، وتواصل مع الطلاب في مجتمع CROVO SPACE الرسمي.
            </p>
          </div>
        </div>

        {/* Balanced 2-Column Claymorphism Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          {/* Card 1: Official WhatsApp Group */}
          <div className="clay-inset p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-emerald-200/70 bg-gradient-to-br from-emerald-50/55 via-white/95 to-white">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 text-[10px] font-bold font-ios">
                  <span>مجموعة الطلاب الرسمية</span>
                </div>
                <h3 className="text-base sm:text-lg font-black font-decorative text-slate-900">
                  جروب WhatsApp الرسمي
                </h3>
                <p className="text-xs text-slate-600 font-ios leading-relaxed">
                  مناقشات مباشرة بين طلاب أولى وتانية بكالوريا، استفسارات الحلول، وتنبيهات التحديثات الفورية.
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl clay-whatsapp text-white flex items-center justify-center shrink-0">
                <WhatsAppIcon className="w-6 h-6" />
              </div>
            </div>

            <a
              href={WHATSAPP_COMMUNITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="whatsapp-community-btn"
              className="clay-whatsapp py-3 px-4 rounded-xl text-xs sm:text-sm font-black text-white font-ios flex items-center justify-center gap-2 active:scale-95 transition-all min-h-[44px]"
            >
              <WhatsAppIcon className="w-4 h-4 shrink-0" />
              <span>انضم إلى جروب الواتساب</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-85 shrink-0" />
            </a>
          </div>

          {/* Card 2: Official Telegram Proofs Channel with Distinct Trust Frame */}
          <div className="clay-inset p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-sky-300/80 ring-1 ring-sky-400/20 bg-gradient-to-br from-sky-50/75 via-white to-indigo-50/40 relative">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-800 text-[10px] font-bold font-ios">
                    قناة الإثباتات الرسمية
                  </span>
                  <span
                    data-testid="telegram-trusted-badge"
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-sky-100 border border-sky-300/80 text-sky-900 text-[10px] font-bold shadow-2xs"
                  >
                    <BadgeCheck className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                    <span dir="ltr" className="font-mono tracking-wide">
                      𓆩 𝐓𝐑𝐔𝐒𝐓𝐄𝐃 𝐂𝐇𝐀𝐍𝐍𝐄𝐋 𓆪
                    </span>
                  </span>
                </div>

                <h3 className="text-base sm:text-lg font-black font-decorative text-slate-900">
                  قناة Telegram الرسمية (@CrovoSpace)
                </h3>

                <p className="text-xs text-slate-600 font-ios leading-relaxed">
                  نعرض فيها إثباتات حل الامتحانات، النتائج الفعلية الموثّقة، آراء العملاء، وتوثيق التجارب والتعاملات اليومية.
                </p>

                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-sky-800/85 font-ios pt-0.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <span>شارة توثيق داخلية خاصة بقناة إثباتات CROVO SPACE الرسمية</span>
                </div>
              </div>

              <div className="w-12 h-12 rounded-2xl clay-telegram text-white flex items-center justify-center shrink-0">
                <TelegramIcon className="w-6 h-6" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => openTelegramModal('community_card')}
              data-testid="telegram-community-btn"
              className="clay-telegram py-3 px-4 rounded-xl text-xs sm:text-sm font-black text-white font-ios flex items-center justify-center gap-2 active:scale-95 transition-all min-h-[44px] cursor-pointer"
            >
              <TelegramIcon className="w-4 h-4 shrink-0" />
              <span>تابع قناة التليجرام</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-85 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
