export interface D1Meta {
  duration?: number;
  changes?: number;
  last_row_id?: number;
  changed_db?: boolean;
  size_after?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface Env {
  DB: D1Database;
  SESSION_SECRET?: string;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_WHATSAPP_NUMBER?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  PUSH_CRON_SECRET?: string;
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

export interface EdgeRequestContext {
  request: Request;
  url: URL;
  env: Env;
  db: D1Database;
  visitorId: string;
  visitorToken: string;
  ipHash: string;
  currentUser: AuthUser | null;
  sessionSecret: string;
  encryptionKey: string;
  adminUsername: string;
  adminPassword: string;
  cookies: Record<string, string>;
}
