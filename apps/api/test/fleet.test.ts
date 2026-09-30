import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { checkOdometer } from '../src/routes/fleet.js';

describe('FLT pure rules', () => {
  it('odometer must increase and cannot jump implausibly', () => {
    expect(checkOdometer(null, '100')).toBeNull();
    expect(checkOdometer('100.0', '350.5')!.toFixed(1)).toBe('250.5');
    expect(() => checkOdometer('100', '100')).toThrow(/greater/);
    expect(() => checkOdometer('100', '99.9')).toThrow(/greater/);
    expect(() => checkOdometer('100', '5000')).toThrow(/jump/);
  });
});

describe('FLT API', () => {
  let service: string;
  let accountant: string;
  let tech: string;
  let vans: any[];
  let techs: any[];
  beforeAll(async () => {
    await bootstrap();
    [service, accountant, tech] = await Promise.all(['service', 'accountant', 'tech'].map((u) => login(`${u}@omnysync.internal`)));
    vans = (await makeRequest('GET', '/api/flt/vehicles', undefined, service)).body.data;
    techs = (await makeRequest('GET', '/api/srv/technicians', undefined, service)).body.data;
  });

  it('assignments: vehicle and technician double-booking refused, maintenance blocks booking', async () => {
    const v1 = vans.find((v: any) => v.code === 'VAN-01');
    const v2 = vans.find((v: any) => v.code === 'VAN-02');
    const [t1, t2] = techs;
    const win = { start_at: '2026-11-10T04:00:00Z', end_at: '2026-11-10T12:00:00Z' };
    expect((await makeRequest('POST', '/api/flt/assignments', { vehicle_id: v1.id, technician_id: t1.id, ...win }, tech)).status).toBe(403);
    expect((await makeRequest('POST', '/api/flt/assignments', { vehicle_id: v1.id, technician_id: t1.id, ...win }, service)).status).toBe(201);
    const vClash = await makeRequest('POST', '/api/flt/assignments', { vehicle_id: v1.id, technician_id: t2.id, start_at: '2026-11-10T11:00:00Z', end_at: '2026-11-10T13:00:00Z' }, service);
    expect(vClash.body.error.code).toBe('CAPACITY_CONFLICT');
    const tClash = await makeRequest('POST', '/api/flt/assignments', { vehicle_id: v2.id, technician_id: t1.id, ...win }, service);
    expect(tClash.body.error.code).toBe('CAPACITY_CONFLICT');
    expect((await makeRequest('POST', '/api/flt/assignments', { vehicle_id: v1.id, technician_id: t2.id, start_at: '2026-11-10T12:00:00Z', end_at: '2026-11-10T14:00:00Z' }, service)).status).toBe(201);
    expect((await makeRequest('POST', `/api/flt/vehicles/${v2.id}/maintenance`, { status_note: 'Brake pads' }, service)).status).toBe(200);
    expect((await makeRequest('POST', '/api/flt/assignments', { vehicle_id: v2.id, technician_id: t2.id, start_at: '2026-11-11T04:00:00Z', end_at: '2026-11-11T05:00:00Z' }, service)).status).toBe(409);
    expect((await makeRequest('POST', `/api/flt/vehicles/${v1.id}/retire`, { status_note: 'x' }, service)).status).toBe(409); // future bookings
    expect((await makeRequest('POST', '/api/flt/vehicles', { code: 'VAN-09', registration: 'leb-21-4410', make_model: 'Dup' }, service)).status).toBe(409); // registration case-insensitive dup
  });

  it('fuel: monotonic odometer, km/l, posting once with period guard, void only before posting', async () => {
    const v = vans.find((x: any) => x.code === 'VAN-01');
    const back = await makeRequest('POST', '/api/flt/fuel', { vehicle_id: v.id, log_date: '2026-09-20', odometer_km: '48000', litres: '30', amount: '8400' }, service);
    expect(back.status).toBe(400); // below 48210 seed reading
    const f1 = await makeRequest('POST', '/api/flt/fuel', { vehicle_id: v.id, log_date: '2026-09-20', odometer_km: '48570', litres: '30', amount: '8400', station: 'PSO Gulberg' }, service);
    expect(f1.status).toBe(201);
    expect(f1.body.data.km_per_litre).toBe('12.00');
    expect((await makeRequest('POST', '/api/flt/fuel', { vehicle_id: v.id, log_date: '2026-09-19', odometer_km: '48900', litres: '10', amount: '2800' }, service)).status).toBe(400); // date before last fill
    const f2 = (await makeRequest('POST', '/api/flt/fuel', { vehicle_id: v.id, log_date: '2026-09-25', odometer_km: '48900', litres: '25', amount: '7000', paid_by: 'ACCOUNT' }, service)).body.data;
    expect((await makeRequest('POST', `/api/flt/fuel/${f1.body.data.id}/post`, {}, service)).status).toBe(403);
    const p = await makeRequest('POST', `/api/flt/fuel/${f1.body.data.id}/post`, {}, accountant);
    expect(p.status).toBe(200);
    expect((await makeRequest('POST', `/api/flt/fuel/${f1.body.data.id}/post`, {}, accountant)).status).toBe(409);
    expect((await makeRequest('POST', `/api/flt/fuel/${f1.body.data.id}/void`, { void_reason: 'x' }, service)).status).toBe(409);
    await makeRequest('POST', `/api/flt/fuel/${f2.id}/post`, {}, accountant);
    const j = await db.query(`SELECT a.code, SUM(jl.base_debit)::text d, SUM(jl.base_credit)::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.source_key = ANY($1) GROUP BY a.code ORDER BY a.code`, [[`FLT_FUEL:${f1.body.data.id}`, `FLT_FUEL:${f2.id}`]]);
    expect(j.rows.map((r: any) => [r.code, Number(r.d), Number(r.c)])).toEqual([['111001', 0, 8400], ['211003', 0, 7000], ['521011', 15400, 0]]);
    const veh = (await makeRequest('GET', `/api/flt/vehicles/${v.id}`, undefined, tech)).body.data;
    expect(Number(veh.odometer_km)).toBe(48900);
    expect(veh.fuel).toHaveLength(2);
  });
});
