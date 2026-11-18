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
import { handleApiRequest } from '../functions/_lib/router.ts';
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
}

function installMockFirestoreFetch(): MockFirestoreHarness {
  const docs = new Map<string, Record<string, firestoreRest.FirestoreRawValue>>();
  const cfg = firestoreRest.resolveFirestoreConfig({});
  const basePrefix = firestoreRest.getDocumentsBasePath(cfg);
  const originalFetch = globalThis.fetch;
  let forceOutage = false;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

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
