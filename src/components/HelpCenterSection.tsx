import React, { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Copy,
  HelpCircle,
  Lock,
  MessageCircle,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { WhatsAppIcon, TelegramIcon } from './SocialIcons';
import { PushPreferenceWidget } from './NotificationPrompt';
import { examSolverFaqs } from '../data/chaptersData';

interface HelpCenterSectionProps {
  adminWhatsappDisplay: string;
  onOpenToolDetails: () => void;
  onOpenSubscription: () => void;
}

const HELP_TABS = [
  {
    id: 'library',
    label: 'استخدام المكتبة',
    icon: BookOpen,
    title: 'إزاي توصل لأي سؤال في ثواني؟',
    points: [
      'اختار أولاً السنة الدراسية (أولى بكالوريا أو تانية بكالوريا)، ومن تانية بكالوريا تقدر تبدل بين جافا (54 مستوى) وبايثون (25 فصل) والثقافة المالية (8 فصول).',
      'استخدم شريط البحث الفوري فوق الأسئلة: تقدر تبحث جوا المستوى الحالي أو تفعل خيار"في المادة كلها" عشان تدور وسط كل المستويات مرة واحدة.',
      'تقدر تفلتر الأسئلة حسب (أكواد فقط / نظري فقط / لم تُنسخ بعد) وترتبها بالترتيب الأصلي أو الأكثر نسخاً.',
    ],
  },
  {
    id: 'copy',
    label: 'سرعة النسخ والبلاغات',
    icon: Copy,
    title: 'نسخ الإجابة والإبلاغ عن أي خطأ',
    points: [
      'دوس على زر"نسخ الحل" أو على صندوق الإجابة نفسه، وهيتنسخ الكود أو النص فوراً ويتسجل في تقدمك والعداد الحقيقي للنسخ.',
      'لو لاحظت أي إجابة فيها حرف ناقص أو اختلاف في منصة المدرسة، دوس على"إبلاغ عن إجابة خاطئة" تحت السؤال واكتب ملاحظتك وهتوصل للإدارة لمراجعتها.',
    ],
  },
  {
    id: 'tool',
    label: 'أداة CROVO والاشتراك',
    icon: Zap,
    title: 'تفاصيل أداة CROVO وخطوات الاشتراك',
    points: [
      'الأداة مصممة لتنفيذ الحلول بمحاكاة بشرية هادئة (كتابة طبيعية وسرعة متوازنة) على منصة QUREO أو الثقافة المالية، وبتوفر عليك ساعات من الحل اليدوي.',
      'للاشتراك: اضغط"اشترك الآن" أو"عاوز اشترك يخوياااا"، اختار السنة والمنصة واكتب بيانات المنصة، وهيطلعلك رقم طلب مرجعي مع زر واتساب جاهز برسالتك لتأكيد التنفيذ.',
    ],
  },
  {
    id: 'privacy',
    label: 'الأمان والخصوصية',
    icon: ShieldCheck,
    title: 'بنحمي بياناتك إزاي؟',
    points: [
      'كلمة سر المنصة اللي بتكتبها في طلب الاشتراك بتكون مشفرة ومحمية بالكامل ومحدش بيشوفها غير صاحب الخدمة وقت التنفيذ.',
      'بمجرد ما طلبك يخلص، الإدارة بتمسح كلمة السر نهائياً وتحتفظ بسجل الطلب فقط.',
      'روابط واتساب المباشرة لا تحتوي إطلاقاً على كلمة السر الخاصة بك.',
    ],
  },
] as const;

export const HelpCenterSection: React.FC<HelpCenterSectionProps> = ({
  adminWhatsappDisplay,
  onOpenToolDetails,
  onOpenSubscription,
}) => {
  const [activeTab, setActiveTab] = useState<(typeof HELP_TABS)[number]['id']>('library');
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const current = HELP_TABS.find((t) => t.id === activeTab) || HELP_TABS[0];

  const cleanWa = adminWhatsappDisplay.replace(/[^\d]/g, '') || '201550324450';
  const waHelpLink = `https://wa.me/${cleanWa}?text=${encodeURIComponent(
    'السلام عليكم، عندي استفسار بخصوص مكتبة أو أداة CROVO SPACE.'
  )}`;

  return (
    <section
      id="help-center"
      data-testid="help-center-section"
      className="max-w-5xl mx-auto px-3 sm:px-6 my-6 sm:my-10"
    >
      <div className="clay-card p-4 sm:p-7 text-right border border-white/80 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/60">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-xl clay-inset text-indigo-700 text-[11px] font-bold mb-1 font-decorative">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>مركز المساعدة السريعة</span>
            </div>
            <h2 className="text-lg sm:text-2xl font-black font-decorative text-slate-900">
              كل اللي محتاج تعرفه عن المكتبة والأداة
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenToolDetails}
              className="clay-btn px-3.5 py-2 rounded-xl text-xs font-bold text-indigo-600 font-ios"
            >
              تفاصيل الأداة
            </button>
            <button
              type="button"
              onClick={onOpenSubscription}
              className="clay-apple-blue px-3.5 py-2 rounded-xl text-xs font-bold text-white font-ios"
            >
              طلب اشتراك
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="clay-pill-track grid grid-cols-2 sm:grid-cols-4 gap-1 p-1">
          {HELP_TABS.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeTab;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-2 px-2.5 rounded-full text-xs font-bold font-ios flex items-center justify-center gap-1.5 transition-all duration-200 ${
                  isActive
                    ? 'clay-pill-active'
                    : 'text-slate-600 hover:text-indigo-600'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Panel */}
        <div className="p-4 rounded-2xl clay-inset space-y-2.5">
          <h3 className="text-sm sm:text-base font-black font-ios text-slate-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-indigo-500 shrink-0" />
            <span>{current.title}</span>
          </h3>
          <ul className="space-y-2 text-xs sm:text-sm text-slate-700 font-ios leading-relaxed">
            {current.points.map((point, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-lg clay-card flex items-center justify-center text-[10px] font-black text-indigo-600 shrink-0 mt-0.5 font-mono">
                  {idx + 1}
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Push Notifications Controls & Direct Support */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PushPreferenceWidget />

          <div className="p-3.5 sm:p-4 rounded-2xl clay-inset flex flex-col justify-between gap-2.5">
            <div>
              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-black font-ios text-slate-900">
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                <span>محتاج تواصل مباشر؟</span>
              </div>
              <p className="text-[11px] text-slate-600 font-ios mt-1">
                لو واجهتك أي مشكلة أو عاوز تسأل على عرض، تواصل مباشرة على واتساب أو تليجرام.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={waHelpLink}
                target="_blank"
                rel="noopener noreferrer"
                className="clay-whatsapp flex-1 py-2 px-3 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 font-ios"
              >
                <WhatsAppIcon className="w-4 h-4" />
                <span>واتساب مباشر</span>
              </a>

              <button
                type="button"
                onClick={onOpenSubscription}
                data-testid="help-telegram-btn"
                className="clay-telegram py-2 px-3.5 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 font-ios cursor-pointer"
              >
                <TelegramIcon className="w-4 h-4" />
                <span>تليجرام مباشر</span>
              </button>
            </div>
          </div>
        </div>

        {/* Frequently Asked Questions Accordion */}
        <div className="pt-2 space-y-2.5" data-testid="help-faqs">
          <div className="text-xs sm:text-sm font-black font-decorative text-slate-900 flex items-center gap-1.5">
            <HelpCircle className="w-4 h-4 text-indigo-500" />
            <span>الأسئلة الشائعة</span>
          </div>
          <div className="space-y-2">
            {examSolverFaqs.map((item, idx) => {
              const isOpen = openFaqIdx === idx;
              return (
                <div key={idx} className="rounded-2xl clay-inset overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                    className="w-full p-3 sm:p-3.5 text-right flex items-center justify-between gap-2 text-xs sm:text-sm font-bold font-ios text-slate-900"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 text-indigo-500 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-3.5 pb-3.5 text-xs text-slate-700 font-ios leading-relaxed border-t border-slate-200/50 pt-2">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
