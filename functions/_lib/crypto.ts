// Edge-compatible Web Crypto utilities (zero node:* imports for Cloudflare Pages Functions)

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(str: string): Uint8Array {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return base64ToBytes(normalized + pad);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function sha256Bytes(data: Uint8Array | string): Promise<Uint8Array> {
  const buf = typeof data === 'string' ? textEncoder.encode(data) : data;
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = await sha256Bytes(text);
  return bytesToHex(bytes);
}

export function generateId(prefix = ''): string {
  const randBytes = new Uint8Array(8);
  crypto.getRandomValues(randBytes);
  const hex = bytesToHex(randBytes);
  return prefix ? `${prefix}_${hex}` : hex;
}

export function randomHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function safeCompareStrings(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);
  return constantTimeEqual(ha, hb);
}

export interface EncryptedPayload {
  encrypted: string;
  iv: string;
  authTag: string;
}

export async function encryptSecret(plaintext: string, keyMaterial: string): Promise<EncryptedPayload> {
  const keyBytes = await sha256Bytes(keyMaterial);
  const keyCopy = new Uint8Array(keyBytes);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyCopy.buffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = textEncoder.encode(plaintext);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    data
  );

  const full = new Uint8Array(cipherBuf);
  const encrypted = full.subarray(0, full.length - 16);
  const authTag = full.subarray(full.length - 16);

  return {
    encrypted: bytesToBase64(encrypted),
    iv: bytesToBase64(iv),
    authTag: bytesToBase64(authTag),
  };
}

export async function decryptSecret(payload: EncryptedPayload, keyMaterial: string): Promise<string> {
  const keyBytes = await sha256Bytes(keyMaterial);
  const keyCopy = new Uint8Array(keyBytes);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyCopy.buffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const iv = new Uint8Array(base64ToBytes(payload.iv));
  const encrypted = base64ToBytes(payload.encrypted);
  const authTag = base64ToBytes(payload.authTag);
  const combined = new Uint8Array(encrypted.length + authTag.length);
  combined.set(encrypted, 0);
  combined.set(authTag, encrypted.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    combined.buffer
  );
  return textDecoder.decode(decrypted);
}

async function importHmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const raw = textEncoder.encode(secret);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

export async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encoded = bytesToBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret, 'sign');
  const sigBuf = await crypto.subtle.sign('HMAC', key, textEncoder.encode(encoded));
  const sig = bytesToBase64Url(new Uint8Array(sigBuf));
  return `${encoded}.${sig}`;
}

export async function verifyToken<T extends Record<string, unknown>>(
  token: string,
  secret: string
): Promise<T | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  try {
    const key = await importHmacKey(secret, 'verify');
    const sigBytes = new Uint8Array(base64UrlToBytes(sig));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes.buffer,
      textEncoder.encode(encoded)
    );
    if (!valid) return null;

    const parsed = JSON.parse(textDecoder.decode(base64UrlToBytes(encoded))) as T;
    if (typeof parsed.exp === 'number' && Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function hashIp(ip: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(ip || 'unknown'));
  return bytesToHex(new Uint8Array(sig));
}

export async function hashPassword(password: string): Promise<string> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToHex(saltBytes);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode(salt),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  return `pbkdf2$sha256$100000$${salt}$${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || typeof storedHash !== 'string') return false;
  if (!storedHash.startsWith('pbkdf2$sha256$')) return false;

  const parts = storedHash.split('$');
  if (parts.length !== 5) return false;
  const iterations = Number(parts[2]);
  const salt = parts[3];
  const expectedHex = parts[4];
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100_000 || !salt || !expectedHex) {
    return false;
  }

  try {
    const expected = hexToBytes(expectedHex);
    const baseKey = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: textEncoder.encode(salt),
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      expected.length * 8
    );
    return constantTimeEqual(new Uint8Array(bits), expected);
  } catch {
    return false;
  }
}
