import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { checkResidual, rating, score } from '../src/routes/grc.js';

describe('GRC pure rules', () => {
  it('scores, ratings and residual ≤ inherent', () => {
    expect(score(4, 5)).toBe(20);
    expect([rating(4), rating(6), rating(12), rating(20)]).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    expect(() => checkResidual(2, 2, 3, 3)).toThrow(/exceed/);
    expect(() => checkResidual(3, 3, 2, null)).toThrow(/both/);
    expect(() => checkResidual(3, 3, 2, 2)).not.toThrow();
  });
});

describe('GRC API', () => {
  let ctrl: string;
  let auditor: string;
  let viewer: string;
  let admin: string;
  beforeAll(async () => {
    await bootstrap();
    [ctrl, auditor, viewer, admin] = await Promise.all(['controller', 'auditor', 'viewer', 'admin'].map((u) => login(`${u}@omnysync.internal`)));
  });

  it('permissions: auditor reads, cannot write; viewer blocked; residual validation', async () => {
    const list = await makeRequest('GET', '/api/grc/risks', undefined, auditor);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(5);
    expect(list.body.data[0].inherent_score).toBeGreaterThanOrEqual(list.body.data[1].inherent_score); // sorted by score
    expect((await makeRequest('POST', '/api/grc/risks', { title: 'x', category: 'IT', likelihood: 2, impact: 2 }, auditor)).status).toBe(403);
    expect((await makeRequest('GET', '/api/grc/risks', undefined, viewer)).status).toBe(403);
    expect((await makeRequest('POST', '/api/grc/risks', { title: 'x', category: 'IT', likelihood: 6, impact: 2 }, ctrl)).status).toBe(400);
    const r = await makeRequest('POST', '/api/grc/risks', { title: 'x', category: 'IT', likelihood: 2, impact: 2, residual_likelihood: 3, residual_impact: 3 }, ctrl);
    expect(r.status).toBe(400);
    expect(r.body.error.details.field).toBe('residual_likelihood');
  });

  it('acceptance respects risk appetite; re-scoring an accepted risk re-opens it', async () => {
    const hi = (await makeRequest('POST', '/api/grc/risks', { title: 'Compressor supplier insolvency', category: 'STRATEGIC', likelihood: 3, impact: 4 }, ctrl)).body.data;
    const a = await makeRequest('POST', `/api/grc/risks/${hi.id}/accept`, { acceptance_note: 'ok' }, ctrl);
    expect(a.status).toBe(409);
    expect(a.body.error.details).toMatchObject({ score: 12, appetite: 8 });
    expect((await makeRequest('POST', `/api/grc/risks/${hi.id}/accept`, {}, ctrl)).status).toBe(400); // note required
    const cur = (await makeRequest('GET', `/api/grc/risks/${hi.id}`, undefined, ctrl)).body.data;
    await makeRequest('POST', `/api/grc/risks/${hi.id}/update`, { residual_likelihood: 2, residual_impact: 3, revision: cur.revision }, ctrl);
    const ok = await makeRequest('POST', `/api/grc/risks/${hi.id}/accept`, { acceptance_note: 'Dual-sourced; residual 6 within appetite' }, ctrl);
    expect(ok.body.data.status).toBe('ACCEPTED');
    const again = await makeRequest('POST', `/api/grc/risks/${hi.id}/update`, { residual_impact: 4, revision: ok.body.data.revision }, ctrl);
    expect(again.body.data.status).toBe('OPEN');
  });

  it('control tests: FAIL → deficient + incident; risk cannot close; PASS restores and schedules next', async () => {
    const risk = (await makeRequest('POST', '/api/grc/risks', { title: 'Van fuel card misuse', category: 'FINANCIAL', likelihood: 3, impact: 2 }, ctrl)).body.data;
    const c = (await makeRequest('POST', '/api/grc/controls', { title: 'Monthly fuel card statement review', risk_id: risk.id, control_type: 'DETECTIVE', frequency: 'MONTHLY' }, ctrl)).body.data;
    expect(c.status).toBe('DESIGN');
    expect((await makeRequest('POST', `/api/grc/controls/${c.id}/tests`, { result: 'PASS', evidence: '' }, ctrl)).status).toBe(400);
    expect((await makeRequest('POST', `/api/grc/controls/${c.id}/tests`, { result: 'PASS', evidence: 'Sampled 20', sample_size: 20, exceptions: 3 }, ctrl)).status).toBe(400); // >5%
    expect((await makeRequest('POST', `/api/grc/controls/${c.id}/tests`, { result: 'PASS', evidence: 'Sampled 20', sample_size: 2, exceptions: 3 }, ctrl)).status).toBe(400);
    expect((await makeRequest('POST', `/api/grc/controls/${c.id}/tests`, { result: 'PASS', evidence: 'future', test_date: '2099-01-01' }, ctrl)).status).toBe(400);
    expect((await makeRequest('POST', `/api/grc/controls/${c.id}/tests`, { result: 'PASS', evidence: 'x' }, auditor)).status).toBe(403);
    const f = await makeRequest('POST', `/api/grc/controls/${c.id}/tests`, { result: 'FAIL', evidence: 'August statement not reviewed', test_date: '2026-09-05' }, ctrl);
    expect(f.status).toBe(201);
    expect(f.body.data.incident.number).toMatch(/^INC/);
    expect((await db.query(`SELECT status FROM grc_controls WHERE id = $1`, [c.id])).rows[0].status).toBe('DEFICIENT');
    const cl = await makeRequest('POST', `/api/grc/risks/${risk.id}/close`, {}, ctrl);
    expect(cl.status).toBe(409);
    expect(cl.body.error.message).toContain(c.code);
    const p = await makeRequest('POST', `/api/grc/controls/${c.id}/tests`, { result: 'PASS', evidence: 'September statement reviewed, signed', sample_size: 30, exceptions: 1, test_date: '2026-09-28' }, ctrl);
    expect(p.status).toBe(201);
    const row = (await db.query(`SELECT status, next_test_due::text, last_result FROM grc_controls WHERE id = $1`, [c.id])).rows[0];
    expect(row).toEqual({ status: 'OPERATING', next_test_due: '2026-10-28', last_result: 'PASS' });
    // An older back-dated test does not overwrite the latest result.
    await makeRequest('POST', `/api/grc/controls/${c.id}/tests`, { result: 'FAIL', evidence: 'July sample (late entry)', test_date: '2026-07-10' }, ctrl);
    expect((await db.query(`SELECT status FROM grc_controls WHERE id = $1`, [c.id])).rows[0].status).toBe('OPERATING');
    expect((await makeRequest('POST', `/api/grc/risks/${risk.id}/close`, {}, ctrl)).body.data.status).toBe('CLOSED');
  });

  it('incidents: resolution needs root cause + action; closer must differ from reporter', async () => {
    expect((await makeRequest('POST', '/api/grc/incidents', { title: 'x', severity: 'LOW', occurred_on: '2099-01-01' }, ctrl)).status).toBe(400);
    const i = (await makeRequest('POST', '/api/grc/incidents', { title: 'R-410A leak at DHA site, technician dizziness', severity: 'HIGH', incident_type: 'SAFETY', occurred_on: '2026-09-20' }, ctrl)).body.data;
    expect((await makeRequest('POST', `/api/grc/incidents/${i.id}/resolve`, {}, ctrl)).status).toBe(400);
    expect((await makeRequest('POST', `/api/grc/incidents/${i.id}/resolve`, { root_cause: 'Flare nut not torqued', corrective_action: 'Torque wrench mandatory; toolbox talk' }, ctrl)).body.data.status).toBe('RESOLVED');
    expect((await makeRequest('POST', `/api/grc/incidents/${i.id}/close`, {}, ctrl)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await makeRequest('POST', `/api/grc/incidents/${i.id}/close`, {}, admin)).body.data.status).toBe('CLOSED');
    const s = await makeRequest('GET', '/api/grc/summary', undefined, auditor);
    expect(s.body.data.heatmap.flat().reduce((a: number, b: number) => a + b, 0)).toBe(s.body.data.open_risks);
    expect(s.body.data.appetite).toBe(8);
  });
});
