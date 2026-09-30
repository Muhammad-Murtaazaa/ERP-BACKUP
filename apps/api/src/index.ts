import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbMigrator, SyntheticSeedRunner } from '@omnysync/platform';
import { createApp } from './app.js';
import { db } from './context.js';
import { startScheduler } from './automation/scheduler.js';
import { seedModules } from './lib/module-seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4000);

const app = createApp();

export const MIGRATIONS_DIR = path.join(__dirname, '../../../packages/platform/src/db/migrations');

// Start server after ensuring migrations run and (demo-only) seed is ready
export async function startServer() {
  const migrator = new DbMigrator(db, MIGRATIONS_DIR);
  await migrator.runMigrations();
  if (process.env.OMNYSYNC_DEMO_SEED !== 'false') {
    const seeder = new SyntheticSeedRunner(db);
    await seeder.runSeed();
    await seedModules(db);
  }
  if (process.env.OMNYSYNC_SCHEDULER !== 'false') {
    startScheduler(db);
  }

  return app.listen(PORT, () => {
    console.log(`[Omnysync Modular Monolith API] Listening on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test' && process.env.VITEST === undefined) {
  startServer();
}

export { app, db };
