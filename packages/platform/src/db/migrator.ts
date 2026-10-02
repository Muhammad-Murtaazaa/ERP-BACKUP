import { DbClient } from './driver.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DbMigrator {
  private db: DbClient;
  private migrationsDir: string;

  constructor(db: DbClient, migrationsDir?: string) {
    this.db = db;
    const candidates = [
      migrationsDir,
      path.join(__dirname, 'migrations'),
      path.join(__dirname, '../../src/db/migrations'),
      path.join(__dirname, '../../../packages/platform/src/db/migrations'),
      path.resolve(process.cwd(), 'packages/platform/src/db/migrations'),
      path.resolve(process.cwd(), 'packages/platform/dist/db/migrations'),
    ].filter(Boolean) as string[];

    this.migrationsDir = candidates.find((d) => fs.existsSync(d)) || path.join(__dirname, 'migrations');
  }

  async runMigrations(): Promise<{ applied: string[]; alreadyApplied: string[] }> {
    // Ensure _migrations table exists
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedRows = await this.db.query<{ name: string }>('SELECT name FROM _migrations ORDER BY id ASC');
    const appliedSet = new Set(appliedRows.rows.map((r) => r.name));

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        alreadyApplied.push(file);
        continue;
      }

      const filePath = path.join(this.migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      await this.db.transaction(async (tx) => {
        // Run migration multi-statement SQL script
        await tx.exec(sql);
        await tx.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      });

      applied.push(file);
      // Yield to event loop to allow memory garbage collection between large DDL files
      await new Promise((resolve) => setImmediate(resolve));
    }

    return { applied, alreadyApplied };
  }
}
