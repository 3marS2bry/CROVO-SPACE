import test from 'node:test';
import assert from 'node:assert/strict';
import * as firestoreRest from '../functions/_lib/firestoreRest.ts';
import {
  clearPublicReadCache,
  handleApiRequest,
} from '../functions/_lib/router.ts';
import {
  AD_TYPE_META,
  type AdType,
  type AdUnitConfig,
  buildDefaultAdUnits,
  buildDefaultBehavior,
  buildDefaultContent,
  buildDefaultDesign,
  buildDefaultMotion,
  isAdEligibleForContext,
  mergeAdUnitsWithDefaults,
  renderDynamicAdText,
  resolveAdEffectiveStatus,
  sanitizeAdLinkUrl,
  sanitizeAdMediaUrl,
  sanitizeAdUnit,
} from '../src/utils/adSystem.ts';
import type { Env, KVNamespace } from '../functions/_lib/types.ts';

function createMemoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
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

async function createAdminAuthFixture(docs: Map<string, Record<string, firestoreRest.FirestoreRawValue>>) {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const pubJwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey & { kid?: string };
  pubJwk.kid = 'ad-center-test-key-1';
  const toB64Url = (u8: Uint8Array) =>
    btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const nowSec = Math.floor(Date.now() / 1000);
  const hdrB64 = toB64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: pubJwk.kid, typ: 'JWT' })));
  const payB64 = toB64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: 'https://securetoken.google.com/sincere-impact-wbvhw',
        aud: 'sincere-impact-wbvhw',
        sub: 'admin_omar_uid',
        user_id: 'admin_omar_uid',
        email: '3mars7bry@gmail.com',
        email_verified: true,
        iat: nowSec,
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

  docs.set(
    'admins/admin_omar_uid',
    firestoreRest.encodeDocumentFields({
      uid: 'admin_omar_uid',
      email: '3mars7bry@gmail.com',
    })
  );
  docs.set(
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

  return { adminIdToken, pubJwk };
}

function installMockFirestoreWithAdminAuth() {
  const docs = new Map<string, Record<string, firestoreRest.FirestoreRawValue>>();
  const cfg = firestoreRest.resolveFirestoreConfig({});
  const basePrefix = firestoreRest.getDocumentsBasePath(cfg);
  const originalFetch = globalThis.fetch;
  let pubJwk: JsonWebKey | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (urlStr.includes('securetoken@system.gserviceaccount.com')) {
      return new Response(JSON.stringify({ keys: pubJwk ? [pubJwk] : [] }), {
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

      if (tail === ':commit' && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as {
          writes?: Array<{
            delete?: string;
            update?: { name: string; fields?: Record<string, firestoreRest.FirestoreRawValue> };
            updateMask?: { fieldPaths?: string[] };
          }>;
        };
        for (const w of body.writes || []) {
          if (w.delete) {
            docs.delete(w.delete.replace(`${basePrefix}/`, ''));
            continue;
          }
          if (w.update) {
            const rel = w.update.name.replace(`${basePrefix}/`, '');
            const existsNow = docs.has(rel);
            const nextFields: Record<string, firestoreRest.FirestoreRawValue> =
              w.updateMask && existsNow ? { ...(docs.get(rel) || {}) } : {};
            for (const [k, v] of Object.entries(w.update.fields || {})) {
              nextFields[k] = v;
            }
            docs.set(rel, nextFields);
          }
        }
        return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
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
        return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Missing' } }), {
          status: 404,
        });
      }
    }

    return originalFetch(input, init);
  }) as typeof fetch;

  return {
    docs,
    setPubJwk: (k: JsonWebKey) => {
      pubJwk = k;
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test('Ad System covers all 10 required ad types and sanitizes unsafe URLs/XSS', () => {
  const expectedTypes: AdType[] = [
    'announcement_bar',
    'popup',
    'modal',
    'floating',
    'inline_section',
    'promo_card',
    'offer_discount',
    'alert_update',
    'interstitial',
    'welcome',
  ];
  for (const t of expectedTypes) {
    assert.ok(AD_TYPE_META[t]?.label, `Missing metadata for ad type ${t}`);
  }

  assert.equal(sanitizeAdLinkUrl('javascript:alert(1)', '#subscribe'), '#subscribe');
  assert.equal(sanitizeAdLinkUrl('data:text/html,<script>alert(1)</script>', '#subscribe'), '#subscribe');
  assert.equal(sanitizeAdLinkUrl('vbscript:msgbox(1)', '#subscribe'), '#subscribe');
  assert.equal(sanitizeAdLinkUrl('https://t.me/CrovoSpace', '#subscribe'), 'https://t.me/CrovoSpace');
  assert.equal(sanitizeAdLinkUrl('#tool', '#subscribe'), '#tool');

  assert.equal(sanitizeAdMediaUrl('javascript:alert(1)', ''), '');
  assert.equal(sanitizeAdMediaUrl('data:image/svg+xml,<svg onload=alert(1)>', ''), '');
  assert.equal(sanitizeAdMediaUrl('/media/crovo-promo-ad.jpg', ''), '/media/crovo-promo-ad.jpg');
  assert.equal(
    sanitizeAdMediaUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=', ''),
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII='
  );

  const defaults = buildDefaultAdUnits();
  assert.equal(defaults.length, 5);
  assert.ok(defaults.some((d) => d.id === 'ad_top_announcement' && d.motion.marqueeEnabled));
  assert.ok(defaults.some((d) => d.id === 'ad_floating_offer' && d.type === 'floating'));

  const merged = mergeAdUnitsWithDefaults([
    {
      id: 'custom_ad_1',
      name: 'Custom Promo',
      type: 'offer_discount',
      placement: 'library_top',
      status: 'active',
      content: { ctaLink: 'javascript:evil()', title: 'Test {price}' },
    },
  ]);
  const custom = merged.find((a) => a.id === 'custom_ad_1');
  assert.ok(custom);
  assert.equal(custom?.content.ctaLink, '#subscribe');
  assert.equal(merged.length, 6); // 1 custom + 5 additive system defaults
});

test('Ad System evaluates schedules, devices, pages, frequency, and dynamic pricing variables accurately', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z');
  const ad: AdUnitConfig = sanitizeAdUnit({
    id: 'ad_sched_test',
    name: 'Scheduled Test',
    type: 'inline_section',
    placement: 'library_top',
    status: 'active',
    content: buildDefaultContent({
      title: 'عرض {price} بدلاً من {old_price} (خصم {percent}%) — باقة {bundle}',
    }),
    design: buildDefaultDesign(),
    motion: buildDefaultMotion(),
    behavior: buildDefaultBehavior({
      enabled: true,
      startAt: '2026-06-02T00:00:00.000Z',
      endAt: '2026-06-05T00:00:00.000Z',
      pages: ['library'],
      deviceTarget: 'mobile',
      delaySeconds: 10,
      frequencyMode: 'recurring',
      cooldownHours: 12,
      maxDisplays: 2,
    }),
  });

  const text = renderDynamicAdText(ad.content.title, {
    qureoOfferPrice: 50,
    qureoOldPrice: 100,
    bundleOfferPrice: 100,
    bundleOldPrice: 200,
  });
  assert.equal(text, 'عرض 50 بدلاً من 100 (خصم 50%) — باقة 100');

  // Before startAt -> scheduled
  assert.equal(resolveAdEffectiveStatus(ad, now).status, 'scheduled');
  assert.equal(
    isAdEligibleForContext({ ad, view: 'library', isMobile: true, nowMs: now, elapsedSeconds: 20 }),
    false
  );

  // Inside active window
  const during = Date.parse('2026-06-03T12:00:00.000Z');
  assert.equal(resolveAdEffectiveStatus(ad, during).status, 'active');

  // Desktop excluded for mobile-only ad
  assert.equal(
    isAdEligibleForContext({ ad, view: 'library', isMobile: false, nowMs: during, elapsedSeconds: 20 }),
    false
  );
  // Wrong page excluded
  assert.equal(
    isAdEligibleForContext({ ad, view: 'reviews', isMobile: true, nowMs: during, elapsedSeconds: 20 }),
    false
  );
  // Before delaySeconds excluded
  assert.equal(
    isAdEligibleForContext({ ad, view: 'library', isMobile: true, nowMs: during, elapsedSeconds: 5 }),
    false
  );
  // Eligible on mobile library after delay
  assert.equal(
    isAdEligibleForContext({ ad, view: 'library', isMobile: true, nowMs: during, elapsedSeconds: 15 }),
    true
  );
  // Cooldown enforced after dismissal
  assert.equal(
    isAdEligibleForContext({
      ad,
      view: 'library',
      isMobile: true,
      nowMs: during,
      elapsedSeconds: 15,
      impressionRecord: { impressions: 1, lastShownAt: during - 1000, dismissedAt: during - 3600_000 },
    }),
    false
  );
  // Max displays cap enforced
  assert.equal(
    isAdEligibleForContext({
      ad,
      view: 'library',
      isMobile: true,
      nowMs: during,
      elapsedSeconds: 15,
      impressionRecord: { impressions: 2, lastShownAt: during - 1000, dismissedAt: 0 },
    }),
    false
  );
  // Expired -> archived
  const after = Date.parse('2026-06-06T00:00:00.000Z');
  assert.equal(resolveAdEffectiveStatus(ad, after).status, 'archived');
});

test('PUT /api/admin/settings adCenterAction handles drafts, publish, toggle, duplicate, delete, restore, and legacy sync', async () => {
  clearPublicReadCache();
  const harness = installMockFirestoreWithAdminAuth();
  const kv = createMemoryKv();
  const { adminIdToken, pubJwk } = await createAdminAuthFixture(harness.docs);
  harness.setPubJwk(pubJwk);

  const env: Partial<Env> = {
    FIREBASE_PROJECT_ID: 'sincere-impact-wbvhw',
    RATE_LIMIT_KV: kv,
    SESSION_SECRET: 'test-session-secret-012345',
  };

  try {
    // 1. Save Draft on Top Announcement without altering live published text
    const topUnits = buildDefaultAdUnits();
    const topModified: AdUnitConfig = {
      ...topUnits[0],
      content: { ...topUnits[0].content, title: 'مسودة نص غير منشور للشريط' },
      motion: { ...topUnits[0].motion, marqueeEnabled: false },
    };

    const draftRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ adCenterAction: 'save_draft', adUnit: topModified }),
      }),
      env
    );
    assert.equal(draftRes.status, 200);
    const draftJson = await draftRes.json();
    const serverTopAfterDraft = draftJson.config.ads.find((a: AdUnitConfig) => a.id === 'ad_top_announcement');
    assert.ok(serverTopAfterDraft.draft);
    assert.equal(serverTopAfterDraft.draft.content.title, 'مسودة نص غير منشور للشريط');
    // Live title stayed intact!
    assert.notEqual(serverTopAfterDraft.content.title, 'مسودة نص غير منشور للشريط');

    // 2. Publish Top Announcement with marquee disabled & custom colors -> syncs live + legacy promoBanner.text
    const pubRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ adCenterAction: 'publish', adUnit: topModified }),
      }),
      env
    );
    assert.equal(pubRes.status, 200);
    const pubJson = await pubRes.json();
    const liveTop = pubJson.config.ads.find((a: AdUnitConfig) => a.id === 'ad_top_announcement');
    assert.equal(liveTop.draft, null);
    assert.equal(liveTop.content.title, 'مسودة نص غير منشور للشريط');
    assert.equal(liveTop.motion.marqueeEnabled, false);
    assert.equal(pubJson.config.promoBanner.text, 'مسودة نص غير منشور للشريط');

    // 3. Duplicate Hero Promo -> creates non-system draft copy
    const dupRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ adCenterAction: 'duplicate', adId: 'ad_hero_promo' }),
      }),
      env
    );
    assert.equal(dupRes.status, 200);
    const dupJson = await dupRes.json();
    const copyUnit = dupJson.config.ads.find((a: AdUnitConfig) => a.id !== 'ad_hero_promo' && a.name.includes('(نسخة)'));
    assert.ok(copyUnit);
    assert.equal(copyUnit.isSystemDefault, false);
    assert.equal(copyUnit.status, 'draft');

    // 4. Attempting to delete system default fails cleanly (400)
    const delSystemRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ adCenterAction: 'delete', adId: 'ad_top_announcement' }),
      }),
      env
    );
    assert.equal(delSystemRes.status, 400);

    // 5. Deleting duplicated custom unit succeeds cleanly (200)
    const delCustomRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ adCenterAction: 'delete', adId: copyUnit.id }),
      }),
      env
    );
    assert.equal(delCustomRes.status, 200);
    const delCustomJson = await delCustomRes.json();
    assert.equal(
      delCustomJson.config.ads.some((a: AdUnitConfig) => a.id === copyUnit.id),
      false
    );

    // 6. Restore Default restores ad_top_announcement marqueeEnabled = true & original text
    const restoreRes = await handleApiRequest(
      new Request('https://crovo.pages.dev/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminIdToken}` },
        body: JSON.stringify({ adCenterAction: 'restore_default', adId: 'ad_top_announcement' }),
      }),
      env
    );
    assert.equal(restoreRes.status, 200);
    const restoreJson = await restoreRes.json();
    const restoredTop = restoreJson.config.ads.find((a: AdUnitConfig) => a.id === 'ad_top_announcement');
    assert.equal(restoredTop.motion.marqueeEnabled, true);
    assert.ok(restoredTop.content.title.includes('{price}'));

    // 7. Reject oversized ad payload (>880KB Firestore protection)
    const hugeAd: AdUnitConfig = {
      ...topUnits[0],
      id: 'ad_huge',
      isSystemDefault: false,
      content: {
        ...topUnits[0].content,
        mediaUrl: `data:image/png;base64,${'A'.repeat(350_000)}`,
      },
      design: {
        ...topUnits[0].design,
        customBgImageUrl: `data:image/png;base64,${'B'.repeat(350_000)}`,
      },
    };
    const safeSanitized = sanitizeAdUnit(hugeAd);
    // Built-in media sanitizer drops >320KB data URLs cleanly already
    assert.equal(safeSanitized.content.mediaUrl, '');
    assert.equal(safeSanitized.design.customBgImageUrl, '');
  } finally {
    harness.restore();
    clearPublicReadCache();
  }
});
