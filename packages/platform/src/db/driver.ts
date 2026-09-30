import { AsyncLocalStorage } from 'node:async_hooks';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

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
export class PGliteAdapter implements DbClient {
  private pglite: PGlite;
  private mutex = new Mutex();
  private txContext = new AsyncLocalStorage<{ depth: number }>();

  constructor(dataDirOrInstance?: string | PGlite) {
    if (dataDirOrInstance instanceof PGlite) {
      this.pglite = dataDirOrInstance;
    } else {
      this.pglite = new PGlite(dataDirOrInstance);
    }
  }

  private async rawQuery<T>(sql: string, params: any[]): Promise<QueryResult<T>> {
    const res = await this.pglite.query(sql, params);
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
    if (this.txContext.getStore()) {
      await this.pglite.exec(sql);
      return;
    }
    const release = await this.mutex.acquire();
    try {
      await this.pglite.exec(sql);
    } finally {
      release();
    }
  }

  async transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T> {
    const store = this.txContext.getStore();
    if (store) {
      // Nested unit of work: use a savepoint inside the already-open transaction.
      const sp = `sp_${store.depth + 1}`;
      store.depth += 1;
      await this.pglite.exec(`SAVEPOINT ${sp}`);
      try {
        const result = await callback(this);
        await this.pglite.exec(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        await this.pglite.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw err;
      } finally {
        store.depth -= 1;
      }
    }

    const release = await this.mutex.acquire();
    try {
      return await this.txContext.run({ depth: 0 }, async () => {
        await this.pglite.exec('BEGIN');
        try {
          const result = await callback(this);
          await this.pglite.exec('COMMIT');
          return result;
        } catch (err) {
          await this.pglite.exec('ROLLBACK');
          throw err;
        }
      });
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    await this.pglite.close();
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
      this.pool = new pg.Pool({ connectionString: connectionStringOrConfig });
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
