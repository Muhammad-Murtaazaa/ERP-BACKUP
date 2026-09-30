import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';

describe('LOG API', () => {
  let admin: string;
  let accountant: string;
  let viewer: string;
  let auditor: string;
  let carriers: any[];
  let party: any;
  beforeAll(async () => {
    await bootstrap();
    [admin, accountant, viewer, auditor] = await Promise.all(['admin', 'accountant', 'viewer', 'auditor'].map((u) => login(`${u}@omnysync.internal`)));
    carriers = (await makeRequest('GET', '/api/log/carriers', undefined, admin)).body.data;
    party = (await db.query(`SELECT id FROM parties WHERE party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`)).rows[0];
  });

  it('shipment lifecycle: book needs unique tracking, POD mandatory, delivery cannot precede dispatch, events replay-safe', async () => {
    const tcs = carriers.find((c: any) => c.code === 'TCS');
    expect((await makeRequest('POST', '/api/log/shipments', { direction: 'OUTBOUND', origin: 'Lahore WH', destination: 'Karachi', party_id: party.id }, viewer)).status).toBe(403);
    const bad = await makeRequest('POST', '/api/log/shipments', { direction: 'OUTBOUND', origin: 'A', destination: 'B', planned_ship_date: '2026-10-05', promised_date: '2026-10-01' }, admin);
    expect(bad.status).toBe(400);
    const s = (await makeRequest('POST', '/api/log/shipments', { direction: 'OUTBOUND', origin: 'Lahore WH', destination: 'DHA Karachi', party_id: party.id, promised_date: '2026-12-31', freight_amount: '3500' }, admin)).body.data;
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/dispatch`, {}, admin)).status).toBe(409); // not booked
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/book`, { tracking_number: 'TCS-1001' }, admin)).status).toBe(400); // no carrier
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/book`, { carrier_id: tcs.id, tracking_number: 'TCS 1001; DROP' }, admin)).status).toBe(400);
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/book`, { carrier_id: tcs.id, tracking_number: 'TCS-1001' }, admin)).status).toBe(200);
    const s2 = (await makeRequest('POST', '/api/log/shipments', { direction: 'OUTBOUND', origin: 'Lahore WH', destination: 'Multan', party_id: party.id }, admin)).body.data;
    const dup = await makeRequest('POST', `/api/log/shipments/${s2.id}/book`, { carrier_id: tcs.id, tracking_number: 'TCS-1001' }, admin);
    expect(dup.status).toBe(409);
    const shippedAt = new Date(Date.now() - 6 * 3600000).toISOString();
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/dispatch`, { shipped_at: shippedAt }, admin)).status).toBe(200);
    const evAt = new Date(Date.now() - 3 * 3600000).toISOString();
    const e1 = await makeRequest('POST', `/api/log/shipments/${s.id}/events`, { event_at: evAt, code: 'AT_HUB', location: 'Sukkur hub', source: 'CARRIER' }, admin);
    const e2 = await makeRequest('POST', `/api/log/shipments/${s.id}/events`, { event_at: evAt, code: 'AT_HUB', location: 'Sukkur hub', source: 'CARRIER' }, admin);
    expect(e1.status).toBe(201);
    expect(e2.status).toBe(200);
    expect(e2.body.data.replayed).toBe(true);
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/events`, { event_at: new Date(Date.now() + 86400000).toISOString(), code: 'AT_HUB' }, admin)).status).toBe(400);
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/events`, { event_at: evAt, code: 'DELIVERED' }, admin)).status).toBe(400); // must use deliver (POD)
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/deliver`, {}, admin)).status).toBe(400);
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/deliver`, { pod_name: 'Guard', delivered_at: new Date(Date.now() - 7 * 3600000).toISOString() }, admin)).status).toBe(400);
    const del = await makeRequest('POST', `/api/log/shipments/${s.id}/deliver`, { pod_name: 'Mr. Aslam (site supervisor)' }, admin);
    expect(del.status).toBe(200);
    const detail = (await makeRequest('GET', `/api/log/shipments/${s.id}`, undefined, admin)).body.data;
    expect(new Set(detail.events.map((e: any) => e.code))).toEqual(new Set(['BOOKED', 'PICKED_UP', 'AT_HUB', 'DELIVERED']));
    expect(detail.events.filter((e: any) => e.code === 'AT_HUB')).toHaveLength(1);
    expect(detail.on_time).toBe(true);
    expect(detail.tracking_url).toBe('https://www.tcsexpress.com/track/TCS-1001');
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/cancel`, {}, admin)).status).toBe(409);

    // Freight posts once, to accrued freight when the carrier has no vendor account.
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/post-freight`, {}, admin)).status).toBe(200); // admin holds LOGISTICS_POST
    const again = await makeRequest('POST', `/api/log/shipments/${s.id}/post-freight`, {}, accountant);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_BILLED');
    const j = await db.query(`SELECT a.code, jl.base_debit::text d, jl.base_credit::text c FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.source_key = $1 ORDER BY a.code`, [`LOG_FREIGHT:${s.id}`]);
    expect(j.rows.map((r: any) => [r.code, Number(r.d), Number(r.c)])).toEqual([['211003', 0, 3500], ['521012', 3500, 0]]);
  });

  it('freight to a vendor carrier credits AP with the party; zero freight refused; linked-order direction rules', async () => {
    const cargo = carriers.find((c: any) => c.code === 'DAEWOO-CARGO');
    const s = (await makeRequest('POST', '/api/log/shipments', { direction: 'INBOUND', origin: 'Karachi port', destination: 'Lahore WH', carrier_id: cargo.id, freight_amount: '0' }, admin)).body.data;
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/book`, { tracking_number: 'DW-77' }, admin)).status).toBe(200);
    expect((await makeRequest('POST', `/api/log/shipments/${s.id}/post-freight`, {}, accountant)).status).toBe(400);
    const upd = await makeRequest('POST', `/api/log/shipments/${s.id}/update`, { revision: 2, freight_amount: '12000' }, admin);
    expect(upd.status).toBe(200);
    const p = await makeRequest('POST', `/api/log/shipments/${s.id}/post-freight`, {}, accountant);
    expect(p.status).toBe(200);
    const ap = await db.query(`SELECT jl.party_id FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id WHERE j.source_key = $1 AND a.code = '211001'`, [`LOG_FREIGHT:${s.id}`]);
    expect(ap.rows[0].party_id).toBe(cargo.party_id);
    const so = (await db.query(`SELECT id FROM sales_orders LIMIT 1`)).rows[0];
    if (so) expect((await makeRequest('POST', '/api/log/shipments', { direction: 'INBOUND', origin: 'a', destination: 'b', sales_order_id: so.id }, admin)).status).toBe(400);
    expect((await makeRequest('GET', '/api/log/summary', undefined, viewer)).status).toBe(403);
    const sum = (await makeRequest('GET', '/api/log/summary', undefined, auditor)).body.data;
    expect(sum.otd_pct).toBe('100.0');
  });
});
