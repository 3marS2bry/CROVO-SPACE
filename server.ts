import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { handleApiRequest } from './functions/_lib/router.ts';
import type { Env } from './functions/_lib/types.ts';

function buildEnvFromProcess(extra?: Partial<Env>): Env {
  return {
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_DATABASE_ID: process.env.FIREBASE_DATABASE_ID,
    FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
    SESSION_SECRET: process.env.SESSION_SECRET,
    CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_FIREBASE_EMAIL: process.env.ADMIN_FIREBASE_EMAIL,
    ADMIN_FIREBASE_PASSWORD: process.env.ADMIN_FIREBASE_PASSWORD,
    ADMIN_WHATSAPP_NUMBER: process.env.ADMIN_WHATSAPP_NUMBER,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    PUSH_CRON_SECRET: process.env.PUSH_CRON_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    ...extra,
  };
}

function toWebRequest(req: ExpressRequest): Request {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const url = `${proto}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      headers.set(k, v.join(', '));
    } else {
      headers.set(k, v);
    }
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body =
    hasBody && req.body !== undefined
      ? typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body)
      : undefined;

  return new Request(url, {
    method,
    headers,
    body,
  });
}

export interface CreateServerOptions {
  skipVite?: boolean;
  envOverrides?: Partial<Env>;
}

export async function createCrovoApp(options: CreateServerOptions = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));

  app.all('/api/*', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const webReq = toWebRequest(req);
      const webRes = await handleApiRequest(webReq, buildEnvFromProcess(options.envOverrides));

      res.status(webRes.status);
      const setCookies: string[] = [];
      webRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') {
          setCookies.push(value);
        } else {
          res.setHeader(key, value);
        }
      });
      if (setCookies.length > 0) {
        res.setHeader('Set-Cookie', setCookies);
      }

      const buf = Buffer.from(await webRes.arrayBuffer());
      res.send(buf);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    }
  });

  if (!options.skipVite) {
    if (process.env.NODE_ENV === 'production') {
      const distDir = path.resolve(process.cwd(), 'dist');
      if (fs.existsSync(distDir)) {
        app.use(express.static(distDir));
        app.get('*', (_req, res) => {
          res.sendFile(path.join(distDir, 'index.html'));
        });
      }
    } else {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  }

  return { app };
}

async function main() {
  const port = Number(process.env.PORT || 3000);
  const { app } = await createCrovoApp();
  app.listen(port, '0.0.0.0', () => {
    console.log(`CROVO SPACE server (Firebase Firestore) running on http://localhost:${port}`);
  });
}

const isEntrypoint =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('server.ts');

if (isEntrypoint) {
  main().catch((err) => {
    console.error('Failed to start CROVO SPACE server:', err);
    process.exit(1);
  });
}
