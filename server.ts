import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { Env } from './functions/_lib/types.ts';

type RouterModule = typeof import('./functions/_lib/router.ts');
let routerPromise: Promise<RouterModule> | null = null;
function loadRouter(): Promise<RouterModule> {
  if (!routerPromise) {
    routerPromise = import('./functions/_lib/router.ts');
  }
  return routerPromise;
}

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

const VITE_CLIENT_STUB = `
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== 'undefined') {
  document.querySelectorAll('style[data-vite-dev-id]').forEach((el) => {
    sheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
      if (el.getAttribute('data-vite-dev-id') === id) el.remove();
    });
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
    acceptDeps() {},
  };
}
export class ErrorOverlay {
  constructor() {}
}
`;

export interface CreateServerOptions {
  skipVite?: boolean;
  deferSetup?: boolean;
  envOverrides?: Partial<Env>;
}

export async function createCrovoApp(options: CreateServerOptions = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));

  app.all('/api/*', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { handleApiRequest } = await loadRouter();
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

  const setupFrontend = async () => {
    if (options.skipVite) return;
    if (process.env.NODE_ENV === 'production') {
      const distDir = path.resolve(process.cwd(), 'dist');
      if (fs.existsSync(distDir)) {
        app.use(express.static(distDir));
        app.get('*', (_req, res) => {
          res.sendFile(path.join(distDir, 'index.html'));
        });
      } else {
        app.get('*', (_req, res) => {
          res.status(503).send('Production build directory (dist) not found.');
        });
      }
      return;
    }

    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript; charset=utf-8').send(VITE_CLIENT_STUB);
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  };

  if (options.deferSetup) {
    if (process.env.NODE_ENV === 'production') {
      await setupFrontend();
      const warmup = () => {
        void loadRouter().catch((err) => {
          console.error('CROVO SPACE background router warmup failed:', err);
        });
      };
      return { app, warmup };
    }

    let frontendReady: Promise<void> | null = null;
    app.use(async (_req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
      if (!frontendReady) {
        frontendReady = setupFrontend().then(() => undefined);
      }
      try {
        await frontendReady;
        next();
      } catch (err) {
        next(err);
      }
    });
    const warmup = () => {
      if (!frontendReady) {
        frontendReady = setupFrontend().then(() => undefined);
        frontendReady.catch((err) => {
          console.error('CROVO SPACE background frontend warmup failed:', err);
        });
      }
      void loadRouter().catch((err) => {
        console.error('CROVO SPACE background router warmup failed:', err);
      });
    };
    return { app, warmup };
  }

  await setupFrontend();
  return { app, warmup: () => {} };
}

async function main() {
  const port = Number(process.env.PORT || 3000);
  const { app, warmup } = await createCrovoApp({ deferSetup: true });
  app.listen(port, '0.0.0.0', () => {
    console.log(`CROVO SPACE server (Firebase Firestore) running on http://localhost:${port}`);
    warmup();
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
