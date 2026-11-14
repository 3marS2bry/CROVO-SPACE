import React from 'react';
import { X, Play, Sparkles, MessageCircle, Send, CheckCircle2, Bot, Code, Zap } from 'lucide-react';
import { sounds } from '../utils/soundEffects';

interface VideoShowcaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VideoShowcaseModal: React.FC<VideoShowcaseModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const WHATSAPP_URL =
    'https://wa.me/201550324450?text=' + encodeURIComponent('عاوز اشتراك يخوياااا');
  const TELEGRAM_URL = 'https://t.me/CrovoSpace';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="clay-card w-full max-w-2xl p-6 sm:p-8 relative text-right animate-in zoom-in-95 duration-200"
      >
        {/* Close Button */}
        <button
          onClick={() => {
            sounds.playClick();
            onClose();
          }}
          className="absolute top-4 left-4 p-2 rounded-xl clay-btn text-slate-500 hover:text-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold mb-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>استعراض شامل لأداة الطلاب الذكية</span>
          </div>
          <h3 className="text-xl sm:text-2xl font-black text-slate-900">
            مساعد حل الامتحانات والبرمجة في دقيقة 🚀
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            شوف الأداة بتشتغل إزاي على الموبايل واللابتوب خطوة بخطوة عشان توفر وقتك ومجهودك!
          </p>
        </div>

        {/* Simulated Video Player / Visual Preview */}
        <div className="w-full aspect-video rounded-2xl bg-[#090d16] text-slate-100 border border-slate-800 p-5 flex flex-col justify-between relative overflow-hidden shadow-2xl mb-6">
          {/* Ambient Glow */}
          <div className="absolute top-0 right-1/4 w-48 h-48 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none" />

          {/* Player Mock Bar */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 z-10">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500/80" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Exam_Solver_Engine_v3.mp4
            </span>
          </div>

          {/* Animated Center Showcase */}
          <div className="flex flex-col items-center justify-center text-center my-auto z-10 py-4">
            <div className="w-16 h-16 rounded-3xl bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400 mb-3 shadow-lg">
              <Bot className="w-8 h-8 text-sky-400 animate-pulse" />
            </div>
            <div className="text-sm sm:text-base font-black text-white mb-1">"اكتب أو صور أي مسألة كود.. والحل الكامل والشرح يجيلك فوراً"
            </div>
            <p className="text-xs text-slate-400 max-w-md">
              فحص فوري للأخطاء البرمجية · شرح خطوة بخطوة باللغة العربية · كود نظيف 100% جاهز للتسليم
            </p>
          </div>

          {/* Features Bottom Strip */}
          <div className="grid grid-cols-3 gap-2 border-t border-slate-800 pt-2.5 text-center text-[10px] sm:text-xs text-slate-300 z-10">
            <div className="flex items-center justify-center gap-1 font-bold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>جافاسكريبت وبايثون</span>
            </div>
            <div className="flex items-center justify-center gap-1 font-bold">
              <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>سرعة استجابة فائقة</span>
            </div>
            <div className="flex items-center justify-center gap-1 font-bold">
              <Code className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>دعم مشاريع التخرج</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="text-xs text-slate-500 font-medium text-right">
            عاوز نسختك الخاصة تتفعل في أقل من دقيقتين؟ كلمنا مباشرة 👇
          </div>
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => sounds.playClick()}
              className="clay-telegram py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <Send className="w-4 h-4" />
              <span>تلجرام @CrovoSpace</span>
            </a>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => sounds.playClick()}
              className="clay-whatsapp py-2.5 px-5 rounded-xl text-xs sm:text-sm font-black flex items-center justify-center gap-2 flex-1 sm:flex-initial"
            >
              <MessageCircle className="w-4 h-4" />
              <span>عاوز اشتراك يخوياااا 💬</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
