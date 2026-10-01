import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DbMigrator, SyntheticSeedRunner } from '@omnysync/platform';
import { createApp } from './app.js';
import { db } from './context.js';
import { startScheduler } from './automation/scheduler.js';
import { startKeepAliveScheduler } from './automation/keep-alive.js';
import { seedModules } from './lib/module-seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4000);

const app = createApp();

const candidateMigrationDirs = [
  path.join(__dirname, '../../../packages/platform/src/db/migrations'),
  path.join(__dirname, '../../packages/platform/src/db/migrations'),
  path.join(__dirname, '../packages/platform/src/db/migrations'),
  path.resolve(process.cwd(), 'packages/platform/src/db/migrations'),
];
export const MIGRATIONS_DIR = candidateMigrationDirs.find((d) => fs.existsSync(d)) || candidateMigrationDirs[0];

// Start server after ensuring migrations run and (demo-only) seed is ready
export async function startServer() {
  console.log(`[Omnysync Boot] Initializing database and running migrations...`);
  const migrator = new DbMigrator(db, MIGRATIONS_DIR);
  await migrator.runMigrations();
  console.log(`[Omnysync Boot] Migrations applied successfully.`);

  if (process.env.OMNYSYNC_DEMO_SEED === 'true') {
    console.log(`[Omnysync Boot] Seeding initial dataset...`);
    try {
      const seeder = new SyntheticSeedRunner(db);
      await seeder.runSeed();
      await seedModules(db);
      console.log(`[Omnysync Boot] Seeding completed.`);
    } catch (err) {
      console.warn(`[Omnysync Boot] Non-critical warning during seeding:`, err);
    }
  } else {
    console.log(`[Omnysync Boot] Production mode: Skipping synthetic demo dataset (OMNYSYNC_DEMO_SEED=false).`);
    // Ensure at least 1 default root admin & organization exists
    try {
      const seeder = new SyntheticSeedRunner(db);
      await seeder.runSeed();
    } catch {
      // Ignored if already initialized
    }
  }

  if (process.env.OMNYSYNC_SCHEDULER !== 'false') {
    startScheduler(db);
  }
  startKeepAliveScheduler();

  const mem = process.memoryUsage();
  console.log(`[Omnysync Boot] Ready! Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB | RSS: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);

  return app.listen(PORT, () => {
    console.log(`[Omnysync Modular Monolith API] Listening on port ${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test' && process.env.VITEST === undefined) {
  startServer();
}

export { app, db };
