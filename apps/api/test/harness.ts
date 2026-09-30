/**
 * Shared in-process HTTP harness for API integration tests (no network ports).
 * Mirrors the helper in api.test.ts, plus optional extra headers (Idempotency-Key).
 */
import { app, db } from '../src/index.js';
import { seedModules } from '../src/lib/module-seed.js';
import { DbMigrator, SyntheticSeedRunner } from '@omnysync/platform';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper for testing express endpoints without opening external network ports
export async function makeRequest(
  method: 'GET' | 'POST',
  pathStr: string,
  body?: any,
  token?: string,
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req: any = {
      method,
      url: pathStr,
      originalUrl: pathStr,
      headers,
      body: body || {},
      query: {},
      params: {},
    };

    if (pathStr.includes('?')) {
      const [p, q] = pathStr.split('?');
      req.url = p;
      req.originalUrl = pathStr;
      const searchParams = new URLSearchParams(q);
      for (const [k, v] of searchParams.entries()) {
        req.query[k] = v;
      }
    }

    const res: any = {
      statusCode: 200,
      headers: {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      getHeader(k: string) {
        return this.headers[k.toLowerCase()];
      },
      removeHeader(k: string) {
        delete this.headers[k.toLowerCase()];
      },
      end() {
        resolve({ status: this.statusCode, body: null });
      },
      json(data: any) {
        resolve({ status: this.statusCode, body: data });
      },
      on(_event: string, _cb: any) {},
    };

    (app as any).handle(req, res, (err: any) => {
      if (err) reject(err);
      else resolve({ status: res.statusCode, body: null });
    });
  });
}


export async function bootstrap(): Promise<void> {
  const migrator = new DbMigrator(db, path.join(__dirname, '../../../packages/platform/src/db/migrations'));
  await migrator.runMigrations();
  await new SyntheticSeedRunner(db).runSeed();
  await seedModules(db);
}

export async function login(email: string): Promise<string> {
  const r = await makeRequest('POST', '/api/auth/login', { email, password: 'Password123!' });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.body.data.token;
}

export { db };
