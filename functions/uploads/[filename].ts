import type { PagesFunction } from '../_lib/types';

function toUint8Array(raw: unknown): Uint8Array | null {
  if (!raw) return null;
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  if (Array.isArray(raw)) return new Uint8Array(raw as number[]);
  return null;
}

export const onRequestGet: PagesFunction = async (context) => {
  const rawParam = context.params.filename;
  const filename = Array.isArray(rawParam) ? rawParam[0] : rawParam;

  if (!filename || !/^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(filename)) {
    return new Response(null, { status: 404 });
  }

  const row = await context.env.DB.prepare('SELECT mime_type, data FROM uploaded_media WHERE id = ?')
    .bind(filename)
    .first<{ mime_type: string; data: unknown }>();

  const bytes = toUint8Array(row?.data);
  if (!row || !bytes) {
    return new Response(null, { status: 404 });
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return new Response(copy.buffer, {
    status: 200,
    headers: {
      'Content-Type': row.mime_type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
