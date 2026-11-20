import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Sparkles,
  Star,
  Trash2,
  UserCircle2,
  X,
} from 'lucide-react';
import { api, ApiError, AuthUser, CommentItem } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  getCachedComments,
  hasCompletedInitialBootstrap,
  setFastComments,
  subscribeFastStore,
} from '../utils/fastStore';
import {
  createCloudComment,
  deleteCloudComment,
  fetchApprovedCommentsCloudOneShot,
  getFirebaseUid,
  logCloudActivity,
  reportCloudComment,
  toggleCloudCommentLike,
  updateCloudComment,
} from '../utils/cloudStore';

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

async function compressImageToDataUrl(
  file: File,
  maxDimension = 920,
  maxDataUrlChars = 280000
): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('اختار صورة بصيغة PNG أو JPG أو WEBP فقط.');
  }
  if (file.size > 6 * 1024 * 1024) {
    throw new Error('حجم الصورة كبير أوي، اختار صورة أقل من 6 ميجا.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('الملف المختار مش صورة سليمة.'));
      img.onload = () => {
        const renderAt = (dim: number, quality: number, outMime: string): string => {
          const scale = Math.min(1, dim / Math.max(img.width, img.height));
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return String(reader.result);
          ctx.drawImage(img, 0, 0, width, height);
          return canvas.toDataURL(outMime, quality);
        };

        const outType = file.type === 'image/png' ? 'image/jpeg' : file.type;
        let dataUrl = renderAt(maxDimension, 0.8, outType);

        const attempts: Array<[number, number]> = [
          [Math.round(maxDimension * 0.8), 0.72],
          [Math.round(maxDimension * 0.65), 0.64],
          [520, 0.56],
        ];
        for (const [dim, q] of attempts) {
          if (dataUrl.length <= maxDataUrlChars) break;
          dataUrl = renderAt(dim, q, 'image/jpeg');
        }

        if (dataUrl.length > maxDataUrlChars) {
          reject(new Error('حجم الصورة بعد الضغط ما زال كبيراً، جرب صورة أصغر.'));
          return;
        }
        resolve(dataUrl);
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
  const { user, isCloudUser, openAuthModal } = useAuth();
  const [cloudComments, setCloudComments] = useState<CommentItem[]>([]);
  const [apiComments, setApiComments] = useState<CommentItem[]>(() => getCachedComments() || []);
  const [loading, setLoading] = useState(() => getCachedComments() === null);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(fullPageMode);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'verified' | 'withImage'>('all');

  // Create form state
  const [authorName, setAuthorName] = useState('');
  const [grade, setGrade] = useState('تانية بكالوريا');
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [attachmentBeforeDataUrl, setAttachmentBeforeDataUrl] = useState<string | null>(null);
  const [attachmentAfterDataUrl, setAttachmentAfterDataUrl] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [likingIds, setLikingIds] = useState<Record<string, boolean>>({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Edit / Delete / Report / Lightbox states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editRating, setEditRating] = useState(5);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('محتوى غير مناسب');
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; label: string } | null>(null);

  useEffect(() => {
    if (user?.name && !authorName.trim()) {
      setAuthorName(user.name);
    }
  }, [user?.name]);

  const lastFetchedAuthUidRef = useRef<string | null | undefined>(undefined);
  const oneShotCloudTriedRef = useRef(false);

  const loadApiComments = useCallback(async (forceCloudFallback = false) => {
    try {
      const res = await api.getComments();
      const mapped = res.comments.map((c) => ({ ...c, source: 'api' as const }));
      if (res.quotaDegraded && mapped.length === 0) {
        const cached = getCachedComments();
        if (cached && cached.length > 0) {
          setApiComments(cached);
          setError(null);
          return;
        }
        if (!oneShotCloudTriedRef.current || forceCloudFallback) {
          oneShotCloudTriedRef.current = true;
          try {
            const cloudFallback = await fetchApprovedCommentsCloudOneShot(user?.id);
            if (cloudFallback.length > 0) {
              setCloudComments(cloudFallback);
              setFastComments(cloudFallback);
              setError(null);
              return;
            }
          } catch {
            // Fall through to soft non-blocking notice below
          }
        }
        setApiComments((prev) => {
          if (prev.length > 0) {
            setError(null);
            return prev;
          }
          setError('يتم تحديث التعليقات مؤقتاً بسبب ضغط قاعدة البيانات. اضغط «إعادة المحاولة».');
          return prev;
        });
        return;
      }

      setApiComments(mapped);
      if (!res.quotaDegraded || mapped.length > 0) {
        setFastComments(mapped);
      }
      setError(null);
    } catch {
      // Keep cached or cloud comments if backend API is temporarily unavailable
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const unsubFast = subscribeFastStore(() => {
      const cached = getCachedComments();
      if (cached && (!cached.length ? false : true)) {
        setApiComments(cached);
        setLoading(false);
      }
    });

    const currentUid = user?.id || null;
    const cachedNow = getCachedComments();
    const shouldFetchNow =
      lastFetchedAuthUidRef.current !== currentUid &&
      (Boolean(currentUid) || (hasCompletedInitialBootstrap() && (!cachedNow || cachedNow.length === 0)));

    if (shouldFetchNow) {
      lastFetchedAuthUidRef.current = currentUid;
      void loadApiComments();
    }

    const handleAuthChanged = (ev: Event) => {
      const nextUid = ((ev as CustomEvent<AuthUser | null>).detail?.id) || null;
      if (nextUid === lastFetchedAuthUidRef.current) return;
      lastFetchedAuthUidRef.current = nextUid;
      void loadApiComments();
    };
    window.addEventListener('crovo:auth-updated', handleAuthChanged);
    return () => {
      unsubFast();
      window.removeEventListener('crovo:auth-updated', handleAuthChanged);
    };
  }, [user?.id, loadApiComments]);

  const apiCommentIds = useMemo(() => new Set(apiComments.map((c) => c.id)), [apiComments]);
  const cloudCommentIds = useMemo(() => new Set(cloudComments.map((c) => c.id)), [cloudComments]);

  const comments = useMemo(() => {
    const byId = new Map<string, CommentItem>();
    for (const c of apiComments) {
      byId.set(c.id, c);
    }
    for (const c of cloudComments) {
      const existing = byId.get(c.id);
      if (existing) {
        byId.set(c.id, {
          ...existing,
          authorName: c.authorName || existing.authorName,
          grade: c.grade || existing.grade,
          rating: c.rating || existing.rating,
          content: c.content || existing.content,
          isVerified: existing.isVerified || c.isVerified,
          updatedAt: c.updatedAt || existing.updatedAt,
          isOwner: existing.isOwner || c.isOwner,
          hasLiked: existing.hasLiked || c.hasLiked,
          likesCount: Math.max(existing.likesCount, c.likesCount),
        });
      } else {
        byId.set(c.id, c);
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  }, [cloudComments, apiComments]);

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
      list = comments.filter((c) =>
        Boolean(c.attachmentBeforeUrl || c.attachmentAfterUrl || c.attachmentUrl)
      );
    }
    return fullPageMode ? list : list.slice(0, 6);
  }, [comments, reviewFilter, fullPageMode]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 320, 100000);
      setAvatarDataUrl(dataUrl);
      setFormMsg(null);
    } catch (err) {
      setFormMsg({ type: 'err', text: err instanceof Error ? err.message : 'تعذر تجهيز الصورة.' });
    }
  };

  const handleBeforeImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 920, 280000);
      setAttachmentBeforeDataUrl(dataUrl);
      setFormMsg(null);
    } catch (err) {
      setFormMsg({ type: 'err', text: err instanceof Error ? err.message : 'تعذر تجهيز صورة قبل الحل.' });
    }
  };

  const handleAfterImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 920, 280000);
      setAttachmentAfterDataUrl(dataUrl);
      setFormMsg(null);
    } catch (err) {
      setFormMsg({ type: 'err', text: err instanceof Error ? err.message : 'تعذر تجهيز صورة بعد الحل.' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFormMsg(null);

    try {
      const fbUid = getFirebaseUid();
      let savedComment: CommentItem | null = null;

      try {
        const res = await api.createComment({
          authorName,
          grade,
          rating,
          content,
          contactPhone: contactPhone.trim() || undefined,
          showContactPublicly: false,
          avatarDataUrl,
          attachmentBeforeDataUrl,
          attachmentAfterDataUrl,
        });
        savedComment = { ...res.comment, source: 'api' };
        setApiComments((prev) => {
          const next = [savedComment!, ...prev];
          setFastComments(next);
          return next;
        });
      } catch (apiErr) {
        if (apiErr instanceof ApiError && (apiErr.status === 401 || apiErr.status === 400 || apiErr.status === 429)) {
          throw apiErr;
        }
        if (!fbUid) throw apiErr;
        savedComment = await createCloudComment(fbUid, {
          authorName,
          grade,
          rating,
          content,
          contactPhone: contactPhone.trim() || undefined,
          avatarDataUrl,
          attachmentBeforeDataUrl,
          attachmentAfterDataUrl,
        });
        setCloudComments((prev) => [savedComment!, ...prev]);
      }

      if (fbUid) {
        void logCloudActivity(fbUid, {
          eventType: 'comment_create',
          label: 'إضافة تقييم وتعليق',
          path: '/reviews',
          detail: content.trim().slice(0, 80),
        });
      }

      setAuthorName(user?.name || '');
      setContent('');
      setRating(5);
      setAvatarDataUrl(null);
      setAttachmentBeforeDataUrl(null);
      setAttachmentAfterDataUrl(null);
      setContactPhone('');
      setFormMsg({ type: 'ok', text: 'تسلم يا مدير! تم نشر تعليقك بنجاح وهيفضل ظاهر للجميع.' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        openAuthModal('سجّل دخولك الأول عشان تقدر تنشر تعليقك.');
      }
      setFormMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر نشر التعليق، حاول تاني.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (cmt: CommentItem) => {
    try {
      const fbUid = getFirebaseUid();
      try {
        await api.updateComment(cmt.id, { content: editContent, rating: editRating });
        await loadApiComments();
      } catch (apiErr) {
        if (apiErr instanceof ApiError && (apiErr.status === 401 || apiErr.status === 403 || apiErr.status === 404)) {
          throw apiErr;
        }
        if (!fbUid) throw apiErr;
        await updateCloudComment(cmt.id, { content: editContent, rating: editRating });
      }
      if (fbUid) {
        void logCloudActivity(fbUid, {
          eventType: 'comment_edit',
          label: 'تعديل تعليق',
          path: '/reviews',
          detail: editContent.trim().slice(0, 80),
        });
      }
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تعديل التعليق.');
    }
  };

  const handleDelete = async (cmt: CommentItem) => {
    try {
      const fbUid = getFirebaseUid();
      try {
        await api.deleteComment(cmt.id);
      } catch (apiErr) {
        if (apiErr instanceof ApiError && (apiErr.status === 401 || apiErr.status === 403)) {
          throw apiErr;
        }
        if (!fbUid) throw apiErr;
        await deleteCloudComment(cmt.id);
      }
      setApiComments((prev) => {
        const next = prev.filter((c) => c.id !== cmt.id);
        setFastComments(next);
        return next;
      });
      setCloudComments((prev) => prev.filter((c) => c.id !== cmt.id));
      if (fbUid) {
        void logCloudActivity(fbUid, {
          eventType: 'comment_delete',
          label: 'حذف تعليق',
          path: '/reviews',
        });
      }
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف التعليق.');
    }
  };

  const handleReportSubmit = async (cmt: CommentItem) => {
    try {
      const fbUid = getFirebaseUid();
      try {
        const res = await api.reportComment(cmt.id, reportReason);
        setReportingId(null);
        setReportNotice(res.message);
        if (res.flaggedForReview) {
          setApiComments((prev) => prev.filter((c) => c.id !== cmt.id));
          setCloudComments((prev) => prev.filter((c) => c.id !== cmt.id));
        }
      } catch (apiErr) {
        if (apiErr instanceof ApiError && apiErr.status === 401) {
          setReportingId(null);
          openAuthModal('سجّل دخولك لإرسال بلاغ عن تعليق.');
          return;
        }
        if (apiErr instanceof ApiError && apiErr.status === 409) {
          throw apiErr;
        }
        if (!fbUid) throw apiErr;
        const res = await reportCloudComment(cmt.id, fbUid, reportReason);
        setReportingId(null);
        setReportNotice(res.message);
      }
      window.setTimeout(() => setReportNotice(null), 4000);
    } catch (err) {
      setReportNotice(err instanceof Error ? err.message : 'تعذر إرسال البلاغ.');
      setReportingId(null);
    }
  };

  const handleToggleCommentLike = async (cmt: CommentItem) => {
    if (likingIds[cmt.id]) return;

    const fbUid = getFirebaseUid();
    setLikingIds((prev) => ({ ...prev, [cmt.id]: true }));
    const nextDesired = !cmt.hasLiked;
    try {
      let res: { count: number; liked: boolean };
      try {
        res = await api.toggleLike(`comment:${cmt.id}`, nextDesired);
      } catch (apiErr) {
        if (apiErr instanceof ApiError && apiErr.status === 401) {
          openAuthModal('سجّل دخولك أولاً لتسجيل إعجابك بالتعليق.');
          return;
        }
        if (!fbUid) throw apiErr;
        res = await toggleCloudCommentLike(cmt.id, fbUid, nextDesired);
      }

      setApiComments((prev) => {
        const next = prev.map((c) =>
          c.id === cmt.id ? { ...c, likesCount: res.count, hasLiked: res.liked } : c
        );
        setFastComments(next);
        return next;
      });
      setCloudComments((prev) =>
        prev.map((c) =>
          c.id === cmt.id ? { ...c, likesCount: res.count, hasLiked: res.liked } : c
        )
      );

      if (fbUid) {
        void logCloudActivity(fbUid, {
          eventType: res.liked ? 'comment_like' : 'comment_unlike',
          label: res.liked ? 'إعجاب بتعليق' : 'إلغاء الإعجاب بتعليق',
          path: '/reviews',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الإعجاب.');
    } finally {
      setLikingIds((prev) => {
        const next = { ...prev };
        delete next[cmt.id];
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
              كل رأي وتجربة قبل وبعد الحل بتظهر لجميع زوار الموقع وتبقى مرجعاً حقيقياً للجميع.
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
          <div className="mb-3 p-2.5 rounded-xl clay-inset text-xs font-bold text-rose-600 font-ios flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadApiComments(true)}
              className="underline font-bold shrink-0"
            >
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-sm font-black font-ios text-slate-900">
                شارك تجربتك مع الكل (مع صور قبل الحل وبعد الحل لو حابب):
              </h3>

              {!user ? (
                <button
                  type="button"
                  onClick={() =>
                    openAuthModal('سجّل دخولك بحسابك لربط تعليقاتك وتعديلاتك باسمك مباشرة.')
                  }
                  className="clay-btn px-3 py-1.5 rounded-xl text-[11px] font-bold text-indigo-700 flex items-center gap-1.5 font-ios self-start sm:self-auto"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>تسجيل الدخول لربط التعليق بحسابك</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-700 text-[11px] font-bold font-ios self-start sm:self-auto">
                  <BadgeCheck className="w-3.5 h-3.5" />
                  <span>
                    مرتبط بحسابك ({user.name}
                    {user.serialNumber ? ` · ${user.serialNumber}` : ''})
                  </span>
                </span>
              )}
            </div>

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

            {/* Optional Avatar + Before & After Solution Images */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Avatar */}
              <div className="p-2.5 rounded-xl clay-card flex items-center justify-between gap-2">
                <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-slate-700 font-ios flex-1 min-w-0">
                  <UserCircle2 className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span className="truncate">
                    {avatarDataUrl ? 'صورة شخصية ✓' : 'صورة شخصية (اختياري)'}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </label>
                {avatarDataUrl && (
                  <div className="flex items-center gap-1 shrink-0">
                    <img
                      src={avatarDataUrl}
                      alt="معاينة الصورة الشخصية"
                      className="w-7 h-7 rounded-full object-cover"
                    />
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

              {/* Before Solution Image */}
              <div className="p-2.5 rounded-xl clay-card flex items-center justify-between gap-2 border border-amber-200/70">
                <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-slate-700 font-ios flex-1 min-w-0">
                  <ImagePlus className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="truncate">
                    {attachmentBeforeDataUrl ? 'صورة قبل الحل ✓' : 'صورة قبل الحل (اختياري)'}
                  </span>
                  <input
                    type="file"
                    data-testid="comment-before-image-input"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleBeforeImageChange}
                    className="hidden"
                  />
                </label>
                {attachmentBeforeDataUrl && (
                  <div className="flex items-center gap-1 shrink-0">
                    <img
                      src={attachmentBeforeDataUrl}
                      alt="معاينة صورة قبل الحل"
                      className="w-8 h-7 rounded-lg object-cover border border-amber-300"
                    />
                    <button
                      type="button"
                      aria-label="إزالة صورة قبل الحل"
                      onClick={() => setAttachmentBeforeDataUrl(null)}
                      className="p-1 text-rose-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* After Solution Image */}
              <div className="p-2.5 rounded-xl clay-card flex items-center justify-between gap-2 border border-emerald-200/70">
                <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-slate-700 font-ios flex-1 min-w-0">
                  <ImagePlus className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="truncate">
                    {attachmentAfterDataUrl ? 'صورة بعد الحل ✓' : 'صورة بعد الحل (اختياري)'}
                  </span>
                  <input
                    type="file"
                    data-testid="comment-after-image-input"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleAfterImageChange}
                    className="hidden"
                  />
                </label>
                {attachmentAfterDataUrl && (
                  <div className="flex items-center gap-1 shrink-0">
                    <img
                      src={attachmentAfterDataUrl}
                      alt="معاينة صورة بعد الحل"
                      className="w-8 h-7 rounded-lg object-cover border border-emerald-300"
                    />
                    <button
                      type="button"
                      aria-label="إزالة صورة بعد الحل"
                      onClick={() => setAttachmentAfterDataUrl(null)}
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

        {/* Comments List — Balanced Two-Column RTL Grid (2 cards/row on desktop, 1 on mobile) */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-40 rounded-2xl clay-inset animate-pulse" />
            <div className="h-40 rounded-2xl clay-inset animate-pulse" />
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
                ? 'كن أول طالب يشارك تجربته الحقيقية بصور قبل وبعد الحل!'
                : 'جرّب اختيار "الكل" عشان تشوف باقي التعليقات.'}
            </p>
          </div>
        ) : (
          <div
            data-testid="comments-grid"
            dir="rtl"
            className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch"
          >
            {visibleComments.map((cmt) => {
              const beforeImg = cmt.attachmentBeforeUrl || cmt.attachmentUrl || null;
              const afterImg = cmt.attachmentAfterUrl || null;
              const isLong = cmt.content.length > 180;
              const isExpanded = Boolean(expandedIds[cmt.id]);

              return (
                <article
                  key={cmt.id}
                  data-testid={`comment-card-${cmt.id}`}
                  className="min-w-0 overflow-hidden clay-inset p-4 rounded-2xl text-right flex flex-col justify-between gap-3 h-full border border-white/60"
                >
                  <div className="space-y-2.5 min-w-0">
                    {/* Compact Card Header */}
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {cmt.avatarUrl ? (
                          <img
                            src={cmt.avatarUrl}
                            alt={`صورة ${cmt.authorName}`}
                            className="w-9 h-9 rounded-full object-cover shrink-0 shadow-sm border border-white"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full clay-apple-blue flex items-center justify-center text-white text-xs font-black font-ios shrink-0">
                            {cmt.authorName.charAt(0)}
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className="text-xs sm:text-sm font-black font-ios text-slate-900 truncate max-w-[175px]">
                              {cmt.authorName}
                            </span>
                            {cmt.isVerified && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 font-ios shrink-0">
                                <BadgeCheck className="w-3.5 h-3.5 text-emerald-500" />
                                <span>عميل موثّق</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 font-ios truncate">
                            {cmt.grade} · {formatArabicDate(cmt.createdAt)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 text-amber-400 shrink-0 pt-0.5">
                        {[...Array(cmt.rating)].map((_, idx) => (
                          <Star key={idx} className="w-3 h-3 fill-current" />
                        ))}
                      </div>
                    </div>

                    {/* Comment Text with Controlled Height & Strict Overflow Prevention */}
                    {editingId === cmt.id ? (
                      <div className="space-y-2 pt-1 min-w-0">
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
                              onClick={() => handleSaveEdit(cmt)}
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
                      <div className="space-y-1 min-w-0">
                        <p
                          className={`text-xs sm:text-[13px] text-slate-800 font-ios leading-relaxed break-words [overflow-wrap:anywhere] ${
                            isLong && !isExpanded ? 'line-clamp-3' : ''
                          }`}
                        >
                          {cmt.content}
                        </p>
                        {isLong && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedIds((prev) => ({ ...prev, [cmt.id]: !isExpanded }))
                            }
                            className="text-[11px] font-bold text-indigo-600 hover:underline font-ios"
                          >
                            {isExpanded ? 'عرض أقل' : 'اقرأ المزيد'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Before & After Solution Image Showcase */}
                    {beforeImg && afterImg ? (
                      <div className="grid grid-cols-2 gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setLightbox({ src: beforeImg, label: `قبل الحل — ${cmt.authorName}` })}
                          className="relative group rounded-xl overflow-hidden border border-amber-200/80 bg-slate-100 block text-right"
                        >
                          <img
                            src={beforeImg}
                            alt={`قبل الحل - ${cmt.authorName}`}
                            className="h-28 sm:h-32 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                          <span className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-md bg-slate-900/75 text-amber-300 text-[10px] font-bold font-ios">
                            قبل الحل
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setLightbox({ src: afterImg, label: `بعد الحل — ${cmt.authorName}` })}
                          className="relative group rounded-xl overflow-hidden border border-emerald-200/80 bg-slate-100 block text-right"
                        >
                          <img
                            src={afterImg}
                            alt={`بعد الحل - ${cmt.authorName}`}
                            className="h-28 sm:h-32 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                          <span className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-md bg-emerald-700/85 text-white text-[10px] font-bold font-ios">
                            بعد الحل
                          </span>
                        </button>
                      </div>
                    ) : beforeImg || afterImg ? (
                      <div className="pt-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setLightbox({
                              src: (beforeImg || afterImg)!,
                              label: `${afterImg && !beforeImg ? 'بعد الحل' : 'قبل الحل'} — ${cmt.authorName}`,
                            })
                          }
                          className="relative group rounded-xl overflow-hidden border border-slate-200/80 bg-slate-100 w-full max-w-[260px] block"
                        >
                          <img
                            src={(beforeImg || afterImg)!}
                            alt={`تجربة ${cmt.authorName}`}
                            className="h-32 sm:h-36 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                          <span
                            className={`absolute top-1.5 right-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold font-ios ${
                              afterImg && !beforeImg
                                ? 'bg-emerald-700/85 text-white'
                                : 'bg-slate-900/75 text-amber-300'
                            }`}
                          >
                            {afterImg && !beforeImg ? 'بعد الحل' : 'قبل الحل'}
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {/* Compact Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/50 text-[11px] font-ios">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={Boolean(likingIds[cmt.id])}
                        data-testid={`comment-like-btn-${cmt.id}`}
                        onClick={() => handleToggleCommentLike(cmt)}
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
                                onClick={() => handleDelete(cmt)}
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
                          onClick={() => handleReportSubmit(cmt)}
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
              );
            })}
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
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-xl w-full clay-card p-3 bg-slate-900 space-y-2"
          >
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-white font-ios">{lightbox.label}</span>
              <button
                type="button"
                aria-label="إغلاق الصورة"
                onClick={() => setLightbox(null)}
                className="p-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={lightbox.src}
              alt={lightbox.label}
              className="w-full max-h-[78vh] object-contain rounded-xl bg-black/30"
            />
          </div>
        </div>
      )}
    </section>
  );
};
