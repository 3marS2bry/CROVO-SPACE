import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createCrovoApp } from '../server.ts';
import { encryptSecret, decryptSecret } from './crypto.ts';

function extractCookies(setCookieHeaders: string[]): string {
  return setCookieHeaders.map((h) => h.split(';')[0]).join('; ');
}

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0XQAAAAASUVORK5CYII=';

test('AES-256-GCM encryption roundtrips passwords securely', () => {
  const secret = 'super-strong-test-key';
  const enc = encryptSecret('MySecretPass#2026', secret);
  assert.notEqual(enc.encrypted, 'MySecretPass#2026');
  const dec = decryptSecret(enc, secret);
  assert.equal(dec, 'MySecretPass#2026');
});

test('Full-stack API enforces shared comments (SQLite images), likes, poll, copy stats, reports, push, orders & admin RBAC', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crovo-test-'));
  const uploadsDir = path.join(tmpDir, 'uploads');

  const { app, db } = await createCrovoApp({
    dbPath: ':memory:',
    uploadsDir,
    skipVite: true,
    sessionSecret: 'test-session-secret',
    encryptionKey: 'test-encryption-key',
    adminUsername: 'crovo_manager',
    adminPassword: 'TestAdminPassword!99',
  });

  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(() => {
    server.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. Visitor A gets config and cookie
  const cfgRes = await fetch(`${baseUrl}/api/config`);
  assert.equal(cfgRes.status, 200);
  const cookieA = extractCookies(cfgRes.headers.getSetCookie());
  assert.ok(cookieA.includes('crovo_visitor='));

  // 2. Visitor A creates comment with image persisted in SQLite uploaded_media
  const cmtCreateRes = await fetch(`${baseUrl}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      authorName: 'كريم علاء',
      grade: 'أولى بكالوريا',
      rating: 5,
      content: 'الأداة خلصتلي كل مستويات جافا بسرعة جداً ومحاكاة طبيعية!',
      showContactPublicly: true,
      contactPhone: '01012345678',
      avatarDataUrl: TINY_PNG_DATA_URL,
      attachmentDataUrl: TINY_PNG_DATA_URL,
      isVerified: true,
    }),
  });
  assert.equal(cmtCreateRes.status, 201);
  const cmtJson = await cmtCreateRes.json();
  assert.equal(cmtJson.comment.isVerified, false, 'Client cannot self-grant Verified badge');
  assert.equal(cmtJson.comment.contactPhone, null, 'Phone number must never be exposed publicly');
  assert.equal(cmtJson.comment.showContactPublicly, false);
  assert.ok(cmtJson.comment.avatarUrl?.startsWith('/uploads/'));

  // Empty phone optional comment works smoothly
  const cmtNoPhoneRes = await fetch(`${baseUrl}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      authorName: 'عمر صبري',
      grade: 'تانية بكالوريا',
      rating: 5,
      content: 'تجربة سريعة بدون كتابة رقم الهاتف.',
      contactPhone: '',
    }),
  });
  assert.equal(cmtNoPhoneRes.status, 201);

  // Image is served cleanly from SQLite uploaded_media blob table
  const mediaRes = await fetch(`${baseUrl}${cmtJson.comment.avatarUrl}`);
  assert.equal(mediaRes.status, 200);
  assert.equal(mediaRes.headers.get('content-type'), 'image/png');

  // 3. Visitor B sees Visitor A's comment & cannot delete it, and phone is never exposed publicly
  const cfgBRes = await fetch(`${baseUrl}/api/config`);
  const cookieB = extractCookies(cfgBRes.headers.getSetCookie());

  const listBRes = await fetch(`${baseUrl}/api/comments`, { headers: { Cookie: cookieB } });
  const listB = await listBRes.json();
  assert.equal(listB.comments.length, 2);
  const firstComment = listB.comments.find((c: { id: string }) => c.id === cmtJson.comment.id);
  assert.ok(firstComment);
  assert.equal(firstComment.authorName, 'كريم علاء');
  assert.equal(firstComment.contactPhone, null);
  assert.equal(firstComment.isOwner, false);

  const hijackRes = await fetch(`${baseUrl}/api/comments/${cmtJson.comment.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookieB },
  });
  assert.equal(hijackRes.status, 403);

  // 4. Shared Likes across Visitor A and Visitor B
  const likeARes = await fetch(`${baseUrl}/api/likes/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ itemKey: 'tool' }),
  });
  const likeA = await likeARes.json();
  assert.equal(likeA.count, 1);
  assert.equal(likeA.liked, true);

  const likeBCheck = await fetch(`${baseUrl}/api/likes?itemKey=tool`, { headers: { Cookie: cookieB } });
  const likeBState = await likeBCheck.json();
  assert.equal(likeBState.count, 1);
  assert.equal(likeBState.liked, false);

  // 4b. Per-comment real DB Likes synced across Visitor A & Visitor B + Parallel Concurrency Protection
  const burstLikes = await Promise.all(
    Array.from({ length: 6 }, () =>
      fetch(`${baseUrl}/api/likes/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ itemKey: `comment:${cmtJson.comment.id}`, desiredLiked: true, count: 999 }),
      }).then((r) => r.json())
    )
  );
  for (const r of burstLikes) {
    assert.equal(r.count, 1);
    assert.equal(r.liked, true);
  }

  const cmtListB = await (
    await fetch(`${baseUrl}/api/comments`, { headers: { Cookie: cookieB } })
  ).json();
  const targetForB = cmtListB.comments.find((c: { id: string }) => c.id === cmtJson.comment.id);
  assert.equal(targetForB.likesCount, 1);
  assert.equal(targetForB.hasLiked, false);

  // Click again to unlike -> drops cleanly to 0
  const unlikeARes = await fetch(`${baseUrl}/api/likes/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ itemKey: `comment:${cmtJson.comment.id}`, desiredLiked: false }),
  });
  const unlikeA = await unlikeARes.json();
  assert.equal(unlikeA.count, 0);
  assert.equal(unlikeA.liked, false);

  // Re-like so admin/subsequent checks stay clean
  await fetch(`${baseUrl}/api/likes/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ itemKey: `comment:${cmtJson.comment.id}`, desiredLiked: true }),
  });

  // 5. Shared Poll («إيه رأيكم نمد العرض؟») enforces account auth (401) & 1 vote per account
  const unauthVoteRes = await fetch(`${baseUrl}/api/poll/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ choice: 'extend' }),
  });
  assert.equal(unauthVoteRes.status, 401);

  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      name: 'كريم علاء',
      email: 'karim.test@crovo.space',
      password: 'Password123!',
      grade: 'bac1',
    }),
  });
  assert.equal(regRes.status, 201);
  const regJson = await regRes.json();
  const authHeadersA = {
    'Content-Type': 'application/json',
    Cookie: cookieA,
    Authorization: `Bearer ${regJson.token}`,
  };

  const voteARes = await fetch(`${baseUrl}/api/poll/vote`, {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({ choice: 'extend' }),
  });
  assert.equal(voteARes.status, 201);
  const voteA = await voteARes.json();
  assert.equal(voteA.totalVotes, 1);
  assert.equal(voteA.extendPercent, 100);

  const dupVoteRes = await fetch(`${baseUrl}/api/poll/vote`, {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({ choice: 'enough' }),
  });
  assert.equal(dupVoteRes.status, 409);

  // Push error diagnostic log returns 202
  const pushErrRes = await fetch(`${baseUrl}/api/push/log-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ stage: 'subscribe', errorCode: 'NotAllowedError', detail: 'denied' }),
  });
  assert.equal(pushErrRes.status, 202);

  // 6. Real question copy stats & wrong-answer reporting
  const copyRes = await fetch(`${baseUrl}/api/questions/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      questionKey: 'bac1-js-0-0',
      grade: 'bac1',
      section: 'js',
      chapterNum: 1,
      qIndex: 0,
      questionTitle: 'سؤال تجريبي في المستوى الأول',
    }),
  });
  assert.equal(copyRes.status, 200);
  const copyBody = await copyRes.json();
  assert.equal(copyBody.copyCount, 1);

  const statsRes = await fetch(`${baseUrl}/api/questions/stats`);
  const statsBody = await statsRes.json();
  assert.equal(statsBody.totalCopies, 1);
  assert.equal(statsBody.copyCounts['bac1-js-0-0'], 1);

  const reportRes = await fetch(`${baseUrl}/api/questions/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieB },
    body: JSON.stringify({
      questionKey: 'bac1-js-0-0',
      grade: 'bac1',
      section: 'js',
      chapterNum: 1,
      qIndex: 0,
      questionTitle: 'سؤال تجريبي في المستوى الأول',
      description: 'في فاصلة منقوطة ناقصة في السطر الأول.',
    }),
  });
  assert.equal(reportRes.status, 201);
  const reportBody = await reportRes.json();
  assert.ok(reportBody.reportId);

  // 7. Web Push VAPID public key, subscribe, status & unsubscribe
  const vapidRes = await fetch(`${baseUrl}/api/push/vapid-public-key`);
  assert.equal(vapidRes.status, 200);
  const vapidBody = await vapidRes.json();
  assert.ok(vapidBody.publicKey.length > 20);

  const subRes = await fetch(`${baseUrl}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      endpoint: 'https://fcm.googleapis.com/fcm/send/example-endpoint-123456',
      keys: {
        p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
    }),
  });
  assert.equal(subRes.status, 201);

  const pushStatusAfterSub = await (
    await fetch(`${baseUrl}/api/push/status`, { headers: { Cookie: cookieA } })
  ).json();
  assert.equal(pushStatusAfterSub.subscribed, true);

  await fetch(`${baseUrl}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({}),
  });
  const pushStatusAfterUnsub = await (
    await fetch(`${baseUrl}/api/push/status`, { headers: { Cookie: cookieA } })
  ).json();
  assert.equal(pushStatusAfterUnsub.subscribed, false);

  // 8. Orders: Click-to-Chat without WhatsApp Business API; password encrypted & never returned publicly
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({
      fullName: 'عمر صبري',
      grade: 'bac2',
      platforms: ['qureo', 'financial'],
      qureoSection: 'java',
      platformUsername: 'omar_sabry',
      platformPassword: 'SecretPassword!123',
      paymentMethod: 'محفظة إلكترونية (كاش)',
      clientRequestId: 'req-unique-123456',
      finalPrice: 1,
    }),
  });
  assert.equal(orderRes.status, 201);
  const orderBody = await orderRes.json();
  assert.equal(orderBody.order.oldPrice, 200);
  assert.equal(orderBody.order.finalPrice, 100);
  assert.equal(orderBody.order.paymentMethod, 'محفظة إلكترونية (كاش)');
  assert.equal('whatsappStatus' in orderBody.order, false);
  assert.equal('platformPassword' in orderBody.order, false);

  // 9. Regular visitor CANNOT access Admin Overview
  const unauthAdmin = await fetch(`${baseUrl}/api/admin/overview`, { headers: { Cookie: cookieA } });
  assert.equal(unauthAdmin.status, 401);

  // 10. Wrong password increments brute-force guard and succeeds on real credentials
  const badLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'crovo_manager', password: 'wrong' }),
  });
  assert.equal(badLogin.status, 401);

  const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'crovo_manager', password: 'TestAdminPassword!99' }),
  });
  assert.equal(loginRes.status, 200);
  const adminCookie = extractCookies(loginRes.headers.getSetCookie());

  const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(overviewRes.status, 200);
  const overview = await overviewRes.json();
  assert.equal(overview.orders.length, 1);
  assert.equal(overview.orders[0].platformPassword, 'SecretPassword!123');
  assert.equal(overview.questionReports.length, 1);
  assert.equal(overview.stats.totalCopies, 1);
  assert.equal(overview.stats.dbIntegrity.ok, true);

  // Admin updates question report to resolved
  const resolveReportRes = await fetch(
    `${baseUrl}/api/admin/question-reports/${reportBody.reportId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ status: 'resolved', adminNote: 'تمت المراجعة والتأكد' }),
    }
  );
  assert.equal(resolveReportRes.status, 200);

  // Complete order -> automatically purges encrypted credentials!
  const completeRes = await fetch(`${baseUrl}/api/admin/orders/${overview.orders[0].id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ status: 'completed' }),
  });
  assert.equal(completeRes.status, 200);
  const completeBody = await completeRes.json();
  assert.equal(completeBody.credentialsPurged, true);

  // Admin updates PromoTopBanner text & toggle -> reflected on public /api/config
  const updSettingsRes = await fetch(`${baseUrl}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      promoBanner: {
        enabled: true,
        text: 'عرض خاص محدث: المنصة بـ{price}ج فقط',
      },
    }),
  });
  assert.equal(updSettingsRes.status, 200);
  const pubCfgAfter = await (await fetch(`${baseUrl}/api/config`)).json();
  assert.equal(pubCfgAfter.promoBanner.enabled, true);
  assert.equal(pubCfgAfter.promoBanner.text, 'عرض خاص محدث: المنصة بـ{price}ج فقط');
});
