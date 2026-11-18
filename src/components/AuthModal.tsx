import React, { useEffect, useRef, useState } from 'react';
import { Lock, Mail, Sparkles, User, X } from 'lucide-react';
import { api } from '../utils/api';
import {
  getFirebaseIdToken,
  launchInstantGoogleChooser,
  registerWithEmailCloud,
  signInWithEmailCloud,
} from '../utils/cloudStore';
import { useAuth } from '../context/AuthContext';

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

export const AuthModal: React.FC = () => {
  const { isAuthModalOpen, authPromptReason, closeAuthModal, consumePendingAction, loginWithGoogle } =
    useAuth();
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
    if (!isAuthModalOpen) return;
    return launchInstantGoogleChooser({
      preferredGrade: gradeRef.current,
      onSignedIn: (cloudUser) => {
        consumeRef.current(cloudUser);
      },
    });
  }, [isAuthModalOpen]);

  if (!isAuthModalOpen) return null;

  const handleGoogleLogin = async () => {
    if (googleBusy || busy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      const cloudUser = await loginWithGoogle(grade);
      consumePendingAction(cloudUser);
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
        consumePendingAction(finalUser);
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
        consumePendingAction(finalUser);
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
      data-testid="auth-modal"
      role="dialog"
      aria-modal="true"
      onClick={closeAuthModal}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md clay-card bg-[#EEF2F7] p-5 sm:p-7 rounded-3xl border border-white/95 shadow-2xl relative text-right animate-modal-pop max-h-[92vh] overflow-y-auto"
      >
        <button
          type="button"
          onClick={closeAuthModal}
          aria-label="إغلاق"
          className="absolute top-4 left-4 w-8 h-8 rounded-full clay-btn flex items-center justify-center text-slate-500 hover:text-rose-600"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mb-4">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full clay-inset text-indigo-600 text-[11px] font-bold mb-1.5 font-decorative">
            <Sparkles className="w-3.5 h-3.5" />
            <span>حسابك في CROVO SPACE</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black font-decorative text-slate-900">
            {mode === 'register' ? 'إنشاء حساب طالب جديد' : 'تسجيل الدخول إلى حسابك'}
          </h2>
          {authPromptReason && (
            <p className="mt-1.5 text-xs font-bold text-indigo-700 bg-indigo-50/90 border border-indigo-200/70 rounded-xl p-2.5 font-ios">
              {authPromptReason}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-600 font-ios">
            سجّل حسابك برقم خاص بيك عشان تعليقاتك وطلباتك وإعجاباتك تفضل معاك دايماً.
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="clay-pill-track grid grid-cols-2 gap-1 p-1 mb-4">
          <button
            type="button"
            data-testid="auth-tab-register"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`py-2 rounded-full text-xs font-bold font-ios transition-all ${
              mode === 'register' ? 'clay-pill-active' : 'text-slate-600'
            }`}
          >
            حساب جديد
          </button>
          <button
            type="button"
            data-testid="auth-tab-login"
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
                  data-testid="auth-name-input"
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
                data-testid="auth-email-input"
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
                data-testid="auth-password-input"
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
            data-testid="auth-submit-btn"
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
          data-testid="auth-google-btn"
          disabled={googleBusy || busy}
          onClick={handleGoogleLogin}
          className="w-full py-2.5 px-4 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 shadow-sm flex items-center justify-center gap-2.5 text-xs sm:text-sm font-black text-slate-800 font-ios transition-all disabled:opacity-60"
        >
          <GoogleMark />
          <span>
            {googleBusy ? 'جاري الربط بحساب Google...' : 'المتابعة باستخدام حساب Google'}
          </span>
        </button>
      </div>
    </div>
  );
};
