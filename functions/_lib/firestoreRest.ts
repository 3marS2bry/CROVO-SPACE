// Zero-billing Web-Standard Firestore REST v1 client (zero node:* or Service Account deps)
// Runs identically in Cloudflare Pages Functions and Node.js Express.

import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import type { Env } from './types.ts';

export interface FirestoreConfig {
  projectId: string;
  databaseId: string;
  apiKey: string;
}

export interface FirestoreAuth {
  idToken?: string | null;
  apiKey?: string | null;
}

export class FirestoreHttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface FirestoreDoc<T = Record<string, unknown>> {
  id: string;
  path: string;
  data: T;
  createTime?: string;
  updateTime?: string;
}

export interface FirestoreRawValue {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  arrayValue?: { values?: FirestoreRawValue[] };
  mapValue?: { fields?: Record<string, FirestoreRawValue> };
}

export interface FirestoreRawDocument {
  name?: string;
  fields?: Record<string, FirestoreRawValue>;
  createTime?: string;
  updateTime?: string;
}

export function resolveFirestoreConfig(env?: Partial<Env>): FirestoreConfig {
  const cfgProject = (firebaseConfig.projectId || '').trim();
  const cfgDb = (firebaseConfig.firestoreDatabaseId || '(default)').trim();
  const cfgApiKey = (firebaseConfig.apiKey || '').trim();

  const rawEnvProject = (env?.FIREBASE_PROJECT_ID || '').trim();
  const rawEnvDb = (env?.FIREBASE_DATABASE_ID || '').trim();
  const rawEnvApiKey = (env?.FIREBASE_API_KEY || '').trim();

  const validEnvDb =
    rawEnvDb && !rawEnvDb.includes('://') && !rawEnvDb.includes('/') && rawEnvDb.length <= 128
      ? rawEnvDb
      : '';
  const sameProject = !cfgProject || !rawEnvProject || rawEnvProject === cfgProject;

  return {
    projectId: sameProject ? rawEnvProject || cfgProject : cfgProject,
    databaseId: sameProject && validEnvDb ? validEnvDb : cfgDb,
    apiKey: sameProject && rawEnvApiKey ? rawEnvApiKey : cfgApiKey,
  };
}

export function getDocumentsBasePath(cfg: FirestoreConfig): string {
  return `projects/${cfg.projectId}/databases/${cfg.databaseId}/documents`;
}

export function getFirestoreBaseUrl(cfg: FirestoreConfig): string {
  return `https://firestore.googleapis.com/v1/${getDocumentsBasePath(cfg)}`;
}

export function encodeFirestoreValue(val: unknown): FirestoreRawValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { nullValue: null };
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.filter((v) => v !== undefined).map((v) => encodeFirestoreValue(v)),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreRawValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function decodeFirestoreValue(raw: FirestoreRawValue | undefined): unknown {
  if (!raw || typeof raw !== 'object') return null;
  if ('nullValue' in raw) return null;
  if ('booleanValue' in raw) return Boolean(raw.booleanValue);
  if ('integerValue' in raw) return Number(raw.integerValue);
  if ('doubleValue' in raw) return Number(raw.doubleValue);
  if ('timestampValue' in raw) return String(raw.timestampValue || '');
  if ('stringValue' in raw) return String(raw.stringValue ?? '');
  if ('arrayValue' in raw) {
    const vals = raw.arrayValue?.values || [];
    return vals.map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in raw) {
    const out: Record<string, unknown> = {};
    const fields = raw.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export function encodeDocumentFields(data: Record<string, unknown>): Record<string, FirestoreRawValue> {
  const fields: Record<string, FirestoreRawValue> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      fields[k] = encodeFirestoreValue(v);
    }
  }
  return fields;
}

export function decodeDocument<T = Record<string, unknown>>(doc: FirestoreRawDocument, cfg: FirestoreConfig): FirestoreDoc<T> {
  const prefix = `${getDocumentsBasePath(cfg)}/`;
  const fullName = doc.name || '';
  const relPath = fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName;
  const parts = relPath.split('/').filter(Boolean);
  const id = parts[parts.length - 1] || '';
  const out: Record<string, unknown> = {};
  if (doc.fields) {
    for (const [k, v] of Object.entries(doc.fields)) {
      out[k] = decodeFirestoreValue(v);
    }
  }
  return {
    id,
    path: relPath,
    data: out as T,
    createTime: doc.createTime,
    updateTime: doc.updateTime,
  };
}

function buildAuthFetchOptions(cfg: FirestoreConfig, auth?: FirestoreAuth): { querySuffix: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let querySuffix = '';
  if (auth?.idToken) {
    headers['Authorization'] = `Bearer ${auth.idToken}`;
  } else if (cfg.apiKey) {
    querySuffix = `key=${encodeURIComponent(auth?.apiKey || cfg.apiKey)}`;
  }
  return { querySuffix, headers };
}

function appendQuery(url: string, extraQuery: string): string {
  if (!extraQuery) return url;
  return url.includes('?') ? `${url}&${extraQuery}` : `${url}?${extraQuery}`;
}

async function parseErrorResponse(res: Response): Promise<FirestoreHttpError> {
  let code = `HTTP_${res.status}`;
  let message = `Firestore REST error (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { status?: string; message?: string } };
    if (body?.error?.status) code = body.error.status;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Ignore parse failure
  }
  return new FirestoreHttpError(res.status, code, message);
}

export async function getDoc<T = Record<string, unknown>>(
  cfg: FirestoreConfig,
  docPath: string,
  auth?: FirestoreAuth
): Promise<FirestoreDoc<T> | null> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const { querySuffix, headers } = buildAuthFetchOptions(cfg, auth);
  const url = appendQuery(`${getFirestoreBaseUrl(cfg)}/${cleanPath}`, querySuffix);

  const res = await fetch(url, { method: 'GET', headers });
  if (res.status === 404) return null;
  if (!res.ok) throw await parseErrorResponse(res);
  const raw = (await res.json()) as FirestoreRawDocument;
  return decodeDocument<T>(raw, cfg);
}

export async function listCollection<T = Record<string, unknown>>(
  cfg: FirestoreConfig,
  collectionPath: string,
  auth?: FirestoreAuth,
  options?: { pageSize?: number; maxDocs?: number }
): Promise<Array<FirestoreDoc<T>>> {
  const cleanPath = collectionPath.replace(/^\/+|\/+$/g, '');
  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length === 0) return [];

  const collectionId = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join('/');
  const baseRunUrl = parentPath
    ? `${getFirestoreBaseUrl(cfg)}/${parentPath}:runQuery`
    : `${getFirestoreBaseUrl(cfg)}:runQuery`;

  const pageSize = Math.min(500, Math.max(1, options?.pageSize || 300));
  const maxDocs = Math.max(1, options?.maxDocs || 1000);
  const { querySuffix, headers } = buildAuthFetchOptions(cfg, auth);
  const url = appendQuery(baseRunUrl, querySuffix);
  const docsBasePath = getDocumentsBasePath(cfg);

  const results: Array<FirestoreDoc<T>> = [];
  let lastDocFullName: string | null = null;

  while (results.length < maxDocs) {
    const remaining = maxDocs - results.length;
    const batchLimit = Math.min(pageSize, remaining);
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: batchLimit,
    };
    if (lastDocFullName) {
      structuredQuery.startAt = {
        values: [{ referenceValue: lastDocFullName }],
        before: false,
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ structuredQuery }),
    });
    if (res.status === 404) return results;
    if (!res.ok) throw await parseErrorResponse(res);

    const rows = (await res.json()) as Array<{ document?: FirestoreRawDocument }>;
    let batchCount = 0;
    let lastInBatchName: string | null = null;

    for (const row of rows) {
      if (row.document) {
        batchCount += 1;
        lastInBatchName = row.document.name || null;
        results.push(decodeDocument<T>(row.document, cfg));
        if (results.length >= maxDocs) break;
      }
    }

    if (batchCount < batchLimit || !lastInBatchName) {
      break;
    }
    lastDocFullName = lastInBatchName.startsWith(docsBasePath)
      ? lastInBatchName
      : `${docsBasePath}/${lastInBatchName.replace(/^\/+/, '')}`;
  }

  return results;
}

export interface StructuredQueryFilter {
  fieldPath: string;
  op: 'EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL';
  value: unknown;
}

export async function runQuery<T = Record<string, unknown>>(
  cfg: FirestoreConfig,
  collectionId: string,
  options?: {
    filters?: StructuredQueryFilter[];
    limit?: number;
  },
  auth?: FirestoreAuth
): Promise<Array<FirestoreDoc<T>>> {
  const { querySuffix, headers } = buildAuthFetchOptions(cfg, auth);
  const url = appendQuery(`${getFirestoreBaseUrl(cfg)}:runQuery`, querySuffix);

  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId }],
    limit: Math.min(1000, Math.max(1, options?.limit || 200)),
  };

  const filters = options?.filters || [];
  if (filters.length === 1) {
    const f = filters[0];
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: f.fieldPath },
        op: f.op,
        value: encodeFirestoreValue(f.value),
      },
    };
  } else if (filters.length > 1) {
    structuredQuery.where = {
      compositeFilter: {
        op: 'AND',
        filters: filters.map((f) => ({
          fieldFilter: {
            field: { fieldPath: f.fieldPath },
            op: f.op,
            value: encodeFirestoreValue(f.value),
          },
        })),
      },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ structuredQuery }),
  });

  if (!res.ok) throw await parseErrorResponse(res);
  const rows = (await res.json()) as Array<{ document?: FirestoreRawDocument }>;
  const docs: Array<FirestoreDoc<T>> = [];
  for (const row of rows) {
    if (row.document) {
      docs.push(decodeDocument<T>(row.document, cfg));
    }
  }
  return docs;
}

export interface CommitWriteInput {
  docPath: string;
  data?: Record<string, unknown>;
  updateMask?: string[];
  serverTimeFields?: string[];
  exists?: boolean;
  isDelete?: boolean;
}

export async function commitWrites(
  cfg: FirestoreConfig,
  writes: CommitWriteInput[],
  auth?: FirestoreAuth
): Promise<void> {
  if (writes.length === 0) return;
  const { querySuffix, headers } = buildAuthFetchOptions(cfg, auth);
  const basePath = getDocumentsBasePath(cfg);

  const formattedWrites = writes.map((w) => {
    const cleanPath = w.docPath.replace(/^\/+/, '');
    const fullName = `${basePath}/${cleanPath}`;

    if (w.isDelete) {
      const delEntry: Record<string, unknown> = { delete: fullName };
      if (typeof w.exists === 'boolean') {
        delEntry.currentDocument = { exists: w.exists };
      }
      return delEntry;
    }

    const entry: Record<string, unknown> = {
      update: {
        name: fullName,
        fields: encodeDocumentFields(w.data || {}),
      },
    };
    if (w.updateMask && w.updateMask.length > 0) {
      entry.updateMask = { fieldPaths: w.updateMask };
    }
    if (typeof w.exists === 'boolean') {
      entry.currentDocument = { exists: w.exists };
    }
    if (w.serverTimeFields && w.serverTimeFields.length > 0) {
      entry.updateTransforms = w.serverTimeFields.map((fieldPath) => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      }));
    }
    return entry;
  });

  const url = appendQuery(`${getFirestoreBaseUrl(cfg)}:commit`, querySuffix);
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ writes: formattedWrites }),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
}

export async function createDoc(
  cfg: FirestoreConfig,
  collectionPath: string,
  docId: string,
  data: Record<string, unknown>,
  serverTimeFields: string[] = ['createdAt', 'updatedAt'],
  auth?: FirestoreAuth
): Promise<void> {
  const cleanCol = collectionPath.replace(/^\/+|\/+$/g, '');
  await commitWrites(
    cfg,
    [
      {
        docPath: `${cleanCol}/${docId}`,
        data,
        serverTimeFields,
        exists: false,
      },
    ],
    auth
  );
}

export async function setDoc(
  cfg: FirestoreConfig,
  docPath: string,
  data: Record<string, unknown>,
  serverTimeFields: string[] = ['updatedAt'],
  auth?: FirestoreAuth
): Promise<void> {
  await commitWrites(
    cfg,
    [
      {
        docPath,
        data,
        serverTimeFields,
      },
    ],
    auth
  );
}

export async function patchDoc(
  cfg: FirestoreConfig,
  docPath: string,
  data: Record<string, unknown>,
  updateMask: string[],
  serverTimeFields: string[] = ['updatedAt'],
  auth?: FirestoreAuth,
  requireExists = true
): Promise<void> {
  await commitWrites(
    cfg,
    [
      {
        docPath,
        data,
        updateMask,
        serverTimeFields,
        exists: requireExists ? true : undefined,
      },
    ],
    auth
  );
}

export async function deleteDoc(
  cfg: FirestoreConfig,
  docPath: string,
  auth?: FirestoreAuth
): Promise<void> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const { querySuffix, headers } = buildAuthFetchOptions(cfg, auth);
  const url = appendQuery(`${getFirestoreBaseUrl(cfg)}/${cleanPath}`, querySuffix);
  const res = await fetch(url, { method: 'DELETE', headers });
  if (res.status === 404) return;
  if (!res.ok) throw await parseErrorResponse(res);
}

export async function checkFirestoreHealth(cfg: FirestoreConfig): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  const { querySuffix, headers } = buildAuthFetchOptions(cfg, { apiKey: cfg.apiKey });
  const url = appendQuery(`${getFirestoreBaseUrl(cfg)}/site_config/public`, querySuffix);
  const res = await fetch(url, { method: 'GET', headers });
  const latencyMs = Date.now() - started;
  if (res.status === 200 || res.status === 404) {
    return { ok: true, latencyMs };
  }
  throw await parseErrorResponse(res);
}
