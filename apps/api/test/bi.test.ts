import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { DATASETS, validateWidgets, csvCell } from '../src/routes/bi.js';

describe('BI governed datasets & dashboards', () => {
  let admin: string;
  let viewer: string;
  let controller: string;
  beforeAll(async () => {
    await bootstrap();
    [admin, viewer, controller] = await Promise.all(['admin', 'viewer', 'controller'].map((u) => login(`${u}@omnysync.internal`)));
  });

  it('widget validation rejects unknown datasets, measures and chart types', () => {
    expect(() => validateWidgets([{ dataset: 'users; DROP TABLE users', chart: 'BAR' }])).toThrow(/unknown dataset/);
    expect(() => validateWidgets([{ dataset: 'ar_aging', chart: 'PIE' }])).toThrow(/chart/);
    expect(() => validateWidgets([{ dataset: 'ar_aging', chart: 'BAR', measure: 'password_hash' }])).toThrow(/no measure/);
    expect(validateWidgets([{ dataset: 'ar_aging', chart: 'BAR' }])[0].measure).toBe('outstanding');
  });

  it('every catalogue dataset executes for an admin and returns its declared columns', async () => {
    for (const d of DATASETS) {
      const r = await makeRequest('GET', `/api/bi/datasets/${d.code}/query?from=2026-01-01&to=2026-12-31`, undefined, admin);
      expect(r.status, d.code).toBe(200);
      for (const row of r.body.data.rows) for (const c of [d.dimension, ...d.measures]) expect(row, `${d.code}.${c}`).toHaveProperty(c);
    }
    expect((await makeRequest('GET', '/api/bi/datasets/ar_aging/query?from=2026-12-01&to=2026-01-01', undefined, admin)).status).toBe(400);
  });

  it('revenue dataset reconciles to the ledger', async () => {
    const r = (await makeRequest('GET', '/api/bi/datasets/revenue_by_month/query?from=2026-01-01&to=2026-12-31', undefined, admin)).body.data.rows;
    const total = r.reduce((a: number, x: any) => a + Number(x.revenue), 0);
    const gl = await db.query(`SELECT COALESCE(SUM(jl.base_credit - jl.base_debit),0)::text t FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.status IN ('POSTED','REVERSED') AND a.statement_class = 'REVENUE' AND j.posting_date BETWEEN '2026-01-01' AND '2026-12-31'`);
    expect(total).toBeCloseTo(Number(gl.rows[0].t), 2);
  });

  it('row-level governance: a shared dashboard hides widgets the viewer may not read; private dashboards are owner-only', async () => {
    const dash = (await makeRequest('GET', '/api/bi/dashboards?q=EXEC', undefined, viewer)).body.data[0];
    const view = (await makeRequest('GET', `/api/bi/dashboards/${dash.id}/render`, undefined, viewer)).body.data;
    const svc = view.widgets.find((w: any) => w.dataset === 'service_cases_by_status');
    expect(svc.forbidden).toBe(true);
    expect(svc.rows).toEqual([]);
    expect(view.widgets.find((w: any) => w.dataset === 'revenue_by_month').forbidden).toBeUndefined();
    expect((await makeRequest('GET', '/api/bi/datasets/service_cases_by_status/query', undefined, viewer)).status).toBe(403);
    expect((await makeRequest('POST', '/api/bi/dashboards', { code: 'V-1', name: 'x', widgets: [] }, viewer)).status).toBe(403);

    const mine = await makeRequest('POST', '/api/bi/dashboards', { code: 'CTRL-PRIVATE', name: 'My board', widgets: [{ dataset: 'ar_aging', chart: 'TABLE' }] }, controller);
    expect(mine.status).toBe(201);
    expect((await makeRequest('GET', `/api/bi/dashboards/${mine.body.data.id}/render`, undefined, controller)).status).toBe(200);
    expect((await makeRequest('GET', `/api/bi/dashboards/${mine.body.data.id}/render`, undefined, viewer)).status).toBe(404);
    const bad = await makeRequest('POST', `/api/bi/dashboards/${mine.body.data.id}/update`, { revision: 1, widgets: [{ dataset: 'nope', chart: 'BAR' }] }, controller);
    expect(bad.status).toBe(400);
    const notOwner = await makeRequest('POST', `/api/bi/dashboards/${dash.id}/update`, { revision: dash.revision, name: 'hijack' }, controller);
    expect(notOwner.status).toBe(403);
  });

  it('CSV cells neutralise spreadsheet formulas but keep negative numbers', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-1250.50')).toBe('-1250.50');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
  });
});
