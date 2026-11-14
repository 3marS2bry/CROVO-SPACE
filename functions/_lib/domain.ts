// Edge-compatible domain validation and pricing rules (zero node:* Buffer usage)

export type OrderGrade = 'bac1' | 'bac2';
export type PlatformChoice = 'qureo' | 'financial';
export type QureoSectionChoice = 'java' | 'python';

export interface PricingConfig {
  qureoOfferPrice: number;
  qureoOldPrice: number;
  finOfferPrice: number;
  finOldPrice: number;
  bundleOfferPrice: number;
  bundleOldPrice: number;
  offerEndsAt: string;
  afterOfferMode: 'regular_price' | 'extended_offer';
}

export interface CalculatedOrderPricing {
  oldPrice: number;
  finalPrice: number;
  offerApplied: boolean;
  discountPercent: number;
  platformLabel: string;
  sectionDetails: string;
}

export function isOfferCurrentlyActive(config: PricingConfig, nowMs: number = Date.now()): boolean {
  if (config.afterOfferMode === 'extended_offer') return true;
  const endMs = Date.parse(config.offerEndsAt);
  if (!Number.isFinite(endMs)) return false;
  return nowMs < endMs;
}

export function calculateOrderPricing(
  input: {
    grade: OrderGrade;
    platforms: PlatformChoice[];
    qureoSection?: QureoSectionChoice;
  },
  config: PricingConfig,
  nowMs: number = Date.now()
): CalculatedOrderPricing {
  const uniquePlatforms = Array.from(new Set(input.platforms));
  if (uniquePlatforms.length === 0) {
    throw new Error('لازم تختار منصة واحدة على الأقل.');
  }

  if (input.qureoSection === 'python') {
    throw new Error('قسم Python متاح قريبًا ومش متاح للاشتراك دلوقتي.');
  }

  const hasQureo = uniquePlatforms.includes('qureo');
  const hasFinancial = uniquePlatforms.includes('financial');

  if (input.grade === 'bac1') {
    if (!hasQureo || hasFinancial) {
      throw new Error('أولى بكالوريا متاح لها منصة QUREO فقط.');
    }
  } else if (input.grade !== 'bac2') {
    throw new Error('السنة الدراسية المختارة غير صحيحة.');
  }

  if (hasQureo && input.grade === 'bac2' && input.qureoSection !== 'java') {
    throw new Error('لازم تختار قسم Java المتاح جوه منصة QUREO.');
  }

  let oldPrice = 0;
  let offerPrice = 0;
  let platformLabel = '';
  let sectionDetails = '';

  if (input.grade === 'bac1') {
    oldPrice = config.qureoOldPrice;
    offerPrice = config.qureoOfferPrice;
    platformLabel = 'QUREO';
    sectionDetails = 'منصة QUREO بالكامل للترمين (أولى بكالوريا)';
  } else if (hasQureo && hasFinancial) {
    oldPrice = config.bundleOldPrice;
    offerPrice = config.bundleOfferPrice;
    platformLabel = 'QUREO + ثقافة مالية';
    sectionDetails = 'QUREO (Java) + ثقافة مالية';
  } else if (hasQureo) {
    oldPrice = config.qureoOldPrice;
    offerPrice = config.qureoOfferPrice;
    platformLabel = 'QUREO (Java)';
    sectionDetails = 'Java (متاحة)';
  } else if (hasFinancial) {
    oldPrice = config.finOldPrice;
    offerPrice = config.finOfferPrice;
    platformLabel = 'ثقافة مالية';
    sectionDetails = 'مادة الثقافة المالية بالكامل';
  }

  const offerApplied = isOfferCurrentlyActive(config, nowMs);
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

export interface ValidatedOrderInput {
  fullName: string;
  grade: OrderGrade;
  platforms: PlatformChoice[];
  qureoSection?: QureoSectionChoice;
  platformUsername: string;
  platformPassword: string;
  paymentMethod: string;
  clientRequestId?: string;
}

const ALLOWED_PAYMENT_METHODS = ['محفظة إلكترونية (كاش)', 'كاش', 'فودافون كاش', 'إنستا باي'];

export function validateOrderPayload(raw: Record<string, unknown>): ValidatedOrderInput {
  const fullName = typeof raw.fullName === 'string' ? raw.fullName.trim() : '';
  if (fullName.length < 2 || fullName.length > 100) {
    throw new Error('من فضلك اكتب اسمك بالكامل بشكل صحيح (حرفين على الأقل).');
  }

  const grade = raw.grade;
  if (grade !== 'bac1' && grade !== 'bac2') {
    throw new Error('اختيار السنة الدراسية غير صحيح.');
  }

  if (!Array.isArray(raw.platforms) || raw.platforms.length === 0) {
    throw new Error('لازم تختار المنصة اللي عاوز تشترك فيها.');
  }

  const platforms: PlatformChoice[] = [];
  for (const p of raw.platforms) {
    if (p === 'qureo' || p === 'financial') {
      platforms.push(p);
    } else {
      throw new Error('تم إرسال منصة غير معروفة.');
    }
  }

  const qureoSectionRaw = raw.qureoSection;
  let qureoSection: QureoSectionChoice | undefined;
  if (qureoSectionRaw !== undefined && qureoSectionRaw !== null && qureoSectionRaw !== '') {
    if (qureoSectionRaw === 'python') {
      throw new Error('قسم Python متاح قريبًا وغير متاح حالياً للاشتراك.');
    }
    if (qureoSectionRaw !== 'java') {
      throw new Error('القسم المختار داخل QUREO غير صالح.');
    }
    qureoSection = 'java';
  }

  if (grade === 'bac2' && platforms.includes('qureo') && qureoSection !== 'java') {
    qureoSection = 'java';
  }

  const platformUsername = typeof raw.platformUsername === 'string' ? raw.platformUsername.trim() : '';
  if (platformUsername.length < 2 || platformUsername.length > 120) {
    throw new Error('من فضلك اكتب اسم المستخدم بتاع المنصة بشكل صحيح.');
  }

  const platformPassword = typeof raw.platformPassword === 'string' ? raw.platformPassword : '';
  if (platformPassword.length < 1 || platformPassword.length > 200) {
    throw new Error('من فضلك اكتب كلمة السر بتاعة المنصة.');
  }

  const paymentMethodRaw =
    typeof raw.paymentMethod === 'string' ? raw.paymentMethod.trim() : 'محفظة إلكترونية (كاش)';
  const paymentMethod = ALLOWED_PAYMENT_METHODS.includes(paymentMethodRaw)
    ? paymentMethodRaw
    : 'محفظة إلكترونية (كاش)';

  const clientRequestId =
    typeof raw.clientRequestId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(raw.clientRequestId)
      ? raw.clientRequestId
      : undefined;

  return {
    fullName,
    grade,
    platforms: Array.from(new Set(platforms)),
    qureoSection,
    platformUsername,
    platformPassword,
    paymentMethod,
    clientRequestId,
  };
}

const BLOCKED_WORDS = [
  'كسم',
  'شرموط',
  'متناك',
  'خول',
  'عرص',
  'ابن الوسخة',
  'احا',
  'fuck',
  'bitch',
  'porn',
  'casino',
  'betting',
];

export function checkCommentModeration(text: string): { ok: boolean; reason?: string } {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return { ok: false, reason: 'التعليق فاضي!' };

  for (const word of BLOCKED_WORDS) {
    if (normalized.includes(word)) {
      return { ok: false, reason: 'من فضلك التزم بأسلوب محترم في التعليق بدون ألفاظ مسيئة.' };
    }
  }

  const urlMatches = normalized.match(/https?:\/\/|www\./g);
  if (urlMatches && urlMatches.length > 0) {
    return { ok: false, reason: 'ممنوع إضافة روابط خارجية داخل التعليقات لمنع السبام.' };
  }

  if (/(.)\1{11,}/u.test(normalized)) {
    return { ok: false, reason: 'التعليق فيه تكرار حروف غير طبيعي.' };
  }

  return { ok: true };
}

export interface ValidatedImageData {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  ext: 'png' | 'jpg' | 'webp';
  bytes: Uint8Array;
}

export function validateBase64Image(dataUrl: unknown, maxBytes = 1_500_000): ValidatedImageData | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('صيغة الصورة غير مدعومة. المسموح فقط PNG أو JPG أو WEBP.');
  }

  const mimeType = match[1] as 'image/png' | 'image/jpeg' | 'image/webp';
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error('حجم الصورة كبير جداً. الحد الأقصى للصورة الواحدة 1.5 ميجابايت.');
  }

  if (mimeType === 'image/png') {
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      throw new Error('ملف الصورة PNG غير سليم.');
    }
    return { mimeType, ext: 'png', bytes };
  }
  if (mimeType === 'image/jpeg') {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new Error('ملف الصورة JPG غير سليم.');
    }
    return { mimeType, ext: 'jpg', bytes };
  }
  if (mimeType === 'image/webp') {
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (bytes.length < 12 || riff !== 'RIFF' || webp !== 'WEBP') {
      throw new Error('ملف الصورة WEBP غير سليم.');
    }
    return { mimeType, ext: 'webp', bytes };
  }

  return null;
}

export interface ValidatedCommentInput {
  authorName: string;
  grade: string;
  rating: number;
  content: string;
  contactPhone: string | null;
  showContactPublicly: boolean;
  avatarImage: ValidatedImageData | null;
  attachmentImage: ValidatedImageData | null;
}

const ALLOWED_GRADES = [
  'أولى بكالوريا',
  'تانية بكالوريا',
  'أولى بكالوريا (جافا)',
  'تانية بكالوريا (جافا متقدمة)',
  'تانية بكالوريا - بايثون',
  'تانية بكالوريا - الثقافة المالية',
];

export function validateCommentPayload(raw: Record<string, unknown>): ValidatedCommentInput {
  const authorName = typeof raw.authorName === 'string' ? raw.authorName.trim() : '';
  if (authorName.length < 2 || authorName.length > 60) {
    throw new Error('من فضلك اكتب اسمك (من حرفين لـ 60 حرف).');
  }

  const gradeRaw = typeof raw.grade === 'string' ? raw.grade.trim() : 'أولى بكالوريا';
  const grade = ALLOWED_GRADES.includes(gradeRaw) ? gradeRaw : 'تانية بكالوريا';

  const ratingNum = typeof raw.rating === 'number' ? raw.rating : Number(raw.rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    throw new Error('التقييم لازم يكون من 1 إلى 5 نجوم.');
  }

  const content = typeof raw.content === 'string' ? raw.content.trim() : '';
  if (content.length < 4 || content.length > 600) {
    throw new Error('التعليق لازم يكون بين 4 و 600 حرف.');
  }

  const modCheck = checkCommentModeration(`${authorName} ${content}`);
  if (!modCheck.ok) {
    throw new Error(modCheck.reason || 'المحتوى مرفوض للمخالفة.');
  }

  let contactPhone: string | null = null;
  if (typeof raw.contactPhone === 'string' && raw.contactPhone.trim()) {
    const cleaned = raw.contactPhone.trim().replace(/[\s-]/g, '');
    if (!/^\+?\d{8,15}$/.test(cleaned)) {
      throw new Error('رقم الهاتف غير صحيح. اكتب رقم موبايل صحيح أو اتركه فاضي.');
    }
    contactPhone = cleaned;
  }

  const avatarImage = raw.avatarDataUrl ? validateBase64Image(raw.avatarDataUrl, 1_000_000) : null;
  const attachmentImage = raw.attachmentDataUrl ? validateBase64Image(raw.attachmentDataUrl, 1_500_000) : null;

  return {
    authorName,
    grade,
    rating: ratingNum,
    content,
    contactPhone,
    showContactPublicly: false,
    avatarImage,
    attachmentImage,
  };
}

export interface ValidatedQuestionReport {
  questionKey: string;
  grade: OrderGrade;
  section: 'js' | 'py' | 'fin';
  chapterNum: number;
  qIndex: number;
  questionTitle: string;
  description: string;
}

export function validateQuestionReportPayload(raw: Record<string, unknown>): ValidatedQuestionReport {
  const questionKey = typeof raw.questionKey === 'string' ? raw.questionKey.trim() : '';
  if (!/^[a-zA-Z0-9_-]{4,60}$/.test(questionKey)) {
    throw new Error('معرّف السؤال غير صالح.');
  }

  const grade = raw.grade === 'bac2' ? 'bac2' : raw.grade === 'bac1' ? 'bac1' : null;
  if (!grade) {
    throw new Error('السنة الدراسية غير صالحة.');
  }

  const section = raw.section === 'py' || raw.section === 'fin' ? raw.section : raw.section === 'js' ? 'js' : null;
  if (!section) {
    throw new Error('القسم الدراسي غير صالح.');
  }

  const chapterNum = Number(raw.chapterNum);
  const qIndex = Number(raw.qIndex);
  if (
    !Number.isInteger(chapterNum) ||
    chapterNum < 1 ||
    chapterNum > 200 ||
    !Number.isInteger(qIndex) ||
    qIndex < 0 ||
    qIndex > 500
  ) {
    throw new Error('بيانات رقم الفصل أو السؤال غير صالحة.');
  }

  const questionTitle =
    typeof raw.questionTitle === 'string'
      ? raw.questionTitle.trim().slice(0, 180)
      : `السؤال ${qIndex + 1}`;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (description.length < 5 || description.length > 500) {
    throw new Error('من فضلك اشرح المشكلة في الإجابة بشكل واضح (5 أحرف على الأقل).');
  }

  const modCheck = checkCommentModeration(description);
  if (!modCheck.ok) {
    throw new Error(modCheck.reason || 'الوصف يحتوي على محتوى غير مسموح.');
  }

  return {
    questionKey,
    grade,
    section,
    chapterNum,
    qIndex,
    questionTitle,
    description,
  };
}

export function formatOrderCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const num = 100000 + (arr[0] % 900000);
  return `CRV-${num}`;
}
