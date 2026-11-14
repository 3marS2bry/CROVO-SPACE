import React from 'react';
import { BookOpen, HelpCircle, LogOut, MessageSquare, User, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type AppView = 'library' | 'toolDetails' | 'reviews' | 'admin';

interface NavbarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  onOpenHelp: () => void;
  xp: number;
  level: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeView,
  onSelectView,
  onOpenHelp,
  xp,
  level,
}) => {
  const { user, openAuthModal, logout } = useAuth();

  return (
    <header className="relative w-full bg-[#EEF2F7]/96 border-b border-white/80 shadow-xs backdrop-blur-xs">
      <div className="max-w-7xl mx-auto px-2 sm:px-6 h-12 sm:h-16 flex items-center justify-between gap-1 sm:gap-4">
        {/* Brand: CROVO SPACE */}
        <button
          type="button"
          onClick={() => onSelectView('library')}
          className="cursor-pointer flex items-center gap-1 sm:gap-2.5 shrink-0 group select-none text-right min-h-[34px] sm:min-h-[36px]"
        >
          <div className="w-6 h-6 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl clay-card flex items-center justify-center p-0.5 sm:p-1 transform group-hover:scale-105 transition-transform bg-white/95 shadow-sm shrink-0">
            <img
              src="/icon-192.png"
              alt="CROVO SPACE"
              width={36}
              height={36}
              className="w-full h-full object-contain rounded-md sm:rounded-lg"
              onError={(e) => {
                (e.currentTarget as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-[10px] sm:text-lg font-black font-ios text-slate-900 tracking-tight leading-none whitespace-nowrap">
                CROVO SPACE
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full clay-inset text-indigo-600 font-bold font-decorative hidden lg:inline-block">
                مكتبة الحلول
              </span>
            </div>
            <div className="text-[7.5px] sm:text-[11px] font-semibold text-indigo-600 font-decorative mt-0.5 leading-none tracking-wide whitespace-nowrap">
              𝕯𝖊𝖛 : عُـمـر صَـبـري
            </div>
          </div>
        </button>

        {/* Refined Curved Pill View Switcher */}
        <nav
          aria-label="التنقل الرئيسي"
          className="clay-pill-track flex items-center gap-0.5 sm:gap-1.5 p-0.5 sm:p-1.5 shrink-0"
        >
          <button
            type="button"
            data-testid="nav-library-btn"
            onClick={() => onSelectView('library')}
            className={`px-1.5 sm:px-4 py-1 sm:py-2 text-[9.5px] sm:text-sm font-black rounded-full transition-all duration-200 flex items-center gap-1 sm:gap-1.5 font-ios whitespace-nowrap min-h-[30px] sm:min-h-[40px] active:scale-95 cursor-pointer ${
              activeView === 'library'
                ? 'clay-pill-active shadow-sm'
                : 'text-slate-600 hover:text-indigo-600 hover:bg-white/60'
            }`}
          >
            <BookOpen className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            <span>المكتبة</span>
          </button>

          <button
            type="button"
            data-testid="nav-tool-btn"
            onClick={() => onSelectView('toolDetails')}
            className={`px-1.5 sm:px-4 py-1 sm:py-2 text-[9.5px] sm:text-sm font-black rounded-full transition-all duration-200 flex items-center gap-1 sm:gap-1.5 font-ios whitespace-nowrap min-h-[30px] sm:min-h-[40px] active:scale-95 cursor-pointer ${
              activeView === 'toolDetails'
                ? 'clay-pill-active shadow-sm'
                : 'text-slate-600 hover:text-indigo-600 hover:bg-white/60'
            }`}
          >
            <Zap className="w-3 h-3 sm:w-4 sm:h-4 shrink-0 text-amber-500 fill-amber-400" />
            <span>الأداة</span>
          </button>

          <button
            type="button"
            data-testid="nav-reviews-btn"
            onClick={() => onSelectView('reviews')}
            className={`px-1.5 sm:px-4 py-1 sm:py-2 text-[9.5px] sm:text-sm font-black rounded-full transition-all duration-200 flex items-center gap-1 sm:gap-1.5 font-ios whitespace-nowrap min-h-[30px] sm:min-h-[40px] active:scale-95 cursor-pointer ${
              activeView === 'reviews'
                ? 'clay-pill-active shadow-sm'
                : 'text-slate-600 hover:text-indigo-600 hover:bg-white/60'
            }`}
          >
            <MessageSquare className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            <span>الآراء</span>
          </button>
        </nav>

        {/* Right Actions: Level Pill + Account + Help */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full clay-inset text-xs font-bold text-slate-700 font-ios min-h-[36px]">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            <span>مستوى {level}</span>
            <span className="text-indigo-600 font-mono">({xp} XP)</span>
          </div>

          {user ? (
            <div className="flex items-center gap-1">
              <span
                data-testid="nav-user-pill"
                title={user.email}
                className="inline-flex items-center gap-1 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-full clay-inset text-[9.5px] sm:text-xs font-bold text-indigo-700 font-ios max-w-[54px] sm:max-w-[130px] truncate min-h-[30px] sm:min-h-[38px]"
              >
                <User className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-indigo-600" />
                <span className="truncate">{user.name.split(' ')[0]}</span>
              </span>
              <button
                type="button"
                onClick={logout}
                title="تسجيل الخروج"
                aria-label="تسجيل الخروج"
                data-testid="nav-logout-btn"
                className="p-1 sm:p-2 rounded-full clay-btn text-slate-500 hover:text-rose-600 min-h-[30px] min-w-[30px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center active:scale-95 transition-all cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="nav-login-btn"
              onClick={() => openAuthModal()}
              aria-label="تسجيل الدخول أو إنشاء حساب"
              className="px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-full clay-purple-soft text-[10px] sm:text-xs font-bold font-ios flex items-center gap-1 min-h-[30px] min-w-[30px] sm:min-h-[38px] justify-center whitespace-nowrap active:scale-95 transition-all cursor-pointer"
            >
              <User className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden min-[430px]:inline">دخول</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenHelp}
            title="مركز المساعدة"
            aria-label="مركز المساعدة"
            className="p-1 sm:p-2 rounded-full clay-btn text-slate-600 hover:text-indigo-600 min-h-[30px] min-w-[30px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center active:scale-95 transition-all cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

