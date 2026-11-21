export type ApiErrorCategory =
  | 'quota_exceeded'
  | 'rate_limited'
  | 'permission_denied'
  | 'unauthorized'
  | 'conflict'
  | 'validation_error'
  | 'server_error'
  | 'network_error'
  | 'timeout_error'
  | 'unknown';

export type ApiErrorKind = ApiErrorCategory;

export interface ClassifiedApiError {
  category: ApiErrorCategory;
  kind: ApiErrorCategory;
  status: number;
  retryable: boolean;
  isQuota: boolean;
  userMessageAr: string;
  userMessage: string;
  technicalDetail: string;
}

function readErrorProps(
  errOrStatus: unknown,
  optionalMessage?: string
): {
  status: number;
  code: string;
  name: string;
  message: string;
} {
  if (typeof errOrStatus === 'number') {
    return {
      status: Number.isFinite(errOrStatus) ? errOrStatus : 0,
      code: '',
      name: errOrStatus === 408 ? 'AbortError' : '',
      message: typeof optionalMessage === 'string' ? optionalMessage.trim() : '',
    };
  }
  if (!errOrStatus || typeof errOrStatus !== 'object') {
    return {
      status: 0,
      code: '',
      name: '',
      message: typeof errOrStatus === 'string' ? errOrStatus : optionalMessage || '',
    };
  }
  const obj = errOrStatus as Record<string, unknown>;
  const status = typeof obj.status === 'number' && Number.isFinite(obj.status) ? obj.status : 0;
  const code = typeof obj.code === 'string' ? obj.code.trim().toLowerCase() : '';
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const message =
    typeof obj.message === 'string' ? obj.message.trim() : typeof optionalMessage === 'string' ? optionalMessage.trim() : '';
  return { status, code, name, message };
}

export function isQuotaExceededError(errOrStatus: unknown, optionalMessage?: string): boolean {
  const { status, code, message } = readErrorProps(errOrStatus, optionalMessage);
  if (code === 'quota_exceeded' || code === 'resource_exhausted' || code === 'resource-exhausted') {
    return true;
  }
  if (/quota|resource_exhausted|resource-exhausted|الحصة اليومية|تجاوز الحصة/i.test(message)) {
    return true;
  }
  if (status === 429 && !/محاولات|rate|انتظر/i.test(message)) {
    return true;
  }
  return false;
}

function makeClassified(
  category: ApiErrorCategory,
  status: number,
  retryable: boolean,
  isQuota: boolean,
  userMessageAr: string,
  technicalDetail: string
): ClassifiedApiError {
  return {
    category,
    kind: category,
    status,
    retryable,
    isQuota,
    userMessageAr,
    userMessage: userMessageAr,
    technicalDetail,
  };
}

export function classifyApiError(errOrStatus: unknown, optionalMessage?: string): ClassifiedApiError {
  const { status, code, name, message } = readErrorProps(errOrStatus, optionalMessage);
  const technicalDetail = message || name || (status ? `HTTP ${status}` : 'Unknown error');

  if (isQuotaExceededError(errOrStatus, optionalMessage)) {
    return makeClassified(
      'quota_exceeded',
      status || 429,
      false,
      true,
      'خدمة الحفظ التلقائي مزدحمة حالياً (تم تجاوز الحصة اليومية لـ Firestore)، لكن بياناتك محفوظة مؤقتاً ويمكنك المتابعة إلى واتساب مباشرة.',
      technicalDetail
    );
  }

  if (status === 429 || code === 'rate_limited') {
    return makeClassified(
      'rate_limited',
      429,
      false,
      false,
      message || 'تم إرسال طلبات كثيرة في وقت قصير. انتظر لحظة ثم حاول مجدداً.',
      technicalDetail
    );
  }

  if (
    name === 'AbortError' ||
    code === 'timeout' ||
    status === 408 ||
    /timed?\s*out|timeout|مهلة الاتصال|انتهى وقت/i.test(message)
  ) {
    return makeClassified(
      'timeout_error',
      status || 408,
      true,
      false,
      'استغرق الخادم وقتاً أطول من المعتاد. تحقّق من الاتصال أو أكمل مباشرة عبر واتساب.',
      technicalDetail
    );
  }

  if (
    status === 0 &&
    (/failed to fetch|network|offline|load failed|fetch|dns|connection/i.test(message) ||
      name === 'TypeError')
  ) {
    return makeClassified(
      'network_error',
      0,
      true,
      false,
      'تعذر الاتصال بالخادم حالياً. تأكد من الإنترنت أو أكمل عبر واتساب مباشرة.',
      technicalDetail
    );
  }

  if (status === 403) {
    return makeClassified(
      'permission_denied',
      403,
      false,
      false,
      message || 'غير مسموح بتنفيذ هذه العملية بهذا الحساب.',
      technicalDetail
    );
  }

  if (status === 401) {
    return makeClassified(
      'unauthorized',
      401,
      false,
      false,
      message || 'انتهت جلسة الدخول. أعد تسجيل الدخول للمتابعة.',
      technicalDetail
    );
  }

  if (status === 409) {
    return makeClassified(
      'conflict',
      409,
      false,
      false,
      message || 'تم تحديث هذا الطلب مسبقاً أو العملية مكررة.',
      technicalDetail
    );
  }

  if (status >= 400 && status < 500) {
    return makeClassified(
      'validation_error',
      status,
      false,
      false,
      message || 'يرجى مراجعة البيانات المدخلة والمحاولة مرة أخرى.',
      technicalDetail
    );
  }

  if (status >= 500) {
    return makeClassified(
      'server_error',
      status,
      true,
      false,
      message || 'حدث خطأ مؤقت في الخادم. يمكنك إكمال الطلب عبر واتساب أو المحاولة لاحقاً.',
      technicalDetail
    );
  }

  return makeClassified(
    'unknown',
    status,
    false,
    false,
    message || 'حدث خطأ غير متوقع أثناء الاتصال.',
    technicalDetail
  );
}

export function shouldRetryRequest(err: unknown, attempt: number, maxRetries = 1): boolean {
  if (attempt >= maxRetries) return false;
  const info = classifyApiError(err);
  if (info.isQuota || info.category === 'quota_exceeded' || info.category === 'rate_limited') {
    return false;
  }
  return info.retryable;
}
