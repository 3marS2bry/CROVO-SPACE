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

export type AdWorkflowStatus = 'draft' | 'preview' | 'approved' | 'published' | 'archived';

export interface LibraryAdDraftConfig {
  title: string;
  subtitle: string;
  priceText: string;
  ctaText: string;
  ctaLink?: string;
  imageUrl?: string;
  delaySeconds?: number;
  cooldownHours?: number;
  templateMode?: 'classic' | 'rich_crovo';
  workflowStatus: AdWorkflowStatus;
  updatedAt?: string;
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
    workflowStatus?: AdWorkflowStatus;
    draft?: LibraryAdDraftConfig | null;
  };
  toolServices: ToolServiceConfig[];
  toolVideos: ToolVideoConfig[];
  trackingStartedAt: string;
}

export const DEFAULT_TOOL_SERVICES: ToolServiceConfig[] = [
  {
    key: 'bac1_qureo',
    name: 'دعم وتنفيذ منصة QUREO (أولى بكالوريا)',
    grade: 'أولى بكالوريا',
    description: 'تغطية منظمة لمستويات الجافا في الترمين مع مراجعة الحلول خطوة بخطوة.',
    isVisible: true,
  },
  {
    key: 'bac2_qureo_java',
    name: 'دعم وتنفيذ QUREO قسم Java (تانية بكالوريا)',
    grade: 'تانية بكالوريا',
    description: 'مساعدة شاملة في فصول الجافا المتقدمة وتطبيقات المنصة المقررة.',
    isVisible: true,
  },
  {
    key: 'bac2_financial',
    name: 'إجابات ودعم الثقافة المالية (تانية بكالوريا)',
    grade: 'تانية بكالوريا',
    description: 'تنظيم ومراجعة الأسئلة والتدريبات النظرية الخاصة بالمنهج.',
    isVisible: true,
  },
  {
    key: 'bac2_bundle',
    name: 'باقة المنصتين (QUREO Java + الثقافة المالية)',
    grade: 'تانية بكالوريا',
    description: 'باقة الاشتراك الشاملة لطلاب تانية بكالوريا مع توفير مقارنة بالاشتراك الفردي.',
    isVisible: true,
  },
];

export const DEFAULT_TOOL_VIDEOS: ToolVideoConfig[] = [
  {
    id: 'vid_1',
    tag: 'أولى وتانية بكالوريا',
    title: 'استعراض آلية عمل أداة CROVO',
    description: 'عرض عملي لخطوات إدخال الحلول ومتابعة التقدم داخل واجهة المنصة.',
    src: '/media/videos/VID-20261031-WA0034.mp4',
    visible: true,
  },
  {
    id: 'vid_2',
    tag: 'تجربة عملية',
    title: 'خطوات استخدام المنصة والمكتبة',
    description: 'فيديو توضيحي يبيّن طريقة تنظيم الدروس والنسخ السريع للإجابات.',
    src: '/media/videos/VID-20261021-WA0025(1).mp4',
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
    offerText: 'خصم لفترة محدودة على باقات المساعدة والاشتراك في CROVO SPACE!',
    notificationsEnabled: true,
    notificationsIntervalDays: 3,
    heroPromo: {
      enabled: true,
      title: 'أداة CROVO ومكتبة الحلول الموثوقة لطلاب البكالوريا',
      subtitle: 'إجابات منظمة ومحدثة + خدمة اشتراك ميسّرة عبر واتساب.',
    },
    promoBanner: {
      enabled: true,
      text: 'العرض متاح الآن لفترة محدودة — اشترك قبل انتهاء العداد!',
    },
    libraryAd: {
      enabled: true,
      title: 'تحتاج مساعدة منظمة لإنهاء دروس المنصة بسرعة؟',
      subtitle: 'أداة CROVO متوفرة للاشتراك الميسّر مع متابعة مباشرة وتأكيد يدوي عبر واتساب.',
      priceText: 'ابتداءً من 50 ج بدلاً من 100 ج',
      ctaText: 'اشترك الآن في الأداة',
      ctaLink: '/#order-section',
      delaySeconds: 18,
      cooldownHours: 24,
      templateMode: 'rich_crovo',
      workflowStatus: 'published',
      draft: null,
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
