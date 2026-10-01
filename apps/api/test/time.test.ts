import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { leaveDays, timesheetTotals } from '../src/routes/time.js';

describe('TIM pure rules', () => {
  it('overtime is computed per day, cost exact; leave skips Sundays and holidays', () => {
    const t = timesheetTotals([{ work_date: '2026-09-28', hours: '6' }, { work_date: '2026-09-28', hours: '4' }, { work_date: '2026-09-29', hours: '7.5' }], '8', '1000');
    expect(t).toEqual({ total_hours: '17.50', overtime_hours: '2.00', cost_amount: '18500.00' }); // 15.5×1000 + 2×1.5×1000
    expect(leaveDays('2026-10-03', '2026-10-05')).toBe(2); // Sat, (Sun), Mon
    expect(leaveDays('2026-10-04', '2026-10-04')).toBe(0);
    expect(leaveDays('2026-10-05', '2026-10-06', ['2026-10-06'])).toBe(1);
  });
});

describe('TIM API', () => {
  let hr: string;
  let admin: string;
  let accountant: string;
  let tech: string;
  let viewer: string;
  let emp: any;
  let emp2: any;
  beforeAll(async () => {
    await bootstrap();
    [hr, admin, accountant, tech, viewer] = await Promise.all(['hr', 'admin', 'accountant', 'tech', 'viewer'].map((u) => login(`${u}@omnysync.internal`)));
    const emps = (await db.query(`SELECT id FROM employees ORDER BY employee_number LIMIT 2`)).rows;
    [emp, emp2] = emps;
  });

  it('timesheet: Monday week only, one per employee-week; overlap and out-of-week refused; totals with overtime', async () => {
    expect((await makeRequest('POST', '/api/time/timesheets', { employee_id: emp.id, week_start: '2026-09-29', cost_rate: '1000' }, hr)).status).toBe(400);
    const s = await makeRequest('POST', '/api/time/timesheets', { employee_id: emp.id, week_start: '2026-09-28', cost_rate: '1000' }, hr);
    expect(s.status).toBe(201);
    expect((await makeRequest('POST', '/api/time/timesheets', { employee_id: emp.id, week_start: '2026-09-28', cost_rate: '1000' }, hr)).status).toBe(409);
    const id = s.body.data.id;
    const add = (b: any) => makeRequest('POST', `/api/time/timesheets/${id}/entries`, { activity: 'Install', ...b }, hr);
    expect((await add({ work_date: '2026-09-28', start_time: '08:00', end_time: '14:00' })).status).toBe(201);
    const ov = await add({ work_date: '2026-09-28', start_time: '13:30', end_time: '15:00' });
    expect(ov.status).toBe(409);
    expect(ov.body.error.code).toBe('OVERLAP_DETECTED');
    expect((await add({ work_date: '2026-09-28', start_time: '14:00', end_time: '18:00' })).status).toBe(201); // touching is fine
    expect((await add({ work_date: '2026-10-05', start_time: '09:00', end_time: '10:00' })).status).toBe(400);
    expect((await add({ work_date: '2026-09-29', start_time: '18:00', end_time: '09:00' })).status).toBe(400);
    expect((await add({ work_date: '2026-09-29', start_time: '25:00', end_time: '26:00' })).status).toBe(400);
    const last = await add({ work_date: '2026-09-29', start_time: '09:00', end_time: '16:30' });
    expect(last.body.data.totals).toEqual({ total_hours: '17.50', overtime_hours: '2.00', cost_amount: '18500.00' });

    // Maker-checker, locking, posting once.
    expect((await makeRequest('POST', `/api/time/timesheets/${id}/submit`, {}, viewer)).status).toBe(403);
    expect((await makeRequest('POST', `/api/time/timesheets/${id}/submit`, {}, hr)).status).toBe(200);
    expect((await add({ work_date: '2026-09-30', start_time: '09:00', end_time: '10:00' })).status).toBe(409);
    const sod = await makeRequest('POST', `/api/time/timesheets/${id}/approve`, {}, hr);
    expect(sod.status).toBe(403);
    expect(sod.body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await makeRequest('POST', `/api/time/timesheets/${id}/post`, {}, accountant)).status).toBe(409); // not approved yet
    expect((await makeRequest('POST', `/api/time/timesheets/${id}/approve`, {}, admin)).status).toBe(200);
    expect((await makeRequest('POST', `/api/time/timesheets/${id}/post`, {}, hr)).status).toBe(403); // HR has no TIME_POST
    const post = await makeRequest('POST', `/api/time/timesheets/${id}/post`, {}, accountant);
    expect(post.status).toBe(200);
    expect(post.body.data.status).toBe('POSTED');
    const j = await db.query(
      `SELECT a.code, SUM(jl.base_debit)::text d, SUM(jl.base_credit)::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.source_key = $1 GROUP BY a.code ORDER BY a.code`,
      [`TIM:${id}`],
    );
    expect(j.rows.map((r: any) => [r.code, Number(r.d), Number(r.c)])).toEqual([['211011', 0, 18500], ['511004', 18500, 0]]);
    expect((await makeRequest('POST', `/api/time/timesheets/${id}/post`, {}, accountant)).status).toBe(409);
  });

  it('closed period blocks timesheet posting (period guard)', async () => {
    const s = (await makeRequest('POST', '/api/time/timesheets', { employee_id: emp2.id, week_start: '2026-09-21', cost_rate: '800' }, hr)).body.data;
    await makeRequest('POST', `/api/time/timesheets/${s.id}/entries`, { work_date: '2026-09-22', start_time: '09:00', end_time: '17:00', activity: 'Maintenance' }, hr);
    await makeRequest('POST', `/api/time/timesheets/${s.id}/submit`, {}, hr);
    await makeRequest('POST', `/api/time/timesheets/${s.id}/approve`, {}, admin);
    const r = await makeRequest('POST', `/api/time/timesheets/${s.id}/post`, { posting_date: '2019-01-15' }, accountant);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await db.query(`SELECT status FROM tim_timesheets WHERE id = $1`, [s.id])).rows[0].status).toBe('APPROVED'); // atomic: no half-post
  });

  it('leave: working days counted, overlaps and already-logged days refused, approval SoD, no time on approved leave', async () => {
    const l = await makeRequest('POST', '/api/time/leave', { employee_id: emp2.id, leave_type: 'ANNUAL', start_date: '2026-10-10', end_date: '2026-10-12' }, hr);
    expect(l.status).toBe(201);
    expect(Number(l.body.data.days)).toBe(2); // Sat 10, Sun 11 off, Mon 12
    expect((await makeRequest('POST', '/api/time/leave', { employee_id: emp2.id, leave_type: 'SICK', start_date: '2026-10-12', end_date: '2026-10-13' }, hr)).body.error.code).toBe('OVERLAP_DETECTED');
    expect((await makeRequest('POST', '/api/time/leave', { employee_id: emp.id, leave_type: 'CASUAL', start_date: '2026-09-28', end_date: '2026-09-28' }, hr)).body.error.code).toBe('OVERLAP_DETECTED'); // time logged
    expect((await makeRequest('POST', '/api/time/leave', { employee_id: emp2.id, leave_type: 'CASUAL', start_date: '2026-10-18', end_date: '2026-10-18' }, hr)).status).toBe(400); // Sunday only
    expect((await makeRequest('POST', `/api/time/leave/${l.body.data.id}/approve`, {}, hr)).status).toBe(403);
    expect((await makeRequest('POST', `/api/time/leave/${l.body.data.id}/approve`, {}, admin)).status).toBe(200);
    const s = (await makeRequest('POST', '/api/time/timesheets', { employee_id: emp2.id, week_start: '2026-10-12', cost_rate: '800' }, hr)).body.data;
    const onLeave = await makeRequest('POST', `/api/time/timesheets/${s.id}/entries`, { work_date: '2026-10-12', start_time: '09:00', end_time: '10:00', activity: 'x' }, hr);
    expect(onLeave.status).toBe(409);
    expect(onLeave.body.error.message).toMatch(/leave/);
    expect((await makeRequest('GET', '/api/time/summary', undefined, tech)).status).toBe(200);
  });

  it('self-service scope: a technician only sees and submits their own time and leave', async () => {
    const own = (await db.query(`SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id WHERE u.email = 'tech@omnysync.internal'`)).rows[0];
    expect(own).toBeTruthy();
    const other = (await db.query(`SELECT id FROM employees WHERE employee_number = 'EMP-101'`)).rows[0];
    const r = await makeRequest('POST', '/api/time/timesheets', { employee_id: other.id, week_start: '2026-10-05', cost_rate: '700' }, tech);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN_SCOPE');
    expect((await makeRequest('POST', '/api/time/leave', { employee_id: other.id, leave_type: 'CASUAL', start_date: '2026-10-20', end_date: '2026-10-20' }, tech)).body.error.code).toBe('FORBIDDEN_SCOPE');
    const mine = await makeRequest('POST', '/api/time/timesheets', { employee_id: own.id, week_start: '2026-10-05', cost_rate: '700' }, tech);
    expect(mine.status).toBe(201);
    expect((await makeRequest('POST', `/api/time/timesheets/${mine.body.data.id}/entries`, { work_date: '2026-10-06', start_time: '09:00', end_time: '13:00', activity: 'AC service' }, tech)).status).toBe(201);
    const list = (await makeRequest('GET', '/api/time/timesheets', undefined, tech)).body.data;
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((x: any) => x.employee_id === own.id)).toBe(true);
    const hrSheet = (await makeRequest('GET', '/api/time/timesheets', undefined, hr)).body.data.find((x: any) => x.employee_id !== own.id);
    expect(hrSheet).toBeTruthy();
    expect((await makeRequest('GET', `/api/time/timesheets/${hrSheet.id}`, undefined, tech)).status).toBe(404);
    expect((await makeRequest('POST', `/api/time/timesheets/${hrSheet.id}/entries`, { work_date: '2026-09-29', start_time: '09:00', end_time: '10:00' }, tech)).status).toBe(403);
    expect((await makeRequest('POST', `/api/time/timesheets/${hrSheet.id}/submit`, {}, tech)).status).toBe(404);
    // HR (approver) still sees everyone.
    expect((await makeRequest('GET', '/api/time/timesheets', undefined, hr)).body.data.some((x: any) => x.employee_id === own.id)).toBe(true);
  });
});
