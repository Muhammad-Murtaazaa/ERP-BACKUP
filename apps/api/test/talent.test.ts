import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { splitName } from '../src/routes/talent.js';

const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

describe('TAL pure rules', () => {
  it('splits names for the employee record', () => {
    expect(splitName('Ahmed Raza')).toEqual({ first: 'Ahmed', last: 'Raza' });
    expect(splitName('  Muhammad Ali  Khan ')).toEqual({ first: 'Muhammad Ali', last: 'Khan' });
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: '-' });
  });
});

describe('TAL API', () => {
  let hr: string;
  let admin: string;
  let viewer: string;
  let auditor: string;
  beforeAll(async () => {
    await bootstrap();
    [hr, admin, viewer, auditor] = await Promise.all(['hr', 'admin', 'viewer', 'auditor'].map((u) => login(`${u}@omnysync.internal`)));
  });

  const openReq = async (positions = 1) => {
    const r = (await makeRequest('POST', '/api/tal/requisitions', { title: 'Senior HVAC Technician', department: 'Field Service', positions, salary_min: '70000', salary_max: '90000' }, hr)).body.data;
    await makeRequest('POST', `/api/tal/requisitions/${r.id}/submit`, {}, hr);
    await makeRequest('POST', `/api/tal/requisitions/${r.id}/approve`, {}, admin);
    return r;
  };
  let n = 0;
  const cand = async () => (await makeRequest('POST', '/api/tal/candidates', { full_name: `Test Candidate${++n}`, email: `cand${n}.${Date.now()}@example.pk`, source: 'REFERRAL' }, hr)).body.data;
  const toInterview = async (reqId: string) => {
    const c = await cand();
    const a = (await makeRequest('POST', '/api/tal/applications', { requisition_id: reqId, candidate_id: c.id }, hr)).body.data;
    await makeRequest('POST', `/api/tal/applications/${a.id}/screen`, {}, hr);
    await makeRequest('POST', `/api/tal/applications/${a.id}/shortlist`, {}, hr);
    return a;
  };

  it('requisition approval SoD, band validation, applications only to open requisitions, duplicates', async () => {
    expect((await makeRequest('GET', '/api/tal/requisitions', undefined, viewer)).status).toBe(403);
    expect((await makeRequest('GET', '/api/tal/requisitions', undefined, auditor)).status).toBe(403);
    expect((await makeRequest('POST', '/api/tal/requisitions', { title: 'x', salary_min: '90000', salary_max: '80000' }, hr)).body.error.details.field).toBe('salary_max');
    const r = (await makeRequest('POST', '/api/tal/requisitions', { title: 'Dispatcher', salary_min: '50000', salary_max: '60000' }, hr)).body.data;
    const c = await cand();
    expect((await makeRequest('POST', '/api/tal/applications', { requisition_id: r.id, candidate_id: c.id }, hr)).status).toBe(409); // draft requisition
    await makeRequest('POST', `/api/tal/requisitions/${r.id}/submit`, {}, hr);
    expect((await makeRequest('POST', `/api/tal/requisitions/${r.id}/approve`, {}, hr)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await makeRequest('POST', `/api/tal/requisitions/${r.id}/approve`, {}, admin)).body.data.status).toBe('OPEN');
    expect((await makeRequest('POST', '/api/tal/applications', { requisition_id: r.id, candidate_id: c.id }, hr)).status).toBe(201);
    expect((await makeRequest('POST', '/api/tal/applications', { requisition_id: r.id, candidate_id: c.id }, hr)).body.error.code).toBe('DUPLICATE_RESOURCE');
    expect((await makeRequest('POST', '/api/tal/candidates', { full_name: 'Dup', email: c.email.toUpperCase() }, hr)).body.error.code).toBe('DUPLICATE_RESOURCE');
    expect((await makeRequest('POST', '/api/tal/candidates', { full_name: 'Bad', email: 'not-an-email' }, hr)).status).toBe(400);
  });

  it('interviews gate offers; band breach needs note; hire creates employee and fills seats', async () => {
    const r = await openReq(1);
    const a = await toInterview(r.id);
    expect((await makeRequest('POST', `/api/tal/applications/${a.id}/offer`, { offered_salary: '80000', offer_start_date: future(14) }, hr)).body.error.message).toMatch(/HIRE recommendation/);
    expect((await makeRequest('POST', `/api/tal/applications/${a.id}/interviews`, { interviewer: 'Service manager', score: 2, recommendation: 'HIRE' }, hr)).status).toBe(400);
    expect((await makeRequest('POST', `/api/tal/applications/${a.id}/interviews`, { interviewer: 'Service manager', score: 6, recommendation: 'HIRE' }, hr)).status).toBe(400);
    expect((await makeRequest('POST', `/api/tal/applications/${a.id}/interviews`, { interviewer: 'Service manager', round: 'PRACTICAL', score: 4, recommendation: 'HIRE', notes: 'Clean brazing, correct superheat' }, hr)).status).toBe(201);
    expect((await makeRequest('POST', `/api/tal/applications/${a.id}/offer`, { offered_salary: '120000', offer_start_date: future(14) }, hr)).body.error.details.field).toBe('offer_note');
    expect((await makeRequest('POST', `/api/tal/applications/${a.id}/offer`, { offered_salary: '80000', offer_start_date: '2020-01-01' }, hr)).status).toBe(400);
    const o = await makeRequest('POST', `/api/tal/applications/${a.id}/offer`, { offered_salary: '85000', offer_start_date: future(14) }, hr);
    expect(o.body.data.status).toBe('OFFER');
    const h = await makeRequest('POST', `/api/tal/applications/${a.id}/hire`, {}, hr);
    expect(h.status).toBe(200);
    expect(h.body.data.employee_id).toBeTruthy();
    const e = (await db.query(`SELECT employee_number, first_name, last_name, joining_date::text, status FROM employees WHERE id = $1`, [h.body.data.employee_id])).rows[0];
    expect(e.employee_number).toMatch(/^EMP-\d+$/);
    expect(e.joining_date).toBe(future(14));
    expect((await db.query(`SELECT status, filled FROM tal_requisitions WHERE id = $1`, [r.id])).rows[0]).toEqual({ status: 'FILLED', filled: 1 });
    // Requisition is filled: a second finalist cannot be offered (requisition not open).
    expect((await makeRequest('POST', '/api/tal/applications', { requisition_id: r.id, candidate_id: (await cand()).id }, hr)).status).toBe(409);
  });

  it('capacity: second hire beyond positions refused; final-round NO_HIRE blocks offers; cancel rejects pipeline', async () => {
    const r = await openReq(1);
    const a1 = await toInterview(r.id);
    const a2 = await toInterview(r.id);
    for (const a of [a1, a2]) {
      await makeRequest('POST', `/api/tal/applications/${a.id}/interviews`, { interviewer: 'Ops lead', score: 4, recommendation: 'HIRE' }, hr);
      await makeRequest('POST', `/api/tal/applications/${a.id}/offer`, { offered_salary: '75000', offer_start_date: future(10) }, hr);
    }
    expect((await makeRequest('POST', `/api/tal/applications/${a1.id}/hire`, {}, hr)).status).toBe(200);
    expect((await makeRequest('POST', `/api/tal/applications/${a2.id}/hire`, {}, hr)).body.error.code).toBe('CAPACITY_CONFLICT');
    const r2 = await openReq(2);
    const b = await toInterview(r2.id);
    await makeRequest('POST', `/api/tal/applications/${b.id}/interviews`, { interviewer: 'Tech lead', score: 4, recommendation: 'HIRE' }, hr);
    await makeRequest('POST', `/api/tal/applications/${b.id}/interviews`, { interviewer: 'GM', round: 'FINAL', score: 2, recommendation: 'NO_HIRE' }, hr);
    expect((await makeRequest('POST', `/api/tal/applications/${b.id}/offer`, { offered_salary: '75000', offer_start_date: future(10) }, hr)).body.error.message).toMatch(/Final-round/);
    expect((await makeRequest('POST', `/api/tal/requisitions/${r2.id}/cancel`, { hold_reason: 'Budget freeze' }, hr)).body.data.status).toBe('CANCELLED');
    expect((await db.query(`SELECT status FROM tal_applications WHERE id = $1`, [b.id])).rows[0].status).toBe('REJECTED');
    const s = await makeRequest('GET', '/api/tal/summary', undefined, hr);
    expect(s.body.data.hired).toBeGreaterThanOrEqual(2);
  });
});
