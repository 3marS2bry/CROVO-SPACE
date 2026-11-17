import React, { useState } from 'react';
import { Eye, ImagePlus, Megaphone, Save, Sparkles } from 'lucide-react';
import { api, PublicConfig } from '../../utils/api';
import { syncSiteConfigToCloud } from '../../utils/cloudStore';
import { CopyAdBanner } from '../CopyAdBanner';

interface AdminAdsTabProps {
  config: PublicConfig;
  onNotice: (msg: string) => void;
  onConfigUpdated: () => void;
}

export const AdminAdsTab: React.FC<AdminAdsTabProps> = ({
  config,
  onNotice,
  onConfigUpdated,
}) => {
  const [promoEnabled, setPromoEnabled] = useState(config.promoBanner?.enabled ?? true);
  const [promoText, setPromoText] = useState(
    config.promoBanner?.text ||
      'حل المنصة بالكامل للترمين بـ{price} جنيه فقط · المنصتين مع بعض بـ{bundle} جنيه فقط'
  );

  const [heroEnabled, setHeroEnabled] = useState(config.heroPromo.enabled);
  const [heroTitle, setHeroTitle] = useState(config.heroPromo.title);
  const [heroSubtitle, setHeroSubtitle] = useState(config.heroPromo.subtitle);

  const [adEnabled, setAdEnabled] = useState(config.libraryAd.enabled);
  const [adTitle, setAdTitle] = useState(config.libraryAd.title);
  const [adSubtitle, setAdSubtitle] = useState(config.libraryAd.subtitle);
  const [adPriceText, setAdPriceText] = useState(config.libraryAd.priceText);
  const [adCtaText, setAdCtaText] = useState(config.libraryAd.ctaText);
  const [adCtaLink, setAdCtaLink] = useState(config.libraryAd.ctaLink || '#tool');
  const [adImageUrl, setAdImageUrl] = useState(config.libraryAd.imageUrl || '/media/crovo-promo-ad.jpg');
  const [adDelaySeconds, setAdDelaySeconds] = useState(config.libraryAd.delaySeconds || 60);
  const [adCooldownHours, setAdCooldownHours] = useState(config.libraryAd.cooldownHours || 24);
  const [adTemplateMode, setAdTemplateMode] = useState<'classic' | 'rich_crovo'>(
    config.libraryAd.templateMode || 'classic'
  );

  const [cloudPortableImg, setCloudPortableImg] = useState<string | null>(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<'classic' | 'rich_crovo'>('rich_crovo');

  const compressAdImageForCloud = (dataUrl: string): Promise<string | null> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(dataUrl.length <= 280_000 ? dataUrl : null);
      img.onload = () => {
        try {
          const maxDim = 800;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = canvas.toDataURL('image/jpeg', 0.78);
          resolve(out.length <= 280_000 ? out : null);
        } catch {
          resolve(null);
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
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const [res, portable] = await Promise.all([
        api.adminUploadAdImage(dataUrl),
        compressAdImageForCloud(dataUrl),
      ]);
      setAdImageUrl(res.imageUrl);
      setCloudPortableImg(portable);
      onNotice('تم رفع صورة الإعلان بنجاح. اضغط حفظ لتطبيقها.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر رفع الصورة.');
    } finally {
      setUploadingImg(false);
      e.target.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.adminUpdateSettings({
        promoBanner: { enabled: promoEnabled, text: promoText },
        heroPromo: { enabled: heroEnabled, title: heroTitle, subtitle: heroSubtitle },
        libraryAd: {
          enabled: adEnabled,
          title: adTitle,
          subtitle: adSubtitle,
          priceText: adPriceText,
          ctaText: adCtaText,
          ctaLink: adCtaLink,
          imageUrl: adImageUrl,
          delaySeconds: adDelaySeconds,
          cooldownHours: adCooldownHours,
          templateMode: adTemplateMode,
        },
      });
      const cloudConfig = {
        ...res.config,
        libraryAd: {
          ...res.config.libraryAd,
          imageUrl:
            adImageUrl.startsWith('/uploads/') && cloudPortableImg
              ? cloudPortableImg
              : res.config.libraryAd.imageUrl,
        },
      };
      void syncSiteConfigToCloud(cloudConfig);
      onNotice('تم حفظ إعدادات الإعلانات والظهور بنجاح.');
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر الحفظ.');
    } finally {
      setSaving(false);
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

  return (
    <form onSubmit={handleSave} className="space-y-5 text-xs font-ios" data-testid="admin-ads-tab">
      {/* 1. Library Popup Ad Control + Interactive Preview */}
      <div className="clay-card p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-indigo-600" />
            <h2 className="text-base font-black font-decorative">
              إدارة النافذة المنبثقة للإعلان (Popup Ad)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="admin-preview-rich-ad-btn"
              onClick={() => {
                setPreviewTemplate('rich_crovo');
                setShowLivePreview(true);
              }}
              className="clay-purple-soft px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>معاينة الإعلان الجديد (Preview)</span>
            </button>

            <label className="flex items-center gap-1.5 font-bold cursor-pointer px-3 py-2 rounded-xl clay-inset">
              <input
                type="checkbox"
                checked={adEnabled}
                onChange={(e) => setAdEnabled(e.target.checked)}
              />
              <span>تفعيل الإعلان التلقائي</span>
            </label>
          </div>
        </div>

        {/* Mode Notice & Switcher */}
        <div className="p-3 rounded-2xl bg-indigo-50/90 border border-indigo-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            <div className="font-bold text-indigo-900 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>قالب العرض الحالي للزوار:</span>
            </div>
            <p className="text-[11px] text-slate-600">
              يظل القالب الكلاسيكي مفعّلاً لحين اختيار القالب التسويقي المتطور (CROVO Promo Modal) وحفظه.
            </p>
          </div>

          <select
            value={adTemplateMode}
            onChange={(e) => setAdTemplateMode(e.target.value as 'classic' | 'rich_crovo')}
            className="px-3 py-2 rounded-xl clay-card border-none outline-none font-bold text-indigo-700"
          >
            <option value="classic">القالب الكلاسيكي الحالي</option>
            <option value="rich_crovo">القالب التسويقي الجديد (CROVO Promo)</option>
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
      </div>

      {/* 2. Top Promo Bar & Inline Hero Card */}
      <div className="clay-card p-4 sm:p-6 space-y-3">
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
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full clay-apple-blue py-3 rounded-2xl text-sm font-black text-white shadow-md flex items-center justify-center gap-2"
      >
        <Save className="w-4 h-4" />
        <span>{saving ? 'جاري الحفظ...' : 'حفظ إعدادات الإعلانات'}</span>
      </button>

      {/* Interactive Modal Preview */}
      <CopyAdBanner
        isVisible={showLivePreview}
        onClose={() => setShowLivePreview(false)}
        adConfig={previewAdConfig}
        forceTemplateMode={previewTemplate}
        onLearnMore={() => onNotice('زر المعاينة يعمل (فتح صفحة الأداة).')}
        onOpenSubscription={() => onNotice('زر المعاينة يعمل (فتح الاشتراك).')}
      />
    </form>
  );
};
