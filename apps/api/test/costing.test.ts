import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrap, login, makeRequest, db } from './harness.js';
import { movingAverage, fifoConsume } from '../src/lib/stock.js';

describe('moving-average maths', () => {
  it('weights by quantity and resets when stock is not positive', () => {
    expect(Number(movingAverage('10', '100', '10', '130'))).toBe(115);
    expect(Number(movingAverage('30', '100', '10', '140'))).toBe(110);
    expect(Number(movingAverage('0', '100', '5', '90'))).toBe(90);
    expect(Number(movingAverage('-2', '100', '5', '90'))).toBe(90);
  });
});

describe('FIFO maths', () => {
  it('consumes oldest layers first and values any shortfall at the fallback cost', () => {
    const layers = [ { id: 'a', qty_remaining: '10', unit_cost: '100' }, { id: 'b', qty_remaining: '10', unit_cost: '130' } ];
    const r = fifoConsume(layers, '15', '999');
    expect(Number(r.value)).toBe(1650);
    expect(Number(r.unit_cost)).toBe(110);
    expect(r.takes.map((t) => [t.id, Number(t.quantity)])).toEqual([['a', 10], ['b', 5]]);
    const short = fifoConsume([{ id: 'a', qty_remaining: '2', unit_cost: '100' }], '3', '40');
    expect(Number(short.value)).toBe(240);
    expect(short.takes[1].id).toBeNull();
  });
});

describe('inventory costing method', () => {
  let admin: string;
  let controller: string;
  let vendor: any;
  let customer: any;
  beforeAll(async () => {
    await bootstrap();
    [admin, controller] = await Promise.all(['admin', 'controller'].map((u) => login(`${u}@omnysync.internal`)));
    vendor = (await makeRequest('GET', '/api/parties?type=VENDOR', undefined, admin)).body.data[0];
    customer = (await db.query(`SELECT id FROM parties WHERE party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`)).rows[0];
  });
  const newItem = async (code: string) => (await makeRequest('POST', '/api/items', { code, name: `Capacitor ${code}`, item_type: 'INVENTORY', uom: 'EA', unit_price: '500', unit_cost: '100' }, admin)).body.data;
  const receive = async (itemId: string, qty: string, price: string) => {
    const po = await makeRequest('POST', '/api/procurement/orders', { party_id: vendor.id, po_date: '2026-09-01', lines: [{ item_id: itemId, quantity: qty, unit_price: price }] }, controller);
    await makeRequest('POST', `/api/procurement/orders/${po.body.data.id}/approve`, {}, admin);
    const r = await makeRequest('POST', `/api/procurement/orders/${po.body.data.id}/receive`, { receipt_date: '2026-09-02' }, controller);
    expect(r.status).toBe(200);
  };
  const cost = async (id: string) => Number((await db.query(`SELECT unit_cost::text c FROM items WHERE id = $1`, [id])).rows[0].c);

  it('STANDARD (default) keeps the item cost on receipt', async () => {
    const it0 = await newItem('CAP-STD');
    await receive(it0.id, '10', '130');
    expect(await cost(it0.id)).toBe(100);
    expect((await db.query(`SELECT COUNT(*)::int n FROM item_cost_changes WHERE item_id = $1`, [it0.id])).rows[0].n).toBe(0);
  });

  it('MOVING_AVERAGE re-costs on receipt, and later issues (COGS) use the average', async () => {
    const r = await makeRequest('POST', '/api/config/settings/inventory.costing_method', { value: 'MOVING_AVERAGE', version: 0, reason: 'Volatile copper prices' }, admin);
    expect(r.status).toBe(200);
    const it1 = await newItem('CAP-MA');
    await receive(it1.id, '10', '100'); // no prior stock -> 100
    expect(await cost(it1.id)).toBe(100);
    await receive(it1.id, '10', '130'); // (10×100 + 10×130) / 20
    expect(await cost(it1.id)).toBe(115);
    const hist = (await db.query(`SELECT qty_before::text, old_cost::text, receipt_cost::text, new_cost::text FROM item_cost_changes WHERE item_id = $1 ORDER BY created_at`, [it1.id])).rows;
    expect(hist.map((h: any) => Number(h.new_cost))).toEqual([100, 115]);
    expect(Number(hist[1].qty_before)).toBe(10);
    // Ship 4 units: stock movement and COGS valued at 115.
    const so = await makeRequest('POST', '/api/sales/orders', { party_id: customer.id, order_date: '2026-09-03', lines: [{ item_id: it1.id, quantity: '4', unit_price: '500' }] }, controller);
    await makeRequest('POST', `/api/sales/orders/${so.body.data.id}/confirm`, {}, controller);
    const f = await makeRequest('POST', `/api/sales/orders/${so.body.data.id}/fulfill`, { shipment_date: '2026-09-03' }, admin);
    expect(f.status).toBe(200);
    const mv = (await db.query(`SELECT unit_cost::text c, total_value::text v FROM stock_movements WHERE item_id = $1 AND quantity < 0`, [it1.id])).rows[0];
    expect(Number(mv.c)).toBe(115);
    expect(Number(mv.v)).toBe(-460);
    // Remaining 16 @ 115 + 4 @ 160 -> (1840 + 640) / 20 = 124
    await receive(it1.id, '4', '160');
    expect(await cost(it1.id)).toBe(124);
  });

  it('FIFO: issues are valued at the oldest receipt layers and COGS posts the same value', async () => {
    const cur = (await makeRequest('GET', '/api/config/settings', undefined, admin)).body.data.find((x: any) => x.key === 'inventory.costing_method');
    const r = await makeRequest('POST', '/api/config/settings/inventory.costing_method', { value: 'FIFO', version: cur.version, reason: 'Auditor prefers FIFO' }, admin);
    expect(r.status).toBe(200);
    // Stock already on hand gets an OPENING layer at the current item cost.
    expect(r.body.data.fifo_layers.opened).toEqual(expect.arrayContaining([{ item: 'CAP-MA', quantity: '20.0000', unit_cost: '124.0000' }, { item: 'CAP-STD', quantity: '10.0000', unit_cost: '100.0000' }]));
    const it2 = await newItem('CAP-FIFO');
    await receive(it2.id, '10', '100');
    await receive(it2.id, '10', '130');
    expect(await cost(it2.id)).toBe(100); // FIFO does not re-cost the item master
    const ship = async (qty: string) => {
      const so = await makeRequest('POST', '/api/sales/orders', { party_id: customer.id, order_date: '2026-09-04', lines: [{ item_id: it2.id, quantity: qty, unit_price: '500' }] }, controller);
      await makeRequest('POST', `/api/sales/orders/${so.body.data.id}/confirm`, {}, controller);
      const f = await makeRequest('POST', `/api/sales/orders/${so.body.data.id}/fulfill`, { shipment_date: '2026-09-04' }, admin);
      expect(f.status).toBe(200);
      const debit = (await db.query(`SELECT COALESCE(SUM(debit_amount),0)::text d FROM journal_lines WHERE journal_id = $1`, [f.body.data.cogs_journal_id])).rows[0].d;
      const mv = (await db.query(`SELECT unit_cost::text c, total_value::text v FROM stock_movements WHERE reference_id = $1`, [so.body.data.id])).rows[0];
      return { debit: Number(debit), unit: Number(mv.c), value: Number(mv.v) };
    };
    const first = await ship('15'); // 10 × 100 + 5 × 130
    expect(first).toEqual({ debit: 1650, unit: 110, value: -1650 });
    const second = await ship('5'); // remaining 5 × 130
    expect(second).toEqual({ debit: 650, unit: 130, value: -650 });
    const layers = (await db.query(`SELECT unit_cost::text c, qty_remaining::text q FROM stock_cost_layers WHERE item_id = $1 ORDER BY seq`, [it2.id])).rows;
    expect(layers.map((l: any) => [Number(l.c), Number(l.q)])).toEqual([[100, 0], [130, 0]]);
    expect((await db.query(`SELECT COUNT(*)::int n FROM stock_layer_consumptions c JOIN stock_cost_layers l ON l.id = c.layer_id WHERE l.item_id = $1`, [it2.id])).rows[0].n).toBe(3);
    // Oversell is still refused (no layer or stock is touched).
    const so = await makeRequest('POST', '/api/sales/orders', { party_id: customer.id, order_date: '2026-09-04', lines: [{ item_id: it2.id, quantity: '1', unit_price: '500' }] }, controller);
    await makeRequest('POST', `/api/sales/orders/${so.body.data.id}/confirm`, {}, controller);
    expect((await makeRequest('POST', `/api/sales/orders/${so.body.data.id}/fulfill`, { shipment_date: '2026-09-04' }, admin)).status).toBe(409);
  });

  it('FIFO opening layers: consumed first, reconcile is idempotent, trims layers after a non-FIFO interlude', async () => {
    const ma = (await db.query(`SELECT id FROM items WHERE code = 'CAP-MA'`)).rows[0];
    const ship = async (qty: string) => {
      const so = await makeRequest('POST', '/api/sales/orders', { party_id: customer.id, order_date: '2026-09-05', lines: [{ item_id: ma.id, quantity: qty, unit_price: '500' }] }, controller);
      await makeRequest('POST', `/api/sales/orders/${so.body.data.id}/confirm`, {}, controller);
      expect((await makeRequest('POST', `/api/sales/orders/${so.body.data.id}/fulfill`, { shipment_date: '2026-09-05' }, admin)).status).toBe(200);
      return Number((await db.query(`SELECT unit_cost::text c FROM stock_movements WHERE reference_id = $1`, [so.body.data.id])).rows[0].c);
    };
    await receive(ma.id, '5', '200'); // newer layer
    expect(await ship('20')).toBe(124); // the opening layer goes first
    const layers = await makeRequest('GET', `/api/inventory/fifo/layers?item_id=${ma.id}`, undefined, admin);
    expect(layers.body.data.map((l: any) => [l.layer_source, Number(l.qty_remaining), Number(l.unit_cost)])).toEqual([['RECEIPT', 5, 200]]);
    const again = await makeRequest('POST', '/api/inventory/fifo/reconcile-layers', {}, admin);
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ opened: [], trimmed: [] });
    // Issue 2 under STANDARD (layers untouched), then return to FIFO: the stale surplus is trimmed.
    const v = async () => (await makeRequest('GET', '/api/config/settings', undefined, admin)).body.data.find((x: any) => x.key === 'inventory.costing_method').version;
    expect((await makeRequest('POST', '/api/config/settings/inventory.costing_method', { value: 'STANDARD', version: await v(), reason: 'test' }, admin)).status).toBe(200);
    expect((await makeRequest('POST', '/api/inventory/fifo/reconcile-layers', {}, admin)).status).toBe(409);
    await ship('2');
    const back = await makeRequest('POST', '/api/config/settings/inventory.costing_method', { value: 'FIFO', version: await v(), reason: 'back' }, admin);
    expect(back.body.data.fifo_layers.trimmed).toEqual(expect.arrayContaining([{ item: 'CAP-MA', quantity: '2.0000' }]));
    const left = (await db.query(`SELECT SUM(qty_remaining)::text q FROM stock_cost_layers WHERE item_id = $1`, [ma.id])).rows[0].q;
    expect(Number(left)).toBe(3);
  });
});
