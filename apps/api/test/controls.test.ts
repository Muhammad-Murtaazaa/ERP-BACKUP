/**
 * Cross-cutting control tests: segregation of duties, period guard, double-post,
 * concurrency, idempotency, tenant isolation, input limits and "GET never mutates".
 */
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { bootstrap, login, makeRequest, db } from './harness.js';

describe('Financial and platform controls', () => {
  let admin: string;
  let controller: string;
  let accountant: string;
  let viewer: string;
  let acc: Record<string, any> = {};

  const draft = (token: string, date: string, amount = '1000.00', extra: any = {}) =>
    makeRequest(
      'POST',
      '/api/journals/draft',
      {
        posting_date: date,
        document_date: date,
        description: `Control test ${crypto.randomUUID().slice(0, 8)}`,
        lines: [
          { account_id: acc['521001'].id, debit_amount: amount, credit_amount: '0.00' },
          { account_id: acc['111002'].id, debit_amount: '0.00', credit_amount: amount },
        ],
        ...extra,
      },
      token,
    );
  const toApproved = async (date = '2026-03-10') => {
    const d = await draft(accountant, date);
    expect(d.status).toBe(201);
    const id = d.body.data.id;
    expect((await makeRequest('POST', `/api/journals/${id}/submit`, {}, accountant)).status).toBe(200);
    expect((await makeRequest('POST', `/api/journals/${id}/approve`, {}, controller)).status).toBe(200);
    return id;
  };
  const tb = async () => (await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-12-31', undefined, controller)).body.data;

  beforeAll(async () => {
    await bootstrap();
    [admin, controller, accountant, viewer] = await Promise.all([
      login('admin@omnysync.internal'),
      login('controller@omnysync.internal'),
      login('accountant@omnysync.internal'),
      login('viewer@omnysync.internal'),
    ]);
    const a = await makeRequest('GET', '/api/coa/accounts', undefined, admin);
    acc = Object.fromEntries(a.body.data.map((x: any) => [x.code, x]));
  });

  it('SoD: the maker of a journal cannot approve it', async () => {
    const d = await draft(admin, '2026-03-11');
    expect(d.status).toBe(201);
    await makeRequest('POST', `/api/journals/${d.body.data.id}/submit`, {}, admin);
    const self = await makeRequest('POST', `/api/journals/${d.body.data.id}/approve`, {}, admin);
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('a journal cannot be posted before approval, nor posted twice', async () => {
    const d = await draft(accountant, '2026-03-12');
    const early = await makeRequest('POST', `/api/journals/${d.body.data.id}/post`, {}, controller);
    expect(early.status).toBeGreaterThanOrEqual(400);
    const id = await toApproved('2026-03-12');
    expect((await makeRequest('POST', `/api/journals/${id}/post`, {}, controller)).status).toBe(200);
    const again = await makeRequest('POST', `/api/journals/${id}/post`, {}, controller);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('ALREADY_POSTED');
  });

  it('concurrent posts of the same journal post exactly once (ledger stays balanced)', async () => {
    const id = await toApproved('2026-03-13');
    const before = await tb();
    const rent = (t: any) => t.accounts.find((x: any) => x.account_code === '521001')?.net_balance ?? '0.00';
    const results = await Promise.all([1, 2, 3].map(() => makeRequest('POST', `/api/journals/${id}/post`, {}, controller)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status >= 400 && r.status < 500)).toHaveLength(2);
    const after = await tb();
    expect(after.is_balanced).toBe(true);
    expect(Number(rent(after)) - Number(rent(before))).toBe(1000);
    const lines = await db.query(`SELECT COUNT(*)::int AS n FROM journal_lines WHERE journal_id = $1`, [id]);
    expect(lines.rows[0].n).toBe(2);
  });

  it('period guard: nothing posts into a hard-closed period; soft-closed needs the closing flow', async () => {
    const d = await draft(accountant, '2026-01-15');
    if (d.status === 201) {
      const id = d.body.data.id;
      await makeRequest('POST', `/api/journals/${id}/submit`, {}, accountant);
      await makeRequest('POST', `/api/journals/${id}/approve`, {}, controller);
      const p = await makeRequest('POST', `/api/journals/${id}/post`, {}, controller);
      expect(p.status).toBeGreaterThanOrEqual(400);
      const j = await db.query(`SELECT status FROM journals WHERE id = $1`, [id]);
      expect(j.rows[0].status).not.toBe('POSTED');
    } else {
      expect(d.status).toBeGreaterThanOrEqual(400);
    }
    const posted = await db.query(
      `SELECT COUNT(*)::int AS n FROM journals WHERE status = 'POSTED' AND posting_date BETWEEN '2026-01-01' AND '2026-01-31' AND source_type IS DISTINCT FROM 'OPENING'`,
    );
    expect(posted.rows[0].n).toBe(0);
  });

  it('rejects malformed money: negatives, both sides, excess scale, unbalanced', async () => {
    const bad = async (lines: any[]) =>
      (await makeRequest('POST', '/api/journals/draft', { posting_date: '2026-03-14', document_date: '2026-03-14', description: 'bad', lines }, accountant)).status;
    const L = (code: string, d: string, c: string) => ({ account_id: acc[code].id, debit_amount: d, credit_amount: c });
    expect(await bad([L('521001', '-10.00', '0'), L('111002', '0', '-10.00')])).toBe(400);
    expect(await bad([L('521001', '10.00', '10.00'), L('111002', '0', '0')])).toBe(400);
    expect(await bad([L('521001', '10.001', '0'), L('111002', '0', '10.001')])).toBe(400);
    expect(await bad([L('521001', '10.00', '0'), L('111002', '0', '9.99')])).toBe(400);
    expect(await bad([L('521001', '1e3', '0'), L('111002', '0', '1e3')])).toBe(400);
  });

  it('idempotency: a retried command replays; a different payload under the same key conflicts', async () => {
    const key = `idem-${crypto.randomUUID()}`;
    const body = {
      posting_date: '2026-03-16',
      document_date: '2026-03-16',
      description: 'Idempotent draft',
      lines: [
        { account_id: acc['521001'].id, debit_amount: '77.00', credit_amount: '0.00' },
        { account_id: acc['111002'].id, debit_amount: '0.00', credit_amount: '77.00' },
      ],
    };
    const a = await makeRequest('POST', '/api/journals/draft', body, accountant, { 'Idempotency-Key': key });
    const b = await makeRequest('POST', '/api/journals/draft', body, accountant, { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    const n = await db.query(`SELECT COUNT(*)::int AS n FROM journals WHERE description = 'Idempotent draft'`);
    expect(n.rows[0].n).toBe(1);
    const c = await makeRequest('POST', '/api/journals/draft', { ...body, description: 'Different' }, accountant, { 'Idempotency-Key': key });
    expect(c.status).toBeGreaterThanOrEqual(409);
    expect(c.status).toBeLessThan(500);
  });

  it('tenant isolation: another organization’s records are invisible and unaddressable', async () => {
    const org2 = crypto.randomUUID();
    const party2 = crypto.randomUUID();
    await db.query(`INSERT INTO organizations (id, name, code) VALUES ($1, 'Other Org', $2)`, [org2, `OTHER-${org2.slice(0, 6)}`]);
    await db.query(`INSERT INTO parties (id, organization_id, code, name, party_type) VALUES ($1, $2, 'X-CUST', 'Foreign Customer', 'CUSTOMER')`, [party2, org2]);
    const list = await makeRequest('GET', '/api/parties', undefined, admin);
    expect(list.body.data.some((p: any) => p.id === party2)).toBe(false);
    const one = await makeRequest('GET', `/api/parties/${party2}`, undefined, admin);
    expect(one.status).toBe(404);
    const upd = await makeRequest('POST', `/api/parties/${party2}`, { name: 'hijack' }, admin);
    expect([403, 404]).toContain(upd.status);
    const still = await db.query(`SELECT name FROM parties WHERE id = $1`, [party2]);
    expect(still.rows[0].name).toBe('Foreign Customer');
  });

  it('least privilege: a viewer cannot create, approve or post', async () => {
    expect((await draft(viewer, '2026-03-17')).status).toBe(403);
    const id = await toApproved('2026-03-17');
    expect((await makeRequest('POST', `/api/journals/${id}/post`, {}, viewer)).status).toBe(403);
    expect((await makeRequest('POST', '/api/periods/00000000-0000-0000-0000-000000000000/status', { status: 'OPEN' }, viewer)).status).toBe(403);
  });

  it('fixed assets: depreciating the same asset twice for a period is rejected (no double charge)', async () => {
    const periods = (await makeRequest('GET', '/api/periods', undefined, accountant)).body.data;
    const open = periods.find((p: any) => p.status === 'OPEN');
    const cat = await makeRequest('POST', '/api/assets/categories', { code: 'CAT-CTL', name: 'Control test', depreciation_method: 'STRAIGHT_LINE', useful_life_months: 12, salvage_value_percentage: 0 }, admin);
    expect(cat.status).toBe(201);
    const asset = await makeRequest('POST', '/api/assets', { asset_number: 'FA-CTL-1', name: 'Test rig', category_id: cat.body.data.id, acquisition_date: '2026-01-10', acquisition_cost: '120000.00', salvage_value: '0.00', useful_life_months: 12, depreciation_method: 'STRAIGHT_LINE' }, admin);
    expect(asset.status).toBe(201);
    const id = asset.body.data.id;
    const first = await makeRequest('POST', `/api/assets/${id}/depreciate`, { period_id: open.id, period_months: 1 }, admin);
    expect(first.status).toBe(200);
    expect(first.body.data.depreciation_amount).toMatch(/^10000(\.0+)?$/);
    const second = await makeRequest('POST', `/api/assets/${id}/depreciate`, { period_id: open.id, period_months: 1 }, admin);
    expect(second.status).toBeGreaterThanOrEqual(400);
    const again = await Promise.all([1, 2].map(() => makeRequest('POST', `/api/assets/${id}/depreciate`, { period_id: open.id, period_months: 1 }, admin)));
    expect(again.every((r) => r.status >= 400)).toBe(true);
    const row = (await db.query(`SELECT accumulated_depreciation::text AS a FROM fixed_assets WHERE id = $1`, [id])).rows[0];
    expect(Number(row.a)).toBe(10000);
  });

  it('procurement: an approved PO cannot be received twice (no double stock / GRNI)', async () => {
    const vendor = (await makeRequest('GET', '/api/parties?type=VENDOR', undefined, admin)).body.data[0];
    const item = (await makeRequest('GET', '/api/items', undefined, admin)).body.data.find((i: any) => i.item_type === 'INVENTORY');
    const po = await makeRequest('POST', '/api/procurement/orders', { party_id: vendor.id, po_date: '2026-03-20', expected_date: '2026-03-28', lines: [{ item_id: item.id, quantity: '3', unit_price: '100.00' }] }, controller);
    expect(po.status).toBe(201);
    expect((await makeRequest('POST', `/api/procurement/orders/${po.body.data.id}/approve`, {}, admin)).status).toBe(200);
    const rs = await Promise.all([1, 2].map(() => makeRequest('POST', `/api/procurement/orders/${po.body.data.id}/receive`, {}, controller)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const third = await makeRequest('POST', `/api/procurement/orders/${po.body.data.id}/receive`, {}, controller);
    expect(third.status).toBeGreaterThanOrEqual(400);
    const mv = await db.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE reference_id = $1`, [po.body.data.id]);
    expect(mv.rows[0].n).toBe(1);
  });

  it('GET endpoints never mutate state (audit log, sequences, outbox unchanged)', async () => {
    const snapshot = async () => {
      const r = await db.query(
        `SELECT (SELECT COUNT(*) FROM audit_logs)::int AS audit, (SELECT COALESCE(SUM(last_value),0) FROM document_sequences)::int AS seq,
                (SELECT COUNT(*) FROM outbox_events)::int AS outbox, (SELECT COUNT(*) FROM journals)::int AS journals,
                (SELECT COUNT(*) FROM automation_rules)::int AS rules`,
      );
      return r.rows[0];
    };
    const before = await snapshot();
    const paths = [
      '/api/coa/accounts', '/api/coa/tree', '/api/journals', '/api/ledger/trial-balance?as_of_date=2026-12-31', '/api/periods', '/api/parties', '/api/items',
      '/api/sales/orders', '/api/ar/invoices', '/api/ar/aging', '/api/procurement/orders', '/api/ap/invoices', '/api/payments', '/api/fx/rates',
      '/api/treasury/statements', '/api/inventory/stock', '/api/inventory/warehouses', '/api/inventory/transfers', '/api/inventory/counts',
      '/api/manufacturing/boms', '/api/manufacturing/work-orders', '/api/assets', '/api/assets/categories', '/api/hrm/employees', '/api/hrm/payroll-runs',
      '/api/projects', '/api/quality/lots', '/api/maintenance/equipment', '/api/maintenance/work-orders', '/api/audit/logs', '/api/orgs/context',
      '/api/automation/rules', '/api/automation/alerts', '/api/automation/runs', '/api/automation/recurring-journals', '/api/onboarding/profile', '/api/auth/me',
    ];
    const statuses: Record<string, number> = {};
    for (const p of paths) statuses[p] = (await makeRequest('GET', p, undefined, admin)).status;
    expect(Object.values(statuses).every((s) => s < 500), JSON.stringify(statuses)).toBe(true);
    expect(await snapshot()).toEqual(before);
  });
});
