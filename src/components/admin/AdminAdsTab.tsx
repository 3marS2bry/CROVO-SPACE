import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Copy,
  Eye,
  FileEdit,
  ImagePlus,
  Layers,
  Megaphone,
  Monitor,
  Palette,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Search,
  Sliders,
  Smartphone,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { api, PublicConfig } from '../../utils/api';
import {
  AD_ELEMENT_LABELS,
  AD_ICON_OPTIONS,
  AD_PLACEMENT_META,
  AD_PRESET_THEMES,
  AD_TYPE_META,
  type AdElementKey,
  type AdPlacement,
  type AdStatus,
  type AdType,
  type AdUnitConfig,
  buildDefaultBehavior,
  buildDefaultContent,
  buildDefaultDesign,
  buildDefaultMotion,
  DEFAULT_ELEMENT_ORDER,
  mergeAdUnitsWithDefaults,
  resolveAdEffectiveStatus,
  sanitizeAdUnit,
} from '../../utils/adSystem';
import { PromoTopBanner } from '../PromoTopBanner';
import { HeroPromoSection } from '../HeroPromoSection';
import { CopyAdBanner } from '../CopyAdBanner';
import { OptionalWelcomeBanner } from '../OptionalWelcomeBanner';
import { type AdActionHandlers, AdUnitRenderer } from '../ads/AdUnitRenderer';

interface AdminAdsTabProps {
  config: PublicConfig;
  onNotice: (msg: string) => void;
  onConfigUpdated: () => void;
}

type EditorSubTab = 'content' | 'design' | 'dimensions' | 'motion' | 'behavior';

const CTA_LINK_PRESETS = [
  { value: '#subscribe', label: 'فتح نافذة الاشتراك (#subscribe)' },
  { value: '#tool', label: 'فتح صفحة الأداة (#tool)' },
  { value: '#library', label: 'الانتقال لمكتبة الحلول (#library)' },
  { value: '#reviews', label: 'فتح صفحة الآراء والتقييمات (#reviews)' },
  { value: '#help', label: 'الانتقال لمركز المساعدة (#help)' },
  { value: '#auth', label: 'فتح نافذة تسجيل الدخول (#auth)' },
  { value: 'custom', label: 'رابط مخصص (https:// أو مسار داخلي)...' },
];

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  } catch {
    return '';
  }
}

function fromDatetimeLocalValue(val: string): string | null {
  if (!val || !val.trim()) return null;
  const parsed = new Date(val);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

function createTemplateAdUnit(type: AdType): AdUnitConfig {
  const nowIso = new Date().toISOString();
  const meta = AD_TYPE_META[type];
  const base: AdUnitConfig = {
    id: `ad_${type}_${Date.now().toString(36)}`,
    name: `${meta.label} جديد`,
    type,
    placement: meta.defaultPlacement,
    status: 'draft',
    isSystemDefault: false,
    content: buildDefaultContent({
      badgeText: type === 'offer_discount' ? 'خصم {percent}%' : meta.label,
      title:
        type === 'offer_discount'
          ? 'عرض خاص لطلاب البكالوريا — بـ {price} جنيه فقط!'
          : type === 'alert_update'
          ? 'تحديث جديد في مكتبة حلول CROVO SPACE'
          : type === 'welcome'
          ? 'مرحباً بك في CROVO SPACE'
          : 'عنوان الإعلان الترويجي الجديد',
      subtitle: 'نص فرعي واضح يشرح الميزة أو العرض للطلاب بأسلوب احترافي.',
      ctaText: 'اشترك الآن',
      ctaLink: '#subscribe',
    }),
    design: buildDefaultDesign(),
    motion: buildDefaultMotion({
      marqueeEnabled: type === 'announcement_bar',
      ambientEffect: type === 'announcement_bar' ? 'light_sweep' : 'none',
    }),
    behavior: buildDefaultBehavior({
      enabled: true,
      delaySeconds: type === 'popup' || type === 'modal' || type === 'interstitial' ? 12 : 0,
      frequencyMode:
        type === 'popup' || type === 'modal' || type === 'interstitial' || type === 'welcome'
          ? 'recurring'
          : 'always',
    }),
    draft: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (type === 'announcement_bar') {
    base.design = buildDefaultDesign({
      gradientEnabled: true,
      gradientFrom: '#4f46e5',
      gradientVia: '#7c3aed',
      gradientTo: '#4338ca',
      gradientAngle: 270,
      backgroundColor: '#4f46e5',
      textColor: '#ffffff',
      subtitleColor: '#e0e7ff',
      accentColor: '#fcd34d',
      iconColor: '#fcd34d',
      ctaBgColor: '#ffffff',
      ctaTextColor: '#4338ca',
      borderRadius: 0,
      maxWidthPx: 1600,
      paddingYDesktop: 6,
      paddingYMobile: 4,
      marginTop: 0,
      marginBottom: 0,
      fontSizeDesktop: 12,
      fontSizeMobile: 10,
      position: 'top_center',
    });
  } else if (type === 'floating') {
    base.design = buildDefaultDesign({
      gradientEnabled: true,
      gradientFrom: '#4f46e5',
      gradientVia: '#6366f1',
      gradientTo: '#7c3aed',
      gradientAngle: 135,
      textColor: '#ffffff',
      subtitleColor: '#e0e7ff',
      accentColor: '#fde047',
      iconColor: '#fde047',
      ctaBgColor: '#ffffff',
      ctaTextColor: '#4338ca',
      widthDesktop: '330px',
      widthMobile: '92vw',
      maxWidthPx: 360,
      borderRadius: 22,
      paddingXDesktop: 16,
      paddingYDesktop: 14,
      paddingXMobile: 14,
      paddingYMobile: 12,
      fontSizeDesktop: 14,
      fontSizeMobile: 12,
      position: 'bottom_left',
    });
  } else if (type === 'interstitial' || type === 'modal' || type === 'popup') {
    base.design = buildDefaultDesign({
      maxWidthPx: type === 'interstitial' ? 680 : 540,
      borderRadius: 28,
      shadowStyle: 'medium',
      textColor: '#0f172a',
    });
  }

  return base;
}

function hydrateEditorFromAd(ad: AdUnitConfig): AdUnitConfig {
  if (!ad.draft) {
    return JSON.parse(JSON.stringify(ad)) as AdUnitConfig;
  }
  return {
    ...ad,
    name: ad.draft.name,
    type: ad.draft.type,
    placement: ad.draft.placement,
    content: JSON.parse(JSON.stringify(ad.draft.content)),
    design: JSON.parse(JSON.stringify(ad.draft.design)),
    motion: JSON.parse(JSON.stringify(ad.draft.motion)),
    behavior: JSON.parse(JSON.stringify(ad.draft.behavior)),
  };
}

export const AdminAdsTab: React.FC<AdminAdsTabProps> = ({
  config,
  onNotice,
  onConfigUpdated,
}) => {
  const adsList = useMemo(
    () =>
      mergeAdUnitsWithDefaults(config.ads, {
        promoBanner: config.promoBanner,
        heroPromo: config.heroPromo,
        libraryAd: config.libraryAd,
      }),
    [config.ads, config.promoBanner, config.heroPromo, config.libraryAd]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | AdType>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | AdStatus>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [editingAd, setEditingAd] = useState<AdUnitConfig | null>(null);
  const [editorTab, setEditorTab] = useState<EditorSubTab>('content');
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [livePreviewModalAd, setLivePreviewModalAd] = useState<AdUnitConfig | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [uploadingField, setUploadingField] = useState<'media' | 'bg' | null>(null);

  useEffect(() => {
    if (!editingAd) return;
    const updatedFromServer = adsList.find((a) => a.id === editingAd.id);
    if (updatedFromServer && updatedFromServer.updatedAt !== editingAd.updatedAt) {
      // Keep synced status metadata cleanly without wiping unsaved form changes unless requested
    }
  }, [adsList, editingAd]);

  const nowMs = Date.now();

  const statsSummary = useMemo(() => {
    let active = 0;
    let paused = 0;
    let draft = 0;
    let scheduled = 0;
    for (const ad of adsList) {
      const eff = resolveAdEffectiveStatus(ad, nowMs).status;
      if (eff === 'active') active++;
      else if (eff === 'paused') paused++;
      else if (eff === 'draft') draft++;
      else if (eff === 'scheduled') scheduled++;
    }
    return { active, paused, draft, scheduled, total: adsList.length };
  }, [adsList, nowMs]);

  const filteredAds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return adsList.filter((ad) => {
      const eff = resolveAdEffectiveStatus(ad, nowMs).status;
      if (filterType !== 'all' && ad.type !== filterType) return false;
      if (filterStatus !== 'all' && eff !== filterStatus) return false;
      if (q) {
        const hay = `${ad.name} ${ad.content.title} ${ad.content.subtitle} ${ad.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [adsList, filterType, filterStatus, searchQuery, nowMs]);

  const previewActions: AdActionHandlers = useMemo(
    () => ({
      onOpenSubscription: () => onNotice('معاينة الإجراء: سيفتح للزائر نافذة الاشتراك.'),
      onExploreTool: () => onNotice('معاينة الإجراء: سينتقل الزائر إلى صفحة الأداة.'),
      onOpenReviews: () => onNotice('معاينة الإجراء: سينتقل الزائر إلى صفحة الآراء والتقييمات.'),
      onScrollToLibrary: () => onNotice('معاينة الإجراء: سينتقل الزائر إلى مكتبة الحلول.'),
      onScrollToHelp: () => onNotice('معاينة الإجراء: سينتقل الزائر إلى مركز المساعدة.'),
      onOpenAuth: () => onNotice('معاينة الإجراء: ستفتح نافذة تسجيل الدخول.'),
    }),
    [onNotice]
  );

  const compressAdImageForFirestore = (dataUrl: string): Promise<string> =>
    new Promise((resolve) => {
      if (dataUrl.length <= 240_000) {
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
          const out = canvas.toDataURL('image/jpeg', 0.76);
          resolve(out.length <= 240_000 ? out : canvas.toDataURL('image/jpeg', 0.58));
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    });

  const handleUploadImage = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'media' | 'bg'
  ) => {
    const file = e.target.files?.[0];
    if (!file || !editingAd) return;
    if (file.size > 3 * 1024 * 1024) {
      onNotice('حجم الصورة يجب أن يكون أقل من 3 ميجا.');
      return;
    }
    setUploadingField(target);
    try {
      const rawDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const compressed = await compressAdImageForFirestore(rawDataUrl);
      const res = await api.adminUploadAdImage(compressed);
      setEditingAd((prev) => {
        if (!prev) return prev;
        if (target === 'media') {
          return {
            ...prev,
            content: { ...prev.content, mediaType: 'image', mediaUrl: res.imageUrl },
          };
        }
        return {
          ...prev,
          design: { ...prev.design, customBgImageUrl: res.imageUrl },
        };
      });
      onNotice('تم تجهيز الصورة داخل المحرر — اضغط «حفظ كمسودة» أو «نشر» لاعتمادها.');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر رفع الصورة.');
    } finally {
      setUploadingField(null);
      e.target.value = '';
    }
  };

  const handleToggleAd = async (ad: AdUnitConfig) => {
    if (busyActionId) return;
    setBusyActionId(ad.id);
    try {
      const nextEnabled = !(ad.behavior.enabled && ad.status !== 'paused');
      await api.adminAdCenterAction({
        adCenterAction: 'toggle',
        adId: ad.id,
      });
      onNotice(nextEnabled ? `تم تفعيل إعلان «${ad.name}» للزوار.` : `تم إيقاف إعلان «${ad.name}» مؤقتاً.`);
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر تغيير حالة الإعلان.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDuplicateAd = async (ad: AdUnitConfig) => {
    if (busyActionId) return;
    setBusyActionId(ad.id);
    try {
      await api.adminAdCenterAction({
        adCenterAction: 'duplicate',
        adId: ad.id,
      });
      onNotice(`تم إنشاء نسخة مسودة جديدة من «${ad.name}».`);
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر نسخ الإعلان.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDeleteAd = async (ad: AdUnitConfig) => {
    if (busyActionId) return;
    setBusyActionId(ad.id);
    try {
      await api.adminAdCenterAction({
        adCenterAction: 'delete',
        adId: ad.id,
      });
      setConfirmDeleteId(null);
      if (editingAd?.id === ad.id) setEditingAd(null);
      onNotice(`تم حذف الإعلان «${ad.name}» نهائياً من قاعدة البيانات.`);
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر حذف الإعلان.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRestoreDefault = async (ad: AdUnitConfig) => {
    if (busyActionId) return;
    setBusyActionId(ad.id);
    try {
      const res = await api.adminAdCenterAction({
        adCenterAction: 'restore_default',
        adId: ad.id,
      });
      setConfirmRestoreId(null);
      const restored = res.config.ads?.find((a) => a.id === ad.id);
      if (restored && editingAd?.id === ad.id) {
        setEditingAd(hydrateEditorFromAd(restored));
      }
      onNotice(`تمت استعادة الإعدادات الأصلية الافتراضية لوحدة «${ad.name}».`);
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر استعادة الإعدادات الافتراضية.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSaveEditor = async (mode: 'save_draft' | 'publish') => {
    if (!editingAd || busyActionId) return;
    setBusyActionId(editingAd.id);
    try {
      const cleanUnit = sanitizeAdUnit(editingAd, editingAd);
      const res = await api.adminAdCenterAction({
        adCenterAction: mode,
        adUnit: cleanUnit,
      });
      const updated = res.config.ads?.find((a) => a.id === cleanUnit.id);
      if (updated) {
        setEditingAd(hydrateEditorFromAd(updated));
      }
      onNotice(
        mode === 'save_draft'
          ? 'تم حفظ التعديلات كمسودة في Firestore دون التأثير على النسخة المنشورة حالياً.'
          : 'تم نشر الإعلان وتحديثه فوراً للزوار في Firestore بنجاح.'
      );
      onConfigUpdated();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الإعلان.');
    } finally {
      setBusyActionId(null);
    }
  };

  const moveElementOrder = (key: AdElementKey, dir: -1 | 1) => {
    if (!editingAd) return;
    const order = [...(editingAd.content.elementOrder || DEFAULT_ELEMENT_ORDER)];
    const idx = order.indexOf(key);
    if (idx < 0) return;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= order.length) return;
    const tmp = order[idx];
    order[idx] = order[targetIdx];
    order[targetIdx] = tmp;
    setEditingAd({
      ...editingAd,
      content: { ...editingAd.content, elementOrder: order },
    });
  };

  const renderPreviewComponent = (unit: AdUnitConfig, viewport: 'desktop' | 'mobile') => {
    const isMob = viewport === 'mobile';
    if (unit.id === 'ad_top_announcement' || unit.type === 'announcement_bar') {
      return (
        <PromoTopBanner
          config={config}
          serverOffsetMs={0}
          onOpenSubscription={previewActions.onOpenSubscription}
          onExploreTool={previewActions.onExploreTool}
          onOpenReviews={previewActions.onOpenReviews}
          forceAdUnit={unit}
          forceMobile={isMob}
        />
      );
    }
    if (unit.id === 'ad_hero_promo') {
      return (
        <HeroPromoSection
          config={config}
          onExploreTool={previewActions.onExploreTool}
          onOpenSubscription={previewActions.onOpenSubscription}
          onOpenReviews={previewActions.onOpenReviews}
          forceAdUnit={unit}
          forceMobile={isMob}
        />
      );
    }
    if (unit.id === 'ad_welcome_banner') {
      return (
        <OptionalWelcomeBanner
          adUnit={unit}
          config={config}
          onOpenSubscription={previewActions.onOpenSubscription}
          onExploreTool={previewActions.onExploreTool}
          onOpenReviews={previewActions.onOpenReviews}
          forceMobile={isMob}
        />
      );
    }

    const mode =
      unit.type === 'floating'
        ? 'floating'
        : unit.type === 'interstitial'
        ? 'interstitial'
        : unit.placement === 'overlay_timed' || unit.type === 'popup' || unit.type === 'modal'
        ? 'modal'
        : 'inline';

    return (
      <AdUnitRenderer
        ad={unit}
        config={config}
        serverOffsetMs={0}
        forceMobile={isMob}
        actions={previewActions}
        mode={mode}
        isPreview
      />
    );
  };

  // ============================================================================
  // VISUAL AD EDITOR VIEW
  // ============================================================================
  if (editingAd) {
    const effStatus = resolveAdEffectiveStatus(editingAd, nowMs);
    const isCustomCtaLink = !CTA_LINK_PRESETS.some(
      (p) => p.value !== 'custom' && p.value === editingAd.content.ctaLink
    );

    return (
      <div className="space-y-4 text-xs font-ios" data-testid="admin-ad-editor">
        {/* Top Editor Header & Save/Publish Actions */}
        <div className="clay-card p-3.5 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setEditingAd(null)}
              className="clay-btn px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 text-slate-700 cursor-pointer"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>كل الإعلانات</span>
            </button>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-black font-decorative text-slate-900">
                  {editingAd.name}
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${effStatus.badgeClass}`}>
                  {effStatus.label}
                </span>
                {editingAd.draft && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">
                    مسودة محفوظة قيد التعديل
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                {AD_TYPE_META[editingAd.type]?.label} · {AD_PLACEMENT_META[editingAd.placement]?.label}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editingAd.isSystemDefault && (
              <button
                type="button"
                disabled={busyActionId === editingAd.id}
                onClick={() => handleRestoreDefault(editingAd)}
                className="clay-btn px-3 py-2 rounded-xl font-bold text-slate-600 hover:text-indigo-700 flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>استعادة الافتراضي</span>
              </button>
            )}

            <button
              type="button"
              data-testid="ad-editor-save-draft"
              disabled={busyActionId === editingAd.id}
              onClick={() => handleSaveEditor('save_draft')}
              className="clay-btn px-3.5 py-2 rounded-xl font-bold text-slate-800 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <FileEdit className="w-3.5 h-3.5" />
              <span>حفظ كمسودة</span>
            </button>

            <button
              type="button"
              data-testid="ad-editor-publish"
              disabled={busyActionId === editingAd.id}
              onClick={() => handleSaveEditor('publish')}
              className="clay-apple-blue px-4 py-2 rounded-xl font-black text-white flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <Rocket className="w-3.5 h-3.5" />
              <span>{busyActionId === editingAd.id ? 'جاري النشر...' : 'نشر وتطبيق للزوار'}</span>
            </button>
          </div>
        </div>

        {/* Main Studio Grid: Controls + Live Interactive Preview */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          {/* Controls Column (7/12) */}
          <div className="xl:col-span-7 clay-card p-4 sm:p-5 space-y-4">
            {/* Sub-Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 p-1 rounded-2xl clay-inset">
              {(
                [
                  { id: 'content', label: 'المحتوى والترتيب', icon: Type },
                  { id: 'design', label: 'الألوان والمظهر', icon: Palette },
                  { id: 'dimensions', label: 'الأبعاد والخطوط', icon: Sliders },
                  { id: 'motion', label: 'الحركة و Marquee', icon: Play },
                  { id: 'behavior', label: 'الجدولة والاستهداف', icon: Layers },
                ] as const
              ).map((t) => {
                const IconComp = t.icon;
                const active = editorTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-testid={`editor-subtab-${t.id}`}
                    onClick={() => setEditorTab(t.id)}
                    className={`py-2 px-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      active
                        ? 'clay-pill-active shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <IconComp className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* SUB-TAB 1: CONTENT & ORDER */}
            {editorTab === 'content' && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-bold mb-1">اسم الوحدة (للوحة التحكم):</label>
                    <input
                      type="text"
                      value={editingAd.name}
                      onChange={(e) => setEditingAd({ ...editingAd, name: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">نوع الإعلان:</label>
                    <select
                      value={editingAd.type}
                      disabled={editingAd.isSystemDefault}
                      onChange={(e) =>
                        setEditingAd({ ...editingAd, type: e.target.value as AdType })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold disabled:opacity-60"
                    >
                      {Object.entries(AD_TYPE_META).map(([k, m]) => (
                        <option key={k} value={k}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold mb-1">مكان الظهور (Placement):</label>
                    <select
                      value={editingAd.placement}
                      disabled={editingAd.isSystemDefault && editingAd.id === 'ad_top_announcement'}
                      onChange={(e) =>
                        setEditingAd({ ...editingAd, placement: e.target.value as AdPlacement })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold disabled:opacity-60"
                    >
                      {Object.entries(AD_PLACEMENT_META).map(([k, m]) => (
                        <option key={k} value={k}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {(editingAd.id === 'ad_library_popup' ||
                  editingAd.type === 'popup' ||
                  editingAd.type === 'modal') && (
                  <div className="p-3 rounded-2xl bg-indigo-50/80 border border-indigo-200/70 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-black text-indigo-900">نمط العرض للنافذة:</div>
                      <div className="text-[11px] text-slate-600">
                        اختر «التخصيص الكامل (Custom)» لتطبيق ترتيب العناصر والأبعاد والألوان بالكامل.
                      </div>
                    </div>
                    <select
                      value={editingAd.content.templateMode}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: {
                            ...editingAd.content,
                            templateMode: e.target.value as 'classic' | 'rich_crovo' | 'custom',
                          },
                        })
                      }
                      className="px-3 py-2 rounded-xl clay-card font-bold text-indigo-700 border-none outline-none"
                    >
                      <option value="classic">القالب الكلاسيكي</option>
                      <option value="rich_crovo">القالب التسويقي المتطور (CROVO Promo)</option>
                      <option value="custom">التخصيص البصري الكامل (Custom)</option>
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold mb-1">نص الشارة (Badge):</label>
                    <input
                      type="text"
                      value={editingAd.content.badgeText}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: { ...editingAd.content, badgeText: e.target.value },
                        })
                      }
                      placeholder="مثال: خصم {percent}% أو عرض حصري"
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">الأيقونة:</label>
                    <select
                      value={editingAd.content.iconName}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: {
                            ...editingAd.content,
                            iconName: e.target.value as AdUnitConfig['content']['iconName'],
                          },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                    >
                      {AD_ICON_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <label className="font-bold">العنوان الرئيسي / نص الشريط:</label>
                    <div className="flex flex-wrap items-center gap-1 text-[10px]">
                      <span className="text-slate-500">إدراج متغير سعر:</span>
                      {['{price}', '{old_price}', '{bundle}', '{percent}'].map((token) => (
                        <button
                          key={token}
                          type="button"
                          onClick={() =>
                            setEditingAd({
                              ...editingAd,
                              content: {
                                ...editingAd.content,
                                title: `${editingAd.content.title} ${token}`.trim(),
                              },
                            })
                          }
                          className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono font-bold hover:bg-indigo-100 cursor-pointer"
                        >
                          {token}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={editingAd.content.title}
                    onChange={(e) =>
                      setEditingAd({
                        ...editingAd,
                        content: { ...editingAd.content, title: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold mb-1">العنوان الفرعي / اسم البراند:</label>
                    <input
                      type="text"
                      value={editingAd.content.subtitle}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: { ...editingAd.content, subtitle: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">شريط السعر / العرض المميز:</label>
                    <input
                      type="text"
                      value={editingAd.content.priceText}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: { ...editingAd.content, priceText: e.target.value },
                        })
                      }
                      placeholder="مثال: ابتداءً من {price}ج بدلاً من {old_price}ج"
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold mb-1">الوصف التفصيلي (اختياري):</label>
                  <textarea
                    rows={2}
                    value={editingAd.content.description}
                    onChange={(e) =>
                      setEditingAd({
                        ...editingAd,
                        content: { ...editingAd.content, description: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none resize-y"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold mb-1">نص زر الإجراء الرئيسي (CTA):</label>
                    <input
                      type="text"
                      value={editingAd.content.ctaText}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: { ...editingAd.content, ctaText: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">وجهة الزر الرئيسي:</label>
                    <select
                      value={isCustomCtaLink ? 'custom' : editingAd.content.ctaLink}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditingAd({
                          ...editingAd,
                          content: {
                            ...editingAd.content,
                            ctaLink: v === 'custom' ? 'https://' : v,
                          },
                        });
                      }}
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-bold"
                    >
                      {CTA_LINK_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    {isCustomCtaLink && (
                      <input
                        type="text"
                        dir="ltr"
                        value={editingAd.content.ctaLink}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            content: { ...editingAd.content, ctaLink: e.target.value },
                          })
                        }
                        placeholder="https://... أو /tool"
                        className="mt-1.5 w-full px-3 py-1.5 rounded-xl clay-inset font-mono text-left"
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold mb-1">نص الزر الثانوي (اختياري):</label>
                    <input
                      type="text"
                      value={editingAd.content.secondaryCtaText}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: { ...editingAd.content, secondaryCtaText: e.target.value },
                        })
                      }
                      placeholder="مثال: اكتشف الأداة"
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">وجهة الزر الثانوي:</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={editingAd.content.secondaryCtaLink}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: { ...editingAd.content, secondaryCtaLink: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-inset border-none outline-none font-mono text-left"
                    />
                  </div>
                </div>

                {/* Media & Countdown & Alignment */}
                <div className="p-3 rounded-2xl clay-inset space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">الصورة / الفيديو والعدّاد التنازلي:</span>
                    <label className="flex items-center gap-1.5 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingAd.content.showCountdown}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            content: { ...editingAd.content, showCountdown: e.target.checked },
                          })
                        }
                      />
                      <span>إظهار العدّاد التنازلي المتزامن</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={editingAd.content.mediaType}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: {
                            ...editingAd.content,
                            mediaType: e.target.value as 'none' | 'image' | 'video',
                          },
                        })
                      }
                      className="px-3 py-2 rounded-xl clay-card font-bold border-none outline-none"
                    >
                      <option value="none">بدون ميديا</option>
                      <option value="image">صورة</option>
                      <option value="video">فيديو (MP4/URL)</option>
                    </select>

                    <input
                      type="text"
                      dir="ltr"
                      value={editingAd.content.mediaUrl}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          content: { ...editingAd.content, mediaUrl: e.target.value },
                        })
                      }
                      placeholder="/media/crovo-promo-ad.jpg أو https://..."
                      className="sm:col-span-2 px-3 py-2 rounded-xl clay-card font-mono text-left border-none outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="clay-btn px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer text-indigo-700">
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>{uploadingField === 'media' ? 'جاري الرفع...' : 'رفع صورة جديدة'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => handleUploadImage(e, 'media')}
                        className="hidden"
                      />
                    </label>

                    <div className="flex items-center gap-2">
                      <select
                        value={editingAd.content.textAlign}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            content: {
                              ...editingAd.content,
                              textAlign: e.target.value as 'right' | 'center' | 'left',
                            },
                          })
                        }
                        className="px-2.5 py-1.5 rounded-xl clay-card font-bold border-none outline-none"
                      >
                        <option value="right">محاذاة: يمين</option>
                        <option value="center">محاذاة: وسط</option>
                        <option value="left">محاذاة: يسار</option>
                      </select>

                      <select
                        value={editingAd.content.dir}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            content: {
                              ...editingAd.content,
                              dir: e.target.value as 'rtl' | 'ltr' | 'auto',
                            },
                          })
                        }
                        className="px-2.5 py-1.5 rounded-xl clay-card font-bold border-none outline-none"
                      >
                        <option value="rtl">اتجاه: RTL</option>
                        <option value="ltr">اتجاه: LTR</option>
                        <option value="auto">اتجاه: Auto</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Element Order Reorderer */}
                <div className="p-3 rounded-2xl clay-inset space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">ترتيب ظهور العناصر داخل الإعلان:</span>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingAd({
                          ...editingAd,
                          content: { ...editingAd.content, elementOrder: [...DEFAULT_ELEMENT_ORDER] },
                        })
                      }
                      className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
                    >
                      إعادة الترتيب الافتراضي
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {(editingAd.content.elementOrder || DEFAULT_ELEMENT_ORDER).map((k, idx, arr) => (
                      <div
                        key={k}
                        className="px-2.5 py-1.5 rounded-xl clay-card flex items-center justify-between gap-2"
                      >
                        <span className="font-bold text-slate-800">
                          {idx + 1}. {AD_ELEMENT_LABELS[k]}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveElementOrder(k, -1)}
                            className="p-1 rounded-lg hover:bg-indigo-50 disabled:opacity-30 cursor-pointer"
                            title="تقديم للأعلى"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === arr.length - 1}
                            onClick={() => moveElementOrder(k, 1)}
                            className="p-1 rounded-lg hover:bg-indigo-50 disabled:opacity-30 cursor-pointer"
                            title="تأخير للأسفل"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SUB-TAB 2: DESIGN, COLORS & GRADIENTS */}
            {editorTab === 'design' && (
              <div className="space-y-4">
                <div>
                  <div className="font-bold mb-2">ثيمات جاهزة بنقرة واحدة (Presets):</div>
                  <div className="flex flex-wrap gap-2">
                    {AD_PRESET_THEMES.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          setEditingAd({
                            ...editingAd,
                            design: { ...editingAd.design, ...preset.design },
                          })
                        }
                        className="clay-btn px-3 py-1.5 rounded-xl font-bold text-slate-700 hover:text-indigo-700 flex items-center gap-1.5 cursor-pointer"
                      >
                        <span
                          className="w-3 h-3 rounded-full border border-white shadow-2xs"
                          style={{
                            background: preset.design.gradientFrom || preset.design.backgroundColor,
                          }}
                        />
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Color Pickers Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {(
                    [
                      ['backgroundColor', 'لون الخلفية'],
                      ['textColor', 'لون العنوان والنص'],
                      ['subtitleColor', 'لون النص الفرعي'],
                      ['accentColor', 'لون التمييز / الشارة'],
                      ['iconColor', 'لون الأيقونة'],
                      ['ctaBgColor', 'خلفية زر الإجراء'],
                      ['ctaTextColor', 'نص زر الإجراء'],
                      ['borderColor', 'لون الحدود'],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="p-2 rounded-xl clay-inset block space-y-1">
                      <span className="block text-[11px] font-bold text-slate-700">{label}</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={
                            /^#[0-9a-fA-F]{6}$/.test(editingAd.design[field])
                              ? editingAd.design[field]
                              : '#4f46e5'
                          }
                          onChange={(e) =>
                            setEditingAd({
                              ...editingAd,
                              design: { ...editingAd.design, [field]: e.target.value },
                            })
                          }
                          className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0"
                        />
                        <input
                          type="text"
                          dir="ltr"
                          value={editingAd.design[field]}
                          onChange={(e) =>
                            setEditingAd({
                              ...editingAd,
                              design: { ...editingAd.design, [field]: e.target.value },
                            })
                          }
                          className="w-full min-w-0 px-1.5 py-1 rounded clay-card font-mono text-[10px] text-left"
                        />
                      </div>
                    </label>
                  ))}
                </div>

                {/* Gradient Builder */}
                <div className="p-3 rounded-2xl clay-inset space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingAd.design.gradientEnabled}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            design: { ...editingAd.design, gradientEnabled: e.target.checked },
                          })
                        }
                      />
                      <span>تفعيل الألوان المتدرجة (Gradient)</span>
                    </label>
                    <span className="font-mono text-[11px] text-indigo-700 font-bold">
                      الزاوية: {editingAd.design.gradientAngle}°
                    </span>
                  </div>

                  {editingAd.design.gradientEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                      <label className="flex items-center gap-1.5">
                        <span className="font-bold">من:</span>
                        <input
                          type="color"
                          value={editingAd.design.gradientFrom}
                          onChange={(e) =>
                            setEditingAd({
                              ...editingAd,
                              design: { ...editingAd.design, gradientFrom: e.target.value },
                            })
                          }
                        />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="font-bold">وسط:</span>
                        <input
                          type="color"
                          value={editingAd.design.gradientVia || editingAd.design.gradientFrom}
                          onChange={(e) =>
                            setEditingAd({
                              ...editingAd,
                              design: { ...editingAd.design, gradientVia: e.target.value },
                            })
                          }
                        />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="font-bold">إلى:</span>
                        <input
                          type="color"
                          value={editingAd.design.gradientTo}
                          onChange={(e) =>
                            setEditingAd({
                              ...editingAd,
                              design: { ...editingAd.design, gradientTo: e.target.value },
                            })
                          }
                        />
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={360}
                        value={editingAd.design.gradientAngle}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            design: { ...editingAd.design, gradientAngle: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                  )}
                </div>

                {/* Opacity, Border & Shadows */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <label className="p-2.5 rounded-xl clay-inset block space-y-1">
                    <span className="font-bold block">الشفافية ({editingAd.design.opacity})</span>
                    <input
                      type="range"
                      min={0.15}
                      max={1}
                      step={0.05}
                      value={editingAd.design.opacity}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, opacity: Number(e.target.value) },
                        })
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="p-2.5 rounded-xl clay-inset block space-y-1">
                    <span className="font-bold block">سُمك الحدود ({editingAd.design.borderWidth}px)</span>
                    <input
                      type="range"
                      min={0}
                      max={8}
                      value={editingAd.design.borderWidth}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, borderWidth: Number(e.target.value) },
                        })
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="p-2.5 rounded-xl clay-inset block space-y-1">
                    <span className="font-bold block">تدوير الحواف ({editingAd.design.borderRadius}px)</span>
                    <input
                      type="range"
                      min={0}
                      max={48}
                      value={editingAd.design.borderRadius}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, borderRadius: Number(e.target.value) },
                        })
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="p-2.5 rounded-xl clay-inset block space-y-1">
                    <span className="font-bold block">الظلال والتأثير:</span>
                    <select
                      value={editingAd.design.shadowStyle}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            shadowStyle: e.target.value as AdUnitConfig['design']['shadowStyle'],
                          },
                        })
                      }
                      className="w-full px-2 py-1 rounded-lg clay-card font-bold border-none outline-none"
                    >
                      <option value="clay">Snowy Clay (طين ثلاثي الأبعاد)</option>
                      <option value="soft">ظل ناعم (Soft)</option>
                      <option value="medium">ظل متوسط (Medium)</option>
                      <option value="glow">توهج ملون (Glow)</option>
                      <option value="none">بدون ظل</option>
                    </select>
                  </label>
                </div>

                {/* Custom Background Image */}
                <div className="p-3 rounded-2xl clay-inset space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">خلفية صورة مخصصة للإعلان (اختياري):</span>
                    <label className="clay-btn px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer text-indigo-700">
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>{uploadingField === 'bg' ? 'جاري الرفع...' : 'رفع صورة خلفية'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => handleUploadImage(e, 'bg')}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                    <input
                      type="text"
                      dir="ltr"
                      value={editingAd.design.customBgImageUrl}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, customBgImageUrl: e.target.value },
                        })
                      }
                      placeholder="رابط صورة الخلفية أو اتركه فارغاً..."
                      className="sm:col-span-2 px-3 py-2 rounded-xl clay-card font-mono text-left border-none outline-none"
                    />
                    <label className="block">
                      <span className="text-[10px] font-bold">
                        عتامة طبقة القراءة ({editingAd.design.bgImageOverlayOpacity})
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={0.9}
                        step={0.05}
                        value={editingAd.design.bgImageOverlayOpacity}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            design: {
                              ...editingAd.design,
                              bgImageOverlayOpacity: Number(e.target.value),
                            },
                          })
                        }
                        className="w-full"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* SUB-TAB 3: RESPONSIVE DIMENSIONS & TYPOGRAPHY */}
            {editorTab === 'dimensions' && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <label className="block">
                    <span className="font-bold block mb-1">العرض على الكمبيوتر:</span>
                    <input
                      type="text"
                      dir="ltr"
                      value={editingAd.design.widthDesktop}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, widthDesktop: e.target.value },
                        })
                      }
                      placeholder="100% أو 480px"
                      className="w-full px-3 py-2 rounded-xl clay-inset font-mono text-left"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">العرض على الموبايل:</span>
                    <input
                      type="text"
                      dir="ltr"
                      value={editingAd.design.widthMobile}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, widthMobile: e.target.value },
                        })
                      }
                      placeholder="100% أو 92vw"
                      className="w-full px-3 py-2 rounded-xl clay-inset font-mono text-left"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">أقصى عرض (px):</span>
                    <input
                      type="number"
                      min={200}
                      max={1600}
                      value={editingAd.design.maxWidthPx}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, maxWidthPx: Number(e.target.value) || 600 },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-inset font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">الارتفاع (كمبيوتر):</span>
                    <input
                      type="text"
                      dir="ltr"
                      value={editingAd.design.heightDesktop}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, heightDesktop: e.target.value },
                        })
                      }
                      placeholder="auto أو 120px"
                      className="w-full px-3 py-2 rounded-xl clay-inset font-mono text-left"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">الارتفاع (موبايل):</span>
                    <input
                      type="text"
                      dir="ltr"
                      value={editingAd.design.heightMobile}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, heightMobile: e.target.value },
                        })
                      }
                      placeholder="auto أو 90px"
                      className="w-full px-3 py-2 rounded-xl clay-inset font-mono text-left"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">موضع الظهور (العائم/المنبثق):</span>
                    <select
                      value={editingAd.design.position}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            position: e.target.value as AdUnitConfig['design']['position'],
                          },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-inset font-bold"
                    >
                      <option value="center">الوسط (Center)</option>
                      <option value="bottom_left">أسفل اليسار</option>
                      <option value="bottom_right">أسفل اليمين</option>
                      <option value="bottom_center">أسفل الوسط</option>
                      <option value="top_center">أعلى الوسط</option>
                      <option value="top_right">أعلى اليمين</option>
                      <option value="top_left">أعلى اليسار</option>
                    </select>
                  </label>
                </div>

                <div className="p-3 rounded-2xl clay-inset grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <label className="block">
                    <span className="font-bold block mb-1">حجم العنوان (كمبيوتر):</span>
                    <input
                      type="number"
                      min={10}
                      max={40}
                      value={editingAd.design.fontSizeDesktop}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            fontSizeDesktop: Number(e.target.value) || 14,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">حجم العنوان (موبايل):</span>
                    <input
                      type="number"
                      min={9}
                      max={32}
                      value={editingAd.design.fontSizeMobile}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            fontSizeMobile: Number(e.target.value) || 12,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">حجم الفرعي (كمبيوتر):</span>
                    <input
                      type="number"
                      min={10}
                      max={26}
                      value={editingAd.design.subtitleSizeDesktop}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            subtitleSizeDesktop: Number(e.target.value) || 13,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">حجم الفرعي (موبايل):</span>
                    <input
                      type="number"
                      min={9}
                      max={22}
                      value={editingAd.design.subtitleSizeMobile}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            subtitleSizeMobile: Number(e.target.value) || 11,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">نوع الخط:</span>
                    <select
                      value={editingAd.design.fontFamily}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            fontFamily: e.target.value as 'ios' | 'decorative' | 'mono',
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-bold"
                    >
                      <option value="ios">خط iOS عربي واضح</option>
                      <option value="decorative">خط زخرفي للعناوين</option>
                      <option value="mono">خط أحادي العرض (Mono)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">سُمك الخط:</span>
                    <select
                      value={editingAd.design.fontWeight}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            fontWeight: e.target.value as AdUnitConfig['design']['fontWeight'],
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-bold"
                    >
                      <option value="400">عادي (400)</option>
                      <option value="600">متوسط (600)</option>
                      <option value="700">عريض (700)</option>
                      <option value="800">سميك جداً (800)</option>
                      <option value="900">أقصى سُمك (900)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">حجم الأيقونة (كمبيوتر):</span>
                    <input
                      type="number"
                      min={10}
                      max={48}
                      value={editingAd.design.iconSizeDesktop}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            iconSizeDesktop: Number(e.target.value) || 18,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">حجم الأيقونة (موبايل):</span>
                    <input
                      type="number"
                      min={10}
                      max={40}
                      value={editingAd.design.iconSizeMobile}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: {
                            ...editingAd.design,
                            iconSizeMobile: Number(e.target.value) || 14,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                </div>

                {/* Spacing: Padding & Margin */}
                <div className="p-3 rounded-2xl clay-inset grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <label className="block">
                    <span className="font-bold block mb-1">حشو أفقي (كمبيوتر px):</span>
                    <input
                      type="number"
                      min={4}
                      max={64}
                      value={editingAd.design.paddingXDesktop}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, paddingXDesktop: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">حشو عمودي (كمبيوتر px):</span>
                    <input
                      type="number"
                      min={2}
                      max={48}
                      value={editingAd.design.paddingYDesktop}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, paddingYDesktop: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">حشو أفقي (موبايل px):</span>
                    <input
                      type="number"
                      min={4}
                      max={40}
                      value={editingAd.design.paddingXMobile}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, paddingXMobile: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">حشو عمودي (موبايل px):</span>
                    <input
                      type="number"
                      min={2}
                      max={36}
                      value={editingAd.design.paddingYMobile}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, paddingYMobile: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">هامش علوي (px):</span>
                    <input
                      type="number"
                      min={0}
                      max={64}
                      value={editingAd.design.marginTop}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, marginTop: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="font-bold block mb-1">هامش سفلي (px):</span>
                    <input
                      type="number"
                      min={0}
                      max={64}
                      value={editingAd.design.marginBottom}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          design: { ...editingAd.design, marginBottom: Number(e.target.value) },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* SUB-TAB 4: MOTION & SEAMLESS MARQUEE */}
            {editorTab === 'motion' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-2xl bg-indigo-50/90 border border-indigo-200/70 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-black text-indigo-950">
                        نظام الشريط الإعلاني المتحرك (Smooth Marquee / Static Toggle)
                      </div>
                      <p className="text-[11px] text-slate-600">
                        حركة سلسة متواصلة بدون تقطيع عند الوصول للنهاية، أو إيقافها لعرض نص ثابت وهادئ.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 font-black text-indigo-800 cursor-pointer px-3 py-1.5 rounded-xl clay-card">
                      <input
                        type="checkbox"
                        checked={editingAd.motion.marqueeEnabled}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            motion: { ...editingAd.motion, marqueeEnabled: e.target.checked },
                          })
                        }
                      />
                      <span>{editingAd.motion.marqueeEnabled ? 'نص متحرك مفعّل' : 'نص ثابت (بدون حركة)'}</span>
                    </label>
                  </div>

                  {editingAd.motion.marqueeEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                      <label className="block">
                        <span className="font-bold block mb-1">اتجاه الحركة:</span>
                        <select
                          value={editingAd.motion.marqueeDirection}
                          onChange={(e) =>
                            setEditingAd({
                              ...editingAd,
                              motion: {
                                ...editingAd.motion,
                                marqueeDirection: e.target.value as 'rtl' | 'ltr',
                              },
                            })
                          }
                          className="w-full px-3 py-2 rounded-xl clay-card font-bold"
                        >
                          <option value="rtl">من اليمين لليسار (RTL الطبيعي)</option>
                          <option value="ltr">من اليسار لليمين (LTR)</option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="font-bold block mb-1">
                          سرعة الشريط ({editingAd.motion.marqueeSpeedSec} ثانية للدورة):
                        </span>
                        <input
                          type="range"
                          min={8}
                          max={90}
                          value={editingAd.motion.marqueeSpeedSec}
                          onChange={(e) =>
                            setEditingAd({
                              ...editingAd,
                              motion: {
                                ...editingAd.motion,
                                marqueeSpeedSec: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full mt-2"
                        />
                      </label>

                      <label className="flex items-center gap-2 font-bold cursor-pointer pt-4">
                        <input
                          type="checkbox"
                          checked={editingAd.motion.marqueePauseOnHover}
                          onChange={(e) =>
                            setEditingAd({
                              ...editingAd,
                              motion: {
                                ...editingAd.motion,
                                marqueePauseOnHover: e.target.checked,
                              },
                            })
                          }
                        />
                        <span>إيقاف مؤقت عند الوقوف بالماوس</span>
                      </label>
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-2xl clay-inset space-y-3">
                  <label className="flex items-center gap-2 font-bold cursor-pointer text-rose-700">
                    <input
                      type="checkbox"
                      checked={editingAd.motion.disableAnimation}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          motion: { ...editingAd.motion, disableAnimation: e.target.checked },
                        })
                      }
                    />
                    <span>تعطيل جميع الحركات والأنيميشن لهذا الإعلان بالكامل</span>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    <label className="block">
                      <span className="font-bold block mb-1">تأثير الدخول:</span>
                      <select
                        value={editingAd.motion.entranceEffect}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            motion: {
                              ...editingAd.motion,
                              entranceEffect: e.target.value as AdUnitConfig['motion']['entranceEffect'],
                            },
                          })
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl clay-card font-bold"
                      >
                        <option value="none">بدون</option>
                        <option value="fade">تلاشي ناعم (Fade)</option>
                        <option value="slide_up">انزلاق للأعلى</option>
                        <option value="slide_down">انزلاق للأسفل</option>
                        <option value="slide_right">انزلاق من اليمين</option>
                        <option value="slide_left">انزلاق من اليسار</option>
                        <option value="zoom">تكبير ناعم (Zoom)</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="font-bold block mb-1">تأثير محيطي مستمر:</span>
                      <select
                        value={editingAd.motion.ambientEffect}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            motion: {
                              ...editingAd.motion,
                              ambientEffect: e.target.value as AdUnitConfig['motion']['ambientEffect'],
                            },
                          })
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl clay-card font-bold"
                      >
                        <option value="none">بدون</option>
                        <option value="light_sweep">لمعة ضوئية (Light Sweep)</option>
                        <option value="soft_pulse">نبض هادئ (Soft Pulse)</option>
                        <option value="float_gentle">طفو خفيف (Float)</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="font-bold block mb-1">مدة الانتقال (ms):</span>
                      <input
                        type="number"
                        min={100}
                        max={1500}
                        step={20}
                        value={editingAd.motion.transitionDurationMs}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            motion: {
                              ...editingAd.motion,
                              transitionDurationMs: Number(e.target.value) || 280,
                            },
                          })
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                      />
                    </label>

                    <label className="block">
                      <span className="font-bold block mb-1">إخفاء تلقائي (ثانية · 0=دائم):</span>
                      <input
                        type="number"
                        min={0}
                        max={300}
                        value={editingAd.motion.autoHideSeconds}
                        onChange={(e) =>
                          setEditingAd({
                            ...editingAd,
                            motion: {
                              ...editingAd.motion,
                              autoHideSeconds: Number(e.target.value) || 0,
                            },
                          })
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* SUB-TAB 5: BEHAVIOR, TARGETING & SCHEDULING */}
            {editorTab === 'behavior' && (
              <div className="space-y-3.5">
                <div className="p-3 rounded-2xl clay-inset flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 font-black text-slate-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingAd.behavior.enabled}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: { ...editingAd.behavior, enabled: e.target.checked },
                        })
                      }
                    />
                    <span>تفعيل الإعلان للظهور عند النشر</span>
                  </label>

                  <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingAd.behavior.closable}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: { ...editingAd.behavior, closable: e.target.checked },
                        })
                      }
                    />
                    <span>السماح للمستخدم بإغلاق/تخطي الإعلان</span>
                  </label>
                </div>

                {/* Schedule Dates */}
                <div className="p-3 rounded-2xl clay-inset grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold">تاريخ بداية الظهور (اختياري):</label>
                      {editingAd.behavior.startAt && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingAd({
                              ...editingAd,
                              behavior: { ...editingAd.behavior, startAt: null },
                            })
                          }
                          className="text-[10px] text-rose-600 font-bold cursor-pointer"
                        >
                          مسح
                        </button>
                      )}
                    </div>
                    <input
                      type="datetime-local"
                      dir="ltr"
                      value={toDatetimeLocalValue(editingAd.behavior.startAt)}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: {
                            ...editingAd.behavior,
                            startAt: fromDatetimeLocalValue(e.target.value),
                          },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-card font-mono text-left"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold">تاريخ نهاية العرض (اختياري):</label>
                      {editingAd.behavior.endAt && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingAd({
                              ...editingAd,
                              behavior: { ...editingAd.behavior, endAt: null },
                            })
                          }
                          className="text-[10px] text-rose-600 font-bold cursor-pointer"
                        >
                          مسح
                        </button>
                      )}
                    </div>
                    <input
                      type="datetime-local"
                      dir="ltr"
                      value={toDatetimeLocalValue(editingAd.behavior.endAt)}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: {
                            ...editingAd.behavior,
                            endAt: fromDatetimeLocalValue(e.target.value),
                          },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl clay-card font-mono text-left"
                    />
                  </div>
                </div>

                {/* Target Pages */}
                <div className="p-3 rounded-2xl clay-inset space-y-2">
                  <span className="font-bold block">الصفحات المستهدفة:</span>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['all', 'كل صفحات المنصة'],
                        ['library', 'الصفحة الرئيسية والمكتبة'],
                        ['toolDetails', 'صفحة تفاصيل الأداة'],
                        ['reviews', 'صفحة الآراء والتقييمات'],
                      ] as const
                    ).map(([pageKey, label]) => {
                      const checked = editingAd.behavior.pages.includes(pageKey);
                      return (
                        <label
                          key={pageKey}
                          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer ${
                            checked ? 'clay-pill-active' : 'clay-card text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const prevPages = editingAd.behavior.pages;
                              let nextPages = e.target.checked
                                ? [...prevPages, pageKey]
                                : prevPages.filter((p) => p !== pageKey);
                              if (pageKey === 'all' && e.target.checked) nextPages = ['all'];
                              if (pageKey !== 'all' && e.target.checked) {
                                nextPages = nextPages.filter((p) => p !== 'all');
                              }
                              if (nextPages.length === 0) nextPages = ['all'];
                              setEditingAd({
                                ...editingAd,
                                behavior: { ...editingAd.behavior, pages: nextPages },
                              });
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Device, Frequency, Cooldown, Delay, Priority */}
                <div className="p-3 rounded-2xl clay-inset grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <label className="block">
                    <span className="font-bold block mb-1">الجهاز المستهدف:</span>
                    <select
                      value={editingAd.behavior.deviceTarget}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: {
                            ...editingAd.behavior,
                            deviceTarget: e.target.value as 'both' | 'mobile' | 'desktop',
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-bold"
                    >
                      <option value="both">الكل (كمبيوتر وموبايل)</option>
                      <option value="mobile">الموبايل فقط</option>
                      <option value="desktop">الكمبيوتر فقط</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="font-bold block mb-1">نمط التكرار:</span>
                    <select
                      value={editingAd.behavior.frequencyMode}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: {
                            ...editingAd.behavior,
                            frequencyMode: e.target.value as 'always' | 'once' | 'recurring',
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-bold"
                    >
                      <option value="always">يظهر دائماً</option>
                      <option value="once">مرة واحدة لكل زائر</option>
                      <option value="recurring">متكرر بعد فترة هدوء</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="font-bold block mb-1">أولوية الترتيب (1-100):</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={editingAd.behavior.priority}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: {
                            ...editingAd.behavior,
                            priority: Number(e.target.value) || 50,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>

                  <label className="block">
                    <span className="font-bold block mb-1">تأخير الظهور (ثانية):</span>
                    <input
                      type="number"
                      min={0}
                      max={600}
                      value={editingAd.behavior.delaySeconds}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: {
                            ...editingAd.behavior,
                            delaySeconds: Number(e.target.value) || 0,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>

                  <label className="block">
                    <span className="font-bold block mb-1">التكرار كل (ساعة):</span>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={editingAd.behavior.cooldownHours}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: {
                            ...editingAd.behavior,
                            cooldownHours: Number(e.target.value) || 24,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>

                  <label className="block">
                    <span className="font-bold block mb-1">أقصى عدد ظهور للزائر (0=لاحد):</span>
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={editingAd.behavior.maxDisplays}
                      onChange={(e) =>
                        setEditingAd({
                          ...editingAd,
                          behavior: {
                            ...editingAd.behavior,
                            maxDisplays: Number(e.target.value) || 0,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-xl clay-card font-mono"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Live Interactive Preview Column (5/12) */}
          <div className="xl:col-span-5 clay-card p-4 space-y-3 xl:sticky xl:top-24">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-black text-slate-900">
                <Eye className="w-4 h-4 text-indigo-600" />
                <span>المعاينة الحية الفورية</span>
              </div>

              <div className="flex items-center gap-1 p-1 rounded-xl clay-inset">
                <button
                  type="button"
                  data-testid="preview-viewport-desktop"
                  onClick={() => setPreviewViewport('desktop')}
                  className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer ${
                    previewViewport === 'desktop' ? 'clay-pill-active' : 'text-slate-600'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span>كمبيوتر</span>
                </button>
                <button
                  type="button"
                  data-testid="preview-viewport-mobile"
                  onClick={() => setPreviewViewport('mobile')}
                  className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer ${
                    previewViewport === 'mobile' ? 'clay-pill-active' : 'text-slate-600'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>موبايل</span>
                </button>
              </div>
            </div>

            <div
              data-testid="ad-live-preview-canvas"
              className="rounded-2xl clay-inset p-3 bg-[#EEF2F7] overflow-x-auto flex justify-center min-h-[220px] items-center"
            >
              <div
                className={`transition-all duration-200 ${
                  previewViewport === 'mobile'
                    ? 'w-[350px] max-w-full border-2 border-indigo-200/80 rounded-3xl p-2 bg-[#EEF2F7] shadow-inner'
                    : 'w-full'
                }`}
              >
                {renderPreviewComponent(editingAd, previewViewport)}
              </div>
            </div>

            {editingAd.id === 'ad_library_popup' && (
              <button
                type="button"
                onClick={() => setLivePreviewModalAd(editingAd)}
                className="w-full clay-purple-soft py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>فتح معاينة النافذة المنبثقة الكاملة (Popup)</span>
              </button>
            )}

            <div className="p-2.5 rounded-xl bg-white/75 text-[10px] text-slate-600 space-y-1">
              <div className="font-bold text-indigo-700 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>متغيرات الأسعار المدعومة تلقائياً:</span>
              </div>
              <p className="font-mono" dir="ltr">
                {'{price}'} · {'{old_price}'} · {'{bundle}'} · {'{bundle_old}'} · {'{percent}'}
              </p>
            </div>
          </div>
        </div>

        {/* Full Popup Preview Modal if opened from Editor */}
        {livePreviewModalAd && (
          <CopyAdBanner
            isVisible
            onClose={() => setLivePreviewModalAd(null)}
            fullAdUnit={livePreviewModalAd}
            config={config}
            forceTemplateMode={
              livePreviewModalAd.content.templateMode === 'classic'
                ? 'classic'
                : livePreviewModalAd.content.templateMode === 'rich_crovo'
                ? 'rich_crovo'
                : 'custom'
            }
            forceMobile={previewViewport === 'mobile'}
            onLearnMore={previewActions.onExploreTool}
            onOpenSubscription={previewActions.onOpenSubscription}
            actions={previewActions}
            isPreview
          />
        )}
      </div>
    );
  }

  // ============================================================================
  // CENTRAL ADVERTISING MANAGER LIST VIEW
  // ============================================================================
  return (
    <div className="space-y-4 text-xs font-ios" data-testid="admin-ads-tab">
      {/* Header + Stats + Create CTA */}
      <div className="clay-card p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base sm:text-lg font-black font-decorative text-slate-900">
                مركز إدارة وتخصيص الإعلانات الشامل — CROVO SPACE
              </h2>
            </div>
            <p className="text-[11px] text-slate-600">
              تحكم كامل في كل إعلانات المنصة: الشريط العلوي، المنبثقة، البطاقات، العائمة، الترحيب، البينية، والتنبيهات.
            </p>
          </div>

          <button
            type="button"
            data-testid="ad-center-create-btn"
            onClick={() => setShowCreateModal(true)}
            className="clay-apple-blue px-4 py-2.5 rounded-2xl font-black text-white flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إنشاء إعلان جديد</span>
          </button>
        </div>

        {/* KPI Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="p-2.5 rounded-2xl clay-inset text-center">
            <div className="text-[10px] text-slate-500 font-bold">إجمالي الوحدات</div>
            <div className="text-lg font-black font-mono text-slate-900">{statsSummary.total}</div>
          </div>
          <div className="p-2.5 rounded-2xl clay-inset text-center">
            <div className="text-[10px] text-emerald-700 font-bold">نشطة الآن</div>
            <div className="text-lg font-black font-mono text-emerald-700">{statsSummary.active}</div>
          </div>
          <div className="p-2.5 rounded-2xl clay-inset text-center">
            <div className="text-[10px] text-rose-700 font-bold">متوقفة مؤقتاً</div>
            <div className="text-lg font-black font-mono text-rose-700">{statsSummary.paused}</div>
          </div>
          <div className="p-2.5 rounded-2xl clay-inset text-center">
            <div className="text-[10px] text-amber-700 font-bold">مسودات</div>
            <div className="text-lg font-black font-mono text-amber-700">{statsSummary.draft}</div>
          </div>
          <div className="p-2.5 rounded-2xl clay-inset text-center col-span-2 sm:col-span-1">
            <div className="text-[10px] text-sky-700 font-bold">مجدولة</div>
            <div className="text-lg font-black font-mono text-sky-700">{statsSummary.scheduled}</div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم الإعلان أو المحتوى..."
              className="w-full pr-9 pl-3 py-2 rounded-xl clay-inset border-none outline-none"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as 'all' | AdType)}
            className="px-3 py-2 rounded-xl clay-inset font-bold border-none outline-none"
          >
            <option value="all">جميع أنواع الإعلانات</option>
            {Object.entries(AD_TYPE_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | AdStatus)}
            className="px-3 py-2 rounded-xl clay-inset font-bold border-none outline-none"
          >
            <option value="all">جميع الحالات</option>
            <option value="active">نشطة للزوار</option>
            <option value="paused">متوقفة مؤقتاً</option>
            <option value="draft">مسودة</option>
            <option value="scheduled">مجدولة</option>
            <option value="archived">مؤرشفة / منتهية</option>
          </select>
        </div>
      </div>

      {/* Ad Units List */}
      <div className="space-y-3">
        {filteredAds.length === 0 ? (
          <div className="clay-card p-8 text-center text-slate-500 font-bold">
            لا توجد وحدات إعلانية مطابقة لعوامل التصفية الحالية.
          </div>
        ) : (
          filteredAds.map((ad) => {
            const eff = resolveAdEffectiveStatus(ad, nowMs);
            const isToggledOn = ad.behavior.enabled && ad.status !== 'paused';
            return (
              <div
                key={ad.id}
                data-testid={`ad-center-item-${ad.id}`}
                className="clay-card p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black font-decorative text-slate-900">
                      {ad.name}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${eff.badgeClass}`}>
                      {eff.label}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {AD_TYPE_META[ad.type]?.label}
                    </span>
                    {ad.isSystemDefault && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                        وحدة أساسية
                      </span>
                    )}
                    {ad.draft && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">
                        يوجد تعديل مسودة غير منشور
                      </span>
                    )}
                  </div>

                  <p className="text-xs font-bold text-slate-700 truncate" title={ad.content.title}>
                    {ad.content.title || 'بدون عنوان'}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                    <span>المكان: {AD_PLACEMENT_META[ad.placement]?.label}</span>
                    <span>· الأولوية: {ad.behavior.priority}</span>
                    <span>
                      · الجهاز:{' '}
                      {ad.behavior.deviceTarget === 'both'
                        ? 'الكل'
                        : ad.behavior.deviceTarget === 'mobile'
                        ? 'موبايل'
                        : 'كمبيوتر'}
                    </span>
                    {(ad.behavior.startAt || ad.behavior.endAt) && (
                      <span dir="ltr">
                        · الجدول: {ad.behavior.startAt ? ad.behavior.startAt.slice(0, 10) : 'الآن'} ←{' '}
                        {ad.behavior.endAt ? ad.behavior.endAt.slice(0, 10) : 'مفتوح'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-testid={`ad-toggle-${ad.id}`}
                    disabled={busyActionId === ad.id}
                    onClick={() => handleToggleAd(ad)}
                    className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 cursor-pointer ${
                      isToggledOn
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isToggledOn ? 'مفعّل' : 'متوقف'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid={`ad-edit-${ad.id}`}
                    onClick={() => {
                      setEditorTab('content');
                      setEditingAd(hydrateEditorFromAd(ad));
                    }}
                    className="clay-apple-blue px-3 py-1.5 rounded-xl font-black text-white flex items-center gap-1 cursor-pointer"
                  >
                    <FileEdit className="w-3.5 h-3.5" />
                    <span>تخصيص</span>
                  </button>

                  <button
                    type="button"
                    data-testid={`ad-preview-${ad.id}`}
                    onClick={() => setLivePreviewModalAd(ad)}
                    className="clay-btn px-2.5 py-1.5 rounded-xl font-bold text-indigo-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>معاينة</span>
                  </button>

                  <button
                    type="button"
                    data-testid={`ad-duplicate-${ad.id}`}
                    disabled={busyActionId === ad.id}
                    onClick={() => handleDuplicateAd(ad)}
                    className="clay-btn px-2.5 py-1.5 rounded-xl font-bold text-slate-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ</span>
                  </button>

                  {ad.isSystemDefault ? (
                    confirmRestoreId === ad.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleRestoreDefault(ad)}
                          className="px-2.5 py-1.5 rounded-xl bg-amber-600 text-white font-bold cursor-pointer"
                        >
                          تأكيد الاستعادة
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRestoreId(null)}
                          className="clay-btn px-2 py-1.5 rounded-xl font-bold cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`ad-restore-${ad.id}`}
                        onClick={() => setConfirmRestoreId(ad.id)}
                        className="clay-btn px-2.5 py-1.5 rounded-xl font-bold text-amber-700 flex items-center gap-1 cursor-pointer"
                        title="استعادة التصميم والنصوص الافتراضية"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>افتراضي</span>
                      </button>
                    )
                  ) : confirmDeleteId === ad.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        data-testid={`ad-confirm-delete-${ad.id}`}
                        onClick={() => handleDeleteAd(ad)}
                        className="px-2.5 py-1.5 rounded-xl bg-rose-600 text-white font-bold cursor-pointer"
                      >
                        تأكيد الحذف
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="clay-btn px-2 py-1.5 rounded-xl font-bold cursor-pointer"
                      >
                        إلغاء
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`ad-delete-${ad.id}`}
                      onClick={() => setConfirmDeleteId(ad.id)}
                      className="clay-btn px-2.5 py-1.5 rounded-xl font-bold text-rose-600 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create New Ad Template Chooser Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowCreateModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl clay-card bg-[#EEF2F7] p-5 sm:p-6 rounded-3xl space-y-4 max-h-[88vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black font-decorative text-slate-900">
                اختر نوع الوحدة الإعلانية الجديدة
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 rounded-full clay-btn flex items-center justify-center text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(Object.keys(AD_TYPE_META) as AdType[]).map((typeKey) => {
                const meta = AD_TYPE_META[typeKey];
                return (
                  <button
                    key={typeKey}
                    type="button"
                    data-testid={`create-ad-type-${typeKey}`}
                    onClick={() => {
                      const created = createTemplateAdUnit(typeKey);
                      setShowCreateModal(false);
                      setEditorTab('content');
                      setEditingAd(created);
                    }}
                    className="p-3.5 rounded-2xl clay-inset hover:bg-white/90 text-right space-y-1 transition-all cursor-pointer border border-transparent hover:border-indigo-200"
                  >
                    <div className="font-black text-indigo-800">{meta.label}</div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">{meta.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Standalone Quick Live Preview Modal (Desktop & Mobile Toggle) */}
      {livePreviewModalAd && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLivePreviewModalAd(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl clay-card bg-[#EEF2F7] p-4 sm:p-6 rounded-3xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-black text-slate-900 flex items-center gap-2">
                <Eye className="w-4 h-4 text-indigo-600" />
                <span>معاينة حية: {livePreviewModalAd.name}</span>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-1 rounded-xl clay-inset">
                  <button
                    type="button"
                    onClick={() => setPreviewViewport('desktop')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer ${
                      previewViewport === 'desktop' ? 'clay-pill-active' : 'text-slate-600'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    <span>كمبيوتر</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewViewport('mobile')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer ${
                      previewViewport === 'mobile' ? 'clay-pill-active' : 'text-slate-600'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>موبايل</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setLivePreviewModalAd(null)}
                  className="w-8 h-8 rounded-full clay-btn flex items-center justify-center text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 rounded-2xl clay-inset flex justify-center bg-[#EEF2F7]">
              <div
                className={
                  previewViewport === 'mobile'
                    ? 'w-[350px] max-w-full border-2 border-indigo-200 rounded-3xl p-2'
                    : 'w-full'
                }
              >
                {renderPreviewComponent(livePreviewModalAd, previewViewport)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
