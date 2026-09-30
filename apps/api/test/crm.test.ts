import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { normPhone, weightedForecast } from '../src/routes/crm.js';

describe('CRM pure rules', () => {
  it('phone normalisation collapses +92 / 0092 / 0 prefixes; forecast is exact', () => {
    expect(normPhone('+92 300 1234567')).toBe('3001234567');
    expect(normPhone('0300-1234567')).toBe('3001234567');
    expect(normPhone('0092-300-1234567')).toBe('3001234567');
    expect(normPhone('12')).toBeNull();
    expect(weightedForecast([{ amount: '100.10', probability: 25 }, { amount: '0.05', probability: 50 }])).toBe('25.05');
  });
});

describe('CRM API', () => {
  let sales: string;
  let admin: string;
  let tech: string;
  beforeAll(async () => {
    await bootstrap();
    [sales, admin, tech] = await Promise.all(['service', 'admin', 'tech'].map((u) => login(`${u}@omnysync.internal`)));
  });

  it('permissions: technician cannot see CRM', async () => {
    expect((await makeRequest('GET', '/api/crm/leads', undefined, tech)).status).toBe(403);
  });

  it('lead dedupe across email case and phone formats; contact channel required', async () => {
    const a = await makeRequest('POST', '/api/crm/leads', { name: 'Imran Khan', email: 'Imran.K@Example.pk', phone: '+92 345 1112223', estimated_value: '250000' }, sales);
    expect(a.status).toBe(201);
    const byEmail = await makeRequest('POST', '/api/crm/leads', { name: 'I. Khan', email: 'imran.k@example.pk ' }, sales);
    expect(byEmail.status).toBe(409);
    expect(byEmail.body.error.details.existing_id).toBe(a.body.data.id);
    const byPhone = await makeRequest('POST', '/api/crm/leads', { name: 'Imran', phone: '0345-1112223' }, sales);
    expect(byPhone.status).toBe(409);
    expect((await makeRequest('POST', '/api/crm/leads', { name: 'Nobody' }, sales)).status).toBe(400);
    expect((await makeRequest('POST', '/api/crm/leads', { name: 'Bad', email: 'not-an-email' }, sales)).status).toBe(400);
  });

  it('conversion: only qualified leads; creates customer + opportunity atomically; win fires the automation rule', async () => {
    const lead = (await makeRequest('POST', '/api/crm/leads', { name: 'Hassan Ali', company: 'Ali Heights', email: 'hassan@aliheights.example.pk', estimated_value: '1500000' }, sales)).body.data;
    const early = await makeRequest('POST', `/api/crm/leads/${lead.id}/convert`, { opportunity_name: 'x' }, sales);
    expect(early.status).toBe(409);
    await makeRequest('POST', `/api/crm/leads/${lead.id}/qualify`, {}, sales);
    const conv = await makeRequest('POST', `/api/crm/leads/${lead.id}/convert`, { opportunity_name: 'Ali Heights central plant' }, sales);
    expect(conv.status).toBe(200);
    expect(conv.body.data.status).toBe('CONVERTED');
    const { party_id, opportunity_id, customer_reused } = conv.body.data.result;
    expect(customer_reused).toBe(false);
    expect((await db.query(`SELECT name, party_type FROM parties WHERE id = $1`, [party_id])).rows[0]).toMatchObject({ name: 'Ali Heights', party_type: 'CUSTOMER' });
    expect((await makeRequest('POST', `/api/crm/leads/${lead.id}/convert`, { opportunity_name: 'again' }, sales)).status).toBe(409);

    const opp = (await makeRequest('GET', `/api/crm/opportunities/${opportunity_id}`, undefined, sales)).body.data;
    expect(Number(opp.amount)).toBe(1500000);
    const st = await makeRequest('POST', `/api/crm/opportunities/${opp.id}/stage`, { stage: 'PROPOSAL' }, sales);
    expect(st.body.data.probability).toBe(60);
    expect((await makeRequest('POST', `/api/crm/opportunities/${opp.id}/stage`, { stage: 'WON' }, sales)).status).toBe(400); // must use win
    const win = await makeRequest('POST', `/api/crm/opportunities/${opp.id}/win`, { create_install_case: true, site_address: 'Ali Heights, Lahore' }, sales);
    expect(win.status).toBe(200);
    expect(win.body.data.result.service_case_number).toMatch(/^SRV-/);
    expect((await makeRequest('POST', `/api/crm/opportunities/${opp.id}/lose`, { lost_reason: 'PRICE' }, sales)).status).toBe(409);
    await makeRequest('POST', '/api/automation/events/process', {}, admin);
    const task = await db.query(`SELECT * FROM automation_tasks WHERE title LIKE $1`, ['%Ali Heights central plant%']);
    expect(task.rows.length).toBe(1);
  });

  it('lost requires a reason (and notes for OTHER); stale edits refused; activities need a target', async () => {
    const party = (await db.query(`SELECT id FROM parties WHERE party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`)).rows[0];
    const o = (await makeRequest('POST', '/api/crm/opportunities', { name: 'Small job', party_id: party.id, amount: '50000' }, sales)).body.data;
    expect((await makeRequest('POST', `/api/crm/opportunities/${o.id}/lose`, {}, sales)).status).toBe(400);
    expect((await makeRequest('POST', `/api/crm/opportunities/${o.id}/lose`, { lost_reason: 'OTHER' }, sales)).status).toBe(400);
    const e1 = await makeRequest('POST', `/api/crm/opportunities/${o.id}/update`, { revision: 1, amount: '60000' }, sales);
    expect(e1.status).toBe(200);
    const stale = await makeRequest('POST', `/api/crm/opportunities/${o.id}/update`, { revision: 1, amount: '70000' }, sales);
    expect(stale.body.error.code).toBe('STALE_REVISION');
    expect((await makeRequest('POST', `/api/crm/opportunities/${o.id}/lose`, { lost_reason: 'COMPETITOR' }, sales)).status).toBe(200);
    expect((await makeRequest('POST', '/api/crm/activities', { activity_type: 'CALL', subject: 'Follow up' }, sales)).status).toBe(400);
    const act = await makeRequest('POST', '/api/crm/activities', { activity_type: 'SITE_VISIT', subject: 'Survey roof', opportunity_id: o.id, due_at: '2026-01-01T05:00:00Z' }, sales);
    expect(act.status).toBe(201);
    expect(act.body.data.party_id).toBe(party.id);
    expect((await makeRequest('POST', `/api/crm/activities/${act.body.data.id}/complete`, {}, sales)).status).toBe(400);
    const sum = (await makeRequest('GET', '/api/crm/summary', undefined, sales)).body.data;
    expect(sum.win_rate_pct).not.toBeNull();
    expect(sum.overdue_activities).toBeGreaterThanOrEqual(1);
    expect(sum.loss_reasons.find((r: any) => r.lost_reason === 'COMPETITOR')).toBeTruthy();
  });
});
