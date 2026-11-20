import React from 'react';
import { BookOpen, HelpCircle, MessageSquare, Shield } from 'lucide-react';
import { WhatsAppIcon, TelegramIcon } from './SocialIcons';

interface ContactFooterProps {
  onOpenQuran: () => void;
  onOpenDemo: () => void;
  onOpenReviews: () => void;
  onOpenHelp: () => void;
  onOpenSubscription: () => void;
  onOpenAdmin: () => void;
}

export const ContactFooter: React.FC<ContactFooterProps> = ({
  onOpenQuran,
  onOpenReviews,
  onOpenHelp,
  onOpenSubscription,
  onOpenAdmin,
}) => {
  return (
    <footer className="mt-16 border-t border-white/60 bg-[#EEF2F7]/95 backdrop-blur-xl py-12 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8 text-right">
        {/* Brand Summary */}
        <div className="flex flex-col items-center md:items-start text-center md:text-right gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl clay-card flex items-center justify-center p-1.5 shadow-sm">
              <img
                src="/icon-192.png"
                alt="شعار CROVO SPACE — مكتبة الحلول"
                className="w-full h-full object-contain rounded-xl"
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div>
              <span className="text-lg font-bold font-decorative text-slate-900">
                CROVO SPACE — كروفو سبيس
              </span>
              <div className="text-xs font-bold text-indigo-600 font-decorative mt-0.5">
                تطوير وتصميم: عمر صبري — Omar Sabry
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-600 max-w-sm font-ios leading-relaxed">
            المنصة مصممة خصيصاً عشان تشيل عنك سحل المذاكرة وضغط الامتحانات.. شغّل دماغك وخلّص الليلة كلها في 4 دقايق!
          </p>
        </div>

        {/* Quick Utility Tools */}
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={onOpenQuran}
            className="clay-btn px-3.5 py-2 rounded-2xl text-xs font-bold text-slate-700 flex items-center gap-1.5"
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-500" />
            <span className="font-decorative">القرآن الكريم</span>
          </button>

          <button
            type="button"
            onClick={onOpenReviews}
            className="clay-btn px-3.5 py-2 rounded-2xl text-xs font-bold text-slate-700 flex items-center gap-1.5"
          >
            <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-decorative">آراء العملاء</span>
          </button>

          <button
            type="button"
            onClick={onOpenHelp}
            className="clay-btn px-3.5 py-2 rounded-2xl text-xs font-bold text-slate-700 flex items-center gap-1.5"
          >
            <HelpCircle className="w-3.5 h-3.5 text-sky-500" />
            <span className="font-decorative">المساعدة</span>
          </button>
        </div>

        {/* Contact Channels */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenSubscription}
            data-testid="footer-telegram-btn"
            className="clay-telegram px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-1.5 text-white cursor-pointer"
          >
            <TelegramIcon className="w-4 h-4" />
            <span>اشتراك تليجرام</span>
          </button>

          <button
            type="button"
            onClick={onOpenSubscription}
            className="clay-whatsapp px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 text-white font-ios"
          >
            <WhatsAppIcon className="w-4 h-4" />
            <span>عاوز اشترك يخوياااا</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-slate-200/60 space-y-4">
        <p className="text-[11px] text-slate-600 font-medium leading-relaxed text-center max-w-4xl mx-auto">
          مكتبة الحلول المُعالجة لطلاب أولى وتانية بكالوريا مصرية عبر CROVO SPACE: حل منصة كوريو ياباني QUREO، حلول البرمجة Java وPython، حل منصة الثقافة المالية وإجابات دروسها وتدريباتها وتجارتها، تدريبات واختبارات كوريو وإعلانات جميع المجالات وحلول المنصات التعليمية للوصول إلى الإجابات بسهولة.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 font-medium text-center gap-3">
          <span>
            © {new Date().getFullYear()} CROVO SPACE (كروفو سبيس) — تطوير عمر صبري (Omar Sabry). جميع الحقوق محفوظة.
          </span>
          <div className="flex items-center gap-3 justify-center text-slate-600">
            <span>مكتبة حلول QUREO والثقافة المالية للبكالوريا المصرية</span>
            <a
              href="/admin"
              onClick={(e) => {
                e.preventDefault();
                onOpenAdmin();
              }}
              data-testid="footer-admin-link"
              className="clay-btn px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:text-indigo-600 inline-flex items-center gap-1"
            >
              <Shield className="w-3 h-3" />
              <span>لوحة الإدارة</span>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
