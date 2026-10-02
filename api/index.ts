import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp, db } from '../apps/api/dist/index.js';
import { DbMigrator, SyntheticSeedRunner } from '@omnysync/platform';
import { seedModules } from '../apps/api/dist/lib/module-seed.js';

let initialized = false;
let initPromise: Promise<void> | null = null;

async function ensureInitialized() {
  if (initialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        console.log('[Vercel Serverless] Checking database migrations...');
        const migrator = new DbMigrator(db);
        const { applied } = await migrator.runMigrations();
        if (applied.length > 0) {
          console.log(`[Vercel Serverless] Applied ${applied.length} new migrations to database.`);
        }
        if (process.env.OMNYSYNC_DEMO_SEED === 'true') {
          console.log('[Vercel Serverless] Seeding demo dataset...');
          const seeder = new SyntheticSeedRunner(db);
          await seeder.runSeed();
          await seedModules(db);
          console.log('[Vercel Serverless] Seeding completed.');
        } else {
          try {
            const seeder = new SyntheticSeedRunner(db);
            await seeder.runSeed();
          } catch {
            // Ignored if already initialized
          }
        }
      } catch (err) {
        console.error('[Vercel Serverless] DB initialization warning:', err);
      } finally {
        initialized = true;
      }
    })();
  }
  await initPromise;
}

const app = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ensureInitialized();
  return (app as any)(req, res);
}
