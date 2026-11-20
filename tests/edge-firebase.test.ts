import test from 'node:test';
import assert from 'node:assert/strict';
import * as edgeCrypto from '../functions/_lib/crypto.ts';
import * as firestoreRest from '../functions/_lib/firestoreRest.ts';
import { checkRateLimit } from '../functions/_lib/rateLimit.ts';
import {
  encryptWebPushPayload,
  resolveVapidKeys,
  sendWebPushMessage,
} from '../functions/_lib/webPush.ts';
import {
  clearPublicReadCache,
  handleApiRequest,
  resetFirestoreQuotaCooldown,
  setAllowQuotaCooldownInMock,
} from '../functions/_lib/router.ts';
import { runLiveFirestoreMerge, validateSafeRemoteUrl } from '../functions/_lib/liveMigration.ts';
import { parseD1SqlExport } from '../scripts/migrate-sqlite-to-firestore.ts';
import type { Env, KVNamespace } from '../functions/_lib/types.ts';

function createMemoryKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, options?: { type?: 'text' | 'json' }) {
      const val = store.get(key) ?? null;
      if (val === null) return null;
      if (options?.type === 'json') {
        return JSON.parse(val);
      }
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

interface MockFirestoreHarness {
  docs: Map<string, Record<string, firestoreRest.FirestoreRawValue>>;
  cfg: firestoreRest.FirestoreConfig;
  restoreFetch: () => void;
  setOutage: (failWith503: boolean) => void;
  setQuotaError: (failWith429: boolean) => void;
}

function installMockFirestoreFetch(): MockFirestoreHarness {
  const docs = new Map<string, Record<string, firestoreRest.FirestoreRawValue>>();
  const cfg = firestoreRest.resolveFirestoreConfig({});
  const basePrefix = firestoreRest.getDocumentsBasePath(cfg);
  const originalFetch = globalThis.fetch;
  let forceOutage = false;
  let forceQuota429 = false;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (forceQuota429 && urlStr.includes('firestore.googleapis.com')) {
      return new Response(
        JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded.' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (forceOutage && urlStr.includes('firestore.googleapis.com')) {
      return new Response(
        JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'Firestore simulated outage' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (urlStr.includes('firestore.googleapis.com')) {
      const url = new URL(urlStr);
      const marker = `/v1/${basePrefix}`;
      const markerIdx = url.pathname.indexOf(marker);
      const tail = markerIdx >= 0 ? url.pathname.slice(markerIdx + marker.length) : '';
      const method = (init?.method || 'GET').toUpperCase();

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
                JSON.stringify({ error: { code: 409, status: 'ALREADY_EXISTS', message: 'Document exists' } }),
                { status: 409 }
              );
            }
            if (w.currentDocument?.exists === true && !existsNow) {
              return new Response(
                JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Document missing' } }),
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
              fieldFilter?: { field?: { fieldPath?: string }; op?: string; value?: firestoreRest.FirestoreRawValue };
              compositeFilter?: {
                filters?: Array<{
                  fieldFilter?: { field?: { fieldPath?: string }; op?: string; value?: firestoreRest.FirestoreRawValue };
                }>;
              };
            };
            startAt?: { values?: Array<{ referenceValue?: string }> };
            limit?: number;
          };
        };
        const sq = body.structuredQuery || {};
        const colId = sq.from?.[0]?.collectionId || '';
        const colPrefix = parentRel ? `${parentRel}/${colId}/` : `${colId}/`;

        const activeFilters: Array<{ fieldPath: string; value: unknown }> = [];
        if (sq.where?.fieldFilter?.field?.fieldPath) {
          activeFilters.push({
            fieldPath: sq.where.fieldFilter.field.fieldPath,
            value: firestoreRest.decodeFirestoreValue(sq.where.fieldFilter.value),
          });
        }
        for (const sub of sq.where?.compositeFilter?.filters || []) {
          if (sub.fieldFilter?.field?.fieldPath) {
            activeFilters.push({
              fieldPath: sub.fieldFilter.field.fieldPath,
              value: firestoreRest.decodeFirestoreValue(sub.fieldFilter.value),
            });
          }
        }

        let matchedEntries = Array.from(docs.entries())
          .filter(([k, fields]) => {
            if (!k.startsWith(colPrefix) || k.slice(colPrefix.length).includes('/')) return false;
            return activeFilters.every((f) => {
              const docVal = firestoreRest.decodeFirestoreValue(fields[f.fieldPath]);
              return docVal === f.value;
            });
          })
          .sort(([a], [b]) => a.localeCompare(b));

        const cursorRef = sq.startAt?.values?.[0]?.referenceValue;
        if (cursorRef) {
          const cursorRel = cursorRef.startsWith(`${basePrefix}/`)
            ? cursorRef.slice(`${basePrefix}/`.length)
            : cursorRef;
          matchedEntries = matchedEntries.filter(([k]) => k.localeCompare(cursorRel) > 0);
        }

        const limited =
          typeof sq.limit === 'number' && sq.limit > 0 ? matchedEntries.slice(0, sq.limit) : matchedEntries;

        const rows = limited.map(([k, fields]) => ({
          document: {
            name: `${basePrefix}/${k}`,
            fields,
            createTime: new Date().toISOString(),
            updateTime: new Date().toISOString(),
          },
        }));
        return new Response(JSON.stringify(rows), { status: 200 });
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
        return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Not found' } }), {
          status: 404,
        });
      }

      if (method === 'DELETE') {
        docs.delete(relPath);
        return new Response(JSON.stringify({}), { status: 200 });
      }
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  return {
    docs,
    cfg,
    restoreFetch: () => {
      globalThis.fetch = originalFetch;
    },
    setOutage: (v: boolean) => {
      forceOutage = v;
    },
    setQuotaError: (v: boolean) => {
      forceQuota429 = v;
    },
  };
}

test('Edge WebCrypto AES-256-GCM, HMAC tokens, and safeCompareStrings work deterministically', async () => {
  const key = 'edge-test-encryption-key-2026';
  const encrypted = await edgeCrypto.encryptSecret('StudentPass!42', key);
  assert.notEqual(encrypted.encrypted, 'StudentPass!42');
  const decrypted = await edgeCrypto.decryptSecret(encrypted, key);
  assert.equal(decrypted, 'StudentPass!42');

  const secret = 'hmac-test-secret-012345';
  const token = await edgeCrypto.signToken({ vid: 'v_edge_1', exp: Date.now() + 60_000 }, secret);
  const verified = await edgeCrypto.verifyToken<{ vid: string }>(token, secret);
  assert.equal(verified?.vid, 'v_edge_1');

  const tampered = `${token.slice(0, -4)}AAAA`;
  assert.equal(await edgeCrypto.verifyToken(tampered, secret), null);

  assert.equal(await edgeCrypto.safeCompareStrings('abc123', 'abc123'), true);
  assert.equal(await edgeCrypto.safeCompareStrings('abc123', 'abc124'), false);
});

test('Firestore REST encoder/decoder handles nested maps, arrays, ints, floats, and errors cleanly', () => {
  const cfg = firestoreRest.resolveFirestoreConfig({});
  const sample = {
    id: 'test_1',
    count: 42,
    ratio: 0.75,
    active: true,
    tags: ['bac1', 'js'],
    nested: { label: 'CROVO' },
    nothing: null,
  };

  const fields = firestoreRest.encodeDocumentFields(sample);
  assert.equal(fields.count.integerValue, '42');
  assert.equal(fields.ratio.doubleValue, 0.75);
  assert.equal(fields.active.booleanValue, true);

  const decoded = firestoreRest.decodeDocument<typeof sample>(
    {
      name: `${firestoreRest.getDocumentsBasePath(cfg)}/site_config/test_1`,
      fields,
    },
    cfg
  );
  assert.equal(decoded.id, 'test_1');
  assert.equal(decoded.data.count, 42);
  assert.equal(decoded.data.ratio, 0.75);
  assert.deepEqual(decoded.data.tags, ['bac1', 'js']);
  assert.deepEqual(decoded.data.nested, { label: 'CROVO' });
  assert.equal(decoded.data.nothing, null);
});

test('Distributed rate limiter enforces window caps across KV and falls back gracefully in memory', async () => {
  const kv = createMemoryKv();
  const env: Partial<Env> = { RATE_LIMIT_KV: kv };

  const r1 = await checkRateLimit(env, 'test_kv', 'actor_1', 2, 60);
  const r2 = await checkRateLimit(env, 'test_kv', 'actor_1', 2, 60);
  const r3 = await checkRateLimit(env, 'test_kv', 'actor_1', 2, 60);

  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 1);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 0);
  assert.equal(r3.allowed, false);
  assert.equal(r3.remaining, 0);
  assert.equal(kv.store.size, 1);

  const mem1 = await checkRateLimit({}, 'test_mem', 'actor_2', 1, 60);
  const mem2 = await checkRateLimit({}, 'test_mem', 'actor_2', 1, 60);
  assert.equal(mem1.allowed, true);
  assert.equal(mem2.allowed, false);
});

test('WebPush VAPID keys fail closed in production when missing and encrypt RFC 8291 aes128gcm payloads', async () => {
  const prodMissing = await resolveVapidKeys({ NODE_ENV: 'production' });
  assert.equal(prodMissing, null);

  const devGenerated = await resolveVapidKeys({ NODE_ENV: 'development' });
  assert.ok(devGenerated);
  assert.equal(devGenerated.ephemeral, true);

  // Create valid test subscriber ECDH P-256 keypair + auth secret
  const subscriberKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', subscriberKeys.publicKey));
  const b64Url = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const authBytes = new Uint8Array(16);
  crypto.getRandomValues(authBytes);

  const encrypted = await encryptWebPushPayload(
    JSON.stringify({ title: 'CROVO', body: 'Test alert' }),
    { p256dh: b64Url(rawPub), auth: b64Url(authBytes) }
  );

  // Header check: 16B salt + 4B BE record size (4096) + 1B idlen (65) + 65B P-256 point (0x04) + ciphertext
  assert.ok(encrypted.byteLength > 86);
  const view = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
  assert.equal(view.getUint32(16, false), 4096);
  assert.equal(encrypted[20], 65);
  assert.equal(encrypted[21], 0x04);

  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response('', { status: 410 })) as typeof fetch;
    const expiredRes = await sendWebPushMessage(
      { endpoint: 'https://push.example.com/sub/1', p256dh: b64Url(rawPub), auth: b64Url(authBytes) },
      { title: 'Hi', body: 'Test' },
      devGenerated
    );
    assert.equal(expiredRes.ok, false);
    assert.equal(expiredRes.expired, true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('parseD1SqlExport parses Cloudflare D1 multi-row SQL inserts accurately', () => {
  const sampleSql = `
    -- Comment line
    INSERT OR IGNORE INTO "users" ("id", "serial_number", "name", "email", "grade", "role", "status") VALUES
    ('uid_1', 'CRV-1002', 'عمر صبري', 'omar@crovo.space', 'bac2', 'user', 'active'),
    ('uid_2', 'CRV-1003', 'طالب ''متميز''', 'student@crovo.space', 'bac1', 'user', 'active');
    INSERT OR IGNORE INTO "settings" ("key", "value") VALUES ('qureo_offer_price', '45');
  `;
  const parsed = parseD1SqlExport(sampleSql);
  assert.equal(parsed.users.length, 2);
  assert.equal(parsed.users[0].name, 'عمر صبري');
  assert.equal(parsed.users[1].name, "طالب 'متميز'");
  assert.equal(parsed.settings.length, 1);
  assert.equal(parsed.settings[0].value, '45');
});

test('Edge Router (Firebase Firestore backend) enforces security, pricing, outage failures, idempotency, and KV rate limiting', async () => {
  const harness = installMockFirestoreFetch();
  const kv = createMemoryKv();
  const env: Env = {
    RATE_LIMIT_KV: kv,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    CREDENTIAL_ENCRYPTION_KEY: 'test-encrypt-secret-fedcba9876543210',
    ADMIN_USERNAME: 'omar_admin',
    ADMIN_PASSWORD: 'StrongAdminPass!2026',
    NODE_ENV: 'production',
  };

  const callApi = (urlPath: string, init: RequestInit = {}, extraHeaders: Record<string, string> = {}) =>
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
    );

  try {
    // 1. Health check OK + outage returns 503 (never fake OK)
    const okHealth = await callApi('/api/health');
    assert.equal(okHealth.status, 200);
    const okJson = await okHealth.json();
    assert.equal(okJson.ok, true);
    assert.equal(okJson.engine, 'firebase-firestore');

    harness.setOutage(true);
    const failHealth = await callApi('/api/health');
    assert.equal(failHealth.status, 503);
    const failJson = await failHealth.json();
    assert.equal(failJson.ok, false);
    harness.setOutage(false);

    // 2. Legacy student password auth routes retired -> 410 Gone
    for (const legacyRoute of ['/api/auth/register', '/api/auth/login']) {
      const r = await callApi(legacyRoute, { method: 'POST', body: '{}' });
      assert.equal(r.status, 410);
    }

    // 2b. Restored Admin username + password login, cookie session, public-only fallback, & logout
    const badAdminLogin = await callApi('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'omar_admin', password: 'WrongPassword' }),
    });
    assert.equal(badAdminLogin.status, 401);

    const goodAdminLogin = await callApi('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'omar_admin', password: 'StrongAdminPass!2026' }),
    });
    assert.equal(goodAdminLogin.status, 200);
    const adminLoginJson = await goodAdminLogin.json();
    assert.equal(adminLoginJson.ok, true);
    assert.equal(adminLoginJson.username, 'omar_admin');

    const adminCookieMatch = (goodAdminLogin.headers.get('set-cookie') || '').match(/crovo_admin_session=([^;]+)/);
    assert.ok(adminCookieMatch, 'Expected crovo_admin_session HttpOnly cookie');
    const adminCookieHeader = `crovo_admin_session=${adminCookieMatch[1]}`;

    const adminMeRes = await callApi('/api/admin/me', {}, { Cookie: adminCookieHeader });
    assert.equal(adminMeRes.status, 200);
    const adminMeJson = await adminMeRes.json();
    assert.equal(adminMeJson.authenticated, true);
    assert.equal(adminMeJson.username, 'omar_admin');

    const adminOverviewRes = await callApi('/api/admin/overview', {}, { Cookie: adminCookieHeader });
    assert.equal(adminOverviewRes.status, 200);
    const adminOverviewJson = await adminOverviewRes.json();
    assert.equal(adminOverviewJson.stats.requiresFirebaseLink, true);

    const adminLogoutRes = await callApi('/api/admin/logout', { method: 'POST' }, { Cookie: adminCookieHeader });
    assert.equal(adminLogoutRes.status, 200);
    assert.ok((adminLogoutRes.headers.get('set-cookie') || '').includes('Max-Age=0'));

    // 3. Public library bundle, config, poll, and question_stats via :runQuery
    const libRes = await callApi('/api/library?grade=bac1&section=js');
    assert.equal(libRes.status, 200);
    const libJson = await libRes.json();
    assert.ok(libJson.chapters.length >= 42);

    const cfgRes = await callApi('/api/config');
    assert.equal(cfgRes.status, 200);
    const cfgJson = await cfgRes.json();
    assert.equal(cfgJson.qureoOfferPrice, 50);

    harness.docs.set(
      'polls/poll_extend_offer',
      firestoreRest.encodeDocumentFields({
        id: 'poll_extend_offer',
        question: 'نمد العرض؟',
        options: [
          { key: 'extend', label: 'أيوة', count: 12 },
          { key: 'enough', label: 'لا', count: 3 },
        ],
        totalVotes: 15,
        isOpen: true,
        createdAt: '2026-04-01T00:00:00.000Z',
      })
    );
    const pollRes = await callApi('/api/poll');
    assert.equal(pollRes.status, 200);
    const pollJson = await pollRes.json();
    assert.equal(pollJson.totalVotes, 15);
    assert.equal(pollJson.extendCount, 12);

    harness.docs.set(
      'question_stats/bac1-js-1-0',
      firestoreRest.encodeDocumentFields({
        questionKey: 'bac1-js-1-0',
        grade: 'bac1',
        section: 'js',
        chapterNum: 1,
        qIndex: 0,
        questionTitle: 'Test Q',
        copyCount: 7,
      })
    );
    const qStatsRes = await callApi('/api/questions/stats');
    assert.equal(qStatsRes.status, 200);
    const qStatsJson = await qStatsRes.json();
    assert.equal(qStatsJson.totalCopies, 7);

    // 3b. Unified /api/bootstrap endpoint returns config, likes, library, poll, comments, and questionStats in 1 call
    const bootRes = await callApi('/api/bootstrap?grade=bac1&section=js');
    assert.equal(bootRes.status, 200);
    assert.ok((bootRes.headers.get('cache-control') || '').includes('stale-while-revalidate'));
    const bootJson = await bootRes.json();
    assert.equal(bootJson.config.qureoOfferPrice, 50);
    assert.ok(Array.isArray(bootJson.library.chapters) && bootJson.library.chapters.length >= 42);
    assert.equal(bootJson.poll.totalVotes, 15);
    assert.equal(bootJson.questionStats.totalCopies, 7);
    assert.equal(bootJson.likes.itemKey, 'tool');
    assert.ok(Array.isArray(bootJson.comments));

    // 4. Unauthenticated protected endpoints fail closed -> 401
    const voteUnauth = await callApi('/api/poll/vote', { method: 'POST', body: JSON.stringify({ choice: 'extend' }) });
    assert.equal(voteUnauth.status, 401);

    const adminUnauth = await callApi('/api/admin/overview');
    assert.equal(adminUnauth.status, 401);

    // 5. Order submission overrides client-tampered pricing, encrypts password, deduplicates via KV, & omits secret from response
    const orderPayload = {
      clientRequestId: 'req_test_dedup_01',
      fullName: 'عمر صبري',
      grade: 'bac1',
      platforms: ['qureo'],
      platformUsername: 'omar_student',
      platformPassword: 'SecretPassword#99',
      paymentMethod: 'إنستا باي',
      oldPrice: 1,
      finalPrice: 1,
    };
    const ordRes = await callApi('/api/orders', { method: 'POST', body: JSON.stringify(orderPayload) });
    assert.equal(ordRes.status, 201);
    const ordJson = await ordRes.json();
    assert.equal(ordJson.order.oldPrice, 100);
    assert.equal(ordJson.order.finalPrice, 50);
    assert.equal('platformPassword' in ordJson.order, false);
    assert.equal('encryptedPassword' in ordJson.order, false);

    // Inspect stored Firestore document to ensure password is encrypted AES-GCM
    const storedOrder = harness.docs.get('orders/ord_req_test_dedup_01');
    assert.ok(storedOrder);
    assert.notEqual(storedOrder.encryptedPassword.stringValue, 'SecretPassword#99');
    const decryptedPass = await edgeCrypto.decryptSecret(
      {
        encrypted: String(storedOrder.encryptedPassword.stringValue),
        iv: String(storedOrder.passwordIv.stringValue),
        authTag: String(storedOrder.passwordAuthTag.stringValue),
      },
      env.CREDENTIAL_ENCRYPTION_KEY!
    );
    assert.equal(decryptedPass, 'SecretPassword#99');

    // Duplicate clientRequestId returns cached KV deduplicated response
    const visitorTok = ordRes.headers.get('X-Crovo-Visitor-Token') || '';
    const dupRes = await callApi(
      '/api/orders',
      { method: 'POST', body: JSON.stringify(orderPayload) },
      { 'X-Crovo-Visitor': visitorTok }
    );
    assert.equal(dupRes.status, 200);
    const dupJson = await dupRes.json();
    assert.equal(dupJson.deduplicated, true);

    // 6. Rate limiting across requests triggers 429 + Retry-After on 9th order attempt in window
    let hit429 = false;
    for (let i = 0; i < 10; i++) {
      const r = await callApi(
        '/api/orders',
        {
          method: 'POST',
          body: JSON.stringify({ ...orderPayload, clientRequestId: `req_rl_${i}` }),
        },
        { 'X-Crovo-Visitor': visitorTok }
      );
      if (r.status === 429) {
        hit429 = true;
        assert.ok(r.headers.get('Retry-After'));
        break;
      }
    }
    assert.equal(hit429, true);
  } finally {
    harness.restoreFetch();
  }
});

test('Live Migration enforces SSRF safety, dry-run preview, monotonic Math.max merge, and analytics_daily aggregation', async () => {
  // 1. SSRF checks
  assert.throws(() => validateSafeRemoteUrl('http://crovo-space.ai.studio'), /https:\/\//);
  assert.throws(() => validateSafeRemoteUrl('https://localhost:3000'), /داخلية|محلية/);
  assert.throws(() => validateSafeRemoteUrl('https://127.0.0.1/api'), /داخلية|محلية/);
  assert.equal(validateSafeRemoteUrl('https://crovo-space.ai.studio/').origin, 'https://crovo-space.ai.studio');

  const harness = installMockFirestoreFetch();
  const kv = createMemoryKv();
  const env: Env = {
    RATE_LIMIT_KV: kv,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    CREDENTIAL_ENCRYPTION_KEY: 'test-encrypt-secret-fedcba9876543210',
    ADMIN_USERNAME: 'omar_admin',
    ADMIN_PASSWORD: 'StrongAdminPass!2026',
    NODE_ENV: 'production',
  };

  // Seed initial lower values in Firestore to ensure Math.max never regresses existing counts
  harness.docs.set('counters/tool', firestoreRest.encodeDocumentFields({ id: 'tool', count: 7 }));
  harness.docs.set('counters/user_serial', firestoreRest.encodeDocumentFields({ id: 'user_serial', count: 1005 }));
  harness.docs.set(
    'question_stats/bac1-js-1-0',
    firestoreRest.encodeDocumentFields({
      questionKey: 'bac1-js-1-0',
      grade: 'bac1',
      section: 'js',
      chapterNum: 1,
      qIndex: 0,
      questionTitle: 'Existing High Q',
      copyCount: 50,
    })
  );
  harness.docs.set(
    'polls/poll_extend_offer',
    firestoreRest.encodeDocumentFields({
      id: 'poll_extend_offer',
      question: 'إيه رأيكم نمد العرض؟',
      options: [
        { key: 'extend', label: 'أيوة', count: 14 },
        { key: 'enough', label: 'لا', count: 2 },
      ],
      totalVotes: 16,
      isOpen: true,
    })
  );

  // Create RS256 keypair + signed Firebase Admin JWT and mock Google JWK endpoint on top of mock Firestore fetch
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
  pubJwk.kid = 'test-kid-1';

  const toB64Url = (buf: Uint8Array) =>
    btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const nowSec = Math.floor(Date.now() / 1000);
  const hdrB64 = toB64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'test-kid-1' })));
  const payB64 = toB64Url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: 'sincere-impact-wbvhw',
        iss: 'https://securetoken.google.com/sincere-impact-wbvhw',
        sub: 'admin_omar_uid',
        email: '3mars7bry@gmail.com',
        email_verified: true,
        name: 'Omar Sabry',
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
  const adminIdToken = `${hdrB64}.${payB64}.${toB64Url(new Uint8Array(sigBuf))}`;

  harness.docs.set(
    'admins/admin_omar_uid',
    firestoreRest.encodeDocumentFields({
      uid: 'admin_omar_uid',
      email: '3mars7bry@gmail.com',
    })
  );
  harness.docs.set(
    'users/admin_omar_uid',
    firestoreRest.encodeDocumentFields({
      uid: 'admin_omar_uid',
      name: 'Omar Sabry',
      email: '3mars7bry@gmail.com',
      grade: 'bac1',
      role: 'admin',
      status: 'active',
    })
  );

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes('securetoken@system.gserviceaccount.com')) {
      return new Response(JSON.stringify({ keys: [pubJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
      });
    }
    return prevFetch(input, init);
  }) as typeof fetch;

  const sampleRemoteSnapshot = {
    overview: {
      likes: [{ itemKey: 'tool', count: 9 }],
      poll: {
        pollId: 'poll_extend_offer',
        question: 'إيه رأيكم نمد العرض؟',
        options: [
          { key: 'extend', label: 'أيوة', count: 5 },
          { key: 'enough', label: 'لا', count: 4 },
        ],
        totalVotes: 9,
      },
      orders: [
        {
          id: 'ord_live_101',
          orderCode: 'CRV-301',
          fullName: 'محمد محمود',
          grade: 'bac1',
          platformLabel: 'QUREO',
          platformUsername: 'mohamed_301',
          oldPrice: 100,
          finalPrice: 50,
          offerApplied: true,
          paymentMethod: 'Vodafone Cash',
          status: 'completed',
        },
      ],
    },
    usersEndpoint: {
      users: Array.from({ length: 12 }, (_, idx) => ({
        id: `live_u_${idx + 1}`,
        serialNumber: `CRV-${1300 + idx}`,
        name: `عميل قديم ${idx + 1}`,
        email: `client${idx + 1}@example.com`,
        grade: idx % 2 === 0 ? 'bac1' : 'bac2',
        role: 'user',
        status: 'active',
      })),
    },
    commentsEndpoint: {
      comments: [
        {
          id: 'cmt_cf12ed9641880b10',
          authorName: 'Malik Muhammad',
          grade: 'أولى بكالوريا',
          rating: 5,
          content: 'منصة ممتازة وسريعة جداً في التنفيذ',
          isVerified: true,
          likesCount: 3,
        },
      ],
    },
    questionStatsEndpoint: {
      copyCounts: {
        'bac1-js-1-0': 10, // lower than existing 50 -> must stay 50
        'bac1-js-2-1': 37, // new -> must be created with 37
      },
    },
    analyticsEndpoint: {
      visitors: { totalVisits: 540, uniqueVisitors: 320 },
      timeline: [
        { day: '2026-10-15', visits: 300, uniqueVisitors: 180, libraryOpens: 120, searches: 45 },
        { day: '2026-10-16', visits: 240, uniqueVisitors: 140, libraryOpens: 90, searches: 30 },
      ],
    },
  };

  try {
    // 2. Cookie-only session without Firebase Google idToken returns 403 requiresFirebaseLink
    const loginRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'omar_admin', password: 'StrongAdminPass!2026' }),
      }),
      env
    );
    const cookieVal = (loginRes.headers.get('set-cookie') || '').match(/crovo_admin_session=([^;]+)/)?.[1] || '';

    const blockedRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/import-live-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `crovo_admin_session=${cookieVal}` },
        body: JSON.stringify({ mode: 'import_snapshot', dryRun: true, snapshot: sampleRemoteSnapshot }),
      }),
      env
    );
    assert.equal(blockedRes.status, 403);
    const blockedJson = await blockedRes.json();
    assert.equal(blockedJson.requiresFirebaseLink, true);

    // 3. Dry-run preview returns exact remote vs current counts without mutating Firestore
    const dryRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/import-live-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({
          mode: 'import_snapshot',
          dryRun: true,
          snapshot: sampleRemoteSnapshot,
          sourceLabel: 'crovo-space.ai.studio',
        }),
      }),
      env
    );
    assert.equal(dryRes.status, 200);
    const dryJson = await dryRes.json();
    assert.equal(dryJson.dryRun, true);
    assert.equal(dryJson.remoteCounts.users, 12);
    assert.equal(dryJson.remoteCounts.toolLikes, 9);
    assert.equal(dryJson.remoteCounts.totalVisits, 540);
    assert.equal(firestoreRest.decodeFirestoreValue(harness.docs.get('counters/tool')?.count), 7);

    // 4. Direct merge verifies monotonic Math.max and additive inserts
    const applyRes = await runLiveFirestoreMerge({
      cfg: harness.cfg,
      idToken: adminIdToken,
      mode: 'import_snapshot',
      sourceLabel: 'crovo-space.ai.studio',
      rawPayload: sampleRemoteSnapshot,
      dryRun: false,
    });
    assert.equal(applyRes.ok, true);
    assert.equal(applyRes.applied.errors, 0);

    // Counters upgraded monotonically: tool likes 7->9, serial 1005->1311
    assert.equal(firestoreRest.decodeFirestoreValue(harness.docs.get('counters/tool')?.count), 9);
    assert.equal(firestoreRest.decodeFirestoreValue(harness.docs.get('counters/user_serial')?.count), 1311);

    // Question stats: existing 50 preserved (> 10), missing 37 added
    assert.equal(firestoreRest.decodeFirestoreValue(harness.docs.get('question_stats/bac1-js-1-0')?.copyCount), 50);
    assert.equal(firestoreRest.decodeFirestoreValue(harness.docs.get('question_stats/bac1-js-2-1')?.copyCount), 37);

    // Poll options took Math.max per option: extend=max(14,5)=14, enough=max(2,4)=4, totalVotes=18
    const mergedPoll = firestoreRest.decodeDocument<Record<string, unknown>>(
      { name: `${firestoreRest.getDocumentsBasePath(harness.cfg)}/polls/poll_extend_offer`, fields: harness.docs.get('polls/poll_extend_offer') },
      harness.cfg
    );
    assert.equal(mergedPoll.data.totalVotes, 18);

    // Comment Malik Muhammad & Order & All 12 Users migrated cleanly
    assert.ok(harness.docs.has('comments/cmt_cf12ed9641880b10'));
    assert.ok(harness.docs.has('orders/ord_live_101'));
    assert.ok(harness.docs.has('users/live_u_12'));
    assert.ok(harness.docs.has('analytics_daily/2026-10-15'));

    // 5. Analytics API (range=all) reflects analytics_daily historical visits + all users
    const analyticsRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/analytics?range=all', {
        headers: { Authorization: `Bearer ${adminIdToken}` },
      }),
      env
    );
    assert.equal(analyticsRes.status, 200);
    const analyticsJson = await analyticsRes.json();
    assert.equal(analyticsJson.visitors.totalVisits, 540);
    assert.equal(analyticsJson.visitors.uniqueVisitors, 320);
    assert.equal(analyticsJson.users.totalRegistered, 13);
    assert.ok(analyticsJson.timeline.some((t: { day: string; visits: number }) => t.day === '2026-10-15' && t.visits === 300));
  } finally {
    harness.restoreFetch();
  }
});

test('Admin recovery protections preserve unclassified grades, distinguish DB errors, create pre-mutation backups, and never overwrite existing docs', async () => {
  const harness = installMockFirestoreFetch();
  const kv = createMemoryKv();
  const env: Env = {
    RATE_LIMIT_KV: kv,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    CREDENTIAL_ENCRYPTION_KEY: 'test-encrypt-secret-fedcba9876543210',
    ADMIN_USERNAME: 'omar_admin',
    ADMIN_PASSWORD: 'StrongAdminPass!2026',
    NODE_ENV: 'production',
  };

  // Generate ephemeral RS256 Firebase Admin JWT
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
  pubJwk.kid = 'test-kid-2';
  const toB64Url = (buf: Uint8Array) =>
    btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const nowSec = Math.floor(Date.now() / 1000);
  const hdrB64 = toB64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'test-kid-2' })));
  const payB64 = toB64Url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: 'sincere-impact-wbvhw',
        iss: 'https://securetoken.google.com/sincere-impact-wbvhw',
        sub: 'admin_omar_uid',
        email: '3mars7bry@gmail.com',
        email_verified: true,
        name: 'Omar Sabry',
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
  const adminIdToken = `${hdrB64}.${payB64}.${toB64Url(new Uint8Array(sigBuf))}`;

  harness.docs.set(
    'admins/admin_omar_uid',
    firestoreRest.encodeDocumentFields({ uid: 'admin_omar_uid', email: '3mars7bry@gmail.com' })
  );
  harness.docs.set(
    'users/u_bac1',
    firestoreRest.encodeDocumentFields({
      name: 'طالب أولى',
      email: 'bac1@example.com',
      grade: 'bac1',
      role: 'user',
      status: 'active',
      createdAt: '2026-10-01T10:00:00.000Z',
    })
  );
  harness.docs.set(
    'users/u_bac2',
    firestoreRest.encodeDocumentFields({
      name: 'طالب تانية',
      email: 'bac2@example.com',
      grade: 'bac2',
      role: 'user',
      status: 'active',
      createdAt: '2026-10-02T10:00:00.000Z',
    })
  );
  harness.docs.set(
    'users/u_missing_grade',
    firestoreRest.encodeDocumentFields({
      name: 'عميل بمرحلة ناقصة',
      email: 'missing@example.com',
      role: 'user',
      status: 'active',
      createdAt: '2026-10-03T10:00:00.000Z',
    })
  );
  harness.docs.set(
    'users/u_invalid_grade',
    firestoreRest.encodeDocumentFields({
      name: 'عميل بمرحلة غير صالحة',
      email: 'invalid@example.com',
      grade: 'bac3_legacy',
      role: 'user',
      status: 'active',
      createdAt: '2026-10-04T10:00:00.000Z',
    })
  );

  // Pre-seed custom site_config & bundle to verify migrate-legacy & settings protections
  harness.docs.set(
    'site_config/public',
    firestoreRest.encodeDocumentFields({
      qureoOfferPrice: 77,
      qureoOldPrice: 150,
      ordersEnabled: true,
    })
  );
  harness.docs.set(
    'library_bundles/bac1_js',
    firestoreRest.encodeDocumentFields({
      id: 'bac1_js',
      grade: 'bac1',
      section: 'js',
      chapters: [{ num: 1, title: 'عنوان مخصص محفوظ' }],
      questions: [],
    })
  );

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes('securetoken@system.gserviceaccount.com')) {
      return new Response(JSON.stringify({ keys: [pubJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
      });
    }
    return prevFetch(input, init);
  }) as typeof fetch;

  try {
    // 1. Missing/invalid grades remain 'unclassified' without misclassifying as bac1
    const usersRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/users?sort=newest', {
        headers: { Authorization: `Bearer ${adminIdToken}` },
      }),
      env
    );
    assert.equal(usersRes.status, 200);
    const usersJson = await usersRes.json();
    assert.equal(usersJson.dbStatus, 'ok');
    assert.deepEqual(usersJson.counts, {
      total: 4,
      bac1: 1,
      bac2: 1,
      unclassified: 2,
    });
    const missingUser = usersJson.users.find((u: { id: string }) => u.id === 'u_missing_grade');
    const invalidUser = usersJson.users.find((u: { id: string }) => u.id === 'u_invalid_grade');
    assert.equal(missingUser.grade, 'unclassified');
    assert.equal(invalidUser.grade, 'unclassified');
    assert.equal(invalidUser.rawGrade, 'bac3_legacy');

    // User activity detail also preserves 'unclassified'
    const actRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/users/u_invalid_grade/activity', {
        headers: { Authorization: `Bearer ${adminIdToken}` },
      }),
      env
    );
    assert.equal(actRes.status, 200);
    const actJson = await actRes.json();
    assert.equal(actJson.user.grade, 'unclassified');

    // 2. Cookie-only session without Firebase token surfaces auth_required cleanly
    const cookieLogin = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'omar_admin', password: 'StrongAdminPass!2026' }),
      }),
      env
    );
    const cookieVal =
      (cookieLogin.headers.get('set-cookie') || '').match(/crovo_admin_session=([^;]+)/)?.[1] || '';

    const unlinkedUsersRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/users', {
        headers: { Cookie: `crovo_admin_session=${cookieVal}` },
      }),
      env
    );
    assert.equal(unlinkedUsersRes.status, 200);
    const unlinkedUsersJson = await unlinkedUsersRes.json();
    assert.equal(unlinkedUsersJson.dbStatus, 'auth_required');
    assert.equal(unlinkedUsersJson.requiresFirebaseLink, true);

    // 3. Firestore 429 quota error returns dbStatus: 'quota_exceeded' instead of fake empty success
    harness.setQuotaError(true);
    const quotaUsersRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/users', {
        headers: { Authorization: `Bearer ${adminIdToken}` },
      }),
      env
    );
    assert.equal(quotaUsersRes.status, 200);
    const quotaUsersJson = await quotaUsersRes.json();
    assert.equal(quotaUsersJson.dbStatus, 'quota_exceeded');
    assert.ok(quotaUsersJson.dbError);
    harness.setQuotaError(false);

    // 4. PUT /api/admin/settings aborts with 503 on outage (never overwrites existing config with defaults)
    harness.setOutage(true);
    const outagePutRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ qureoOfferPrice: 12 }),
      }),
      env
    );
    assert.equal(outagePutRes.status, 503);
    harness.setOutage(false);
    assert.equal(
      firestoreRest.decodeFirestoreValue(harness.docs.get('site_config/public')?.qureoOfferPrice),
      77
    );

    // 5. POST /api/admin/migrate-legacy skips pre-existing site_config and library_bundles & writes system_backups + system_migrations
    const migRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/migrate-legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
      }),
      env
    );
    assert.equal(migRes.status, 200);
    const migJson = await migRes.json();
    assert.equal(migJson.ok, true);
    assert.equal(migJson.seeded.siteConfig, 0);
    assert.ok(migJson.seeded.skippedExisting >= 2);
    assert.equal(
      firestoreRest.decodeFirestoreValue(harness.docs.get('site_config/public')?.qureoOfferPrice),
      77
    );
    const preservedBundle = firestoreRest.decodeDocument<{ chapters: Array<{ title: string }> }>(
      {
        name: `${firestoreRest.getDocumentsBasePath(harness.cfg)}/library_bundles/bac1_js`,
        fields: harness.docs.get('library_bundles/bac1_js'),
      },
      harness.cfg
    );
    assert.equal(preservedBundle.data.chapters[0].title, 'عنوان مخصص محفوظ');
    assert.ok(harness.docs.has('system_migrations/v1_firestore_baseline'));
    assert.ok(Array.from(harness.docs.keys()).some((k) => k.startsWith('system_backups/')));

    // 6. PUT /api/admin/settings when healthy creates pre-mutation backup + updates target field only
    const putOkRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ qureoOfferPrice: 65 }),
      }),
      env
    );
    assert.equal(putOkRes.status, 200);
    assert.equal(
      firestoreRest.decodeFirestoreValue(harness.docs.get('site_config/public')?.qureoOfferPrice),
      65
    );

    // 7. PUT /api/admin/settings supports switching extended_offer -> regular_price and one-click resetToRegularPrices
    const extRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({
          qureoOldPrice: 150,
          qureoOfferPrice: 60,
          finOldPrice: 120,
          finOfferPrice: 55,
          bundleOldPrice: 270,
          bundleOfferPrice: 110,
          afterOfferMode: 'extended_offer',
          offerEndsAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      }),
      env
    );
    assert.equal(extRes.status, 200);
    const extJson = await extRes.json();
    assert.equal(extJson.config.afterOfferMode, 'extended_offer');

    const regSwitchRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ afterOfferMode: 'regular_price' }),
      }),
      env
    );
    assert.equal(regSwitchRes.status, 200);
    const regSwitchJson = await regSwitchRes.json();
    assert.equal(regSwitchJson.config.afterOfferMode, 'regular_price');

    const resetRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ resetToRegularPrices: true }),
      }),
      env
    );
    assert.equal(resetRes.status, 200);
    const resetJson = await resetRes.json();
    assert.equal(resetJson.config.qureoOfferPrice, 150);
    assert.equal(resetJson.config.finOfferPrice, 120);
    assert.equal(resetJson.config.bundleOfferPrice, 270);
    assert.equal(resetJson.config.afterOfferMode, 'regular_price');
    assert.equal(resetJson.config.offerActive, false);
    assert.ok(String(resetJson.config.libraryAd?.priceText || '').includes('150'));

    // 8. Cold-start 429 quota error degrades gracefully on public endpoints & analytics while /api/health returns 503
    const coldEnv: Env = { ...env, FIREBASE_DATABASE_ID: 'quota_cold_test_db' };
    harness.setQuotaError(true);

    const coldHealth = await handleApiRequest(new Request('https://crovo.pages.dev/api/health'), coldEnv);
    assert.equal(coldHealth.status, 503);

    const coldCfg = await handleApiRequest(new Request('https://crovo.pages.dev/api/config'), coldEnv);
    assert.equal(coldCfg.status, 200);
    const coldCfgJson = await coldCfg.json();
    assert.equal(coldCfgJson.quotaDegraded, true);
    assert.equal(typeof coldCfgJson.qureoOldPrice, 'number');

    const coldLib = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/library?grade=bac1&section=js'),
      coldEnv
    );
    assert.equal(coldLib.status, 200);
    const coldLibJson = await coldLib.json();
    assert.equal(coldLibJson.quotaDegraded, true);
    assert.ok(Array.isArray(coldLibJson.chapters) && coldLibJson.chapters.length >= 42);

    const coldBoot = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/bootstrap?grade=bac1&section=js'),
      coldEnv
    );
    assert.equal(coldBoot.status, 200);
    const coldBootJson = await coldBoot.json();
    assert.equal(coldBootJson.quotaDegraded, true);
    assert.ok(Array.isArray(coldBootJson.library?.chapters) && coldBootJson.library.chapters.length >= 42);

    const coldEv = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'page_view', path: '/' }),
      }),
      coldEnv
    );
    assert.equal(coldEv.status, 202);
    const coldEvJson = await coldEv.json();
    assert.equal(coldEvJson.skippedQuota, true);
    harness.setQuotaError(false);
  } finally {
    harness.restoreFetch();
  }
});

test('Owner admin Firebase login, /api/auth/cloud-sync, and /api/auth/me stay resilient under 429 quota while rejecting non-admins with 403', async () => {
  const harness = installMockFirestoreFetch();
  const kv = createMemoryKv();
  const env: Env = {
    RATE_LIMIT_KV: kv,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    CREDENTIAL_ENCRYPTION_KEY: 'test-encrypt-secret-fedcba9876543210',
    NODE_ENV: 'production',
  };

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
  pubJwk.kid = 'test-kid-quota';
  const toB64Url = (buf: Uint8Array) =>
    btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const signMockJwt = async (payload: Record<string, unknown>) => {
    const hdr = toB64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'test-kid-quota' })));
    const pay = toB64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      kp.privateKey,
      new TextEncoder().encode(`${hdr}.${pay}`)
    );
    return `${hdr}.${pay}.${toB64Url(new Uint8Array(sig))}`;
  };

  const nowSec = Math.floor(Date.now() / 1000);
  const ownerToken = await signMockJwt({
    aud: 'sincere-impact-wbvhw',
    iss: 'https://securetoken.google.com/sincere-impact-wbvhw',
    sub: 'owner_quota_uid',
    email: '3mars7bry@gmail.com',
    email_verified: true,
    name: 'Omar Owner',
    iat: nowSec - 10,
    exp: nowSec + 3600,
  });

  const studentToken = await signMockJwt({
    aud: 'sincere-impact-wbvhw',
    iss: 'https://securetoken.google.com/sincere-impact-wbvhw',
    sub: 'student_quota_uid',
    email: 'student.quota@example.com',
    email_verified: true,
    name: 'طالب تجريبي',
    iat: nowSec - 10,
    exp: nowSec + 3600,
  });

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes('securetoken@system.gserviceaccount.com')) {
      return new Response(JSON.stringify({ keys: [pubJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' },
      });
    }
    return prevFetch(input, init);
  }) as typeof fetch;

  try {
    harness.setQuotaError(true);

    // 1. Owner Google login succeeds even during 429 quota without requiring admins/{uid} read
    const ownerAdminLogin = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/firebase-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ idToken: ownerToken }),
      }),
      env
    );
    assert.equal(ownerAdminLogin.status, 200);
    const ownerAdminJson = await ownerAdminLogin.json();
    assert.equal(ownerAdminJson.ok, true);
    assert.equal(ownerAdminJson.hasFirebaseToken, true);
    assert.equal(ownerAdminJson.quotaDegraded, true);
    assert.equal(ownerAdminJson.user.role, 'admin');
    assert.equal(ownerAdminJson.user.email, '3mars7bry@gmail.com');

    // 2. /api/admin/me recognizes owner Bearer token immediately during 429
    const adminMeRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/me', {
        headers: { Authorization: `Bearer ${ownerToken}` },
      }),
      env
    );
    assert.equal(adminMeRes.status, 200);
    const adminMeJson = await adminMeRes.json();
    assert.equal(adminMeJson.authenticated, true);
    assert.equal(adminMeJson.hasFirebaseToken, true);

    // 3. /api/auth/me returns verified admin for owner and verified user for student under 429
    const ownerAuthMe = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/auth/me', {
        headers: { Authorization: `Bearer ${ownerToken}` },
      }),
      env
    );
    assert.equal(ownerAuthMe.status, 200);
    const ownerAuthMeJson = await ownerAuthMe.json();
    assert.equal(ownerAuthMeJson.authenticated, true);
    assert.equal(ownerAuthMeJson.user.role, 'admin');

    const studentAuthMe = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/auth/me', {
        headers: { Authorization: `Bearer ${studentToken}` },
      }),
      env
    );
    assert.equal(studentAuthMe.status, 200);
    const studentAuthMeJson = await studentAuthMe.json();
    assert.equal(studentAuthMeJson.authenticated, true);
    assert.equal(studentAuthMeJson.user.role, 'user');

    // 4. /api/auth/cloud-sync returns 200 degraded profile instead of 503 under 429
    const studentSyncRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/auth/cloud-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
        body: JSON.stringify({ idToken: studentToken, grade: 'bac2', name: 'طالب باك 2' }),
      }),
      env
    );
    assert.equal(studentSyncRes.status, 200);
    const studentSyncJson = await studentSyncRes.json();
    assert.equal(studentSyncJson.ok, true);
    assert.equal(studentSyncJson.quotaDegraded, true);
    assert.equal(studentSyncJson.user.grade, 'bac2');
    assert.equal(studentSyncJson.user.role, 'user');

    // 5. Non-admin Firebase token on /api/admin/firebase-login is strictly rejected with 403
    const nonAdminRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/firebase-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` },
        body: JSON.stringify({ idToken: studentToken }),
      }),
      env
    );
    assert.equal(nonAdminRes.status, 403);

    // 6. Email/Password unverified student token syncs profile cleanly while denied admin
    const emailPassStudentToken = await signMockJwt({
      aud: 'sincere-impact-wbvhw',
      iss: 'https://securetoken.google.com/sincere-impact-wbvhw',
      sub: 'email_student_uid_01',
      email: 'student.emailpass@example.com',
      email_verified: false,
      name: 'أحمد تانية باك',
      iat: nowSec - 10,
      exp: nowSec + 3600,
    });
    harness.setQuotaError(false);
    const emailSyncRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/auth/cloud-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${emailPassStudentToken}` },
        body: JSON.stringify({ idToken: emailPassStudentToken, grade: 'bac2', name: 'أحمد تانية باك' }),
      }),
      env
    );
    assert.equal(emailSyncRes.status, 200);
    const emailSyncJson = await emailSyncRes.json();
    assert.equal(emailSyncJson.ok, true);
    assert.equal(emailSyncJson.user.grade, 'bac2');
    assert.equal(emailSyncJson.user.role, 'user');

    const unverifiedOwnerAttempt = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/firebase-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${emailPassStudentToken}` },
        body: JSON.stringify({ idToken: emailPassStudentToken }),
      }),
      env
    );
    assert.equal(unverifiedOwnerAttempt.status, 403);
  } finally {
    harness.setQuotaError(false);
    harness.restoreFetch();
  }
});

test('Firestore 429 quota cooldown circuit breaker fast-fails repeated public/analytics fetches and propagates quotaDegraded flags', async () => {
  const harness = installMockFirestoreFetch();
  const kv = createMemoryKv();
  const env: Env = {
    RATE_LIMIT_KV: kv,
    FIREBASE_DATABASE_ID: 'cooldown_circuit_test_db',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    CREDENTIAL_ENCRYPTION_KEY: 'test-encrypt-secret-fedcba9876543210',
    NODE_ENV: 'production',
  };

  let firestoreNetworkHits = 0;
  const wrappedFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.startsWith('https://firestore.googleapis.com/')) {
      firestoreNetworkHits += 1;
    }
    return wrappedFetch(input, init);
  }) as typeof fetch;

  try {
    clearPublicReadCache();
    resetFirestoreQuotaCooldown();
    setAllowQuotaCooldownInMock(true);
    harness.setQuotaError(true);

    // Trigger initial 429 via /api/health
    const h1 = await handleApiRequest(new Request('https://crovo.pages.dev/api/health'), env);
    assert.equal(h1.status, 503);
    assert.equal(firestoreNetworkHits, 1);

    // Subsequent public endpoints during 30s cooldown must NOT hit Firestore over network
    const hitsBefore = firestoreNetworkHits;
    const cRes = await handleApiRequest(new Request('https://crovo.pages.dev/api/comments'), env);
    assert.equal(cRes.status, 200);
    const cJson = await cRes.json();
    assert.equal(cJson.quotaDegraded, true);
    assert.deepEqual(cJson.comments, []);

    const pRes = await handleApiRequest(new Request('https://crovo.pages.dev/api/poll'), env);
    assert.equal(pRes.status, 200);
    const pJson = await pRes.json();
    assert.equal(pJson.quotaDegraded, true);
    assert.equal(pJson.totalVotes, 0);

    const lRes = await handleApiRequest(new Request('https://crovo.pages.dev/api/likes?itemKey=tool'), env);
    assert.equal(lRes.status, 200);
    const lJson = await lRes.json();
    assert.equal(lJson.quotaDegraded, true);

    const evRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'page_view', path: '/' }),
      }),
      env
    );
    assert.equal(evRes.status, 202);

    assert.equal(firestoreNetworkHits, hitsBefore, 'Cooldown must prevent redundant 429 Firestore roundtrips');

    // Recovering health clears cooldown cleanly
    harness.setQuotaError(false);
    const h2 = await handleApiRequest(new Request('https://crovo.pages.dev/api/health'), env);
    assert.equal(h2.status, 200);
  } finally {
    setAllowQuotaCooldownInMock(false);
    resetFirestoreQuotaCooldown();
    clearPublicReadCache();
    harness.setQuotaError(false);
    harness.restoreFetch();
  }
});
