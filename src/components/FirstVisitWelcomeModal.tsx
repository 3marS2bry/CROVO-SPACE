import React, { useEffect, useRef, useState } from 'react';
import { Lock, Mail, Sparkles, User, X, ArrowLeft, ShieldCheck } from 'lucide-react';
import { api } from '../utils/api';
import {
  getFirebaseIdToken,
  launchInstantGoogleChooser,
  registerWithEmailCloud,
  signInWithEmailCloud,
} from '../utils/cloudStore';
import { useAuth } from '../context/AuthContext';

const VISIT_MODE_STORAGE_KEY = 'crovo_visit_mode';

const GoogleMark: React.FC = () => (
  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const FirstVisitWelcomeModal: React.FC = () => {
  const { user, loading, consumePendingAction, loginWithGoogle } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [grade, setGrade] = useState<'bac1' | 'bac2'>('bac1');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consumeRef = useRef(consumePendingAction);
  const gradeRef = useRef(grade);
  consumeRef.current = consumePendingAction;
  gradeRef.current = grade;

  useEffect(() => {
    if (loading || user) {
      setIsOpen(false);
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      const modeVal = localStorage.getItem(VISIT_MODE_STORAGE_KEY);
      if (!modeVal) {
        setIsOpen(true);
      }
    } catch {
      setIsOpen(true);
    }
  }, [user, loading]);

  useEffect(() => {
    if (!isOpen || user) return;
    return launchInstantGoogleChooser({
      preferredGrade: gradeRef.current,
      onSignedIn: (cloudUser) => {
        try {
          localStorage.setItem(VISIT_MODE_STORAGE_KEY, 'registered');
        } catch {}
        consumeRef.current(cloudUser);
        setIsOpen(false);
      },
    });
  }, [isOpen, user]);

  if (!isOpen || user) {
    return null;
  }

  const handleContinueAsGuest = () => {
    setIsOpen(false);
    try {
      localStorage.setItem(VISIT_MODE_STORAGE_KEY, 'guest');
    } catch {
      // ignore
    }
  };

  const handleGoogleLogin = async () => {
    if (googleBusy || busy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      const cloudUser = await loginWithGoogle(grade);
      try {
        localStorage.setItem(VISIT_MODE_STORAGE_KEY, 'registered');
      } catch {}
      consumePendingAction(cloudUser);
      setIsOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذر تسجيل الدخول عبر Google، تأكد من السماح للنوافذ المنبثقة.'
      );
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || googleBusy) return;
    setBusy(true);
    setError(null);
    try {
      const cloudUser =
        mode === 'register'
          ? await registerWithEmailCloud({ name, email, password, grade })
          : await signInWithEmailCloud({ email, password });

      let finalUser = cloudUser;
      try {
        const idToken = await getFirebaseIdToken();
        if (idToken) {
          const synced = await api.authCloudSync({
            idToken,
            name: cloudUser.name,
            grade: mode === 'register' ? grade : cloudUser.grade,
            serialNumber: cloudUser.serialNumber,
          });
          finalUser = synced.user;
        }
      } catch {
        // Non-fatal: Firebase Auth already succeeded
      }
      try {
        localStorage.setItem(VISIT_MODE_STORAGE_KEY, 'registered');
      } catch {}
      setPassword('');
      consumePendingAction(finalUser);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إتمام العملية.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="first-visit-welcome-modal"
      role="dialog"
      aria-modal="true"
      aria-label="نافذة الترحيب وتسجيل الدخول"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm transition-opacity duration-200 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md clay-card bg-[#EEF2F7] p-6 sm:p-8 rounded-3xl border border-white/95 shadow-2xl relative text-right transition-transform duration-200 my-auto max-h-[92vh] overflow-y-auto"
      >
        <button
          type="button"
          onClick={handleContinueAsGuest}
          aria-label="تخطي والدخول كضيف"
          className="absolute top-4 left-4 w-9 h-9 rounded-full clay-btn flex items-center justify-center text-slate-500 hover:text-rose-600 transition-colors shadow-sm"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mb-5 text-center sm:text-right">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full clay-inset text-indigo-700 text-xs font-black mb-2.5 font-decorative shadow-xs border border-indigo-100">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>مرحباً بك في CROVO SPACE</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black font-decorative text-slate-900">
            {mode === 'register' ? 'إنشاء حسابك الشخصي' : 'تسجيل الدخول السريع'}
          </h2>
          <p className="mt-1.5 text-xs sm:text-sm font-bold text-slate-600 font-ios leading-relaxed">
            اختار حسابك الشخصي على Google للوصول الفوري لحسابك وتعليقاتك وطلباتك دون أي كتابة أو إجهاد.
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="clay-pill-track grid grid-cols-2 gap-1 p-1 mb-4">
          <button
            type="button"
            data-testid="welcome-tab-register"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`py-2 px-3 rounded-full text-xs font-bold font-ios transition-all flex items-center justify-center gap-1.5 ${
              mode === 'register' ? 'clay-pill-active' : 'text-slate-600'
            }`}
          >
            <span>حساب جديد</span>
            <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-900 text-[9px] font-black">
              موصى به
            </span>
          </button>
          <button
            type="button"
            data-testid="welcome-tab-login"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`py-2 rounded-full text-xs font-bold font-ios transition-all ${
              mode === 'login' ? 'clay-pill-active' : 'text-slate-600'
            }`}
          >
            لديّ حساب
          </button>
        </div>

        {error && (
          <div
            data-testid="welcome-error-box"
            className="mb-3.5 p-3 rounded-2xl clay-inset text-xs font-bold text-rose-600 font-ios leading-relaxed border border-rose-200/60"
          >
            {error}
          </div>
        )}

        {mode === 'register' && (
          <div className="mb-4 text-xs font-ios">
            <label className="block font-bold text-slate-800 mb-1.5">حدد صفك الدراسي:</label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setGrade('bac1')}
                className={`py-2.5 rounded-xl font-bold transition-all ${
                  grade === 'bac1'
                    ? 'clay-pill-active shadow-sm'
                    : 'clay-inset text-slate-600 hover:text-slate-900'
                }`}
              >
                أولى بكالوريا
              </button>
              <button
                type="button"
                onClick={() => setGrade('bac2')}
                className={`py-2.5 rounded-xl font-bold transition-all ${
                  grade === 'bac2'
                    ? 'clay-pill-active shadow-sm'
                    : 'clay-inset text-slate-600 hover:text-slate-900'
                }`}
              >
                تانية بكالوريا
              </button>
            </div>
          </div>
        )}

        {/* Prominent Google 1-Click Account Selector Button */}
        <div className="space-y-2 mb-4">
          <button
            type="button"
            data-testid="welcome-google-btn"
            disabled={googleBusy || busy}
            onClick={handleGoogleLogin}
            className="w-full py-3.5 px-4 rounded-2xl bg-white hover:bg-indigo-50/50 border-2 border-indigo-200/80 shadow-md flex items-center justify-center gap-3 text-xs sm:text-sm font-black text-slate-900 font-ios transition-all disabled:opacity-60 active:scale-[0.99] group"
          >
            <GoogleMark />
            <span className="group-hover:text-indigo-700 transition-colors">
              {googleBusy ? 'جاري فتح نافذة الحسابات...' : 'المتابعة باختيار حساب Google الشخصي (بدون كتابة كلمة سر)'}
            </span>
          </button>
          
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-700 font-ios pt-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>تسجيل آمن وسريع بنقرة واحدة — يربط حسابك فوراً بمشترياتك وطلباتك.</span>
          </div>
        </div>

        <div className="relative flex items-center justify-center my-3.5">
          <div className="w-full border-t border-slate-300/60" />
          <button
            type="button"
            data-testid="welcome-toggle-email-form"
            aria-expanded={showEmailForm}
            onClick={() => {
              setShowEmailForm((prev) => !prev);
              setError(null);
            }}
            className="px-3.5 py-1 bg-[#EEF2F7] text-[11px] font-bold text-slate-600 hover:text-indigo-700 font-ios whitespace-nowrap rounded-full clay-inset shadow-2xs"
          >
            {showEmailForm ? 'إخفاء الدخول التقليدي بالبريد الإلكتروني ▲' : 'أو تسجيل الدخول بالطريقة التقليدية بالبريد ▼'}
          </button>
          <div className="w-full border-t border-slate-300/60" />
        </div>

        {showEmailForm && (
          <form onSubmit={handleSubmit} className="space-y-3 text-xs font-ios pt-1 animate-fade-in">
            {mode === 'register' && (
              <div>
                <label className="block font-bold text-slate-700 mb-1">الاسم الكامل</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    minLength={2}
                    data-testid="welcome-name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: عمر صبري"
                    className="w-full pr-9 pl-3 py-2.5 rounded-xl clay-inset border-none outline-none font-semibold text-slate-900"
                  />
                  <User className="w-4 h-4 text-indigo-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">البريد الإلكتروني</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  dir="ltr"
                  data-testid="welcome-email-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pr-9 pl-3 py-2.5 rounded-xl clay-inset border-none outline-none font-mono text-left text-slate-900"
                />
                <Mail className="w-4 h-4 text-indigo-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">كلمة المرور</label>
              <div className="relative">
                <input
                  type="password"
                  required
                  minLength={6}
                  dir="ltr"
                  data-testid="welcome-password-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pr-9 pl-3 py-2.5 rounded-xl clay-inset border-none outline-none font-mono text-left text-slate-900"
                />
                <Lock className="w-4 h-4 text-indigo-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <button
              type="submit"
              disabled={busy || googleBusy}
              data-testid="welcome-submit-btn"
              className="w-full clay-apple-blue py-3.5 rounded-2xl text-sm font-black text-white shadow-md disabled:opacity-60 mt-2"
            >
              {busy
                ? 'جاري التنفيذ...'
                : mode === 'register'
                ? 'إنشاء الحساب بالبريد والمتابعة'
                : 'تسجيل الدخول بالبريد'}
            </button>
          </form>
        )}

        {/* Subtle bottom skip / guest button */}
        <div className="pt-3.5 mt-3.5 border-t border-slate-200/60 text-center">
          <button
            type="button"
            data-testid="welcome-skip-btn"
            onClick={handleContinueAsGuest}
            className="text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1.5 opacity-90 hover:opacity-100"
          >
            <span>تخطي وتسجيل الدخول كضيف مؤقتاً</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
