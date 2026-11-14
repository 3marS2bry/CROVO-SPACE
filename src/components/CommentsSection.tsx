import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Edit3,
  ExternalLink,
  Flag,
  Heart,
  ImagePlus,
  MessageSquarePlus,
  Phone,
  SendHorizonal,
  Star,
  Trash2,
  UserCircle2,
  X,
} from 'lucide-react';
import { api, CommentItem } from '../utils/api';

interface CommentsSectionProps {
  fullPageMode?: boolean;
  onOpenAllReviews?: () => void;
  onBackToLibrary?: () => void;
}

function formatArabicDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

async function compressImageToDataUrl(file: File, maxDimension = 1000): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('اختار صورة بصيغة PNG أو JPG أو WEBP فقط.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('حجم الصورة كبير أوي، اختار صورة أقل من 5 ميجا.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('الملف المختار مش صورة سليمة.'));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(outType, 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const CommentsSection: React.FC<CommentsSectionProps> = ({
  fullPageMode = false,
  onOpenAllReviews,
  onBackToLibrary,
}) => {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(fullPageMode);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'verified' | 'withImage'>('all');

  // Create form state
  const [authorName, setAuthorName] = useState('');
  const [grade, setGrade] = useState('تانية بكالوريا');
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [attachmentDataUrl, setAttachmentDataUrl] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [likingIds, setLikingIds] = useState<Record<string, boolean>>({});

  // Edit / Delete / Report states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editRating, setEditRating] = useState(5);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('محتوى غير مناسب');
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const loadComments = async () => {
    try {
      const res = await api.getComments();
      setComments(res.comments);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل التعليقات.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadComments();
    const handleAuthChanged = () => {
      loadComments();
    };
    window.addEventListener('crovo:auth-updated', handleAuthChanged);
    return () => window.removeEventListener('crovo:auth-updated', handleAuthChanged);
  }, []);

  const statsSummary = useMemo(() => {
    const total = comments.length;
    const verified = comments.filter((c) => c.isVerified).length;
    const avg =
      total > 0
        ? (comments.reduce((acc, c) => acc + c.rating, 0) / total).toFixed(1)
        : '—';
    return { total, verified, avg };
  }, [comments]);

  const visibleComments = useMemo(() => {
    let list = comments;
    if (reviewFilter === 'verified') {
      list = comments.filter((c) => c.isVerified);
    } else if (reviewFilter === 'withImage') {
      list = comments.filter((c) => Boolean(c.attachmentUrl));
    }
    return fullPageMode ? list : list.slice(0, 6);
  }, [comments, reviewFilter, fullPageMode]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 360);
      setAvatarDataUrl(dataUrl);
      setFormMsg(null);
    } catch (err) {
      setFormMsg({ type: 'err', text: err instanceof Error ? err.message : 'تعذر تجهيز الصورة.' });
    }
  };

  const handleAttachmentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 1000);
      setAttachmentDataUrl(dataUrl);
      setFormMsg(null);
    } catch (err) {
      setFormMsg({ type: 'err', text: err instanceof Error ? err.message : 'تعذر تجهيز الصورة.' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormMsg(null);

    try {
      const res = await api.createComment({
        authorName,
        grade,
        rating,
        content,
        contactPhone: contactPhone.trim() || undefined,
        showContactPublicly: false,
        avatarDataUrl,
        attachmentDataUrl,
      });

      setComments((prev) => [res.comment, ...prev]);
      setAuthorName('');
      setContent('');
      setRating(5);
      setAvatarDataUrl(null);
      setAttachmentDataUrl(null);
      setContactPhone('');
      setFormMsg({ type: 'ok', text: 'تسلم يا بطل! تعليقك اتنشر وهيشوفه كل زوار الموقع دلوقتي.' });
    } catch (err) {
      setFormMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر نشر التعليق، حاول تاني.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await api.updateComment(id, { content: editContent, rating: editRating });
      setEditingId(null);
      await loadComments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تعديل التعليق.');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteComment(id);
      setConfirmDeleteId(null);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف التعليق.');
    }
  };

  const handleReportSubmit = async (id: string) => {
    try {
      const res = await api.reportComment(id, reportReason);
      setReportingId(null);
      setReportNotice(res.message);
      if (res.flaggedForReview) {
        setComments((prev) => prev.filter((c) => c.id !== id));
      }
      window.setTimeout(() => setReportNotice(null), 4000);
    } catch (err) {
      setReportNotice(err instanceof Error ? err.message : 'تعذر إرسال البلاغ.');
      setReportingId(null);
    }
  };

  const handleToggleCommentLike = async (commentId: string) => {
    if (likingIds[commentId]) return;
    const current = comments.find((c) => c.id === commentId);
    const desiredLiked = current ? !current.hasLiked : undefined;
    setLikingIds((prev) => ({ ...prev, [commentId]: true }));

    try {
      const res = await api.toggleLike(`comment:${commentId}`, desiredLiked);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, likesCount: res.count, hasLiked: res.liked }
            : c
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الإعجاب.');
    } finally {
      setLikingIds((prev) => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
    }
  };

  return (
    <section
      id="student-comments"
      data-testid={fullPageMode ? 'reviews-full-page' : 'comments-section'}
      className="max-w-5xl mx-auto px-3 sm:px-6 my-6 sm:my-10"
    >
      <div className="clay-card p-4 sm:p-7 text-right border border-white/80">
        {fullPageMode && onBackToLibrary && (
          <div className="mb-4">
            <button
              type="button"
              onClick={onBackToLibrary}
              className="clay-btn px-3.5 py-2 rounded-xl text-xs font-bold text-indigo-600 flex items-center gap-1.5 font-ios"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>الرجوع للمكتبة والرئيسية</span>
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200/60">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-xl clay-inset text-amber-700 text-[11px] font-bold mb-1 font-decorative">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span>آراء عملائنا وتجاربهم الحقيقية</span>
            </div>
            <h2 className="text-lg sm:text-2xl font-black font-decorative text-slate-900">
              {fullPageMode
                ? 'آراء عملائنا — كل التقييمات على CROVO SPACE'
                : 'آراء عملائنا على CROVO SPACE'}
            </h2>
            <p className="text-xs text-slate-600 font-ios mt-0.5">
              كل رأي أو تجربة بتتكتب هنا بتتحفظ في قاعدة البيانات وتظهر لكل زوار الموقع فوراً.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!fullPageMode && onOpenAllReviews && (
              <button
                type="button"
                data-testid="open-all-reviews-btn"
                onClick={onOpenAllReviews}
                className="clay-btn px-3.5 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-1.5 text-indigo-600 font-ios"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>كل التقييمات ({statsSummary.total})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsFormOpen((p) => !p)}
              className="clay-apple-blue px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 text-white font-ios shadow-md"
            >
              <MessageSquarePlus className="w-4 h-4" />
              <span>{isFormOpen ? 'إخفاء نموذج التعليق' : 'أضف تعليقك وتجربتك'}</span>
            </button>
          </div>
        </div>

        {/* Real Summary Bar + Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4 text-xs font-ios">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded-xl clay-inset font-bold text-slate-700">
              إجمالي الآراء: <span className="font-mono text-indigo-600">{statsSummary.total}</span>
            </span>
            <span className="px-2.5 py-1 rounded-xl clay-inset font-bold text-slate-700">
              متوسط التقييم: <span className="font-mono text-amber-500">{statsSummary.avg} ★</span>
            </span>
            <span className="px-2.5 py-1 rounded-xl clay-inset font-bold text-emerald-700">
              عملاء موثّقون: <span className="font-mono">{statsSummary.verified}</span>
            </span>
          </div>

          <div className="clay-pill-track flex flex-wrap items-center gap-1 p-1">
            {(
              [
                ['all', 'الكل'],
                ['verified', 'موثّقون فقط'],
                ['withImage', 'بتجارب مصوّرة'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setReviewFilter(key)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                  reviewFilter === key
                    ? 'clay-pill-active'
                    : 'text-slate-600 hover:text-indigo-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {reportNotice && (
          <div className="mb-3 p-2.5 rounded-xl clay-inset text-xs font-bold text-indigo-700 font-ios">
            {reportNotice}
          </div>
        )}

        {error && (
          <div className="mb-3 p-2.5 rounded-xl clay-inset text-xs font-bold text-rose-600 font-ios flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={loadComments} className="underline font-bold">
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Add Comment Form */}
        {isFormOpen && (
          <form
            onSubmit={handleSubmit}
            className="mb-6 p-3.5 sm:p-5 rounded-2xl clay-inset space-y-3 border border-indigo-200/50"
          >
            <h3 className="text-sm font-black font-ios text-slate-900">
              شارك تجربتك مع الكل (بالاسم والصورة لو حابب):
            </h3>

            {formMsg && (
              <div
                className={`p-2.5 rounded-xl clay-card text-xs font-bold font-ios ${
                  formMsg.type === 'ok'
                    ? 'text-emerald-700'
                    : 'text-rose-600'
                }`}
              >
                {formMsg.text}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 font-ios">
                  اسمك:
                </label>
                <input
                  type="text"
                  required
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="عمر صبري"
                  className="w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-ios clay-card border-none outline-none text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 font-ios">
                  السنة / القسم:
                </label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-ios clay-card border-none outline-none text-slate-900"
                >
                  <option value="أولى بكالوريا">أولى بكالوريا</option>
                  <option value="تانية بكالوريا">تانية بكالوريا</option>
                  <option value="تانية بكالوريا - الثقافة المالية">تانية بكالوريا - الثقافة المالية</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1 font-ios">
                تقييمك:
              </label>
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
                <span className="text-xs font-bold text-slate-500 font-ios mr-2">{rating} من 5</span>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1 font-ios">
                تعليقك وتجربتك:
              </label>
              <textarea
                required
                rows={3}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="احكي تجربتك بصراحة..."
                className="w-full p-3 rounded-xl text-xs sm:text-sm font-ios clay-card border-none outline-none text-slate-900 resize-none"
              />
            </div>

            {/* Optional Avatar & Attachment Uploads */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="p-2.5 rounded-xl clay-card flex items-center justify-between gap-2">
                <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-slate-700 font-ios flex-1">
                  <UserCircle2 className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span>{avatarDataUrl ? 'تم اختيار صورة شخصية ✓' : 'صورة شخصية (اختياري)'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </label>
                {avatarDataUrl && (
                  <div className="flex items-center gap-1.5">
                    <img src={avatarDataUrl} alt="معاينة الصورة الشخصية" className="w-7 h-7 rounded-full object-cover" />
                    <button
                      type="button"
                      aria-label="إزالة الصورة الشخصية"
                      onClick={() => setAvatarDataUrl(null)}
                      className="p-1 text-rose-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-xl clay-card flex items-center justify-between gap-2">
                <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-slate-700 font-ios flex-1">
                  <ImagePlus className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{attachmentDataUrl ? 'تم إرفاق صورة التجربة ✓' : 'صورة داخل التعليق (اختياري)'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleAttachmentChange}
                    className="hidden"
                  />
                </label>
                {attachmentDataUrl && (
                  <div className="flex items-center gap-1.5">
                    <img src={attachmentDataUrl} alt="معاينة صورة التجربة" className="w-7 h-7 rounded-lg object-cover" />
                    <button
                      type="button"
                      aria-label="إزالة صورة التجربة"
                      onClick={() => setAttachmentDataUrl(null)}
                      className="p-1 text-rose-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Optional Private Phone Verification Field (Never Shown Publicly) */}
            <div className="p-3 rounded-xl clay-card space-y-2 border border-indigo-100/80">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 font-ios">
                <Phone className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>رقم الهاتف للتوثيق (اختياري تمامًا)</span>
              </div>
              <p className="text-[11px] font-medium text-slate-600 font-ios leading-relaxed">
                رقم الهاتف اختياري تمامًا، ومش مطلوب منك تكتبه. بنوفره فقط لو حابب تساعدنا في التأكد من إنك تعاملت مع عمر صبري، وتشارك تجربتك الحقيقية مع الخدمة.
              </p>
              <input
                type="tel"
                dir="ltr"
                data-testid="comment-phone-input"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="01XXXXXXXXX (اختياري)"
                className="w-full sm:w-64 px-3 py-1.5 rounded-xl text-xs font-mono clay-inset border-none outline-none text-slate-900 text-left"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="clay-apple-blue py-2.5 px-6 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 text-white font-ios shadow-md disabled:opacity-60"
            >
              <SendHorizonal className="w-4 h-4" />
              <span>{submitting ? 'جاري النشر...' : 'نشر التعليق للجميع'}</span>
            </button>
          </form>
        )}

        {/* Comments List */}
        {loading ? (
          <div className="space-y-3">
            <div className="h-24 rounded-2xl clay-inset animate-pulse" />
            <div className="h-24 rounded-2xl clay-inset animate-pulse" />
          </div>
        ) : visibleComments.length === 0 ? (
          <div className="p-6 rounded-2xl clay-inset text-center space-y-2">
            <p className="text-sm font-bold font-ios text-slate-700">
              {comments.length === 0
                ? 'لسه مفيش تعليقات منشورة دلوقتي.'
                : 'مفيش تقييمات مطابقة للفلتر المختار دلوقتي.'}
            </p>
            <p className="text-xs text-slate-500 font-ios">
              {comments.length === 0
                ? 'كن أول طالب يشارك تجربته الحقيقية عشان باقي الزوار يشوفوها!'
                : 'جرّب اختيار"الكل" عشان تشوف باقي التعليقات.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleComments.map((cmt) => (
              <article
                key={cmt.id}
                data-testid={`comment-card-${cmt.id}`}
                className="clay-inset p-3.5 rounded-2xl space-y-2 text-right flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {cmt.avatarUrl ? (
                        <img
                          src={cmt.avatarUrl}
                          alt={cmt.authorName}
                          className="w-9 h-9 rounded-full object-cover shrink-0 shadow-sm"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full clay-apple-blue flex items-center justify-center text-white text-xs font-black font-ios shrink-0">
                          {cmt.authorName.charAt(0)}
                        </div>
                      )}

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs sm:text-sm font-black font-ios text-slate-900 truncate">
                            {cmt.authorName}
                          </span>
                          {cmt.isVerified && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 font-ios">
                              <BadgeCheck className="w-3.5 h-3.5 text-emerald-500" />
                              <span>عميل موثّق</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-ios">
                          {cmt.grade} · {formatArabicDate(cmt.createdAt)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 text-amber-400 shrink-0">
                      {[...Array(cmt.rating)].map((_, idx) => (
                        <Star key={idx} className="w-3 h-3 fill-current" />
                      ))}
                    </div>
                  </div>

                  {editingId === cmt.id ? (
                    <div className="space-y-2 pt-1">
                      <textarea
                        rows={2}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full p-2 rounded-xl text-xs font-ios clay-card border-none outline-none text-slate-900"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setEditRating(s)}
                              className="p-1"
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${
                                  s <= editRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(cmt.id)}
                            className="clay-apple-blue px-3 py-1 rounded-lg text-[11px] font-bold text-white font-ios"
                          >
                            حفظ
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="clay-btn px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-600 font-ios"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs sm:text-sm text-slate-800 font-ios leading-relaxed break-words">
                      {cmt.content}
                    </p>
                  )}

                  {cmt.attachmentUrl && (
                    <button
                      type="button"
                      onClick={() => setLightboxSrc(cmt.attachmentUrl)}
                      className="block rounded-xl overflow-hidden border border-slate-200/70 max-w-full"
                    >
                      <img
                        src={cmt.attachmentUrl}
                        alt={`تجربة ${cmt.authorName}`}
                        className="max-h-44 w-auto object-cover rounded-xl"
                      />
                    </button>
                  )}

                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/50 text-[11px] font-ios">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={Boolean(likingIds[cmt.id])}
                      data-testid={`comment-like-btn-${cmt.id}`}
                      onClick={() => handleToggleCommentLike(cmt.id)}
                      className={`px-2.5 py-1 rounded-xl flex items-center gap-1 font-bold transition-all disabled:opacity-60 ${
                        cmt.hasLiked
                          ? 'bg-rose-500/15 text-rose-600 ring-1 ring-rose-400/40'
                          : 'clay-btn text-slate-600 hover:text-rose-600'
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${cmt.hasLiked ? 'fill-rose-500 text-rose-500' : ''}`}
                      />
                      <span className="font-mono" data-testid={`comment-like-count-${cmt.id}`}>
                        {cmt.likesCount || 0}
                      </span>
                    </button>

                    {cmt.isOwner ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(cmt.id);
                            setEditContent(cmt.content);
                            setEditRating(cmt.rating);
                          }}
                          className="text-indigo-600 hover:underline flex items-center gap-1 font-bold"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>

                        {confirmDeleteId === cmt.id ? (
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDelete(cmt.id)}
                              className="text-rose-600 font-black underline"
                            >
                              تأكيد الحذف
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-slate-500"
                            >
                              إلغاء
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(cmt.id)}
                            className="text-rose-600 hover:underline flex items-center gap-1 font-bold"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>حذف</span>
                          </button>
                        )}
                      </div>
                    ) : cmt.updatedAt ? (
                      <span className="text-[10px] text-slate-400">تم التعديل</span>
                    ) : null}
                  </div>

                  {reportingId === cmt.id ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value)}
                        className="px-2 py-1 rounded-lg text-[10px] clay-card text-slate-800"
                      >
                        <option value="محتوى غير مناسب">محتوى غير مناسب</option>
                        <option value="إعلان أو سبام">إعلان أو سبام</option>
                        <option value="كلام مسيء">كلام مسيء</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleReportSubmit(cmt.id)}
                        className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold"
                      >
                        إرسال
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportingId(null)}
                        className="text-slate-500 text-[10px]"
                      >
                        إلغاء
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReportingId(cmt.id)}
                      className="text-slate-400 hover:text-rose-500 flex items-center gap-1 font-bold"
                    >
                      <Flag className="w-3 h-3" />
                      <span>إبلاغ</span>
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {!fullPageMode && comments.length > 6 && onOpenAllReviews && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={onOpenAllReviews}
              className="clay-btn px-5 py-2.5 rounded-2xl text-xs font-bold text-indigo-600 font-ios inline-flex items-center gap-1.5"
            >
              <span>عرض جميع التقييمات ({comments.length})</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4"
        >
          <div onClick={(e) => e.stopPropagation()} className="relative max-w-lg w-full clay-card p-3 bg-slate-900">
            <button
              type="button"
              aria-label="إغلاق الصورة"
              onClick={() => setLightboxSrc(null)}
              className="absolute top-4 left-4 p-2 rounded-full bg-black/70 text-white"
            >
              <X className="w-4 h-4" />
            </button>
            <img src={lightboxSrc} alt="صورة التجربة" className="w-full max-h-[80vh] object-contain rounded-xl" />
          </div>
        </div>
      )}
    </section>
  );
};
