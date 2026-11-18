// Pure WebCrypto RFC 8291 (aes128gcm) + RFC 8292 (VAPID ES256) Web Push sender
// Zero node:* or web-push npm dependencies so it runs natively on Cloudflare Pages Functions and Node.js 20+.

export interface NotificationTemplate {
  id: string;
  category: 'offer' | 'service' | 'update';
  title: string;
  body: string;
  url: string;
}

export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  {
    id: 'offer-50',
    category: 'offer',
    title: 'عرض الـ50% من CROVO SPACE لسه شغال! ⚡',
    body: 'حل منصة QUREO بالكامل للترمين بـ50 جنيه بدل 100 جنيه — وفر وقتك وذاكر براحتك.',
    url: '/?offer=1',
  },
  {
    id: 'service-bundle',
    category: 'service',
    title: 'باقة تانية بكالوريا: QUREO + ثقافة مالية 🎯',
    body: 'ممكن تشترك في المنصتين مع بعض بـ100 جنيه بدل 200 جنيه بمحاكاة بشرية كاملة بدون أي كشف.',
    url: '/',
  },
  {
    id: 'update-library-search',
    category: 'update',
    title: 'تحديث جديد في مكتبة CROVO SPACE 📚',
    body: 'ضفنا بحث فوري عن الأسئلة وفلترة بالمادة والمستوى وترتيب بالأكثر نسخًا عشان توصل لحلك في ثواني.',
    url: '/#solutions-library',
  },
  {
    id: 'offer-time-saver',
    category: 'offer',
    title: 'خلّص 600+ سؤال في 4 دقايق بدل السهر! ⏱️',
    body: 'أداة CROVO بتدخل تكتب وتجاوب بهدوء وبنفس أسلوب الطالب العادي بنسبة نجاح 100%.',
    url: '/',
  },
  {
    id: 'service-reviews',
    category: 'service',
    title: 'شوف آراء زمايلك الموثّقين على CROVO SPACE ⭐',
    body: 'اطلع على تجارب طلاب أولى وتانية بكالوريا الحقيقية قبل ما تاخد قرارك.',
    url: '/reviews',
  },
  {
    id: 'update-help-center',
    category: 'update',
    title: 'مكتبة الحلول المجانية جاهزة ومحدثة بالكامل ✅',
    body: 'جميع مستويات أولى بكالوريا (42 مستوى) وتانية بكالوريا (54 جافا + 25 بايثون + 8 مالية) متاحة للنسخ.',
    url: '/#solutions-library',
  },
  {
    id: 'offer-poll',
    category: 'offer',
    title: 'شاركنا رأيك: تحب نمد عرض الـ50%؟ 🗳️',
    body: 'صوّت في الاستفتاء المباشر على الموقع وتابع النسبة الحقيقية بين الطلاب.',
    url: '/#poll-section',
  },
  {
    id: 'service-security',
    category: 'service',
    title: 'خصوصيتك وأمان حسابك أولوية في CROVO 🔒',
    body: 'بيانات الدخول مشفرة بـ AES-256-GCM وتُحذف تلقائيًا فور إتمام طلب الاشتراك.',
    url: '/#help-center',
  },
];

export function pickNextTemplateForSubscriber(lastMessageId: string | null, globalOffset: number): NotificationTemplate {
  const startIdx = Math.abs(globalOffset) % NOTIFICATION_TEMPLATES.length;
  for (let i = 0; i < NOTIFICATION_TEMPLATES.length; i++) {
    const candidate = NOTIFICATION_TEMPLATES[(startIdx + i) % NOTIFICATION_TEMPLATES.length];
    if (candidate.id !== lastMessageId) {
      return candidate;
    }
  }
  return NOTIFICATION_TEMPLATES[0];
}

const textEncoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, toArrayBuffer(data));
  return new Uint8Array(sig);
}

async function hkdfExpandSingleBlock(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const input = concatBytes(info, new Uint8Array([0x01]));
  const full = await hmacSha256(prk, input);
  return full.slice(0, length);
}

let devVapidCache: { publicKey: string; privateKey: string } | null = null;

export async function resolveVapidKeys(env: {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  NODE_ENV?: string;
}): Promise<{ publicKey: string; privateKey: string; subject: string; ephemeral: boolean } | null> {
  const pub = (env.VAPID_PUBLIC_KEY || '').trim();
  const priv = (env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (env.VAPID_SUBJECT || 'mailto:support@crovo.space').trim();

  if (pub && priv) {
    return { publicKey: pub, privateKey: priv, subject, ephemeral: false };
  }

  // Strictly disallow volatile auto-generated VAPID keys in production
  if (env.NODE_ENV === 'production') {
    return null;
  }

  if (!devVapidCache) {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as {
      x?: string;
      y?: string;
      d?: string;
    };
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    devVapidCache = {
      publicKey: base64UrlEncode(rawPub),
      privateKey: String(jwk.d || ''),
    };
  }

  return {
    publicKey: devVapidCache.publicKey,
    privateKey: devVapidCache.privateKey,
    subject,
    ephemeral: true,
  };
}

async function createVapidJwt(
  audience: string,
  subject: string,
  publicKeyB64Url: string,
  privateKeyB64Url: string
): Promise<string> {
  const pubBytes = base64UrlDecode(publicKeyB64Url);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('Invalid VAPID_PUBLIC_KEY format (expected 65-byte uncompressed P-256 point).');
  }
  const x = base64UrlEncode(pubBytes.subarray(1, 33));
  const y = base64UrlEncode(pubBytes.subarray(33, 65));

  const signingKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x,
      y,
      d: privateKeyB64Url,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const header = base64UrlEncode(textEncoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const payload = base64UrlEncode(
    textEncoder.encode(JSON.stringify({ aud: audience, exp, sub: subject }))
  );
  const input = textEncoder.encode(`${header}.${payload}`);

  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      signingKey,
      toArrayBuffer(input)
    )
  );
  return `${header}.${payload}.${base64UrlEncode(sig)}`;
}

export async function encryptWebPushPayload(
  payloadText: string,
  subscription: { p256dh: string; auth: string }
): Promise<Uint8Array> {
  const uaPublicBytes = base64UrlDecode(subscription.p256dh);
  const authSecretBytes = base64UrlDecode(subscription.auth);

  if (uaPublicBytes.length !== 65 || uaPublicBytes[0] !== 0x04) {
    throw new Error('Invalid subscriber p256dh public key.');
  }
  if (authSecretBytes.length < 12) {
    throw new Error('Invalid subscriber auth secret.');
  }

  const uaPublicKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(uaPublicBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPublicKey },
      ephemeral.privateKey,
      256
    )
  );

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  // RFC 8291 Section 3.3 Key Derivation
  const prkKey = await hmacSha256(authSecretBytes, ecdhSecret);
  const keyInfo = concatBytes(
    textEncoder.encode('WebPush: info\0'),
    uaPublicBytes,
    asPublicBytes
  );
  const ikm = await hkdfExpandSingleBlock(prkKey, keyInfo, 32);

  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpandSingleBlock(
    prk,
    textEncoder.encode('Content-Encoding: aes128gcm\0'),
    16
  );
  const nonce = await hkdfExpandSingleBlock(
    prk,
    textEncoder.encode('Content-Encoding: nonce\0'),
    12
  );

  const aesKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(cek),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const plaintext = concatBytes(textEncoder.encode(payloadText), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(nonce), tagLength: 128 },
      aesKey,
      toArrayBuffer(plaintext)
    )
  );

  // aes128gcm header: salt (16) + rs (4, BE=4096) + idlen (1, 65) + keyid (65)
  const header = new Uint8Array(16 + 4 + 1 + asPublicBytes.length);
  header.set(salt, 0);
  const view = new DataView(header.buffer);
  view.setUint32(16, 4096, false);
  header[20] = asPublicBytes.length;
  header.set(asPublicBytes, 21);

  return concatBytes(header, ciphertext);
}

export async function sendWebPushMessage(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payloadObj: Record<string, unknown>,
  vapid: { publicKey: string; privateKey: string; subject: string }
): Promise<{ ok: boolean; status: number; expired: boolean; error?: string }> {
  const endpointUrl = new URL(subscription.endpoint);
  const jwt = await createVapidJwt(
    endpointUrl.origin,
    vapid.subject,
    vapid.publicKey,
    vapid.privateKey
  );
  const bodyBytes = await encryptWebPushPayload(JSON.stringify(payloadObj), {
    p256dh: subscription.p256dh,
    auth: subscription.auth,
  });

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
    },
    body: toArrayBuffer(bodyBytes),
  });

  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status, expired: false };
  }

  const expired = res.status === 404 || res.status === 410;
  let errorText = `Push HTTP ${res.status}`;
  try {
    const txt = await res.text();
    if (txt) errorText = `${errorText}: ${txt.slice(0, 120)}`;
  } catch {
    // Ignore
  }
  return { ok: false, status: res.status, expired, error: errorText };
}
