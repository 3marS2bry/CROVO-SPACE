import type { AcademicGrade, Chapter, SectionType } from '../types';
import {
  api,
  type BootstrapResponse,
  type CommentItem,
  type LikesState,
  type PollState,
  type PublicConfig,
  type QuestionStatsResponse,
} from './api';

const FAST_CACHE_KEY = 'crovo_fast_boot_v1';
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface FastStoreState {
  config: PublicConfig | null;
  toolLikes: { count: number; liked: boolean; resolved: boolean };
  library: Record<string, Chapter[]>;
  poll: PollState | null;
  comments: CommentItem[] | null;
  questionStats: QuestionStatsResponse | null;
  updatedAt: number;
}

const memoryState: FastStoreState = {
  config: null,
  toolLikes: { count: 0, liked: false, resolved: false },
  library: {},
  poll: null,
  comments: null,
  questionStats: null,
  updatedAt: 0,
};

let hydratedFromStorage = false;

function hydrateFromStorage(): void {
  if (hydratedFromStorage || typeof window === 'undefined') return;
  hydratedFromStorage = true;
  try {
    const raw = window.localStorage.getItem(FAST_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<FastStoreState>;
    if (!parsed || typeof parsed !== 'object') return;
    const age = Date.now() - Number(parsed.updatedAt || 0);
    if (age > CACHE_MAX_AGE_MS) return;

    if (parsed.config && typeof parsed.config === 'object') {
      memoryState.config = parsed.config;
    }
    if (parsed.toolLikes && typeof parsed.toolLikes.count === 'number') {
      memoryState.toolLikes = {
        count: Math.max(0, parsed.toolLikes.count),
        liked: Boolean(parsed.toolLikes.liked),
        resolved: true,
      };
    }
    if (parsed.library && typeof parsed.library === 'object') {
      memoryState.library = parsed.library;
    }
    if (parsed.poll && typeof parsed.poll === 'object' && parsed.poll.totalVotes > 0) {
      memoryState.poll = parsed.poll;
    }
    if (Array.isArray(parsed.comments) && parsed.comments.length > 0) {
      memoryState.comments = parsed.comments;
    }
    if (parsed.questionStats && typeof parsed.questionStats === 'object') {
      memoryState.questionStats = parsed.questionStats;
    }
    memoryState.updatedAt = Number(parsed.updatedAt || Date.now());
  } catch {
    // Ignore corrupt localStorage cache cleanly
  }
}

let persistTimer: number | null = null;
function schedulePersist(): void {
  if (typeof window === 'undefined') return;
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      // Keep persisted comments compact (strip large base64 attachments from localStorage cache if over quota)
      const compactComments = memoryState.comments
        ? memoryState.comments.slice(0, 40).map((c) => ({
            ...c,
            avatarUrl: c.avatarUrl && c.avatarUrl.length < 4096 ? c.avatarUrl : null,
            attachmentUrl: null,
            attachmentBeforeUrl: null,
            attachmentAfterUrl: null,
          }))
        : null;

      window.localStorage.setItem(
        FAST_CACHE_KEY,
        JSON.stringify({
          config: memoryState.config,
          toolLikes: memoryState.toolLikes,
          library: memoryState.library,
          poll: memoryState.poll,
          comments: compactComments,
          questionStats: memoryState.questionStats,
          updatedAt: Date.now(),
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, 150);
}

type FastStoreListener = () => void;
const listeners = new Set<FastStoreListener>();

function emitStoreChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Ignore subscriber error
    }
  }
}

export function subscribeFastStore(listener: FastStoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedConfig(): PublicConfig | null {
  hydrateFromStorage();
  return memoryState.config;
}

export function getCachedToolLikes(): { count: number; liked: boolean; resolved: boolean } {
  hydrateFromStorage();
  return memoryState.toolLikes;
}

export function getCachedLibrary(grade: AcademicGrade, section: SectionType): Chapter[] | null {
  hydrateFromStorage();
  const key = `${grade}:${section}`;
  return memoryState.library[key] || null;
}

export function getCachedPoll(): PollState | null {
  hydrateFromStorage();
  return memoryState.poll;
}

export function getCachedComments(): CommentItem[] | null {
  hydrateFromStorage();
  return memoryState.comments;
}

export function getCachedQuestionStats(): QuestionStatsResponse | null {
  hydrateFromStorage();
  return memoryState.questionStats;
}

export function setFastConfig(cfg: PublicConfig): void {
  hydrateFromStorage();
  memoryState.config = cfg;
  memoryState.updatedAt = Date.now();
  schedulePersist();
  emitStoreChange();
}

export function setFastToolLikes(next: Partial<LikesState> & { count: number }): void {
  hydrateFromStorage();
  memoryState.toolLikes = {
    count: Math.max(0, Number(next.count || 0)),
    liked: typeof next.liked === 'boolean' ? next.liked : memoryState.toolLikes.liked,
    resolved: true,
  };
  memoryState.updatedAt = Date.now();
  schedulePersist();
  emitStoreChange();
}

export function setFastLibrary(grade: AcademicGrade, section: SectionType, chapters: Chapter[]): void {
  hydrateFromStorage();
  memoryState.library[`${grade}:${section}`] = chapters;
  memoryState.updatedAt = Date.now();
  schedulePersist();
  emitStoreChange();
}

export function setFastPoll(poll: PollState): void {
  hydrateFromStorage();
  memoryState.poll = poll;
  memoryState.updatedAt = Date.now();
  schedulePersist();
  emitStoreChange();
}

export function setFastComments(comments: CommentItem[]): void {
  hydrateFromStorage();
  memoryState.comments = comments;
  memoryState.updatedAt = Date.now();
  schedulePersist();
  emitStoreChange();
}

export function setFastQuestionStats(stats: QuestionStatsResponse): void {
  hydrateFromStorage();
  const prevCopyCounts = memoryState.questionStats?.copyCounts || {};
  const mergedCopyCounts = { ...stats.copyCounts };
  for (const [k, v] of Object.entries(prevCopyCounts)) {
    mergedCopyCounts[k] = Math.max(Number(v || 0), Number(mergedCopyCounts[k] || 0));
  }
  const mergedTotalCopies = Math.max(
    Number(memoryState.questionStats?.totalCopies || 0),
    Number(stats.totalCopies || 0)
  );
  memoryState.questionStats = {
    ...stats,
    totalCopies: mergedTotalCopies,
    copyCounts: mergedCopyCounts,
  };
  memoryState.updatedAt = Date.now();
  schedulePersist();
  emitStoreChange();
}

export function applyBootstrapPayload(data: BootstrapResponse): void {
  hydrateFromStorage();
  const isDegraded = Boolean(data.quotaDegraded);
  let mutated = false;

  if (data.config && (!isDegraded || !memoryState.config)) {
    memoryState.config = data.config;
    mutated = true;
  }
  if (data.likes && data.likes.itemKey === 'tool' && (!isDegraded || !memoryState.toolLikes.resolved)) {
    memoryState.toolLikes = {
      count: Math.max(0, Number(data.likes.count || 0)),
      liked: Boolean(data.likes.liked),
      resolved: true,
    };
    mutated = true;
  }
  if (data.library && Array.isArray(data.library.chapters)) {
    const libKey = `${data.library.grade}:${data.library.section}`;
    const existingChapters = memoryState.library[libKey];
    if (!isDegraded || !existingChapters || existingChapters.length === 0) {
      memoryState.library[libKey] = data.library.chapters;
      mutated = true;
    }
  }
  if (data.poll && (!isDegraded || (!memoryState.poll && data.poll.totalVotes > 0))) {
    memoryState.poll = data.poll;
    mutated = true;
  }
  if (
    Array.isArray(data.comments) &&
    (!isDegraded || data.comments.length > 0)
  ) {
    memoryState.comments = data.comments.map((c) => ({ ...c, source: 'api' as const }));
    mutated = true;
  }
  if (
    data.questionStats &&
    (!isDegraded || !memoryState.questionStats || data.questionStats.totalCopies > 0)
  ) {
    memoryState.questionStats = data.questionStats;
    mutated = true;
  }

  if (!isDegraded && mutated) {
    memoryState.updatedAt = Date.now();
    schedulePersist();
  } else if (mutated && (data.comments?.length > 0 || (data.library?.chapters?.length ?? 0) > 0)) {
    memoryState.updatedAt = Date.now();
    schedulePersist();
  }
  if (mutated) {
    emitStoreChange();
  }
}

const inflightBootstrap = new Map<string, Promise<BootstrapResponse>>();
let completedInitialBootstrap = false;

export function hasCompletedInitialBootstrap(): boolean {
  return completedInitialBootstrap;
}

export function ensureBootstrap(
  grade: AcademicGrade,
  section: SectionType,
  force = false
): Promise<BootstrapResponse> {
  const key = `${grade}:${section}:${force ? 'force' : 'normal'}`;
  const existing = inflightBootstrap.get(key);
  if (existing) return existing;

  const task = api
    .getBootstrap(grade, section)
    .then((res) => {
      completedInitialBootstrap = true;
      applyBootstrapPayload(res);
      return res;
    })
    .finally(() => {
      inflightBootstrap.delete(key);
    });

  inflightBootstrap.set(key, task);
  return task;
}

let prefetchedOthers = false;
export function prefetchOtherLibrarySections(currentGrade: AcademicGrade, currentSection: SectionType): void {
  if (prefetchedOthers || typeof window === 'undefined') return;
  prefetchedOthers = true;

  const allTargets: Array<{ grade: AcademicGrade; section: SectionType }> = [
    { grade: 'bac1', section: 'js' },
    { grade: 'bac2', section: 'js' },
    { grade: 'bac2', section: 'py' },
    { grade: 'bac2', section: 'fin' },
  ];
  const targets = allTargets.filter((t) => !(t.grade === currentGrade && t.section === currentSection));

  const run = () => {
    for (const target of targets) {
      if (getCachedLibrary(target.grade, target.section)) continue;
      void api
        .getLibrary(target.grade, target.section)
        .then((res) => {
          setFastLibrary(target.grade, target.section, res.chapters);
        })
        .catch(() => {});
    }
  };

  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback;
  if (typeof ric === 'function') {
    ric(run, { timeout: 2500 });
  } else {
    globalThis.setTimeout(run, 1200);
  }
}
