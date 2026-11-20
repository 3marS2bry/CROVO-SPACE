import {
  chaptersBac1Js,
  chaptersFin,
  chaptersJs,
  chaptersPy,
} from '../../src/data/chaptersData.ts';
import type { Chapter } from '../../src/types/index.ts';

export interface ToolVideoConfig {
  id: string;
  tag: string;
  title: string;
  description: string;
  src: string;
  visible: boolean;
}

export interface ToolServiceConfig {
  key: string;
  name: string;
  grade: string;
  description: string;
  isVisible: boolean;
}

export interface PublicSiteConfig {
  id: 'public';
  qureoOldPrice: number;
  qureoOfferPrice: number;
  finOldPrice: number;
  finOfferPrice: number;
  bundleOldPrice: number;
  bundleOfferPrice: number;
  offerDurationHours: number;
  offerEndsAt: string;
  afterOfferMode: 'regular_price' | 'extended_offer';
  ordersEnabled: boolean;
  pollClosed: boolean;
  whatsappNumber: string;
  adminWhatsappDisplay: string;
  offerText: string;
  notificationsEnabled: boolean;
  notificationsIntervalDays: number;
  heroPromo: {
    enabled: boolean;
    title: string;
    subtitle: string;
  };
  promoBanner: {
    enabled: boolean;
    text: string;
  };
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
  };
  toolServices: ToolServiceConfig[];
  toolVideos: ToolVideoConfig[];
  trackingStartedAt: string;
}

export const DEFAULT_TOOL_SERVICES: ToolServiceConfig[] = [
  {
    key: 'bac1_qureo',
    name: 'حل منصة QUREO بالكامل (أولى بكالوريا)',
    grade: 'أولى بكالوريا',
    description: 'إنهاء جميع مستويات الترمين بدقة 100% ومحاكاة بشرية كاملة.',
    isVisible: true,
  },
  {
    key: 'bac2_qureo_java',
    name: 'حل منصة QUREO قسم Java (تانية بكالوريا)',
    grade: 'تانية بكالوريا',
    description: 'حل جميع فصول ومستويات الجافا المتقدمة في دقائق.',
    isVisible: true,
  },
  {
    key: 'bac2_financial',
    name: 'حل منصة الثقافة المالية (تانية بكالوريا)',
    grade: 'تانية بكالوريا',
    description: 'حل الأسئلة والاختبارات النظرية بدقة كاملة.',
    isVisible: true,
  },
  {
    key: 'bac2_bundle',
    name: 'باقة المنصتين (QUREO Java + الثقافة المالية)',
    grade: 'تانية بكالوريا',
    description: 'الباقة الشاملة بتوفير إضافي لتانية بكالوريا.',
    isVisible: true,
  },
];

export const DEFAULT_TOOL_VIDEOS: ToolVideoConfig[] = [
  {
    id: 'vid_1',
    tag: 'أولى وتانية بكالوريا',
    title: 'أداء الأداة السريع والمحاكي للبشر',
    description: 'شاهد تنفيذ الحلول داخل المنصة بسرعة وخطوات طبيعية تماماً.',
    src: '/media/videos/crovo-demo-1.mp4',
    visible: true,
  },
  {
    id: 'vid_2',
    tag: 'النتائج النهائية',
    title: 'إتمام المستويات بنسبة 100%',
    description: 'مراجعة نهائية تؤكد إكمال الأسئلة والاختبارات بدون أخطاء.',
    src: '/media/videos/crovo-demo-2.mp4',
    visible: true,
  },
];

export function buildDefaultSiteConfig(whatsappFallback = '201550324450'): PublicSiteConfig {
  const cleanPhone = (whatsappFallback || '201550324450').replace(/\D/g, '') || '201550324450';
  return {
    id: 'public',
    qureoOldPrice: 100,
    qureoOfferPrice: 50,
    finOldPrice: 100,
    finOfferPrice: 50,
    bundleOldPrice: 200,
    bundleOfferPrice: 100,
    offerDurationHours: 48,
    offerEndsAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
    afterOfferMode: 'regular_price',
    ordersEnabled: true,
    pollClosed: false,
    whatsappNumber: cleanPhone,
    adminWhatsappDisplay: cleanPhone,
    offerText: 'خصم 50% لفترة محدودة على باقات حل المنصات!',
    notificationsEnabled: true,
    notificationsIntervalDays: 3,
    heroPromo: {
      enabled: true,
      title: 'أداة CROVO لحل منصات البكالوريا تلقائياً',
      subtitle: 'وفر وقتك ومجهودك — محاكاة بشرية 100% وبسرعة فائقة.',
    },
    promoBanner: {
      enabled: true,
      text: 'عرض الـ50% متاح الآن لفترة محدودة — اشترك قبل انتهاء العداد!',
    },
    libraryAd: {
      enabled: true,
      title: 'زهقت من الحل اليدوي؟ خلّص المنصة في 4 دقايق!',
      subtitle: 'أداة CROVO هتحل لك منصة QUREO والثقافة المالية بالكامل بمحاكاة بشرية آمنة 100%.',
      priceText: 'ابتداءً من 50 ج بدلاً من 100 ج (خصم 50%)',
      ctaText: 'اشترك الآن في الأداة',
      ctaLink: '/#order-section',
      delaySeconds: 18,
      cooldownHours: 24,
      templateMode: 'rich_crovo',
    },
    toolServices: DEFAULT_TOOL_SERVICES,
    toolVideos: DEFAULT_TOOL_VIDEOS,
    trackingStartedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  };
}

export function getBundledChapters(
  grade: 'bac1' | 'bac2',
  section: 'js' | 'py' | 'fin'
): Chapter[] {
  if (grade === 'bac1') {
    return chaptersBac1Js;
  }
  if (section === 'py') return chaptersPy;
  if (section === 'fin') return chaptersFin;
  return chaptersJs;
}

export function getChapterSectionDefaultTitle(
  grade: 'bac1' | 'bac2',
  section: 'js' | 'py' | 'fin',
  num: number
): string {
  if (section === 'fin') return `الفصل ${num} — الثقافة المالية`;
  if (section === 'py') return `المستوى ${num} — Python`;
  return `المستوى ${num} — ${grade === 'bac1' ? 'أولى بكالوريا Java' : 'تانية بكالوريا Java'}`;
}
