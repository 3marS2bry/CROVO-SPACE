// Edge-compatible Firebase Auth ID Token verifier using Web Crypto + Google JWKs
// Zero Node-only imports so it runs identically in Node.js (Express) and Cloudflare Pages Functions.

const FIREBASE_PROJECT_ID = 'sincere-impact-wbvhw';
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const JWK_ENDPOINT =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface GoogleJwk extends JsonWebKey {
  kid: string;
  alg?: string;
  use?: string;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

let cachedKeys: Map<string, CryptoKey> | null = null;
let cacheExpiresAtMs = 0;

function base64UrlToUint8Array(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const bytes = base64UrlToUint8Array(segment);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

function parseMaxAgeMs(cacheControl: string | null): number {
  if (!cacheControl) return 300_000;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return 300_000;
  const sec = Number(match[1]);
  return Number.isFinite(sec) && sec > 30 ? sec * 1000 : 300_000;
}

async function getGooglePublicKeys(forceRefresh = false): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (!forceRefresh && cachedKeys && now < cacheExpiresAtMs) {
    return cachedKeys;
  }

  const res = await fetch(JWK_ENDPOINT);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public JWKs: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { keys?: GoogleJwk[] };
  if (!Array.isArray(data.keys)) {
    throw new Error('Malformed Firebase JWK response');
  }

  const nextMap = new Map<string, CryptoKey>();
  for (const jwk of data.keys) {
    if (!jwk.kid) continue;
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      nextMap.set(jwk.kid, cryptoKey);
    } catch {
      // Skip unsupported JWK entry
    }
  }

  cachedKeys = nextMap;
  cacheExpiresAtMs = now + parseMaxAgeMs(res.headers.get('cache-control'));
  return nextMap;
}

export async function verifyFirebaseIdToken(
  idToken: string
): Promise<VerifiedFirebaseUser | null> {
  if (!idToken || typeof idToken !== 'string') return null;
  const parts = idToken.trim().split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
    payload = decodeBase64UrlJson<Record<string, unknown>>(payloadB64);
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== FIREBASE_ISSUER) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
  if (typeof payload.iat === 'number' && payload.iat > nowSec + 300) return null;

  let keyMap = await getGooglePublicKeys(false);
  let verifyKey = keyMap.get(header.kid);
  if (!verifyKey) {
    keyMap = await getGooglePublicKeys(true);
    verifyKey = keyMap.get(header.kid);
  }
  if (!verifyKey) return null;

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(sigB64);
  const sigCopy = new Uint8Array(signature.byteLength);
  sigCopy.set(signature);
  const inputCopy = new Uint8Array(signingInput.byteLength);
  inputCopy.set(signingInput);

  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    verifyKey,
    sigCopy.buffer,
    inputCopy.buffer
  );
  if (!valid) return null;

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '',
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name.trim() : '',
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}
