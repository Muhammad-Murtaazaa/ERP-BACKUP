import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { weightedScore } from '../src/routes/supplier.js';

describe('SUP pure rules', () => {
  it('weighted score 40/30/20/10 and grade bands', () => {
    expect(weightedScore({ quality: 90, delivery: 80, price: 70, service: 60 })).toEqual({ weighted_score: '80.00', grade: 'B' });
    expect(weightedScore({ quality: 85, delivery: 85, price: 85, service: 85 }).grade).toBe('A');
    expect(weightedScore({ quality: 49, delivery: 50, price: 50, service: 50 }).grade).toBe('D');
  });
});

describe('SUP API', () => {
  let admin: string;
  let controller: string;
  let viewer: string;
  let vendor: any;
  beforeAll(async () => {
    await bootstrap();
    [admin, controller, viewer] = await Promise.all(['admin', 'controller', 'viewer'].map((u) => login(`${u}@omnysync.internal`)));
    const r = await db.query(
      `INSERT INTO parties (id, organization_id, legal_entity_id, code, name, party_type) VALUES (gen_random_uuid(), '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'V-SUPTEST', 'Cool Parts Traders', 'VENDOR') RETURNING id`,
    );
    vendor = r.rows[0];
  });

  it('qualification: vendors only, one profile, certificates gate approval, submitter cannot approve', async () => {
    const cust = (await db.query(`SELECT id FROM parties WHERE party_type = 'CUSTOMER' LIMIT 1`)).rows[0];
    expect((await makeRequest('POST', '/api/sup/profiles', { party_id: cust.id, category: 'SPARE_PARTS' }, admin)).status).toBe(400);
    expect((await makeRequest('POST', '/api/sup/profiles', { party_id: vendor.id, category: 'SPARE_PARTS' }, viewer)).status).toBe(403);
    const p = await makeRequest('POST', '/api/sup/profiles', { party_id: vendor.id, category: 'SPARE_PARTS', required_certificates: ['NTN', 'STRN', 'INSURANCE'] }, admin);
    expect(p.status).toBe(201);
    expect((await makeRequest('POST', '/api/sup/profiles', { party_id: vendor.id, category: 'SPARE_PARTS' }, admin)).status).toBe(409);
    const id = p.body.data.id;
    expect((await makeRequest('POST', `/api/sup/profiles/${id}/submit`, {}, admin)).status).toBe(200);
    const sod = await makeRequest('POST', `/api/sup/profiles/${id}/approve`, {}, admin);
    expect(sod.body.error.code).toBe('SEGREGATION_OF_DUTIES');
    const missing = await makeRequest('POST', `/api/sup/profiles/${id}/approve`, {}, controller);
    expect(missing.status).toBe(409);
    expect(missing.body.error.details.missing).toEqual(['NTN', 'STRN', 'INSURANCE']);
    await makeRequest('POST', '/api/sup/certificates', { profile_id: id, cert_type: 'NTN', reference: 'NTN-1' }, admin);
    await makeRequest('POST', '/api/sup/certificates', { profile_id: id, cert_type: 'STRN', reference: 'STRN-1' }, admin);
    await makeRequest('POST', '/api/sup/certificates', { profile_id: id, cert_type: 'INSURANCE', reference: 'INS-1', issued_on: '2024-01-01', expires_on: '2025-01-01' }, admin);
    const expired = await makeRequest('POST', `/api/sup/profiles/${id}/approve`, {}, controller);
    expect(expired.body.error.details.missing).toEqual(['INSURANCE']); // expired certificate does not count
    expect((await makeRequest('POST', '/api/sup/certificates', { profile_id: id, cert_type: 'INSURANCE', reference: 'bad', issued_on: '2026-05-01', expires_on: '2026-04-01' }, admin)).status).toBe(400);
    await makeRequest('POST', '/api/sup/certificates', { profile_id: id, cert_type: 'INSURANCE', reference: 'INS-2', issued_on: '2026-01-01', expires_on: '2027-01-01' }, admin);
    const ok = await makeRequest('POST', `/api/sup/profiles/${id}/approve`, {}, controller);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');
  });

  it('procurement guard: a blocked supplier cannot receive purchase orders; reinstated goes back to review', async () => {
    const prof = (await db.query(`SELECT id FROM sup_profiles WHERE party_id = $1`, [vendor.id])).rows[0];
    const item = (await db.query(`SELECT id FROM items WHERE item_type = 'INVENTORY' LIMIT 1`)).rows[0];
    const po = { party_id: vendor.id, po_date: '2026-10-01', lines: [{ item_id: item.id, quantity: '1', unit_price: '100' }] };
    expect((await makeRequest('POST', '/api/procurement/orders', po, admin)).status).toBe(201);
    expect((await makeRequest('POST', `/api/sup/profiles/${prof.id}/block`, {}, controller)).status).toBe(400); // reason required
    expect((await makeRequest('POST', `/api/sup/profiles/${prof.id}/block`, { status_reason: 'Counterfeit compressors' }, controller)).status).toBe(200);
    const blocked = await makeRequest('POST', '/api/procurement/orders', po, admin);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Counterfeit/);
    const re = await makeRequest('POST', `/api/sup/profiles/${prof.id}/reinstate`, { status_reason: 'Audit passed' }, controller);
    expect(re.body.data.status).toBe('UNDER_REVIEW');
  });

  it('scorecards: one per period, weighted server-side, delivery derived from receipts when omitted, final is locked', async () => {
    const prof = (await db.query(`SELECT id FROM sup_profiles WHERE party_id = $1`, [vendor.id])).rows[0];
    expect((await makeRequest('POST', '/api/sup/scorecards', { profile_id: prof.id, period: '2026-13', quality_score: 90, delivery_score: 80, price_score: 70, service_score: 60 }, admin)).status).toBe(400);
    const noData = await makeRequest('POST', '/api/sup/scorecards', { profile_id: prof.id, period: '2026-07', quality_score: 90, price_score: 70, service_score: 60 }, admin);
    expect(noData.status).toBe(400);
    expect(noData.body.error.details.field).toBe('delivery_score');
    const sc = await makeRequest('POST', '/api/sup/scorecards', { profile_id: prof.id, period: '2026-09', quality_score: 90, delivery_score: 80, price_score: 70, service_score: 60, weighted_score: '100' }, admin);
    expect(sc.status).toBe(201);
    expect(sc.body.data).toMatchObject({ weighted_score: '80.00', grade: 'B' }); // client-supplied score ignored
    expect((await makeRequest('POST', '/api/sup/scorecards', { profile_id: prof.id, period: '2026-09', quality_score: 1, delivery_score: 1, price_score: 1, service_score: 1 }, admin)).status).toBe(409);
    const upd = await makeRequest('POST', `/api/sup/scorecards/${sc.body.data.id}/update`, { revision: 1, quality_score: 100 }, admin);
    expect(upd.body.data.weighted_score).toBe('84.00');
    await makeRequest('POST', `/api/sup/scorecards/${sc.body.data.id}/finalise`, {}, admin);
    expect((await makeRequest('POST', `/api/sup/scorecards/${sc.body.data.id}/update`, { revision: 3, quality_score: 10 }, admin)).status).toBe(409);
    const sum = (await makeRequest('GET', '/api/sup/summary', undefined, controller)).body.data;
    expect(sum.certificates.expired).toBeGreaterThanOrEqual(1);
  });

  it('price score: derived from PO prices vs the 12-month market price for the same items when omitted', async () => {
    const { priceScoreFromIndex } = await import('../src/routes/supplier.js');
    expect([priceScoreFromIndex(0.9), priceScoreFromIndex(1), priceScoreFromIndex(1.1), priceScoreFromIndex(1.6)]).toEqual([100, 100, 80, 0]);
    const prof = (await db.query(`SELECT id FROM sup_profiles WHERE party_id = $1`, [vendor.id])).rows[0];
    const other = (await db.query(
      `INSERT INTO parties (id, organization_id, legal_entity_id, code, name, party_type) VALUES (gen_random_uuid(), '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'V-SUPCHEAP', 'Budget Coils', 'VENDOR') RETURNING id`,
    )).rows[0];
    const item = (await makeRequest('POST', '/api/items', { code: 'COIL-PX', name: 'Evaporator coil', item_type: 'INVENTORY', uom: 'EA', unit_price: '200', unit_cost: '100' }, admin)).body.data;
    const buy = async (party: string, price: string) => {
      const po = await makeRequest('POST', '/api/procurement/orders', { party_id: party, po_date: '2026-08-10', lines: [{ item_id: item.id, quantity: '10', unit_price: price }] }, controller);
      expect(po.status).toBe(201);
      expect((await makeRequest('POST', `/api/procurement/orders/${po.body.data.id}/approve`, {}, admin)).status).toBe(200);
    };
    await buy(vendor.id, '110');
    await buy(other.id, '90');
    // Draft POs are ignored by the benchmark.
    await makeRequest('POST', '/api/procurement/orders', { party_id: other.id, po_date: '2026-08-11', lines: [{ item_id: item.id, quantity: '100', unit_price: '1' }] }, controller);
    const sc = await makeRequest('POST', '/api/sup/scorecards', { profile_id: prof.id, period: '2026-08', quality_score: 90, delivery_score: 80, service_score: 70 }, admin);
    expect(sc.status).toBe(201);
    expect(Number(sc.body.data.price_index)).toBe(1.1); // 1100 paid vs 1000 at the market average of 100
    expect(sc.body.data.price_score).toBe(80);
    // A month with no purchases needs a manual price score.
    const none = await makeRequest('POST', '/api/sup/scorecards', { profile_id: prof.id, period: '2026-05', quality_score: 90, delivery_score: 80, service_score: 70 }, admin);
    expect(none.status).toBe(400);
    expect(none.body.error.details?.field ?? none.body.error.field).toBe('price_score');
  });

  it('quality score: derived from receiving inspections on the supplier’s POs (qty-weighted usage decisions) when omitted', async () => {
    const prof = (await db.query(`SELECT id FROM sup_profiles WHERE party_id = $1`, [vendor.id])).rows[0];
    const item = (await makeRequest('POST', '/api/items', { code: 'VALVE-QM', name: 'Expansion valve', item_type: 'INVENTORY', uom: 'EA', unit_price: '50', unit_cost: '30' }, admin)).body.data;
    const other = (await makeRequest('POST', '/api/items', { code: 'FILTER-QM', name: 'Drier filter', item_type: 'INVENTORY', uom: 'EA', unit_price: '50', unit_cost: '30' }, admin)).body.data;
    expect((await makeRequest('POST', '/api/quality/plans', { plan_code: 'QP-VALVE', name: 'Valve leak test', item_id: item.id, inspection_type: 'RECEIVING', sample_size: '2', params: [{ param_name: 'Leak rate', data_type: 'NUMERIC', min_tolerance: '0', max_tolerance: '5', uom: 'g/yr', is_mandatory: true }] }, admin)).status).toBe(201);
    const po = (await makeRequest('POST', '/api/procurement/orders', { party_id: vendor.id, po_date: '2026-10-01', lines: [{ item_id: item.id, quantity: '100', unit_price: '30' }] }, controller)).body.data;
    expect((await makeRequest('POST', '/api/quality/lots', { item_id: other.id, quantity: '10', purchase_order_id: po.id }, admin)).status).toBe(400); // item not on the PO
    expect((await makeRequest('POST', '/api/quality/lots', { item_id: item.id, quantity: '10', purchase_order_id: '00000000-0000-0000-0000-00000000dead' }, admin)).status).toBe(404);
    const lot = async (qty: string, leak: string) => {
      const l = await makeRequest('POST', '/api/quality/lots', { item_id: item.id, quantity: qty, purchase_order_id: po.id }, admin);
      expect(l.status).toBe(201);
      expect(l.body.data.party_id).toBe(vendor.id);
      return (await makeRequest('POST', `/api/quality/lots/${l.body.data.id}/inspect`, { results: [{ param_name: 'Leak rate', measured_numeric_value: leak }] }, admin)).body.data.status;
    };
    expect(await lot('60', '2')).toBe('ACCEPTED');
    expect(await lot('40', '9')).toBe('REJECTED');
    const period = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 7);
    await db.query(`DELETE FROM sup_scorecards WHERE profile_id = $1 AND period = $2`, [prof.id, period]);
    const sc = await makeRequest('POST', '/api/sup/scorecards', { profile_id: prof.id, period, delivery_score: 80, price_score: 70, service_score: 60 }, admin);
    expect(sc.status, JSON.stringify(sc.body)).toBe(201);
    expect([sc.body.data.quality_score, sc.body.data.inspected_lots, sc.body.data.rejected_lots]).toEqual([60, 2, 1]);
    // No decided inspections in a period → a manual quality score is required.
    const none = await makeRequest('POST', '/api/sup/scorecards', { profile_id: prof.id, period: '2026-04', delivery_score: 80, price_score: 70, service_score: 60 }, admin);
    expect(none.status).toBe(400);
    expect(none.body.error.details?.field ?? none.body.error.field).toBe('quality_score');
  });
});
