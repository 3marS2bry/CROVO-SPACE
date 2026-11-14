import React, { useState } from 'react';
import { Lock, Mail, Sparkles, User, X } from 'lucide-react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export const AuthModal: React.FC = () => {
  const { isAuthModalOpen, authPromptReason, closeAuthModal, consumePendingAction } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [grade, setGrade] = useState<'bac1' | 'bac2'>('bac1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        const res = await api.authRegister({ name, email, password, grade });
        consumePendingAction(res.user);
      } else {
        const res = await api.authLogin({ email, password });
        consumePendingAction(res.user);
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
        className="w-full max-w-md clay-card bg-[#EEF2F7] p-5 sm:p-7 rounded-3xl border border-white/95 shadow-2xl relative text-right animate-modal-pop"
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
                  placeholder="مثال: أحمد محمد"
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
            disabled={busy}
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
      </div>
    </div>
  );
};
