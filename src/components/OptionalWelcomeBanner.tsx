import React, { useEffect, useState } from 'react';
import { Sparkles, User, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const WELCOME_DISMISSED_KEY = 'crovo_dismissed_welcome_login';

export const OptionalWelcomeBanner: React.FC = () => {
  const { user, loading, openAuthModal } = useAuth();
  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const isDismissed = localStorage.getItem(WELCOME_DISMISSED_KEY) === '1';
      setDismissed(isDismissed);
    } catch {
      setDismissed(false);
    }
  }, []);

  if (loading || user || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(WELCOME_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  };

  return (
    <aside
      aria-label="ترحيب وتسجيل دخول اختياري"
      data-testid="optional-welcome-banner"
      className="max-w-4xl mx-auto px-3 sm:px-6 my-4"
    >
      <div className="clay-card p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-right bg-gradient-to-l from-indigo-50/90 via-purple-50/70 to-white border border-indigo-200/60 shadow-md">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl clay-apple-blue flex items-center justify-center text-white shrink-0 shadow-sm">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <h2 className="text-xs sm:text-sm font-black font-decorative text-slate-900 flex items-center gap-1.5">
              <span>أهلاً بك في عالم CROVO SPACE 🎓</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full clay-inset text-indigo-700 font-bold">
                تسجيل دخول اختياري
              </span>
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-600 font-ios leading-relaxed">
              يمكنك تصفح المكتبة والحلول بحرية تامة، أو إنشاء حساب مجاني لحفظ تقدمك ونقاطك (XP) والمشاركة في الاستفتاءات والتقييمات.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
          <button
            type="button"
            data-testid="welcome-login-btn"
            onClick={() => {
              handleDismiss();
              openAuthModal('تسجيل دخول اختياري لحفظ تقدمك ومشاركاتك');
            }}
            className="clay-apple-blue px-4 py-2.5 rounded-xl text-xs font-black text-white font-ios flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform"
          >
            <User className="w-3.5 h-3.5" />
            <span>تسجيل الدخول / إنشاء حساب</span>
          </button>

          <button
            type="button"
            data-testid="welcome-dismiss-btn"
            onClick={handleDismiss}
            className="clay-btn px-3.5 py-2.5 rounded-xl text-xs font-bold text-slate-600 font-ios flex items-center gap-1 hover:text-rose-600"
            title="تخطي وتصفح بحرية"
          >
            <X className="w-3.5 h-3.5" />
            <span>تخطي</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
