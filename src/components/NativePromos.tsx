import React, { useState } from 'react';
import { MessageCircle, Send, Play, ShieldCheck, Zap, Code2, ChevronDown, ChevronUp } from 'lucide-react';
import { sounds } from '../utils/soundEffects';
import { examSolverFaqs } from '../data/chaptersData';

interface NativePromosProps {
  onOpenVideo: () => void;
  onOpenDemo: () => void;
}

export const NativePromos: React.FC<NativePromosProps> = ({ onOpenVideo, onOpenDemo }) => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const WHATSAPP_URL =
    'https://wa.me/201550324450?text=' + encodeURIComponent('عاوز اشتراك يخوياااا');
  const TELEGRAM_URL = 'https://t.me/CrovoSpace';

  return (
    <section className="py-8 px-4 sm:px-6 max-w-7xl mx-auto">
      {/* 3-Column Native Neumorphic Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Card 1: Instant Exam Solver */}
        <div className="clay-card p-6 flex flex-col justify-between text-right">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-4 clay-inset">
              <Zap className="w-6 h-6 text-amber-500" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">
              حل الامتحانات والتكليفات في ثواني ⚡
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium mb-4">
              مع الأداة مفيش مسألة كود هتقف في سكتك. بتديك الكود النظيف والمجرب مع شرح منطق الحل خطوة بخطوة عشان تقفل درجاتك.
            </p>
          </div>
          <button
            onClick={() => {
              sounds.playClick();
              onOpenDemo();
            }}
            className="clay-btn py-2.5 px-4 text-xs font-bold text-indigo-600 w-full text-center hover:text-indigo-700"
          >
            جرب الحل التفاعلي الآن
          </button>
        </div>

        {/* Card 2: Interactive Video Showcase Preview */}
        <div className="clay-card p-6 flex flex-col justify-between text-right relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />
          <div>
            <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center mb-4 clay-inset">
              <Code2 className="w-6 h-6 text-purple-500" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">
              شرح وتفكيك أي مسألة برمجية 🎯
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium mb-4">
              مش مجرد كود وخلاص؛ الأداة بتشرحلك بالبلدي الـ logic وليه اختارنا الطريقة دي، عشان لو الدكتور سألك في الشفوي ترص الحل وأنت واثق!
            </p>
          </div>
          <button
            onClick={() => {
              sounds.playClick();
              onOpenVideo();
            }}
            className="clay-primary py-2.5 px-4 text-xs font-black flex items-center justify-center gap-2 rounded-xl text-white"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>شاهد فيديو توضيحي للأداة</span>
          </button>
        </div>

        {/* Card 3: Direct Personal Support */}
        <div className="clay-card p-6 flex flex-col justify-between text-right">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4 clay-inset">
              <ShieldCheck className="w-6 h-6 text-emerald-500" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">
              تواصل مباشر مع عمر في أي وقت 🤝
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium mb-4">
              عندك استفسار؟ عاوز اشتراكك يتفعل فوراً؟ تواصل على طول عبر واتساب أو تلجرام، والرد سريع ومباشر بدون وسطاء.
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => sounds.playClick()}
              className="clay-whatsapp flex-1 py-2.5 px-3 text-xs font-black flex items-center justify-center gap-1.5 rounded-xl"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>واتساب 01550324450</span>
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => sounds.playClick()}
              className="clay-telegram py-2.5 px-3 text-xs font-black flex items-center justify-center rounded-xl"
            >
              <Send className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Frequently Asked Questions Accordion */}
      <div className="clay-card p-6 sm:p-8">
        <h3 className="text-lg sm:text-xl font-black text-slate-900 mb-4 text-right">
          الأسئلة الشائعة حول أداة الامتحانات والاشتراك ❓
        </h3>
        <div className="flex flex-col gap-3">
          {examSolverFaqs.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                className="clay-inset p-4 transition-all cursor-pointer"
                onClick={() => {
                  sounds.playClick();
                  setOpenFaq(isOpen ? null : idx);
                }}
              >
                <div className="flex items-center justify-between gap-3 text-right">
                  <span className="text-xs sm:text-sm font-bold text-slate-900">
                    {faq.q}
                  </span>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-indigo-500 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                </div>
                {isOpen && (
                  <p className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed mt-2.5 pt-2.5 border-t border-slate-200/60 text-right">
                    {faq.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
