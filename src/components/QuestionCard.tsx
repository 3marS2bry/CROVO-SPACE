import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Flag,
  SendHorizonal,
  Sparkles,
} from 'lucide-react';
import { AcademicGrade, QuestionItem, SectionType } from '../types';
import { api, ApiError } from '../utils/api';
import { getFirebaseUid, saveQuestionReportCloud } from '../utils/cloudStore';
import confetti from 'canvas-confetti';

interface QuestionCardProps {
  question: QuestionItem;
  index: number;
  chapterIndex: number;
  chapterNum: number;
  grade: AcademicGrade;
  section: SectionType;
  questionKey: string;
  copyCount: number;
  chapterBadge?: string;
  isCompleted: boolean;
  onComplete: () => void;
  onCopyRecorded?: (questionKey: string, title: string, chapterNum: number, qIndex: number) => void;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  index,
  chapterNum,
  grade,
  section,
  questionKey,
  copyCount,
  chapterBadge,
  isCompleted,
  onComplete,
  onCopyRecorded,
}) => {
  // Answers are shown by default to keep copying immediate
  const [isOpen, setIsOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  // Report wrong answer state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportMsg, setReportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const toggleOpen = () => {
    setIsOpen(!isOpen);
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();

    const fallbackCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = question.a;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        // Ignore if blocked completely
      }
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(question.a).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }

    setCopied(true);
    onComplete();

    if (onCopyRecorded) {
      onCopyRecorded(questionKey, question.q, chapterNum, index);
    }

    try {
      confetti({
        particleCount: 16,
        spread: 38,
        origin: { y: 0.8 },
        colors: ['#4F46E5', '#6366F1', '#8B5CF6'],
        disableForReducedMotion: true,
      });
    } catch {
      // Ignore confetti issues
    }

    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (reportSubmitting) return;
    setReportSubmitting(true);
    setReportMsg(null);

    try {
      const res = await api.reportQuestionIssue({
        questionKey,
        grade,
        section,
        chapterNum,
        qIndex: index,
        questionTitle: question.q,
        description: reportText,
      });
      setReportMsg({ type: 'ok', text: res.message });
      setReportText('');
      window.setTimeout(() => {
        setReportOpen(false);
      }, 2200);
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        setReportMsg({
          type: 'err',
          text: err.message,
        });
      } else {
        const fbUid = getFirebaseUid();
        if (fbUid) {
          try {
            await saveQuestionReportCloud({
              id: `qrep_${Date.now()}`,
              reporterUid: fbUid,
              questionKey,
              grade,
              section,
              chapterNum,
              qIndex: index,
              questionTitle: question.q,
              description: reportText.trim() || 'تبليغ عن إجابة غير صحيحة',
            });
            setReportMsg({ type: 'ok', text: 'تم تسجيل بلاغك للمراجعة بنجاح. شكرًا لمساهمتك!' });
            setReportText('');
            window.setTimeout(() => {
              setReportOpen(false);
            }, 2200);
            return;
          } catch {
            // fall through to generic error message
          }
        }
        setReportMsg({
          type: 'err',
          text: err instanceof Error ? err.message : 'تعذر إرسال البلاغ، حاول تاني.',
        });
      }
    } finally {
      setReportSubmitting(false);
    }
  };

  const isHtml = question.a.includes('<') && question.a.includes('>');
  const isCss = question.a.includes('{') && question.a.includes('color:');
  const langTag = question.code ? (isHtml ? 'HTML' : isCss ? 'CSS' : 'CODE') : 'TEXT';

  return (
    <div
      data-testid={`question-card-${questionKey}`}
      className={`clay-card p-3.5 sm:p-5 transition-all text-right border ${
        isCompleted ? 'border-indigo-300/60 shadow-sm' : 'border-white/80'
      }`}
    >
      {/* Header Bar */}
      <div
        onClick={toggleOpen}
        className="cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 select-none"
      >
        <div className="flex items-start sm:items-center gap-2 sm:gap-3 min-w-0 w-full sm:w-auto">
          <div
            data-testid={`question-number-${questionKey}`}
            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center text-xs font-bold font-mono shrink-0 transition-colors mt-0.5 sm:mt-0 ${
              isCompleted
                ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-sm'
                : 'clay-inset text-indigo-700'
            }`}
          >
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            {chapterBadge && (
              <span className="inline-block text-[10px] font-bold text-indigo-600 font-decorative mb-0.5">
                {chapterBadge}
              </span>
            )}
            <h3 className="text-xs sm:text-sm font-bold font-ios text-slate-800 whitespace-normal leading-snug">
              {question.q}
            </h3>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto pt-2 sm:pt-0 border-t border-slate-200/50 sm:border-0 shrink-0">
          <div className="flex items-center gap-1.5">
            {question.code ? (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg clay-inset text-indigo-600">
                {langTag}
              </span>
            ) : null}

            {/* Real Copy Counter */}
            <span
              data-testid={`copy-count-${questionKey}`}
              title="عدد مرات النسخ الحقيقي لهذا السؤال"
              className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg clay-inset text-slate-600"
            >
              {copyCount} نسخة
            </span>

            <div className="p-1 rounded-lg clay-btn text-slate-400">
              {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </div>

          {/* Quick Copy Button */}
          <button
            type="button"
            data-testid={`copy-btn-${questionKey}`}
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm font-ios ${
              copied ? 'bg-indigo-600 text-white' : 'clay-apple-blue text-white'
            }`}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>تم النسخ</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>نسخ الحل 📋</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Answer Body */}
      {isOpen && (
        <div className="mt-3 pt-3 border-t border-slate-200/70 animate-in fade-in duration-150 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold font-decorative text-slate-500 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" />
              <span>الإجابة النموذجية المباشرة:</span>
            </span>
            <span className="text-[10px] text-slate-400 font-ios">
              (انقر داخل الصندوق لنسخ الحل فوراً)
            </span>
          </div>

          {/* Answer Box */}
          <div
            onClick={handleCopy}
            title="انقر لنسخ الإجابة فوراً"
            className="cursor-pointer clay-inset p-3 sm:p-4 group hover:ring-2 hover:ring-indigo-400/40 transition-all rounded-2xl relative overflow-hidden"
          >
            {question.code ? (
              <pre
                className="font-['JetBrains_Mono'] text-xs sm:text-[13px] leading-relaxed text-indigo-700 whitespace-pre-wrap break-all overflow-x-auto text-left"
                dir="ltr"
              >
                {question.a}
              </pre>
            ) : (
              <p className="text-xs sm:text-sm font-medium text-slate-800 leading-relaxed font-ios">
                {question.a}
              </p>
            )}
          </div>

          {/* Report Inaccurate Answer Bar */}
          <div className="flex items-center justify-between pt-0.5">
            <button
              type="button"
              data-testid={`report-toggle-${questionKey}`}
              onClick={(e) => {
                e.stopPropagation();
                setReportOpen((prev) => !prev);
                setReportMsg(null);
              }}
              className="text-[11px] font-bold font-ios text-slate-500 hover:text-amber-600 flex items-center gap-1"
            >
              <Flag className="w-3 h-3" />
              <span>{reportOpen ? 'إغلاق البلاغ' : 'إبلاغ عن إجابة خاطئة'}</span>
            </button>

            {reportMsg && !reportOpen && (
              <span className="text-[11px] font-bold text-indigo-600 font-ios">
                {reportMsg.text}
              </span>
            )}
          </div>

          {reportOpen && (
            <form
              onSubmit={handleSubmitReport}
              onClick={(e) => e.stopPropagation()}
              data-testid={`report-form-${questionKey}`}
              className="p-3 rounded-2xl clay-inset space-y-2 border border-amber-400/30"
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 font-ios">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>لاحظت حاجة غلط في الإجابة؟ اكتب وصف بسيط وهنراجعها فوراً:</span>
              </div>

              <textarea
                rows={2}
                required
                minLength={5}
                maxLength={500}
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder="مثال: الإجابة الصح فيها semicolon زيادة أو السطر التاني ناقص..."
                className="w-full p-2.5 rounded-xl clay-card text-xs font-ios border-none outline-none text-slate-900 resize-none"
              />

              {reportMsg && (
                <div
                  className={`text-[11px] font-bold font-ios ${
                    reportMsg.type === 'ok'
                      ? 'text-indigo-600'
                      : 'text-rose-600'
                  }`}
                >
                  {reportMsg.text}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReportOpen(false)}
                  className="clay-btn px-3 py-1.5 rounded-xl text-[11px] font-bold text-slate-600 font-ios"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={reportSubmitting}
                  className="clay-apple-blue px-3.5 py-1.5 rounded-xl text-[11px] font-bold text-white flex items-center gap-1.5 font-ios disabled:opacity-60"
                >
                  <SendHorizonal className="w-3 h-3" />
                  <span>{reportSubmitting ? 'جاري الإرسال...' : 'إرسال البلاغ للإدارة'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
