import React, { useEffect, useRef, useState } from 'react';
import { Lock, Mail, Sparkles, User, X, ArrowLeft } from 'lucide-react';
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
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
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
      if (mode === 'register') {
        const cloudUser = await registerWithEmailCloud({ name, email, password, grade });
        let finalUser = cloudUser;
        const idToken = await getFirebaseIdToken();
        if (idToken) {
          const synced = await api.authCloudSync({
            idToken,
            name: cloudUser.name,
            grade,
            serialNumber: cloudUser.serialNumber,
          });
          finalUser = synced.user;
        }
        try {
          localStorage.setItem(VISIT_MODE_STORAGE_KEY, 'registered');
        } catch {}
        consumePendingAction(finalUser);
        setIsOpen(false);
      } else {
        const cloudUser = await signInWithEmailCloud({ email, password });
        let finalUser = cloudUser;
        const idToken = await getFirebaseIdToken();
        if (idToken) {
          const synced = await api.authCloudSync({
            idToken,
            name: cloudUser.name,
            grade: cloudUser.grade,
            serialNumber: cloudUser.serialNumber,
          });
          finalUser = synced.user;
        }
        try {
          localStorage.setItem(VISIT_MODE_STORAGE_KEY, 'registered');
        } catch {}
        consumePendingAction(finalUser);
        setIsOpen(false);
      }
      setPassword('');
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md clay-card bg-[#EEF2F7] p-5 sm:p-7 rounded-3xl border border-white/95 shadow-2xl relative text-right animate-modal-pop my-auto max-h-[90vh] overflow-y-auto"
      >
        <button
          type="button"
          onClick={handleContinueAsGuest}
          aria-label="تخطي والدخول كضيف"
          className="absolute top-4 left-4 w-8 h-8 rounded-full clay-btn flex items-center justify-center text-slate-500 hover:text-rose-600"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mb-4">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full clay-inset text-indigo-600 text-[11px] font-bold mb-1.5 font-decorative">
            <Sparkles className="w-3.5 h-3.5" />
            <span>مرحباً بك في CROVO SPACE</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black font-decorative text-slate-900">
            {mode === 'register' ? 'إنشاء حساب جديد' : 'تسجيل الدخول إلى حسابك'}
          </h2>
          <p className="mt-1 text-xs text-slate-600 font-ios">
            سجّل حسابك برقم خاص بيك عشان تلاقي تعليقاتك وطلباتك وإعجاباتك محفوظة معاك على طول.
          </p>
        </div>

        {/* Mode Switcher with Recommended Badge */}
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
            <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-900 text-[9px] font-black">
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
          <div className="mb-3 p-2.5 rounded-xl clay-inset text-xs font-bold text-rose-600 font-ios">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs font-ios">
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
                  className="w-full pr-9 pl-3 py-2.5 rounded-xl clay-inset border-none outline-none font-semibold"
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
                className="w-full pr-9 pl-3 py-2.5 rounded-xl clay-inset border-none outline-none font-mono text-left"
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
                className="w-full pr-9 pl-3 py-2.5 rounded-xl clay-inset border-none outline-none font-mono text-left"
              />
              <Lock className="w-4 h-4 text-indigo-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="block font-bold text-slate-700 mb-1">الصف الدراسي</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGrade('bac1')}
                  className={`py-2 rounded-xl font-bold ${
                    grade === 'bac1' ? 'clay-pill-active' : 'clay-inset text-slate-600'
                  }`}
                >
                  أولى بكالوريا
                </button>
                <button
                  type="button"
                  onClick={() => setGrade('bac2')}
                  className={`py-2 rounded-xl font-bold ${
                    grade === 'bac2' ? 'clay-pill-active' : 'clay-inset text-slate-600'
                  }`}
                >
                  تانية بكالوريا
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || googleBusy}
            data-testid="welcome-submit-btn"
            className="w-full clay-apple-blue py-3 rounded-2xl text-sm font-black text-white shadow-md disabled:opacity-60 mt-2"
          >
            {busy
              ? 'جاري التنفيذ...'
              : mode === 'register'
              ? 'إنشاء الحساب والمتابعة'
              : 'تسجيل الدخول'}
          </button>
        </form>

        <div className="relative flex items-center justify-center my-3.5">
          <div className="w-full border-t border-slate-300/60" />
          <span className="px-2.5 bg-[#EEF2F7] text-[10px] font-bold text-slate-500 font-ios whitespace-nowrap">
            أو الدخول السريع عبر Google
          </span>
          <div className="w-full border-t border-slate-300/60" />
        </div>

        <button
          type="button"
          data-testid="welcome-google-btn"
          disabled={googleBusy || busy}
          onClick={handleGoogleLogin}
          className="w-full py-2.5 px-4 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 shadow-sm flex items-center justify-center gap-2.5 text-xs sm:text-sm font-black text-slate-800 font-ios transition-all disabled:opacity-60"
        >
          <GoogleMark />
          <span>{googleBusy ? 'جاري الدخول عبر Google...' : 'المتابعة باستخدام حساب Google'}</span>
        </button>

        {/* Subtle bottom skip / guest button */}
        <div className="pt-3 mt-3 border-t border-slate-200/60 text-center">
          <button
            type="button"
            data-testid="welcome-skip-btn"
            onClick={handleContinueAsGuest}
            className="text-[11px] font-bold text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1 opacity-80 hover:opacity-100"
          >
            <span>تخطي وتسجيل الدخول كضيف (بدون حساب)</span>
            <ArrowLeft className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
