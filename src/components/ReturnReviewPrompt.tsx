import React, { useState } from 'react';
import { CheckCircle2, SendHorizonal, Sparkles, Star, X } from 'lucide-react';
import { api, ApiError } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  dismissPostWhatsAppReview,
  markPostWhatsAppReviewSubmitted,
  PostWhatsAppReviewState,
} from '../utils/orderDraft';

interface ReturnReviewPromptProps {
  reviewState: PostWhatsAppReviewState;
  onClose: () => void;
  onSubmitted: (orderCode: string) => void;
}

export const ReturnReviewPrompt: React.FC<ReturnReviewPromptProps> = ({
  reviewState,
  onClose,
  onSubmitted,
}) => {
  const { user, openAuthModal } = useAuth();
  const [authorName, setAuthorName] = useState(
    () => reviewState.fullName || user?.name || ''
  );
  const [grade, setGrade] = useState(() =>
    reviewState.grade === 'bac2' ? 'تانية بكالوريا' : 'أولى بكالوريا'
  );
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedOk, setSubmittedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDismiss = () => {
    dismissPostWhatsAppReview();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedName = authorName.trim();
    const trimmedContent = content.trim();
    if (trimmedName.length < 2) {
      setError('اكتب اسمك (حرفين على الأقل).');
      return;
    }
    if (trimmedContent.length < 3) {
      setError('اكتب تجربتك باختصار (3 أحرف على الأقل).');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.createComment({
        authorName: trimmedName,
        grade,
        rating,
        content: trimmedContent,
        showContactPublicly: false,
        moderationPending: true,
        orderCode: reviewState.lastOrderCode,
        source: 'post_whatsapp',
      });
      markPostWhatsAppReviewSubmitted(reviewState.lastOrderCode);
      setSubmittedOk(true);
      onSubmitted(reviewState.lastOrderCode);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        openAuthModal('سجّل دخولك لحسابك لتسجيل تقييم تجربتك على الطلب.');
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        markPostWhatsAppReviewSubmitted(reviewState.lastOrderCode);
        setSubmittedOk(true);
        onSubmitted(reviewState.lastOrderCode);
        return;
      }
      setError(err instanceof Error ? err.message : 'تعذر إرسال التقييم حالياً، حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="أضف تجربتك مع CROVO SPACE"
      data-testid="return-review-prompt"
      onClick={handleDismiss}
      className="fixed inset-0 z-50 bg-slate-950/70 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md clay-card bg-[#EEF2F7] p-5 sm:p-6 rounded-t-3xl sm:rounded-3xl border border-white/90 shadow-2xl relative text-right max-h-[90vh] overflow-y-auto"
      >
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="إغلاق نافذة التقييم"
          className="absolute top-4 left-4 w-8 h-8 rounded-full clay-btn flex items-center justify-center text-slate-500 hover:text-rose-600"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mb-3.5 pl-8">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full clay-inset text-indigo-600 text-[11px] font-bold mb-1.5 font-decorative">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>أهلاً بعودتك يا مدير</span>
          </div>
          <h2 className="text-lg font-black font-decorative text-slate-900">
            أضف تجربتك مع CROVO SPACE
          </h2>
          <p className="text-xs text-slate-600 font-ios mt-1">
            رأيك بعد تجربة الاشتراك (<span className="font-mono font-bold text-indigo-700">#{reviewState.lastOrderCode}</span> · {reviewState.platformLabel}) بيساعد باقي الطلاب ياخدوا قرار واضح.
          </p>
        </div>

        {submittedOk ? (
          <div className="space-y-4">
            <div
              data-testid="return-review-success"
              className="p-4 rounded-2xl clay-inset text-xs sm:text-sm font-bold text-emerald-700 font-ios flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500 mt-0.5" />
              <span>
                شكراً لمشاركتك! تم استلام تقييمك وهو الآن قيد مراجعة الإدارة وسيتم نشره للجميع بعد الموافقة.
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full clay-apple-blue py-2.5 rounded-xl text-xs font-bold text-white font-ios"
            >
              تمام
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-xs font-ios">
            {error && (
              <div className="p-2.5 rounded-xl clay-inset text-xs font-bold text-rose-600">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold text-slate-700 mb-1">الاسم</label>
                <input
                  type="text"
                  required
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="اسمك"
                  className="w-full px-3 py-2 rounded-xl clay-card border-none outline-none text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الصف</label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl clay-card border-none outline-none text-slate-900"
                >
                  <option value="أولى بكالوريا">أولى بكالوريا</option>
                  <option value="تانية بكالوريا">تانية بكالوريا</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">تقييمك</label>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    aria-label={`تقييم ${star} نجوم`}
                    onClick={() => setRating(star)}
                    className="p-1.5 rounded-xl clay-btn"
                  >
                    <Star
                      className={`w-4 h-4 ${
                        star <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                      }`}
                    />
                  </button>
                ))}
                <span className="text-[11px] font-bold text-slate-500 mr-2">{rating} من 5</span>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">تجربتك</label>
              <textarea
                required
                rows={3}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="احكي تجربتك مع التعامل والخدمة..."
                className="w-full p-3 rounded-xl clay-card border-none outline-none text-slate-900 resize-none"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                data-testid="return-review-later-btn"
                onClick={handleDismiss}
                className="clay-btn px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600"
              >
                لاحقًا
              </button>

              <button
                type="submit"
                disabled={submitting}
                data-testid="return-review-submit-btn"
                className="clay-apple-blue flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-md disabled:opacity-55"
              >
                <SendHorizonal className="w-3.5 h-3.5" />
                <span>{submitting ? 'جاري الإرسال...' : 'إرسال التقييم للمراجعة'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
