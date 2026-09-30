import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { computeTax, effectiveCode, windowsOverlap } from '../src/domain/tax.js';
import { allocatePick } from '../src/domain/wms.js';
import { evaluate, validateDefinition, renderTemplate } from '../src/automation/conditions.js';
import { validateModuleTransition, MODULES } from '../src/lib/modules.js';

const ADMIN_ID = '40000000-0000-0000-0000-000000000001';

describe('Pure domain rules (tax, pick allocation, event conditions, module lifecycle)', () => {
  it('tax: exclusive HALF_UP per line and inclusive extraction always re-adds to gross', () => {
    expect(computeTax({ amount: '99.99', rate: '18' })).toEqual({ net: '99.99', tax: '18.00', gross: '117.99' });
    expect(computeTax({ amount: '0.03', rate: '18' }).tax).toBe('0.01'); // 0.0054 -> 0.01 HALF_UP
    const inc = computeTax({ amount: '100', rate: '18', inclusive: true });
    expect(inc).toEqual({ net: '84.75', tax: '15.25', gross: '100.00' });
    for (const a of ['0.01', '1.18', '333.33', '999999.99']) {
      const r = computeTax({ amount: a, rate: '17', inclusive: true });
      expect((Number(r.net) * 100 + Number(r.tax) * 100) / 100).toBeCloseTo(Number(a), 10);
    }
  });

  it('tax: effective version selection and window overlap (open-ended windows)', () => {
    const v = [
      { effective_from: '2024-01-01', effective_to: '2025-06-30', rate: '17' },
      { effective_from: '2025-07-01', effective_to: null, rate: '18' },
    ];
    expect(effectiveCode(v, '2025-06-30')!.rate).toBe('17');
    expect(effectiveCode(v, '2025-07-01')!.rate).toBe('18');
    expect(effectiveCode(v, '2023-12-31')).toBeNull();
    expect(windowsOverlap('2025-01-01', null, '2030-01-01', '2030-12-31')).toBe(true);
    expect(windowsOverlap('2025-01-01', '2025-12-31', '2026-01-01', null)).toBe(false);
  });

  it('pick allocation: PICK before BULK, never over a bin, remainder is a shortage', () => {
    const bins = [
      { bin_id: 'b', bin_code: 'BULK-1', bin_type: 'BULK', quantity: '100' },
      { bin_id: 'p2', bin_code: 'A-2', bin_type: 'PICK', quantity: '3' },
      { bin_id: 'p1', bin_code: 'A-1', bin_type: 'PICK', quantity: '5' },
      { bin_id: 'q', bin_code: 'QC', bin_type: 'QUARANTINE', quantity: '50' },
    ];
    expect(allocatePick('7', bins).allocations).toEqual([
      { bin_id: 'p1', quantity: '5.00000000' },
      { bin_id: 'p2', quantity: '2.00000000' },
    ]);
    const short = allocatePick('200', bins);
    expect(short.shortage).toBe('92.00000000'); // quarantine stock is never picked
    expect(short.allocations.at(-1)).toEqual({ bin_id: null, quantity: '92.00000000' });
  });

  it('event conditions: exact decimal comparison, dates, in/contains/exists and template rendering', () => {
    expect(evaluate({ field: 'amount', op: 'gte', value: '1000000' }, { amount: '1000000.00000000' })).toBe(true);
    expect(evaluate({ field: 'amount', op: 'gt', value: '0.1' }, { amount: '0.10000000' })).toBe(false);
    expect(evaluate({ field: 'due', op: 'lt', value: '2026-10-02' }, { due: '2026-10-01' })).toBe(true);
    expect(evaluate({ field: 'priority', op: 'in', value: 'HIGH,CRITICAL' }, { priority: 'CRITICAL' })).toBe(true);
    expect(evaluate({ field: 'a.b', op: 'exists' }, { a: { b: 0 } })).toBe(true);
    expect(evaluate({ field: 'title', op: 'contains', value: 'LEAK' }, { title: 'Gas leak at site' })).toBe(true);
    expect(evaluate({ field: 'amount', op: 'gt', value: '5' }, { amount: 'abc' })).toBe(false);
    expect(renderTemplate('Case {{number}} / {{missing}}', { number: 'SRV-1' })).toBe('Case SRV-1 / ');
    expect(validateDefinition({ event_type: 'X', conditions: [], actions: [] }).length).toBeGreaterThan(0);
    expect(validateDefinition({ event_type: 'SERVICE_CASE_CREATED', conditions: [{ field: 'x', op: 'gt', value: 'abc' }], actions: [{ type: 'POST_JOURNAL', title: 't' }] })).toHaveLength(2);
  });

  it('module lifecycle: dependencies, dependents and core modules are enforced', () => {
    const states = new Map(MODULES.map((m) => [m.code, 'enabled']));
    expect(validateModuleTransition('GL', 'draining', states)).toMatch(/core/);
    expect(validateModuleTransition('AR', 'draining', states)).toMatch(/depending on AR/);
    expect(validateModuleTransition('TAX', 'disabled', states)).toMatch(/cannot move from enabled to disabled/);
    expect(validateModuleTransition('TAX', 'draining', states)).toBeNull();
    states.set('INV', 'disabled');
    states.set('WMS', 'disabled');
    expect(validateModuleTransition('WMS', 'enabled', states)).toMatch(/Enable dependencies first: INV/);
  });
});

describe('ADM / CFG / TAX / WMS / AUT API', () => {
  let admin: string;
  let controller: string;
  let accountant: string;
  let viewer: string;
  let service: string;

  beforeAll(async () => {
    await bootstrap();
    [admin, controller, accountant, viewer, service] = await Promise.all(
      ['admin', 'controller', 'accountant', 'viewer', 'service'].map((u) => login(`${u}@omnysync.internal`)),
    );
  });

  it('admin: self-lockout and last-admin guards; invalid roles rejected; viewer denied', async () => {
    expect((await makeRequest('GET', '/api/admin/users', undefined, viewer)).status).toBe(403);
    const self = await makeRequest('POST', `/api/admin/users/${ADMIN_ID}/roles`, { roles: ['VIEWER'] }, admin);
    expect(self.status).toBe(409);
    expect(self.body.error.message).toMatch(/self-lockout/);
    expect((await makeRequest('POST', `/api/admin/users/${ADMIN_ID}/suspend`, {}, admin)).status).toBe(409);
    const bad = await makeRequest('POST', '/api/admin/users', { email: 'x@y.pk', name: 'X', initial_password: 'Sup3rStrongPass!', roles: ['GOD'] }, admin);
    expect(bad.status).toBe(400);
    const weak = await makeRequest('POST', '/api/admin/users', { email: 'x@y.pk', name: 'X', initial_password: 'short', roles: ['VIEWER'] }, admin);
    expect(weak.status).toBe(400);
    const created = await makeRequest('POST', '/api/admin/users', { email: 'new.tech@omnysync.internal', name: 'New Tech', initial_password: 'Sup3rStrongPass!', roles: ['TECHNICIAN'] }, admin);
    expect(created.status).toBe(201);
    const dup = await makeRequest('POST', '/api/admin/users', { email: 'new.tech@omnysync.internal', name: 'New Tech', initial_password: 'Sup3rStrongPass!', roles: ['TECHNICIAN'] }, admin);
    expect(dup.status).toBe(409);
    const promote = await makeRequest('POST', `/api/admin/users/${created.body.data.id}/roles`, { roles: ['TECHNICIAN', 'SERVICE_MANAGER'], reason: 'Team lead' }, admin);
    expect(promote.status).toBe(200);
    const aud = await db.query(`SELECT * FROM audit_logs WHERE action = 'USER_ROLES_CHANGED' AND entity_id = $1`, [created.body.data.id]);
    expect(aud.rows.length).toBe(1);
  });

  it('settings: typed validation, optimistic version and append-only history', async () => {
    const bad = await makeRequest('POST', '/api/config/settings/pos.max_cashier_discount_pct', { value: '150', version: 0 }, admin);
    expect(bad.status).toBe(400);
    const r1 = await makeRequest('POST', '/api/config/settings/pos.max_cashier_discount_pct', { value: '12.5', version: 0, reason: 'Festival' }, admin);
    expect(r1.status).toBe(200);
    expect(r1.body.data.version).toBe(1);
    const stale = await makeRequest('POST', '/api/config/settings/pos.max_cashier_discount_pct', { value: '15', version: 0 }, admin);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_REVISION');
    const hours = await makeRequest('POST', '/api/config/settings/service.business_hours', { value: { start: '18:00', end: '09:00', days: [1] }, version: 0 }, admin);
    expect(hours.status).toBe(400);
    const hist = await makeRequest('GET', '/api/config/settings/pos.max_cashier_discount_pct/history', undefined, admin);
    expect(hist.body.data).toHaveLength(1);
    await expect(db.query(`UPDATE org_setting_history SET reason = 'tamper'`)).rejects.toThrow(/append-only/);
    expect((await makeRequest('POST', '/api/config/settings/pos.max_cashier_discount_pct', { value: '5', version: 1 }, viewer)).status).toBe(403);
  });

  it('module lifecycle: a draining module blocks new records but lets existing work complete', async () => {
    expect((await makeRequest('POST', '/api/config/modules/GL/state', { state: 'draining', reason: 'x' }, admin)).status).toBe(409);
    const drain = await makeRequest('POST', '/api/config/modules/TAX/state', { state: 'draining', reason: 'Year-end migration' }, admin);
    expect(drain.status).toBe(200);
    const blocked = await makeRequest('POST', '/api/tax/codes', { code: 'NEW1', name: 'n', kind: 'OUTPUT', rate: '5', effective_from: '2026-01-01' }, accountant);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('MODULE_DISABLED');
    expect((await makeRequest('GET', '/api/tax/codes', undefined, accountant)).status).toBe(200); // reads retained
    expect((await makeRequest('POST', '/api/config/modules/TAX/state', { state: 'enabled', reason: 'done' }, admin)).status).toBe(200);
  });

  it('tax: overlapping code versions refused; calculator uses the version effective on the line date', async () => {
    const overlap = await makeRequest('POST', '/api/tax/codes', { code: 'GST18', name: 'dup', kind: 'OUTPUT', rate: '18', effective_from: '2025-01-01' }, accountant);
    expect(overlap.status).toBe(409);
    const calc = await makeRequest('POST', '/api/tax/calculate', { lines: [{ amount: '1000', tax_code: 'GST18', date: '2026-05-01' }, { amount: '118', tax_code: 'GST18', inclusive: true }] }, accountant);
    expect(calc.status).toBe(200);
    expect(calc.body.data.lines[0].tax).toBe('180.00');
    expect(calc.body.data.lines[1]).toMatchObject({ net: '100.00', tax: '18.00' });
    const missing = await makeRequest('POST', '/api/tax/calculate', { lines: [{ amount: '10', tax_code: 'GST18', date: '2020-01-01' }] }, accountant);
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('MAPPING_MISSING');
  });

  it('tax return: ledger-derived, preparer cannot file (SoD), settlement posts once and balances', async () => {
    const prep = await makeRequest('POST', '/api/tax/returns', { period_start: '2026-01-01', period_end: '2026-12-31' }, controller);
    expect(prep.status).toBe(201);
    const ret = prep.body.data;
    const ledger = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN a.code='212001' THEN jl.base_credit - jl.base_debit ELSE 0 END),0)::text AS o FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.status='POSTED'`,
    );
    expect(Number(ret.output_tax)).toBeCloseTo(Number(ledger.rows[0].o), 2);
    const dupe = await makeRequest('POST', '/api/tax/returns', { period_start: '2026-01-01', period_end: '2026-12-31' }, controller);
    expect(dupe.status).toBe(409);
    expect((await makeRequest('POST', `/api/tax/returns/${ret.id}/file`, { filing_reference: 'FBR-1' }, accountant)).status).toBe(403); // no TAX_FILE
    const sod = await makeRequest('POST', `/api/tax/returns/${ret.id}/file`, { filing_reference: 'FBR-1' }, controller);
    expect(sod.status).toBe(403);
    expect(sod.body.error.code).toBe('SEGREGATION_OF_DUTIES');
    const filed = await makeRequest('POST', `/api/tax/returns/${ret.id}/file`, { filing_reference: 'FBR-2026-001' }, admin);
    expect(filed.status).toBe(200);
    expect(filed.body.data.status).toBe('FILED');
    const settle = await makeRequest('POST', `/api/tax/returns/${ret.id}/settle`, { payment_date: '2026-10-01' }, admin);
    expect(settle.status).toBe(200);
    expect(settle.body.data.status).toBe('SETTLED');
    const again = await makeRequest('POST', `/api/tax/returns/${ret.id}/settle`, { payment_date: '2026-10-01' }, admin);
    expect(again.status).toBe(409);
    if (settle.body.data.settlement_journal_id) {
      const j = await db.query(`SELECT SUM(base_debit)::text d, SUM(base_credit)::text c FROM journal_lines WHERE journal_id = $1`, [settle.body.data.settlement_journal_id]);
      expect(Number(j.rows[0].d)).toBeCloseTo(Number(j.rows[0].c), 8);
    }
  });

  it('wms: putaway bounded by unbinned stock and capacity; one pick list per order; over-pick refused', async () => {
    const bins = (await makeRequest('GET', '/api/wms/bins', undefined, admin)).body.data;
    const pick1 = bins.find((b: any) => b.bin_code === 'A-01-01');
    const unb = (await makeRequest('GET', '/api/wms/unbinned', undefined, admin)).body.data;
    expect(unb.length).toBeGreaterThan(0);
    const u = unb[0];
    const tooMuch = await makeRequest('POST', '/api/wms/putaway', { bin_id: pick1.id, item_id: u.item_id, quantity: String(Number(u.unbinned) + 1) }, admin);
    expect([409]).toContain(tooMuch.status);
    const qty = String(Math.min(Number(u.unbinned), 5));
    const put = await makeRequest('POST', '/api/wms/putaway', { bin_id: pick1.id, item_id: u.item_id, quantity: qty }, admin);
    expect(put.status).toBe(200);
    // Confirmed sales order for that item
    const party = (await db.query(`SELECT id FROM parties WHERE party_type IN ('CUSTOMER','BOTH') LIMIT 1`)).rows[0];
    const so = await makeRequest('POST', '/api/sales/orders', { party_id: party.id, order_date: '2026-10-01', lines: [{ item_id: u.item_id, quantity: '2', unit_price: '10' }] }, admin);
    expect(so.status).toBe(201);
    expect((await makeRequest('POST', `/api/sales/orders/${so.body.data.id}/confirm`, {}, admin)).status).toBe(200);
    const gen = await makeRequest('POST', '/api/wms/pick-lists/generate', { sales_order_id: so.body.data.id }, admin);
    expect(gen.status).toBe(201);
    const again = await makeRequest('POST', '/api/wms/pick-lists/generate', { sales_order_id: so.body.data.id }, admin);
    expect(again.status).toBe(409);
    const detail = (await makeRequest('GET', `/api/wms/pick-lists/${gen.body.data.id}`, undefined, admin)).body.data;
    const line = detail.lines.find((l: any) => l.bin_id);
    expect((await makeRequest('POST', `/api/wms/pick-lists/${detail.id}/lines/${line.id}/confirm`, { quantity: '1' }, admin)).status).toBe(409); // not started
    expect((await makeRequest('POST', `/api/wms/pick-lists/${detail.id}/start`, {}, admin)).status).toBe(200);
    expect((await makeRequest('POST', `/api/wms/pick-lists/${detail.id}/complete`, {}, admin)).status).toBe(409); // unpicked
    const over = await makeRequest('POST', `/api/wms/pick-lists/${detail.id}/lines/${line.id}/confirm`, { quantity: '99' }, admin);
    expect(over.status).toBe(400);
    const conf = await makeRequest("POST", `/api/wms/pick-lists/${detail.id}/lines/${line.id}/confirm`, { quantity: String(Number(line.qty_requested)) }, admin);
    expect(conf.status).toBe(200);
    const done = await makeRequest('POST', `/api/wms/pick-lists/${detail.id}/complete`, {}, admin);
    expect(done.status).toBe(200);
    const binQty = await db.query(`SELECT quantity FROM bin_stock WHERE bin_id = $1 AND item_id = $2`, [pick1.id, u.item_id]);
    expect(Number(binQty.rows[0].quantity)).toBeCloseTo(Number(qty) - Number(line.qty_requested), 6);
  });

  it('event rules: builder validation, simulation has no side effects, delivery is exactly-once', async () => {
    const bad = await makeRequest('POST', '/api/automation/event-rules', { code: 'BAD', name: 'bad', event_type: 'TAX_RETURN_CREATED', actions: [{ type: 'POST_JOURNAL', title: 'x' }] }, admin);
    expect(bad.status).toBe(400);
    const rule = await makeRequest(
      'POST',
      '/api/automation/event-rules',
      { code: 'EVT-TAX-DRAFT', name: 'Tax return drafted', event_type: 'TAX_RETURN_CREATED', conditions: [{ field: 'status', op: 'eq', value: 'DRAFT' }], actions: [{ type: 'TASK', title: 'Review {{number}}', assigned_role: 'CONTROLLER', due_in_days: 3 }] },
      admin,
    );
    expect(rule.status).toBe(201);
    const tasksBefore = (await db.query(`SELECT COUNT(*)::int n FROM automation_tasks`)).rows[0].n;
    const sim = await makeRequest('POST', '/api/automation/event-rules/simulate', { event_type: 'TAX_RETURN_CREATED', conditions: [{ field: 'status', op: 'eq', value: 'DRAFT' }], actions: [{ type: 'TASK', title: 'Review {{number}}' }] }, admin);
    expect(sim.status).toBe(200);
    expect(sim.body.data.matched).toBeGreaterThanOrEqual(1);
    expect((await db.query(`SELECT COUNT(*)::int n FROM automation_tasks`)).rows[0].n).toBe(tasksBefore);
    // Draft rules do not fire; published rules only see events after publication.
    expect((await makeRequest('POST', `/api/automation/event-rules/${rule.body.data.id}/publish`, {}, admin)).status).toBe(200);
    await makeRequest('POST', '/api/tax/returns', { period_start: '2025-01-01', period_end: '2025-03-31' }, controller);
    const p1 = await makeRequest('POST', '/api/automation/events/process', {}, admin);
    expect(p1.body.data.matched).toBeGreaterThanOrEqual(1);
    const p2 = await makeRequest('POST', '/api/automation/events/process', {}, admin);
    expect(p2.body.data.matched).toBe(0); // replay does nothing
    const tasks = (await makeRequest('GET', '/api/automation/tasks', undefined, admin)).body.data.filter((t: any) => t.rule_code === 'EVT-TAX-DRAFT');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toMatch(/^Review TAXR-2025-/);
    expect((await makeRequest('POST', `/api/automation/tasks/${tasks[0].id}/complete`, {}, admin)).status).toBe(200);
    expect((await makeRequest('POST', `/api/automation/tasks/${tasks[0].id}/complete`, {}, admin)).status).toBe(409);
    expect((await makeRequest('POST', '/api/automation/event-rules', { code: 'X', name: 'x', event_type: 'ABC_DEF', actions: [{ type: 'ALERT', title: 't' }] }, service)).status).toBe(403);
  });
});
