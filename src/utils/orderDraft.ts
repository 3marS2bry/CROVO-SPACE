import type { AcademicGrade } from '../types';

export const SUBSCRIPTION_DRAFT_KEY = 'crovo_subscription_draft_v1';
export const POST_WHATSAPP_REVIEW_KEY = 'crovo_post_whatsapp_review_v1';

const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RETURN_REVIEW_MIN_ELAPSED_MS = 15_000;

export type DraftPlatformChoice = 'qureo' | 'financial';

export interface SubscriptionDraft {
  clientRequestId: string;
  orderCode: string;
  grade: AcademicGrade | null;
  selectedPlatforms: DraftPlatformChoice[];
  qureoJavaSelected: boolean;
  fullName: string;
  platformUsername: string;
  paymentMethod: string;
  updatedAt: number;
}

export interface PostWhatsAppReviewState {
  lastOrderCode: string;
  lastOrderId: string;
  grade: AcademicGrade;
  platformLabel: string;
  fullName: string;
  savedToServer: boolean;
  handedOffAt: number;
  dismissedUntil?: number;
  submittedOrderCodes: string[];
}

export function generateStableClientRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    }
  } catch {
    // Fallback below
  }
  const partA = Date.now().toString(36);
  const partB = Math.random().toString(36).slice(2, 12);
  return `req_${partA}${partB}`.slice(0, 32);
}

export function deriveOrderCodeFromRequestId(clientRequestId: string): string {
  const cleaned = clientRequestId.replace(/[^a-zA-Z0-9]/g, '');
  let hash = 2166136261;
  for (let i = 0; i < cleaned.length; i += 1) {
    hash ^= cleaned.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `CRV-${hex.slice(0, 6)}`;
}

export function sanitizeDraftForStorage(
  draft: Partial<SubscriptionDraft> & { platformPassword?: unknown }
): SubscriptionDraft {
  const reqId =
    typeof draft.clientRequestId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(draft.clientRequestId)
      ? draft.clientRequestId
      : generateStableClientRequestId();
  const orderCode =
    typeof draft.orderCode === 'string' && /^CRV-[A-Z0-9]{4,10}$/.test(draft.orderCode)
      ? draft.orderCode
      : deriveOrderCodeFromRequestId(reqId);

  const selectedPlatforms: DraftPlatformChoice[] = Array.isArray(draft.selectedPlatforms)
    ? draft.selectedPlatforms.filter((p): p is DraftPlatformChoice => p === 'qureo' || p === 'financial')
    : [];

  return {
    clientRequestId: reqId,
    orderCode,
    grade: draft.grade === 'bac2' ? 'bac2' : draft.grade === 'bac1' ? 'bac1' : null,
    selectedPlatforms,
    qureoJavaSelected: draft.qureoJavaSelected !== false,
    fullName: typeof draft.fullName === 'string' ? draft.fullName.slice(0, 120) : '',
    platformUsername: typeof draft.platformUsername === 'string' ? draft.platformUsername.slice(0, 160) : '',
    paymentMethod:
      typeof draft.paymentMethod === 'string' && draft.paymentMethod.trim()
        ? draft.paymentMethod.slice(0, 80)
        : 'محفظة إلكترونية (كاش)',
    updatedAt: typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : Date.now(),
  };
}

export function loadSubscriptionDraft(): SubscriptionDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SUBSCRIPTION_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SubscriptionDraft>;
    if (!parsed || typeof parsed !== 'object') return null;
    const age = Date.now() - Number(parsed.updatedAt || 0);
    if (age > DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(SUBSCRIPTION_DRAFT_KEY);
      return null;
    }
    return sanitizeDraftForStorage(parsed);
  } catch {
    return null;
  }
}

export function saveSubscriptionDraft(draft: SubscriptionDraft): void {
  if (typeof window === 'undefined') return;
  try {
    const safe = sanitizeDraftForStorage(draft);
    window.localStorage.setItem(SUBSCRIPTION_DRAFT_KEY, JSON.stringify(safe));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearSubscriptionDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SUBSCRIPTION_DRAFT_KEY);
  } catch {
    // Ignore
  }
}

export function loadPostWhatsAppReviewState(): PostWhatsAppReviewState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(POST_WHATSAPP_REVIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PostWhatsAppReviewState>;
    if (!parsed || typeof parsed !== 'object' || !parsed.lastOrderCode || !parsed.handedOffAt) {
      return null;
    }
    return {
      lastOrderCode: String(parsed.lastOrderCode).slice(0, 40),
      lastOrderId: String(parsed.lastOrderId || parsed.lastOrderCode).slice(0, 80),
      grade: parsed.grade === 'bac2' ? 'bac2' : 'bac1',
      platformLabel: String(parsed.platformLabel || 'QUREO').slice(0, 120),
      fullName: String(parsed.fullName || '').slice(0, 80),
      savedToServer: Boolean(parsed.savedToServer),
      handedOffAt: Number(parsed.handedOffAt),
      dismissedUntil: typeof parsed.dismissedUntil === 'number' ? parsed.dismissedUntil : undefined,
      submittedOrderCodes: Array.isArray(parsed.submittedOrderCodes)
        ? parsed.submittedOrderCodes.map((x) => String(x)).slice(-20)
        : [],
    };
  } catch {
    return null;
  }
}

export function recordWhatsAppHandoffForReview(params: {
  orderCode: string;
  orderId: string;
  grade: AcademicGrade;
  platformLabel: string;
  fullName: string;
  savedToServer: boolean;
}): PostWhatsAppReviewState | null {
  if (typeof window === 'undefined') return null;
  try {
    const prev = loadPostWhatsAppReviewState();
    const submittedOrderCodes = prev?.submittedOrderCodes || [];
    const next: PostWhatsAppReviewState = {
      lastOrderCode: params.orderCode.slice(0, 40),
      lastOrderId: params.orderId.slice(0, 80),
      grade: params.grade,
      platformLabel: params.platformLabel.slice(0, 120),
      fullName: params.fullName.slice(0, 80),
      savedToServer: params.savedToServer,
      handedOffAt: Date.now(),
      submittedOrderCodes,
    };
    window.localStorage.setItem(POST_WHATSAPP_REVIEW_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

export function dismissPostWhatsAppReview(cooldownMs = 12 * 60 * 60 * 1000): void {
  if (typeof window === 'undefined') return;
  try {
    const cur = loadPostWhatsAppReviewState();
    if (!cur) return;
    cur.dismissedUntil = Date.now() + cooldownMs;
    window.localStorage.setItem(POST_WHATSAPP_REVIEW_KEY, JSON.stringify(cur));
  } catch {
    // Ignore
  }
}

export function markPostWhatsAppReviewSubmitted(orderCode: string): void {
  if (typeof window === 'undefined') return;
  try {
    const cur = loadPostWhatsAppReviewState();
    if (!cur) return;
    if (!cur.submittedOrderCodes.includes(orderCode)) {
      cur.submittedOrderCodes.push(orderCode);
    }
    cur.dismissedUntil = Date.now() + 365 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(POST_WHATSAPP_REVIEW_KEY, JSON.stringify(cur));
  } catch {
    // Ignore
  }
}

export function isEligibleForReturnReviewPrompt(
  state: PostWhatsAppReviewState | null,
  now = Date.now(),
  minElapsedMs = RETURN_REVIEW_MIN_ELAPSED_MS
): boolean {
  if (!state) return false;
  if (state.submittedOrderCodes.includes(state.lastOrderCode)) return false;
  if (state.dismissedUntil && now < state.dismissedUntil) return false;
  if (now - state.handedOffAt < minElapsedMs) return false;
  return true;
}

export function sanitizeWhatsappNumber(raw: string | undefined | null): string {
  const digits = String(raw || '201550324450').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) {
    return `2${digits}`;
  }
  return digits.length >= 8 ? digits : '201550324450';
}

export function buildSubscriptionMessageUrl(params: {
  channel: 'whatsapp' | 'telegram';
  whatsappNumber: string;
  orderCode: string;
  fullName: string;
  grade: AcademicGrade;
  platformLabel: string;
  sectionDetails?: string;
  platformUsername: string;
  platformPassword?: string;
  oldPrice: number;
  finalPrice: number;
  offerApplied: boolean;
  paymentMethod: string;
  manualConfirmationNeeded?: boolean;
}): string {
  const gradeLabel = params.grade === 'bac1' ? 'أولى بكالوريا' : 'تانية بكالوريا';
  const sectionText = params.sectionDetails || 'المنصة كاملة';
  const passText = params.platformPassword && params.platformPassword.trim() ? params.platformPassword.trim() : 'غير مسجلة';
  const oldPriceText = `${params.oldPrice}`;
  const finalPriceText = `${params.finalPrice}`;

  const messageLines = [
    `━━━ 𝐂𝐑𝐎𝐕𝐎 𝐒𝐏𝐀𝐂𝐄 ━━━`,
    ``,
    `𝐍𝐄𝐖 𝐎𝐑𝐃𝐄𝐑 | طلب اشتراك`,
    ``,
    `السلام عليكم، عاوز أشترك معاك يخويااا.`,
    ``,
    `✦ بيانات العميل`,
    `• الاسم: \`${params.fullName.trim()}\``,
    `• السنة: \`${gradeLabel}\``,
    `• المنصة: \`${params.platformLabel}\``,
    `• القسم: \`${sectionText}\``,
    ``,
    `✦ بيانات المنصة`,
    `• اليوزر: \`${params.platformUsername.trim()}\``,
    `• الباسورد: \`${passText}\``,
    ``,
    `✦ تفاصيل الطلب`,
    `• قبل الخصم: \`${oldPriceText}\` ج`,
    `• بعد الخصم: \`${finalPriceText}\` ج`,
    `• الدفع: ${params.paymentMethod}`,
    ``,
    `✪ رقم الطلب: \`#${params.orderCode}\``,
    ``,
    `• ♕ 𝑶𝒎𝒂𝒓 𝑺𝒂𝒃𝒓𝒚`,
    `✪ 𝐂𝐑𝐎𝐕𝐎 𝐒𝐏𝐀𝐂𝐄`,
  ];

  if (params.manualConfirmationNeeded) {
    messageLines.push(``, `ملاحظة: الطلب بانتظار التسجيل والتأكيد اليدوي من الإدارة.`);
  }

  const text = messageLines.join('\n');
  if (params.channel === 'telegram') {
    return `https://t.me/omarsaabry?text=${encodeURIComponent(text)}`;
  } else {
    const waNum = sanitizeWhatsappNumber(params.whatsappNumber);
    return `https://wa.me/${waNum}?text=${encodeURIComponent(text)}`;
  }
}

export function buildSubscriptionWhatsappUrl(params: {
  whatsappNumber: string;
  orderCode: string;
  fullName: string;
  grade: AcademicGrade;
  platformLabel: string;
  sectionDetails?: string;
  platformUsername: string;
  platformPassword?: string;
  oldPrice: number;
  finalPrice: number;
  offerApplied: boolean;
  paymentMethod: string;
  manualConfirmationNeeded?: boolean;
}): string {
  return buildSubscriptionMessageUrl({ channel: 'whatsapp', ...params });
}
