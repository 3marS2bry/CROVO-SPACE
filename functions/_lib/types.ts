export interface KVNamespacePutOptions {
  expiration?: number;
  expirationTtl?: number;
  metadata?: unknown;
}

export interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: 'json' }): Promise<T | null>;
  put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  RATE_LIMIT_KV?: KVNamespace;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_DATABASE_ID?: string;
  FIREBASE_API_KEY?: string;
  SESSION_SECRET?: string;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_FIREBASE_EMAIL?: string;
  ADMIN_FIREBASE_PASSWORD?: string;
  ADMIN_WHATSAPP_NUMBER?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  PUSH_CRON_SECRET?: string;
  NODE_ENV?: string;
}

export interface PagesEventContext<E = Env> {
  request: Request;
  env: E;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  data: Record<string, unknown>;
}

export type PagesFunction<E = Env> = (context: PagesEventContext<E>) => Response | Promise<Response>;

export interface AuthUser {
  id: string;
  serialNumber?: string | null;
  name: string;
  email: string;
  grade: 'bac1' | 'bac2';
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  suspendReason: string | null;
}
