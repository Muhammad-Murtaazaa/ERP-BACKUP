import type { DbClient } from '@omnysync/platform';
import { ensureDefaultRules, tick } from './engine.js';
import { processEvents } from './events.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * In-process scheduler (no external cron). Ticks every OMNYSYNC_AUTOMATION_TICK_MS
 * (default 60s). Overlapping ticks are skipped; the database dedupes occurrences, so
 * several API instances can run schedulers safely.
 */
export function startScheduler(db: DbClient): void {
  if (timer) return;
  const every = Math.max(5000, Number(process.env.OMNYSYNC_AUTOMATION_TICK_MS || 60000));
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const orgs = await db.query(`SELECT id FROM organizations`);
      for (const o of orgs.rows) await ensureDefaultRules(db, o.id);
      const results = await tick(db);
      await processEvents(db);
      for (const r of results) if (r.outcome.status !== 'SUCCEEDED') console.warn(`[automation] ${r.rule}: ${r.outcome.status} ${r.outcome.error || ''}`);
    } catch (e) {
      console.error('[automation] tick failed', e);
    } finally {
      running = false;
    }
  };
  timer = setInterval(run, every);
  timer.unref?.();
  setTimeout(run, 2000).unref?.();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
