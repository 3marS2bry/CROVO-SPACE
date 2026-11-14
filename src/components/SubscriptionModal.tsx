import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { WhatsAppIcon } from './SocialIcons';
import { api, OrderReceipt, PublicConfig } from '../utils/api';
import {
  buildClientWhatsappUrl,
  calculateClientPricing,
  calculateDiscountPercent,
  OrderGrade,
  PlatformChoice,
} from '../utils/rules';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: PublicConfig | null;
  serverOffsetMs: number;
}

type WizardStep = 'grade' | 'platform' | 'pricing' | 'details' | 'confirm' | 'receipt';

function makeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `req_${crypto.randomUUID()}`;
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const FALLBACK_CONFIG: PublicConfig = {
  qureoOfferPrice: 50,
  qureoOldPrice: 100,
  finOfferPrice: 50,
  finOldPrice: 100,
  bundleOfferPrice: 100,
  bundleOldPrice: 200,
  offerEndsAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
  afterOfferMode: 'regular_price',
  ordersEnabled: true,
  pollClosed: false,
  offerActive: true,
  serverTime: new Date().toISOString(),
  libraryAd: {
    enabled: true,
    title: 'لسه بتحل المنصة بنفسك؟',
    subtitle: 'وفر وقتك مع أداة CROVO',
    priceText: 'حل المنصة بالكامل بـ50 جنيه فقط',
    ctaText: 'اعرف أكتر',
  },
  heroPromo: {
    enabled: true,
    title: 'أداة CROVO الذكية — خلّص المنصة كلها في 4 دقايق',
    subtitle:
      'بتسجل دخولك بمحاكاة بشرية كاملة وتكتب وتجاوب بدقة 100% من غير ما المنصة تشك في أي حاجة.',
  },
  promoBanner: {
    enabled: true,
    text: 'حل المنصة بالكامل للترمين بـ{price} جنيه فقط · المنصتين مع بعض بـ{bundle} جنيه فقط',
  },
  notificationsEnabled: true,
  notificationsIntervalDays: 3,
  adminWhatsappDisplay: '201550324450',
};

const STEP_LABELS: Array<{ key: Exclude<WizardStep, 'receipt'>; num: number; label: string }> = [
  { key: 'grade', num: 1, label: 'السنة' },
  { key: 'platform', num: 2, label: 'المنصة' },
  { key: 'pricing', num: 3, label: 'الأسعار' },
  { key: 'details', num: 4, label: 'البيانات' },
  { key: 'confirm', num: 5, label: 'التأكيد' },
];

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  isOpen,
  onClose,
  config,
  serverOffsetMs,
}) => {
  const activeConfig = config || FALLBACK_CONFIG;

  const [step, setStep] = useState<WizardStep>('grade');
  const [grade, setGrade] = useState<OrderGrade | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformChoice[]>([]);
  const [qureoJavaSelected, setQureoJavaSelected] = useState(true);

  // Form state kept strictly in RAM (never written to localStorage/sessionStorage)
  const [fullName, setFullName] = useState('');
  const [platformUsername, setPlatformUsername] = useState('');
  const [platformPassword, setPlatformPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('محفظة إلكترونية (كاش)');

  const [clientRequestId, setClientRequestId] = useState<string>(() => makeRequestId());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [receiptWhatsappUrl, setReceiptWhatsappUrl] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const resetWizard = () => {
    setStep('grade');
    setGrade(null);
    setSelectedPlatforms([]);
    setQureoJavaSelected(true);
    setFullName('');
    setPlatformUsername('');
    setPlatformPassword('');
    setShowPassword(false);
    setPaymentMethod('محفظة إلكترونية (كاش)');
    setClientRequestId(makeRequestId());
    setError(null);
    setReceipt(null);
    setReceiptWhatsappUrl('');
  };

  const handleClose = () => {
    // Always wipe sensitive password & transient WhatsApp URL from RAM upon exit when on receipt or completed
    if (receipt) {
      resetWizard();
    } else {
      setPlatformPassword('');
      setReceiptWhatsappUrl('');
    }
    onClose();
  };

  const handleSelectGrade = (chosen: OrderGrade) => {
    setGrade(chosen);
    setSelectedPlatforms(chosen === 'bac1' ? ['qureo'] : []);
    setQureoJavaSelected(true);
    setError(null);
    setStep('platform');
  };

  const toggleBac2Platform = (p: PlatformChoice) => {
    setError(null);
    setSelectedPlatforms((prev) => {
      if (prev.includes(p)) {
        return prev.filter((item) => item !== p);
      }
      return [...prev, p];
    });
  };

  const pricing = grade
    ? calculateClientPricing(
        {
          grade,
          platforms: selectedPlatforms,
          qureoSection: selectedPlatforms.includes('qureo') ? 'java' : undefined,
        },
        activeConfig,
        Date.now() + serverOffsetMs
      )
    : null;

  const canProceedPlatform =
    grade === 'bac1'
      ? selectedPlatforms.includes('qureo')
      : selectedPlatforms.length > 0 &&
        (!selectedPlatforms.includes('qureo') || qureoJavaSelected);

  const handleGoToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (fullName.trim().length < 2) {
      setError('من فضلك اكتب اسمك بالكامل (حرفين على الأقل).');
      return;
    }
    if (platformUsername.trim().length < 2) {
      setError('من فضلك اكتب اليوزر بتاع المنصة بشكل صحيح.');
      return;
    }
    if (platformPassword.length < 1) {
      setError('من فضلك اكتب كلمة السر بتاعة المنصة.');
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const handleConfirmOrder = async () => {
    if (!grade || !canProceedPlatform || submitting) return;

    if (!activeConfig.ordersEnabled) {
      setError('استقبال الطلبات متوقف مؤقتاً من الإدارة حالياً.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const passwordSnapshot = platformPassword;

    try {
      const res = await api.createOrder({
        fullName: fullName.trim(),
        grade,
        platforms: selectedPlatforms,
        qureoSection: selectedPlatforms.includes('qureo') ? 'java' : undefined,
        platformUsername: platformUsername.trim(),
        platformPassword: passwordSnapshot,
        paymentMethod,
        clientRequestId,
      });

      const waUrl = buildClientWhatsappUrl(activeConfig.adminWhatsappDisplay, {
        fullName: res.order.fullName,
        grade: res.order.grade,
        platformLabel: res.order.platformLabel,
        sectionDetails: res.order.sectionDetails,
        platformUsername: platformUsername.trim(),
        platformPassword: passwordSnapshot,
        oldPrice: res.order.oldPrice,
        finalPrice: res.order.finalPrice,
        paymentMethod: res.order.paymentMethod,
        orderCode: res.order.orderCode,
      });

      setReceipt(res.order);
      setReceiptWhatsappUrl(waUrl);
      // Clear raw password input field immediately
      setPlatformPassword('');
      setStep('receipt');

      // Launch WhatsApp Click-to-Chat link directly without window.open popup abuse
      const anchor = document.createElement('a');
      anchor.href = waUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حصل خطأ أثناء إرسال الطلب، حاول تاني.');
    } finally {
      setSubmitting(false);
    }
  };

  const qureoDiscount = calculateDiscountPercent(
    activeConfig.qureoOldPrice,
    activeConfig.qureoOfferPrice
  );
  const finDiscount = calculateDiscountPercent(
    activeConfig.finOldPrice,
    activeConfig.finOfferPrice
  );
  const bundleDiscount = calculateDiscountPercent(
    activeConfig.bundleOldPrice,
    activeConfig.bundleOfferPrice
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="نافذة الاشتراك في CROVO SPACE"
      onClick={handleClose}
      className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="subscription-modal"
        className="w-full max-w-lg clay-card p-4 sm:p-7 relative text-right bg-[#EEF2F7] border border-white/80 shadow-2xl my-auto max-h-[92vh] overflow-y-auto"
      >
        {/* Close Button */}
        <button
          type="button"
          aria-label="إغلاق نافذة الاشتراك"
          onClick={handleClose}
          className="absolute top-3.5 left-3.5 p-2 rounded-xl clay-btn text-slate-500 hover:text-slate-900"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="mb-3.5 pl-8">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-xl clay-inset text-indigo-600 text-[11px] font-bold mb-1 font-decorative">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>الاشتراك الفوري في CROVO SPACE</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black font-decorative text-slate-900">
            {step === 'grade' && 'أنت في سنة كام؟'}
            {step === 'platform' && 'اختار المنصة والقسم المطلوب'}
            {step === 'pricing' && 'الأسعار والعروض الحالية'}
            {step === 'details' && 'بيانات العميل والمنصة'}
            {step === 'confirm' && 'مراجعة وتأكيد الاشتراك'}
            {step === 'receipt' && 'تم تسجيل طلبك بنجاح 🎉'}
          </h2>
        </div>

        {/* 5-Step Progress Bar */}
        {step !== 'receipt' && (
          <div
            data-testid="subscription-steps"
            className="grid grid-cols-5 gap-1 p-1.5 rounded-2xl clay-inset mb-4 text-[10px] sm:text-[11px] font-ios font-bold"
          >
            {STEP_LABELS.map((item) => {
              const currentIndex = STEP_LABELS.findIndex((s) => s.key === step);
              const itemIndex = STEP_LABELS.findIndex((s) => s.key === item.key);
              const isCurrent = item.key === step;
              const isDone = itemIndex < currentIndex;
              return (
                <div
                  key={item.key}
                  className={`py-1.5 px-1 rounded-xl text-center transition-all truncate ${
                    isCurrent
                      ? 'clay-apple-blue text-white shadow-sm'
                      : isDone
                      ? 'bg-emerald-500/15 text-emerald-700'
                      : 'text-slate-500'
                  }`}
                >
                  {item.num}. {item.label}
                </div>
              );
            })}
          </div>
        )}

        {!activeConfig.ordersEnabled && step !== 'receipt' && (
          <div className="mb-4 p-3 rounded-2xl clay-inset text-xs font-bold text-rose-600 font-ios flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>استقبال طلبات الاشتراك متوقف مؤقتاً من الإدارة حالياً.</span>
          </div>
        )}

        {error && (
          <div
            data-testid="subscription-error"
            className="mb-4 p-3 rounded-2xl clay-inset text-xs font-bold text-rose-600 font-ios flex items-center justify-between gap-2"
          >
            <span>{error}</span>
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          </div>
        )}

        {/* STEP 1: Grade Selection */}
        {step === 'grade' && (
          <div className="space-y-3" data-testid="step-grade">
            <p className="text-xs sm:text-sm text-slate-600 font-ios">
              اختار سنتك الدراسية عشان نعرضلك المنصات والأسعار المناسبة ليك:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                data-testid="grade-bac1-btn"
                onClick={() => handleSelectGrade('bac1')}
                className="clay-btn p-4 rounded-2xl text-right space-y-1.5 hover:ring-2 hover:ring-indigo-400 transition-all min-h-[88px]"
              >
                <div className="text-base font-black font-decorative text-slate-900">
                  أولى بكالوريا
                </div>
                <div className="text-xs text-slate-600 font-ios">
                  منصة QUREO بالكامل للترمين
                </div>
              </button>

              <button
                type="button"
                data-testid="grade-bac2-btn"
                onClick={() => handleSelectGrade('bac2')}
                className="clay-btn p-4 rounded-2xl text-right space-y-1.5 hover:ring-2 hover:ring-indigo-400 transition-all min-h-[88px]"
              >
                <div className="text-base font-black font-decorative text-slate-900">
                  تانية بكالوريا
                </div>
                <div className="text-xs text-slate-600 font-ios">
                  QUREO أو الثقافة المالية أو المنصتين معًا
                </div>
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Platform Selection */}
        {step === 'platform' && grade && (
          <div className="space-y-4" data-testid="step-platform">
            {grade === 'bac1' ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setSelectedPlatforms(['qureo'])}
                  className={`w-full p-4 rounded-2xl text-right transition-all flex items-center justify-between gap-3 ${
                    selectedPlatforms.includes('qureo')
                      ? 'clay-apple-blue text-white shadow-lg'
                      : 'clay-btn text-slate-900'
                  }`}
                >
                  <div>
                    <div className="text-base font-black font-mono">QUREO</div>
                    <div
                      className={`text-xs font-ios mt-0.5 ${
                        selectedPlatforms.includes('qureo')
                          ? 'text-white/90'
                          : 'text-slate-500'
                      }`}
                    >
                      حل منصة QUREO بالكامل للترمين (أولى بكالوريا)
                    </div>
                  </div>
                  {selectedPlatforms.includes('qureo') && (
                    <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 font-ios">
                  اختار منصة واحدة أو المنصتين مع بعض:
                </p>

                {/* 1. QUREO Option */}
                <div className="space-y-2">
                  <button
                    type="button"
                    data-testid="platform-qureo-btn"
                    onClick={() => toggleBac2Platform('qureo')}
                    className={`w-full p-3.5 rounded-2xl text-right transition-all flex items-center justify-between gap-3 ${
                      selectedPlatforms.includes('qureo')
                        ? 'clay-apple-blue text-white shadow-md'
                        : 'clay-btn text-slate-900'
                    }`}
                  >
                    <div>
                      <div className="text-sm sm:text-base font-black font-mono">1. QUREO</div>
                      <div
                        className={`text-[11px] font-ios ${
                          selectedPlatforms.includes('qureo')
                            ? 'text-white/90'
                            : 'text-slate-500'
                        }`}
                      >
                        منصة البرمجة تانية بكالوريا (Java متاحة)
                      </div>
                    </div>
                    {selectedPlatforms.includes('qureo') && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
                    )}
                  </button>

                  {selectedPlatforms.includes('qureo') && (
                    <div className="grid grid-cols-2 gap-2 pr-2">
                      <button
                        type="button"
                        onClick={() => setQureoJavaSelected(true)}
                        className={`p-3 rounded-xl text-right border transition-all ${
                          qureoJavaSelected
                            ? 'clay-inset ring-2 ring-emerald-500 border-emerald-400/40'
                            : 'clay-btn border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-black font-mono text-slate-900">
                            Java
                          </span>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-600 font-ios block mt-0.5">
                          متاحة للاشتراك
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        data-testid="python-disabled-btn"
                        className="p-3 rounded-xl text-right bg-slate-200/70 opacity-50 cursor-not-allowed border border-slate-300/60"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-black font-mono text-slate-500">Python</span>
                          <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                        </div>
                        <span className="text-[10px] font-bold text-slate-500 font-ios block mt-0.5">
                          متاحة قريبًا
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Financial Literacy Option */}
                <button
                  type="button"
                  data-testid="platform-financial-btn"
                  onClick={() => toggleBac2Platform('financial')}
                  className={`w-full p-3.5 rounded-2xl text-right transition-all flex items-center justify-between gap-3 ${
                    selectedPlatforms.includes('financial')
                      ? 'clay-apple-blue text-white shadow-md'
                      : 'clay-btn text-slate-900'
                  }`}
                >
                  <div>
                    <div className="text-sm sm:text-base font-black font-ios">2. ثقافة مالية</div>
                    <div
                      className={`text-[11px] font-ios ${
                        selectedPlatforms.includes('financial')
                          ? 'text-white/90'
                          : 'text-slate-500'
                      }`}
                    >
                      مادة الثقافة المالية بالكامل
                    </div>
                  </div>
                  {selectedPlatforms.includes('financial') && (
                    <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
                  )}
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep('grade')}
                className="clay-btn px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1.5 font-ios"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>رجوع</span>
              </button>

              <button
                type="button"
                data-testid="to-step-pricing-btn"
                disabled={!canProceedPlatform}
                onClick={() => {
                  setError(null);
                  setStep('pricing');
                }}
                className="clay-apple-blue px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 font-ios disabled:opacity-45 disabled:cursor-not-allowed shadow-md"
              >
                <span>التالي: عرض الأسعار</span>
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Clear Dynamic Pricing Step */}
        {step === 'pricing' && grade && pricing && (
          <div className="space-y-4" data-testid="step-pricing">
            <p className="text-xs sm:text-sm text-slate-600 font-ios">
              دي الأسعار الحالية المباشرة من الإدارة قبل الخصم وبعد الخصم:
            </p>

            {/* Dynamic Comparison Grid */}
            <div className="space-y-2.5">
              {grade === 'bac1' ? (
                <div className="p-4 rounded-2xl clay-inset ring-2 ring-emerald-500/50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm text-slate-900 font-ios">
                      منصة QUREO (أولى بكالوريا — للترمين)
                    </span>
                    {activeConfig.offerActive && qureoDiscount > 0 && (
                      <span className="px-2 py-0.5 rounded-lg bg-emerald-500 text-white text-[11px] font-black font-ios">
                        خصم {qureoDiscount}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2.5 font-mono">
                    {activeConfig.offerActive && (
                      <span className="text-sm line-through text-slate-400">
                        {activeConfig.qureoOldPrice} جنيه
                      </span>
                    )}
                    <span className="text-2xl font-black text-emerald-600">
                      {pricing.finalPrice} جنيه فقط
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className={`p-3.5 rounded-2xl clay-inset flex items-center justify-between gap-2 ${
                      selectedPlatforms.length === 1 && selectedPlatforms.includes('qureo')
                        ? 'ring-2 ring-indigo-500'
                        : ''
                    }`}
                  >
                    <div>
                      <div className="text-xs sm:text-sm font-black text-slate-900 font-ios">
                        منصة واحدة (QUREO Java)
                      </div>
                      {activeConfig.offerActive && qureoDiscount > 0 && (
                        <span className="text-[10px] font-bold text-emerald-600 font-ios">
                          وفر {qureoDiscount}% عن السعر العادي
                        </span>
                      )}
                    </div>
                    <div className="text-left font-mono">
                      {activeConfig.offerActive && (
                        <div className="text-xs line-through text-slate-400">
                          {activeConfig.qureoOldPrice} ج
                        </div>
                      )}
                      <div className="text-base font-black text-indigo-600">
                        {activeConfig.offerActive
                          ? activeConfig.qureoOfferPrice
                          : activeConfig.qureoOldPrice}{' '}
                        جنيه
                      </div>
                    </div>
                  </div>

                  <div
                    className={`p-3.5 rounded-2xl clay-inset flex items-center justify-between gap-2 ${
                      selectedPlatforms.length === 1 && selectedPlatforms.includes('financial')
                        ? 'ring-2 ring-indigo-500'
                        : ''
                    }`}
                  >
                    <div>
                      <div className="text-xs sm:text-sm font-black text-slate-900 font-ios">
                        منصة واحدة (ثقافة مالية)
                      </div>
                      {activeConfig.offerActive && finDiscount > 0 && (
                        <span className="text-[10px] font-bold text-emerald-600 font-ios">
                          وفر {finDiscount}% عن السعر العادي
                        </span>
                      )}
                    </div>
                    <div className="text-left font-mono">
                      {activeConfig.offerActive && (
                        <div className="text-xs line-through text-slate-400">
                          {activeConfig.finOldPrice} ج
                        </div>
                      )}
                      <div className="text-base font-black text-indigo-600">
                        {activeConfig.offerActive
                          ? activeConfig.finOfferPrice
                          : activeConfig.finOldPrice}{' '}
                        جنيه
                      </div>
                    </div>
                  </div>

                  <div
                    className={`p-3.5 rounded-2xl clay-inset flex items-center justify-between gap-2 ${
                      selectedPlatforms.length === 2
                        ? 'ring-2 ring-emerald-500'
                        : ''
                    }`}
                  >
                    <div>
                      <div className="text-xs sm:text-sm font-black text-slate-900 font-ios">
                        المنصتين معًا (QUREO + ثقافة مالية)
                      </div>
                      {activeConfig.offerActive && bundleDiscount > 0 && (
                        <span className="text-[10px] font-bold text-emerald-600 font-ios">
                          باقة كاملة · خصم {bundleDiscount}%
                        </span>
                      )}
                    </div>
                    <div className="text-left font-mono">
                      {activeConfig.offerActive && (
                        <div className="text-xs line-through text-slate-400">
                          {activeConfig.bundleOldPrice} ج
                        </div>
                      )}
                      <div className="text-base font-black text-emerald-600">
                        {activeConfig.offerActive
                          ? activeConfig.bundleOfferPrice
                          : activeConfig.bundleOldPrice}{' '}
                        جنيه
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Highlighted Selected Package Box */}
            <div
              data-testid="live-price-summary"
              className="p-4 rounded-2xl clay-inset flex items-center justify-between gap-2 border border-emerald-500/30"
            >
              <div>
                <div className="text-[11px] font-bold text-slate-500 font-ios">
                  اختيارك الحالي ({pricing.platformLabel}):
                </div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  {pricing.offerApplied && (
                    <span
                      data-testid="old-price-display"
                      className="text-xs sm:text-sm text-slate-400 line-through font-mono"
                    >
                      {pricing.oldPrice} جنيه
                    </span>
                  )}
                  <span
                    data-testid="final-price-display"
                    className="text-xl font-black text-emerald-600 font-mono"
                  >
                    {pricing.finalPrice} جنيه
                  </span>
                </div>
              </div>
              {pricing.offerApplied && pricing.discountPercent > 0 && (
                <span className="px-2.5 py-1 rounded-xl bg-emerald-500 text-white text-xs font-black font-ios inline-flex items-center gap-1">
                  <Tag className="w-3 h-3" />
                  <span>خصم {pricing.discountPercent}%</span>
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep('platform')}
                className="clay-btn px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1.5 font-ios"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>رجوع</span>
              </button>

              <button
                type="button"
                data-testid="to-step-details-btn"
                onClick={() => {
                  setError(null);
                  setStep('details');
                }}
                className="clay-apple-blue px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 font-ios shadow-md"
              >
                <span>التالي: إدخال البيانات</span>
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Customer & Platform Data */}
        {step === 'details' && grade && pricing && (
          <form onSubmit={handleGoToConfirm} className="space-y-3.5" data-testid="step-details">
            {/* Customer Section */}
            <div className="p-3.5 rounded-2xl clay-inset space-y-2.5">
              <div className="text-xs font-black font-ios text-slate-900">
                بيانات العميل:
              </div>
              <div>
                <label
                  htmlFor="sub-fullname"
                  className="block text-xs font-bold text-slate-800 mb-1 font-ios"
                >
                  الاسم:
                </label>
                <input
                  id="sub-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="عمر صبري"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm font-ios clay-card border-none outline-none text-slate-900 min-h-[44px]"
                />
              </div>
            </div>

            {/* Platform Credentials Section */}
            <div className="p-3.5 rounded-2xl clay-inset space-y-3">
              <div className="text-xs font-black font-ios text-slate-900">
                بيانات المنصة:
              </div>

              <div>
                <label
                  htmlFor="sub-username"
                  className="block text-xs font-bold text-slate-700 mb-1 font-ios"
                >
                  اليوزر:
                </label>
                <input
                  id="sub-username"
                  type="text"
                  required
                  autoComplete="off"
                  dir="ltr"
                  value={platformUsername}
                  onChange={(e) => setPlatformUsername(e.target.value)}
                  placeholder="username / email"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm font-mono clay-card border-none outline-none text-slate-900 text-left min-h-[44px]"
                />
              </div>

              <div>
                <label
                  htmlFor="sub-password"
                  className="block text-xs font-bold text-slate-700 mb-1 font-ios"
                >
                  كلمة السر:
                </label>
                <div className="relative">
                  <input
                    id="sub-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    dir="ltr"
                    value={platformPassword}
                    onChange={(e) => setPlatformPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-11 pr-3.5 py-2.5 rounded-xl text-sm font-mono clay-card border-none outline-none text-slate-900 text-left min-h-[44px]"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-slate-500 hover:text-indigo-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Privacy Reassurance Notice */}
              <div className="flex items-start gap-2 text-[11px] text-emerald-700 font-ios leading-relaxed pt-1">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                <span>
                  كلمة السر بتتشفّر بـ AES-256-GCM قبل حفظ الطلب في قاعدة البيانات ومبتتخزنش في المتصفح أو سجلات الخادم وبتتمسح بمجرد انتهاء التنفيذ.
                </span>
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <label
                htmlFor="sub-payment"
                className="block text-xs font-bold text-slate-800 mb-1 font-ios"
              >
                طريقة الدفع:
              </label>
              <select
                id="sub-payment"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm font-ios clay-inset border-none outline-none text-slate-900 min-h-[44px]"
              >
                <option value="محفظة إلكترونية (كاش)">محفظة إلكترونية (كاش)</option>
                <option value="فودافون كاش">فودافون كاش</option>
                <option value="إنستا باي">إنستا باي</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep('pricing')}
                className="clay-btn px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1.5 font-ios min-h-[44px]"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>رجوع</span>
              </button>

              <button
                type="submit"
                data-testid="to-step-confirm-btn"
                className="clay-apple-blue px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 font-ios shadow-md min-h-[44px]"
              >
                <span>التالي: مراجعة الطلب</span>
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}

        {/* STEP 5: Final Review & Confirm Button */}
        {step === 'confirm' && grade && pricing && (
          <div className="space-y-4" data-testid="step-confirm">
            <div className="p-4 rounded-2xl clay-inset space-y-2 text-xs sm:text-sm font-ios text-slate-800">
              <div className="text-xs font-black text-indigo-600 pb-1 border-b border-slate-200/60">
                ملخص بيانات طلبك قبل التأكيد:
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">الاسم:</span>
                <span className="font-bold">{fullName}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">السنة الدراسية:</span>
                <span className="font-bold">
                  {grade === 'bac1' ? 'أولى بكالوريا' : 'تانية بكالوريا'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">المنصة:</span>
                <span className="font-bold">{pricing.platformLabel}</span>
              </div>
              {pricing.sectionDetails && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">القسم:</span>
                  <span className="font-bold">{pricing.sectionDetails}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">اليوزر:</span>
                <span className="font-mono font-bold" dir="ltr">
                  {platformUsername}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">السعر قبل الخصم:</span>
                <span className="font-mono line-through text-slate-400">
                  {pricing.oldPrice} جنيه
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">السعر بعد الخصم:</span>
                <span className="font-mono font-black text-emerald-600">
                  {pricing.finalPrice} جنيه
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">طريقة الدفع:</span>
                <span className="font-bold">{paymentMethod}</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 font-ios leading-relaxed">
              لما تضغط «تأكيد الاشتراك»، طلبك هيتسجل برقم طلب خاص ويتجهزلك شات واتساب مباشرة برسالة الطلب الكاملة عشان تبعتها للإدارة بنفسك.
            </p>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep('details')}
                className="clay-btn px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1.5 font-ios min-h-[44px]"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>تعديل البيانات</span>
              </button>

              <button
                type="button"
                data-testid="confirm-subscription-btn"
                disabled={submitting || !activeConfig.ordersEnabled}
                onClick={handleConfirmOrder}
                className="clay-whatsapp flex-1 py-3 px-5 rounded-xl text-sm font-black text-white flex items-center justify-center gap-2 font-ios shadow-lg disabled:opacity-50 min-h-[44px]"
              >
                <WhatsAppIcon className="w-4 h-4" />
                <span>{submitting ? 'جاري تسجيل الطلب...' : 'تأكيد الاشتراك'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Receipt & Click-to-Chat Launcher */}
        {step === 'receipt' && receipt && (
          <div className="space-y-4" data-testid="order-receipt">
            <div className="p-4 rounded-2xl clay-inset space-y-2 border border-emerald-500/30">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-500 font-ios">
                  رقم الطلب المرجعي:
                </span>
                <span
                  data-testid="receipt-order-code"
                  className="text-sm font-black font-mono text-indigo-600"
                >
                  #{receipt.orderCode}
                </span>
              </div>

              <div className="text-xs font-ios text-slate-700 space-y-1">
                <div>
                  الاسم: <span className="font-bold">{receipt.fullName}</span>
                </div>
                <div>
                  السنة:{' '}
                  <span className="font-bold">
                    {receipt.grade === 'bac1' ? 'أولى بكالوريا' : 'تانية بكالوريا'}
                  </span>
                </div>
                <div>
                  المنصة: <span className="font-bold">{receipt.platformLabel}</span>
                </div>
                <div>
                  السعر:{' '}
                  {receipt.offerApplied && (
                    <span className="line-through text-slate-400 ml-1.5 font-mono">
                      {receipt.oldPrice} جنيه
                    </span>
                  )}
                  <span className="font-black text-emerald-600 font-mono">
                    {receipt.finalPrice} جنيه
                  </span>
                </div>
                <div>
                  طريقة الدفع: <span className="font-bold">{receipt.paymentMethod}</span>
                </div>
              </div>
            </div>

            <div
              data-testid="whatsapp-click-to-chat-status"
              className="p-3 rounded-2xl clay-inset text-xs font-bold text-emerald-700 font-ios flex items-start gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
              <span>
                طلبك اتسجل بأمان برقم (#{receipt.orderCode}). لو واتساب مفتحش لوحده، دوس على الزر تحت واضغط إرسال جوه الشات لتأكيد الاشتراك مع الإدارة.
              </span>
            </div>

            <a
              data-testid="open-client-whatsapp"
              href={receiptWhatsappUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="clay-whatsapp w-full py-3.5 px-5 rounded-2xl text-sm font-black text-white flex items-center justify-center gap-2 shadow-lg font-ios"
            >
              <WhatsAppIcon className="w-5 h-5" />
              <span>فتح واتساب وإرسال رسالة الاشتراك</span>
            </a>

            <button
              type="button"
              onClick={() => {
                resetWizard();
                onClose();
              }}
              className="w-full clay-btn py-2.5 rounded-xl text-xs font-bold text-slate-600 font-ios"
            >
              إغلاق ومسح الجلسة
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
