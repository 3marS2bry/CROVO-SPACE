import type { ClientPricingConfig, OrderGrade, PlatformChoice, QureoSectionChoice } from './rules';
import type { AcademicGrade, Chapter, SectionType } from '../types';

const VISITOR_TOKEN_STORAGE_KEY = 'crovo_visitor_token';
const USER_TOKEN_STORAGE_KEY = 'crovo_user_token';
const ADMIN_TOKEN_STORAGE_KEY = 'crovo_admin_token';

export interface AuthUser {
  id: string;
  serialNumber?: string | null;
  name: string;
  email: string;
  grade: 'bac1' | 'bac2';
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  suspendReason?: string | null;
}

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

export interface PublicConfig extends ClientPricingConfig {
  ordersEnabled: boolean;
  pollClosed: boolean;
  offerActive: boolean;
  serverTime: string;
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
  heroPromo: {
    enabled: boolean;
    title: string;
    subtitle: string;
  };
  promoBanner?: {
    enabled: boolean;
    text: string;
  };
  notificationsEnabled: boolean;
  notificationsIntervalDays: number;
  adminWhatsappDisplay: string;
  toolVideos?: ToolVideoConfig[];
  toolServices?: ToolServiceConfig[];
}

export interface CommentItem {
  id: string;
  authorName: string;
  grade: string;
  rating: number;
  content: string;
  avatarUrl: string | null;
  attachmentUrl: string | null;
  attachmentBeforeUrl?: string | null;
  attachmentAfterUrl?: string | null;
  contactPhone: string | null;
  showContactPublicly: boolean;
  isVerified: boolean;
  isOwner: boolean;
  likesCount: number;
  hasLiked: boolean;
  createdAt: string;
  updatedAt: string | null;
  source?: 'cloud' | 'api';
}

export interface PollOptionState {
  key: string;
  label: string;
  count: number;
  percent: number;
}

export interface PollState {
  pollId?: string;
  question?: string;
  closed: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  requiresAuth?: boolean;
  totalVotes: number;
  extendCount: number;
  enoughCount: number;
  extendPercent: number;
  enoughPercent: number;
  userChoice: string | null;
  options?: PollOptionState[];
}

export interface LikesState {
  itemKey: string;
  count: number;
  liked: boolean;
}

export interface QuestionStatsResponse {
  totalCopies: number;
  copyCounts: Record<string, number>;
  topQuestions: Array<{
    questionKey: string;
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qIndex: number;
    questionTitle: string;
    copyCount: number;
  }>;
}

export interface OrderReceipt {
  id: string;
  orderCode: string;
  fullName: string;
  grade: OrderGrade;
  platformLabel: string;
  sectionDetails: string;
  oldPrice: number;
  finalPrice: number;
  offerApplied: boolean;
  paymentMethod: string;
  status: 'new' | 'reviewing' | 'completed' | 'cancelled';
  createdAt: string;
}

export interface AdminAnalyticsResponse {
  range: string;
  from: string;
  to: string;
  trackingStartedAt: string;
  visitors: {
    uniqueVisitors: number;
    prevUniqueVisitors: number;
    totalVisits: number;
    prevTotalVisits: number;
    sessions: number;
  };
  users: {
    totalRegistered: number;
    newInPeriod: number;
    prevNewInPeriod: number;
    activeUsers: number;
    completedSubscribers: number;
    totalOrders: number;
  };
  library: {
    opens: number;
    searches: number;
    zeroResultSearches: number;
    totalCopies: number;
    topLevels: Array<{ grade: string; section: string; chapterNum: number; views: number }>;
    topSearchTerms: Array<{ query: string; count: number; zeroResults: number }>;
  };
  tool: {
    totalRuns: number;
    succeededRuns: number;
    failedRuns: number;
    avgDurationMs: number;
    recentErrors: Array<{
      id: string;
      serviceKey: string;
      errorMessage: string | null;
      createdAt: string;
    }>;
  };
  engagement: {
    totalLikes: number;
    totalComments: number;
    totalPollVotes: number;
  };
  timeline: Array<{
    day: string;
    visits: number;
    uniqueVisitors: number;
    libraryOpens: number;
    searches: number;
  }>;
}

export interface AdminUserItem {
  id: string;
  serialNumber?: string | null;
  name: string;
  email: string;
  grade: 'bac1' | 'bac2';
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  suspendReason: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  reviewsCount: number;
  votesCount: number;
  completedOrdersCount: number;
}

export interface AdminPollItem {
  id: string;
  slug: string;
  question: string;
  isOpen: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  totalVotes: number;
  options: Array<{ key: string; label: string; sortOrder: number; votes: number; percent: number }>;
}

export interface AdminAuditLogItem {
  id: string;
  actorUsername: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detailsJson: string | null;
  createdAt: string;
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage quota/privacy mode errors
  }
}

export function setStoredUserToken(token: string | null): void {
  writeStorage(USER_TOKEN_STORAGE_KEY, token);
}

export function getStoredUserToken(): string | null {
  return readStorage(USER_TOKEN_STORAGE_KEY);
}

export function setStoredAdminToken(token: string | null): void {
  writeStorage(ADMIN_TOKEN_STORAGE_KEY, token);
}

export function getStoredVisitorToken(): string | null {
  return readStorage(VISITOR_TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  requiresAuth?: boolean;
  constructor(message: string, status: number, requiresAuth?: boolean) {
    super(message);
    this.status = status;
    this.requiresAuth = requiresAuth;
  }
}

const inflightGets = new Map<string, Promise<unknown>>();

export function notifyLikesUpdated(detail: LikesState): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('crovo:likes-updated', { detail }));
  }
}

export function notifyAuthUpdated(user: AuthUser | null): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('crovo:auth-updated', { detail: user }));
  }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const canDedupe = method === 'GET' && !init?.signal;

  if (canDedupe && inflightGets.has(url)) {
    return inflightGets.get(url) as Promise<T>;
  }

  const execute = async (): Promise<T> => {
    const extraHeaders: Record<string, string> = {};
    const visitorToken = readStorage(VISITOR_TOKEN_STORAGE_KEY);
    const userToken = readStorage(USER_TOKEN_STORAGE_KEY);
    const adminToken = readStorage(ADMIN_TOKEN_STORAGE_KEY);

    if (visitorToken) extraHeaders['X-Crovo-Visitor'] = visitorToken;
    if (userToken) extraHeaders['Authorization'] = `Bearer ${userToken}`;
    if (adminToken) extraHeaders['X-Crovo-Admin-Token'] = adminToken;

    let response: Response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
          ...(init?.headers || {}),
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      throw new ApiError(
        'مفيش اتصال بالإنترنت أو الخادم مش متاح حالياً. بياناتك محفوظة، جرب تاني.',
        0
      );
    }

    const returnedVisitorToken = response.headers.get('X-Crovo-Visitor-Token');
    if (returnedVisitorToken) {
      writeStorage(VISITOR_TOKEN_STORAGE_KEY, returnedVisitorToken);
    }

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON response
    }

    if (!response.ok) {
      const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      const errMsg =
        obj && typeof obj.error === 'string'
          ? obj.error
          : `حدث خطأ غير متوقع (${response.status}).`;
      throw new ApiError(errMsg, response.status, Boolean(obj?.requiresAuth));
    }

    return data as T;
  };

  if (canDedupe) {
    const promise = execute().finally(() => {
      inflightGets.delete(url);
    });
    inflightGets.set(url, promise);
    return promise;
  }

  return execute();
}

export const api = {
  // User Account Auth
  authMe: () => apiFetch<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/me'),

  authRegister: async (payload: {
    name: string;
    email: string;
    password: string;
    grade: 'bac1' | 'bac2';
  }) => {
    const res = await apiFetch<{ ok: boolean; token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.token) setStoredUserToken(res.token);
    notifyAuthUpdated(res.user);
    return res;
  },

  authLogin: async (payload: { email: string; password: string }) => {
    const res = await apiFetch<{ ok: boolean; token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.token) setStoredUserToken(res.token);
    notifyAuthUpdated(res.user);
    return res;
  },

  authCloudSync: async (payload: {
    idToken: string;
    name?: string;
    grade?: 'bac1' | 'bac2';
    serialNumber?: string | null;
  }) => {
    const res = await apiFetch<{ ok: boolean; token: string; user: AuthUser }>('/api/auth/cloud-sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.token) setStoredUserToken(res.token);
    notifyAuthUpdated(res.user);
    return res;
  },

  authLogout: async () => {
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredUserToken(null);
      notifyAuthUpdated(null);
    }
  },

  // Public Config & Dynamic Library
  getConfig: () => apiFetch<PublicConfig>('/api/config'),

  getLibrary: (grade: AcademicGrade, section: SectionType, signal?: AbortSignal) =>
    apiFetch<{ grade: AcademicGrade; section: SectionType; chapters: Chapter[] }>(
      `/api/library?grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section)}`,
      signal ? { signal } : undefined
    ),

  trackEvent: (payload: {
    eventType: 'page_view' | 'library_open' | 'level_view' | 'library_search' | 'tool_view';
    sessionId?: string;
    path?: string;
    grade?: AcademicGrade;
    section?: SectionType;
    chapterNum?: number;
    query?: string;
    resultsCount?: number;
  }) =>
    apiFetch<{ ok: boolean }>('/api/analytics/event', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).catch(() => ({ ok: false })),

  getQuestionStats: () => apiFetch<QuestionStatsResponse>('/api/questions/stats'),

  recordQuestionCopy: (payload: {
    questionKey: string;
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qIndex: number;
    questionTitle: string;
  }) =>
    apiFetch<{ ok: boolean; questionKey: string; copyCount: number }>('/api/questions/copy', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reportQuestionIssue: (payload: {
    questionKey: string;
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qIndex: number;
    questionTitle: string;
    description: string;
  }) =>
    apiFetch<{ ok: boolean; reportId: string; message: string }>('/api/questions/report', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getVapidPublicKey: () =>
    apiFetch<{ publicKey: string; enabled: boolean; intervalDays: number }>('/api/push/vapid-public-key'),

  getPushStatus: () =>
    apiFetch<{ subscribed: boolean; notificationsEnabled: boolean; intervalDays: number }>('/api/push/status'),

  subscribePush: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    apiFetch<{ ok: boolean; subscribed: boolean }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),

  unsubscribePush: (endpoint?: string) =>
    apiFetch<{ ok: boolean; subscribed: boolean }>('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),

  logPushError: (payload: { stage: string; errorCode: string; detail?: string }) =>
    apiFetch<{ ok: boolean }>('/api/push/log-error', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).catch(() => ({ ok: false })),

  getComments: () => apiFetch<{ comments: CommentItem[] }>('/api/comments'),

  createComment: (payload: {
    authorName: string;
    grade: string;
    rating: number;
    content: string;
    contactPhone?: string;
    showContactPublicly?: boolean;
    avatarDataUrl?: string | null;
    attachmentDataUrl?: string | null;
    attachmentBeforeDataUrl?: string | null;
    attachmentAfterDataUrl?: string | null;
  }) =>
    apiFetch<{ comment: CommentItem }>('/api/comments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateComment: (
    id: string,
    payload: {
      authorName?: string;
      grade?: string;
      rating?: number;
      content?: string;
      contactPhone?: string;
      showContactPublicly?: boolean;
    }
  ) =>
    apiFetch<{ ok: boolean; updatedAt: string }>(`/api/comments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteComment: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/comments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  reportComment: (id: string, reason: string) =>
    apiFetch<{ ok: boolean; flaggedForReview: boolean; message: string }>(
      `/api/comments/${encodeURIComponent(id)}/report`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),

  getLikes: (itemKey = 'tool') =>
    apiFetch<LikesState>(`/api/likes?itemKey=${encodeURIComponent(itemKey)}`),

  toggleLike: async (itemKey = 'tool', desiredLiked?: boolean) => {
    const res = await apiFetch<LikesState>('/api/likes/toggle', {
      method: 'POST',
      body: JSON.stringify(
        typeof desiredLiked === 'boolean' ? { itemKey, desiredLiked } : { itemKey }
      ),
    });
    notifyLikesUpdated(res);
    return res;
  },

  getPoll: (pollId?: string) =>
    apiFetch<PollState>(pollId ? `/api/poll?pollId=${encodeURIComponent(pollId)}` : '/api/poll'),

  votePoll: (choice: string, pollId?: string) =>
    apiFetch<PollState>('/api/poll/vote', {
      method: 'POST',
      body: JSON.stringify({ choice, ...(pollId ? { pollId } : {}) }),
    }),

  createOrder: (payload: {
    fullName: string;
    grade: OrderGrade;
    platforms: PlatformChoice[];
    qureoSection?: QureoSectionChoice;
    platformUsername: string;
    platformPassword: string;
    paymentMethod: string;
    clientRequestId: string;
  }) =>
    apiFetch<{ deduplicated: boolean; order: OrderReceipt }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Admin Session
  adminLogin: async (username: string, password: string) => {
    const res = await apiFetch<{ ok: boolean; username: string; adminToken?: string; token?: string }>(
      '/api/admin/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }
    );
    if (res.adminToken) setStoredAdminToken(res.adminToken);
    if (res.token) setStoredUserToken(res.token);
    return res;
  },

  adminFirebaseLogin: async (idToken: string) => {
    const res = await apiFetch<{ ok: boolean; username: string; adminToken?: string; token?: string }>(
      '/api/admin/firebase-login',
      {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      }
    );
    if (res.adminToken) setStoredAdminToken(res.adminToken);
    if (res.token) setStoredUserToken(res.token);
    return res;
  },

  adminLogout: async () => {
    try {
      await apiFetch<{ ok: boolean }>('/api/admin/logout', { method: 'POST' });
    } finally {
      setStoredAdminToken(null);
    }
  },

  adminMe: () => apiFetch<{ authenticated: boolean; username?: string }>('/api/admin/me'),

  adminOverview: () =>
    apiFetch<{
      orders: Array<{
        id: string;
        orderCode: string;
        userId?: string | null;
        userSerialNumber?: string | null;
        userEmail?: string | null;
        fullName: string;
        grade: OrderGrade;
        platformLabel: string;
        sectionDetails: string;
        platformUsername: string;
        platformPassword: string | null;
        credentialsPurged: boolean;
        oldPrice: number;
        finalPrice: number;
        offerApplied: boolean;
        paymentMethod: string;
        status: 'new' | 'reviewing' | 'completed' | 'cancelled';
        createdAt: string;
        updatedAt: string | null;
      }>;
      comments: Array<{
        id: string;
        authorName: string;
        grade: string;
        rating: number;
        content: string;
        avatarUrl: string | null;
        attachmentUrl: string | null;
        attachmentBeforeUrl?: string | null;
        attachmentAfterUrl?: string | null;
        contactPhone: string | null;
        showContactPublicly: boolean;
        isVerified: boolean;
        status: 'approved' | 'hidden' | 'flagged';
        likesCount?: number;
        reportsCount: number;
        reports: Array<{ reason: string; createdAt: string }>;
        createdAt: string;
      }>;
      questionReports: Array<{
        id: string;
        questionKey: string;
        grade: 'bac1' | 'bac2';
        section: 'js' | 'py' | 'fin';
        chapterNum: number;
        qIndex: number;
        questionTitle: string;
        description: string;
        status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
        adminNote: string | null;
        createdAt: string;
        updatedAt: string | null;
      }>;
      poll: PollState;
      likes: Array<{ itemKey: string; count: number }>;
      config: PublicConfig;
      analytics?: AdminAnalyticsResponse;
      stats: {
        totalCopies: number;
        topQuestions: Array<{
          questionKey: string;
          grade: string;
          section: string;
          chapterNum: number;
          qIndex: number;
          questionTitle: string;
          copyCount: number;
          lastCopiedAt: string;
        }>;
        pendingQuestionReports: number;
        pushActiveCount: number;
        pushTotalCount: number;
        dbIntegrity: { ok: boolean; detail: string };
        backups: Array<{ filename: string; sizeBytes: number; createdAt: string }>;
        isEphemeralStorageNotice: string;
      };
      notifications: {
        enabled: boolean;
        intervalDays: number;
        templates: Array<{
          id: string;
          category: 'offer' | 'service' | 'update';
          title: string;
          body: string;
          url: string;
        }>;
        logs: Array<{
          id: string;
          messageId: string;
          category: string;
          title: string;
          body: string;
          sentCount: number;
          failedCount: number;
          triggerType: string;
          errorDetail?: string | null;
          createdAt: string;
        }>;
      };
    }>('/api/admin/overview'),

  adminAnalytics: (range = '7d', from?: string, to?: string) => {
    const params = new URLSearchParams({ range });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return apiFetch<AdminAnalyticsResponse>(`/api/admin/analytics?${params.toString()}`);
  },

  adminUsers: (params?: { q?: string; role?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.role) qs.set('role', params.role);
    if (params?.status) qs.set('status', params.status);
    return apiFetch<{ users: AdminUserItem[] }>(`/api/admin/users?${qs.toString()}`);
  },

  adminUpdateUser: (
    id: string,
    payload: {
      role?: 'user' | 'admin';
      status?: 'active' | 'suspended';
      grade?: 'bac1' | 'bac2';
      suspendReason?: string;
    }
  ) =>
    apiFetch<{ ok: boolean; user: Partial<AdminUserItem> }>(
      `/api/admin/users/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  adminUserActivity: (id: string) =>
    apiFetch<{
      user: AdminUserItem;
      reviews: Array<{ id: string; content: string; rating: number; status: string; createdAt: string }>;
      votes: Array<{ pollId: string; question: string; optionKey: string; createdAt: string }>;
      orders: Array<{ id: string; orderCode: string; platformLabel: string; finalPrice: number; status: string; createdAt: string }>;
      toolRuns: Array<{ id: string; serviceKey: string; status: string; durationMs: number; errorMessage: string | null; createdAt: string }>;
      activities: Array<{
        id: string;
        eventType: string;
        path: string | null;
        grade: string | null;
        section: string | null;
        chapterNum: number | null;
        query: string | null;
        resultsCount: number | null;
        metaJson: string | null;
        createdAt: string;
      }>;
    }>(`/api/admin/users/${encodeURIComponent(id)}/activity`),

  adminLibrary: (params?: { grade?: string; section?: string; q?: string; incomplete?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.grade) qs.set('grade', params.grade);
    if (params?.section) qs.set('section', params.section);
    if (params?.q) qs.set('q', params.q);
    if (params?.incomplete) qs.set('incomplete', '1');
    return apiFetch<{
      chapters: Array<{
        id: string;
        grade: string;
        section: string;
        chapterNum: number;
        title: string;
        sortOrder: number;
        updatedAt: string;
        updatedBy: string | null;
      }>;
      questions: Array<{
        id: string;
        chapterId: string;
        grade: 'bac1' | 'bac2';
        section: 'js' | 'py' | 'fin';
        chapterNum: number;
        qIndex: number;
        qText: string;
        aText: string;
        isCode: boolean;
        isIncomplete: boolean;
        updatedAt: string;
        updatedBy: string | null;
      }>;
      totalMatching: number;
    }>(`/api/admin/library?${qs.toString()}`);
  },

  adminCreateLibraryQuestion: (payload: {
    grade: 'bac1' | 'bac2';
    section: 'js' | 'py' | 'fin';
    chapterNum: number;
    qText: string;
    aText: string;
    isCode: boolean;
  }) =>
    apiFetch<{ ok: boolean; id: string }>('/api/admin/library/questions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdateLibraryQuestion: (
    id: string,
    payload: { qText?: string; aText?: string; isCode?: boolean; qIndex?: number }
  ) =>
    apiFetch<{ ok: boolean; updatedAt: string }>(
      `/api/admin/library/questions/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  adminDeleteLibraryQuestion: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/library/questions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  adminExportLibrary: () => apiFetch<Record<string, unknown>>('/api/admin/library/export'),

  adminImportLibrary: (questions: Array<Record<string, unknown>>) =>
    apiFetch<{ ok: boolean; importedCount: number }>('/api/admin/library/import', {
      method: 'POST',
      body: JSON.stringify({ questions }),
    }),

  adminToolOverview: () =>
    apiFetch<{
      services: ToolServiceConfig[];
      videos: ToolVideoConfig[];
      summary: { totalRuns: number; succeededRuns: number; failedRuns: number; avgDurationMs: number };
      recentRuns: Array<{
        id: string;
        userId: string | null;
        serviceKey: string;
        status: string;
        durationMs: number;
        errorMessage: string | null;
        createdAt: string;
      }>;
    }>('/api/admin/tool'),

  adminUpdateToolService: (
    key: string,
    payload: { name?: string; description?: string; isVisible?: boolean }
  ) =>
    apiFetch<{ ok: boolean }>(`/api/admin/tool/services/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminUpdateToolVideos: (videos: ToolVideoConfig[]) =>
    apiFetch<{ ok: boolean; videos: ToolVideoConfig[] }>('/api/admin/tool/videos', {
      method: 'PUT',
      body: JSON.stringify({ videos }),
    }),

  adminUploadAdImage: (imageDataUrl: string) =>
    apiFetch<{ ok: boolean; imageUrl: string }>('/api/admin/ad-image', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl }),
    }),

  adminPolls: () => apiFetch<{ polls: AdminPollItem[] }>('/api/admin/polls'),

  adminCreatePoll: (payload: {
    question: string;
    options: string[];
    startsAt?: string | null;
    endsAt?: string | null;
  }) =>
    apiFetch<{ ok: boolean; id: string }>('/api/admin/polls', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdatePoll: (
    id: string,
    payload: {
      question?: string;
      isOpen?: boolean;
      startsAt?: string | null;
      endsAt?: string | null;
      options?: Array<{ key: string; label: string }>;
    }
  ) =>
    apiFetch<{ ok: boolean }>(`/api/admin/polls/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminExportPollJson: (id: string) =>
    apiFetch<Record<string, unknown>>(`/api/admin/polls/${encodeURIComponent(id)}/export`),

  adminAuditLogs: () => apiFetch<{ logs: AdminAuditLogItem[] }>('/api/admin/audit-logs'),

  adminUpdateOrder: (
    id: string,
    payload: { status?: 'new' | 'reviewing' | 'completed' | 'cancelled'; purgeCredentials?: boolean }
  ) =>
    apiFetch<{ ok: boolean; status: string; credentialsPurged: boolean }>(
      `/api/admin/orders/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  adminDeleteOrder: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/orders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  adminUpdateComment: (
    id: string,
    payload: { isVerified?: boolean; status?: 'approved' | 'hidden' | 'flagged'; clearReports?: boolean }
  ) =>
    apiFetch<{ ok: boolean }>(`/api/admin/comments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminDeleteComment: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/comments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  adminUpdateQuestionReport: (
    id: string,
    payload: { status?: 'pending' | 'reviewed' | 'resolved' | 'dismissed'; adminNote?: string }
  ) =>
    apiFetch<{ ok: boolean; status: string }>(
      `/api/admin/question-reports/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),

  adminSendPush: (payload: {
    mode: 'due' | 'broadcast_next' | 'broadcast_custom';
    title?: string;
    body?: string;
    category?: 'offer' | 'service' | 'update';
  }) =>
    apiFetch<{
      ok: boolean;
      result: {
        skippedDisabled?: boolean;
        eligibleCount: number;
        sentCount: number;
        failedCount: number;
        removedExpired: number;
      };
    }>('/api/admin/push/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminCreateBackup: () =>
    apiFetch<{
      ok: boolean;
      backup: { filename: string; sizeBytes: number; createdAt: string };
      backups: Array<{ filename: string; sizeBytes: number; createdAt: string }>;
    }>('/api/admin/backup', {
      method: 'POST',
    }),

  adminResetPoll: (pollId = 'poll_extend_offer') =>
    apiFetch<{ ok: boolean; poll: PollState }>('/api/admin/poll/reset', {
      method: 'POST',
      body: JSON.stringify({ pollId }),
    }),

  adminUpdateSettings: (payload: Record<string, unknown>) =>
    apiFetch<{ ok: boolean; config: PublicConfig }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};
