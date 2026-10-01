import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { amortise, allocate } from '../src/routes/lending.js';
import { JOB_HANDLERS } from '../src/automation/jobs.js';
import { ensureDefaultRules } from '../src/automation/engine.js';

const sum = (xs: string[]) => xs.reduce((a, x) => a + Math.round(Number(x) * 100), 0) / 100;

describe('LND pure rules', () => {
  it('annuity schedule: level payment, principal sums exactly, last instalment absorbs rounding', () => {
    const s = amortise('100000', '12', 12, '2026-11-30');
    expect(s.length).toBe(12);
    expect(sum(s.map((x) => x.principal))).toBe(100000);
    expect(Number(s[0].interest)).toBe(1000);
    expect((Number(s[0].principal) + Number(s[0].interest)).toFixed(2)).toBe('8884.88');
    expect(s[1].due_date).toBe('2026-12-30');
    expect(s[3].due_date).toBe('2027-02-28'); // month-end clamp
    const z = amortise('1000', '0', 3, '2026-11-01');
    expect(z.map((x) => x.principal)).toEqual(['333.33', '333.33', '333.34']);
    expect(z.every((x) => x.interest === '0.00')).toBe(true);
    const ep = amortise('1200', '12', 3, '2026-11-01', 'EQUAL_PRINCIPAL');
    expect(ep.map((x) => x.interest)).toEqual(['12.00', '8.00', '4.00']);
  });
  it('allocation: interest before principal, oldest first, reports unapplied', () => {
    const rows = [
      { id: 'a', principal: '100', interest: '10', paid_principal: '0', paid_interest: '0' },
      { id: 'b', principal: '100', interest: '5', paid_principal: '0', paid_interest: '0' },
    ];
    expect(allocate(rows, '50')).toMatchObject({ interest: '10.00', principal: '40.00', unapplied: '0.00' });
    const two = allocate(rows, '120');
    expect(two).toMatchObject({ interest: '15.00', principal: '105.00' });
    expect(allocate(rows, '300').unapplied).toBe('85.00');
  });
});

describe('LND API', () => {
  let acct: string;
  let ctrl: string;
  let viewer: string;
  let admin: string;
  let party: any;
  beforeAll(async () => {
    await bootstrap();
    [acct, ctrl, viewer, admin] = await Promise.all(['accountant', 'controller', 'viewer', 'admin'].map((u) => login(`${u}@omnysync.internal`)));
    party = (await db.query(`SELECT id FROM parties WHERE party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`)).rows[0];
  });

  const make = async (body: any = {}) => (await makeRequest('POST', '/api/lnd/loans', { party_id: party.id, principal: '120000', annual_rate: '18', term_months: 6, purpose: '2 × 1.5 ton inverter AC on instalments', ...body }, acct)).body.data;
  const approved = async (body: any = {}) => {
    const l = await make(body);
    await makeRequest('POST', `/api/lnd/loans/${l.id}/submit`, {}, acct);
    await makeRequest('POST', `/api/lnd/loans/${l.id}/approve`, {}, ctrl);
    return l;
  };

  it('validation, preview schedule, approval SoD and permissions', async () => {
    expect((await makeRequest('GET', '/api/lnd/loans', undefined, viewer)).status).toBe(403);
    expect((await makeRequest('POST', '/api/lnd/loans', { party_id: party.id, principal: '0', annual_rate: '10', term_months: 6 }, acct)).status).toBe(400);
    expect((await makeRequest('POST', '/api/lnd/loans', { party_id: party.id, principal: '1000', annual_rate: '150', term_months: 6 }, acct)).status).toBe(400);
    expect((await makeRequest('POST', '/api/lnd/loans', { party_id: party.id, principal: '1000', annual_rate: '10', term_months: 0 }, acct)).status).toBe(400);
    const l = await make();
    const d = (await makeRequest('GET', `/api/lnd/loans/${l.id}`, undefined, acct)).body.data;
    expect(d.schedule.length).toBe(6);
    expect(d.schedule[0].preview).toBe(true);
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/disburse`, {}, acct)).status).toBe(409); // not approved
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/submit`, {}, ctrl)).status).toBe(403); // controller cannot originate
    await makeRequest('POST', `/api/lnd/loans/${l.id}/submit`, {}, admin);
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/approve`, {}, acct)).status).toBe(403); // accountant cannot approve
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/approve`, {}, admin)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/reject`, {}, ctrl)).status).toBe(400); // reason required
  });

  it('disbursement posts once and builds the schedule; closed period leaves loan approved', async () => {
    const bad = await approved();
    const r0 = await makeRequest('POST', `/api/lnd/loans/${bad.id}/disburse`, { disbursement_date: '2019-01-10' }, acct);
    expect(r0.status).toBeGreaterThanOrEqual(400);
    expect((await db.query(`SELECT status FROM lnd_loans WHERE id = $1`, [bad.id])).rows[0].status).toBe('APPROVED');
    expect((await db.query(`SELECT COUNT(*)::int n FROM lnd_schedule WHERE loan_id = $1`, [bad.id])).rows[0].n).toBe(0);
    expect((await makeRequest('POST', `/api/lnd/loans/${bad.id}/disburse`, { disbursement_date: '2026-09-10', first_due_date: '2026-09-01' }, acct)).status).toBe(400);
    const ok1 = await makeRequest('POST', `/api/lnd/loans/${bad.id}/disburse`, { disbursement_date: '2026-09-10' }, acct);
    expect(ok1.status).toBe(200);
    expect(ok1.body.data.status).toBe('ACTIVE');
    expect((await makeRequest('POST', `/api/lnd/loans/${bad.id}/disburse`, { disbursement_date: '2026-09-10' }, acct)).status).toBe(409);
    const j = (await db.query(`SELECT a.code, SUM(jl.base_debit)::text d, SUM(jl.base_credit)::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.source_key = $1 GROUP BY a.code ORDER BY a.code`, [`LND_DISB:${bad.id}`])).rows;
    expect(j.map((x: any) => [x.code, Number(x.d), Number(x.c)])).toEqual([['111002', 0, 120000], ['112004', 120000, 0]]);
    const s = (await db.query(`SELECT due_date::text, principal::text FROM lnd_schedule WHERE loan_id = $1 ORDER BY seq`, [bad.id])).rows;
    expect(s[0].due_date).toBe('2026-10-10');
    expect(sum(s.map((x: any) => x.principal))).toBe(120000);
  });

  it('repayments: interest-first allocation, duplicates and overpayment refused, payoff closes and nets the receivable', async () => {
    const l = await approved({ principal: '60000', annual_rate: '12', term_months: 3 });
    await makeRequest('POST', `/api/lnd/loans/${l.id}/disburse`, { disbursement_date: '2026-09-01' }, acct);
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: '100', reference: 'X' }, viewer)).status).toBe(403);
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: '100' }, acct)).status).toBe(400);
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: '100', reference: 'X', payment_date: '2026-08-01' }, acct)).status).toBe(400);
    const p1 = await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: '1000', reference: 'RCPT-1', payment_date: '2026-09-20' }, acct);
    expect(p1.status).toBe(201);
    expect(p1.body.data).toMatchObject({ interest_part: expect.anything(), loan_status: 'ACTIVE' });
    expect(Number(p1.body.data.interest_part)).toBe(600); // 1% of 60,000
    expect(Number(p1.body.data.principal_part)).toBe(400);
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: '1000', reference: 'RCPT-1', payment_date: '2026-09-20' }, acct)).body.error.code).toBe('DUPLICATE_RESOURCE');
    const sched = (await db.query(`SELECT SUM(principal + interest - paid_principal - paid_interest)::text r FROM lnd_schedule WHERE loan_id = $1`, [l.id])).rows[0].r;
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: (Number(sched) + 1).toFixed(2), reference: 'OVER', payment_date: '2026-09-21' }, acct)).status).toBe(400);
    const pay = await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: Number(sched).toFixed(2), reference: 'PAYOFF', payment_date: '2026-09-25' }, acct);
    expect(pay.body.data.loan_status).toBe('CLOSED');
    expect(Number(pay.body.data.outstanding_principal)).toBe(0);
    const net = (await db.query(`SELECT a.code, SUM(jl.base_debit - jl.base_credit)::text n FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.source_id = $1 OR j.source_id IN (SELECT id FROM lnd_repayments WHERE loan_id = $1) GROUP BY a.code ORDER BY a.code`, [l.id])).rows;
    const by = Object.fromEntries(net.map((x: any) => [x.code, Number(x.n)]));
    expect(by['112004']).toBe(0);
    const totalInterest = (await db.query(`SELECT SUM(interest)::text t FROM lnd_schedule WHERE loan_id = $1`, [l.id])).rows[0].t;
    expect(by['411006']).toBeCloseTo(-Number(totalInterest), 2);
    expect((await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: '1', reference: 'LATE', payment_date: '2026-09-26' }, acct)).status).toBe(409);
    const sm = await makeRequest('GET', '/api/lnd/summary', undefined, acct);
    expect(sm.status).toBe(200);
  });

  it('late fees: one flat fee per instalment after the grace period, collected first, income on collection', async () => {
    const l = await approved({ principal: '30000', annual_rate: '12', term_months: 3 });
    await makeRequest('POST', `/api/lnd/loans/${l.id}/disburse`, { disbursement_date: '2026-09-01' }, acct);
    const number = (await db.query(`SELECT number FROM lnd_loans WHERE id = $1`, [l.id])).rows[0].number;
    expect((await makeRequest('POST', '/api/lnd/late-fees/assess', { as_of: '2026-10-07' }, viewer)).status).toBe(403);
    const inGrace = await makeRequest('POST', '/api/lnd/late-fees/assess', { as_of: '2026-10-06' }, acct); // due 10-01 + 5 grace days
    expect(inGrace.body.data.instalments).not.toContain(`${number}#1`);
    const a1 = await makeRequest('POST', '/api/lnd/late-fees/assess', { as_of: '2026-10-07' }, acct);
    expect(a1.status).toBe(200);
    expect(a1.body.data.instalments).toContain(`${number}#1`);
    const a2 = await makeRequest('POST', '/api/lnd/late-fees/assess', { as_of: '2026-10-20' }, acct);
    expect(a2.body.data.instalments).not.toContain(`${number}#1`); // charged once
    const fees = (await db.query(`SELECT seq, late_fee::text FROM lnd_schedule WHERE loan_id = $1 AND late_fee > 0`, [l.id])).rows;
    expect(fees.map((f: any) => [f.seq, Number(f.late_fee)])).toEqual([[1, 500]]);
    const p = await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: '800', reference: 'LATE-1', payment_date: '2026-10-21' }, acct);
    expect(p.status).toBe(201);
    expect([Number(p.body.data.fee_part), Number(p.body.data.interest_part), Number(p.body.data.principal_part)]).toEqual([500, 300, 0]);
    const fee = (await db.query(`SELECT SUM(jl.base_credit)::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.source_id = $1 AND a.code = '411005'`, [p.body.data.id])).rows[0].c;
    expect(Number(fee)).toBe(500);
    const left = (await db.query(`SELECT SUM(principal + interest + late_fee - paid_principal - paid_interest - paid_late_fee)::text r FROM lnd_schedule WHERE loan_id = $1`, [l.id])).rows[0].r;
    const payoff = await makeRequest('POST', `/api/lnd/loans/${l.id}/repayments`, { amount: Number(left).toFixed(2), reference: 'LATE-PAYOFF', payment_date: '2026-10-22' }, acct);
    expect(payoff.body.data.loan_status).toBe('CLOSED');
  });

  it('LND-LATE-FEES job assesses due instalments once and alerts the accountant', async () => {
    const l = await approved({ principal: '9000', annual_rate: '0', term_months: 3 });
    await makeRequest('POST', `/api/lnd/loans/${l.id}/disburse`, { disbursement_date: '2026-09-01' }, acct);
    const { organization_id: org, number } = (await db.query(`SELECT organization_id, number FROM lnd_loans WHERE id = $1`, [l.id])).rows[0];
    await ensureDefaultRules(db as any, org);
    const rule = (await db.query(`SELECT * FROM automation_rules WHERE organization_id = $1 AND code = 'LND-LATE-FEES'`, [org])).rows[0];
    expect(rule).toMatchObject({ tier: 'A3', job_type: 'LOAN_LATE_FEES' });
    const ctx = { q: db as any, orgId: org, rule, config: {}, today: '2026-11-10', now: new Date() };
    const r1 = await JOB_HANDLERS.LOAN_LATE_FEES(ctx);
    expect(r1.summary.instalments).toEqual(expect.arrayContaining([`${number}#1`]));
    expect(r1.alerts[0]).toMatchObject({ category: 'FINANCE', severity: 'WARNING' });
    const r2 = await JOB_HANDLERS.LOAN_LATE_FEES(ctx);
    expect(r2.summary.instalments).not.toContain(`${number}#1`);
    const fees = (await db.query(`SELECT seq FROM lnd_schedule WHERE loan_id = $1 AND late_fee > 0 ORDER BY seq`, [l.id])).rows.map((r: any) => r.seq);
    expect(fees).toEqual([1, 2]); // due 10-01 and 11-01 (+5 grace days) are late on 11-10; #3 (12-01) is not
  });
});
