import React, { useState } from 'react';
import { Archive, CheckCircle2, Eye, FileEdit, ImagePlus, Megaphone, Rocket, Save, Sparkles } from 'lucide-react';
import { AdWorkflowStatus, api, PublicConfig } from '../../utils/api';
import { CopyAdBanner } from '../CopyAdBanner';

interface AdminAdsTabProps {
  config: PublicConfig;
  onNotice: (msg: string) => void;
  onConfigUpdated: () => void;
}

const WORKFLOW_LABELS: Record<AdWorkflowStatus, { label: string; badgeClass: string }> = {
  draft: { label: 'مسودة (غير منشورة)', badgeClass: 'bg-slate-200 text-slate-800' },
  preview: { label: 'قيد المعاينة', badgeClass: 'bg-amber-100 text-amber-800' },
  approved: { label: 'معتمدة للنشر', badgeClass: 'bg-sky-100 text-sky-800' },
  published: { label: 'منشورة للزوار ✓', badgeClass: 'bg-emerald-100 text-emerald-800' },
  archived: { label: 'مؤرشفة / متوقفة', badgeClass: 'bg-rose-100 text-rose-800' },
};

export const AdminAdsTab: React.FC<AdminAdsTabProps> = ({
  config,
  onNotice,
  onConfigUpdated,
}) => {
  const initialDraft = config.libraryAd.draft || config.libraryAd;

  const [promoEnabled, setPromoEnabled] = useState(config.promoBanner?.enabled ?? true);
  const [promoText, setPromoText] = useState(
    config.promoBanner?.text ||
      'حل المنصة بالكامل للترمين بـ{price} جنيه فقط · المنصتين مع بعض بـ{bundle} جنيه فقط'
  );

  const [heroEnabled, setHeroEnabled] = useState(config.heroPromo.enabled);
  const [heroTitle, setHeroTitle] = useState(config.heroPromo.title);
  const [heroSubtitle, setHeroSubtitle] = useState(config.heroPromo.subtitle);

  const [adEnabled, setAdEnabled] = useState(config.libraryAd.enabled);
  const [adTitle, setAdTitle] = useState(initialDraft.title || config.libraryAd.title);
  const [adSubtitle, setAdSubtitle] = useState(initialDraft.subtitle || config.libraryAd.subtitle);
  const [adPriceText, setAdPriceText] = useState(initialDraft.priceText || config.libraryAd.priceText);
  const [adCtaText, setAdCtaText] = useState(initialDraft.ctaText || config.libraryAd.ctaText);
  const [adCtaLink, setAdCtaLink] = useState(initialDraft.ctaLink || config.libraryAd.ctaLink || '#tool');
  const [adImageUrl, setAdImageUrl] = useState(
    initialDraft.imageUrl || config.libraryAd.imageUrl || '/media/crovo-promo-ad.jpg'
  );
  const [adDelaySeconds, setAdDelaySeconds] = useState(
    initialDraft.delaySeconds ?? config.libraryAd.delaySeconds ?? 60
  );
  const [adCooldownHours, setAdCooldownHours] = useState(
    initialDraft.cooldownHours ?? config.libraryAd.cooldownHours ?? 24
  );
  const [adTemplateMode, setAdTemplateMode] = useState<'classic' | 'rich_crovo'>(
    initialDraft.templateMode || config.libraryAd.templateMode || 'classic'
  );
  const [workflowStatus, setWorkflowStatus] = useState<AdWorkflowStatus>(
    config.libraryAd.draft?.workflowStatus || config.libraryAd.workflowStatus || 'published'
  );

  const [uploadingImg, setUploadingImg] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [savingBanners, setSavingBanners] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<'classic' | 'rich_crovo'>('rich_crovo');

  const compressAdImageForFirestore = (dataUrl: string): Promise<string> =>
    new Promise((resolve) => {
      if (dataUrl.length <= 280_000) {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        try {
          const maxDim = 800;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(dataUrl);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = canvas.toDataURL('image/jpeg', 0.78);
          resolve(out.length <= 280_000 ? out : canvas.toDataURL('image/jpeg', 0.62));
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      onNotice('حجم الصورة يجب أن يكون أقل من 3 ميجا.');
      return;
    }
    setUploadingImg(true);
    try {
      const rawDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const compressed = await compressAdImageForFirestore(rawDataUrl);
      const res = await api.adminUploadAdImage(compressed);
      setAdImageUrl(res.imageUrl);
      onNotice('تم تجهيز صورة المسودة بنجاح. احفظ المسودة أو انشرها لتطبيقها.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر رفع الصورة.');
    } finally {
      setUploadingImg(false);
      e.target.value = '';
    }
  };

  const handleWorkflowAction = async (
    action: 'save_draft' | 'preview' | 'approve' | 'publish' | 'archive'
  ) => {
    if (savingWorkflow) return;
    setSavingWorkflow(true);
    try {
      const draftPayload = {
        title: adTitle,
        subtitle: adSubtitle,
        priceText: adPriceText,
        ctaText: adCtaText,
        ctaLink: adCtaLink,
        imageUrl: adImageUrl,
        delaySeconds: adDelaySeconds,
        cooldownHours: adCooldownHours,
        templateMode: adTemplateMode,
      };
      const res = await api.adminUpdateSettings({
        libraryAdWorkflowAction: action,
        libraryAdDraft: draftPayload,
        ...(action === 'publish' ? { libraryAd: { enabled: adEnabled } } : {}),
      });
      const nextStatus =
        res.config.libraryAd.draft?.workflowStatus ||
        res.config.libraryAd.workflowStatus ||
        (action === 'save_draft'
          ? 'draft'
          : action === 'preview'
            ? 'preview'
            : action === 'approve'
              ? 'approved'
              : action === 'archive'
                ? 'archived'
                : 'published');
      setWorkflowStatus(nextStatus);
      if (action === 'archive') {
        setAdEnabled(false);
      } else if (action === 'publish') {
        setAdEnabled(res.config.libraryAd.enabled);
      }

      const actionNoticeMap: Record<typeof action, string> = {
        save_draft: 'تم حفظ المسودة في Firestore دون التأثير على الإعلان المنشور حالياً.',
        preview: 'تم تحويل الإعلان إلى حالة «قيد المعاينة» — يمكنك معاينته الآن.',
        approve: 'تم اعتماد المسودة — جاهزة الآن للنشر المباشر.',
        publish: 'تم نشر الإعلان وتحديثه للزوار في Firestore بنجاح.',
        archive: 'تمت أرشفة الإعلان وإيقاف ظهوره التلقائي للزوار.',
      };
      onNotice(actionNoticeMap[action]);
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تنفيذ خطوة سير العمل.');
    } finally {
      setSavingWorkflow(false);
    }
  };

  const handleSaveBanners = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingBanners) return;
    setSavingBanners(true);
    try {
      await api.adminUpdateSettings({
        promoBanner: { enabled: promoEnabled, text: promoText },
        heroPromo: { enabled: heroEnabled, title: heroTitle, subtitle: heroSubtitle },
      });
      onNotice('تم حفظ إعدادات الشريط العلوي وبطاقة البطل في Firestore.');
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الشريط العلوي.');
    } finally {
      setSavingBanners(false);
    }
  };

  const previewAdConfig: PublicConfig['libraryAd'] = {
    enabled: true,
    title: adTemplateMode === 'rich_crovo' ? adTitle : 'لسه بتضيع ساعات في حل المنصات؟',
    subtitle:
      adTemplateMode === 'rich_crovo'
        ? adSubtitle
        : 'مع CROVO SPACE، خلّص مهامك التعليمية بسهولة وفي وقت أقل.',
    priceText:
      adTemplateMode === 'rich_crovo' ? adPriceText : 'عرض الأداة بسعر 50 جنيه فقط.',
    ctaText: adTemplateMode === 'rich_crovo' ? adCtaText : 'اكتشف العرض الآن ⚡',
    ctaLink: adCtaLink,
    imageUrl: adImageUrl,
    delaySeconds: adDelaySeconds,
    cooldownHours: adCooldownHours,
    templateMode: previewTemplate,
  };

  const wfMeta = WORKFLOW_LABELS[workflowStatus] || WORKFLOW_LABELS.published;

  return (
    <div className="space-y-5 text-xs font-ios" data-testid="admin-ads-tab">
      {/* 1. Library Popup Ad Workflow + Interactive Preview */}
      <div className="clay-card p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Megaphone className="w-4 h-4 text-indigo-600" />
            <h2 className="text-base font-black font-decorative">
              إدارة النافذة المنبثقة للإعلان (سير العمل الآمن)
            </h2>
            <span
              data-testid="ad-workflow-status-badge"
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-black ${wfMeta.badgeClass}`}
            >
              {wfMeta.label}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="admin-preview-rich-ad-btn"
              onClick={() => {
                setPreviewTemplate(adTemplateMode);
                setShowLivePreview(true);
              }}
              className="clay-purple-soft px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>معاينة المسودة في النافذة</span>
            </button>

            <label className="flex items-center gap-1.5 font-bold cursor-pointer px-3 py-2 rounded-xl clay-inset">
              <input
                type="checkbox"
                checked={adEnabled}
                onChange={(e) => setAdEnabled(e.target.checked)}
              />
              <span>تفعيل الإعلان عند النشر</span>
            </label>
          </div>
        </div>

        {/* Workflow Pipeline Strip */}
        <div className="p-3 rounded-2xl clay-inset flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5 font-bold text-slate-700">
            <span className={workflowStatus === 'draft' ? 'text-indigo-700 font-black' : ''}>1. مسودة</span>
            <span>←</span>
            <span className={workflowStatus === 'preview' ? 'text-indigo-700 font-black' : ''}>2. معاينة</span>
            <span>←</span>
            <span className={workflowStatus === 'approved' ? 'text-indigo-700 font-black' : ''}>3. اعتماد</span>
            <span>←</span>
            <span className={workflowStatus === 'published' ? 'text-emerald-700 font-black' : ''}>4. نشر للزوار</span>
            <span>←</span>
            <span className={workflowStatus === 'archived' ? 'text-rose-700 font-black' : ''}>5. أرشفة</span>
          </div>
          <span className="text-[10px] text-slate-500">
            التعديلات تُحفظ كمسودة أولاً ولا تظهر للزوار إلا بعد الضغط على «نشر للزوار».
          </span>
        </div>

        {/* Mode Notice & Switcher */}
        <div className="p-3 rounded-2xl bg-indigo-50/90 border border-indigo-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="font-bold text-indigo-900 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>قالب العرض في المسودة:</span>
            </div>
            <p className="text-[11px] text-slate-600">
              يظل القالب الكلاسيكي مفعّلاً لحين اختيار القالب التسويقي المتطور (CROVO Promo Modal) ونشره.
            </p>
          </div>

          <select
            value={adTemplateMode}
            onChange={(e) => setAdTemplateMode(e.target.value as 'classic' | 'rich_crovo')}
            className="px-3 py-2 rounded-xl clay-card border-none outline-none font-bold text-indigo-700"
          >
            <option value="classic">القالب الكلاسيكي</option>
            <option value="rich_crovo">القالب التسويقي المتطور (CROVO Promo)</option>
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block font-bold mb-1">العنوان الرئيسي:</label>
            <input
              type="text"
              value={adTitle}
              onChange={(e) => setAdTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">العنوان الفرعي / الجملة التعريفية:</label>
            <input
              type="text"
              value={adSubtitle}
              onChange={(e) => setAdSubtitle(e.target.value)}
              className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">نص العرض / السعر:</label>
            <input
              type="text"
              value={adPriceText}
              onChange={(e) => setAdPriceText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">نص زر الإجراء (CTA):</label>
            <input
              type="text"
              value={adCtaText}
              onChange={(e) => setAdCtaText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">وجهة الزر (CTA Link):</label>
            <select
              value={adCtaLink}
              onChange={(e) => setAdCtaLink(e.target.value)}
              className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
            >
              <option value="#tool">فتح صفحة الأداة (#tool)</option>
              <option value="#subscribe">فتح نافذة الاشتراك (#subscribe)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">تأخير الظهور (ثانية):</label>
              <input
                type="number"
                min={5}
                max={600}
                value={adDelaySeconds}
                onChange={(e) => setAdDelaySeconds(Number(e.target.value) || 60)}
                className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-mono"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">التكرار كل (ساعة):</label>
              <input
                type="number"
                min={1}
                max={720}
                value={adCooldownHours}
                onChange={(e) => setAdCooldownHours(Number(e.target.value) || 24)}
                className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-mono"
              />
            </div>
          </div>
        </div>

        {/* Ad Image Upload + URL Preview */}
        <div className="p-3.5 rounded-2xl clay-inset flex flex-col sm:flex-row items-center gap-3">
          <img
            src={adImageUrl}
            alt="معاينة صورة الإعلان"
            className="w-24 h-20 object-cover rounded-xl bg-white border border-white shrink-0"
          />
          <div className="flex-1 w-full space-y-2">
            <label className="block font-bold">رابط صورة الإعلان أو رفع صورة جديدة:</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                dir="ltr"
                value={adImageUrl}
                onChange={(e) => setAdImageUrl(e.target.value)}
                className="flex-1 min-w-[180px] px-3 py-1.5 rounded-xl clay-card border-none outline-none font-mono text-left"
              />
              <label className="clay-btn px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer text-indigo-700">
                <ImagePlus className="w-3.5 h-3.5" />
                <span>{uploadingImg ? 'جاري الرفع...' : 'رفع صورة'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Inline Draft Preview Card */}
        <div
          data-testid="ad-inline-draft-preview"
          className="p-3.5 rounded-2xl border border-indigo-200/80 bg-white/75 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="space-y-1">
            <div className="text-[10px] font-black text-indigo-600">
              معاينة مصغّرة للمسودة الحالية ({wfMeta.label}):
            </div>
            <div className="text-sm font-black text-slate-900">{adTitle || 'بدون عنوان'}</div>
            <div className="text-xs text-slate-600">{adSubtitle}</div>
            <div className="text-[11px] font-bold text-indigo-700">{adPriceText}</div>
          </div>
          <span className="px-3 py-1.5 rounded-xl clay-apple-blue text-white font-bold text-[11px] shrink-0">
            {adCtaText || 'زر الإجراء'}
          </span>
        </div>

        {/* Explicit Workflow Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="ad-wf-save-draft"
            disabled={savingWorkflow}
            onClick={() => handleWorkflowAction('save_draft')}
            className="clay-btn px-3.5 py-2.5 rounded-xl font-bold text-slate-800 flex items-center gap-1.5 disabled:opacity-50"
          >
            <FileEdit className="w-3.5 h-3.5" />
            <span>حفظ كمسودة</span>
          </button>

          <button
            type="button"
            data-testid="ad-wf-preview"
            disabled={savingWorkflow}
            onClick={() => handleWorkflowAction('preview')}
            className="clay-btn px-3.5 py-2.5 rounded-xl font-bold text-amber-700 flex items-center gap-1.5 disabled:opacity-50"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>تعيين للمعاينة</span>
          </button>

          <button
            type="button"
            data-testid="ad-wf-approve"
            disabled={savingWorkflow}
            onClick={() => handleWorkflowAction('approve')}
            className="clay-btn px-3.5 py-2.5 rounded-xl font-bold text-sky-700 flex items-center gap-1.5 disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>اعتماد المسودة</span>
          </button>

          <button
            type="button"
            data-testid="ad-wf-publish"
            disabled={savingWorkflow}
            onClick={() => handleWorkflowAction('publish')}
            className="clay-apple-blue px-4 py-2.5 rounded-xl font-black text-white flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>{savingWorkflow ? 'جاري التنفيذ...' : 'نشر الإعلان للزوار'}</span>
          </button>

          <button
            type="button"
            data-testid="ad-wf-archive"
            disabled={savingWorkflow}
            onClick={() => handleWorkflowAction('archive')}
            className="clay-btn px-3.5 py-2.5 rounded-xl font-bold text-rose-600 flex items-center gap-1.5 disabled:opacity-50"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>أرشفة وإيقاف</span>
          </button>
        </div>
      </div>

      {/* 2. Top Promo Bar & Inline Hero Card */}
      <form onSubmit={handleSaveBanners} className="clay-card p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black font-decorative">شريط الإعلان العلوي والبطاقة المدمجة</h3>
          <label className="flex items-center gap-1.5 font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={promoEnabled}
              onChange={(e) => setPromoEnabled(e.target.checked)}
            />
            <span>إظهار الشريط العلوي</span>
          </label>
        </div>

        <input
          type="text"
          value={promoText}
          onChange={(e) => setPromoText(e.target.value)}
          className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none"
        />

        <div className="pt-2 flex items-center justify-between">
          <span className="font-bold">إعلان البطل (Hero Promo Card)</span>
          <label className="flex items-center gap-1.5 font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={heroEnabled}
              onChange={(e) => setHeroEnabled(e.target.checked)}
            />
            <span>تفعيل</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={heroTitle}
            onChange={(e) => setHeroTitle(e.target.value)}
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
          />
          <input
            type="text"
            value={heroSubtitle}
            onChange={(e) => setHeroSubtitle(e.target.value)}
            className="px-3 py-2 rounded-xl clay-inset border-none outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={savingBanners}
          className="clay-apple-blue px-5 py-2.5 rounded-xl text-xs font-black text-white shadow-sm flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span>{savingBanners ? 'جاري الحفظ...' : 'حفظ الشريط العلوي وبطاقة البطل'}</span>
        </button>
      </form>

      {/* Interactive Modal Preview */}
      <CopyAdBanner
        isVisible={showLivePreview}
        onClose={() => setShowLivePreview(false)}
        adConfig={previewAdConfig}
        forceTemplateMode={previewTemplate}
        onLearnMore={() => onNotice('زر المعاينة يعمل (فتح صفحة الأداة).')}
        onOpenSubscription={() => onNotice('زر المعاينة يعمل (فتح الاشتراك).')}
      />
    </div>
  );
};

