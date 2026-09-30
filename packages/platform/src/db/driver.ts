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
 * PGlite Database Adapter (Embedded WebAssembly PostgreSQL 16 engine)
 */
export class PGliteAdapter implements DbClient {
  private pglite: PGlite;

  constructor(dataDirOrInstance?: string | PGlite) {
    if (dataDirOrInstance instanceof PGlite) {
      this.pglite = dataDirOrInstance;
    } else {
      this.pglite = new PGlite(dataDirOrInstance);
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const res = await this.pglite.query(sql, params);
    return {
      rows: (res.rows || []) as T[],
      rowCount: (res.rows || []).length,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pglite.exec(sql);
  }

  async transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T> {
    await this.pglite.exec('BEGIN');
    try {
      const result = await callback(this);
      await this.pglite.exec('COMMIT');
      return result;
    } catch (err) {
      await this.pglite.exec('ROLLBACK');
      throw err;
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

  constructor(connectionStringOrConfig: string | pg.PoolConfig) {
    if (typeof connectionStringOrConfig === 'string') {
      this.pool = new pg.Pool({ connectionString: connectionStringOrConfig });
    } else {
      this.pool = new pg.Pool(connectionStringOrConfig);
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? res.rows.length,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const wrappedClient: DbClient = {
        query: async (sql, params = []) => {
          const res = await client.query(sql, params);
          return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
        },
        exec: async (sql) => {
          await client.query(sql);
        },
        transaction: () => {
          throw new Error('Nested transactions not supported');
        },
        close: async () => {},
      };
      const result = await callback(wrappedClient);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
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
