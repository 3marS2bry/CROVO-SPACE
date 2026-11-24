import type React from 'react';

export type AdType =
  | 'announcement_bar'
  | 'popup'
  | 'modal'
  | 'floating'
  | 'inline_section'
  | 'promo_card'
  | 'offer_discount'
  | 'alert_update'
  | 'interstitial'
  | 'welcome';

export type AdPlacement =
  | 'top_bar'
  | 'hero_above'
  | 'hero_below'
  | 'library_top'
  | 'library_bottom'
  | 'tool_page'
  | 'reviews_page'
  | 'footer_above'
  | 'floating_corner'
  | 'overlay_timed'
  | 'overlay_interstitial';

export type AdStatus = 'active' | 'paused' | 'draft' | 'scheduled' | 'archived';

export type AdDeviceTarget = 'both' | 'mobile' | 'desktop';
export type AdFrequencyMode = 'always' | 'once' | 'recurring';
export type AdPageTarget = 'all' | 'library' | 'toolDetails' | 'reviews';

export type AdIconName =
  | 'sparkles'
  | 'zap'
  | 'megaphone'
  | 'tag'
  | 'gift'
  | 'bell'
  | 'flame'
  | 'shield'
  | 'star'
  | 'rocket'
  | 'crown'
  | 'info'
  | 'none';

export type AdEntranceEffect =
  | 'none'
  | 'fade'
  | 'slide_up'
  | 'slide_down'
  | 'slide_right'
  | 'slide_left'
  | 'zoom';

export type AdAmbientEffect = 'none' | 'light_sweep' | 'soft_pulse' | 'float_gentle';

export type AdShadowStyle = 'none' | 'clay' | 'soft' | 'medium' | 'glow';

export type AdElementKey =
  | 'badge'
  | 'media'
  | 'title'
  | 'subtitle'
  | 'description'
  | 'price'
  | 'countdown'
  | 'cta';

export type AdPositionAnchor =
  | 'top_center'
  | 'bottom_center'
  | 'bottom_right'
  | 'bottom_left'
  | 'top_right'
  | 'top_left'
  | 'center';

export interface AdDesignConfig {
  backgroundColor: string;
  textColor: string;
  subtitleColor: string;
  accentColor: string;
  iconColor: string;
  ctaBgColor: string;
  ctaTextColor: string;
  gradientEnabled: boolean;
  gradientFrom: string;
  gradientVia?: string;
  gradientTo: string;
  gradientAngle: number;
  opacity: number;
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
  shadowStyle: AdShadowStyle;
  customBgImageUrl: string;
  bgImageOverlayOpacity: number;
  widthDesktop: string;
  widthMobile: string;
  maxWidthPx: number;
  heightDesktop: string;
  heightMobile: string;
  fontSizeDesktop: number;
  fontSizeMobile: number;
  subtitleSizeDesktop: number;
  subtitleSizeMobile: number;
  fontWeight: '400' | '600' | '700' | '800' | '900';
  fontFamily: 'ios' | 'decorative' | 'mono';
  iconSizeDesktop: number;
  iconSizeMobile: number;
  paddingXDesktop: number;
  paddingYDesktop: number;
  paddingXMobile: number;
  paddingYMobile: number;
  marginTop: number;
  marginBottom: number;
  position: AdPositionAnchor;
}

export interface AdMotionConfig {
  disableAnimation: boolean;
  entranceEffect: AdEntranceEffect;
  exitEffect: 'none' | 'fade' | 'slide_up' | 'slide_down' | 'zoom';
  transitionDurationMs: number;
  marqueeEnabled: boolean;
  marqueeDirection: 'rtl' | 'ltr';
  marqueeSpeedSec: number;
  marqueePauseOnHover: boolean;
  ambientEffect: AdAmbientEffect;
  autoHideSeconds: number;
}

export interface AdContentConfig {
  badgeText: string;
  title: string;
  subtitle: string;
  description: string;
  priceText: string;
  mediaType: 'none' | 'image' | 'video';
  mediaUrl: string;
  ctaText: string;
  ctaLink: string;
  secondaryCtaText: string;
  secondaryCtaLink: string;
  iconName: AdIconName;
  templateMode: 'classic' | 'rich_crovo' | 'custom';
  showCountdown: boolean;
  textAlign: 'right' | 'center' | 'left';
  dir: 'rtl' | 'ltr' | 'auto';
  elementOrder: AdElementKey[];
}

export interface AdBehaviorConfig {
  enabled: boolean;
  startAt: string | null;
  endAt: string | null;
  pages: AdPageTarget[];
  maxDisplays: number; // 0 = unlimited
  cooldownHours: number;
  delaySeconds: number;
  closable: boolean;
  frequencyMode: AdFrequencyMode;
  priority: number; // 1..100
  deviceTarget: AdDeviceTarget;
}

export interface AdDraftSnapshot {
  name: string;
  type: AdType;
  placement: AdPlacement;
  content: AdContentConfig;
  design: AdDesignConfig;
  motion: AdMotionConfig;
  behavior: AdBehaviorConfig;
  updatedAt: string;
}

export interface AdUnitConfig {
  id: string;
  name: string;
  type: AdType;
  placement: AdPlacement;
  status: AdStatus;
  isSystemDefault: boolean;
  systemKey?: 'top_announcement' | 'hero_promo' | 'library_popup' | 'welcome_banner' | 'floating_offer';
  content: AdContentConfig;
  design: AdDesignConfig;
  motion: AdMotionConfig;
  behavior: AdBehaviorConfig;
  draft?: AdDraftSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export const AD_TYPE_META: Record<AdType, { label: string; description: string; defaultPlacement: AdPlacement }> = {
  announcement_bar: {
    label: 'شريط الإعلان العلوي',
    description: 'شريط تنبيه وعروض أعلى الصفحة يدعم النص المتحرك Marquee والعدّاد التنازلي.',
    defaultPlacement: 'top_bar',
  },
  popup: {
    label: 'إعلان منبثق (Popup)',
    description: 'نافذة منبثقة تظهر بعد وقت محدد أو عند التفاعل مع زر إغلاق وتكرار مخصص.',
    defaultPlacement: 'overlay_timed',
  },
  modal: {
    label: 'نافذة إعلانية (Modal)',
    description: 'نافذة حوارية مركّزة في منتصف الشاشة للعروض أو الإعلانات المهمة.',
    defaultPlacement: 'overlay_timed',
  },
  floating: {
    label: 'إعلان عائم (Floating)',
    description: 'بطاقة عائمة أنيقة في زاوية الشاشة لا تعيق التصفح.',
    defaultPlacement: 'floating_corner',
  },
  inline_section: {
    label: 'إعلان داخل الصفحات والأقسام',
    description: 'وحدة إعلانية مدمجة داخل صفحات المكتبة أو الأداة أو الآراء.',
    defaultPlacement: 'library_top',
  },
  promo_card: {
    label: 'بطاقة إعلانية (Promo Card)',
    description: 'بطاقة ترويجية ثلاثية الأبعاد متناسقة مع هوية CROVO SPACE.',
    defaultPlacement: 'hero_below',
  },
  offer_discount: {
    label: 'إعلان عرض وخصم',
    description: 'إعلان خصومات وعروض محدودة المدة مع تسعير ديناميكي وشارة خصم.',
    defaultPlacement: 'library_top',
  },
  alert_update: {
    label: 'إعلان تنبيه وتحديث',
    description: 'تنبيه مميز لإعلان التحديثات أو المميزات الجديدة في المنصة.',
    defaultPlacement: 'hero_above',
  },
  interstitial: {
    label: 'إعلان بيني (Interstitial)',
    description: 'شاشة عرض كاملة بتركيز عالٍ للعروض الكبرى مع إمكانية الإغلاق.',
    defaultPlacement: 'overlay_interstitial',
  },
  welcome: {
    label: 'إعلان الترحيب عند الدخول',
    description: 'ترحيب مخصص للزوار الجدد في أعلى الصفحة أو عند فتح الموقع.',
    defaultPlacement: 'hero_above',
  },
};

export const AD_PLACEMENT_META: Record<AdPlacement, { label: string; isOverlay: boolean }> = {
  top_bar: { label: 'أعلى الصفحة (شريط الإعلان العلوي)', isOverlay: false },
  hero_above: { label: 'أعلى القسم الرئيسي (Welcome / تنبيه)', isOverlay: false },
  hero_below: { label: 'أسفل القسم الرئيسي (بطاقة البطل)', isOverlay: false },
  library_top: { label: 'أعلى مكتبة الحلول', isOverlay: false },
  library_bottom: { label: 'أسفل مكتبة الحلول', isOverlay: false },
  tool_page: { label: 'داخل صفحة الأداة', isOverlay: false },
  reviews_page: { label: 'داخل صفحة الآراء والتقييمات', isOverlay: false },
  footer_above: { label: 'أعلى الفوتر (نهاية الصفحة)', isOverlay: false },
  floating_corner: { label: 'عائم في زاوية الشاشة', isOverlay: false },
  overlay_timed: { label: 'نافذة منبثقة / Modal بالمنتصف', isOverlay: true },
  overlay_interstitial: { label: 'إعلان بيني (Interstitial)', isOverlay: true },
};

export const AD_ICON_OPTIONS: Array<{ value: AdIconName; label: string }> = [
  { value: 'sparkles', label: 'نجوم ولمعان (Sparkles)' },
  { value: 'zap', label: 'برق وسرعة (Zap)' },
  { value: 'megaphone', label: 'مكبر إعلان (Megaphone)' },
  { value: 'tag', label: 'بطاقة خصم (Tag)' },
  { value: 'gift', label: 'هدية وعرض (Gift)' },
  { value: 'bell', label: 'جرس تنبيه (Bell)' },
  { value: 'flame', label: 'عرض ساخن (Flame)' },
  { value: 'shield', label: 'درع أمان (Shield)' },
  { value: 'star', label: 'نجمة مميزة (Star)' },
  { value: 'rocket', label: 'صاروخ إطلاق (Rocket)' },
  { value: 'crown', label: 'تاج VIP (Crown)' },
  { value: 'info', label: 'معلومة (Info)' },
  { value: 'none', label: 'بدون أيقونة' },
];

export const DEFAULT_ELEMENT_ORDER: AdElementKey[] = [
  'badge',
  'media',
  'title',
  'subtitle',
  'description',
  'price',
  'countdown',
  'cta',
];

export const AD_ELEMENT_LABELS: Record<AdElementKey, string> = {
  badge: 'شارة الإعلان / الخصم',
  media: 'الصورة / الميديا',
  title: 'العنوان الرئيسي',
  subtitle: 'العنوان الفرعي',
  description: 'الوصف التفصيلي',
  price: 'شريط السعر / العرض',
  countdown: 'العدّاد التنازلي',
  cta: 'أزرار الإجراء (CTA)',
};

export const AD_PRESET_THEMES: Array<{
  id: string;
  label: string;
  design: Partial<AdDesignConfig>;
}> = [
  {
    id: 'crovo_indigo',
    label: 'بنفسجي CROVO المتدرج',
    design: {
      gradientEnabled: true,
      gradientFrom: '#4f46e5',
      gradientVia: '#7c3aed',
      gradientTo: '#4338ca',
      gradientAngle: 270,
      backgroundColor: '#4f46e5',
      textColor: '#ffffff',
      subtitleColor: '#e0e7ff',
      accentColor: '#fcd34d',
      iconColor: '#fde68a',
      ctaBgColor: '#ffffff',
      ctaTextColor: '#4338ca',
      borderColor: '#ffffff',
      borderWidth: 1,
    },
  },
  {
    id: 'crovo_snow_clay',
    label: 'طين ثلجي ناعم (Snowy Clay)',
    design: {
      gradientEnabled: true,
      gradientFrom: '#eef2ff',
      gradientVia: '#ffffff',
      gradientTo: '#f5f3ff',
      gradientAngle: 135,
      backgroundColor: '#f1f5fa',
      textColor: '#0f172a',
      subtitleColor: '#334155',
      accentColor: '#4f46e5',
      iconColor: '#f59e0b',
      ctaBgColor: '#2563eb',
      ctaTextColor: '#ffffff',
      borderColor: '#c7d2fe',
      borderWidth: 1,
      shadowStyle: 'clay',
    },
  },
  {
    id: 'emerald_offer',
    label: 'أخضر زمردي (عروض وواتساب)',
    design: {
      gradientEnabled: true,
      gradientFrom: '#059669',
      gradientVia: '#10b981',
      gradientTo: '#047857',
      gradientAngle: 135,
      backgroundColor: '#059669',
      textColor: '#ffffff',
      subtitleColor: '#d1fae5',
      accentColor: '#fef08a',
      iconColor: '#fde047',
      ctaBgColor: '#ffffff',
      ctaTextColor: '#065f46',
      borderColor: '#a7f3d0',
      borderWidth: 1,
    },
  },
  {
    id: 'amber_flash',
    label: 'ذهبي وعنبر (تنبيهات سريعة)',
    design: {
      gradientEnabled: true,
      gradientFrom: '#fef3c7',
      gradientVia: '#fffbeb',
      gradientTo: '#fde68a',
      gradientAngle: 135,
      backgroundColor: '#fef3c7',
      textColor: '#78350f',
      subtitleColor: '#92400e',
      accentColor: '#d97706',
      iconColor: '#d97706',
      ctaBgColor: '#b45309',
      ctaTextColor: '#ffffff',
      borderColor: '#f59e0b',
      borderWidth: 1,
    },
  },
  {
    id: 'midnight_vip',
    label: 'داكن فخم (VIP)',
    design: {
      gradientEnabled: true,
      gradientFrom: '#0f172a',
      gradientVia: '#1e1b4b',
      gradientTo: '#312e81',
      gradientAngle: 135,
      backgroundColor: '#0f172a',
      textColor: '#f8fafc',
      subtitleColor: '#cbd5e1',
      accentColor: '#38bdf8',
      iconColor: '#fbbf24',
      ctaBgColor: '#4f46e5',
      ctaTextColor: '#ffffff',
      borderColor: '#475569',
      borderWidth: 1,
    },
  },
];

export function buildDefaultDesign(overrides?: Partial<AdDesignConfig>): AdDesignConfig {
  return {
    backgroundColor: '#F1F5FA',
    textColor: '#0F172A',
    subtitleColor: '#475569',
    accentColor: '#4F46E5',
    iconColor: '#F59E0B',
    ctaBgColor: '#2563EB',
    ctaTextColor: '#FFFFFF',
    gradientEnabled: true,
    gradientFrom: '#EEF2FF',
    gradientVia: '#FFFFFF',
    gradientTo: '#F5F3FF',
    gradientAngle: 135,
    opacity: 1,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 24,
    shadowStyle: 'clay',
    customBgImageUrl: '',
    bgImageOverlayOpacity: 0.25,
    widthDesktop: '100%',
    widthMobile: '100%',
    maxWidthPx: 1152,
    heightDesktop: 'auto',
    heightMobile: 'auto',
    fontSizeDesktop: 18,
    fontSizeMobile: 15,
    subtitleSizeDesktop: 14,
    subtitleSizeMobile: 12,
    fontWeight: '800',
    fontFamily: 'ios',
    iconSizeDesktop: 20,
    iconSizeMobile: 16,
    paddingXDesktop: 24,
    paddingYDesktop: 20,
    paddingXMobile: 14,
    paddingYMobile: 14,
    marginTop: 8,
    marginBottom: 16,
    position: 'center',
    ...overrides,
  };
}

export function buildDefaultMotion(overrides?: Partial<AdMotionConfig>): AdMotionConfig {
  return {
    disableAnimation: false,
    entranceEffect: 'fade',
    exitEffect: 'fade',
    transitionDurationMs: 280,
    marqueeEnabled: false,
    marqueeDirection: 'rtl',
    marqueeSpeedSec: 28,
    marqueePauseOnHover: true,
    ambientEffect: 'none',
    autoHideSeconds: 0,
    ...overrides,
  };
}

export function buildDefaultBehavior(overrides?: Partial<AdBehaviorConfig>): AdBehaviorConfig {
  return {
    enabled: true,
    startAt: null,
    endAt: null,
    pages: ['all'],
    maxDisplays: 0,
    cooldownHours: 24,
    delaySeconds: 0,
    closable: true,
    frequencyMode: 'always',
    priority: 50,
    deviceTarget: 'both',
    ...overrides,
  };
}

export function buildDefaultContent(overrides?: Partial<AdContentConfig>): AdContentConfig {
  return {
    badgeText: 'عرض CROVO SPACE',
    title: 'عنوان الإعلان الترويجي',
    subtitle: 'نص فرعي يوضّح تفاصيل العرض أو التحديث للطلاب.',
    description: '',
    priceText: '',
    mediaType: 'none',
    mediaUrl: '',
    ctaText: 'اشترك الآن',
    ctaLink: '#subscribe',
    secondaryCtaText: '',
    secondaryCtaLink: '#tool',
    iconName: 'sparkles',
    templateMode: 'custom',
    showCountdown: false,
    textAlign: 'right',
    dir: 'rtl',
    elementOrder: [...DEFAULT_ELEMENT_ORDER],
    ...overrides,
  };
}

export function sanitizeHexColor(val: unknown, fallback: string): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return trimmed;
  }
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)$/i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export function sanitizeAdLinkUrl(raw: unknown, fallback = '#subscribe'): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().slice(0, 400);
  if (!trimmed) return fallback;
  const lower = trimmed.toLowerCase();
  // Block dangerous schemes cleanly
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('file:')
  ) {
    return fallback;
  }
  if (['#tool', '#subscribe', '#library', '#reviews', '#help', '#order-section'].includes(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  if (/^https?:\/\/[^\s<>"']+$/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('#') && /^#[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export function sanitizeAdMediaUrl(raw: unknown, fallback = ''): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return trimmed.length <= 320_000 ? trimmed : fallback;
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:')
  ) {
    return fallback;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && trimmed.length <= 400) {
    return trimmed;
  }
  if (/^https?:\/\/[^\s<>"']{4,500}$/i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeDimension(val: unknown, fallback: string): string {
  if (typeof val !== 'string') return fallback;
  const t = val.trim().slice(0, 24);
  if (!t) return fallback;
  if (t === 'auto' || /^\d{1,4}(?:\.\d+)?(px|%|vw|vh|rem)$/.test(t)) {
    return t;
  }
  return fallback;
}

function sanitizeIsoNullable(val: unknown): string | null {
  if (typeof val !== 'string' || !val.trim()) return null;
  const t = val.trim().slice(0, 64);
  const parsed = Date.parse(t);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

const VALID_AD_TYPES: Set<AdType> = new Set([
  'announcement_bar',
  'popup',
  'modal',
  'floating',
  'inline_section',
  'promo_card',
  'offer_discount',
  'alert_update',
  'interstitial',
  'welcome',
]);

const VALID_PLACEMENTS: Set<AdPlacement> = new Set([
  'top_bar',
  'hero_above',
  'hero_below',
  'library_top',
  'library_bottom',
  'tool_page',
  'reviews_page',
  'footer_above',
  'floating_corner',
  'overlay_timed',
  'overlay_interstitial',
]);

const VALID_STATUSES: Set<AdStatus> = new Set([
  'active',
  'paused',
  'draft',
  'scheduled',
  'archived',
]);

const VALID_ICONS: Set<AdIconName> = new Set([
  'sparkles',
  'zap',
  'megaphone',
  'tag',
  'gift',
  'bell',
  'flame',
  'shield',
  'star',
  'rocket',
  'crown',
  'info',
  'none',
]);

export function sanitizeAdDesign(raw: unknown, base?: AdDesignConfig): AdDesignConfig {
  const b = base || buildDefaultDesign();
  if (!raw || typeof raw !== 'object') return { ...b };
  const d = raw as Partial<AdDesignConfig>;
  return {
    backgroundColor: sanitizeHexColor(d.backgroundColor, b.backgroundColor),
    textColor: sanitizeHexColor(d.textColor, b.textColor),
    subtitleColor: sanitizeHexColor(d.subtitleColor, b.subtitleColor),
    accentColor: sanitizeHexColor(d.accentColor, b.accentColor),
    iconColor: sanitizeHexColor(d.iconColor, b.iconColor),
    ctaBgColor: sanitizeHexColor(d.ctaBgColor, b.ctaBgColor),
    ctaTextColor: sanitizeHexColor(d.ctaTextColor, b.ctaTextColor),
    gradientEnabled: typeof d.gradientEnabled === 'boolean' ? d.gradientEnabled : b.gradientEnabled,
    gradientFrom: sanitizeHexColor(d.gradientFrom, b.gradientFrom),
    gradientVia: d.gradientVia ? sanitizeHexColor(d.gradientVia, b.gradientVia || b.gradientFrom) : b.gradientVia,
    gradientTo: sanitizeHexColor(d.gradientTo, b.gradientTo),
    gradientAngle: Math.round(clampNum(d.gradientAngle, 0, 360, b.gradientAngle)),
    opacity: Number(clampNum(d.opacity, 0.1, 1, b.opacity).toFixed(2)),
    borderWidth: Math.round(clampNum(d.borderWidth, 0, 8, b.borderWidth)),
    borderColor: sanitizeHexColor(d.borderColor, b.borderColor),
    borderRadius: Math.round(clampNum(d.borderRadius, 0, 48, b.borderRadius)),
    shadowStyle: ['none', 'clay', 'soft', 'medium', 'glow'].includes(String(d.shadowStyle))
      ? (d.shadowStyle as AdShadowStyle)
      : b.shadowStyle,
    customBgImageUrl: sanitizeAdMediaUrl(d.customBgImageUrl, b.customBgImageUrl),
    bgImageOverlayOpacity: Number(clampNum(d.bgImageOverlayOpacity, 0, 0.9, b.bgImageOverlayOpacity).toFixed(2)),
    widthDesktop: sanitizeDimension(d.widthDesktop, b.widthDesktop),
    widthMobile: sanitizeDimension(d.widthMobile, b.widthMobile),
    maxWidthPx: Math.round(clampNum(d.maxWidthPx, 200, 1600, b.maxWidthPx)),
    heightDesktop: sanitizeDimension(d.heightDesktop, b.heightDesktop),
    heightMobile: sanitizeDimension(d.heightMobile, b.heightMobile),
    fontSizeDesktop: Math.round(clampNum(d.fontSizeDesktop, 10, 40, b.fontSizeDesktop)),
    fontSizeMobile: Math.round(clampNum(d.fontSizeMobile, 9, 32, b.fontSizeMobile)),
    subtitleSizeDesktop: Math.round(clampNum(d.subtitleSizeDesktop, 10, 26, b.subtitleSizeDesktop)),
    subtitleSizeMobile: Math.round(clampNum(d.subtitleSizeMobile, 9, 22, b.subtitleSizeMobile)),
    fontWeight: ['400', '600', '700', '800', '900'].includes(String(d.fontWeight))
      ? (String(d.fontWeight) as AdDesignConfig['fontWeight'])
      : b.fontWeight,
    fontFamily: ['ios', 'decorative', 'mono'].includes(String(d.fontFamily))
      ? (d.fontFamily as AdDesignConfig['fontFamily'])
      : b.fontFamily,
    iconSizeDesktop: Math.round(clampNum(d.iconSizeDesktop, 10, 48, b.iconSizeDesktop)),
    iconSizeMobile: Math.round(clampNum(d.iconSizeMobile, 10, 40, b.iconSizeMobile)),
    paddingXDesktop: Math.round(clampNum(d.paddingXDesktop, 4, 64, b.paddingXDesktop)),
    paddingYDesktop: Math.round(clampNum(d.paddingYDesktop, 2, 48, b.paddingYDesktop)),
    paddingXMobile: Math.round(clampNum(d.paddingXMobile, 4, 40, b.paddingXMobile)),
    paddingYMobile: Math.round(clampNum(d.paddingYMobile, 2, 36, b.paddingYMobile)),
    marginTop: Math.round(clampNum(d.marginTop, 0, 64, b.marginTop)),
    marginBottom: Math.round(clampNum(d.marginBottom, 0, 64, b.marginBottom)),
    position: [
      'top_center',
      'bottom_center',
      'bottom_right',
      'bottom_left',
      'top_right',
      'top_left',
      'center',
    ].includes(String(d.position))
      ? (d.position as AdPositionAnchor)
      : b.position,
  };
}

export function sanitizeAdMotion(raw: unknown, base?: AdMotionConfig): AdMotionConfig {
  const b = base || buildDefaultMotion();
  if (!raw || typeof raw !== 'object') return { ...b };
  const m = raw as Partial<AdMotionConfig>;
  return {
    disableAnimation: typeof m.disableAnimation === 'boolean' ? m.disableAnimation : b.disableAnimation,
    entranceEffect: ['none', 'fade', 'slide_up', 'slide_down', 'slide_right', 'slide_left', 'zoom'].includes(
      String(m.entranceEffect)
    )
      ? (m.entranceEffect as AdEntranceEffect)
      : b.entranceEffect,
    exitEffect: ['none', 'fade', 'slide_up', 'slide_down', 'zoom'].includes(String(m.exitEffect))
      ? (m.exitEffect as AdMotionConfig['exitEffect'])
      : b.exitEffect,
    transitionDurationMs: Math.round(clampNum(m.transitionDurationMs, 100, 1500, b.transitionDurationMs)),
    marqueeEnabled: typeof m.marqueeEnabled === 'boolean' ? m.marqueeEnabled : b.marqueeEnabled,
    marqueeDirection: m.marqueeDirection === 'ltr' ? 'ltr' : m.marqueeDirection === 'rtl' ? 'rtl' : b.marqueeDirection,
    marqueeSpeedSec: Math.round(clampNum(m.marqueeSpeedSec, 8, 90, b.marqueeSpeedSec)),
    marqueePauseOnHover:
      typeof m.marqueePauseOnHover === 'boolean' ? m.marqueePauseOnHover : b.marqueePauseOnHover,
    ambientEffect: ['none', 'light_sweep', 'soft_pulse', 'float_gentle'].includes(String(m.ambientEffect))
      ? (m.ambientEffect as AdAmbientEffect)
      : b.ambientEffect,
    autoHideSeconds: Math.round(clampNum(m.autoHideSeconds, 0, 300, b.autoHideSeconds)),
  };
}

export function sanitizeAdContent(raw: unknown, base?: AdContentConfig): AdContentConfig {
  const b = base || buildDefaultContent();
  if (!raw || typeof raw !== 'object') return { ...b };
  const c = raw as Partial<AdContentConfig>;
  const orderSet = new Set<AdElementKey>(DEFAULT_ELEMENT_ORDER);
  const rawOrder = Array.isArray(c.elementOrder)
    ? c.elementOrder.filter((k): k is AdElementKey => orderSet.has(k as AdElementKey))
    : [];
  const mergedOrder: AdElementKey[] = [...new Set(rawOrder)];
  for (const k of DEFAULT_ELEMENT_ORDER) {
    if (!mergedOrder.includes(k)) mergedOrder.push(k);
  }

  return {
    badgeText: typeof c.badgeText === 'string' ? c.badgeText.slice(0, 80) : b.badgeText,
    title: typeof c.title === 'string' ? c.title.slice(0, 220) : b.title,
    subtitle: typeof c.subtitle === 'string' ? c.subtitle.slice(0, 320) : b.subtitle,
    description: typeof c.description === 'string' ? c.description.slice(0, 900) : b.description,
    priceText: typeof c.priceText === 'string' ? c.priceText.slice(0, 180) : b.priceText,
    mediaType: ['none', 'image', 'video'].includes(String(c.mediaType))
      ? (c.mediaType as AdContentConfig['mediaType'])
      : b.mediaType,
    mediaUrl: sanitizeAdMediaUrl(c.mediaUrl, b.mediaUrl),
    ctaText: typeof c.ctaText === 'string' ? c.ctaText.slice(0, 80) : b.ctaText,
    ctaLink: sanitizeAdLinkUrl(c.ctaLink, b.ctaLink),
    secondaryCtaText:
      typeof c.secondaryCtaText === 'string' ? c.secondaryCtaText.slice(0, 80) : b.secondaryCtaText,
    secondaryCtaLink: sanitizeAdLinkUrl(c.secondaryCtaLink, b.secondaryCtaLink || '#tool'),
    iconName: VALID_ICONS.has(c.iconName as AdIconName) ? (c.iconName as AdIconName) : b.iconName,
    templateMode: ['classic', 'rich_crovo', 'custom'].includes(String(c.templateMode))
      ? (c.templateMode as AdContentConfig['templateMode'])
      : b.templateMode,
    showCountdown: typeof c.showCountdown === 'boolean' ? c.showCountdown : b.showCountdown,
    textAlign: ['right', 'center', 'left'].includes(String(c.textAlign))
      ? (c.textAlign as AdContentConfig['textAlign'])
      : b.textAlign,
    dir: ['rtl', 'ltr', 'auto'].includes(String(c.dir)) ? (c.dir as AdContentConfig['dir']) : b.dir,
    elementOrder: mergedOrder,
  };
}

export function sanitizeAdBehavior(raw: unknown, base?: AdBehaviorConfig): AdBehaviorConfig {
  const b = base || buildDefaultBehavior();
  if (!raw || typeof raw !== 'object') return { ...b };
  const bv = raw as Partial<AdBehaviorConfig>;
  const validPages: Set<AdPageTarget> = new Set(['all', 'library', 'toolDetails', 'reviews']);
  const pages = Array.isArray(bv.pages)
    ? bv.pages.filter((p): p is AdPageTarget => validPages.has(p as AdPageTarget))
    : b.pages;

  return {
    enabled: typeof bv.enabled === 'boolean' ? bv.enabled : b.enabled,
    startAt: bv.startAt === null ? null : bv.startAt !== undefined ? sanitizeIsoNullable(bv.startAt) : b.startAt,
    endAt: bv.endAt === null ? null : bv.endAt !== undefined ? sanitizeIsoNullable(bv.endAt) : b.endAt,
    pages: pages.length > 0 ? Array.from(new Set(pages)) : ['all'],
    maxDisplays: Math.round(clampNum(bv.maxDisplays, 0, 999, b.maxDisplays)),
    cooldownHours: Math.round(clampNum(bv.cooldownHours, 1, 720, b.cooldownHours)),
    delaySeconds: Math.round(clampNum(bv.delaySeconds, 0, 600, b.delaySeconds)),
    closable: typeof bv.closable === 'boolean' ? bv.closable : b.closable,
    frequencyMode: ['always', 'once', 'recurring'].includes(String(bv.frequencyMode))
      ? (bv.frequencyMode as AdFrequencyMode)
      : b.frequencyMode,
    priority: Math.round(clampNum(bv.priority, 1, 100, b.priority)),
    deviceTarget: ['both', 'mobile', 'desktop'].includes(String(bv.deviceTarget))
      ? (bv.deviceTarget as AdDeviceTarget)
      : b.deviceTarget,
  };
}

export function sanitizeAdUnit(raw: unknown, fallback?: AdUnitConfig): AdUnitConfig {
  const nowIso = new Date().toISOString();
  const base: AdUnitConfig = fallback || {
    id: `ad_${Date.now().toString(36)}`,
    name: 'إعلان جديد',
    type: 'promo_card',
    placement: 'library_top',
    status: 'draft',
    isSystemDefault: false,
    content: buildDefaultContent(),
    design: buildDefaultDesign(),
    motion: buildDefaultMotion(),
    behavior: buildDefaultBehavior({ enabled: true }),
    draft: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AdUnitConfig>;
  const safeId =
    typeof r.id === 'string' && /^[a-zA-Z0-9_-]{2,64}$/.test(r.id.trim())
      ? r.id.trim()
      : base.id;
  const type = VALID_AD_TYPES.has(r.type as AdType) ? (r.type as AdType) : base.type;
  const placement = VALID_PLACEMENTS.has(r.placement as AdPlacement)
    ? (r.placement as AdPlacement)
    : base.placement;
  const status = VALID_STATUSES.has(r.status as AdStatus) ? (r.status as AdStatus) : base.status;

  const cleanContent = sanitizeAdContent(r.content, base.content);
  const cleanDesign = sanitizeAdDesign(r.design, base.design);
  const cleanMotion = sanitizeAdMotion(r.motion, base.motion);
  const cleanBehavior = sanitizeAdBehavior(r.behavior, base.behavior);

  let cleanDraft: AdDraftSnapshot | null = null;
  if (r.draft && typeof r.draft === 'object') {
    const dr = r.draft as Partial<AdDraftSnapshot>;
    cleanDraft = {
      name: typeof dr.name === 'string' && dr.name.trim() ? dr.name.trim().slice(0, 120) : base.name,
      type: VALID_AD_TYPES.has(dr.type as AdType) ? (dr.type as AdType) : type,
      placement: VALID_PLACEMENTS.has(dr.placement as AdPlacement)
        ? (dr.placement as AdPlacement)
        : placement,
      content: sanitizeAdContent(dr.content, cleanContent),
      design: sanitizeAdDesign(dr.design, cleanDesign),
      motion: sanitizeAdMotion(dr.motion, cleanMotion),
      behavior: sanitizeAdBehavior(dr.behavior, cleanBehavior),
      updatedAt: typeof dr.updatedAt === 'string' && dr.updatedAt ? dr.updatedAt.slice(0, 64) : nowIso,
    };
  }

  return {
    id: safeId,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 120) : base.name,
    type,
    placement,
    status,
    isSystemDefault: Boolean(base.isSystemDefault || r.isSystemDefault),
    systemKey: base.systemKey || r.systemKey,
    content: cleanContent,
    design: cleanDesign,
    motion: cleanMotion,
    behavior: cleanBehavior,
    draft: cleanDraft,
    createdAt: typeof r.createdAt === 'string' && r.createdAt ? r.createdAt.slice(0, 64) : base.createdAt,
    updatedAt: typeof r.updatedAt === 'string' && r.updatedAt ? r.updatedAt.slice(0, 64) : nowIso,
  };
}

export function buildDefaultAdUnits(legacy?: {
  promoBanner?: { enabled: boolean; text: string };
  heroPromo?: { enabled: boolean; title: string; subtitle: string };
  libraryAd?: {
    enabled: boolean;
    title: string;
    subtitle: string;
    priceText: string;
    ctaText: string;
    ctaLink?: string;
    imageUrl?: string;
    delaySeconds?: number;
    cooldownHours?: number;
    templateMode?: 'classic' | 'rich_crovo';
    workflowStatus?: string;
  };
}): AdUnitConfig[] {
  const epochIso = '2026-01-01T00:00:00.000Z';
  const promoText =
    legacy?.promoBanner?.text?.trim() ||
    'حل المنصة بالكامل للترمين بـ{price} جنيه فقط · المنصتين مع بعض بـ{bundle} جنيه فقط';
  const promoEnabled = legacy?.promoBanner?.enabled ?? true;

  const heroTitle =
    legacy?.heroPromo?.title?.trim() ||
    'أداة CROVO ومكتبة الحلول الموثوقة لطلاب البكالوريا';
  const heroSubtitle =
    legacy?.heroPromo?.subtitle?.trim() ||
    'إجابات منظمة ومحدثة + خدمة اشتراك ميسّرة عبر واتساب.';
  const heroEnabled = legacy?.heroPromo?.enabled ?? true;

  const libEnabled = legacy?.libraryAd?.enabled ?? true;
  const libTitle =
    legacy?.libraryAd?.title?.trim() || 'تحتاج مساعدة منظمة لإنهاء دروس المنصة بسرعة؟';
  const libSubtitle =
    legacy?.libraryAd?.subtitle?.trim() ||
    'أداة CROVO متوفرة للاشتراك الميسّر مع متابعة مباشرة وتأكيد يدوي عبر واتساب.';
  const libPrice = legacy?.libraryAd?.priceText?.trim() || 'ابتداءً من 50 ج بدلاً من 100 ج';
  const libCta = legacy?.libraryAd?.ctaText?.trim() || 'اشترك الآن في الأداة';
  const libLink = sanitizeAdLinkUrl(legacy?.libraryAd?.ctaLink, '#subscribe');
  const libImg = sanitizeAdMediaUrl(legacy?.libraryAd?.imageUrl, '/media/crovo-promo-ad.jpg');
  const libDelay = typeof legacy?.libraryAd?.delaySeconds === 'number' ? legacy.libraryAd.delaySeconds : 18;
  const libCooldown = typeof legacy?.libraryAd?.cooldownHours === 'number' ? legacy.libraryAd.cooldownHours : 24;
  const libTemplate = legacy?.libraryAd?.templateMode === 'classic' ? 'classic' : 'rich_crovo';
  const libStatus: AdStatus =
    legacy?.libraryAd?.workflowStatus === 'archived'
      ? 'archived'
      : libEnabled
      ? 'active'
      : 'paused';

  return [
    {
      id: 'ad_top_announcement',
      name: 'شريط الإعلان العلوي الرئيسي',
      type: 'announcement_bar',
      placement: 'top_bar',
      status: promoEnabled ? 'active' : 'paused',
      isSystemDefault: true,
      systemKey: 'top_announcement',
      content: buildDefaultContent({
        badgeText: 'خصم {percent}%',
        title: promoText,
        subtitle: 'CROVO SPACE',
        description: '',
        priceText: '',
        ctaText: 'اشترك الآن',
        ctaLink: '#subscribe',
        iconName: 'tag',
        templateMode: 'custom',
        showCountdown: true,
        textAlign: 'right',
        dir: 'rtl',
      }),
      design: buildDefaultDesign({
        gradientEnabled: true,
        gradientFrom: '#4f46e5',
        gradientVia: '#9333ea',
        gradientTo: '#4338ca',
        gradientAngle: 270,
        backgroundColor: '#4f46e5',
        textColor: '#ffffff',
        subtitleColor: '#e0e7ff',
        accentColor: '#fcd34d',
        iconColor: '#fcd34d',
        ctaBgColor: '#ffffff',
        ctaTextColor: '#4338ca',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.25)',
        borderRadius: 0,
        shadowStyle: 'none',
        widthDesktop: '100%',
        widthMobile: '100%',
        maxWidthPx: 1600,
        fontSizeDesktop: 12,
        fontSizeMobile: 10,
        subtitleSizeDesktop: 11,
        subtitleSizeMobile: 9,
        iconSizeDesktop: 14,
        iconSizeMobile: 11,
        paddingXDesktop: 24,
        paddingYDesktop: 6,
        paddingXMobile: 8,
        paddingYMobile: 4,
        marginTop: 0,
        marginBottom: 0,
        position: 'top_center',
      }),
      motion: buildDefaultMotion({
        disableAnimation: false,
        entranceEffect: 'none',
        marqueeEnabled: true,
        marqueeDirection: 'rtl',
        marqueeSpeedSec: 28,
        marqueePauseOnHover: true,
        ambientEffect: 'light_sweep',
      }),
      behavior: buildDefaultBehavior({
        enabled: promoEnabled,
        pages: ['all'],
        closable: false,
        frequencyMode: 'always',
        priority: 100,
        deviceTarget: 'both',
      }),
      draft: null,
      createdAt: epochIso,
      updatedAt: epochIso,
    },
    {
      id: 'ad_hero_promo',
      name: 'بطاقة البطل الترويجية (Hero Promo Card)',
      type: 'promo_card',
      placement: 'hero_below',
      status: heroEnabled ? 'active' : 'paused',
      isSystemDefault: true,
      systemKey: 'hero_promo',
      content: buildDefaultContent({
        badgeText: 'عرض متاح لفترة محدودة',
        title: heroTitle,
        subtitle: heroSubtitle,
        description: 'حماية وأمان كامل لبيانات حسابك · متابعة مباشرة عبر واتساب بدون خطوات معقدة',
        priceText: 'بـ {price} جنيه بس · الباقة الكاملة ({bundle} جنيه)',
        ctaText: 'اشترك الآن',
        ctaLink: '#subscribe',
        secondaryCtaText: 'اكتشف الأداة',
        secondaryCtaLink: '#tool',
        iconName: 'sparkles',
        templateMode: 'custom',
        showCountdown: false,
        textAlign: 'right',
        dir: 'rtl',
      }),
      design: buildDefaultDesign({
        gradientEnabled: true,
        gradientFrom: '#eef2ff',
        gradientVia: '#ffffff',
        gradientTo: '#faf5ff',
        gradientAngle: 135,
        backgroundColor: '#f1f5fa',
        textColor: '#0f172a',
        subtitleColor: '#334155',
        accentColor: '#4f46e5',
        iconColor: '#f59e0b',
        ctaBgColor: '#16a34a',
        ctaTextColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#c7d2fe',
        borderRadius: 24,
        shadowStyle: 'clay',
        fontFamily: 'decorative',
        fontSizeDesktop: 20,
        fontSizeMobile: 16,
      }),
      motion: buildDefaultMotion({
        entranceEffect: 'fade',
        transitionDurationMs: 300,
      }),
      behavior: buildDefaultBehavior({
        enabled: heroEnabled,
        pages: ['library'],
        closable: true,
        cooldownHours: 96,
        frequencyMode: 'recurring',
        priority: 85,
      }),
      draft: null,
      createdAt: epochIso,
      updatedAt: epochIso,
    },
    {
      id: 'ad_library_popup',
      name: 'النافذة المنبثقة لإعلان الأداة (Popup Modal)',
      type: 'popup',
      placement: 'overlay_timed',
      status: libStatus,
      isSystemDefault: true,
      systemKey: 'library_popup',
      content: buildDefaultContent({
        badgeText: 'CROVO SPACE',
        title: libTitle,
        subtitle: libSubtitle,
        description:
          'مكتبة حلول تعليمية منظمة تضم 87 فصلًا وأكثر من 600 سؤال في البرمجة والثقافة المالية، بالإضافة إلى أداة تساعدك على إنجاز المهام التعليمية بسرعة وكفاءة.',
        priceText: libPrice,
        mediaType: 'image',
        mediaUrl: libImg,
        ctaText: libCta,
        ctaLink: libLink,
        secondaryCtaText: 'العودة للمكتبة',
        secondaryCtaLink: '#library',
        iconName: 'sparkles',
        templateMode: libTemplate,
        showCountdown: false,
      }),
      design: buildDefaultDesign({
        gradientEnabled: false,
        backgroundColor: '#EEF2F7',
        textColor: '#0f172a',
        subtitleColor: '#4338ca',
        accentColor: '#4f46e5',
        iconColor: '#f59e0b',
        ctaBgColor: '#2563eb',
        ctaTextColor: '#ffffff',
        borderRadius: 28,
        maxWidthPx: 580,
        fontFamily: 'decorative',
      }),
      motion: buildDefaultMotion({
        entranceEffect: 'zoom',
        transitionDurationMs: 260,
      }),
      behavior: buildDefaultBehavior({
        enabled: libEnabled,
        pages: ['library', 'toolDetails', 'reviews'],
        delaySeconds: libDelay,
        cooldownHours: libCooldown,
        closable: true,
        frequencyMode: 'recurring',
        priority: 90,
      }),
      draft: null,
      createdAt: epochIso,
      updatedAt: epochIso,
    },
    {
      id: 'ad_welcome_banner',
      name: 'شريط الترحيب للزوار الجدد (Welcome Banner)',
      type: 'welcome',
      placement: 'hero_above',
      status: 'active',
      isSystemDefault: true,
      systemKey: 'welcome_banner',
      content: buildDefaultContent({
        badgeText: 'تسجيل دخول اختياري',
        title: 'أهلاً بك في عالم CROVO SPACE 🎓',
        subtitle:
          'يمكنك تصفح المكتبة والحلول بحرية تامة، أو إنشاء حساب مجاني لحفظ تقدمك ونقاطك (XP) والمشاركة في الاستفتاءات والتقييمات.',
        ctaText: 'تسجيل الدخول / إنشاء حساب',
        ctaLink: '#auth',
        secondaryCtaText: 'تخطي',
        secondaryCtaLink: '#library',
        iconName: 'sparkles',
      }),
      design: buildDefaultDesign({
        gradientEnabled: true,
        gradientFrom: '#eef2ff',
        gradientVia: '#faf5ff',
        gradientTo: '#ffffff',
        gradientAngle: 270,
        fontSizeDesktop: 15,
        fontSizeMobile: 13,
      }),
      motion: buildDefaultMotion({ entranceEffect: 'slide_down' }),
      behavior: buildDefaultBehavior({
        enabled: true,
        pages: ['library'],
        closable: true,
        frequencyMode: 'once',
        priority: 75,
      }),
      draft: null,
      createdAt: epochIso,
      updatedAt: epochIso,
    },
    {
      id: 'ad_floating_offer',
      name: 'إعلان العرض العائم بالزاوية (Floating Offer)',
      type: 'floating',
      placement: 'floating_corner',
      status: 'paused',
      isSystemDefault: true,
      systemKey: 'floating_offer',
      content: buildDefaultContent({
        badgeText: 'خصم {percent}%',
        title: 'عرض أداة CROVO بـ {price} ج فقط!',
        subtitle: 'وفّر وقتك وخلّص فصول المنصة بضغطة زر.',
        ctaText: 'اشترك الآن',
        ctaLink: '#subscribe',
        iconName: 'zap',
        showCountdown: true,
      }),
      design: buildDefaultDesign({
        gradientEnabled: true,
        gradientFrom: '#4f46e5',
        gradientVia: '#6366f1',
        gradientTo: '#7c3aed',
        gradientAngle: 135,
        backgroundColor: '#4f46e5',
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
        subtitleSizeDesktop: 12,
        subtitleSizeMobile: 11,
        position: 'bottom_left',
      }),
      motion: buildDefaultMotion({
        entranceEffect: 'slide_up',
        ambientEffect: 'soft_pulse',
      }),
      behavior: buildDefaultBehavior({
        enabled: false,
        pages: ['all'],
        delaySeconds: 6,
        cooldownHours: 12,
        closable: true,
        frequencyMode: 'recurring',
        priority: 70,
      }),
      draft: null,
      createdAt: epochIso,
      updatedAt: epochIso,
    },
  ];
}

export function mergeAdUnitsWithDefaults(
  rawAds: unknown,
  legacy?: Parameters<typeof buildDefaultAdUnits>[0]
): AdUnitConfig[] {
  const defaults = buildDefaultAdUnits(legacy);
  if (!Array.isArray(rawAds) || rawAds.length === 0) {
    return defaults;
  }

  const sanitizedIncoming: AdUnitConfig[] = [];
  const seenIds = new Set<string>();
  const defaultsById = new Map(defaults.map((d) => [d.id, d]));

  for (const item of rawAds.slice(0, 40)) {
    if (!item || typeof item !== 'object') continue;
    const rawId = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id.trim() : '';
    const baseDefault = defaultsById.get(rawId);
    const clean = sanitizeAdUnit(item, baseDefault);
    if (seenIds.has(clean.id)) continue;
    seenIds.add(clean.id);
    sanitizedIncoming.push(clean);
  }

  // Ensure all required system default units exist (additive migration without overwriting user edits)
  for (const def of defaults) {
    if (!seenIds.has(def.id)) {
      sanitizedIncoming.push(def);
    }
  }

  return sanitizedIncoming;
}

/**
 * Keep legacy fields (promoBanner, heroPromo, libraryAd) synchronized from the canonical AdUnit list.
 */
export function syncLegacyAdFieldsFromUnits<
  T extends {
    promoBanner: { enabled: boolean; text: string };
    heroPromo: { enabled: boolean; title: string; subtitle: string };
    libraryAd: {
      enabled: boolean;
      title: string;
      subtitle: string;
      priceText: string;
      ctaText: string;
      ctaLink?: string;
      imageUrl?: string;
      delaySeconds?: number;
      cooldownHours?: number;
      templateMode?: 'classic' | 'rich_crovo';
      workflowStatus?: 'draft' | 'preview' | 'approved' | 'published' | 'archived';
      draft?: Record<string, unknown> | null;
    };
  },
>(cfg: T, ads: AdUnitConfig[]): T {
  const topAd = ads.find((a) => a.systemKey === 'top_announcement' || a.id === 'ad_top_announcement');
  const heroAd = ads.find((a) => a.systemKey === 'hero_promo' || a.id === 'ad_hero_promo');
  const libAd = ads.find((a) => a.systemKey === 'library_popup' || a.id === 'ad_library_popup');

  const next = { ...cfg };

  if (topAd) {
    const isActive = topAd.behavior.enabled && topAd.status !== 'paused' && topAd.status !== 'archived' && topAd.status !== 'draft';
    next.promoBanner = {
      enabled: isActive,
      text: topAd.content.title || cfg.promoBanner.text,
    };
  }

  if (heroAd) {
    const isActive = heroAd.behavior.enabled && heroAd.status !== 'paused' && heroAd.status !== 'archived' && heroAd.status !== 'draft';
    next.heroPromo = {
      enabled: isActive,
      title: heroAd.content.title || cfg.heroPromo.title,
      subtitle: heroAd.content.subtitle || cfg.heroPromo.subtitle,
    };
  }

  if (libAd) {
    const isActive = libAd.behavior.enabled && libAd.status !== 'paused' && libAd.status !== 'archived' && libAd.status !== 'draft';
    next.libraryAd = {
      ...cfg.libraryAd,
      enabled: isActive,
      title: libAd.content.title || cfg.libraryAd.title,
      subtitle: libAd.content.subtitle || cfg.libraryAd.subtitle,
      priceText: libAd.content.priceText || cfg.libraryAd.priceText,
      ctaText: libAd.content.ctaText || cfg.libraryAd.ctaText,
      ctaLink: libAd.content.ctaLink || cfg.libraryAd.ctaLink,
      imageUrl: libAd.content.mediaUrl || cfg.libraryAd.imageUrl,
      delaySeconds: libAd.behavior.delaySeconds || cfg.libraryAd.delaySeconds,
      cooldownHours: libAd.behavior.cooldownHours || cfg.libraryAd.cooldownHours,
      templateMode:
        libAd.content.templateMode === 'classic'
          ? 'classic'
          : libAd.content.templateMode === 'rich_crovo'
          ? 'rich_crovo'
          : cfg.libraryAd.templateMode,
      workflowStatus:
        libAd.status === 'archived'
          ? 'archived'
          : libAd.draft
          ? 'draft'
          : isActive
          ? 'published'
          : 'archived',
    };
  }

  return next;
}

/**
 * Sync system AdUnits whenever legacy fields (promoBanner, heroPromo, libraryAd) are updated via legacy API paths.
 */
export function syncUnitsFromLegacyAdFields(
  ads: AdUnitConfig[],
  legacy: {
    promoBanner?: { enabled: boolean; text: string };
    heroPromo?: { enabled: boolean; title: string; subtitle: string };
    libraryAd?: {
      enabled: boolean;
      title: string;
      subtitle: string;
      priceText: string;
      ctaText: string;
      ctaLink?: string;
      imageUrl?: string;
      delaySeconds?: number;
      cooldownHours?: number;
      templateMode?: 'classic' | 'rich_crovo';
      workflowStatus?: string;
    };
  }
): AdUnitConfig[] {
  const nowIso = new Date().toISOString();
  return ads.map((ad) => {
    if ((ad.systemKey === 'top_announcement' || ad.id === 'ad_top_announcement') && legacy.promoBanner) {
      return {
        ...ad,
        status: legacy.promoBanner.enabled ? 'active' : 'paused',
        content: {
          ...ad.content,
          title: legacy.promoBanner.text || ad.content.title,
        },
        behavior: {
          ...ad.behavior,
          enabled: Boolean(legacy.promoBanner.enabled),
        },
        updatedAt: nowIso,
      };
    }

    if ((ad.systemKey === 'hero_promo' || ad.id === 'ad_hero_promo') && legacy.heroPromo) {
      return {
        ...ad,
        status: legacy.heroPromo.enabled ? 'active' : 'paused',
        content: {
          ...ad.content,
          title: legacy.heroPromo.title || ad.content.title,
          subtitle: legacy.heroPromo.subtitle || ad.content.subtitle,
        },
        behavior: {
          ...ad.behavior,
          enabled: Boolean(legacy.heroPromo.enabled),
        },
        updatedAt: nowIso,
      };
    }

    if ((ad.systemKey === 'library_popup' || ad.id === 'ad_library_popup') && legacy.libraryAd) {
      const wf = legacy.libraryAd.workflowStatus;
      const nextStatus: AdStatus =
        wf === 'archived' ? 'archived' : legacy.libraryAd.enabled ? 'active' : 'paused';
      return {
        ...ad,
        status: nextStatus,
        content: {
          ...ad.content,
          title: legacy.libraryAd.title || ad.content.title,
          subtitle: legacy.libraryAd.subtitle || ad.content.subtitle,
          priceText: legacy.libraryAd.priceText || ad.content.priceText,
          ctaText: legacy.libraryAd.ctaText || ad.content.ctaText,
          ctaLink: sanitizeAdLinkUrl(legacy.libraryAd.ctaLink, ad.content.ctaLink),
          mediaUrl: sanitizeAdMediaUrl(legacy.libraryAd.imageUrl, ad.content.mediaUrl),
          templateMode:
            legacy.libraryAd.templateMode === 'classic'
              ? 'classic'
              : legacy.libraryAd.templateMode === 'rich_crovo'
              ? 'rich_crovo'
              : ad.content.templateMode,
        },
        behavior: {
          ...ad.behavior,
          enabled: Boolean(legacy.libraryAd.enabled),
          delaySeconds:
            typeof legacy.libraryAd.delaySeconds === 'number'
              ? legacy.libraryAd.delaySeconds
              : ad.behavior.delaySeconds,
          cooldownHours:
            typeof legacy.libraryAd.cooldownHours === 'number'
              ? legacy.libraryAd.cooldownHours
              : ad.behavior.cooldownHours,
        },
        updatedAt: nowIso,
      };
    }

    return ad;
  });
}

export function resolveAdEffectiveStatus(
  ad: AdUnitConfig,
  nowMs: number = Date.now()
): {
  status: AdStatus;
  label: string;
  badgeClass: string;
  isLive: boolean;
} {
  if (ad.status === 'archived') {
    return { status: 'archived', label: 'مؤرشف', badgeClass: 'bg-slate-200 text-slate-700', isLive: false };
  }
  if (ad.status === 'draft') {
    return { status: 'draft', label: 'مسودة', badgeClass: 'bg-amber-100 text-amber-800', isLive: false };
  }
  if (!ad.behavior.enabled || ad.status === 'paused') {
    return { status: 'paused', label: 'متوقف مؤقتاً', badgeClass: 'bg-rose-100 text-rose-700', isLive: false };
  }

  const startMs = ad.behavior.startAt ? Date.parse(ad.behavior.startAt) : NaN;
  const endMs = ad.behavior.endAt ? Date.parse(ad.behavior.endAt) : NaN;

  if (Number.isFinite(startMs) && nowMs < startMs) {
    return { status: 'scheduled', label: 'مجدول (لم يبدأ)', badgeClass: 'bg-sky-100 text-sky-800', isLive: false };
  }
  if (Number.isFinite(endMs) && nowMs > endMs) {
    return { status: 'archived', label: 'منتهي الصلاحية', badgeClass: 'bg-slate-200 text-slate-600', isLive: false };
  }
  return { status: 'active', label: 'نشط للزوار', badgeClass: 'bg-emerald-100 text-emerald-800', isLive: true };
}

export interface AdImpressionEntry {
  impressions: number;
  lastShownAt: number;
  dismissedAt: number;
}

const AD_IMPRESSIONS_STORAGE_KEY = 'crovo_ad_impressions_v1';

export function loadAdImpressionsMap(): Record<string, AdImpressionEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(AD_IMPRESSIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, AdImpressionEntry>) : {};
  } catch {
    return {};
  }
}

export function getAdImpressionRecord(adId: string): AdImpressionEntry {
  const map = loadAdImpressionsMap();
  return map[adId] || { impressions: 0, lastShownAt: 0, dismissedAt: 0 };
}

export function recordAdImpression(adId: string, nowMs: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    const map = loadAdImpressionsMap();
    const prev = map[adId] || { impressions: 0, lastShownAt: 0, dismissedAt: 0 };
    map[adId] = {
      impressions: prev.impressions + 1,
      lastShownAt: nowMs,
      dismissedAt: prev.dismissedAt,
    };
    window.localStorage.setItem(AD_IMPRESSIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota issues cleanly
  }
}

export function recordAdDismissal(adId: string, nowMs: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    const map = loadAdImpressionsMap();
    const prev = map[adId] || { impressions: 0, lastShownAt: 0, dismissedAt: 0 };
    map[adId] = {
      impressions: prev.impressions,
      lastShownAt: prev.lastShownAt,
      dismissedAt: nowMs,
    };
    window.localStorage.setItem(AD_IMPRESSIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota issues cleanly
  }
}

export function isAdEligibleForContext(params: {
  ad: AdUnitConfig;
  view: 'library' | 'toolDetails' | 'reviews' | 'admin';
  isMobile: boolean;
  nowMs?: number;
  elapsedSeconds?: number;
  impressionRecord?: AdImpressionEntry;
}): boolean {
  const { ad, view, isMobile } = params;
  if (view === 'admin') return false;

  const nowMs = params.nowMs ?? Date.now();
  const statusInfo = resolveAdEffectiveStatus(ad, nowMs);
  if (!statusInfo.isLive) return false;

  // Device check
  if (ad.behavior.deviceTarget === 'mobile' && !isMobile) return false;
  if (ad.behavior.deviceTarget === 'desktop' && isMobile) return false;

  // Page targeting
  const pages = ad.behavior.pages || ['all'];
  if (!pages.includes('all') && !pages.includes(view)) return false;

  // Delay check
  const elapsed = params.elapsedSeconds ?? 0;
  if (ad.behavior.delaySeconds > 0 && elapsed < ad.behavior.delaySeconds) return false;

  // Impressions & frequency
  const rec = params.impressionRecord || { impressions: 0, lastShownAt: 0, dismissedAt: 0 };
  if (ad.behavior.maxDisplays > 0 && rec.impressions >= ad.behavior.maxDisplays) {
    return false;
  }

  if (ad.behavior.frequencyMode === 'once' && (rec.dismissedAt > 0 || rec.impressions > 0)) {
    return false;
  }

  if (ad.behavior.frequencyMode === 'recurring' && rec.dismissedAt > 0) {
    const cooldownMs = Math.max(1, ad.behavior.cooldownHours) * 3600_000;
    if (nowMs - rec.dismissedAt < cooldownMs) {
      return false;
    }
  }

  return true;
}

export function renderDynamicAdText(
  text: string,
  pricing?: {
    qureoOfferPrice?: number;
    qureoOldPrice?: number;
    bundleOfferPrice?: number;
    bundleOldPrice?: number;
  }
): string {
  if (!text) return '';
  const qOffer = pricing?.qureoOfferPrice ?? 50;
  const qOld = pricing?.qureoOldPrice ?? 100;
  const bOffer = pricing?.bundleOfferPrice ?? 100;
  const bOld = pricing?.bundleOldPrice ?? 200;
  const percent =
    qOld > qOffer && qOld > 0 ? Math.round(((qOld - qOffer) / qOld) * 100) : 0;

  return text
    .replace(/\{price\}/g, String(qOffer))
    .replace(/\{old_price\}/g, String(qOld))
    .replace(/\{bundle\}/g, String(bOffer))
    .replace(/\{bundle_old\}/g, String(bOld))
    .replace(/\{percent\}/g, String(percent));
}

export function getAdCardStyle(
  design: AdDesignConfig,
  isMobile: boolean
): React.CSSProperties {
  const bgGradient = design.gradientEnabled
    ? design.gradientVia
      ? `linear-gradient(${design.gradientAngle}deg, ${design.gradientFrom}, ${design.gradientVia}, ${design.gradientTo})`
      : `linear-gradient(${design.gradientAngle}deg, ${design.gradientFrom}, ${design.gradientTo})`
    : design.backgroundColor;

  const shadowMap: Record<AdShadowStyle, string> = {
    none: 'none',
    clay: '10px 10px 22px rgba(178, 191, 212, 0.56), -9px -9px 20px rgba(255, 255, 255, 0.96)',
    soft: '0 8px 24px -6px rgba(15, 23, 42, 0.14)',
    medium: '0 16px 36px -8px rgba(15, 23, 42, 0.24)',
    glow: `0 12px 32px -6px ${design.accentColor}55`,
  };

  return {
    background: bgGradient,
    color: design.textColor,
    opacity: design.opacity,
    borderWidth: `${design.borderWidth}px`,
    borderStyle: design.borderWidth > 0 ? 'solid' : 'none',
    borderColor: design.borderColor,
    borderRadius: `${design.borderRadius}px`,
    boxShadow: shadowMap[design.shadowStyle] || shadowMap.clay,
    paddingLeft: `${isMobile ? design.paddingXMobile : design.paddingXDesktop}px`,
    paddingRight: `${isMobile ? design.paddingXMobile : design.paddingXDesktop}px`,
    paddingTop: `${isMobile ? design.paddingYMobile : design.paddingYDesktop}px`,
    paddingBottom: `${isMobile ? design.paddingYMobile : design.paddingYDesktop}px`,
    marginTop: `${design.marginTop}px`,
    marginBottom: `${design.marginBottom}px`,
    width: isMobile ? design.widthMobile : design.widthDesktop,
    maxWidth: `${design.maxWidthPx}px`,
    minHeight: isMobile
      ? design.heightMobile !== 'auto'
        ? design.heightMobile
        : undefined
      : design.heightDesktop !== 'auto'
      ? design.heightDesktop
      : undefined,
  };
}
