/**
 * Pure POS cart state for the terminal. No React, no network: everything here is
 * deterministic and unit-tested (apps/web/test/pos-cart.test.ts).
 *
 * Pricing is delegated to the same engine the server uses (priceCart), so the
 * totals the cashier sees offline are exactly what the server will book.
 * The server remains authoritative: it re-prices, re-checks approvals and stock.
 */
import { Money, parseScan, priceCart, DEFAULT_SCALE_CONFIG } from '@omnysync/financial-engine';
import type { CartLineInput, DiscountSpec, PricedCart, Promotion, ScaleBarcodeConfig, TenderInput } from '@omnysync/financial-engine';

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  uom?: string;
  unit_price: string;
  tax_rate: string;
  barcode?: string | null;
  plu_code?: string | null;
  is_weighed?: boolean;
  category?: string | null;
  on_hand?: string;
}

export interface Catalog {
  items: CatalogItem[];
  promotions: Promotion[];
  loyalty?: { spend_per_point: string; point_value: string };
  scale_barcodes?: ScaleBarcodeConfig;
  generated_at?: string;
}

export interface PosLine {
  line_id: string;
  item_id: string;
  sku: string;
  name: string;
  uom?: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  category?: string | null;
  is_weighed?: boolean;
  override_price?: string | null;
  /** Approval id for a price override (manager PIN). */
  approval_id?: string | null;
  line_discount?: DiscountSpec;
  scanned_code?: string | null;
  fixed_line_total?: string | null;
}

export interface PosCart {
  lines: PosLine[];
  customer?: { id: string; name: string; phone?: string | null; points_balance?: number | string; store_credit?: string } | null;
  coupon_codes: string[];
  cart_discount?: DiscountSpec;
  discount_approval_id?: string | null;
  /** Stable id used as the order client_ref; makes submission idempotent (offline replay). */
  client_ref: string;
  /** Index of the selected line for keyboard operations. */
  selected: number;
}

export const newClientRef = (): string =>
  `POS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export const emptyCart = (): PosCart => ({ lines: [], customer: null, coupon_codes: [], cart_discount: null, discount_approval_id: null, client_ref: newClientRef(), selected: -1 });

let seq = 0;
const lineId = () => `L${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Finds a catalogue item by exact barcode, SKU (case-insensitive) or PLU. */
export function findByCode(catalog: CatalogItem[], code: string): CatalogItem | undefined {
  const c = code.trim();
  if (!c) return undefined;
  const up = c.toUpperCase();
  return catalog.find((i) => i.barcode === c) || catalog.find((i) => i.code.toUpperCase() === up) || catalog.find((i) => i.plu_code === c);
}

/** Ranked fuzzy search over name / SKU / barcode. Prefix matches rank first. */
export function searchCatalog(catalog: CatalogItem[], term: string, limit = 30): CatalogItem[] {
  const t = term.trim().toLowerCase();
  if (!t) return catalog.slice(0, limit);
  const words = t.split(/\s+/);
  const scored: { item: CatalogItem; score: number }[] = [];
  for (const item of catalog) {
    const name = item.name.toLowerCase();
    const code = item.code.toLowerCase();
    const bc = (item.barcode || '').toLowerCase();
    if (!words.every((w) => name.includes(w) || code.includes(w) || bc.includes(w) || (item.plu_code || '') === w)) continue;
    let score = 0;
    if (bc === t || code === t) score += 100;
    if (code.startsWith(t) || bc.startsWith(t)) score += 50;
    if (name.startsWith(t)) score += 40;
    if (name.split(/\s+/).some((w) => w.startsWith(words[0]))) score += 10;
    scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, limit).map((s) => s.item);
}

export type ScanResult =
  | { ok: true; cart: PosCart; item: CatalogItem; incremented: boolean }
  | { ok: false; error: string };

/**
 * Adds a scanned / typed code to the cart.
 * - plain barcode / SKU / PLU: adds 1 (or `qty`) and auto-increments an identical existing line
 * - scale label (prefix 20/21 weight, 22/23 price): always a new line with the embedded weight / price
 */
export function addScan(cart: PosCart, catalog: Catalog, code: string, qty = '1'): ScanResult {
  const raw = code.trim();
  if (!raw) return { ok: false, error: 'Empty scan' };
  const parsed = parseScan(raw, catalog.scale_barcodes || DEFAULT_SCALE_CONFIG);
  if (parsed.kind === 'EMBEDDED_WEIGHT' || parsed.kind === 'EMBEDDED_PRICE') {
    const item = catalog.items.find((i) => i.plu_code === parsed.plu);
    if (!item) return { ok: false, error: `No item for scale PLU ${parsed.plu}` };
    if (parsed.kind === 'EMBEDDED_WEIGHT') {
      return { ok: true, item, incremented: false, cart: pushLine(cart, lineFrom(item, parsed.quantity, raw)) };
    }
    const price = new Money(item.unit_price);
    const q = price.isPositive() ? new Money(parsed.price).div(price).round(3).toFixed(3) : '1.000';
    return { ok: true, item, incremented: false, cart: pushLine(cart, { ...lineFrom(item, q, raw), fixed_line_total: parsed.price }) };
  }
  const item = findByCode(catalog.items, raw);
  if (!item) return { ok: false, error: `Item not found: ${raw}` };
  return addItem(cart, item, qty, raw);
}

/** Adds an item; merges into an existing plain line of the same item (auto-increment). */
export function addItem(cart: PosCart, item: CatalogItem, qty = '1', scanned?: string): ScanResult {
  if (!new Money(qty).isPositive()) return { ok: false, error: 'Quantity must be positive' };
  if (!item.is_weighed && !new Money(qty).eq(new Money(qty).floor(0))) return { ok: false, error: `${item.name} is sold in whole units` };
  const idx = cart.lines.findIndex((l) => l.item_id === item.id && !l.fixed_line_total && !l.override_price && !l.line_discount && !l.is_weighed);
  if (idx >= 0 && !item.is_weighed) {
    const lines = cart.lines.slice();
    lines[idx] = { ...lines[idx], quantity: new Money(lines[idx].quantity).add(qty).toFixed(3).replace(/\.?0+$/, '') };
    return { ok: true, item, incremented: true, cart: { ...cart, lines, selected: idx } };
  }
  return { ok: true, item, incremented: false, cart: pushLine(cart, lineFrom(item, qty, scanned)) };
}

function lineFrom(item: CatalogItem, qty: string, scanned?: string): PosLine {
  return {
    line_id: lineId(), item_id: item.id, sku: item.code, name: item.name, uom: item.uom, quantity: qty,
    unit_price: new Money(item.unit_price).toFixed(2), tax_rate: new Money(item.tax_rate || '0').toFixed(4),
    category: item.category ?? null, is_weighed: !!item.is_weighed, scanned_code: scanned ?? null,
  };
}

function pushLine(cart: PosCart, line: PosLine): PosCart {
  return { ...cart, lines: [...cart.lines, line], selected: cart.lines.length };
}

export function setQuantity(cart: PosCart, index: number, qty: string): PosCart | string {
  const l = cart.lines[index];
  if (!l) return 'No line selected';
  if (l.fixed_line_total) return 'Scale-label quantity cannot be changed; void and rescan';
  let m: Money;
  try { m = new Money(qty); } catch { return 'Invalid quantity'; }
  if (!m.isPositive()) return 'Quantity must be positive (use Void line to remove)';
  if (!l.is_weighed && !m.eq(m.floor(0))) return `${l.name} is sold in whole units`;
  if (m.gt(100000)) return 'Quantity too large';
  const lines = cart.lines.slice();
  lines[index] = { ...l, quantity: m.toFixed(3).replace(/\.?0+$/, '') };
  return { ...cart, lines };
}

export function voidLine(cart: PosCart, index: number): PosCart {
  const lines = cart.lines.filter((_, i) => i !== index);
  return { ...cart, lines, selected: lines.length === 0 ? -1 : Math.min(index, lines.length - 1) };
}

export function setLineDiscount(cart: PosCart, index: number, d: DiscountSpec): PosCart {
  const lines = cart.lines.slice();
  if (!lines[index]) return cart;
  lines[index] = { ...lines[index], line_discount: d && new Money(d.value).isPositive() ? d : null };
  return { ...cart, lines };
}

export function setPriceOverride(cart: PosCart, index: number, price: string | null, approvalId: string | null): PosCart {
  const lines = cart.lines.slice();
  if (!lines[index]) return cart;
  lines[index] = { ...lines[index], override_price: price, approval_id: price ? approvalId : null };
  return { ...cart, lines };
}

export function toEngineLines(cart: PosCart): CartLineInput[] {
  return cart.lines.map((l) => ({
    line_id: l.line_id, item_id: l.item_id, sku: l.sku, name: l.name, quantity: l.quantity, unit_price: l.unit_price,
    override_price: l.override_price ?? null, tax_rate: l.tax_rate, category: l.category ?? null, line_discount: l.line_discount ?? null,
    fixed_line_total: l.fixed_line_total ?? null,
  }));
}

export function priceLocal(cart: PosCart, promotions: Promotion[]): PricedCart {
  return priceCart(toEngineLines(cart), { promotions, couponCodes: cart.coupon_codes, cartDiscount: cart.cart_discount ?? null });
}

/** Share of manual (cashier-keyed) discount over the post-promotion base, as a percent string. */
export function manualDiscountPercent(p: PricedCart, promotions: Promotion[]): string {
  const coupon = p.applied_promotions
    .filter((a) => promotions.some((x) => x.id === a.id && (x.type === 'COUPON' || x.type === 'CART_PERCENT')))
    .reduce((s, a) => s.add(a.amount), Money.zero());
  const manual = new Money(p.manual_discount_total).add(p.cart_discount_total).sub(coupon);
  const base = new Money(p.subtotal).sub(p.promo_discount_total);
  if (!manual.isPositive()) return '0';
  return base.isZero() ? '100' : manual.div(base).mul(100).round(2).toFixed(2);
}

/** Body for POST /api/pos/orders. */
export function orderPayload(cart: PosCart, sessionId: string, tenders: TenderInput[]) {
  return {
    session_id: sessionId,
    client_ref: cart.client_ref,
    customer_id: cart.customer?.id || undefined,
    coupon_codes: cart.coupon_codes,
    cart_discount: cart.cart_discount || undefined,
    discount_approval_id: cart.discount_approval_id || undefined,
    lines: cart.lines.map((l) => ({
      item_id: l.item_id, quantity: l.quantity, override_price: l.override_price || undefined, approval_id: l.approval_id || undefined,
      line_discount: l.line_discount || undefined, scanned_code: l.scanned_code || undefined, fixed_line_total: l.fixed_line_total || undefined,
    })),
    tenders,
  };
}

// ---------------------------------------------------------------- tender helpers
export interface TenderSummary {
  paid: string;
  remaining: string;
  change: string;
  canComplete: boolean;
  error: string | null;
}

/**
 * Mirrors the server's settlement rules for live feedback while the cashier keys
 * tenders: only cash may exceed the balance, the sum must cover the amount due.
 */
export function summarizeTenders(amountDue: string, tenders: TenderInput[], opts: { cashRoundingIncrement?: string | null } = {}): TenderSummary & { rounding: string; due: string } {
  let due = new Money(amountDue);
  let paid = Money.zero();
  let nonCash = Money.zero();
  let cash = Money.zero();
  for (const t of tenders) {
    paid = paid.add(t.amount);
    if (t.type !== 'CASH') nonCash = nonCash.add(t.amount);
    else cash = cash.add(t.amount);
  }
  let error: string | null = null;
  if (nonCash.gt(due)) error = 'Non-cash tenders cannot exceed the amount due';
  // Same rule as the server (settleTenders): rounding applies to the cash-settled part only.
  let rounding = Money.zero();
  if (!error && cash.isPositive() && opts.cashRoundingIncrement && new Money(opts.cashRoundingIncrement).isPositive()) {
    const cashDue = due.sub(nonCash);
    rounding = new Money(roundCash(cashDue.toFixed(2), opts.cashRoundingIncrement)).sub(cashDue);
    due = due.add(rounding);
  }
  const remaining = due.sub(paid);
  const change = remaining.isNegative() && !error ? remaining.abs() : Money.zero();
  return {
    paid: paid.toFixed(2),
    remaining: (remaining.isPositive() ? remaining : Money.zero()).toFixed(2),
    change: change.toFixed(2),
    canComplete: !error && !remaining.isPositive() && (tenders.length > 0 || due.isZero()),
    error,
    rounding: rounding.toFixed(2),
    due: due.toFixed(2),
  };
}

/** Cash rounding (e.g. to the nearest 1.00) applied only when the balance is settled in cash. */
export function roundCash(amount: string, increment: string | null | undefined): string {
  if (!increment || !new Money(increment).isPositive()) return new Money(amount).toFixed(2);
  const inc = new Money(increment);
  return new Money(amount).div(inc).round(0).mul(inc).toFixed(2);
}

/** Quick-cash buttons: exact, then next round notes above the amount. */
export function quickCashOptions(amount: string): string[] {
  const a = new Money(amount);
  if (!a.isPositive()) return [];
  const out = new Set<string>([a.toFixed(2)]);
  for (const note of ['10', '50', '100', '500', '1000', '5000']) {
    const n = new Money(note);
    const next = a.div(n).floor(0).add(a.div(n).floor(0).mul(n).eq(a) ? 0 : 1).mul(n);
    if (next.gt(a)) out.add(next.toFixed(2));
    if (out.size >= 5) break;
  }
  return [...out];
}

// ---------------------------------------------------------------- persistence (offline tolerance)
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const CART_KEY = (registerId: string) => `omnysync.pos.cart.${registerId}`;
const QUEUE_KEY = 'omnysync.pos.outbox';
const CATALOG_KEY = (registerId: string) => `omnysync.pos.catalog.${registerId}`;

export function saveCart(kv: KV, registerId: string, cart: PosCart) {
  kv.setItem(CART_KEY(registerId), JSON.stringify(cart));
}

export function loadCart(kv: KV, registerId: string): PosCart | null {
  try {
    const raw = kv.getItem(CART_KEY(registerId));
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.lines) || typeof c.client_ref !== 'string') return null;
    return { ...emptyCart(), ...c };
  } catch {
    return null;
  }
}

export function saveCatalog(kv: KV, registerId: string, catalog: Catalog) {
  try { kv.setItem(CATALOG_KEY(registerId), JSON.stringify(catalog)); } catch { /* quota: cache is best-effort */ }
}

export function loadCatalog(kv: KV, registerId: string): Catalog | null {
  try {
    const raw = kv.getItem(CATALOG_KEY(registerId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export interface QueuedSale {
  client_ref: string;
  payload: ReturnType<typeof orderPayload>;
  queued_at: string;
  attempts: number;
  last_error?: string;
}

export function readQueue(kv: KV): QueuedSale[] {
  try {
    const q = JSON.parse(kv.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

/** Enqueue is idempotent per client_ref (a double-press never queues two sales). */
export function enqueueSale(kv: KV, payload: ReturnType<typeof orderPayload>, now = new Date()): QueuedSale[] {
  const q = readQueue(kv).filter((s) => s.client_ref !== payload.client_ref);
  q.push({ client_ref: payload.client_ref, payload, queued_at: now.toISOString(), attempts: 0 });
  kv.setItem(QUEUE_KEY, JSON.stringify(q));
  return q;
}

/**
 * Replays queued sales in order. `send` must throw an error with `offline: true`
 * for network failures (stop and keep the rest queued); any other error is a
 * business rejection that is kept with its message for supervisor follow-up.
 */
export async function flushQueue(kv: KV, send: (p: QueuedSale['payload']) => Promise<unknown>): Promise<{ sent: number; failed: QueuedSale[]; pending: number }> {
  const q = readQueue(kv);
  const keep: QueuedSale[] = [];
  const failed: QueuedSale[] = [];
  let sent = 0;
  let offline = false;
  for (const s of q) {
    if (offline) { keep.push(s); continue; }
    try {
      await send(s.payload);
      sent++;
    } catch (e: any) {
      const entry = { ...s, attempts: s.attempts + 1, last_error: String(e?.message || e) };
      if (e?.offline) { offline = true; keep.push(entry); } else { failed.push(entry); keep.push(entry); }
    }
  }
  kv.setItem(QUEUE_KEY, JSON.stringify(keep));
  return { sent, failed, pending: keep.length };
}

export function dropQueued(kv: KV, clientRef: string) {
  kv.setItem(QUEUE_KEY, JSON.stringify(readQueue(kv).filter((s) => s.client_ref !== clientRef)));
}
