import { Chapter, AcademicGrade, QuestionItem, SectionType } from '../types';

export type OrderGrade = 'bac1' | 'bac2';
export type PlatformChoice = 'qureo' | 'financial';
export type QureoSectionChoice = 'java' | 'python';
export type QuestionFilterMode = 'all' | 'code' | 'text' | 'uncopied';
export type QuestionSortMode = 'original' | 'mostCopied' | 'uncompletedFirst';

export interface ClientPricingConfig {
  qureoOfferPrice: number;
  qureoOldPrice: number;
  finOfferPrice: number;
  finOldPrice: number;
  bundleOfferPrice: number;
  bundleOldPrice: number;
  offerEndsAt: string;
  afterOfferMode: 'regular_price' | 'extended_offer';
  offerActive?: boolean;
}

export interface LibraryQuestionEntry {
  chapterIdx: number;
  chapterNum: number;
  qIdx: number;
  question: QuestionItem;
  questionKey: string;
  copyCount: number;
  isCompleted: boolean;
}

/**
 * Build deterministic canonical key for a question card.
 */
export function buildQuestionKey(
  grade: AcademicGrade,
  section: SectionType,
  chapterIdx: number,
  qIdx: number
): string {
  return `${grade}-${section}-${chapterIdx}-${qIdx}`;
}

/**
 * Filter chapters by academic grade:
 * - Bac 1: Exactly 42 levels of programming (Java)
 * - Bac 2: Levels up to 54
 */
export function filterChaptersByGrade(chapters: Chapter[], grade: AcademicGrade): Chapter[] {
  if (grade === 'bac1') {
    return chapters.filter((c) => c.num <= 42);
  }
  return chapters;
}

/**
 * Compute real totals for the current subject/grade.
 */
export function getLibrarySectionTotals(chapters: Chapter[]): {
  totalChapters: number;
  totalQuestions: number;
} {
  let totalQuestions = 0;
  for (const ch of chapters) {
    totalQuestions += ch.qs.length;
  }
  return {
    totalChapters: chapters.length,
    totalQuestions,
  };
}

/**
 * Pure search, filter, and sort helper for library questions without altering original data.
 */
export function filterAndSortLibraryQuestions(params: {
  chapters: Chapter[];
  grade: AcademicGrade;
  section: SectionType;
  activeChapterIdx: number;
  searchQuery: string;
  searchAllChapters: boolean;
  filterMode: QuestionFilterMode;
  sortMode: QuestionSortMode;
  copyCounts: Record<string, number>;
  completedQuestions: Record<string, boolean>;
}): LibraryQuestionEntry[] {
  const query = params.searchQuery.trim().toLowerCase();
  const useAllChapters = params.searchAllChapters && query.length > 0;
  const entries: LibraryQuestionEntry[] = [];

  const targetChapters = useAllChapters
    ? params.chapters.map((ch, idx) => ({ ch, idx }))
    : params.chapters[params.activeChapterIdx]
    ? [{ ch: params.chapters[params.activeChapterIdx], idx: params.activeChapterIdx }]
    : [];

  for (const { ch, idx } of targetChapters) {
    ch.qs.forEach((question, qIdx) => {
      const questionKey = buildQuestionKey(params.grade, params.section, idx, qIdx);
      const copyCount = params.copyCounts[questionKey] || 0;
      const isCompleted = Boolean(params.completedQuestions[questionKey]);

      if (params.filterMode === 'code' && !question.code) return;
      if (params.filterMode === 'text' && question.code) return;
      if (params.filterMode === 'uncopied' && isCompleted) return;

      if (query) {
        const chapterLabel =
          params.section === 'js' ? `المستوى ${ch.num}` : `الفصل ${ch.num}`;
        const haystack = `${question.q} ${question.a} ${chapterLabel} ${ch.num}`.toLowerCase();
        if (!haystack.includes(query)) return;
      }

      entries.push({
        chapterIdx: idx,
        chapterNum: ch.num,
        qIdx,
        question,
        questionKey,
        copyCount,
        isCompleted,
      });
    });
  }

  if (params.sortMode === 'mostCopied') {
    entries.sort((a, b) => {
      if (b.copyCount !== a.copyCount) return b.copyCount - a.copyCount;
      if (a.chapterIdx !== b.chapterIdx) return a.chapterIdx - b.chapterIdx;
      return a.qIdx - b.qIdx;
    });
  } else if (params.sortMode === 'uncompletedFirst') {
    entries.sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
      if (a.chapterIdx !== b.chapterIdx) return a.chapterIdx - b.chapterIdx;
      return a.qIdx - b.qIdx;
    });
  }

  return entries;
}

/**
 * Positive-only review filter helper.
 */
export function isApprovedReview(rating: number): boolean {
  return typeof rating === 'number' && rating >= 4 && rating <= 5;
}

/**
 * Real like counter toggle math helper.
 */
export function toggleLikeCount(currentLikes: number, wasLiked: boolean): { nextCount: number; nextLiked: boolean } {
  if (!wasLiked) {
    return { nextCount: currentLikes + 1, nextLiked: true };
  }
  return { nextCount: Math.max(0, currentLikes - 1), nextLiked: false };
}

export const LIBRARY_AD_DELAY_MS = 60_000;
export const LIBRARY_AD_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Timed library popup modal checks:
 * - Enabled by admin config
 * - Not in admin view and no other modal currently open
 * - Outside 24-hour cooldown since last dismissal
 */
export function shouldShowTimedLibraryAd(params: {
  enabled: boolean;
  isAdminView: boolean;
  hasOtherModalOpen: boolean;
  lastDismissedAtMs: number | null;
  cooldownHours?: number;
  nowMs?: number;
}): boolean {
  if (!params.enabled || params.isAdminView || params.hasOtherModalOpen) {
    return false;
  }
  const now = params.nowMs ?? Date.now();
  const cooldownMs =
    typeof params.cooldownHours === 'number' && params.cooldownHours > 0
      ? params.cooldownHours * 60 * 60 * 1000
      : LIBRARY_AD_COOLDOWN_MS;
  if (
    params.lastDismissedAtMs !== null &&
    Number.isFinite(params.lastDismissedAtMs) &&
    now - params.lastDismissedAtMs < cooldownMs
  ) {
    return false;
  }
  return true;
}

/**
 * Legacy milestone check retained for copy count milestones (5, 10, 15, ...).
 */
export function isLibraryAdTrigger(copyCount: number): boolean {
  return copyCount > 0 && copyCount % 5 === 0;
}

export function isOfferActiveClient(config: ClientPricingConfig, nowMs: number = Date.now()): boolean {
  if (config.afterOfferMode === 'extended_offer') return true;
  const endMs = Date.parse(config.offerEndsAt);
  if (!Number.isFinite(endMs)) return false;
  return nowMs < endMs;
}

export function calculateClientPricing(
  input: {
    grade: OrderGrade;
    platforms: PlatformChoice[];
    qureoSection?: QureoSectionChoice;
  },
  config: ClientPricingConfig,
  nowMs: number = Date.now()
): {
  oldPrice: number;
  finalPrice: number;
  offerApplied: boolean;
  discountPercent: number;
  platformLabel: string;
  sectionDetails: string;
} {
  const unique = Array.from(new Set(input.platforms));
  if (unique.length === 0) {
    return {
      oldPrice: 0,
      finalPrice: 0,
      offerApplied: false,
      discountPercent: 0,
      platformLabel: '',
      sectionDetails: '',
    };
  }

  const hasQureo = unique.includes('qureo');
  const hasFinancial = unique.includes('financial');

  let oldPrice = 0;
  let offerPrice = 0;
  let platformLabel = '';
  let sectionDetails = '';

  if (input.grade === 'bac1') {
    oldPrice = config.qureoOldPrice;
    offerPrice = config.qureoOfferPrice;
    platformLabel = 'QUREO';
    sectionDetails = 'منصة QUREO بالكامل للترمين';
  } else if (hasQureo && hasFinancial) {
    oldPrice = config.bundleOldPrice;
    offerPrice = config.bundleOfferPrice;
    platformLabel = 'QUREO + ثقافة مالية';
    sectionDetails = 'QUREO (Java) + ثقافة مالية';
  } else if (hasQureo) {
    oldPrice = config.qureoOldPrice;
    offerPrice = config.qureoOfferPrice;
    platformLabel = 'QUREO (Java)';
    sectionDetails = 'Java';
  } else if (hasFinancial) {
    oldPrice = config.finOldPrice;
    offerPrice = config.finOfferPrice;
    platformLabel = 'ثقافة مالية';
    sectionDetails = 'مادة الثقافة المالية';
  }

  const offerApplied = isOfferActiveClient(config, nowMs);
  const finalPrice = offerApplied ? offerPrice : oldPrice;
  const discountPercent =
    offerApplied && oldPrice > finalPrice
      ? Math.round(((oldPrice - finalPrice) / oldPrice) * 100)
      : 0;

  return {
    oldPrice,
    finalPrice,
    offerApplied,
    discountPercent,
    platformLabel,
    sectionDetails,
  };
}

export function calculateDiscountPercent(oldPrice: number, offerPrice: number): number {
  if (!Number.isFinite(oldPrice) || !Number.isFinite(offerPrice) || oldPrice <= offerPrice || oldPrice <= 0) {
    return 0;
  }
  return Math.round(((oldPrice - offerPrice) / oldPrice) * 100);
}

export function buildClientWhatsappMessage(order: {
  fullName: string;
  grade: OrderGrade;
  platformLabel: string;
  sectionDetails?: string;
  platformUsername?: string;
  platformPassword?: string;
  oldPrice: number;
  finalPrice: number;
  paymentMethod: string;
  orderCode: string;
}): string {
  const gradeLabel = order.grade === 'bac1' ? 'أولى بكالوريا' : 'تانية بكالوريا';
  const cleanSection = (order.sectionDetails || '').trim();
  const cleanUser = (order.platformUsername || '').trim();
  const cleanPass = (order.platformPassword || '').trim();
  const cleanCode = order.orderCode.replace(/^#/, '');

  const lines: string[] = [
    '━━━ 𝐂𝐑𝐎𝐕𝐎 𝐒𝐏𝐀𝐂𝐄 ━━━',
    '',
    '𝐍𝐄𝐖 𝐎𝐑𝐃𝐄𝐑 | طلب اشتراك',
    '',
    'السلام عليكم، عاوز أشترك معاك يخويااا.',
    '',
    '✦ بيانات العميل',
    `• الاسم: ${order.fullName.trim()}`,
    `• السنة: ${gradeLabel}`,
    `• المنصة: ${order.platformLabel.trim()}`,
  ];

  if (cleanSection) {
    lines.push(`• القسم: ${cleanSection}`);
  }

  if (cleanUser || cleanPass) {
    lines.push('', '✦ بيانات المنصة');
    if (cleanUser) lines.push(`• اليوزر: ${cleanUser}`);
    if (cleanPass) lines.push(`• الباسورد: ${cleanPass}`);
  }

  lines.push(
    '',
    '✦ تفاصيل الطلب',
    `• قبل الخصم: ${order.oldPrice} ج`,
    `• بعد الخصم: ${order.finalPrice} ج`,
    `• الدفع: ${order.paymentMethod.trim() || 'محفظة إلكترونية (كاش)'}`,
    '',
    `✪ رقم الطلب: #${cleanCode}`,
    '',
    '• ♕ 𝑶𝒎𝒂𝒓 𝑺𝒂𝒃𝒓𝒚',
    '✪ 𝐂𝐑𝐎𝐕𝐎 𝐒𝐏𝐀𝐂𝐄'
  );

  return lines.join('\n');
}

export function buildClientWhatsappUrl(
  adminPhone: string,
  order: {
    fullName: string;
    grade: OrderGrade;
    platformLabel: string;
    sectionDetails?: string;
    platformUsername?: string;
    platformPassword?: string;
    oldPrice: number;
    finalPrice: number;
    paymentMethod: string;
    orderCode: string;
  }
): string {
  const cleanPhone = adminPhone.replace(/[^\d]/g, '') || '201550324450';
  const message = buildClientWhatsappMessage(order);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

export function formatCountdownParts(targetIso: string, nowMs: number): {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs) || nowMs >= targetMs) {
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const diffSec = Math.floor((targetMs - nowMs) / 1000);
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;
  return { expired: false, days, hours, minutes, seconds };
}
