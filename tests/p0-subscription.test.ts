import test from 'node:test';
import assert from 'node:assert/strict';
import * as firestoreRest from '../functions/_lib/firestoreRest.ts';
import { handleApiRequest } from '../functions/_lib/router.ts';
import type { Env, KVNamespace } from '../functions/_lib/types.ts';
import { classifyApiError, shouldRetryRequest } from '../src/utils/errorClassifier.ts';
import {
  buildSubscriptionWhatsappUrl,
  deriveOrderCodeFromRequestId,
  isEligibleForReturnReviewPrompt,
  loadSubscriptionDraft,
  RETURN_REVIEW_MIN_ELAPSED_MS,
  sanitizeDraftForStorage,
  saveSubscriptionDraft,
  SUBSCRIPTION_DRAFT_KEY,
  type PostWhatsAppReviewState,
} from '../src/utils/orderDraft.ts';

function createMemoryKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, options?: { type?: 'text' | 'json' }) {
      const val = store.get(key) ?? null;
      if (val === null) return null;
      if (options?.type === 'json') return JSON.parse(val);
      return val as never;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function createMemoryWindow(): () => void {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
  };
  return () => {
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  };
}

async function createRouterTestHarness() {
  const docs = new Map<string, Record<string, firestoreRest.FirestoreRawValue>>();
  const cfg = firestoreRest.resolveFirestoreConfig({});
  const basePrefix = firestoreRest.getDocumentsBasePath(cfg);
  const originalFetch = globalThis.fetch;
  let forceQuotaWrite429 = false;

  const kp = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const pubJwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey & { kid?: string };
  pubJwk.kid = 'p0-kid-1';

  const toB64Url = (buf: Uint8Array) =>
    btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  const signJwt = async (uid: string, email: string, name: string) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const hdrB64 = toB64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'p0-kid-1' })));
    const payB64 = toB64Url(
      new TextEncoder().encode(
        JSON.stringify({
          aud: 'sincere-impact-wbvhw',
          iss: 'https://securetoken.google.com/sincere-impact-wbvhw',
          sub: uid,
          email,
          email_verified: true,
          name,
          iat: nowSec - 10,
          exp: nowSec + 3600,
        })
      )
    );
    const sigBuf = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      kp.privateKey,
      new TextEncoder().encode(`${hdrB64}.${payB64}`)
    );
    return `${hdrB64}.${payB64}.${toB64Url(new Uint8Array(sigBuf))}`;
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (urlStr.includes('securetoken@system.gserviceaccount.com')) {
      return new Response(JSON.stringify({ keys: [pubJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
      });
    }

    if (urlStr.includes('firestore.googleapis.com')) {
      const url = new URL(urlStr);
      const marker = `/v1/${basePrefix}`;
      const markerIdx = url.pathname.indexOf(marker);
      const tail = markerIdx >= 0 ? url.pathname.slice(markerIdx + marker.length) : '';
      const method = (init?.method || 'GET').toUpperCase();

      if (forceQuotaWrite429 && method !== 'GET' && !tail.endsWith(':runQuery')) {
        return new Response(
          JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (tail === ':commit' && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as {
          writes?: Array<{
            delete?: string;
            update?: { name: string; fields?: Record<string, firestoreRest.FirestoreRawValue> };
            updateMask?: { fieldPaths?: string[] };
            updateTransforms?: Array<{ fieldPath: string; setToServerValue?: string }>;
            currentDocument?: { exists?: boolean };
          }>;
        };
        const nowIso = new Date().toISOString();
        for (const w of body.writes || []) {
          if (w.delete) {
            const rel = w.delete.replace(`${basePrefix}/`, '');
            docs.delete(rel);
            continue;
          }
          if (w.update) {
            const rel = w.update.name.replace(`${basePrefix}/`, '');
            const existsNow = docs.has(rel);
            if (w.currentDocument?.exists === false && existsNow) {
              return new Response(
                JSON.stringify({ error: { code: 409, status: 'ALREADY_EXISTS', message: 'Exists' } }),
                { status: 409 }
              );
            }
            if (w.currentDocument?.exists === true && !existsNow) {
              return new Response(
                JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Missing' } }),
                { status: 404 }
              );
            }
            const nextFields: Record<string, firestoreRest.FirestoreRawValue> =
              w.updateMask && existsNow ? { ...(docs.get(rel) || {}) } : {};
            for (const [k, v] of Object.entries(w.update.fields || {})) {
              nextFields[k] = v;
            }
            for (const tr of w.updateTransforms || []) {
              if (tr.setToServerValue === 'REQUEST_TIME') {
                nextFields[tr.fieldPath] = { timestampValue: nowIso };
              }
            }
            docs.set(rel, nextFields);
          }
        }
        return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
      }

      if (tail.endsWith(':runQuery') && method === 'POST') {
        const parentRel = tail.slice(0, -':runQuery'.length).replace(/^\/+/, '');
        const body = JSON.parse(String(init?.body || '{}')) as {
          structuredQuery?: {
            from?: Array<{ collectionId?: string }>;
            where?: {
              fieldFilter?: { field?: { fieldPath?: string }; value?: firestoreRest.FirestoreRawValue };
              compositeFilter?: {
                filters?: Array<{
                  fieldFilter?: { field?: { fieldPath?: string }; value?: firestoreRest.FirestoreRawValue };
                }>;
              };
            };
            limit?: number;
          };
        };
        const sq = body.structuredQuery || {};
        const colId = sq.from?.[0]?.collectionId || '';
        const colPrefix = parentRel ? `${parentRel}/${colId}/` : `${colId}/`;

        const filters: Array<{ fieldPath: string; value: unknown }> = [];
        if (sq.where?.fieldFilter?.field?.fieldPath) {
          filters.push({
            fieldPath: sq.where.fieldFilter.field.fieldPath,
            value: firestoreRest.decodeFirestoreValue(sq.where.fieldFilter.value),
          });
        }
        for (const sub of sq.where?.compositeFilter?.filters || []) {
          if (sub.fieldFilter?.field?.fieldPath) {
            filters.push({
              fieldPath: sub.fieldFilter.field.fieldPath,
              value: firestoreRest.decodeFirestoreValue(sub.fieldFilter.value),
            });
          }
        }

        const matched = Array.from(docs.entries())
          .filter(([k, fields]) => {
            if (!k.startsWith(colPrefix) || k.slice(colPrefix.length).includes('/')) return false;
            return filters.every((f) => firestoreRest.decodeFirestoreValue(fields[f.fieldPath]) === f.value);
          })
          .slice(0, sq.limit || 200)
          .map(([k, fields]) => ({
            document: {
              name: `${basePrefix}/${k}`,
              fields,
              createTime: new Date().toISOString(),
              updateTime: new Date().toISOString(),
            },
          }));
        return new Response(JSON.stringify(matched), { status: 200 });
      }

      const relPath = tail.replace(/^\/+/, '');
      if (method === 'GET') {
        const docFields = docs.get(relPath);
        if (docFields) {
          return new Response(
            JSON.stringify({
              name: `${basePrefix}/${relPath}`,
              fields: docFields,
              createTime: new Date().toISOString(),
              updateTime: new Date().toISOString(),
            }),
            { status: 200 }
          );
        }
        const colPrefix = `${relPath}/`;
        const matches: Array<{ name: string; fields: Record<string, firestoreRest.FirestoreRawValue> }> = [];
        for (const [k, fields] of docs.entries()) {
          if (k.startsWith(colPrefix) && !k.slice(colPrefix.length).includes('/')) {
            matches.push({ name: `${basePrefix}/${k}`, fields });
          }
        }
        if (matches.length > 0 || !relPath.includes('/')) {
          return new Response(JSON.stringify({ documents: matches }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }), { status: 404 });
      }
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  const env: Env = {
    RATE_LIMIT_KV: createMemoryKv(),
    SESSION_SECRET: 'p0-session-secret-0123456789abcdef',
    CREDENTIAL_ENCRYPTION_KEY: 'p0-encrypt-secret-fedcba9876543210',
    ADMIN_USERNAME: 'omar_admin',
    ADMIN_PASSWORD: 'StrongAdminPass!2026',
    NODE_ENV: 'production',
  };

  return {
    docs,
    env,
    signJwt,
    setQuotaWrite429: (v: boolean) => {
      forceQuotaWrite429 = v;
    },
    callApi: (urlPath: string, init: RequestInit = {}, extraHeaders: Record<string, string> = {}) =>
      handleApiRequest(
        new Request(`https://crovo.pages.dev${urlPath}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...extraHeaders,
            ...(init.headers || {}),
          },
        }),
        env
      ),
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test('classifyApiError & shouldRetryRequest classify 429 quota cleanly with zero automatic retries', () => {
  const quotaErr = classifyApiError(429, 'Quota exceeded (RESOURCE_EXHAUSTED)');
  assert.equal(quotaErr.category, 'quota_exceeded');
  assert.equal(quotaErr.kind, 'quota_exceeded');
  assert.equal(quotaErr.retryable, false);
  assert.equal(quotaErr.isQuota, true);
  assert.equal(shouldRetryRequest({ status: 429, message: 'Quota exceeded' }, 0, 3), false);

  const rateErr = classifyApiError(429, 'تم إرسال طلبات كثيرة — انتظر لحظة');
  assert.equal(rateErr.category, 'rate_limited');
  assert.equal(shouldRetryRequest({ status: 429, message: 'انتظر' }, 0, 3), false);

  const timeoutErr = classifyApiError(408, 'Request timed out');
  assert.equal(timeoutErr.category, 'timeout_error');
  assert.equal(timeoutErr.retryable, true);
  assert.equal(shouldRetryRequest({ status: 408, message: 'timeout' }, 0, 2), true);

  const permErr = classifyApiError(403, 'Permission denied');
  assert.equal(permErr.category, 'permission_denied');
  assert.equal(permErr.retryable, false);

  const serverErr = classifyApiError(500, 'Internal error');
  assert.equal(serverErr.category, 'server_error');
  assert.equal(serverErr.retryable, true);
});

test('orderDraft never persists platformPassword, derives deterministic orderCode, builds valid wa.me URL, and gates post-WhatsApp review', () => {
  const restoreWindow = createMemoryWindow();
  try {
    const sanitized = sanitizeDraftForStorage({
      clientRequestId: 'req_test_alpha_1234',
      grade: 'bac1',
      selectedPlatforms: ['qureo'],
      fullName: 'طالب تجريبي',
      platformUsername: 'student_user',
      platformPassword: 'DO_NOT_SAVE_PASSWORD!',
      paymentMethod: 'فودافون كاش',
    });

    assert.equal('platformPassword' in sanitized, false);
    assert.equal(sanitized.orderCode, deriveOrderCodeFromRequestId('req_test_alpha_1234'));
    assert.match(sanitized.orderCode, /^CRV-[A-Z0-9]{6}$/);

    saveSubscriptionDraft(sanitized);
    const rawStored = window.localStorage.getItem(SUBSCRIPTION_DRAFT_KEY) || '';
    assert.equal(rawStored.includes('DO_NOT_SAVE_PASSWORD'), false);
    assert.equal(rawStored.includes('platformPassword'), false);
    assert.equal(loadSubscriptionDraft()?.orderCode, sanitized.orderCode);

    const waUrl = buildSubscriptionWhatsappUrl({
      whatsappNumber: '01550324450',
      orderCode: sanitized.orderCode,
      fullName: 'طالب تجريبي',
      grade: 'bac1',
      platformLabel: 'QUREO',
      platformUsername: 'student_user',
      platformPassword: 'SecretPassword123',
      oldPrice: 100,
      finalPrice: 50,
      offerApplied: true,
      paymentMethod: 'فودافون كاش',
      manualConfirmationNeeded: true,
    });
    assert.ok(waUrl.startsWith('https://wa.me/201550324450?text='));
    const decodedText = decodeURIComponent(waUrl.split('text=')[1]);
    assert.ok(decodedText.includes(sanitized.orderCode));
    assert.ok(decodedText.includes('التأكيد اليدوي'));

    const reviewState: PostWhatsAppReviewState = {
      lastOrderCode: sanitized.orderCode,
      lastOrderId: 'ord_1',
      grade: 'bac1',
      platformLabel: 'QUREO',
      fullName: 'طالب تجريبي',
      savedToServer: false,
      handedOffAt: 100_000,
      submittedOrderCodes: [],
    };
    assert.equal(isEligibleForReturnReviewPrompt(reviewState, 100_000 + 2_000), false);
    assert.equal(
      isEligibleForReturnReviewPrompt(reviewState, 100_000 + RETURN_REVIEW_MIN_ELAPSED_MS + 100),
      true
    );
    assert.equal(
      isEligibleForReturnReviewPrompt(
        { ...reviewState, submittedOrderCodes: [sanitized.orderCode] },
        100_000 + RETURN_REVIEW_MIN_ELAPSED_MS + 100
      ),
      false
    );
  } finally {
    restoreWindow();
  }
});

test('Backend router supports Firestore 429 order fallback, manual WhatsApp order + 409, order concurrency guard, owner/self protection, moderation, ad workflow, and Cairo year analytics', async () => {
  const h = await createRouterTestHarness();
  try {
    const ownerToken = await h.signJwt('owner_uid', '3mars7bry@gmail.com', 'Omar Sabry');
    const secondAdminToken = await h.signJwt('admin2_uid', 'helper@crovo.space', 'Helper Admin');
    const studentToken = await h.signJwt('student_uid', 'student@crovo.space', 'Student One');

    h.docs.set('admins/owner_uid', firestoreRest.encodeDocumentFields({ uid: 'owner_uid', email: '3mars7bry@gmail.com' }));
    h.docs.set(
      'users/owner_uid',
      firestoreRest.encodeDocumentFields({
        uid: 'owner_uid',
        name: 'Omar Sabry',
        email: '3mars7bry@gmail.com',
        grade: 'bac2',
        role: 'admin',
        status: 'active',
      })
    );
    h.docs.set('admins/admin2_uid', firestoreRest.encodeDocumentFields({ uid: 'admin2_uid', email: 'helper@crovo.space' }));
    h.docs.set(
      'users/admin2_uid',
      firestoreRest.encodeDocumentFields({
        uid: 'admin2_uid',
        name: 'Helper Admin',
        email: 'helper@crovo.space',
        grade: 'bac1',
        role: 'admin',
        status: 'active',
      })
    );
    h.docs.set(
      'users/student_uid',
      firestoreRest.encodeDocumentFields({
        uid: 'student_uid',
        name: 'Student One',
        email: 'student@crovo.space',
        grade: 'bac1',
        role: 'user',
        status: 'active',
      })
    );

    // 1. POST /api/orders returns non-blocking fallback receipt when Firestore returns 429 Quota Exceeded
    h.setQuotaWrite429(true);
    const reqId = 'req_quota_p0_9988';
    const quotaOrderRes = await h.callApi('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        clientRequestId: reqId,
        fullName: 'عميل الواتساب',
        grade: 'bac1',
        platforms: ['qureo'],
        platformUsername: 'wa_client',
        platformPassword: 'ClientSecret99',
        paymentMethod: 'فودافون كاش',
      }),
    });
    assert.equal(quotaOrderRes.status, 200);
    const quotaOrderJson = await quotaOrderRes.json();
    assert.equal(quotaOrderJson.savedToServer, false);
    assert.equal(quotaOrderJson.dbSaveStatus, 'quota_exceeded');
    assert.equal(quotaOrderJson.pendingManualConfirmation, true);
    assert.equal(quotaOrderJson.order.orderCode, deriveOrderCodeFromRequestId(reqId));
    assert.equal(quotaOrderJson.order.subscriptionStatus, 'pending_confirmation');
    h.setQuotaWrite429(false);

    // 2. Manual WhatsApp Order + Duplicate orderCode 409 Guard
    const manualRes = await h.callApi(
      '/api/admin/orders/manual',
      {
        method: 'POST',
        body: JSON.stringify({
          orderCode: 'CRV-MANUAL1',
          fullName: 'طالب يدوي',
          grade: 'bac1',
          platforms: ['qureo'],
          platformUsername: 'manual_user_1',
          paymentStatus: 'paid',
          subscriptionStatus: 'pending_confirmation',
        }),
      },
      { Authorization: `Bearer ${ownerToken}` }
    );
    assert.equal(manualRes.status, 201);
    const manualJson = await manualRes.json();
    const manualOrderId = manualJson.order.id;

    const dupManualRes = await h.callApi(
      '/api/admin/orders/manual',
      {
        method: 'POST',
        body: JSON.stringify({
          orderCode: 'CRV-MANUAL1',
          fullName: 'طالب مكرر',
          grade: 'bac1',
          platforms: ['qureo'],
          platformUsername: 'manual_user_2',
        }),
      },
      { Authorization: `Bearer ${ownerToken}` }
    );
    assert.equal(dupManualRes.status, 409);

    // 3. Order PATCH expectedCurrentStatus 409 Race Guard
    const okPatch = await h.callApi(
      `/api/admin/orders/${manualOrderId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ expectedCurrentStatus: 'new', status: 'reviewing', adminNote: 'تمت المراجعة' }),
      },
      { Authorization: `Bearer ${ownerToken}` }
    );
    assert.equal(okPatch.status, 200);

    const stalePatch = await h.callApi(
      `/api/admin/orders/${manualOrderId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ expectedCurrentStatus: 'new', status: 'completed' }),
      },
      { Authorization: `Bearer ${ownerToken}` }
    );
    assert.equal(stalePatch.status, 409);

    // 4. PATCH /api/admin/users/:id blocks self-modification & 3mars7bry@gmail.com owner protection -> 403
    const selfPatch = await h.callApi(
      '/api/admin/users/admin2_uid',
      {
        method: 'PATCH',
        body: JSON.stringify({ role: 'user' }),
      },
      { Authorization: `Bearer ${secondAdminToken}` }
    );
    assert.equal(selfPatch.status, 403);

    const ownerDemote = await h.callApi(
      '/api/admin/users/owner_uid',
      {
        method: 'PATCH',
        body: JSON.stringify({ role: 'user', status: 'suspended' }),
      },
      { Authorization: `Bearer ${secondAdminToken}` }
    );
    assert.equal(ownerDemote.status, 403);

    // 5. Post-WhatsApp Comment Moderation Pending + Duplicate orderCode 409
    const cmtRes = await h.callApi(
      '/api/comments',
      {
        method: 'POST',
        body: JSON.stringify({
          authorName: 'Student One',
          grade: 'أولى بكالوريا',
          rating: 5,
          content: 'تجربة ممتازة وسريعة بعد التواصل على واتساب',
          moderationPending: true,
          orderCode: 'CRV-POSTWA1',
          source: 'post_whatsapp',
        }),
      },
      { Authorization: `Bearer ${studentToken}` }
    );
    assert.equal(cmtRes.status, 201);
    const cmtJson = await cmtRes.json();
    assert.equal(cmtJson.moderationPending, true);
    assert.equal(cmtJson.comment.status, 'pending');

    const dupCmtRes = await h.callApi(
      '/api/comments',
      {
        method: 'POST',
        body: JSON.stringify({
          authorName: 'Student One',
          grade: 'أولى بكالوريا',
          rating: 5,
          content: 'محاولة تقييم مكرر لنفس الطلب',
          moderationPending: true,
          orderCode: 'CRV-POSTWA1',
          source: 'post_whatsapp',
        }),
      },
      { Authorization: `Bearer ${studentToken}` }
    );
    assert.equal(dupCmtRes.status, 409);

    // 6. PUT /api/admin/settings libraryAdWorkflowAction workflow (save_draft does NOT overwrite live until publish)
    const draftRes = await h.callApi(
      '/api/admin/settings',
      {
        method: 'PUT',
        body: JSON.stringify({
          libraryAdWorkflowAction: 'save_draft',
          libraryAdDraft: {
            title: 'مسودة إعلان جديد',
            subtitle: 'تفاصيل المسودة فقط',
            priceText: '50 جنيه',
            ctaText: 'جرّب الآن',
          },
        }),
      },
      { Authorization: `Bearer ${ownerToken}` }
    );
    assert.equal(draftRes.status, 200);
    const draftJson = await draftRes.json();
    assert.notEqual(draftJson.config.libraryAd.title, 'مسودة إعلان جديد');
    assert.equal(draftJson.config.libraryAd.draft.title, 'مسودة إعلان جديد');
    assert.equal(draftJson.config.libraryAd.draft.workflowStatus, 'draft');

    const pubRes = await h.callApi(
      '/api/admin/settings',
      {
        method: 'PUT',
        body: JSON.stringify({ libraryAdWorkflowAction: 'publish' }),
      },
      { Authorization: `Bearer ${ownerToken}` }
    );
    assert.equal(pubRes.status, 200);
    const pubJson = await pubRes.json();
    assert.equal(pubJson.config.libraryAd.title, 'مسودة إعلان جديد');
    assert.equal(pubJson.config.libraryAd.workflowStatus, 'published');

    // 7. Analytics range=year works and returns yearly buckets
    h.docs.set(
      'analytics_daily/2026-02-10',
      firestoreRest.encodeDocumentFields({
        day: '2026-02-10',
        visits: 42,
        uniqueVisitors: 19,
        libraryOpens: 8,
        searches: 3,
      })
    );
    const yearAnalyticsRes = await h.callApi('/api/admin/analytics?range=year', {}, { Authorization: `Bearer ${ownerToken}` });
    assert.equal(yearAnalyticsRes.status, 200);
    const yearAnalyticsJson = await yearAnalyticsRes.json();
    assert.equal(yearAnalyticsJson.range, 'year');
    assert.ok(Array.isArray(yearAnalyticsJson.timeline));
  } finally {
    h.restore();
  }
});
