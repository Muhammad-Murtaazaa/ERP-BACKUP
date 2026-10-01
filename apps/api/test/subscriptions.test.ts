import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { addMonths, allocateByMonth, mrr, periodNet } from '../src/routes/subscriptions.js';
import { JOB_HANDLERS } from '../src/automation/jobs.js';
import { ensureDefaultRules } from '../src/automation/engine.js';

describe('COM pure rules', () => {
  it('month arithmetic keeps month-end semantics; MRR normalises intervals', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(periodNet('12000', 2, '10').toFixed(2)).toBe('21600.00');
    expect(mrr('12000', 1, '0', 'QUARTERLY').toFixed(2)).toBe('4000.00');
    expect(mrr('180000', 1, '0', 'ANNUAL').toFixed(2)).toBe('15000.00');
  });
  it('deferred revenue is allocated to calendar months by days and always sums to the billed amount', () => {
    const a = allocateByMonth('2026-08-15', '2026-11-14', '12000.00');
    expect(a.map((x) => [x.month_start, x.amount])).toEqual([['2026-08-01', '2217.39'], ['2026-09-01', '3913.04'], ['2026-10-01', '4043.48'], ['2026-11-01', '1826.09']]);
    expect(a[0].month_end).toBe('2026-08-31');
    const y = allocateByMonth('2026-01-01', '2026-12-31', '100.00');
    expect(y.length).toBe(12);
    expect(y.reduce((t, x) => t + Math.round(Number(x.amount) * 100), 0)).toBe(10000);
    expect(allocateByMonth('2026-02-10', '2026-02-20', '50.00')).toEqual([{ month_start: '2026-02-01', month_end: '2026-02-28', amount: '50.00' }]);
  });
});

describe('COM API', () => {
  let acct: string;
  let viewer: string;
  let party: any;
  let plans: any[];
  beforeAll(async () => {
    await bootstrap();
    [acct, viewer] = await Promise.all(['accountant', 'viewer'].map((u) => login(`${u}@omnysync.internal`)));
    party = (await db.query(`SELECT id FROM parties WHERE party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`)).rows[0];
    plans = (await makeRequest('GET', '/api/com/plans', undefined, acct)).body.data;
  });
  const plan = (c: string) => plans.find((p: any) => p.code === c);
  const sub = async (body: any) => (await makeRequest('POST', '/api/com/subscriptions', { party_id: party.id, ...body }, acct)).body.data;

  it('permissions and validation', async () => {
    expect(plans.length).toBe(3);
    expect((await makeRequest('GET', '/api/com/plans', undefined, viewer)).status).toBe(403);
    expect((await makeRequest('POST', '/api/com/subscriptions', { party_id: party.id, plan_id: plan('AMC-HOME').id, start_date: '2026-09-01', discount_pct: '100' }, acct)).status).toBe(400);
    expect((await makeRequest('POST', '/api/com/subscriptions', { party_id: party.id, plan_id: plan('AMC-HOME').id, start_date: '2026-09-01', end_date: '2026-08-01' }, acct)).status).toBe(400);
    const r = await makeRequest('POST', '/api/com/subscriptions', { party_id: '00000000-0000-0000-0000-000000000000', plan_id: plan('AMC-HOME').id, start_date: '2026-09-01' }, acct);
    expect(r.status).toBe(400);
    expect(r.body.error.details.field).toBe('party_id');
    expect((await makeRequest('POST', '/api/com/billing-run', {}, viewer)).status).toBe(403);
  });

  it('billing run catches up, is idempotent, posts subscription revenue to 411007 and creates an AMC contract', async () => {
    const s = await sub({ plan_id: plan('AMC-HOME').id, start_date: '2026-08-01', quantity: 2, discount_pct: '10' });
    expect(s.status).toBe('DRAFT');
    const act = await makeRequest('POST', `/api/com/subscriptions/${s.id}/activate`, { create_service_contract: true }, acct);
    expect(act.status).toBe(200);
    expect(act.body.data.service_contract_id).toBeTruthy();
    const k = (await db.query(`SELECT contract_type, status, visits_included, covers_labour FROM srv_contracts WHERE id = $1`, [act.body.data.service_contract_id])).rows[0];
    expect(k).toMatchObject({ contract_type: 'AMC', status: 'ACTIVE', visits_included: 2, covers_labour: true });

    const run1 = await makeRequest('POST', '/api/com/billing-run', { as_of: '2026-09-15' }, acct);
    expect(run1.status).toBe(200);
    const mine = run1.body.data.results.find((r: any) => r.subscription === s.number);
    expect(mine.invoices.length).toBe(2); // Aug + Sep
    expect(mine.next_bill_date).toBe('2026-10-01');
    const inv = (await db.query(`SELECT i.subtotal::text, i.total_amount::text FROM com_billing_periods b JOIN ar_invoices i ON i.id = b.ar_invoice_id WHERE b.subscription_id = $1 ORDER BY b.period_start`, [s.id])).rows;
    expect(inv.map((x: any) => Number(x.subtotal))).toEqual([4500, 4500]); // 2500 × 2 × 90%
    expect(Number(inv[0].total_amount)).toBe(5310); // + 18% GST
    const rev = (await db.query(`SELECT SUM(jl.base_credit)::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.source_type = 'SUBSCRIPTION' AND j.source_id = $1 AND a.code = '411007'`, [s.id])).rows[0];
    expect(Number(rev.c)).toBe(9000);

    const run2 = await makeRequest('POST', '/api/com/billing-run', { as_of: '2026-09-15' }, acct);
    expect(run2.body.data.results.find((r: any) => r.subscription === s.number)).toBeUndefined();
    expect((await db.query(`SELECT COUNT(*)::int n FROM com_billing_periods WHERE subscription_id = $1`, [s.id])).rows[0].n).toBe(2);
    // Even if the cursor were rewound, the unique period key prevents a double bill.
    await db.query(`UPDATE com_subscriptions SET next_bill_date = '2026-09-01' WHERE id = $1`, [s.id]);
    await makeRequest('POST', '/api/com/billing-run', { as_of: '2026-09-15' }, acct);
    expect((await db.query(`SELECT COUNT(*)::int n FROM com_billing_periods WHERE subscription_id = $1`, [s.id])).rows[0].n).toBe(2);
  });

  it('paused subscriptions are skipped; cancel needs a reason and cancels the linked contract', async () => {
    const s = await sub({ plan_id: plan('AMC-PLUS').id, start_date: '2026-09-01' });
    await makeRequest('POST', `/api/com/subscriptions/${s.id}/activate`, { create_service_contract: true }, acct);
    await makeRequest('POST', `/api/com/subscriptions/${s.id}/pause`, {}, acct);
    const run = await makeRequest('POST', '/api/com/billing-run', { as_of: '2026-09-30' }, acct);
    expect(run.body.data.results.find((r: any) => r.subscription === s.number)).toBeUndefined();
    expect((await makeRequest('POST', `/api/com/subscriptions/${s.id}/cancel`, {}, acct)).status).toBe(400);
    const c = await makeRequest('POST', `/api/com/subscriptions/${s.id}/cancel`, { cancel_reason: 'Moved city' }, acct);
    expect(c.body.data.status).toBe('CANCELLED');
    expect((await db.query(`SELECT status FROM srv_contracts WHERE id = $1`, [c.body.data.service_contract_id])).rows[0].status).toBe('CANCELLED');
    expect((await makeRequest('POST', `/api/com/subscriptions/${s.id}/resume`, {}, acct)).status).toBe(409);
  });

  it('end date prorates the final period and ends the subscription; closed-period failure is isolated', async () => {
    const s = await sub({ plan_id: plan('AMC-PLUS').id, start_date: '2026-06-01', end_date: '2026-08-01' });
    await makeRequest('POST', `/api/com/subscriptions/${s.id}/activate`, {}, acct);
    const bad = await sub({ plan_id: plan('AMC-HOME').id, start_date: '2019-01-01' });
    await makeRequest('POST', `/api/com/subscriptions/${bad.id}/activate`, {}, acct);
    const run = await makeRequest('POST', '/api/com/billing-run', { as_of: '2026-09-30' }, acct);
    expect(run.status).toBe(200);
    const mine = run.body.data.results.find((r: any) => r.subscription === s.number);
    expect(mine.ended).toBe(true);
    const p = (await db.query(`SELECT period_start::text, period_end::text, net_amount::text FROM com_billing_periods WHERE subscription_id = $1`, [s.id])).rows;
    expect(p.length).toBe(1);
    expect(p[0].period_end).toBe('2026-07-31');
    expect(Number(p[0].net_amount)).toBeCloseTo((12000 * 61) / 92, 1); // 61 of 92 days
    expect((await db.query(`SELECT status FROM com_subscriptions WHERE id = $1`, [s.id])).rows[0].status).toBe('ENDED');
    expect(run.body.data.failed).toBeGreaterThanOrEqual(1);
    const b = (await db.query(`SELECT status, next_bill_date::text FROM com_subscriptions WHERE id = $1`, [bad.id])).rows[0];
    expect(b).toEqual({ status: 'ACTIVE', next_bill_date: '2019-01-01' }); // atomic: nothing half-billed
    expect((await db.query(`SELECT COUNT(*)::int n FROM com_billing_periods WHERE subscription_id = $1`, [bad.id])).rows[0].n).toBe(0);
    await makeRequest('POST', `/api/com/subscriptions/${bad.id}/cancel`, { cancel_reason: 'test cleanup' }, acct);
  });

  it('summary reports MRR/ARR from active subscriptions', async () => {
    const r = await makeRequest('GET', '/api/com/summary', undefined, acct);
    expect(r.status).toBe(200);
    expect(Number(r.body.data.mrr)).toBeGreaterThanOrEqual(4500);
    expect(Number(r.body.data.arr)).toBeCloseTo(Number(r.body.data.mrr) * 12, 2);
    expect(r.body.data.churned_this_month).toBeGreaterThanOrEqual(0);
  });

  it('COM-BILLING automation job bills due periods once and alerts on failures', async () => {
    const s = await sub({ plan_id: plan('AMC-COMM').id, start_date: '2026-09-20' });
    await makeRequest('POST', `/api/com/subscriptions/${s.id}/activate`, {}, acct);
    const org = (await db.query(`SELECT organization_id FROM com_subscriptions WHERE id = $1`, [s.id])).rows[0].organization_id;
    await ensureDefaultRules(db as any, org);
    const rule = (await db.query(`SELECT * FROM automation_rules WHERE organization_id = $1 AND code = 'COM-BILLING'`, [org])).rows[0];
    expect(rule).toMatchObject({ tier: 'A3', job_type: 'SUBSCRIPTION_BILLING' });
    const ctx = { q: db as any, orgId: org, rule, config: { max_periods: 3 }, today: '2026-09-30', now: new Date() };
    const r1 = await JOB_HANDLERS.SUBSCRIPTION_BILLING(ctx);
    expect((r1.summary.billed as any[]).find((b) => b.subscription === s.number).invoices.length).toBe(1);
    const r2 = await JOB_HANDLERS.SUBSCRIPTION_BILLING(ctx);
    expect((r2.summary.billed as any[]).find((b) => b.subscription === s.number)).toBeUndefined();
    expect((await db.query(`SELECT COUNT(*)::int n FROM com_billing_periods WHERE subscription_id = $1`, [s.id])).rows[0].n).toBe(1);
    const bad = await sub({ plan_id: plan('AMC-HOME').id, start_date: '2019-03-01' });
    await makeRequest('POST', `/api/com/subscriptions/${bad.id}/activate`, {}, acct);
    const r3 = await JOB_HANDLERS.SUBSCRIPTION_BILLING(ctx);
    expect(r3.alerts.some((a) => a.dedupe_key === `COM_BILLING_FAIL:${bad.id}` && a.severity === 'CRITICAL')).toBe(true);
    await makeRequest('POST', `/api/com/subscriptions/${bad.id}/cancel`, { cancel_reason: 'cleanup' }, acct);
  });

  it('quarterly plans defer revenue to 211010 and recognise it monthly by days, once', async () => {
    const s = await sub({ plan_id: plan('AMC-PLUS').id, start_date: '2026-08-15' });
    expect((await makeRequest('POST', `/api/com/subscriptions/${s.id}/activate`, {}, acct)).status).toBe(200);
    const run = await makeRequest('POST', '/api/com/billing-run', { as_of: '2026-08-15' }, acct);
    expect(run.body.data.results.find((r: any) => r.subscription === s.number).invoices.length).toBe(1);
    const credits = async (code: string, sourceType: string) =>
      Number((await db.query(`SELECT COALESCE(SUM(jl.base_credit),0)::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.source_type = $3 AND a.code = $1 AND (j.source_id = $2 OR j.source_id IN (SELECT id FROM com_revenue_schedule WHERE subscription_id = $2))`, [code, s.id, sourceType])).rows[0].c);
    expect(await credits('211010', 'SUBSCRIPTION')).toBe(12000);
    expect(await credits('411007', 'SUBSCRIPTION')).toBe(0);
    const sched = (await makeRequest('GET', `/api/com/subscriptions/${s.id}`, undefined, acct)).body.data.revenue_schedule;
    expect(sched.map((r: any) => Number(r.amount))).toEqual([2217.39, 3913.04, 4043.48, 1826.09]);
    expect((await makeRequest('POST', '/api/com/revenue/recognize', { as_of: '2026-09-30' }, viewer)).status).toBe(403);
    const r1 = await makeRequest('POST', '/api/com/revenue/recognize', { as_of: '2026-09-30' }, acct);
    expect(r1.status).toBe(200);
    expect(await credits('411007', 'COM_REVENUE')).toBe(6130.43);
    const r2 = await makeRequest('POST', '/api/com/revenue/recognize', { as_of: '2026-09-30' }, acct);
    expect(r2.body.data.recognised_lines).toBe(0);
    expect(await credits('411007', 'COM_REVENUE')).toBe(6130.43);
    const after = (await makeRequest('GET', `/api/com/subscriptions/${s.id}`, undefined, acct)).body.data.revenue_schedule;
    expect(after.map((r: any) => r.status)).toEqual(['RECOGNISED', 'RECOGNISED', 'PENDING', 'PENDING']);
    expect(after[0].journal_number).toBeTruthy();
  });

  it('cancelling a deferred plan settles unearned revenue: earned pro rata, rest to customer credit or forfeited', async () => {
    const net = async (subId: string, code: string) =>
      Number((await db.query(`SELECT COALESCE(SUM(jl.base_credit - jl.base_debit),0)::text n FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE a.code = $1 AND (j.source_id = $2 OR j.source_id IN (SELECT id FROM com_revenue_schedule WHERE subscription_id = $2))`, [code, subId])).rows[0].n);
    const s = await sub({ plan_id: plan('AMC-PLUS').id, start_date: '2026-08-15' });
    await makeRequest('POST', `/api/com/subscriptions/${s.id}/activate`, {}, acct);
    await makeRequest('POST', '/api/com/billing-run', { as_of: '2026-08-15' }, acct);
    expect((await makeRequest('POST', `/api/com/subscriptions/${s.id}/cancel`, { cancel_reason: 'moved', effective_date: '2099-01-01' }, acct)).status).toBe(400);
    const c = await makeRequest('POST', `/api/com/subscriptions/${s.id}/cancel`, { cancel_reason: 'moved', effective_date: '2026-09-15', unearned_treatment: 'REFUND' }, acct);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.data.result.deferred).toMatchObject({ earned: '1956.52', unearned: '7826.09', treatment: 'REFUND' });
    expect(await net(s.id, '211010')).toBe(0); // nothing left deferred
    expect(await net(s.id, '411007')).toBeCloseTo(2217.39 + 1956.52, 2); // Aug + half of Sep
    expect(await net(s.id, '211006')).toBe(7826.09); // owed back to the customer
    const sched = (await makeRequest('GET', `/api/com/subscriptions/${s.id}`, undefined, acct)).body.data.revenue_schedule;
    expect(sched.map((r: any) => r.status)).toEqual(['RECOGNISED', 'RELEASED', 'RELEASED', 'RELEASED']);
    expect((await makeRequest('POST', `/api/com/subscriptions/${s.id}/cancel`, { cancel_reason: 'again' }, acct)).status).toBe(409);
    await makeRequest('POST', '/api/com/revenue/recognize', { as_of: '2026-12-31' }, acct); // released lines are never recognised again
    expect(await net(s.id, '411007')).toBeCloseTo(2217.39 + 1956.52, 2);

    const f = await sub({ plan_id: plan('AMC-PLUS').id, start_date: '2026-09-01' });
    await makeRequest('POST', `/api/com/subscriptions/${f.id}/activate`, {}, acct);
    await makeRequest('POST', '/api/com/billing-run', { as_of: '2026-09-01' }, acct);
    const cf = await makeRequest('POST', `/api/com/subscriptions/${f.id}/cancel`, { cancel_reason: 'breach', effective_date: '2026-09-30', unearned_treatment: 'FORFEIT' }, acct);
    expect(cf.body.data.result.deferred.treatment).toBe('FORFEIT');
    expect(await net(f.id, '211010')).toBe(0);
    expect(await net(f.id, '211006')).toBe(0);
    expect(await net(f.id, '411007')).toBe(12000); // whole quarter forfeited to revenue
  });
});
