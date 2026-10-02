#!/usr/bin/env node
import { db } from '../apps/api/dist/context.js';
import { DbMigrator, SyntheticSeedRunner } from '../packages/platform/dist/index.js';
import { seedModules } from '../apps/api/dist/lib/module-seed.js';

const action = process.argv[2] || 'migrate';

async function main() {
  const isPostgres = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  console.log(`[Omnysync DB Tool] Target engine: ${isPostgres ? 'PostgreSQL (Supabase/Cloud)' : 'PGlite (Embedded local)'}`);

  if (action === 'migrate' || action === 'init') {
    console.log('[Omnysync DB Tool] Running migrations...');
    const migrator = new DbMigrator(db);
    const { applied, alreadyApplied } = await migrator.runMigrations();
    console.log(`[Omnysync DB Tool] Applied: ${applied.length} migration(s). Already up-to-date: ${alreadyApplied.length}.`);
  }

  if (action === 'seed' || action === 'init') {
    console.log('[Omnysync DB Tool] Running synthetic demo seed...');
    const seeder = new SyntheticSeedRunner(db);
    await seeder.runSeed();
    const modules = await seedModules(db);
    console.log(`[Omnysync DB Tool] Seed completed: core datasets + ${modules.length} modules initialized.`);
  }

  await db.close();
  console.log('[Omnysync DB Tool] Done.');
}

main().catch((err) => {
  console.error('[Omnysync DB Tool] Error:', err);
  process.exit(1);
});
