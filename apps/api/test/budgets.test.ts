import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { spreadEven, variance } from '../src/routes/budgets.js';

describe('EPM pure rules', () => {
  it('even spread puts rounding in December; variance sign is favourable-positive', () => {
    const s = spreadEven('1000');
    expect(s.slice(0, 11).every((m) => m === '83.33')).toBe(true);
    expect(s[11]).toBe('83.37');
    expect(variance('EXPENSE', '100', '80')).toMatchObject({ variance: '20.00', favourable: true, variance_pct: '20.0' });
    expect(variance('REVENUE', '100', '80')).toMatchObject({ variance: '-20.00', favourable: false });
    expect(variance('REVENUE', '0', '50').variance_pct).toBeNull();
  });
});

describe('EPM API', () => {
  let acct: string;
  let ctrl: string;
  let admin: string;
  let viewer: string;
  const acc: Record<string, string> = {};
  beforeAll(async () => {
    await bootstrap();
    [acct, ctrl, admin, viewer] = await Promise.all(['accountant', 'controller', 'admin', 'viewer'].map((u) => login(`${u}@omnysync.internal`)));
    for (const r of (await db.query(`SELECT code, id FROM accounts WHERE code IN ('411002','521002','111002','521011')`)).rows) acc[r.code] = r.id;
  });

  it('seeded budget, lines validation, submit → approve with SoD, lock', async () => {
    const list = (await makeRequest('GET', '/api/epm/budgets', undefined, acct)).body.data;
    expect(list.find((b: any) => b.code === 'FY2026-OPS')).toBeTruthy();
    expect((await makeRequest('GET', '/api/epm/budgets', undefined, viewer)).status).toBe(403);
    const b = (await makeRequest('POST', '/api/epm/budgets', { code: 'T-2026', name: 'Test', fiscal_year: 2026 }, acct)).body.data;
    expect((await makeRequest('POST', '/api/epm/budgets', { code: 'T-2026', name: 'Dup', fiscal_year: 2026 }, acct)).body.error.code).toBe('DUPLICATE_RESOURCE');
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/submit`, {}, acct)).status).toBe(400); // no lines
    const bs = await makeRequest('POST', `/api/epm/budgets/${b.id}/lines`, { lines: [{ account_id: acc['111002'], annual: '1000' }] }, acct);
    expect(bs.status).toBe(400); // balance-sheet account refused
    expect(bs.body.error.details.field).toBe('lines[0].account_id');
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/lines`, { lines: [{ account_id: acc['521002'], months: [1, 2, 3] }] }, acct)).status).toBe(400);
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/lines`, { lines: [{ account_id: acc['521002'], annual: '-5' }] }, acct)).status).toBe(400);
    const put = await makeRequest('POST', `/api/epm/budgets/${b.id}/lines`, { lines: [{ account_id: acc['521002'], annual: '1200000' }, { account_id: acc['411002'], months: Array(12).fill('500000') }] }, acct);
    expect(put.status).toBe(200);
    const d = (await makeRequest('GET', `/api/epm/budgets/${b.id}`, undefined, acct)).body.data;
    expect(d.lines.length).toBe(24);
    expect(Number(d.total_amount)).toBe(7200000);
    // SoD: controller submits, controller cannot approve own submission.
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/submit`, {}, ctrl)).status).toBe(200);
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/lines`, { lines: [{ account_id: acc['521002'], annual: '1' }] }, acct)).body.error.code).toBe('BUDGET_LOCKED');
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/approve`, {}, acct)).status).toBe(403); // no approve permission
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/approve`, {}, ctrl)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/approve`, {}, admin)).body.data.status).toBe('APPROVED');
    const cur = (await makeRequest('GET', `/api/epm/budgets/${b.id}`, undefined, acct)).body.data;
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/update`, { name: 'x', revision: cur.revision }, acct)).status).toBe(409);
  });

  it('revise opens v2 with copied lines; approving v2 supersedes v1', async () => {
    const v1 = (await makeRequest('GET', '/api/epm/budgets?q=T-2026', undefined, acct)).body.data.find((b: any) => b.version === 1);
    const r = await makeRequest('POST', `/api/epm/budgets/${v1.id}/revise`, {}, acct);
    expect(r.status).toBe(201);
    expect(r.body.data.version).toBe(2);
    expect((await makeRequest('POST', `/api/epm/budgets/${v1.id}/revise`, {}, acct)).status).toBe(409); // v2 already open
    const v2 = r.body.data;
    expect((await db.query(`SELECT COUNT(*)::int n FROM epm_budget_lines WHERE budget_id = $1`, [v2.id])).rows[0].n).toBe(24);
    await makeRequest('POST', `/api/epm/budgets/${v2.id}/lines`, { lines: [{ account_id: acc['521011'], annual: '240000' }] }, acct);
    await makeRequest('POST', `/api/epm/budgets/${v2.id}/submit`, {}, acct);
    expect((await makeRequest('POST', `/api/epm/budgets/${v2.id}/approve`, {}, ctrl)).body.data.status).toBe('APPROVED');
    expect((await db.query(`SELECT status FROM epm_budgets WHERE id = $1`, [v1.id])).rows[0].status).toBe('SUPERSEDED');
  });

  it('budget vs actual reads posted journals only and flags unbudgeted spend', async () => {
    const v2 = (await makeRequest('GET', '/api/epm/budgets?q=T-2026', undefined, acct)).body.data.find((b: any) => b.version === 2);
    const r = await makeRequest('GET', `/api/epm/budgets/${v2.id}/variance?through_month=12`, undefined, acct);
    expect(r.status).toBe(200);
    const sal = r.body.data.rows.find((x: any) => x.code === '521002');
    expect(Number(sal.budget)).toBe(1200000);
    // Cross-check actuals directly against the ledger.
    const led = (await db.query(`SELECT COALESCE(SUM(jl.base_debit - jl.base_credit),0)::text v FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE a.code = '521002' AND j.status = 'POSTED' AND j.posting_date BETWEEN '2026-01-01' AND '2026-12-31' AND j.organization_id = a.organization_id AND a.organization_id = $1`, [v2.organization_id])).rows[0].v;
    expect(Number(sal.actual)).toBeCloseTo(Number(led), 2);
    expect(Number(r.body.data.totals.profit_budget)).toBe(6000000 - 1200000 - 240000);
    expect(r.body.data.rows.filter((x: any) => x.unbudgeted).every((x: any) => Number(x.budget) === 0)).toBe(true);
    expect((await makeRequest('GET', `/api/epm/budgets/${v2.id}/variance?through_month=13`, undefined, acct)).status).toBe(400);
    const h = await makeRequest('GET', `/api/epm/budgets/${v2.id}/variance?through_month=6`, undefined, acct);
    expect(Number(h.body.data.rows.find((x: any) => x.code === '521002').budget)).toBe(600000);
  });

  it('PO budget control: expense lines vs approved budget − actuals − commitments; WARN flags, BLOCK refuses, OFF skips', async () => {
    const ex = (await db.query(
      `SELECT id FROM accounts a WHERE a.statement_class = 'EXPENSE' AND a.level = 4 AND a.is_active AND a.code <> '511001'
         AND NOT EXISTS (SELECT 1 FROM epm_budget_lines bl WHERE bl.account_id = a.id) AND NOT EXISTS (SELECT 1 FROM items i WHERE i.cogs_account_id = a.id) ORDER BY a.code LIMIT 1`,
    )).rows[0].id;
    const b = (await makeRequest('POST', '/api/epm/budgets', { code: 'PO-CTL', name: 'AC servicing subcontract', fiscal_year: 2026 }, acct)).body.data;
    await makeRequest('POST', `/api/epm/budgets/${b.id}/lines`, { lines: [{ account_id: ex, annual: '12000' }] }, acct);
    await makeRequest('POST', `/api/epm/budgets/${b.id}/submit`, {}, ctrl);
    expect((await makeRequest('POST', `/api/epm/budgets/${b.id}/approve`, {}, admin)).body.data.status).toBe('APPROVED');
    const item = (await makeRequest('POST', '/api/items', { code: 'SUBCON-AC', name: 'Subcontracted AC service', item_type: 'SERVICE', uom: 'JOB', unit_price: '0', unit_cost: '0', cogs_account_id: ex }, admin)).body.data;
    expect(item.id).toBeTruthy();
    const vendor = (await makeRequest('GET', '/api/parties?type=VENDOR', undefined, admin)).body.data[0];
    const po = async (amount: string) => (await makeRequest('POST', '/api/procurement/orders', { party_id: vendor.id, po_date: '2026-10-01', lines: [{ item_id: item.id, quantity: '1', unit_price: amount }] }, ctrl)).body.data.id;
    const setCtl = async (value: string) => {
      const cur = (await makeRequest('GET', '/api/config/settings', undefined, admin)).body.data.find((x: any) => x.key === 'epm.po_budget_control');
      expect((await makeRequest('POST', '/api/config/settings/epm.po_budget_control', { value, version: cur.version }, admin)).status).toBe(200);
    };
    // Within budget: approved, no warnings.
    const p1 = await makeRequest('POST', `/api/procurement/orders/${await po('8000')}/approve`, {}, admin);
    expect(p1.status).toBe(200);
    expect(p1.body.data.budget_warnings).toEqual([]);
    // 8000 committed; 5000 more exceeds 12000 → WARN (default) approves but flags the excess.
    const p2 = await makeRequest('POST', `/api/procurement/orders/${await po('5000')}/approve`, {}, admin);
    expect(p2.status).toBe(200);
    expect(p2.body.data.budget_warnings[0]).toMatchObject({ budget: '12000.00', committed: '8000.00', this_po: '5000.00', available: '4000.00', excess: '1000.00' });
    await setCtl('BLOCK');
    const id3 = await po('100');
    const p3 = await makeRequest('POST', `/api/procurement/orders/${id3}/approve`, {}, admin);
    expect(p3.status).toBe(409);
    expect(p3.body.error.code).toBe('BUDGET_EXCEEDED');
    expect((await db.query(`SELECT status FROM purchase_orders WHERE id = $1`, [id3])).rows[0].status).toBe('DRAFT');
    // Inventory lines are not budget-checked (they hit the balance sheet).
    const inv = (await db.query(`SELECT id FROM items WHERE item_type = 'INVENTORY' LIMIT 1`)).rows[0];
    const invPo = (await makeRequest('POST', '/api/procurement/orders', { party_id: vendor.id, po_date: '2026-10-01', lines: [{ item_id: inv.id, quantity: '1', unit_price: '999999' }] }, ctrl)).body.data.id;
    expect((await makeRequest('POST', `/api/procurement/orders/${invPo}/approve`, {}, admin)).status).toBe(200);
    await setCtl('OFF');
    expect((await makeRequest('POST', `/api/procurement/orders/${id3}/approve`, {}, admin)).status).toBe(200);
  });
});
