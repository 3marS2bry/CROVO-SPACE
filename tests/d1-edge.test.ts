import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as nodeCrypto from '../server/crypto.ts';
import * as edgeCrypto from '../functions/_lib/crypto.ts';
import { handleApiRequest } from '../functions/api/[[path]].ts';
import { onRequestGet as handleUploadGet } from '../functions/uploads/[filename].ts';
import type { D1Database, D1PreparedStatement, D1Result, Env } from '../functions/_lib/types.ts';

function createSqliteD1Adapter(sqliteDb: DatabaseSync): D1Database {
  const wrapStmt = (query: string, bound: unknown[] = []): D1PreparedStatement => ({
    bind(...values: unknown[]) {
      return wrapStmt(query, values);
    },
    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const row = sqliteDb.prepare(query).get(...(bound as never[])) as Record<string, unknown> | undefined;
      if (!row) return null;
      if (colName) return (row[colName] as T) ?? null;
      return row as T;
    },
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const rows = sqliteDb.prepare(query).all(...(bound as never[])) as T[];
      return { results: rows, success: true, meta: {} };
    },
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const info = sqliteDb.prepare(query).run(...(bound as never[]));
      return {
        results: [],
        success: true,
        meta: { changes: Number(info.changes || 0), last_row_id: Number(info.lastInsertRowid || 0) },
      };
    },
    async raw<T = unknown[]>(): Promise<T[]> {
      const rows = sqliteDb.prepare(query).all(...(bound as never[])) as Record<string, unknown>[];
      return rows.map((r) => Object.values(r) as T);
    },
  });

  return {
    prepare(query: string) {
      return wrapStmt(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const out: D1Result<T>[] = [];
      sqliteDb.exec('BEGIN IMMEDIATE');
      try {
        for (const s of statements) {
          out.push(await s.run<T>());
        }
        sqliteDb.exec('COMMIT');
        return out;
      } catch (err) {
        try {
          sqliteDb.exec('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      }
    },
    async exec(query: string) {
      sqliteDb.exec(query);
      return { count: 1, duration: 0 };
    },
  };
}

function buildMigratedMemoryDb(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = [
    '0001_initial_schema.sql',
    '0002_seed_defaults.sql',
    '0003_live_data_export.sql',
    '0004_comment_before_after_images.sql',
    '0005_user_serial_and_no_purge.sql',
  ];
  for (const file of files) {
    const full = path.join(migrationsDir, file);
    if (fs.existsSync(full)) {
      const sql = fs.readFileSync(full, 'utf8');
      sqlite.exec(sql);
    }
  }
  return sqlite;
}

test('Node Crypto and Cloudflare Edge Web Crypto are 100% cross-compatible', async () => {
  const secret = 'crovo-cross-runtime-secret-key-2026';

  // AES-256-GCM Edge -> Node
  const edgeEncrypted = await edgeCrypto.encryptSecret('Student@Pass#123', secret);
  const decryptedByNode = nodeCrypto.decryptSecret(edgeEncrypted, secret);
  assert.equal(decryptedByNode, 'Student@Pass#123');

  // AES-256-GCM Node -> Edge
  const nodeEncrypted = nodeCrypto.encryptSecret('Another@Secret!99', secret);
  const decryptedByEdge = await edgeCrypto.decryptSecret(nodeEncrypted, secret);
  assert.equal(decryptedByEdge, 'Another@Secret!99');

  // Password hashing Edge <-> Node (PBKDF2 SHA-256 100k)
  const edgeHash = await edgeCrypto.hashPassword('CrovoPass123');
  assert.ok(edgeHash.startsWith('pbkdf2$sha256$100000$'));
  assert.equal(nodeCrypto.verifyPassword('CrovoPass123', edgeHash), true);
  assert.equal(nodeCrypto.verifyPassword('WrongPass', edgeHash), false);

  const nodeHash = nodeCrypto.hashPassword('NodePass456');
  assert.ok(nodeHash.startsWith('pbkdf2$sha256$100000$'));
  assert.equal(await edgeCrypto.verifyPassword('NodePass456', nodeHash), true);

  // HMAC tokens Node <-> Edge
  const edgeToken = await edgeCrypto.signToken({ vid: 'v_abc123', role: 'user' }, secret);
  const parsedByNode = nodeCrypto.verifyToken<{ vid: string; role: string }>(edgeToken, secret);
  assert.equal(parsedByNode?.vid, 'v_abc123');

  const nodeToken = nodeCrypto.signToken({ vid: 'v_xyz789' }, secret);
  const parsedByEdge = await edgeCrypto.verifyToken<{ vid: string }>(nodeToken, secret);
  assert.equal(parsedByEdge?.vid, 'v_xyz789');
});

test('D1 migrations (schema + seeds + live data export) apply cleanly and preserve integrity', () => {
  const sqlite = buildMigratedMemoryDb();
  const integrityRow = sqlite.prepare('PRAGMA integrity_check').get() as Record<string, string>;
  assert.equal(Object.values(integrityRow)[0], 'ok');

  const chaptersCount = (sqlite.prepare('SELECT COUNT(*) as c FROM library_chapters').get() as { c: number }).c;
  const questionsCount = (sqlite.prepare('SELECT COUNT(*) as c FROM library_questions').get() as { c: number }).c;
  const servicesCount = (sqlite.prepare('SELECT COUNT(*) as c FROM tool_services').get() as { c: number }).c;
  const pollCount = (sqlite.prepare('SELECT COUNT(*) as c FROM polls').get() as { c: number }).c;

  assert.equal(chaptersCount, 129);
  assert.equal(questionsCount, 863);
  assert.ok(servicesCount >= 4);
  assert.ok(pollCount >= 1);
  sqlite.close();
});

test('Cloudflare Pages Functions handleApiRequest full D1 persistence & security flow', async () => {
  const sqlite = buildMigratedMemoryDb();
  const d1 = createSqliteD1Adapter(sqlite);
  const env: Env = {
    DB: d1,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    CREDENTIAL_ENCRYPTION_KEY: 'test-encrypt-secret-fedcba9876543210',
    ADMIN_USERNAME: 'crovo_admin',
    ADMIN_PASSWORD: 'SuperSecretAdminPassword!2026',
  };

  const callApi = async (
    urlPath: string,
    init: RequestInit = {},
    extraHeaders: Record<string, string> = {}
  ) => {
    const req = new Request(`https://crovo.pages.dev${urlPath}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
        ...(init.headers || {}),
      },
    });
    return handleApiRequest(req, env);
  };

  // 1. Health & Public Library
  const healthRes = await callApi('/api/health');
  assert.equal(healthRes.status, 200);
  const healthJson = await healthRes.json();
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.engine, 'cloudflare-d1');

  const libRes = await callApi('/api/library?grade=bac1&section=js');
  assert.equal(libRes.status, 200);
  const libJson = await libRes.json();
  assert.ok(libJson.chapters.length >= 40);

  // 2. Push log-error diagnostic returns 202
  const pushErrRes = await callApi('/api/push/log-error', {
    method: 'POST',
    body: JSON.stringify({ stage: 'subscribe', errorCode: 'NotAllowedError', detail: 'User denied' }),
  });
  assert.equal(pushErrRes.status, 202);

  // 3. Poll requires authentication (401)
  const unauthVote = await callApi('/api/poll/vote', {
    method: 'POST',
    body: JSON.stringify({ choice: 'extend' }),
  });
  assert.equal(unauthVote.status, 401);

  // 4. Register user & obtain persistent token
  const regRes = await callApi('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'أحمد محمد',
      email: 'ahmed.d1@crovo.space',
      password: 'Password123!',
      grade: 'bac1',
    }),
  });
  assert.equal(regRes.status, 201);
  const regJson = await regRes.json();
  const userToken = regJson.token as string;
  const visitorToken = regRes.headers.get('X-Crovo-Visitor-Token') || '';
  assert.ok(userToken.length > 20);
  assert.match(String(regJson.user.serialNumber || ''), /^CRV-\d{4,}$/);

  const authHeaders = {
    Authorization: `Bearer ${userToken}`,
    'X-Crovo-Visitor': visitorToken,
  };

  // 5. Auth session check
  const meRes = await callApi('/api/auth/me', {}, authHeaders);
  const meJson = await meRes.json();
  assert.equal(meJson.authenticated, true);
  assert.equal(meJson.user.email, 'ahmed.d1@crovo.space');
  assert.equal(meJson.user.serialNumber, regJson.user.serialNumber);

  // 6. Strict poll voting (first vote 201, duplicate 409)
  const voteRes = await callApi(
    '/api/poll/vote',
    { method: 'POST', body: JSON.stringify({ choice: 'extend' }) },
    authHeaders
  );
  assert.equal(voteRes.status, 201);
  const voteJson = await voteRes.json();
  assert.equal(voteJson.userChoice, 'extend');
  assert.equal(voteJson.extendCount, 1);

  const dupVoteRes = await callApi(
    '/api/poll/vote',
    { method: 'POST', body: JSON.stringify({ choice: 'enough' }) },
    authHeaders
  );
  assert.equal(dupVoteRes.status, 409);

  // 7. Likes toggle persists
  const initialLikeCount = (await (await callApi('/api/likes?itemKey=tool', {}, authHeaders)).json()).count;
  const toggleLikeRes = await callApi(
    '/api/likes/toggle',
    { method: 'POST', body: JSON.stringify({ itemKey: 'tool', desiredLiked: true }) },
    authHeaders
  );
  assert.equal(toggleLikeRes.status, 200);
  const likeAfter = await (await callApi('/api/likes?itemKey=tool', {}, authHeaders)).json();
  assert.equal(likeAfter.liked, true);
  assert.equal(likeAfter.count, initialLikeCount + 1);

  // 8. Comments with before & after images create -> persist
  const tinyPngForComment =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const cmtCreateRes = await callApi(
    '/api/comments',
    {
      method: 'POST',
      body: JSON.stringify({
        authorName: 'أحمد محمد',
        grade: 'أولى بكالوريا',
        rating: 5,
        content: 'المكتبة والأداة شغالين ممتاز على D1!',
        attachmentBeforeDataUrl: tinyPngForComment,
        attachmentAfterDataUrl: tinyPngForComment,
      }),
    },
    authHeaders
  );
  assert.equal(cmtCreateRes.status, 201);
  const createdCmt = (await cmtCreateRes.json()).comment as {
    id: string;
    attachmentBeforeUrl?: string | null;
    attachmentAfterUrl?: string | null;
  };
  assert.ok(createdCmt.attachmentBeforeUrl?.startsWith('/uploads/'));
  assert.ok(createdCmt.attachmentAfterUrl?.startsWith('/uploads/'));

  const listCmtsJson = await (await callApi('/api/comments', {}, authHeaders)).json();
  const listedCmt = listCmtsJson.comments.find((c: { id: string }) => c.id === createdCmt.id);
  assert.ok(listedCmt);
  assert.equal(listedCmt.attachmentBeforeUrl, createdCmt.attachmentBeforeUrl);
  assert.equal(listedCmt.attachmentAfterUrl, createdCmt.attachmentAfterUrl);

  // 9. Order creation encrypts password in D1 and Admin RBAC decrypts it
  const ordRes = await callApi(
    '/api/orders',
    {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'أحمد محمد',
        grade: 'bac1',
        platforms: ['qureo'],
        platformUsername: 'student_01',
        platformPassword: 'SecretPlatformPassword#9',
        paymentMethod: 'إنستا باي',
      }),
    },
    authHeaders
  );
  assert.equal(ordRes.status, 201);

  const rawOrder = sqlite
    .prepare('SELECT encrypted_password FROM orders WHERE platform_username = ?')
    .get('student_01') as { encrypted_password: string };
  assert.notEqual(rawOrder.encrypted_password, 'SecretPlatformPassword#9');

  // Unauthenticated admin request returns 401
  const unauthAdminRes = await callApi('/api/admin/overview');
  assert.equal(unauthAdminRes.status, 401);

  // Admin login & overview check + ad-image upload -> /uploads/:filename
  const adminLoginRes = await callApi('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'crovo_admin',
      password: 'SuperSecretAdminPassword!2026',
    }),
  });
  assert.equal(adminLoginRes.status, 200);
  const { adminToken } = await adminLoginRes.json();

  const overviewRes = await callApi('/api/admin/overview', {}, { 'X-Crovo-Admin-Token': adminToken });
  assert.equal(overviewRes.status, 200);
  const overviewJson = await overviewRes.json();
  assert.equal(overviewJson.orders[0].platformPassword, 'SecretPlatformPassword#9');
  assert.ok(overviewJson.analytics.users);
  assert.equal(overviewJson.analytics.users.totalRegistered, 1);

  // Upload tiny 1x1 transparent PNG to D1 uploaded_media and serve via uploads handler
  const tinyPngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const uploadRes = await callApi(
    '/api/admin/ad-image',
    { method: 'POST', body: JSON.stringify({ imageDataUrl: tinyPngBase64 }) },
    { 'X-Crovo-Admin-Token': adminToken }
  );
  assert.equal(uploadRes.status, 201);
  const { imageUrl } = await uploadRes.json();
  const filename = String(imageUrl).replace('/uploads/', '');

  const mediaRes = await handleUploadGet({
    request: new Request(`https://crovo.pages.dev${imageUrl}`),
    env,
    params: { filename },
    waitUntil: () => {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  });
  assert.equal(mediaRes.status, 200);
  assert.equal(mediaRes.headers.get('Content-Type'), 'image/png');
  const buf = await mediaRes.arrayBuffer();
  assert.ok(buf.byteLength > 20);

  // 10. Serial search, full user activity log, non-auto-purge on complete, and explicit delete
  const usersBySerialRes = await callApi(
    `/api/admin/users?q=${encodeURIComponent(regJson.user.serialNumber)}`,
    {},
    { 'X-Crovo-Admin-Token': adminToken }
  );
  assert.equal(usersBySerialRes.status, 200);
  const usersBySerial = await usersBySerialRes.json();
  assert.equal(usersBySerial.users.length, 1);
  assert.equal(usersBySerial.users[0].serialNumber, regJson.user.serialNumber);

  const userActivityRes = await callApi(
    `/api/admin/users/${regJson.user.id}/activity`,
    {},
    { 'X-Crovo-Admin-Token': adminToken }
  );
  assert.equal(userActivityRes.status, 200);
  const userActivity = await userActivityRes.json();
  assert.ok(Array.isArray(userActivity.activities));
  const d1EventTypes = new Set(userActivity.activities.map((a: { eventType: string }) => a.eventType));
  assert.ok(d1EventTypes.has('user_register'));
  assert.ok(d1EventTypes.has('poll_vote'));
  assert.ok(d1EventTypes.has('tool_like'));
  assert.ok(d1EventTypes.has('comment_create'));
  assert.ok(d1EventTypes.has('order_create'));

  const completeOrderRes = await callApi(
    `/api/admin/orders/${overviewJson.orders[0].id}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) },
    { 'X-Crovo-Admin-Token': adminToken }
  );
  assert.equal(completeOrderRes.status, 200);
  const completeOrderJson = await completeOrderRes.json();
  assert.equal(completeOrderJson.credentialsPurged, false);

  const overviewAfterComplete = await (
    await callApi('/api/admin/overview', {}, { 'X-Crovo-Admin-Token': adminToken })
  ).json();
  assert.equal(overviewAfterComplete.orders.length, 1);
  assert.equal(overviewAfterComplete.orders[0].platformPassword, 'SecretPlatformPassword#9');

  const delOrderRes = await callApi(
    `/api/admin/orders/${overviewJson.orders[0].id}`,
    { method: 'DELETE' },
    { 'X-Crovo-Admin-Token': adminToken }
  );
  assert.equal(delOrderRes.status, 200);
  const overviewAfterDel = await (
    await callApi('/api/admin/overview', {}, { 'X-Crovo-Admin-Token': adminToken })
  ).json();
  assert.equal(overviewAfterDel.orders.length, 0);

  sqlite.close();
});

test('Edge resolveSecrets never overwrites existing D1 keys and decrypts legacy orders', async () => {
  const sqlite = buildMigratedMemoryDb();
  const d1 = createSqliteD1Adapter(sqlite);
  const legacyKey = 'legacy-d1-encryption-key-0123456789';
  const rotatedKey = 'new-env-encryption-key-9876543210';

  sqlite
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run('_edge_encryption_key', legacyKey);

  const encLegacy = await edgeCrypto.encryptSecret('LegacyOrderPass!77', legacyKey);
  sqlite
    .prepare(
      `INSERT INTO orders (
        id, order_code, visitor_id, full_name, grade, platforms_json, platform_label, section_details,
        platform_username, encrypted_password, password_iv, password_auth_tag,
        credentials_purged, old_price, final_price, offer_applied, payment_method, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 100, 50, 1, ?, ?, ?)`
    )
    .run(
      'ord_legacy_1',
      'CRV-LEGACY1',
      'v_legacy',
      'طالب قديم',
      'bac1',
      '["qureo"]',
      'منصة البرمجة (Qureo)',
      'JS',
      'legacy_user',
      encLegacy.encrypted,
      encLegacy.iv,
      encLegacy.authTag,
      'إنستا باي',
      'new',
      new Date().toISOString()
    );

  const env: Env = {
    DB: d1,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    CREDENTIAL_ENCRYPTION_KEY: rotatedKey,
    ADMIN_USERNAME: 'crovo_admin',
    ADMIN_PASSWORD: 'SuperSecretAdminPassword!2026',
  };

  const loginRes = await handleApiRequest(
    new Request('https://crovo.pages.dev/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'crovo_admin',
        password: 'SuperSecretAdminPassword!2026',
      }),
    }),
    env
  );
  assert.equal(loginRes.status, 200);
  const { adminToken } = await loginRes.json();

  const overviewRes = await handleApiRequest(
    new Request('https://crovo.pages.dev/api/admin/overview', {
      headers: { 'X-Crovo-Admin-Token': adminToken },
    }),
    env
  );
  assert.equal(overviewRes.status, 200);
  const overviewJson = await overviewRes.json();
  const legacyOrder = overviewJson.orders.find((o: { id: string }) => o.id === 'ord_legacy_1');
  assert.ok(legacyOrder);
  assert.equal(legacyOrder.platformPassword, 'LegacyOrderPass!77');

  const storedRow = sqlite
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('_edge_encryption_key') as { value: string };
  assert.equal(storedRow.value, legacyKey, 'Stored D1 _edge_encryption_key must NEVER be overwritten');

  sqlite.close();
});

