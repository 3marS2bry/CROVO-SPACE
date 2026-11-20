export type AdminSnapshotKey = 'overview' | 'users' | 'analytics';

const STORAGE_KEYS: Record<AdminSnapshotKey, string> = {
  overview: 'crovo_admin_snapshot_overview_v1',
  users: 'crovo_admin_snapshot_users_v1',
  analytics: 'crovo_admin_snapshot_analytics_v1',
};

interface StoredEnvelope<T> {
  v: 1;
  savedAt: string;
  data: T;
}

export function readAdminSnapshot<T>(key: AdminSnapshotKey): { savedAt: string; data: T } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[key]);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredEnvelope<T>;
    if (!parsed || parsed.v !== 1 || !parsed.data || typeof parsed.savedAt !== 'string') {
      return null;
    }
    return { savedAt: parsed.savedAt, data: parsed.data };
  } catch {
    return null;
  }
}

export function writeAdminSnapshot<T>(key: AdminSnapshotKey, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const envelope: StoredEnvelope<T> = {
      v: 1,
      savedAt: new Date().toISOString(),
      data,
    };
    window.localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(envelope));
  } catch {
    // Ignore storage quota or private mode errors
  }
}
