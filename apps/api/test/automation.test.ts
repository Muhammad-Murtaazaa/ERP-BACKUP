import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { JOB_HANDLERS } from '../src/automation/jobs.js';
import { runRule, tick } from '../src/automation/engine.js';

const LAYS = '71000000-0000-0000-0000-000000000002';
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

describe('Automation engine (internal rules, no external APIs)', () => {
  let admin: string;
  let controller: string;
  let accountant: string;
  let viewer: string;
  let cashier: string;
  let orgId: string;
  const rules: Record<string, any> = {};

  const ruleRow = async (code: string) => (await db.query(`SELECT * FROM automation_rules WHERE organization_id = $1 AND code = $2`, [orgId, code])).rows[0];
  const alertsFor = async (prefix: string) =>
    (await db.query(`SELECT * FROM automation_alerts WHERE organization_id = $1 AND dedupe_key LIKE $2 ORDER BY first_seen_at`, [orgId, `${prefix}%`])).rows;

  beforeAll(async () => {
    await bootstrap();
    [admin, controller, accountant, viewer, cashier] = await Promise.all([
      login('admin@omnysync.internal'),
      login('controller@omnysync.internal'),
      login('accountant@omnysync.internal'),
      login('viewer@omnysync.internal'),
      login('cashier@omnysync.internal'),
    ]);
    const me = await makeRequest('GET', '/api/auth/me', undefined, admin);
    orgId = me.body.data.organization_id || me.body.data.session?.organization_id || me.body.data.user?.organization_id;
    if (!orgId) orgId = (await db.query(`SELECT id FROM organizations LIMIT 1`)).rows[0].id;
  });

  afterEach(() => vi.restoreAllMocks());

  it('enforces permissions: viewer/cashier cannot see or run automation', async () => {
    expect((await makeRequest('GET', '/api/automation/rules', undefined, viewer)).status).toBe(403);
    expect((await makeRequest('POST', '/api/automation/rules/install-defaults', {}, cashier)).status).toBe(403);
    expect((await makeRequest('POST', '/api/automation/tick', {}, accountant)).status).toBe(403); // view only
  });

  it('installs the default rule catalogue idempotently via POST (GET never mutates)', async () => {
    const empty = await makeRequest('GET', '/api/automation/rules', undefined, admin);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toHaveLength(0);
    const a = await makeRequest('POST', '/api/automation/rules/install-defaults', {}, admin);
    const b = await makeRequest('POST', '/api/automation/rules/install-defaults', {}, admin);
    expect(a.body.data.rules).toBe(11);
    expect(b.body.data.rules).toBe(11);
    const list = await makeRequest('GET', '/api/automation/rules', undefined, accountant);
    expect(list.status).toBe(200);
    for (const r of list.body.data) {
      rules[r.code] = r;
      expect(r.next_run_at).toBeTruthy();
      expect(['A0', 'A1', 'A2', 'A3']).toContain(r.tier);
    }
    expect(Object.keys(rules)).toEqual(expect.arrayContaining(['INV-REORDER', 'AR-DUNNING', 'AP-DUE', 'GL-RECURRING', 'BANK-AUTOMATCH', 'POS-MONITOR']));
  });

  it('runs every handler successfully against the seed data (manual run)', async () => {
    for (const code of Object.keys(rules)) {
      const r = await makeRequest('POST', `/api/automation/rules/${rules[code].id}/run`, {}, admin);
      expect(r.status, `${code}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.data.status).toBe('SUCCEEDED');
    }
    const runs = await makeRequest('GET', '/api/automation/runs?status=SUCCEEDED', undefined, controller);
    expect(runs.body.data.length).toBeGreaterThanOrEqual(11);
  });

  it('dedupes a trigger delivered twice (same occurrence runs once), including concurrently', async () => {
    const rule = await ruleRow('AP-DUE');
    const occurrence = 'D:2030-01-01';
    const [a, b] = await Promise.all([
      runRule(db, rule, { trigger: 'SCHEDULE', occurrence }),
      runRule(db, rule, { trigger: 'SCHEDULE', occurrence }),
    ]);
    const statuses = [a.status, b.status];
    expect(statuses.filter((s) => s === 'SUCCEEDED')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'SKIPPED_DUPLICATE' || s === 'SKIPPED_RUNNING')).toHaveLength(1);
    const again = await runRule(db, rule, { trigger: 'SCHEDULE', occurrence });
    expect(again.status).toBe('SKIPPED_DUPLICATE');
    const n = await db.query(`SELECT COUNT(*)::int AS n FROM automation_runs WHERE rule_id = $1 AND occurrence_key = $2`, [rule.id, occurrence]);
    expect(n.rows[0].n).toBe(1);
  });

  it('retries the same occurrence with backoff, then dead-letters to a CRITICAL owner alert', async () => {
    const rule = await ruleRow('WF-APPROVAL-AGING');
    await db.query(`UPDATE automation_rules SET max_attempts = 2, next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [rule.id]);
    const spy = vi.spyOn(JOB_HANDLERS, 'APPROVAL_AGING').mockRejectedValue(new Error('boom'));
    const t1 = (await tick(db, new Date(), orgId)).find((x) => x.rule === 'WF-APPROVAL-AGING');
    expect(t1?.outcome.status).toBe('FAILED');
    const afterFail = await ruleRow('WF-APPROVAL-AGING');
    expect(afterFail.pending_occurrence).toBeTruthy();
    const backoff = new Date(afterFail.next_run_at).getTime() - Date.now();
    expect(backoff).toBeGreaterThan(30000); // ~1 minute
    expect(backoff).toBeLessThanOrEqual(61000);
    // Not due yet → a tick now does nothing for this rule
    expect((await tick(db, new Date(), orgId)).find((x) => x.rule === 'WF-APPROVAL-AGING')).toBeUndefined();
    // Second attempt after the backoff reuses the same run and dead-letters
    const t2 = (await tick(db, new Date(Date.now() + 120000), orgId)).find((x) => x.rule === 'WF-APPROVAL-AGING');
    expect(t2?.outcome.status).toBe('DEAD');
    expect(t2?.outcome.run_id).toBe(t1?.outcome.run_id);
    const run = (await db.query(`SELECT * FROM automation_runs WHERE id = $1`, [t1!.outcome.run_id])).rows[0];
    expect(run.attempts).toBe(2);
    expect(run.status).toBe('DEAD');
    const dead = await alertsFor(`AUTOMATION_DEAD:${rule.id}`);
    expect(dead).toHaveLength(1);
    expect(dead[0].severity).toBe('CRITICAL');
    expect(dead[0].assigned_role).toBe(rule.owner_role);
    const r2 = await ruleRow('WF-APPROVAL-AGING');
    expect(r2.last_status).toBe('DEAD');
    expect(r2.pending_occurrence).toBeNull();
    expect(new Date(r2.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('pause is a kill switch: paused rules are never picked up by the scheduler', async () => {
    const id = rules['INV-REORDER'].id;
    expect((await makeRequest('POST', `/api/automation/rules/${id}/pause`, { reason: 'stocktake' }, accountant)).status).toBe(403);
    const p = await makeRequest('POST', `/api/automation/rules/${id}/pause`, { reason: 'stocktake' }, admin);
    expect(p.body.data.paused).toBe(true);
    await db.query(`UPDATE automation_rules SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [id]);
    expect((await tick(db, new Date(), orgId)).find((x) => x.rule === 'INV-REORDER')).toBeUndefined();
    const r = await makeRequest('POST', `/api/automation/rules/${id}/resume`, {}, admin);
    expect(r.body.data.paused).toBe(false);
    expect(new Date(r.body.data.next_run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('validates rule config updates and uses optimistic versioning', async () => {
    const rule = await ruleRow('AP-DUE');
    const bad = await makeRequest('POST', `/api/automation/rules/${rule.id}`, { run_at_local: '25:00' }, admin);
    expect(bad.status).toBe(400);
    const badInt = await makeRequest('POST', `/api/automation/rules/${rule.id}`, { schedule_kind: 'INTERVAL', interval_minutes: 1 }, admin);
    expect(badInt.status).toBe(400);
    const ok = await makeRequest('POST', `/api/automation/rules/${rule.id}`, { version: rule.version, run_at_local: '08:15', config: { days_ahead: 14 } }, admin);
    expect(ok.status).toBe(200);
    expect(ok.body.data.version).toBe(rule.version + 1);
    const stale = await makeRequest('POST', `/api/automation/rules/${rule.id}`, { version: rule.version, run_at_local: '09:00' }, admin);
    expect(stale.status).toBe(409);
  });

  it('reorder alerts dedupe on re-detection and auto-resolve when the condition clears', async () => {
    await db.query(`UPDATE items SET reorder_point = 999999, reorder_qty = 10 WHERE id = $1`, [LAYS]);
    const rule = await ruleRow('INV-REORDER');
    await runRule(db, rule, { trigger: 'MANUAL', occurrence: 'MANUAL:t1' });
    await runRule(db, rule, { trigger: 'MANUAL', occurrence: 'MANUAL:t2' });
    let a = await alertsFor(`REORDER:${LAYS}`);
    expect(a).toHaveLength(1);
    expect(a[0].occurrences).toBe(2);
    expect(a[0].status).toBe('OPEN');
    // proposed = max(reorder_qty, reorder_point + reorder_qty - on_hand)
    expect(Number(a[0].data.proposed_qty)).toBeGreaterThan(999999 - 1000000);
    // acknowledge via API (audited), still active
    const ack = await makeRequest('POST', `/api/automation/alerts/${a[0].id}/acknowledge`, { note: 'PO raised' }, accountant);
    expect(ack.body.data.status).toBe('ACKNOWLEDGED');
    const inbox = await makeRequest('GET', '/api/automation/alerts?category=INVENTORY', undefined, accountant);
    expect(inbox.body.data.some((x: any) => x.id === a[0].id)).toBe(true);
    // condition clears → auto-resolved on next run
    await db.query(`UPDATE items SET reorder_point = 0 WHERE id = $1`, [LAYS]);
    await runRule(db, rule, { trigger: 'MANUAL', occurrence: 'MANUAL:t3' });
    a = await alertsFor(`REORDER:${LAYS}`);
    expect(a[0].status).toBe('RESOLVED');
    // re-detected later → a NEW alert (resolved ones are history)
    await db.query(`UPDATE items SET reorder_point = 999999 WHERE id = $1`, [LAYS]);
    await runRule(db, rule, { trigger: 'MANUAL', occurrence: 'MANUAL:t4' });
    a = await alertsFor(`REORDER:${LAYS}`);
    expect(a).toHaveLength(2);
    expect((await makeRequest('POST', `/api/automation/alerts/${a[0].id}/resolve`, {}, accountant)).status).toBe(409);
  });

  it('recurring journals: validation, SoD approval, idempotent catch-up posting and period guard', async () => {
    const base = { name: 'Monthly rent accrual', day_of_month: 15, lines: [{ account_code: '521001', debit: '150000.00' }, { account_code: '211003', credit: '150000.00' }] };
    // unbalanced
    const unb = await makeRequest('POST', '/api/automation/recurring-journals', { ...base, code: 'RENT-X', start_date: '2026-03-01', lines: [{ account_code: '521001', debit: '10' }, { account_code: '211003', credit: '9.99' }] }, accountant);
    expect(unb.status).toBe(400);
    // header (non-posting) account
    const hdr = await makeRequest('POST', '/api/automation/recurring-journals', { ...base, code: 'RENT-Y', start_date: '2026-03-01', lines: [{ account_code: '5210', debit: '10' }, { account_code: '211003', credit: '10' }] }, accountant);
    expect(hdr.status).toBe(400);
    // both sides on one line
    const both = await makeRequest('POST', '/api/automation/recurring-journals', { ...base, code: 'RENT-Z', start_date: '2026-03-01', lines: [{ account_code: '521001', debit: '10', credit: '10' }, { account_code: '211003', credit: '0' }] }, accountant);
    expect(both.status).toBe(400);

    const created = await makeRequest('POST', '/api/automation/recurring-journals', { ...base, code: 'RENT', start_date: '2026-03-01' }, accountant);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');
    expect(iso(created.body.data.next_run_date)).toBe('2026-03-15');
    const dup = await makeRequest('POST', '/api/automation/recurring-journals', { ...base, code: 'rent', start_date: '2026-03-01' }, accountant);
    expect(dup.status).toBe(400);

    const rule = await ruleRow('GL-RECURRING');
    // Draft templates never post
    await runRule(db, rule, { trigger: 'MANUAL', occurrence: 'MANUAL:r0', now: new Date('2026-05-20T06:00:00Z') });
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM journals WHERE source_type = 'RECURRING_JOURNAL'`)).rows[0].n).toBe(0);

    // Approval by a different user (accountant authored, controller approves)
    const approved = await makeRequest('POST', `/api/automation/recurring-journals/${created.body.data.id}/approve`, {}, controller);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('ACTIVE');
    // The author cannot approve their own template (SoD)
    const ownRent = await makeRequest('POST', '/api/automation/recurring-journals', { ...base, code: 'RENT-CTL', start_date: '2026-03-01' }, controller);
    expect((await makeRequest('POST', `/api/automation/recurring-journals/${ownRent.body.data.id}/approve`, {}, controller)).status).toBe(403);

    // Catch-up: Mar 15, Apr 15, May 15 (max_catch_up = 3) on 2026-05-20
    const r1 = await runRule(db, rule, { trigger: 'MANUAL', occurrence: 'MANUAL:r1', now: new Date('2026-05-20T06:00:00Z') });
    expect(r1.status).toBe('SUCCEEDED');
    const posted = await db.query(`SELECT journal_number, posting_date, status FROM journals WHERE source_type = 'RECURRING_JOURNAL' AND source_id = $1 ORDER BY posting_date`, [created.body.data.id]);
    expect(posted.rows.map((j: any) => iso(j.posting_date))).toEqual(['2026-03-15', '2026-04-15', '2026-05-15']);
    expect(posted.rows.every((j: any) => j.status === 'POSTED')).toBe(true);
    const tpl = (await db.query(`SELECT * FROM recurring_journal_templates WHERE id = $1`, [created.body.data.id])).rows[0];
    expect(tpl.occurrences_posted).toBe(3);
    // Running again the same day posts nothing more (next_run_date advanced; sourceKey idempotent)
    await runRule(db, rule, { trigger: 'MANUAL', occurrence: 'MANUAL:r2', now: new Date('2026-05-20T06:00:00Z') });
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM journals WHERE source_type = 'RECURRING_JOURNAL' AND source_id = $1`, [created.body.data.id])).rows[0].n).toBe(3);

    // Closed period: a template starting in hard-closed Jan 2026 fails safely with a CRITICAL alert and does not advance
    const jan = await makeRequest('POST', '/api/automation/recurring-journals', { ...base, code: 'RENT-JAN', start_date: '2026-01-01', end_date: '2026-01-31' }, accountant);
    expect((await makeRequest('POST', `/api/automation/recurring-journals/${jan.body.data.id}/approve`, {}, controller)).status).toBe(200);
    const r3 = await runRule(db, rule, { trigger: 'MANUAL', occurrence: 'MANUAL:r3', now: new Date('2026-05-21T06:00:00Z') });
    expect(r3.status).toBe('SUCCEEDED');
    const janTpl = (await db.query(`SELECT * FROM recurring_journal_templates WHERE id = $1`, [jan.body.data.id])).rows[0];
    expect(iso(janTpl.next_run_date)).toBe('2026-01-15');
    expect(janTpl.occurrences_posted).toBe(0);
    const fail = await alertsFor(`RECURRING_FAIL:${jan.body.data.id}`);
    expect(fail).toHaveLength(1);
    expect(fail[0].severity).toBe('CRITICAL');

    // Pause → end lifecycle; ended templates cannot be re-approved
    expect((await makeRequest('POST', `/api/automation/recurring-journals/${created.body.data.id}/pause`, {}, controller)).body.data.status).toBe('PAUSED');
    expect((await makeRequest('POST', `/api/automation/recurring-journals/${created.body.data.id}/end`, {}, controller)).body.data.status).toBe('ENDED');
    expect((await makeRequest('POST', `/api/automation/recurring-journals/${created.body.data.id}/approve`, {}, controller)).status).toBe(409);
  });

  it('cross-organization isolation: rules of another org are not addressable', async () => {
    const fake = '99999999-9999-9999-9999-999999999999';
    expect((await makeRequest('POST', `/api/automation/rules/${fake}/run`, {}, admin)).status).toBe(404);
    expect((await makeRequest('POST', `/api/automation/alerts/${fake}/acknowledge`, {}, admin)).status).toBe(404);
  });

  it('audits manual runs and alert actions', async () => {
    const r = await db.query(`SELECT action, COUNT(*)::int AS n FROM audit_logs WHERE organization_id = $1 AND action IN ('AUTOMATION_RUN_SUCCEEDED','ALERT_ACKNOWLEDGED','AUTOMATION_RULE_PAUSED','RECURRING_JOURNAL_APPROVED') GROUP BY action`, [orgId]);
    const by = Object.fromEntries(r.rows.map((x: any) => [x.action, x.n]));
    expect(by.AUTOMATION_RUN_SUCCEEDED).toBeGreaterThan(10);
    expect(by.ALERT_ACKNOWLEDGED).toBe(1);
    expect(by.AUTOMATION_RULE_PAUSED).toBe(1);
    expect(by.RECURRING_JOURNAL_APPROVED).toBe(2);
  });
});
