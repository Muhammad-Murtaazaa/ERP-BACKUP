import { describe, it, expect } from 'vitest';
import {
  gs1CheckDigit, isValidGtin, parseScan, priceCart, settleTenders, computeLineRefund, allocateRefundToTenders,
  allocateProportional, countDenominations, expectedDrawer, drawerVariance, pointsEarned, redemptionValue, pointsForAmount,
  BankReconciliationEngine, Money, type CartLineInput, type Promotion,
} from '../src/index.js';

const line = (o: Partial<CartLineInput> & { item_id: string; quantity: string; unit_price: string }): CartLineInput => ({
  line_id: o.line_id || o.item_id, sku: o.item_id.toUpperCase(), name: o.item_id, tax_rate: '0', ...o,
});

describe('Retail engine: barcodes', () => {
  it('computes GS1 check digits and validates GTINs', () => {
    expect(gs1CheckDigit('400638133393')).toBe(1);
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('abc')).toBe(false);
  });
  it('parses price-embedded and weight-embedded EAN-13 labels', () => {
    const body = '22' + '12345' + '01999'; // PLU 12345, PKR 19.99
    const code = body + gs1CheckDigit(body);
    expect(parseScan(code)).toEqual({ kind: 'EMBEDDED_PRICE', plu: '12345', price: '19.99', code });
    const wbody = '20' + '00042' + '01250'; // 1.250 kg
    const wcode = wbody + gs1CheckDigit(wbody);
    expect(parseScan(wcode)).toMatchObject({ kind: 'EMBEDDED_WEIGHT', plu: '00042', quantity: '1.250' });
  });
  it('treats a bad check digit as free text, and normal GTINs as GTIN', () => {
    expect(parseScan('2212345019990').kind).toBe(gs1CheckDigit('221234501999') === 0 ? 'EMBEDDED_PRICE' : 'TEXT');
    expect(parseScan('4006381333931').kind).toBe('GTIN');
    expect(parseScan('  SKU-001 ').kind).toBe('TEXT');
  });
});

describe('Retail engine: pricing & promotions', () => {
  it('rounds per-line tax HALF_UP and sums exactly', () => {
    const c = priceCart([line({ item_id: 'a', quantity: '3', unit_price: '0.35', tax_rate: '16' })]);
    // 1.05 * 16% = 0.168 -> 0.17
    expect(c.lines[0].tax_amount).toBe('0.17');
    expect(c.grand_total).toBe('1.22');
  });
  it('rejects zero/negative quantity and negative price', () => {
    expect(() => priceCart([line({ item_id: 'a', quantity: '0', unit_price: '1' })])).toThrow(/positive/);
    expect(() => priceCart([line({ item_id: 'a', quantity: '-1', unit_price: '1' })])).toThrow(/positive/);
    expect(() => priceCart([line({ item_id: 'a', quantity: '1', unit_price: '-1' })])).toThrow(/negative/);
  });
  it('empty cart totals zero', () => {
    expect(priceCart([]).grand_total).toBe('0.00');
  });
  it('BOGO gives the cheapest unit free and needs a complete group', () => {
    const bogo: Promotion = { id: 'p1', code: 'BOGO', name: 'Buy 1 get 1', type: 'BOGO', buy_qty: '1', get_qty: '1', item_ids: ['a', 'b'] };
    const one = priceCart([line({ item_id: 'a', quantity: '1', unit_price: '100' })], { promotions: [bogo] });
    expect(one.discount_total).toBe('0.00');
    const c = priceCart([line({ item_id: 'a', quantity: '1', unit_price: '100' }), line({ item_id: 'b', quantity: '1', unit_price: '60' })], { promotions: [bogo] });
    expect(c.lines[1].promo_discount).toBe('60.00');
    expect(c.net_total).toBe('100.00');
    const three = priceCart([line({ item_id: 'a', quantity: '3', unit_price: '100' })], { promotions: [bogo] });
    expect(three.promo_discount_total).toBe('100.00'); // only one complete pair
  });
  it('mix & match: any 3 for 250 with exact allocation', () => {
    const mm: Promotion = { id: 'p2', code: 'MM3', name: '3 for 250', type: 'MIX_MATCH', group_qty: '3', group_price: '250', categories: ['SNACK'] };
    const c = priceCart([
      line({ item_id: 'a', quantity: '2', unit_price: '100', category: 'SNACK' }),
      line({ item_id: 'b', quantity: '1', unit_price: '90', category: 'SNACK' }),
      line({ item_id: 'c', quantity: '1', unit_price: '500', category: 'OTHER' }),
    ], { promotions: [mm] });
    expect(c.promo_discount_total).toBe('40.00');
    expect(new Money(c.lines[0].net_amount).add(c.lines[1].net_amount).toFixed(2)).toBe('250.00');
    expect(c.lines[2].promo_discount).toBe('0.00');
  });
  it('bundle price applies per complete bundle only', () => {
    const b: Promotion = { id: 'p3', code: 'MEAL', name: 'Meal deal', type: 'BUNDLE', bundle_price: '150', components: [{ item_id: 'burger', qty: '1' }, { item_id: 'drink', qty: '1' }] };
    const c = priceCart([line({ item_id: 'burger', quantity: '2', unit_price: '120' }), line({ item_id: 'drink', quantity: '1', unit_price: '60' })], { promotions: [b] });
    expect(c.promo_discount_total).toBe('30.00');
    expect(c.net_total).toBe('270.00');
  });
  it('tiered pricing picks the highest qualifying tier', () => {
    const t: Promotion = { id: 'p4', code: 'VOL', name: 'Volume', type: 'TIERED', item_ids: ['a'], tiers: [{ min_qty: '5', unit_price: '9' }, { min_qty: '10', unit_price: '8' }] };
    expect(priceCart([line({ item_id: 'a', quantity: '4', unit_price: '10' })], { promotions: [t] }).net_total).toBe('40.00');
    expect(priceCart([line({ item_id: 'a', quantity: '6', unit_price: '10' })], { promotions: [t] }).net_total).toBe('54.00');
    expect(priceCart([line({ item_id: 'a', quantity: '12', unit_price: '10' })], { promotions: [t] }).net_total).toBe('96.00');
  });
  it('coupons honour min subtotal and max discount, unknown codes are rejected', () => {
    const cp: Promotion = { id: 'p5', code: 'SAVE10', name: '10% off', type: 'COUPON', coupon_code: 'SAVE10', percent_off: '10', min_subtotal: '500', max_discount: '75' };
    const small = priceCart([line({ item_id: 'a', quantity: '1', unit_price: '400' })], { promotions: [cp], couponCodes: ['save10'] });
    expect(small.discount_total).toBe('0.00');
    expect(small.rejected_coupons).toContain('SAVE10');
    const big = priceCart([line({ item_id: 'a', quantity: '1', unit_price: '1000' })], { promotions: [cp], couponCodes: ['SAVE10', 'BOGUS'] });
    expect(big.cart_discount_total).toBe('75.00');
    expect(big.rejected_coupons).toEqual(['BOGUS']);
    const none = priceCart([line({ item_id: 'a', quantity: '1', unit_price: '1000' })], { promotions: [cp] });
    expect(none.discount_total).toBe('0.00');
  });
  it('cart discount is allocated to lines exactly (rounding residual)', () => {
    const c = priceCart([
      line({ item_id: 'a', quantity: '1', unit_price: '10' }), line({ item_id: 'b', quantity: '1', unit_price: '10' }), line({ item_id: 'c', quantity: '1', unit_price: '10' }),
    ], { cartDiscount: { type: 'AMOUNT', value: '10' } });
    const sum = c.lines.reduce((s, l) => s.add(l.cart_discount), Money.zero());
    expect(sum.toFixed(2)).toBe('10.00');
    expect(c.net_total).toBe('20.00');
  });
  it('discounts are capped at the line value and cannot be negative or >100%', () => {
    const c = priceCart([line({ item_id: 'a', quantity: '1', unit_price: '50', line_discount: { type: 'AMOUNT', value: '80' } })]);
    expect(c.net_total).toBe('0.00');
    expect(() => priceCart([line({ item_id: 'a', quantity: '1', unit_price: '50', line_discount: { type: 'PERCENT', value: '120' } })])).toThrow();
    expect(() => priceCart([line({ item_id: 'a', quantity: '1', unit_price: '50', line_discount: { type: 'AMOUNT', value: '-5' } })])).toThrow();
  });
  it('price overrides and embedded-price labels are excluded from quantity promos', () => {
    const bogo: Promotion = { id: 'p1', code: 'BOGO', name: 'B1G1', type: 'BOGO', item_ids: ['a'] };
    const c = priceCart([line({ item_id: 'a', quantity: '2', unit_price: '100', override_price: '80' })], { promotions: [bogo] });
    expect(c.net_total).toBe('160.00');
    const lbl = priceCart([line({ item_id: 'a', quantity: '1.234', unit_price: '500', fixed_line_total: '617.00' })], { promotions: [bogo] });
    expect(lbl.net_total).toBe('617.00');
  });
  it('weighed quantities round the line to 2 dp', () => {
    const c = priceCart([line({ item_id: 'a', quantity: '0.333', unit_price: '10.01' })]);
    expect(c.lines[0].gross_amount).toBe('3.33');
  });
});

describe('Retail engine: tenders', () => {
  it('cash change calculation', () => {
    const s = settleTenders('1044.00', [{ type: 'CASH', amount: '1100' }]);
    expect(s.change_due).toBe('56.00');
    expect(s.tenders[0].applied_amount).toBe('1044.00');
  });
  it('split tender exact, under and over', () => {
    expect(settleTenders('100.00', [{ type: 'CARD', amount: '60' }, { type: 'CASH', amount: '40' }]).change_due).toBe('0.00');
    expect(() => settleTenders('100.00', [{ type: 'CARD', amount: '60' }, { type: 'CASH', amount: '39.99' }])).toThrow(/Insufficient/);
    expect(() => settleTenders('100.00', [{ type: 'CARD', amount: '60' }, { type: 'WALLET', amount: '41' }])).toThrow(/Non-cash/);
    const over = settleTenders('100.00', [{ type: 'GIFT_CARD', amount: '30' }, { type: 'CASH', amount: '100' }]);
    expect(over.change_due).toBe('30.00');
    expect(over.tenders[1].applied_amount).toBe('70.00');
  });
  it('rejects zero/negative tenders and empty tender list', () => {
    expect(() => settleTenders('10', [{ type: 'CASH', amount: '0' }])).toThrow();
    expect(() => settleTenders('10', [{ type: 'CASH', amount: '-10' }])).toThrow();
    expect(() => settleTenders('10', [])).toThrow();
    expect(settleTenders('0', []).change_due).toBe('0.00');
  });
  it('cash rounding to the nearest increment', () => {
    const s = settleTenders('99.60', [{ type: 'CASH', amount: '100' }], { cashRoundingIncrement: '1' });
    expect(s.cash_rounding).toBe('0.40');
    expect(s.change_due).toBe('0.00');
  });
});

describe('Retail engine: returns', () => {
  const sold = { line_id: 'l', quantity: '3', net_amount: '200.00', tax_amount: '32.00', returned_quantity: '0', refunded_net: '0', refunded_tax: '0' };
  it('refunds a discounted item at the discounted price, final unit absorbs rounding', () => {
    const r1 = computeLineRefund(sold, '1');
    expect(r1).toEqual({ net: '66.67', tax: '10.67', total: '77.34' });
    const r2 = computeLineRefund({ ...sold, returned_quantity: '1', refunded_net: '66.67', refunded_tax: '10.67' }, '1');
    const r3 = computeLineRefund({ ...sold, returned_quantity: '2', refunded_net: new Money('66.67').add(r2.net).toFixed(2), refunded_tax: new Money('10.67').add(r2.tax).toFixed(2) }, '1');
    const total = new Money(r1.total).add(r2.total).add(r3.total);
    expect(total.toFixed(2)).toBe('232.00');
  });
  it('blocks over-return and zero-qty return', () => {
    expect(() => computeLineRefund(sold, '4')).toThrow(/remain/);
    expect(() => computeLineRefund(sold, '0')).toThrow();
  });
  it('allocates refunds to original tenders, electronic first, capped', () => {
    const out = allocateRefundToTenders('150.00', [
      { tender_id: 'c', type: 'CASH', applied_amount: '100', refunded_amount: '0' },
      { tender_id: 'k', type: 'CARD', applied_amount: '80', refunded_amount: '0', reference: '1234' },
    ]);
    expect(out).toEqual([{ tender_id: 'k', type: 'CARD', amount: '80.00', reference: '1234' }, { tender_id: 'c', type: 'CASH', amount: '70.00', reference: undefined }]);
    expect(() => allocateRefundToTenders('200.00', [{ tender_id: 'c', type: 'CASH', applied_amount: '100', refunded_amount: '0' }])).toThrow(/exceeds/);
  });
});

describe('Retail engine: shift, loyalty, allocation', () => {
  it('counts denominations and computes variance', () => {
    expect(countDenominations([{ value: '5000', count: 1 }, { value: '10', count: 3 }, { value: '0.5', count: 2 }])).toBe('5031.00');
    expect(() => countDenominations([{ value: '10', count: -1 }])).toThrow();
    const exp = expectedDrawer({ opening_float: '5000', cash_sales: '1044', cash_refunds: '44', paid_in: '100', paid_out: '50', safe_drops: '1000' });
    expect(exp).toBe('5050.00');
    expect(drawerVariance(exp, '5040')).toEqual({ variance: '-10.00', status: 'SHORT' });
    expect(drawerVariance(exp, '5050.00').status).toBe('BALANCED');
    expect(drawerVariance(exp, '5051').status).toBe('OVER');
  });
  it('loyalty earn/redeem', () => {
    expect(pointsEarned('1044')).toBe(10);
    expect(pointsEarned('-5')).toBe(0);
    expect(redemptionValue(25)).toBe('25.00');
    expect(pointsForAmount('10.50')).toBe(11);
    expect(() => redemptionValue(-1)).toThrow();
  });
  it('allocateProportional sums exactly and handles zero weights', () => {
    const s = allocateProportional('0.10', ['1', '1', '1']);
    expect(s.reduce((a, b) => a.add(b), Money.zero()).toFixed(2)).toBe('0.10');
    expect(allocateProportional('5', ['0', '0'])).toEqual(['0.00', '0.00']);
  });
});

describe('Bank auto-match suggestions', () => {
  it('matches exact amount within tolerance, prefers reference, uses each GL line once, skips ambiguity', () => {
    const res = BankReconciliationEngine.suggestMatches(
      [
        { id: 's1', date: '2026-03-10', amount: '-500.00', reference: 'CHQ991' },
        { id: 's2', date: '2026-03-10', amount: '-500.00', reference: '' },
        { id: 's3', date: '2026-03-10', amount: '250.00' },
        { id: 's4', date: '2026-03-10', amount: '999.00' },
      ],
      [
        { id: 'g1', date: '2026-03-09', amount: '-500.00', text: 'vendor payment' },
        { id: 'g2', date: '2026-03-11', amount: '-500.00', text: 'Cheque CHQ991' },
        { id: 'g3', date: '2026-02-01', amount: '250.00', text: 'too old' },
        { id: 'g4', date: '2026-03-12', amount: '999.00', text: 'a' },
        { id: 'g5', date: '2026-03-08', amount: '999.00', text: 'b' },
      ],
      3,
    );
    expect(res.find((r) => r.statementLineId === 's1')?.journalLineId).toBe('g2');
    expect(res.find((r) => r.statementLineId === 's2')?.journalLineId).toBe('g1');
    expect(res.find((r) => r.statementLineId === 's3')).toBeUndefined();
    expect(res.find((r) => r.statementLineId === 's4')).toBeUndefined();
  });
});
