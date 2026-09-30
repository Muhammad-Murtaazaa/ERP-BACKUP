/**
 * Retail checkout engine (POS). Pure, deterministic, decimal-exact. No I/O.
 *
 * Responsibilities:
 *  - scanner input: EAN/UPC check digits and price/weight-embedded (GS1 "2x") barcodes
 *  - cart pricing: list price, manager overrides, line/cart discounts, promotions
 *    (BOGO, mix & match, bundle, tiered/volume, coupon, cart percent), per-line tax
 *  - tender settlement (multi/split tender, change only from cash, over/under checks)
 *  - refunds: pro-rata net refund per unit (never refunds more than was paid, the
 *    last unit absorbs rounding) and allocation back to original tenders
 *  - shift maths: denomination counts, expected drawer, variance, X/Z totals
 *  - loyalty points earn/redeem
 * All amounts are strings; Money (decimal.js, HALF_UP) does the arithmetic.
 */
import { Money } from './money.js';

// ---------------------------------------------------------------------------
// Barcodes
// ---------------------------------------------------------------------------

/** GS1 mod-10 check digit for EAN-8/UPC-A/EAN-13/GTIN-14 bodies. */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  const digits = body.split('').reverse();
  for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code.slice(-1));
}

export interface ScaleBarcodeConfig {
  /** Two-digit prefixes that carry an embedded PRICE (value in minor units). */
  pricePrefixes: string[];
  /** Two-digit prefixes that carry an embedded WEIGHT (value in grams). */
  weightPrefixes: string[];
  /** Digits of the item PLU after the prefix (default 5). */
  pluLength?: number;
  /** Minor units per major unit for embedded prices (default 100 = paisa). */
  priceDivisor?: number;
}

export const DEFAULT_SCALE_CONFIG: ScaleBarcodeConfig = { pricePrefixes: ['22', '23'], weightPrefixes: ['20', '21'], pluLength: 5, priceDivisor: 100 };

export type ParsedScan =
  | { kind: 'GTIN'; code: string }
  | { kind: 'EMBEDDED_PRICE'; plu: string; price: string; code: string }
  | { kind: 'EMBEDDED_WEIGHT'; plu: string; quantity: string; code: string }
  | { kind: 'TEXT'; code: string };

/**
 * Parses scanner input. EAN-13 codes starting with a configured "2x" prefix are
 * variable-measure labels: 2 prefix digits + PLU + 5-digit value + check digit.
 */
export function parseScan(raw: string, cfg: ScaleBarcodeConfig = DEFAULT_SCALE_CONFIG): ParsedScan {
  const code = raw.trim();
  if (/^\d{13}$/.test(code) && isValidGtin(code)) {
    const prefix = code.slice(0, 2);
    const pluLen = cfg.pluLength ?? 5;
    const valueLen = 12 - 2 - pluLen;
    const plu = code.slice(2, 2 + pluLen);
    const value = code.slice(2 + pluLen, 2 + pluLen + valueLen);
    if (cfg.pricePrefixes.includes(prefix)) {
      return { kind: 'EMBEDDED_PRICE', plu, price: new Money(value).div(cfg.priceDivisor ?? 100).toFixed(2), code };
    }
    if (cfg.weightPrefixes.includes(prefix)) {
      return { kind: 'EMBEDDED_WEIGHT', plu, quantity: new Money(value).div(1000).toFixed(3), code };
    }
    return { kind: 'GTIN', code };
  }
  if (/^\d{8}$|^\d{12}$|^\d{14}$/.test(code) && isValidGtin(code)) return { kind: 'GTIN', code };
  return { kind: 'TEXT', code };
}

// ---------------------------------------------------------------------------
// Cart pricing & promotions
// ---------------------------------------------------------------------------

export type DiscountSpec = { type: 'PERCENT' | 'AMOUNT'; value: string } | null | undefined;

export interface CartLineInput {
  line_id: string;
  item_id: string;
  sku: string;
  name: string;
  quantity: string;
  /** Catalogue (list) unit price. */
  unit_price: string;
  /** Manager-approved override unit price (replaces list price). */
  override_price?: string | null;
  /** Percentage, e.g. "16" for 16% sales tax. */
  tax_rate: string;
  category?: string | null;
  line_discount?: DiscountSpec;
  /** Embedded-price label: the label total is authoritative. */
  fixed_line_total?: string | null;
}

export type PromotionType = 'BOGO' | 'MIX_MATCH' | 'BUNDLE' | 'TIERED' | 'COUPON' | 'CART_PERCENT';

export interface Promotion {
  id: string;
  code: string;
  name: string;
  type: PromotionType;
  priority?: number;
  /** Items (or categories) the promotion applies to; empty = all items. */
  item_ids?: string[];
  categories?: string[];
  // BOGO: buy N get M at get_discount_percent off (100 = free)
  buy_qty?: string;
  get_qty?: string;
  get_discount_percent?: string;
  // MIX_MATCH: any `group_qty` qualifying units for `group_price`
  group_qty?: string;
  group_price?: string;
  // BUNDLE: all components (item_id, qty) for bundle_price
  components?: { item_id: string; qty: string }[];
  bundle_price?: string;
  // TIERED: unit price or percent off by min quantity (per line)
  tiers?: { min_qty: string; unit_price?: string; percent_off?: string }[];
  // COUPON / CART_PERCENT
  coupon_code?: string;
  percent_off?: string;
  amount_off?: string;
  min_subtotal?: string;
  max_discount?: string;
}

export interface PricedCartLine extends CartLineInput {
  effective_unit_price: string;
  gross_amount: string;
  promo_discount: string;
  manual_discount: string;
  cart_discount: string;
  net_amount: string;
  tax_amount: string;
  total_amount: string;
  applied_promotions: string[];
}

export interface PricedCart {
  lines: PricedCartLine[];
  subtotal: string;
  promo_discount_total: string;
  manual_discount_total: string;
  cart_discount_total: string;
  discount_total: string;
  net_total: string;
  tax_total: string;
  grand_total: string;
  applied_promotions: { id: string; code: string; name: string; amount: string }[];
  rejected_coupons: string[];
}

const r2 = (m: Money) => m.round(2);

/**
 * Spreads `amount` across `weights` proportionally, rounded to 2 dp, with the
 * rounding residual assigned to the largest weight (deterministic, sums exactly).
 */
export function allocateProportional(amount: string, weights: string[]): string[] {
  const total = weights.reduce((s, w) => s.add(w), Money.zero());
  if (total.isZero() || new Money(amount).isZero()) return weights.map(() => '0.00');
  const shares = weights.map((w) => r2(new Money(amount).mul(w).div(total)));
  const residual = new Money(amount).sub(shares.reduce((s, x) => s.add(x), Money.zero()));
  if (!residual.isZero()) {
    let maxIdx = 0;
    weights.forEach((w, i) => {
      if (new Money(w).gt(weights[maxIdx])) maxIdx = i;
    });
    shares[maxIdx] = shares[maxIdx].add(residual);
  }
  return shares.map((s) => s.toFixed(2));
}

function applies(p: Promotion, line: CartLineInput): boolean {
  const byItem = !p.item_ids || p.item_ids.length === 0 || p.item_ids.includes(line.item_id);
  const byCat = !p.categories || p.categories.length === 0 || (!!line.category && p.categories.includes(line.category));
  return byItem && byCat;
}

function discountOf(base: Money, d: DiscountSpec): Money {
  if (!d || !d.value) return Money.zero();
  const v = new Money(d.value);
  if (v.isNegative()) throw new Error('Discounts cannot be negative');
  const amt = d.type === 'PERCENT' ? (v.gt(100) ? (() => { throw new Error('Percent discount cannot exceed 100'); })() : r2(base.mul(v).div(100))) : r2(v);
  return Money.min(amt, base);
}

/**
 * Prices a cart. Order of operations (documented in decisions/ADR-0102):
 *  1. effective unit price = override ?? list; gross = round2(qty * price) (or fixed label total)
 *  2. item promotions (TIERED, BOGO, MIX_MATCH, BUNDLE) by priority; a unit is consumed
 *     by at most one quantity promotion; discounts never exceed the line gross
 *  3. manual line discount on the remaining line amount
 *  4. cart-level promotions (COUPON / CART_PERCENT) then the manual cart discount,
 *     allocated to lines proportionally (needed for exact refunds)
 *  5. tax per line on the net amount, rounded HALF_UP to 2 dp (tax-exclusive pricing)
 */
export function priceCart(
  input: CartLineInput[],
  opts: { promotions?: Promotion[]; couponCodes?: string[]; cartDiscount?: DiscountSpec } = {},
): PricedCart {
  const promos = [...(opts.promotions || [])].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.code.localeCompare(b.code));
  const coupons = new Set((opts.couponCodes || []).map((c) => c.trim().toUpperCase()));
  const applied = new Map<string, { id: string; code: string; name: string; amount: Money }>();
  const addApplied = (p: Promotion, amt: Money) => {
    if (!amt.isPositive()) return;
    const cur = applied.get(p.id) || { id: p.id, code: p.code, name: p.name, amount: Money.zero() };
    cur.amount = cur.amount.add(amt);
    applied.set(p.id, cur);
  };

  const lines = input.map((l) => {
    const qty = new Money(l.quantity);
    if (!qty.isPositive()) throw new Error(`Quantity must be positive for ${l.sku}`);
    const price = new Money(l.override_price ?? l.unit_price);
    if (price.isNegative()) throw new Error(`Price cannot be negative for ${l.sku}`);
    const gross = l.fixed_line_total ? r2(new Money(l.fixed_line_total)) : r2(qty.mul(price));
    return { src: l, qty, price, gross, promo: Money.zero(), manual: Money.zero(), cart: Money.zero(), promos: [] as string[], freeQty: qty };
  });

  // Quantity promotions only apply to whole-unit, non-override, non-label lines.
  const eligible = (x: (typeof lines)[number]) => !x.src.override_price && !x.src.fixed_line_total && x.qty.eq(x.qty.floor(0));

  for (const p of promos) {
    if (p.type === 'TIERED' && p.tiers?.length) {
      for (const x of lines.filter((y) => eligible(y) && applies(p, y.src))) {
        const tier = [...p.tiers].sort((a, b) => new Money(b.min_qty).sub(a.min_qty).toDecimal().toNumber()).find((t) => x.qty.gte(t.min_qty));
        if (!tier) continue;
        const target = tier.unit_price ? r2(x.qty.mul(tier.unit_price)) : r2(x.gross.sub(x.gross.mul(tier.percent_off || '0').div(100)));
        const d = Money.min(Money.max(x.gross.sub(target), '0'), x.gross.sub(x.promo));
        if (d.isPositive()) {
          x.promo = x.promo.add(d);
          x.promos.push(p.code);
          addApplied(p, d);
        }
      }
    }
    if (p.type === 'BOGO') {
      const buy = new Money(p.buy_qty || '1');
      const get = new Money(p.get_qty || '1');
      const pct = new Money(p.get_discount_percent || '100');
      // Pool qualifying units, cheapest units are the "get" units (retail standard).
      const pool: { x: (typeof lines)[number]; price: Money }[] = [];
      for (const x of lines.filter((y) => eligible(y) && applies(p, y.src))) {
        const units = x.freeQty.toDecimal().toNumber();
        for (let i = 0; i < units; i++) pool.push({ x, price: x.price });
      }
      const groupSize = buy.add(get).toDecimal().toNumber();
      const groups = Math.floor(pool.length / groupSize);
      if (groups > 0) {
        pool.sort((a, b) => a.price.sub(b.price).toDecimal().toNumber());
        const freeUnits = pool.slice(0, groups * get.toDecimal().toNumber());
        const consumedUnits = pool.slice(0, groups * groupSize);
        for (const u of freeUnits) {
          const d = Money.min(r2(u.price.mul(pct).div(100)), u.x.gross.sub(u.x.promo));
          u.x.promo = u.x.promo.add(d);
          if (!u.x.promos.includes(p.code)) u.x.promos.push(p.code);
          addApplied(p, d);
        }
        for (const u of consumedUnits) u.x.freeQty = u.x.freeQty.sub(1);
      }
    }
    if (p.type === 'MIX_MATCH' && p.group_qty && p.group_price) {
      const n = new Money(p.group_qty).toDecimal().toNumber();
      const pool: { x: (typeof lines)[number]; price: Money }[] = [];
      for (const x of lines.filter((y) => eligible(y) && applies(p, y.src))) {
        const units = x.freeQty.toDecimal().toNumber();
        for (let i = 0; i < units; i++) pool.push({ x, price: x.price });
      }
      pool.sort((a, b) => b.price.sub(a.price).toDecimal().toNumber()); // most expensive first = best for customer
      const groups = Math.floor(pool.length / n);
      for (let g = 0; g < groups; g++) {
        const units = pool.slice(g * n, g * n + n);
        const normal = units.reduce((s, u) => s.add(u.price), Money.zero());
        const saving = Money.max(normal.sub(p.group_price), '0');
        if (!saving.isPositive()) continue;
        const shares = allocateProportional(saving.toFixed(2), units.map((u) => u.price.toFixed(8)));
        units.forEach((u, i) => {
          u.x.promo = u.x.promo.add(shares[i]);
          u.x.freeQty = u.x.freeQty.sub(1);
          if (!u.x.promos.includes(p.code)) u.x.promos.push(p.code);
        });
        addApplied(p, saving);
      }
    }
    if (p.type === 'BUNDLE' && p.components?.length && p.bundle_price) {
      // Number of complete bundles available.
      let bundles = Infinity;
      for (const c of p.components) {
        const have = lines.filter((y) => eligible(y) && y.src.item_id === c.item_id).reduce((s, y) => s.add(y.freeQty), Money.zero());
        bundles = Math.min(bundles, Math.floor(have.div(c.qty).toDecimal().toNumber()));
      }
      if (bundles > 0 && Number.isFinite(bundles)) {
        const parts: { x: (typeof lines)[number]; qty: Money }[] = [];
        for (const c of p.components) {
          let need = new Money(c.qty).mul(bundles);
          for (const y of lines.filter((z) => eligible(z) && z.src.item_id === c.item_id)) {
            if (!need.isPositive()) break;
            const take = Money.min(need, y.freeQty);
            if (take.isPositive()) parts.push({ x: y, qty: take });
            need = need.sub(take);
          }
        }
        const normal = parts.reduce((s, pt) => s.add(pt.x.price.mul(pt.qty)), Money.zero());
        const saving = Money.max(r2(normal.sub(new Money(p.bundle_price).mul(bundles))), '0');
        if (saving.isPositive()) {
          const shares = allocateProportional(saving.toFixed(2), parts.map((pt) => pt.x.price.mul(pt.qty).toFixed(8)));
          parts.forEach((pt, i) => {
            pt.x.promo = pt.x.promo.add(shares[i]);
            pt.x.freeQty = pt.x.freeQty.sub(pt.qty);
            if (!pt.x.promos.includes(p.code)) pt.x.promos.push(p.code);
          });
          addApplied(p, saving);
        }
      }
    }
  }

  // Manual line discounts on what remains after promotions.
  for (const x of lines) x.manual = discountOf(x.gross.sub(x.promo), x.src.line_discount);

  // Cart-level promotions, then the manual cart discount.
  const rejected: string[] = [];
  const remaining = () => lines.map((x) => x.gross.sub(x.promo).sub(x.manual).sub(x.cart));
  const sumRemaining = () => remaining().reduce((s, v) => s.add(v), Money.zero());
  const applyCart = (amount: Money, p?: Promotion) => {
    const base = sumRemaining();
    const amt = Money.min(r2(amount), base);
    if (!amt.isPositive()) return;
    const shares = allocateProportional(amt.toFixed(2), remaining().map((v) => v.toFixed(8)));
    lines.forEach((x, i) => {
      x.cart = x.cart.add(shares[i]);
      if (p && !x.promos.includes(p.code)) x.promos.push(p.code);
    });
    if (p) addApplied(p, amt);
  };
  for (const p of promos.filter((q) => q.type === 'COUPON' || q.type === 'CART_PERCENT')) {
    if (p.type === 'COUPON' && !(p.coupon_code && coupons.has(p.coupon_code.toUpperCase()))) continue;
    const base = sumRemaining();
    if (p.min_subtotal && base.lt(p.min_subtotal)) {
      if (p.coupon_code) rejected.push(p.coupon_code.toUpperCase());
      continue;
    }
    let amt = p.percent_off ? base.mul(p.percent_off).div(100) : new Money(p.amount_off || '0');
    if (p.max_discount) amt = Money.min(amt, p.max_discount);
    applyCart(amt, p);
  }
  for (const c of coupons) {
    if (!promos.some((p) => p.type === 'COUPON' && p.coupon_code?.toUpperCase() === c) && !rejected.includes(c)) rejected.push(c);
  }
  if (opts.cartDiscount) applyCart(discountOf(sumRemaining(), opts.cartDiscount));

  let subtotal = Money.zero(), promoT = Money.zero(), manualT = Money.zero(), cartT = Money.zero(), netT = Money.zero(), taxT = Money.zero();
  const priced: PricedCartLine[] = lines.map((x) => {
    const net = x.gross.sub(x.promo).sub(x.manual).sub(x.cart);
    const tax = r2(net.mul(x.src.tax_rate || '0').div(100));
    subtotal = subtotal.add(x.gross);
    promoT = promoT.add(x.promo);
    manualT = manualT.add(x.manual);
    cartT = cartT.add(x.cart);
    netT = netT.add(net);
    taxT = taxT.add(tax);
    return {
      ...x.src,
      effective_unit_price: x.price.toFixed(2),
      gross_amount: x.gross.toFixed(2),
      promo_discount: x.promo.toFixed(2),
      manual_discount: x.manual.toFixed(2),
      cart_discount: x.cart.toFixed(2),
      net_amount: net.toFixed(2),
      tax_amount: tax.toFixed(2),
      total_amount: net.add(tax).toFixed(2),
      applied_promotions: x.promos,
    };
  });
  return {
    lines: priced,
    subtotal: subtotal.toFixed(2),
    promo_discount_total: promoT.toFixed(2),
    manual_discount_total: manualT.toFixed(2),
    cart_discount_total: cartT.toFixed(2),
    discount_total: promoT.add(manualT).add(cartT).toFixed(2),
    net_total: netT.toFixed(2),
    tax_total: taxT.toFixed(2),
    grand_total: netT.add(taxT).toFixed(2),
    applied_promotions: [...applied.values()].map((a) => ({ id: a.id, code: a.code, name: a.name, amount: a.amount.toFixed(2) })),
    rejected_coupons: rejected,
  };
}

// ---------------------------------------------------------------------------
// Tenders
// ---------------------------------------------------------------------------

export type TenderType = 'CASH' | 'CARD' | 'WALLET' | 'STORE_CREDIT' | 'GIFT_CARD' | 'LOYALTY';
export const TENDER_TYPES: TenderType[] = ['CASH', 'CARD', 'WALLET', 'STORE_CREDIT', 'GIFT_CARD', 'LOYALTY'];

export interface TenderInput {
  type: TenderType;
  amount: string;
  reference?: string | null;
}

export interface SettledTenders {
  tenders: (TenderInput & { applied_amount: string })[];
  total_tendered: string;
  change_due: string;
  cash_rounding: string;
  amount_due: string;
}

/**
 * Validates a (split) payment. Rules: every tender > 0; only CASH may exceed the
 * balance (the excess is change); non-cash tenders may not over-tender; the sum
 * must cover the amount due. Optional cash rounding (e.g. to the nearest 1.00)
 * applies only when the remainder is settled in cash.
 */
export function settleTenders(amountDue: string, tenders: TenderInput[], opts: { cashRoundingIncrement?: string } = {}): SettledTenders {
  const due = new Money(amountDue);
  if (due.isNegative()) throw new Error('Amount due cannot be negative');
  if (tenders.length === 0 && !due.isZero()) throw new Error('At least one tender is required');
  let nonCash = Money.zero();
  let cash = Money.zero();
  for (const t of tenders) {
    if (!TENDER_TYPES.includes(t.type)) throw new Error(`Unsupported tender type ${t.type}`);
    const a = new Money(t.amount);
    if (!a.isPositive()) throw new Error('Tender amounts must be greater than zero');
    if (t.type === 'CASH') cash = cash.add(a);
    else nonCash = nonCash.add(a);
  }
  if (nonCash.gt(due)) throw new Error('Non-cash tenders cannot exceed the amount due (no change on card/wallet/credit)');
  let cashDue = due.sub(nonCash);
  let rounding = Money.zero();
  if (cash.isPositive() && opts.cashRoundingIncrement && new Money(opts.cashRoundingIncrement).isPositive()) {
    const inc = new Money(opts.cashRoundingIncrement);
    const rounded = cashDue.div(inc).round(0).mul(inc);
    rounding = rounded.sub(cashDue);
    cashDue = rounded;
  }
  if (cash.lt(cashDue)) throw new Error(`Insufficient tender: ${cash.add(nonCash).format()} tendered for ${due.add(rounding).format()} due`);
  const change = cash.sub(cashDue);
  let cashLeft = cashDue;
  const out = tenders.map((t) => {
    if (t.type !== 'CASH') return { ...t, applied_amount: new Money(t.amount).toFixed(2) };
    const applied = Money.min(t.amount, cashLeft);
    cashLeft = cashLeft.sub(applied);
    return { ...t, applied_amount: applied.toFixed(2) };
  });
  return { tenders: out, total_tendered: cash.add(nonCash).toFixed(2), change_due: change.toFixed(2), cash_rounding: rounding.toFixed(2), amount_due: due.add(rounding).toFixed(2) };
}

// ---------------------------------------------------------------------------
// Returns & refunds
// ---------------------------------------------------------------------------

export interface SoldLine {
  line_id: string;
  quantity: string;
  net_amount: string;
  tax_amount: string;
  returned_quantity: string;
  refunded_net: string;
  refunded_tax: string;
}

/**
 * Refund for returning `qty` units of a sold line: pro-rata of what the customer
 * actually paid (after all discounts), so a discounted item is refunded at its
 * discounted price. Returning the final unit refunds exactly the remainder, so the
 * sum of refunds always equals the amount paid (no rounding leakage).
 */
export function computeLineRefund(line: SoldLine, qty: string): { net: string; tax: string; total: string } {
  const q = new Money(qty);
  const sold = new Money(line.quantity);
  const remainingQty = sold.sub(line.returned_quantity);
  if (!q.isPositive()) throw new Error('Return quantity must be positive');
  if (q.gt(remainingQty)) throw new Error(`Cannot return ${q.format(3)}; only ${remainingQty.format(3)} remain returnable`);
  const remainingNet = new Money(line.net_amount).sub(line.refunded_net);
  const remainingTax = new Money(line.tax_amount).sub(line.refunded_tax);
  if (q.eq(remainingQty)) return { net: remainingNet.toFixed(2), tax: remainingTax.toFixed(2), total: remainingNet.add(remainingTax).toFixed(2) };
  const net = Money.min(r2(new Money(line.net_amount).mul(q).div(sold)), remainingNet);
  const tax = Money.min(r2(new Money(line.tax_amount).mul(q).div(sold)), remainingTax);
  return { net: net.toFixed(2), tax: tax.toFixed(2), total: net.add(tax).toFixed(2) };
}

export interface OriginalTender {
  tender_id: string;
  type: TenderType;
  applied_amount: string;
  refunded_amount: string;
  reference?: string | null;
}

/**
 * Allocates a refund back to the original tenders. Electronic/stored-value tenders
 * are refunded first (card, wallet, gift card, store credit, loyalty), cash last,
 * each capped at what is still refundable on it.
 */
export function allocateRefundToTenders(refund: string, tenders: OriginalTender[]): { tender_id: string; type: TenderType; amount: string; reference?: string | null }[] {
  let left = new Money(refund);
  const order: TenderType[] = ['CARD', 'WALLET', 'GIFT_CARD', 'STORE_CREDIT', 'LOYALTY', 'CASH'];
  const sorted = [...tenders].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const out: { tender_id: string; type: TenderType; amount: string; reference?: string | null }[] = [];
  for (const t of sorted) {
    if (!left.isPositive()) break;
    const cap = new Money(t.applied_amount).sub(t.refunded_amount);
    const take = Money.min(cap, left);
    if (take.isPositive()) {
      out.push({ tender_id: t.tender_id, type: t.type, amount: take.toFixed(2), reference: t.reference });
      left = left.sub(take);
    }
  }
  if (left.isPositive()) throw new Error(`Refund exceeds refundable tender balance by ${left.format()}`);
  return out;
}

// ---------------------------------------------------------------------------
// Shift / drawer
// ---------------------------------------------------------------------------

export function countDenominations(denoms: { value: string; count: number }[]): string {
  let total = Money.zero();
  for (const d of denoms) {
    if (!Number.isInteger(d.count) || d.count < 0) throw new Error('Denomination counts must be non-negative integers');
    if (!new Money(d.value).isPositive()) throw new Error('Denomination values must be positive');
    total = total.add(new Money(d.value).mul(d.count));
  }
  return total.toFixed(2);
}

export interface ShiftTotals {
  opening_float: string;
  cash_sales: string;
  cash_refunds: string;
  paid_in: string;
  paid_out: string;
  safe_drops: string;
}

export function expectedDrawer(t: ShiftTotals): string {
  return new Money(t.opening_float).add(t.cash_sales).sub(t.cash_refunds).add(t.paid_in).sub(t.paid_out).sub(t.safe_drops).toFixed(2);
}

export function drawerVariance(expected: string, counted: string): { variance: string; status: 'BALANCED' | 'OVER' | 'SHORT' } {
  const v = new Money(counted).sub(expected);
  return { variance: v.toFixed(2), status: v.isZero() ? 'BALANCED' : v.isPositive() ? 'OVER' : 'SHORT' };
}

// ---------------------------------------------------------------------------
// Loyalty
// ---------------------------------------------------------------------------

export interface LoyaltyConfig {
  /** Currency spent per point earned, e.g. "100" = 1 point per PKR 100 of net sales. */
  spend_per_point: string;
  /** Currency value of one point when redeemed, e.g. "1.00". */
  point_value: string;
}

export const DEFAULT_LOYALTY: LoyaltyConfig = { spend_per_point: '100', point_value: '1.00' };

export function pointsEarned(netAmount: string, cfg: LoyaltyConfig = DEFAULT_LOYALTY): number {
  const n = new Money(netAmount);
  if (!n.isPositive()) return 0;
  return n.div(cfg.spend_per_point).floor(0).toDecimal().toNumber();
}

export function redemptionValue(points: number, cfg: LoyaltyConfig = DEFAULT_LOYALTY): string {
  if (!Number.isInteger(points) || points < 0) throw new Error('Points must be a non-negative integer');
  return new Money(cfg.point_value).mul(points).toFixed(2);
}

export function pointsForAmount(amount: string, cfg: LoyaltyConfig = DEFAULT_LOYALTY): number {
  // Points needed to cover `amount` (rounded up to whole points).
  const pts = new Money(amount).div(cfg.point_value);
  const whole = pts.floor(0);
  return (whole.eq(pts) ? whole : whole.add(1)).toDecimal().toNumber();
}
