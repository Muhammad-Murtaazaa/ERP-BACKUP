import { describe, it, expect } from 'vitest';
import {
  addScan, addItem, emptyCart, setQuantity, voidLine, setLineDiscount, priceLocal, manualDiscountPercent, summarizeTenders,
  roundCash, quickCashOptions, searchCatalog, saveCart, loadCart, enqueueSale, readQueue, flushQueue, orderPayload, type Catalog, type KV,
} from '../src/pos/cart.js';
import { commandFor, keyCombo, ScanBuffer, SHORTCUTS } from '../src/pos/shortcuts.js';
import { gs1CheckDigit, settleTenders } from '@omnysync/financial-engine';

const ean = (body12: string) => body12 + gs1CheckDigit(body12);
const COLA = { id: 'i-cola', code: 'BEV-COLA', name: 'Cola 1.5L', unit_price: '180.00', tax_rate: '18', barcode: ean('896100000001'), category: 'BEVERAGE' };
const WATER = { id: 'i-water', code: 'BEV-WATER', name: 'Water 1.5L', unit_price: '90.00', tax_rate: '18', barcode: ean('896100000002'), category: 'BEVERAGE' };
const BANANA = { id: 'i-ban', code: 'PRD-BANANA', name: 'Bananas (kg)', unit_price: '240.00', tax_rate: '0', plu_code: '00042', is_weighed: true, category: 'PRODUCE' };
const CHIPS = { id: 'i-chips', code: 'SNK-CHIPS', name: 'Chips 150g', unit_price: '100.00', tax_rate: '18', barcode: ean('896100000003'), category: 'SNACKS' };

const catalog: Catalog = {
  items: [COLA, WATER, BANANA, CHIPS],
  promotions: [{ id: 'p1', code: 'CHIPS-B1G1', name: 'Chips buy 1 get 1 free', type: 'BOGO', item_ids: ['i-chips'], buy_qty: '1', get_qty: '1', get_discount_percent: '100' }],
};

const memKV = (): KV & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};

describe('POS terminal cart', () => {
  it('scanning the same barcode auto-increments the existing line', () => {
    let c = emptyCart();
    for (let i = 0; i < 3; i++) {
      const r = addScan(c, catalog, COLA.barcode);
      expect(r.ok).toBe(true);
      if (r.ok) c = r.cart;
    }
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].quantity).toBe('3');
    expect(c.selected).toBe(0);
  });

  it('SKU lookup is case-insensitive and unknown codes are rejected without touching the cart', () => {
    const r = addScan(emptyCart(), catalog, 'bev-water');
    expect(r.ok && r.cart.lines[0].item_id).toBe('i-water');
    const bad = addScan(emptyCart(), catalog, '0000000000000');
    expect(bad.ok).toBe(false);
  });

  it('weight-embedded scale label (prefix 20) makes a separate weighed line each time', () => {
    // 20 00042 01250 + check => 1.250 kg of bananas
    const code = ean('200004201250');
    let c = emptyCart();
    const a = addScan(c, catalog, code); if (a.ok) c = a.cart;
    const b = addScan(c, catalog, code); if (b.ok) c = b.cart;
    expect(c.lines).toHaveLength(2);
    expect(c.lines[0].quantity).toBe('1.250');
    const p = priceLocal(c, []);
    expect(p.grand_total).toBe('600.00'); // 2 x 1.25 x 240, 0% tax
  });

  it('price-embedded label (prefix 22) keeps the label total authoritative', () => {
    const code = ean('220004200450'); // 4.50? divisor 100 -> 004.50 -> label total 4.50
    const r = addScan(emptyCart(), catalog, code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cart.lines[0].fixed_line_total).toBe('4.50');
    expect(priceLocal(r.cart, []).lines[0].net_amount).toBe('4.50');
  });

  it('whole-unit items reject fractional quantities; weighed items accept them', () => {
    const r = addItem(emptyCart(), COLA, '1');
    if (!r.ok) throw new Error('add failed');
    expect(setQuantity(r.cart, 0, '1.5')).toMatch(/whole units/);
    expect(setQuantity(r.cart, 0, '0')).toMatch(/positive/);
    const w = addItem(emptyCart(), BANANA, '0.755');
    expect(w.ok && w.cart.lines[0].quantity).toBe('0.755');
  });

  it('void line keeps a sensible selection', () => {
    let c = emptyCart();
    for (const it of [COLA, WATER, CHIPS]) { const r = addItem(c, it); if (r.ok) c = r.cart; }
    c = voidLine(c, 2);
    expect(c.lines.map((l) => l.item_id)).toEqual(['i-cola', 'i-water']);
    expect(c.selected).toBe(1);
    c = voidLine(voidLine(c, 0), 0);
    expect(c.selected).toBe(-1);
  });

  it('local pricing applies BOGO and per-line tax exactly like the server engine', () => {
    let c = emptyCart();
    const r = addItem(c, CHIPS, '2'); if (r.ok) c = r.cart;
    const p = priceLocal(c, catalog.promotions);
    expect(p.subtotal).toBe('200.00');
    expect(p.promo_discount_total).toBe('100.00');
    expect(p.tax_total).toBe('18.00');
    expect(p.grand_total).toBe('118.00');
  });

  it('manual discount share excludes promotions (for the manager-approval threshold)', () => {
    let c = emptyCart();
    const r = addItem(c, COLA, '2'); if (r.ok) c = r.cart;
    c = setLineDiscount(c, 0, { type: 'AMOUNT', value: '54' });
    const p = priceLocal(c, []);
    expect(manualDiscountPercent(p, [])).toBe('15.00'); // 54 / 360
  });

  it('split tender summary: under-tender blocks, cash over-tender gives change, non-cash over-tender is an error', () => {
    expect(summarizeTenders('1000.00', [{ type: 'CARD', amount: '400' }, { type: 'CASH', amount: '500' }])).toMatchObject({ remaining: '100.00', canComplete: false });
    expect(summarizeTenders('1000.00', [{ type: 'CARD', amount: '400' }, { type: 'CASH', amount: '1000' }])).toMatchObject({ change: '400.00', canComplete: true });
    expect(summarizeTenders('1000.00', [{ type: 'CARD', amount: '1000.01' }])).toMatchObject({ canComplete: false, error: expect.stringMatching(/Non-cash/) });
    expect(summarizeTenders('0.00', [])).toMatchObject({ canComplete: true });
  });

  it('cash rounding applies only to the cash-settled part, matching the server engine', () => {
    const noCash = summarizeTenders('1017.49', [{ type: 'CARD', amount: '1017.49' }], { cashRoundingIncrement: '1' });
    expect(noCash).toMatchObject({ rounding: '0.00', canComplete: true, change: '0.00' });
    const split = summarizeTenders('1017.49', [{ type: 'CARD', amount: '500' }, { type: 'CASH', amount: '517' }], { cashRoundingIncrement: '1' });
    expect(split).toMatchObject({ rounding: '-0.49', due: '1017.00', canComplete: true, change: '0.00' });
    const eng = settleTenders('1017.49', [{ type: 'CARD', amount: '500' }, { type: 'CASH', amount: '517' }], { cashRoundingIncrement: '1' });
    expect(eng.cash_rounding).toBe(split.rounding);
    expect(eng.change_due).toBe(split.change);
  });

  it('cash rounding and quick-cash suggestions', () => {
    expect(roundCash('1017.49', '1')).toBe('1017.00');
    expect(roundCash('1017.50', '1')).toBe('1018.00'); // HALF_UP
    expect(roundCash('1017.49', null)).toBe('1017.49');
    const q = quickCashOptions('1017.49');
    expect(q[0]).toBe('1017.49');
    expect(q).toContain('1050.00');
    expect(q).toContain('1100.00');
    expect(q.every((v, i) => i === 0 || Number(v) > 1017.49)).toBe(true);
  });

  it('search ranks exact SKU / barcode first and supports multi-word name matching', () => {
    expect(searchCatalog(catalog.items, 'BEV-WATER')[0].id).toBe('i-water');
    expect(searchCatalog(catalog.items, '1.5l cola').map((i) => i.id)).toEqual(['i-cola']);
    expect(searchCatalog(catalog.items, COLA.barcode)[0].id).toBe('i-cola');
  });
});

describe('POS offline tolerance', () => {
  it('cart survives a reload via local persistence; corrupt data is ignored', () => {
    const kv = memKV();
    const r = addItem(emptyCart(), COLA, '2');
    if (!r.ok) throw new Error();
    saveCart(kv, 'reg1', r.cart);
    expect(loadCart(kv, 'reg1')?.lines[0].quantity).toBe('2');
    expect(loadCart(kv, 'reg2')).toBeNull();
    kv.setItem('omnysync.pos.cart.reg1', '{not json');
    expect(loadCart(kv, 'reg1')).toBeNull();
  });

  it('enqueue is idempotent per client_ref and flush keeps order, stopping at the first network failure', async () => {
    const kv = memKV();
    const mk = (ref: string) => ({ ...orderPayload({ ...emptyCart(), client_ref: ref }, 's1', []), client_ref: ref });
    enqueueSale(kv, mk('A'));
    enqueueSale(kv, mk('A'));
    enqueueSale(kv, mk('B'));
    enqueueSale(kv, mk('C'));
    expect(readQueue(kv).map((q) => q.client_ref)).toEqual(['A', 'B', 'C']);
    const seen: string[] = [];
    const res = await flushQueue(kv, async (p) => {
      seen.push(p.client_ref);
      if (p.client_ref === 'B') throw Object.assign(new Error('Failed to fetch'), { offline: true });
    });
    expect(seen).toEqual(['A', 'B']);
    expect(res).toMatchObject({ sent: 1, pending: 2 });
    expect(readQueue(kv).map((q) => q.client_ref)).toEqual(['B', 'C']);
    expect(readQueue(kv)[0].attempts).toBe(1);
  });

  it('business rejections stay queued with their reason for follow-up (never silently lost)', async () => {
    const kv = memKV();
    enqueueSale(kv, { ...orderPayload({ ...emptyCart(), client_ref: 'X' }, 's1', []) });
    const res = await flushQueue(kv, async () => { throw new Error('Insufficient stock'); });
    expect(res.failed[0].last_error).toBe('Insufficient stock');
    expect(readQueue(kv)).toHaveLength(1);
  });
});

describe('POS keyboard map and scanner detection', () => {
  it('maps F-keys and combos to commands', () => {
    expect(commandFor({ key: 'F12' })?.command).toBe('PAY');
    expect(commandFor({ key: 'F4', shiftKey: true })?.command).toBe('CART_DISCOUNT');
    expect(commandFor({ key: 'F5', shiftKey: true })?.command).toBe('RECALL');
    expect(commandFor({ key: 'Delete', ctrlKey: true, shiftKey: true })?.command).toBe('VOID_CART');
    expect(commandFor({ key: 'Escape' })?.command).toBe('ESCAPE');
    expect(commandFor({ key: 'f', ctrlKey: true })?.command).toBe('SEARCH');
    expect(commandFor({ key: '*' })?.command).toBe('QTY');
    expect(keyCombo({ key: 'a' })).toBe('A');
    expect(commandFor({ key: 'a' })).toBeUndefined();
  });

  it('every shortcut key is unique (no command shadows another)', () => {
    const all = SHORTCUTS.flatMap((s) => s.keys.map((k) => k.toUpperCase()));
    expect(new Set(all).size).toBe(all.length);
  });

  it('scanner bursts are recognised; slow human typing is not', () => {
    const b = new ScanBuffer(35, 4);
    let t = 1000;
    for (const ch of '8961000000013') b.push(ch, (t += 5));
    expect(b.enter(t + 5)).toBe('8961000000013');
    for (const ch of '1234') b.push(ch, (t += 200));
    expect(b.enter(t + 200)).toBeNull();
  });
});
