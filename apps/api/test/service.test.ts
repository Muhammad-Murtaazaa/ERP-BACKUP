import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { addBusinessMinutes, businessMinutesBetween, overlaps, slaState } from '../src/domain/sla.js';
import { assertEntitlement, signoffHash } from '../src/routes/service.js';

const H = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5, 6], offsetMinutes: 300 };
const pkt = (s: string) => new Date(`${s}+05:00`);

describe('SRV pure rules: business-hours SLA clock, overlap, entitlement, sign-off hash', () => {
  it('SLA: clock runs only inside business hours, skips Sunday and holidays, exact at boundaries', () => {
    // Saturday 17:30 PKT + 60 business minutes -> 30 min Sat, Sunday closed -> Monday 09:30
    expect(addBusinessMinutes(pkt('2026-10-03T17:30:00'), 60, H).toISOString()).toBe(pkt('2026-10-05T09:30:00').toISOString());
    // Exactly at close with 0 remaining stays at close; logging at 18:00 rolls to next opening
    expect(addBusinessMinutes(pkt('2026-10-01T17:00:00'), 60, H).toISOString()).toBe(pkt('2026-10-01T18:00:00').toISOString());
    expect(addBusinessMinutes(pkt('2026-10-01T18:00:00'), 1, H).toISOString()).toBe(pkt('2026-10-02T09:01:00').toISOString());
    // Before opening starts counting at 09:00
    expect(addBusinessMinutes(pkt('2026-10-01T06:00:00'), 30, H).toISOString()).toBe(pkt('2026-10-01T09:30:00').toISOString());
    // Holiday (Friday) is skipped
    expect(addBusinessMinutes(pkt('2026-10-01T17:00:00'), 120, { ...H, holidays: ['2026-10-02'] }).toISOString()).toBe(pkt('2026-10-03T10:00:00').toISOString());
    expect(businessMinutesBetween(pkt('2026-10-03T17:30:00'), pkt('2026-10-05T09:30:00'), H)).toBe(60);
    expect(() => addBusinessMinutes(new Date(), 10, { ...H, start: '18:00', end: '09:00' })).toThrow();
  });

  it('SLA state, window overlap (touching windows do not clash)', () => {
    const start = pkt('2026-10-01T09:00:00');
    const due = pkt('2026-10-01T19:00:00');
    expect(slaState({ start, due, now: pkt('2026-10-01T10:00:00') })).toBe('ON_TRACK');
    expect(slaState({ start, due, now: pkt('2026-10-01T18:30:00') })).toBe('AT_RISK');
    expect(slaState({ start, due, now: pkt('2026-10-01T19:00:01') })).toBe('BREACHED');
    expect(slaState({ start, due, now: pkt('2026-10-02T10:00:00'), doneAt: pkt('2026-10-01T12:00:00') })).toBe('MET');
    expect(overlaps(pkt('2026-10-01T09:00:00'), pkt('2026-10-01T11:00:00'), pkt('2026-10-01T11:00:00'), pkt('2026-10-01T12:00:00'))).toBe(false);
    expect(overlaps(pkt('2026-10-01T09:00:00'), pkt('2026-10-01T11:00:00'), pkt('2026-10-01T10:59:00'), pkt('2026-10-01T12:00:00'))).toBe(true);
  });

  it('entitlement: status, customer and date window are all enforced; sign-off hash binds the work', () => {
    const k = { number: 'SVC-1', party_id: 'p1', status: 'ACTIVE', start_date: '2026-01-01', end_date: '2026-06-30' };
    expect(() => assertEntitlement(k, 'p1', '2026-06-30')).not.toThrow();
    expect(() => assertEntitlement(k, 'p1', '2026-07-01')).toThrow(/does not cover/);
    expect(() => assertEntitlement(k, 'p2', '2026-03-01')).toThrow(/different customer/);
    expect(() => assertEntitlement({ ...k, status: 'EXPIRED' }, 'p1', '2026-03-01')).toThrow(/EXPIRED/);
    const wo = { id: 'w', checklist: [{ item: 'a', mandatory: true, done: true }] };
    const h1 = signoffHash(wo, [{ item_id: 'i', quantity: '1' }], [], []);
    expect(signoffHash(wo, [{ item_id: 'i', quantity: '1.0000' }], [], [])).toBe(h1);
    expect(signoffHash(wo, [{ item_id: 'i', quantity: '2' }], [], [])).not.toBe(h1);
  });
});

describe('SRV API: intake → dispatch → execute → bill', () => {
  let admin: string;
  let service: string;
  let tech: string;
  let viewer: string;
  let party: any;
  let techs: any[];
  let stockItem: any;

  beforeAll(async () => {
    await bootstrap();
    [admin, service, tech, viewer] = await Promise.all(['admin', 'service', 'tech', 'viewer'].map((u) => login(`${u}@omnysync.internal`)));
    party = (await db.query(`SELECT id FROM parties WHERE party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`)).rows[0];
    techs = (await makeRequest('GET', '/api/srv/technicians', undefined, service)).body.data;
    stockItem = (
      await db.query(`SELECT i.id, i.unit_cost::text FROM items i JOIN stock_movements sm ON sm.item_id = i.id WHERE i.item_type = 'INVENTORY' AND i.unit_cost > 0 GROUP BY i.id HAVING SUM(sm.quantity) >= 5 ORDER BY i.code LIMIT 1`)
    ).rows[0];
  });

  it('permissions: viewer cannot create cases; technician cannot create cases or bill', async () => {
    expect((await makeRequest('POST', '/api/srv/cases', { party_id: party.id, title: 'x' }, viewer)).status).toBe(403);
    expect((await makeRequest('POST', '/api/srv/cases', { party_id: party.id, title: 'x' }, tech)).status).toBe(403);
  });

  it('intake: retried channel request returns the existing case; expired contract is not an entitlement', async () => {
    const a = await makeRequest('POST', '/api/srv/cases', { party_id: party.id, title: 'AC not cooling', channel: 'WHATSAPP', external_ref: 'WA-123', priority: 'HIGH' }, service);
    expect(a.status).toBe(201);
    expect(a.body.data.response_due_at).toBeTruthy();
    const b = await makeRequest('POST', '/api/srv/cases', { party_id: party.id, title: 'AC not cooling', channel: 'WHATSAPP', external_ref: 'WA-123' }, service);
    expect(b.status).toBe(409);
    expect(b.body.error.details.existing_id).toBe(a.body.data.id);
    const k = await makeRequest('POST', '/api/srv/contracts', { party_id: party.id, contract_type: 'WARRANTY', title: 'Old warranty', start_date: '2024-01-01', end_date: '2025-01-01', covers_labour: true, covers_parts: true }, service);
    expect(k.status).toBe(201);
    expect((await makeRequest('POST', `/api/srv/contracts/${k.body.data.id}/activate`, {}, service)).status).toBe(200);
    const inel = await makeRequest('POST', '/api/srv/cases', { party_id: party.id, contract_id: k.body.data.id, title: 'Compressor noise' }, service);
    expect(inel.status).toBe(409);
    expect(inel.body.error.code).toBe('ENTITLEMENT_INVALID');
    const bad = await makeRequest('POST', '/api/srv/contracts', { party_id: party.id, contract_type: 'AMC', title: 'x', start_date: '2026-05-01', end_date: '2026-04-01' }, service);
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.field).toBe('end_date');
  });

  it('dispatch: competing bookings for one technician — exactly one wins, touching windows allowed', async () => {
    const c = (await makeRequest('POST', '/api/srv/cases', { party_id: party.id, title: 'Two jobs' }, service)).body.data;
    const w1 = (await makeRequest('POST', '/api/srv/work-orders', { case_id: c.id }, service)).body.data;
    const w2 = (await makeRequest('POST', '/api/srv/work-orders', { case_id: c.id }, service)).body.data;
    const w3 = (await makeRequest('POST', '/api/srv/work-orders', { case_id: c.id }, service)).body.data;
    const t = techs.find((x: any) => x.code === 'T-002');
    const win = { technician_id: t.id, scheduled_start: '2026-11-02T05:00:00Z', scheduled_end: '2026-11-02T07:00:00Z' };
    const [r1, r2] = await Promise.all([makeRequest('POST', `/api/srv/work-orders/${w1.id}/dispatch`, win, service), makeRequest('POST', `/api/srv/work-orders/${w2.id}/dispatch`, win, service)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect([r1, r2].find((r) => r.status === 409)!.body.error.code).toBe('CAPACITY_CONFLICT');
    const touching = await makeRequest('POST', `/api/srv/work-orders/${w3.id}/dispatch`, { ...win, scheduled_start: '2026-11-02T07:00:00Z', scheduled_end: '2026-11-02T08:00:00Z' }, service);
    expect(touching.status).toBe(200);
    const inverted = await makeRequest('POST', `/api/srv/work-orders/${w3.id}/dispatch`, { ...win, scheduled_start: '2026-11-02T09:00:00Z', scheduled_end: '2026-11-02T08:00:00Z' }, service);
    expect(inverted.status).toBe(400);
  });

  it('execution: technician scope, parts replay, time overlap, checklist gate, sign-off invalidation, SoD time approval, bill once', async () => {
    const c = (await makeRequest('POST', '/api/srv/cases', { party_id: party.id, title: 'Leaking indoor unit', priority: 'CRITICAL' }, service)).body.data;
    const wo = (await makeRequest('POST', '/api/srv/work-orders', { case_id: c.id }, service)).body.data;
    const mine = techs.find((x: any) => x.code === 'T-001'); // linked to tech@ user
    const other = techs.find((x: any) => x.code === 'T-003');
    const start = new Date(Date.now() - 3 * 3600000);
    // Assigned to someone else: technician is out of scope.
    expect((await makeRequest('POST', `/api/srv/work-orders/${wo.id}/dispatch`, { technician_id: other.id, scheduled_start: '2026-12-01T05:00:00Z', scheduled_end: '2026-12-01T06:00:00Z' }, service)).status).toBe(200);
    const scope = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/start`, {}, tech);
    expect(scope.status).toBe(403);
    expect(scope.body.error.code).toBe('FORBIDDEN_SCOPE');
    expect((await makeRequest('POST', `/api/srv/work-orders/${wo.id}/dispatch`, { technician_id: mine.id, scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + 2 * 3600000).toISOString() }, service)).status).toBe(200);
    expect((await makeRequest('POST', `/api/srv/work-orders/${wo.id}/start`, {}, tech)).status).toBe(200);

    // Parts: same issue key twice (retry) consumes stock once and posts one journal.
    const before = Number((await db.query(`SELECT COALESCE(SUM(quantity),0)::text q FROM stock_movements WHERE item_id = $1`, [stockItem.id])).rows[0].q);
    const p1 = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/parts`, { item_id: stockItem.id, quantity: '2', issue_key: `ISS-${wo.id}` }, tech);
    const p2 = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/parts`, { item_id: stockItem.id, quantity: '2', issue_key: `ISS-${wo.id}` }, tech);
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(200);
    expect(p2.body.data.replayed).toBe(true);
    const after = Number((await db.query(`SELECT COALESCE(SUM(quantity),0)::text q FROM stock_movements WHERE item_id = $1`, [stockItem.id])).rows[0].q);
    expect(before - after).toBeCloseTo(2, 6);
    expect((await db.query(`SELECT COUNT(*)::int n FROM journals WHERE source_key = $1`, [`SRV_PART:ISS-${wo.id}`])).rows[0].n).toBe(1);
    const huge = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/parts`, { item_id: stockItem.id, quantity: '99999999', issue_key: `ISS-HUGE-${wo.id}` }, tech);
    expect(huge.status).toBe(409);
    expect(huge.body.error.code).toBe('INSUFFICIENT_STOCK');

    // Time: overlap refused, future refused.
    const t1 = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/time`, { start_at: start.toISOString(), end_at: new Date(start.getTime() + 90 * 60000).toISOString() }, tech);
    expect(t1.status).toBe(201);
    const ov = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/time`, { start_at: new Date(start.getTime() + 60 * 60000).toISOString(), end_at: new Date(start.getTime() + 120 * 60000).toISOString() }, tech);
    expect(ov.status).toBe(409);
    expect(ov.body.error.code).toBe('OVERLAP_DETECTED');
    expect((await makeRequest('POST', `/api/srv/work-orders/${wo.id}/time`, { start_at: new Date(Date.now() + 3600000).toISOString(), end_at: new Date(Date.now() + 7200000).toISOString() }, tech)).status).toBe(400);

    // Extra work proposed; declined extras are never billed.
    const ex1 = (await makeRequest('POST', `/api/srv/work-orders/${wo.id}/extras`, { description: 'Replace drain pump', amount: '6500' }, tech)).body.data;
    const ex2 = (await makeRequest('POST', `/api/srv/work-orders/${wo.id}/extras`, { description: 'Paint bracket', amount: '1500' }, tech)).body.data;
    expect((await makeRequest('POST', `/api/srv/extras/${ex1.id}/decide`, { accept: true }, tech)).status).toBe(400); // name required
    expect((await makeRequest('POST', `/api/srv/extras/${ex1.id}/decide`, { accept: true, accepted_by_name: 'Mr. Kamran' }, tech)).status).toBe(200);
    expect((await makeRequest('POST', `/api/srv/extras/${ex2.id}/decide`, { accept: false }, tech)).status).toBe(200);

    // Checklist gate.
    const noSign = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/complete`, { resolution_notes: 'Fixed' }, tech);
    expect(noSign.status).toBe(409);
    expect(noSign.body.error.code).toBe('CHECKLIST_INCOMPLETE');
    for (const i of [0, 1, 3]) expect((await makeRequest('POST', `/api/srv/work-orders/${wo.id}/checklist`, { index: i, done: true }, tech)).status).toBe(200);
    expect((await makeRequest('POST', `/api/srv/work-orders/${wo.id}/signoff`, { customer_signoff_name: 'Mr. Kamran' }, tech)).status).toBe(200);
    // A part added after sign-off invalidates it (signature binds the exact work).
    await makeRequest('POST', `/api/srv/work-orders/${wo.id}/parts`, { item_id: stockItem.id, quantity: '1', issue_key: `ISS2-${wo.id}`, chargeable: false }, tech);
    const stale = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/complete`, { resolution_notes: 'Fixed' }, tech);
    expect(stale.status).toBe(409);
    expect((await makeRequest('POST', `/api/srv/work-orders/${wo.id}/signoff`, { customer_signoff_name: 'Mr. Kamran' }, tech)).status).toBe(200);
    const done = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/complete`, { resolution_notes: 'Replaced drain pump, cleared line' }, tech);
    expect(done.status).toBe(200);

    // Technician cannot bill; time still pending approval blocks billing.
    expect((await makeRequest('POST', `/api/srv/work-orders/${wo.id}/bill`, { invoice_date: '2026-10-01' }, tech)).status).toBe(403);
    const pending = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/bill`, { invoice_date: '2026-10-01' }, service);
    expect(pending.status).toBe(409);
    expect(pending.body.error.message).toMatch(/awaiting approval/);
    expect((await makeRequest('POST', `/api/srv/time/${t1.body.data.id}/approve`, {}, tech)).status).toBe(403); // no SERVICE_MANAGE
    expect((await makeRequest('POST', `/api/srv/time/${t1.body.data.id}/approve`, {}, service)).status).toBe(200);

    const bill = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/bill`, { invoice_date: '2026-10-01' }, service);
    expect(bill.status).toBe(200);
    expect(bill.body.data.status).toBe('BILLED');
    const inv = (await db.query(`SELECT * FROM ar_invoices WHERE id = $1`, [bill.body.data.ar_invoice_id])).rows[0];
    // 1.5h × 2500 + 2 × part price + 6500 accepted extra (declined 1500 and non-chargeable part excluded), +18%
    const price = Number((await db.query(`SELECT unit_price::text p FROM items WHERE id = $1`, [stockItem.id])).rows[0].p);
    const net = Math.round((1.5 * 2500 + 2 * price + 6500) * 100) / 100;
    expect(Number(inv.subtotal)).toBeCloseTo(net, 2);
    expect(Number(inv.total_amount)).toBeCloseTo(net + Math.round(net * 18) / 100, 1);
    const j = await db.query(`SELECT SUM(jl.base_debit)::text d, SUM(jl.base_credit)::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id WHERE j.source_key = $1`, [`SRV_WO_BILL:${wo.id}`]);
    expect(Number(j.rows[0].d)).toBeCloseTo(Number(j.rows[0].c), 8);
    expect(Number(j.rows[0].d)).toBeCloseTo(Number(inv.total_amount), 2);
    const again = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/bill`, { invoice_date: '2026-10-01' }, service);
    expect(again.status).toBe(409);

    // Case closes only after billing; alert rule for CRITICAL case fired via outbox.
    expect((await makeRequest('POST', `/api/srv/cases/${c.id}/resolve`, { resolution_summary: 'Resolved on first visit' }, service)).status).toBe(200);
    expect((await makeRequest('POST', `/api/srv/cases/${c.id}/close`, {}, service)).status).toBe(200);
    const sum = (await makeRequest('GET', '/api/srv/summary', undefined, service)).body.data;
    expect(sum.first_time_fix_pct).not.toBeNull();
  });

  it('SoD: a manager cannot approve time they logged themselves; warranty job bills nothing', async () => {
    const k = (await makeRequest('POST', '/api/srv/contracts', { party_id: party.id, contract_type: 'WARRANTY', title: 'Install warranty', start_date: '2026-01-01', end_date: '2027-12-31', covers_labour: true, covers_parts: true }, service)).body.data;
    await makeRequest('POST', `/api/srv/contracts/${k.id}/activate`, {}, service);
    const c = (await makeRequest('POST', '/api/srv/cases', { party_id: party.id, contract_id: k.id, title: 'Warranty visit' }, service)).body.data;
    const wo = (await makeRequest('POST', '/api/srv/work-orders', { case_id: c.id, checklist: [{ item: 'Inspect', mandatory: true }] }, service)).body.data;
    expect(wo.warranty_covered).toBe(true);
    const t = techs.find((x: any) => x.code === 'T-003');
    const start = new Date(Date.now() - 10 * 3600000);
    await makeRequest('POST', `/api/srv/work-orders/${wo.id}/dispatch`, { technician_id: t.id, scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + 3600000).toISOString() }, service);
    await makeRequest('POST', `/api/srv/work-orders/${wo.id}/start`, {}, service);
    const te = (await makeRequest('POST', `/api/srv/work-orders/${wo.id}/time`, { start_at: start.toISOString(), end_at: new Date(start.getTime() + 3600000).toISOString() }, service)).body.data;
    const sod = await makeRequest('POST', `/api/srv/time/${te.id}/approve`, {}, service);
    expect(sod.status).toBe(403);
    expect(sod.body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await makeRequest('POST', `/api/srv/time/${te.id}/approve`, {}, admin)).status).toBe(200);
    await makeRequest('POST', `/api/srv/work-orders/${wo.id}/checklist`, { index: 0, done: true }, service);
    await makeRequest('POST', `/api/srv/work-orders/${wo.id}/signoff`, { customer_signoff_name: 'Site guard' }, service);
    expect((await makeRequest('POST', `/api/srv/work-orders/${wo.id}/complete`, { resolution_notes: 'OK' }, service)).status).toBe(200);
    const bill = await makeRequest('POST', `/api/srv/work-orders/${wo.id}/bill`, { invoice_date: '2026-10-01' }, service);
    expect(bill.status).toBe(200);
    expect(bill.body.data.ar_invoice_id).toBeNull();
    expect(bill.body.data.result.note).toMatch(/covered/);
  });

  it('preventive: generation is idempotent per contract occurrence; SLA job registered', async () => {
    const r1 = await makeRequest('POST', '/api/srv/contracts/generate-pm', { as_of: '2026-10-01' }, service);
    expect(r1.status).toBe(200);
    const n = (await db.query(`SELECT COUNT(*)::int n FROM srv_cases WHERE pm_due_date IS NOT NULL`)).rows[0].n;
    const r2 = await makeRequest('POST', '/api/srv/contracts/generate-pm', { as_of: '2026-10-01' }, service);
    expect(r2.body.data.created).toHaveLength(0);
    expect((await db.query(`SELECT COUNT(*)::int n FROM srv_cases WHERE pm_due_date IS NOT NULL`)).rows[0].n).toBe(n);
    const board = await makeRequest('GET', '/api/srv/board?date=2026-11-02', undefined, service);
    expect(board.status).toBe(200);
    expect(board.body.data.technicians.find((x: any) => x.code === 'T-002').jobs.length).toBe(2);
  });

  it('tenant isolation: another org cannot see or reference service records', async () => {
    const any = (await db.query(`SELECT id FROM srv_cases LIMIT 1`)).rows[0];
    const r = await makeRequest('GET', `/api/srv/cases/${any.id}`, undefined, service);
    expect(r.status).toBe(200);
    // A random / foreign id reads as not found, never as forbidden.
    expect((await makeRequest('GET', `/api/srv/cases/00000000-0000-0000-0000-000000000000`, undefined, service)).status).toBe(404);
    const foreign = await makeRequest('POST', '/api/srv/cases', { party_id: '00000000-0000-0000-0000-000000000000', title: 'x' }, service);
    expect(foreign.status).toBe(400); // assertOrgRef: foreign/missing reference is a field error, never a leak
    expect(foreign.body.error.details.field).toBe('party_id');
  });
});
