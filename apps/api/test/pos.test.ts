import { describe, it, expect, beforeAll } from 'vitest';
import { Money, gs1CheckDigit } from '@omnysync/financial-engine';
import { bootstrap, login, makeRequest } from './harness.js';

const ean = (body12: string) => body12 + gs1CheckDigit(body12);
const REGISTER = '72000000-0000-0000-0000-000000000001'; // POS-01 (seed)
const LAYS = '71000000-0000-0000-0000-000000000002';
const KURKURE = '71000000-0000-0000-0000-000000000003';
const PEPSI = '71000000-0000-0000-0000-000000000004';
const WATER = '71000000-0000-0000-0000-000000000005';
const SURF = '71000000-0000-0000-0000-000000000009';
const CUSTOMER = '60000000-0000-0000-0000-000000000002';
const MANAGER_PIN = '2468';

describe('POS retail checkout (big-box)', () => {
  let cashier: string;
  let manager: string;
  let admin: string;
  let controller: string;
  let viewer: string;
  let accountant: string;
  let sessionId: string;
  let sale1: any;

  const stock = async (itemId: string) => {
    const r = await makeRequest('GET', `/api/pos/catalog?register_id=${REGISTER}`, undefined, cashier);
    return new Money(r.body.data.items.find((i: any) => i.id === itemId).on_hand).toFixed(3);
  };
  const approve = async (action: string, pin = MANAGER_PIN, token = cashier, sid = sessionId) =>
    makeRequest('POST', '/api/pos/approvals', { session_id: sid, action, pin }, token);
  const xReport = async () => (await makeRequest('GET', `/api/pos/sessions/${sessionId}/x-report`, undefined, cashier)).body.data;
  const sell = (body: any, token = cashier) => makeRequest('POST', '/api/pos/orders', { session_id: sessionId, ...body }, token);

  beforeAll(async () => {
    await bootstrap();
    [cashier, manager, admin, controller, viewer, accountant] = await Promise.all([
      login('cashier@omnysync.internal'),
      login('storemanager@omnysync.internal'),
      login('admin@omnysync.internal'),
      login('controller@omnysync.internal'),
      login('viewer@omnysync.internal'),
      login('accountant@omnysync.internal'),
    ]);
  });

  it('denies POS to roles without POS_TERMINAL', async () => {
    expect((await makeRequest('GET', '/api/pos/registers', undefined, viewer)).status).toBe(403);
    expect((await makeRequest('GET', '/api/pos/catalog', undefined, accountant)).status).toBe(403);
    expect((await makeRequest('POST', '/api/pos/registers', { register_code: 'X', name: 'X' }, cashier)).status).toBe(403);
  });

  it('opens a shift from a denomination count and blocks a second open on the same register (incl. concurrent)', async () => {
    const open = await makeRequest('POST', '/api/pos/sessions/open', { register_id: REGISTER, opening_count: [{ value: '1000', count: 4 }, { value: '500', count: 2 }] }, cashier);
    expect(open.status).toBe(201);
    expect(new Money(open.body.data.opening_float).toFixed(2)).toBe('5000.00');
    sessionId = open.body.data.id;
    const again = await makeRequest('POST', '/api/pos/sessions/open', { register_id: REGISTER, opening_float: '100' }, manager);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('POS_SESSION_ALREADY_OPEN');

    const reg = await makeRequest('POST', '/api/pos/registers', { register_code: 'POS-RACE', name: 'Race lane' }, manager);
    const [a, b] = await Promise.all([
      makeRequest('POST', '/api/pos/sessions/open', { register_id: reg.body.data.id, opening_float: '0' }, manager),
      makeRequest('POST', '/api/pos/sessions/open', { register_id: reg.body.data.id, opening_float: '0' }, admin),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('looks up barcodes, weight labels and price-embedded labels', async () => {
    const lays = await makeRequest('GET', '/api/pos/lookup?code=8961000000020', undefined, cashier);
    expect(lays.status).toBe(200);
    expect(lays.body.data.item.id).toBe(LAYS);
    const w = await makeRequest('GET', `/api/pos/lookup?code=${ean('200004201250')}`, undefined, cashier);
    expect(w.body.data.item.code).toBe('RTL-BANANA-KG');
    expect(w.body.data.quantity).toBe('1.250');
    const p = await makeRequest('GET', `/api/pos/lookup?code=${ean('220005070000')}`, undefined, cashier);
    expect(p.body.data.item.code).toBe('RTL-BEEF-KG');
    expect(p.body.data.fixed_line_total).toBe('700.00');
    expect(p.body.data.quantity).toBe('0.500');
    expect((await makeRequest('GET', '/api/pos/lookup?code=0000000000000', undefined, cashier)).status).toBe(404);
    const sku = await makeRequest('GET', '/api/pos/lookup?code=rtl-pepsi-15', undefined, cashier);
    expect(sku.body.data.item.id).toBe(PEPSI);
  });

  it('sells a mixed basket (BOGO, weighed, label price), deducts stock and posts a balanced journal with change', async () => {
    const laysBefore = await stock(LAYS);
    const banana = (await makeRequest('GET', `/api/pos/lookup?code=${ean('200004201250')}`, undefined, cashier)).body.data;
    const beef = (await makeRequest('GET', `/api/pos/lookup?code=${ean('220005070000')}`, undefined, cashier)).body.data;
    const r = await sell({
      lines: [
        { item_id: LAYS, quantity: '2', scanned_code: '8961000000020' },
        { item_id: banana.item.id, quantity: banana.quantity },
        { item_id: beef.item.id, quantity: beef.quantity, fixed_line_total: beef.fixed_line_total },
      ],
      tenders: [{ type: 'CASH', amount: '1300' }],
    });
    expect(r.status).toBe(201);
    sale1 = r.body.data;
    // Lays 2 x 100 with 2nd at half = 150 (+18% = 27), bananas 1.25 x 280 = 350, beef label 700
    expect(sale1.subtotal).toBe('1250.00');
    expect(sale1.promo_discount).toBe('50.00');
    expect(sale1.net_amount).toBe('1200.00');
    expect(sale1.tax_amount).toBe('27.00');
    expect(sale1.total_amount).toBe('1227.00');
    expect(sale1.change_due).toBe('73.00');
    expect(sale1.journal_id).toBeTruthy();
    expect(sale1.receipt.text).toContain('TOTAL');
    expect(sale1.receipt.email.subject).toContain(sale1.order_number);
    expect(new Money(laysBefore).sub(await stock(LAYS)).toFixed(3)).toBe('2.000');
    const x = await xReport();
    expect(x.drawer.expected_cash).toBe('6227.00');
  });

  it('rejects whole-unit items sold in fractions and zero/negative quantities', async () => {
    expect((await sell({ lines: [{ item_id: PEPSI, quantity: '1.5' }] })).status).toBe(400);
    expect((await sell({ lines: [{ item_id: PEPSI, quantity: '0' }] })).status).toBe(400);
    expect((await sell({ lines: [{ item_id: PEPSI, quantity: '-1' }] })).status).toBe(400);
    expect((await sell({ lines: [] })).status).toBe(400);
  });

  it('price override requires a single-use manager PIN approval; wrong PIN and self-approval are refused', async () => {
    const denied = await sell({ lines: [{ item_id: PEPSI, quantity: '1', override_price: '200' }], tenders: [{ type: 'CASH', amount: '500' }] });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('APPROVAL_REQUIRED');
    const bad = await approve('PRICE_OVERRIDE', '9999');
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('APPROVAL_INVALID');
    const good = await approve('PRICE_OVERRIDE');
    expect(good.status).toBe(201);
    const approvalId = good.body.data.approval_id;
    const r = await sell({ lines: [{ item_id: PEPSI, quantity: '1', override_price: '200', approval_id: approvalId }], tenders: [{ type: 'CASH', amount: '236' }] });
    expect(r.status).toBe(201);
    expect(r.body.data.total_amount).toBe('236.00');
    const reuse = await sell({ lines: [{ item_id: PEPSI, quantity: '1', override_price: '200', approval_id: approvalId }], tenders: [{ type: 'CASH', amount: '236' }] });
    expect(reuse.status).toBe(403);
    expect(reuse.body.error.code).toBe('APPROVAL_INVALID');

    // SoD: a manager cannot approve their own override with their own PIN.
    const mreg = await makeRequest('POST', '/api/pos/registers', { register_code: 'POS-MGR', name: 'Manager lane' }, manager);
    const ms = await makeRequest('POST', '/api/pos/sessions/open', { register_id: mreg.body.data.id, opening_float: '0' }, manager);
    const self = await approve('PRICE_OVERRIDE', MANAGER_PIN, manager, ms.body.data.id);
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('cashier discounts are limited to the register threshold; tax is rounded HALF_UP per line', async () => {
    const small = await sell({ lines: [{ item_id: KURKURE, quantity: '1', line_discount: { type: 'PERCENT', value: '5' } }], tenders: [{ type: 'CASH', amount: '100.89' }] });
    expect(small.status).toBe(201);
    // 90 - 4.50 = 85.50; 18% = 15.39 → 100.89
    expect(small.body.data.tax_amount).toBe('15.39');
    expect(small.body.data.total_amount).toBe('100.89');
    expect(small.body.data.change_due).toBe('0.00');
    const big = await sell({ lines: [{ item_id: KURKURE, quantity: '1' }], cart_discount: { type: 'PERCENT', value: '25' }, tenders: [{ type: 'CASH', amount: '100' }] });
    expect(big.status).toBe(403);
    expect(big.body.error.code).toBe('APPROVAL_REQUIRED');
  });

  it('split tender: exact, under-tender and card over-tender; failures leave no trace', async () => {
    const before = await stock(WATER);
    const ordersBefore = (await makeRequest('GET', `/api/pos/orders?session_id=${sessionId}`, undefined, cashier)).body.data.length;
    // 2 x 120 = 240 + 18% = 283.20
    const under = await sell({ lines: [{ item_id: WATER, quantity: '2' }], tenders: [{ type: 'CARD', amount: '200' }, { type: 'CASH', amount: '83.19' }] });
    expect(under.status).toBe(422);
    expect(under.body.error.code).toBe('INSUFFICIENT_PAYMENT_TENDER');
    const over = await sell({ lines: [{ item_id: WATER, quantity: '2' }], tenders: [{ type: 'CARD', amount: '300' }] });
    expect(over.status).toBe(422);
    expect(await stock(WATER)).toBe(before);
    expect((await makeRequest('GET', `/api/pos/orders?session_id=${sessionId}`, undefined, cashier)).body.data.length).toBe(ordersBefore);
    const okSplit = await sell({ lines: [{ item_id: WATER, quantity: '2' }], tenders: [{ type: 'CARD', amount: '200', reference: 'VISA-4242' }, { type: 'CASH', amount: '100' }] });
    expect(okSplit.status).toBe(201);
    expect(okSplit.body.data.payment_method).toBe('SPLIT');
    expect(okSplit.body.data.change_due).toBe('16.80');
  });

  it('mix & match: any 3 drinks for 550', async () => {
    const r = await sell({ lines: [{ item_id: PEPSI, quantity: '2' }, { item_id: WATER, quantity: '1' }], tenders: [{ type: 'CASH', amount: '700' }] });
    expect(r.status).toBe(201);
    // 230+230+120 = 580 → 550 (saving 30), tax 18% of 550 = 99
    expect(r.body.data.promo_discount).toBe('30.00');
    expect(r.body.data.total_amount).toBe('649.00');
  });

  it('gift cards: issue, redeem as tender, block overdraw', async () => {
    const gc = await makeRequest('POST', '/api/pos/gift-cards', { session_id: sessionId, amount: '500', tender_type: 'CASH', code: 'GIFT-TEST-01' }, cashier);
    expect(gc.status).toBe(201);
    const pay = await sell({ lines: [{ item_id: PEPSI, quantity: '1' }], tenders: [{ type: 'GIFT_CARD', amount: '271.40', reference: 'GIFT-TEST-01' }] });
    expect(pay.status).toBe(201);
    const bal = await makeRequest('GET', '/api/pos/stored-value/GIFT-TEST-01?kind=GIFT_CARD', undefined, cashier);
    expect(new Money(bal.body.data.balance).toFixed(2)).toBe('228.60');
    const overdraw = await sell({ lines: [{ item_id: PEPSI, quantity: '1' }], tenders: [{ type: 'GIFT_CARD', amount: '271.40', reference: 'GIFT-TEST-01' }] });
    expect(overdraw.status).toBe(422);
    expect(overdraw.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('loyalty: attach customer, earn points, redeem points as tender', async () => {
    const search = await makeRequest('GET', '/api/pos/customers?q=Horizon', undefined, cashier);
    expect(search.body.data[0].id).toBe(CUSTOMER);
    const earn = await sell({ customer_id: CUSTOMER, lines: [{ item_id: SURF, quantity: '2' }], tenders: [{ type: 'CARD', amount: '1770' }] });
    expect(earn.status).toBe(201);
    expect(earn.body.data.loyalty_points_earned).toBe(15); // 1500 net / 100
    const noCustomer = await sell({ lines: [{ item_id: KURKURE, quantity: '1' }], tenders: [{ type: 'LOYALTY', amount: '10' }, { type: 'CASH', amount: '100' }] });
    expect(noCustomer.status).toBe(400);
    const redeem = await sell({ customer_id: CUSTOMER, lines: [{ item_id: KURKURE, quantity: '1' }], tenders: [{ type: 'LOYALTY', amount: '10' }, { type: 'CASH', amount: '96.20' }] });
    expect(redeem.status).toBe(201);
    const after = await makeRequest('GET', '/api/pos/customers?q=Horizon', undefined, cashier);
    expect(after.body.data[0].points_balance).toBe(15 - 10);
  });

  it('holds and recalls a cart exactly once', async () => {
    const h = await makeRequest('POST', '/api/pos/holds', { session_id: sessionId, label: 'Lady in blue', cart: { lines: [{ item_id: PEPSI, quantity: '3' }] }, estimated_total: '814.20' }, cashier);
    expect(h.status).toBe(201);
    const list = await makeRequest('GET', `/api/pos/holds?register_id=${REGISTER}`, undefined, cashier);
    expect(list.body.data.some((x: any) => x.id === h.body.data.id)).toBe(true);
    const [r1, r2] = await Promise.all([
      makeRequest('POST', `/api/pos/holds/${h.body.data.id}/recall`, { session_id: sessionId }, cashier),
      makeRequest('POST', `/api/pos/holds/${h.body.data.id}/recall`, { session_id: sessionId }, cashier),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const recalled = r1.status === 200 ? r1 : r2;
    expect(recalled.body.data.cart.lines[0].quantity).toBe('3');
  });

  it('offline replay with the same client_ref records the sale once', async () => {
    const before = await stock(PEPSI);
    const body = { client_ref: 'offline-lane1-0001', lines: [{ item_id: PEPSI, quantity: '1' }], tenders: [{ type: 'CASH', amount: '300' }] };
    const a = await sell(body);
    const b = await sell(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.data.replayed).toBe(true);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(new Money(before).sub(await stock(PEPSI)).toFixed(3)).toBe('1.000');
  });

  it('void after payment needs a manager, restores stock and cash, reverses the journal, and cannot repeat', async () => {
    const r = await sell({ lines: [{ item_id: PEPSI, quantity: '2' }], tenders: [{ type: 'CASH', amount: '1000' }] });
    const id = r.body.data.id;
    const pepsiAfterSale = await stock(PEPSI);
    const cashBefore = (await xReport()).drawer.expected_cash;
    const denied = await makeRequest('POST', `/api/pos/orders/${id}/void`, { reason: 'Customer changed mind' }, cashier);
    expect(denied.status).toBe(403);
    const ap = await approve('VOID_ORDER');
    const v = await makeRequest('POST', `/api/pos/orders/${id}/void`, { reason: 'Customer changed mind', approval_id: ap.body.data.approval_id }, cashier);
    expect(v.status).toBe(200);
    expect(v.body.data.status).toBe('VOIDED');
    expect(v.body.data.cash_to_return).toBe('542.80');
    expect(v.body.data.void_journal_id).toBeTruthy();
    expect(new Money(await stock(PEPSI)).sub(pepsiAfterSale).toFixed(3)).toBe('2.000');
    expect(new Money(cashBefore).sub((await xReport()).drawer.expected_cash).toFixed(2)).toBe('542.80');
    const ap2 = await approve('VOID_ORDER');
    const again = await makeRequest('POST', `/api/pos/orders/${id}/void`, { reason: 'again', approval_id: ap2.body.data.approval_id }, cashier);
    expect(again.status).toBe(409);
    const rtn = await makeRequest('POST', '/api/pos/returns', { session_id: sessionId, original_order_id: id, reason: 'x', lines: [{ original_line_id: r.body.data.lines[0].id, quantity: '1' }] }, cashier);
    expect(rtn.status).toBe(422);
  });

  it('returns a discounted (BOGO) item at the price actually paid, to the original tender, and blocks over-return', async () => {
    const laysLine = sale1.lines.find((l: any) => l.item_id === LAYS);
    const before = await stock(LAYS);
    const r1 = await makeRequest('POST', '/api/pos/returns', { session_id: sessionId, original_order_id: sale1.id, reason: 'Damaged pack', lines: [{ original_line_id: laysLine.id, quantity: '1' }] }, cashier);
    expect(r1.status).toBe(201);
    // Line net 150 for 2 units → 75 + tax 13.50
    expect(r1.body.data.total_amount).toBe('88.50');
    expect(r1.body.data.refunds).toEqual([{ type: 'CASH', amount: '88.50', reference: null }]);
    const r2 = await makeRequest('POST', '/api/pos/returns', { session_id: sessionId, order_number: sale1.order_number, reason: 'Second pack', lines: [{ original_line_id: laysLine.id, quantity: '1' }] }, cashier);
    expect(r2.status).toBe(201);
    expect(new Money(r1.body.data.total_amount).add(r2.body.data.total_amount).toFixed(2)).toBe('177.00');
    const r3 = await makeRequest('POST', '/api/pos/returns', { session_id: sessionId, original_order_id: sale1.id, reason: 'Too many', lines: [{ original_line_id: laysLine.id, quantity: '1' }] }, cashier);
    expect(r3.status).toBe(422);
    expect(r3.body.error.code).toBe('RETURN_NOT_ALLOWED');
    expect(new Money(await stock(LAYS)).sub(before).toFixed(3)).toBe('2.000');
    const detail = await makeRequest('GET', `/api/pos/orders/${sale1.id}`, undefined, cashier);
    expect(detail.body.data.status).toBe('PARTIALLY_REFUNDED');
  });

  it('refunds split-tender sales card-first and claws back loyalty points', async () => {
    const r = await sell({ customer_id: CUSTOMER, lines: [{ item_id: SURF, quantity: '1' }], tenders: [{ type: 'CARD', amount: '500', reference: 'MC-5555' }, { type: 'CASH', amount: '385' }] });
    expect(r.status).toBe(201);
    expect(r.body.data.loyalty_points_earned).toBe(7);
    const ret = await makeRequest('POST', '/api/pos/returns', { session_id: sessionId, original_order_id: r.body.data.id, reason: 'Wrong size', lines: [{ original_line_id: r.body.data.lines[0].id, quantity: '1' }] }, cashier);
    expect(ret.status).toBe(201);
    expect(ret.body.data.refunds).toEqual([{ type: 'CARD', amount: '500.00', reference: 'MC-5555' }, { type: 'CASH', amount: '385.00', reference: null }]);
    expect(ret.body.data.loyalty_clawback).toBe(7);
  });

  it('no-receipt return requires a manager and refunds to store credit that can be spent', async () => {
    const denied = await makeRequest('POST', '/api/pos/returns', { session_id: sessionId, reason: 'No receipt', refund_to: 'STORE_CREDIT', lines: [{ item_id: KURKURE, quantity: '1' }] }, cashier);
    expect(denied.status).toBe(403);
    const ap = await approve('RETURN_NO_RECEIPT');
    const ok = await makeRequest('POST', '/api/pos/returns', { session_id: sessionId, reason: 'No receipt', refund_to: 'STORE_CREDIT', approval_id: ap.body.data.approval_id, lines: [{ item_id: KURKURE, quantity: '1' }] }, cashier);
    expect(ok.status).toBe(201);
    expect(ok.body.data.total_amount).toBe('106.20');
    const code = ok.body.data.store_credit_code;
    expect(code).toMatch(/^SC-/);
    const spend = await sell({ lines: [{ item_id: KURKURE, quantity: '1' }], tenders: [{ type: 'STORE_CREDIT', amount: '106.20', reference: code }] });
    expect(spend.status).toBe(201);
  });

  it('concurrent sales of the last unit: exactly one succeeds, stock never goes negative', async () => {
    const onHand = new Money(await stock(SURF));
    const leaveOne = onHand.sub(1).toFixed(0);
    const bulk = await sell({ lines: [{ item_id: SURF, quantity: leaveOne }], tenders: [{ type: 'CARD', amount: new Money(leaveOne).mul('885').toFixed(2) }] });
    expect(bulk.status).toBe(201);
    expect(await stock(SURF)).toBe('1.000');
    const [a, b] = await Promise.all([
      sell({ lines: [{ item_id: SURF, quantity: '1' }], tenders: [{ type: 'CASH', amount: '885' }] }),
      sell({ lines: [{ item_id: SURF, quantity: '1' }], tenders: [{ type: 'CASH', amount: '885' }] }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((x) => x.status === 409)!.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stock(SURF)).toBe('0.000');
  });

  it('cash movements: paid-out needs approval, safe drop cannot exceed the drawer, paid-in accepted', async () => {
    const po = await makeRequest('POST', `/api/pos/sessions/${sessionId}/cash-movements`, { movement_type: 'PAID_OUT', amount: '150', reason: 'Cleaning supplies' }, cashier);
    expect(po.status).toBe(403);
    const ap = await approve('PAID_OUT');
    const po2 = await makeRequest('POST', `/api/pos/sessions/${sessionId}/cash-movements`, { movement_type: 'PAID_OUT', amount: '150', reason: 'Cleaning supplies', approval_id: ap.body.data.approval_id }, cashier);
    expect(po2.status).toBe(201);
    const drop = await makeRequest('POST', `/api/pos/sessions/${sessionId}/cash-movements`, { movement_type: 'SAFE_DROP', amount: '99999999', reason: 'Too much' }, cashier);
    expect(drop.status).toBe(400);
    const drop2 = await makeRequest('POST', `/api/pos/sessions/${sessionId}/cash-movements`, { movement_type: 'SAFE_DROP', amount: '4000', reason: 'Mid-shift drop' }, cashier);
    expect(drop2.status).toBe(201);
    const pin = await makeRequest('POST', `/api/pos/sessions/${sessionId}/cash-movements`, { movement_type: 'PAID_IN', amount: '500', reason: 'Change top-up' }, cashier);
    expect(pin.status).toBe(201);
    const noSale = await makeRequest('POST', `/api/pos/sessions/${sessionId}/drawer-open`, { reason: 'Customer needs change' }, cashier);
    expect(noSale.status).toBe(403);
  });

  it('receipt reprint is counted and audited', async () => {
    const rp = await makeRequest('POST', `/api/pos/orders/${sale1.id}/reprint`, {}, cashier);
    expect(rp.status).toBe(200);
    expect(rp.body.data.reprint_count).toBe(1);
    expect(rp.body.data.text).toContain('REPRINT');
    const audit = await makeRequest('GET', `/api/pos/sessions/${sessionId}/audit`, undefined, cashier);
    const types = audit.body.data.map((e: any) => e.event_type);
    for (const t of ['SHIFT_OPENED', 'SALE', 'PRICE_OVERRIDE', 'ORDER_VOIDED', 'RETURN', 'RETURN_NO_RECEIPT', 'CASH_PAID_OUT', 'CASH_SAFE_DROP', 'RECEIPT_REPRINT', 'APPROVAL_PIN_FAILED', 'DRAWER_OPENED', 'CART_HELD', 'CART_RECALLED']) {
      expect(types).toContain(t);
    }
  });

  it('closes the shift with a blind count: variance needs notes, Z report is produced, the GL stays balanced', async () => {
    const x = await xReport();
    const expected = x.drawer.expected_cash;
    const short = new Money(expected).sub('10').toFixed(2);
    const noNotes = await makeRequest('POST', `/api/pos/sessions/${sessionId}/close`, { actual_cash_drawer: short }, cashier);
    expect(noNotes.status).toBe(400);
    const close = await makeRequest('POST', `/api/pos/sessions/${sessionId}/close`, { actual_cash_drawer: short, variance_notes: 'Rs 10 coin missing' }, cashier);
    expect(close.status).toBe(200);
    expect(close.body.data.cash_difference).toBe('-10.00');
    expect(close.body.data.variance_status).toBe('SHORT');
    expect(close.body.data.z_number).toBe(1);
    expect(close.body.data.closing_journal_id).toBeTruthy();
    const z = await makeRequest('GET', `/api/pos/sessions/${sessionId}/z-report`, undefined, cashier);
    expect(z.body.data.report_type).toBe('Z');
    expect(z.body.data.void_count).toBe(1);
    const after = await sell({ lines: [{ item_id: PEPSI, quantity: '1' }], tenders: [{ type: 'CASH', amount: '300' }] });
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe('POS_SESSION_CLOSED');
    const tb = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-12-31', undefined, controller);
    expect(tb.status).toBe(200);
    expect(tb.body.data.is_balanced).toBe(true);
  });

  it('locks manager approvals after repeated wrong PINs', async () => {
    const open = await makeRequest('POST', '/api/pos/sessions/open', { register_id: REGISTER, opening_float: '1000' }, cashier);
    expect(open.status).toBe(201);
    const sid = open.body.data.id;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await approve('DISCOUNT', '1111', cashier, sid)).status);
    expect(statuses.slice(-1)[0]).toBe(423);
    expect((await approve('DISCOUNT', MANAGER_PIN, cashier, sid)).status).toBe(423);
  });
});
