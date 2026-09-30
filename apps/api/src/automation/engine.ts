/**
 * Automation engine: runs rules as durable, uniquely-keyed occurrences.
 *  - dedupe: (rule_id, occurrence_key) is unique, so a trigger delivered twice runs once
 *  - lease: a RUNNING attempt holds a lease; an expired lease (crash) may be retried
 *  - retry: failures back off exponentially up to max_attempts, then DEAD + owner alert
 *  - pause/kill switch: paused or inactive rules never run on schedule
 *  - bounded: one tick runs at most MAX_RULES_PER_TICK rules; handlers are bounded
 * Handler work and alert upserts commit atomically; the run record is written outside
 * that transaction so a failure is recorded even though the work rolled back.
 */
import type { DbClient } from '@omnysync/platform';
import { auditLogger } from '../context.js';
import { backoffMs, localDate, nextRun, occurrenceKey } from './schedule.js';
import { DEFAULT_RULES, JOB_HANDLERS, type DetectedAlert } from './jobs.js';

const MAX_RULES_PER_TICK = 25;
const LEASE_MS = 5 * 60000;

export async function ensureDefaultRules(q: DbClient, orgId: string, now = new Date()): Promise<void> {
  for (const r of DEFAULT_RULES) {
    const spec = { schedule_kind: r.schedule_kind, interval_minutes: r.interval_minutes ?? null, run_at_local: r.run_at_local ?? '06:00', timezone: 'Asia/Karachi' };
    await q.query(
      `INSERT INTO automation_rules (organization_id, code, name, description, job_type, tier, schedule_kind, interval_minutes, run_at_local, config, owner_role, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (organization_id, code) DO NOTHING`,
      [orgId, r.code, r.name, r.description, r.job_type, r.tier, r.schedule_kind, r.interval_minutes ?? null, spec.run_at_local, JSON.stringify(r.config || {}), r.owner_role, nextRun(spec, now).toISOString()],
    );
  }
}

async function upsertAlerts(q: DbClient, orgId: string, ruleId: string, runId: string, ownerRole: string, alerts: DetectedAlert[], resolveScope?: string) {
  let opened = 0;
  let refreshed = 0;
  for (const a of alerts) {
    const existing = await q.query(`SELECT id FROM automation_alerts WHERE organization_id = $1 AND dedupe_key = $2 AND status <> 'RESOLVED' FOR UPDATE`, [orgId, a.dedupe_key]);
    if (existing.rows.length) {
      await q.query(
        `UPDATE automation_alerts SET occurrences = occurrences + 1, last_seen_at = NOW(), run_id = $2, severity = $3, title = $4, body = $5, data = $6 WHERE id = $1`,
        [existing.rows[0].id, runId, a.severity, a.title, a.body ?? null, a.data ? JSON.stringify(a.data) : null],
      );
      refreshed++;
    } else {
      await q.query(
        `INSERT INTO automation_alerts (organization_id, rule_id, run_id, category, severity, title, body, entity_type, entity_id, dedupe_key, data, assigned_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [orgId, ruleId, runId, a.category, a.severity, a.title, a.body ?? null, a.entity_type ?? null, a.entity_id ?? null, a.dedupe_key, a.data ? JSON.stringify(a.data) : null, ownerRole],
      );
      opened++;
    }
  }
  let resolved = 0;
  if (resolveScope) {
    const keys = alerts.map((a) => a.dedupe_key);
    const r = await q.query(
      `UPDATE automation_alerts SET status = 'RESOLVED', resolved_at = NOW(), body = COALESCE(body,'') || ' [auto-resolved: condition cleared]'
       WHERE organization_id = $1 AND status <> 'RESOLVED' AND dedupe_key LIKE $2 AND NOT (dedupe_key = ANY($3::text[])) RETURNING id`,
      [orgId, `${resolveScope}%`, keys],
    );
    resolved = r.rows.length;
  }
  return { opened, refreshed, resolved };
}

export interface RunOutcome {
  run_id: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'DEAD' | 'SKIPPED_DUPLICATE' | 'SKIPPED_RUNNING';
  summary?: unknown;
  error?: string;
}

/**
 * Executes one occurrence of a rule. `occurrence` defaults to the schedule slot of `now`;
 * manual runs pass a unique key. A repeated call with the same key is a no-op.
 */
export async function runRule(db: DbClient, rule: any, opts: { trigger: 'SCHEDULE' | 'MANUAL'; userId?: string | null; now?: Date; occurrence?: string }): Promise<RunOutcome> {
  const now = opts.now || new Date();
  const spec = { schedule_kind: rule.schedule_kind, interval_minutes: rule.interval_minutes, run_at_local: String(rule.run_at_local || '06:00'), day_of_month: rule.day_of_month, timezone: rule.timezone };
  const key = opts.occurrence || occurrenceKey(spec, now);
  const handler = JOB_HANDLERS[rule.job_type];

  // Claim the occurrence (dedupe) or take over an expired lease / failed attempt.
  const claim = await db.transaction(async (tx) => {
    const ins = await tx.query(
      `INSERT INTO automation_runs (organization_id, rule_id, rule_version, occurrence_key, trigger, triggered_by, status, lease_until)
       VALUES ($1,$2,$3,$4,$5,$6,'RUNNING',$7) ON CONFLICT (rule_id, occurrence_key) DO NOTHING RETURNING id, attempts`,
      [rule.organization_id, rule.id, rule.version, key, opts.trigger, opts.userId ?? null, new Date(now.getTime() + LEASE_MS).toISOString()],
    );
    if (ins.rows.length) return { id: ins.rows[0].id as string, attempts: 1 };
    const ex = (await tx.query(`SELECT * FROM automation_runs WHERE rule_id = $1 AND occurrence_key = $2 FOR UPDATE`, [rule.id, key])).rows[0];
    if (ex.status === 'SUCCEEDED' || ex.status === 'DEAD') return { dup: true as const, id: ex.id };
    if (ex.status === 'RUNNING' && new Date(ex.lease_until).getTime() > now.getTime()) return { running: true as const, id: ex.id };
    const up = await tx.query(`UPDATE automation_runs SET status = 'RUNNING', attempts = attempts + 1, lease_until = $2, error = NULL, started_at = NOW() WHERE id = $1 RETURNING attempts`, [
      ex.id, new Date(now.getTime() + LEASE_MS).toISOString(),
    ]);
    return { id: ex.id as string, attempts: up.rows[0].attempts as number };
  });
  if ('dup' in claim) return { run_id: claim.id, status: 'SKIPPED_DUPLICATE' };
  if ('running' in claim) return { run_id: claim.id, status: 'SKIPPED_RUNNING' };

  try {
    if (!handler) throw new Error(`No handler for job type ${rule.job_type}`);
    const config = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config || {};
    const result = await db.transaction(async (tx) => {
      const r = await handler({ q: tx, orgId: rule.organization_id, rule, config, today: localDate(now, rule.timezone || 'Asia/Karachi'), now });
      const alerts = await upsertAlerts(tx, rule.organization_id, rule.id, claim.id, rule.owner_role, r.alerts, r.resolveScope);
      const summary = { ...r.summary, alerts };
      await tx.query(`UPDATE automation_runs SET status = 'SUCCEEDED', finished_at = NOW(), lease_until = NULL, summary = $2 WHERE id = $1`, [claim.id, JSON.stringify(summary)]);
      await tx.query(`UPDATE automation_rules SET last_run_at = NOW(), last_status = 'SUCCEEDED' WHERE id = $1`, [rule.id]);
      await auditLogger.record(
        { organization_id: rule.organization_id, user_id: opts.userId ?? null, action: 'AUTOMATION_RUN_SUCCEEDED', entity_type: 'AUTOMATION_RULE', entity_id: rule.id, after_state: { run_id: claim.id, occurrence: key, trigger: opts.trigger, summary } } as any,
        tx,
      );
      return summary;
    });
    return { run_id: claim.id, status: 'SUCCEEDED', summary: result };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 2000);
    const dead = claim.attempts >= (rule.max_attempts || 3);
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE automation_runs SET status = $2, finished_at = NOW(), lease_until = NULL, error = $3 WHERE id = $1`, [claim.id, dead ? 'DEAD' : 'FAILED', msg]);
      if (opts.trigger === 'SCHEDULE') {
        // Retry the SAME occurrence after a bounded backoff; once dead, move on to the next slot.
        await tx.query(`UPDATE automation_rules SET last_run_at = NOW(), last_status = $2, next_run_at = $3, pending_occurrence = $4 WHERE id = $1`, [
          rule.id, dead ? 'DEAD' : 'FAILED', dead ? nextRun(spec, now).toISOString() : new Date(now.getTime() + backoffMs(claim.attempts)).toISOString(), dead ? null : key,
        ]);
      } else {
        await tx.query(`UPDATE automation_rules SET last_run_at = NOW(), last_status = $2 WHERE id = $1`, [rule.id, dead ? 'DEAD' : 'FAILED']);
      }
      if (dead) {
        await upsertAlerts(tx, rule.organization_id, rule.id, claim.id, rule.owner_role, [
          { dedupe_key: `AUTOMATION_DEAD:${rule.id}:${key}`, category: 'AUTOMATION', severity: 'CRITICAL', title: `Automation “${rule.name}” failed ${claim.attempts} time(s)`, body: `Dead-lettered occurrence ${key}: ${msg}. Fix the cause, then run it manually.`, entity_type: 'AUTOMATION_RULE', entity_id: rule.id },
        ]);
      }
    });
    return { run_id: claim.id, status: dead ? 'DEAD' : 'FAILED', error: msg };
  }
}

/** Runs every due, active, unpaused rule once. Returns what happened (for logs / manual ticks). */
export async function tick(db: DbClient, now = new Date(), orgId?: string): Promise<{ rule: string; outcome: RunOutcome }[]> {
  const params: any[] = [now.toISOString()];
  let where = `is_active = true AND paused = false AND next_run_at IS NOT NULL AND next_run_at <= $1`;
  if (orgId) {
    params.push(orgId);
    where += ` AND organization_id = $2`;
  }
  const due = await db.query(`SELECT * FROM automation_rules WHERE ${where} ORDER BY next_run_at LIMIT ${MAX_RULES_PER_TICK}`, params);
  const out: { rule: string; outcome: RunOutcome }[] = [];
  for (const rule of due.rows) {
    const spec = { schedule_kind: rule.schedule_kind, interval_minutes: rule.interval_minutes, run_at_local: String(rule.run_at_local || '06:00'), day_of_month: rule.day_of_month, timezone: rule.timezone };
    // The occurrence is the slot the rule was due for, so a late tick still dedupes correctly.
    // A pending retry reuses its occurrence key (and attempt counter).
    const slot = new Date(rule.next_run_at);
    const occurrence = rule.pending_occurrence || occurrenceKey(spec, slot);
    const outcome = await runRule(db, rule, { trigger: 'SCHEDULE', now, occurrence });
    if (outcome.status === 'SUCCEEDED' || outcome.status === 'SKIPPED_DUPLICATE') {
      await db.query(`UPDATE automation_rules SET next_run_at = $2, pending_occurrence = NULL WHERE id = $1`, [rule.id, nextRun(spec, now).toISOString()]);
    }
    out.push({ rule: rule.code, outcome });
  }
  return out;
}
