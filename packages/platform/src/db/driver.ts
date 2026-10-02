import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
// PGlite is loaded lazily (dynamic import) so it is not required when using PgPoolAdapter.
// A static top-level import of @electric-sql/pglite would crash the Vercel serverless
// function at startup even when DATABASE_URL is set and PGlite is never instantiated.
import type { PGlite as PGliteType } from '@electric-sql/pglite';
import pg from 'pg';

// Lazy loader — returns the PGlite constructor only when first called.
let _PGlite: typeof PGliteType | undefined;
async function loadPGlite(): Promise<typeof PGliteType> {
  if (!_PGlite) {
    const mod = await import('@electric-sql/pglite');
    _PGlite = mod.PGlite;
  }
  return _PGlite!;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Serial async mutex. PGlite exposes a single connection, so interleaving two
 * requests' BEGIN/COMMIT blocks on it would silently merge their units of work
 * (and a ROLLBACK in one would discard the other's writes). Every transaction and
 * every out-of-transaction statement therefore acquires this lock.
 */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = prev.then(() => next);
    await prev;
    return release;
  }
}

/**
 * PGlite Database Adapter (Embedded WebAssembly PostgreSQL 16 engine)
 *
 * Transactions are serialized. Code running inside a transaction callback that
 * (accidentally or through a shared service) calls the adapter directly instead of
 * the transaction client is routed to the same open transaction via
 * AsyncLocalStorage, so it neither deadlocks nor escapes the unit of work.
 */
const DATE_AS_STRING = { 1082: (v: string) => v };

export class PGliteAdapter implements DbClient {
  // pglite is initialized lazily on first use via the `ready` promise.
  private pglite: PGliteType | undefined;
  private ready: Promise<PGliteType>;
  private mutex = new Mutex();
  private txContext = new AsyncLocalStorage<{ depth: number }>();

  constructor(dataDirOrInstance?: string | PGliteType) {
    this.ready = this._init(dataDirOrInstance);
  }

  private async _init(dataDirOrInstance?: string | PGliteType): Promise<PGliteType> {
    const PGlite = await loadPGlite();

    if (dataDirOrInstance instanceof PGlite) {
      this.pglite = dataDirOrInstance;
      return this.pglite;
    }

    if (typeof dataDirOrInstance === 'string' && dataDirOrInstance.length > 0) {
      try {
        const resolvedPath = path.resolve(dataDirOrInstance);
        const parentDir = path.dirname(resolvedPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
      } catch {
        // Fallback to default
      }
    }

    try {
      this.pglite = new PGlite(dataDirOrInstance as string | undefined);
    } catch (err) {
      console.warn('[PGliteAdapter] Could not initialize at path, falling back to in-memory:', err);
      this.pglite = new PGlite();
    }
    return this.pglite;
  }

  private async getPGlite(): Promise<PGliteType> {
    return this.pglite ?? this.ready;
  }

  private async rawQuery<T>(sql: string, params: any[]): Promise<QueryResult<T>> {
    const pglite = await this.getPGlite();
    // DATE (oid 1082) stays a 'YYYY-MM-DD' string: calendar dates have no time zone, and
    // parsing them into JS Dates leaked "2026-03-01T00:00:00.000Z" into the UI/API and
    // risked off-by-one days when formatted in local time.
    const res = await pglite.query(sql, params, { parsers: DATE_AS_STRING });
    const rows = (res.rows || []) as T[];
    return {
      rows,
      rowCount: rows.length > 0 ? rows.length : (res.affectedRows ?? 0),
    };
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    if (this.txContext.getStore()) {
      return this.rawQuery<T>(sql, params);
    }
    const release = await this.mutex.acquire();
    try {
      return await this.rawQuery<T>(sql, params);
    } finally {
      release();
    }
  }

  async exec(sql: string): Promise<void> {
    const pglite = await this.getPGlite();
    if (this.txContext.getStore()) {
      await pglite.exec(sql);
      return;
    }
    const release = await this.mutex.acquire();
    try {
      await pglite.exec(sql);
    } finally {
      release();
    }
  }

  async transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T> {
    const pglite = await this.getPGlite();
    const store = this.txContext.getStore();
    if (store) {
      // Nested unit of work: use a savepoint inside the already-open transaction.
      const sp = `sp_${store.depth + 1}`;
      store.depth += 1;
      await pglite.exec(`SAVEPOINT ${sp}`);
      try {
        const result = await callback(this);
        await pglite.exec(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        await pglite.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw err;
      } finally {
        store.depth -= 1;
      }
    }

    const release = await this.mutex.acquire();
    try {
      return await this.txContext.run({ depth: 0 }, async () => {
        await pglite.exec('BEGIN');
        try {
          const result = await callback(this);
          await pglite.exec('COMMIT');
          return result;
        } catch (err) {
          await pglite.exec('ROLLBACK');
          throw err;
        }
      });
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    const pglite = await this.getPGlite();
    await pglite.close();
  }
}

/**
 * Standard PostgreSQL Pool Adapter (for client VPS / Docker / Cloud PostgreSQL)
 */
export class PgPoolAdapter implements DbClient {
  private pool: pg.Pool;
  private txContext = new AsyncLocalStorage<{ client: pg.PoolClient; depth: number }>();

  constructor(connectionStringOrConfig: string | pg.PoolConfig) {
    if (typeof connectionStringOrConfig === 'string') {
      const isRemote =
        /supabase|neon|pooler|render|railway|amazonaws\.com|azure/i.test(connectionStringOrConfig) ||
        connectionStringOrConfig.includes('sslmode=') ||
        process.env.DATABASE_SSL === 'true';

      const config: pg.PoolConfig = {
        connectionString: connectionStringOrConfig,
        max: Number(process.env.DB_POOL_MAX || 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };

      if (isRemote) {
        config.ssl = { rejectUnauthorized: false };
      }

      this.pool = new pg.Pool(config);
    } else {
      this.pool = new pg.Pool(connectionStringOrConfig);
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const store = this.txContext.getStore();
    const res = store ? await store.client.query(sql, params) : await this.pool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  }

  async exec(sql: string): Promise<void> {
    const store = this.txContext.getStore();
    if (store) await store.client.query(sql);
    else await this.pool.query(sql);
  }

  async transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T> {
    const store = this.txContext.getStore();
    if (store) {
      const sp = `sp_${store.depth + 1}`;
      store.depth += 1;
      await store.client.query(`SAVEPOINT ${sp}`);
      try {
        const result = await callback(this);
        await store.client.query(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        await store.client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw err;
      } finally {
        store.depth -= 1;
      }
    }

    const client = await this.pool.connect();
    try {
      return await this.txContext.run({ client, depth: 0 }, async () => {
        await client.query('BEGIN');
        try {
          const result = await callback(this);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Factory to create database client based on environment
 */
export function createDbClient(driver: 'pglite' | 'postgres' = 'pglite', connectionString?: string): DbClient {
  if (driver === 'postgres' && connectionString) {
    return new PgPoolAdapter(connectionString);
  }
  return new PGliteAdapter();
}
