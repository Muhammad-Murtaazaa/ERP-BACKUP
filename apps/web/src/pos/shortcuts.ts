/**
 * Single source of truth for the terminal's keyboard map. The key handler and the
 * on-screen cheat sheet both read this table, so they can never drift apart.
 */
export type PosCommand =
  | 'HELP' | 'SEARCH' | 'QTY' | 'DISCOUNT' | 'HOLD' | 'RECALL' | 'CUSTOMER' | 'RETURNS' | 'VOID_LINE' | 'REPRINT'
  | 'DRAWER' | 'PRICE' | 'PAY' | 'CASH_EXACT' | 'CARD' | 'COUPON' | 'CART_DISCOUNT' | 'VOID_CART' | 'CASH_MOVE'
  | 'X_REPORT' | 'CLOSE_SHIFT' | 'LINE_UP' | 'LINE_DOWN' | 'QTY_PLUS' | 'QTY_MINUS' | 'ESCAPE' | 'ORDERS' | 'GIFT_CARD';

export interface Shortcut {
  command: PosCommand;
  keys: string[];
  label: string;
  group: 'Sale' | 'Line' | 'Payment' | 'Customer' | 'Shift' | 'Navigation';
  /** Allowed while a text field (not the scan box) has focus. */
  global?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { command: 'HELP', keys: ['F1', 'Ctrl+/'], label: 'Show / hide shortcuts', group: 'Navigation', global: true },
  { command: 'SEARCH', keys: ['F2', 'Ctrl+F'], label: 'Product search (name / SKU / barcode)', group: 'Sale', global: true },
  { command: 'QTY', keys: ['F3', '*'], label: 'Set quantity of selected line', group: 'Line', global: true },
  { command: 'DISCOUNT', keys: ['F4'], label: 'Line discount (% or amount)', group: 'Line', global: true },
  { command: 'CART_DISCOUNT', keys: ['Shift+F4'], label: 'Cart discount', group: 'Sale', global: true },
  { command: 'HOLD', keys: ['F5'], label: 'Hold / park cart', group: 'Sale', global: true },
  { command: 'RECALL', keys: ['Shift+F5'], label: 'Recall held cart', group: 'Sale', global: true },
  { command: 'CUSTOMER', keys: ['F6'], label: 'Customer / loyalty lookup', group: 'Customer', global: true },
  { command: 'RETURNS', keys: ['F7', 'Ctrl+R'], label: 'Return / exchange', group: 'Sale', global: true },
  { command: 'VOID_LINE', keys: ['F8', 'Ctrl+Delete'], label: 'Void selected line', group: 'Line', global: true },
  { command: 'REPRINT', keys: ['F9'], label: 'Reprint last receipt', group: 'Sale', global: true },
  { command: 'DRAWER', keys: ['F10'], label: 'Open drawer (no sale, manager)', group: 'Shift', global: true },
  { command: 'PRICE', keys: ['F11', 'Ctrl+Shift+P'], label: 'Price override (manager PIN)', group: 'Line', global: true },
  { command: 'PAY', keys: ['F12', 'Ctrl+Enter'], label: 'Pay / tender', group: 'Payment', global: true },
  { command: 'CASH_EXACT', keys: ['Shift+F12'], label: 'Exact cash (fast tender)', group: 'Payment', global: true },
  { command: 'CARD', keys: ['Ctrl+F12'], label: 'Card for full balance', group: 'Payment', global: true },
  { command: 'GIFT_CARD', keys: ['Ctrl+G'], label: 'Sell / check gift card', group: 'Payment', global: true },
  { command: 'COUPON', keys: ['Ctrl+K'], label: 'Enter coupon code', group: 'Sale', global: true },
  { command: 'VOID_CART', keys: ['Ctrl+Shift+Delete'], label: 'Clear (void) entire cart', group: 'Sale', global: true },
  { command: 'ORDERS', keys: ['Ctrl+O'], label: 'Recent orders (void / reprint)', group: 'Sale', global: true },
  { command: 'CASH_MOVE', keys: ['Ctrl+M'], label: 'Paid in / paid out / safe drop', group: 'Shift', global: true },
  { command: 'X_REPORT', keys: ['Ctrl+Shift+X'], label: 'X report (mid-shift)', group: 'Shift', global: true },
  { command: 'CLOSE_SHIFT', keys: ['Ctrl+Shift+Z'], label: 'Close shift / Z report', group: 'Shift', global: true },
  { command: 'LINE_UP', keys: ['ArrowUp'], label: 'Select previous line', group: 'Line' },
  { command: 'LINE_DOWN', keys: ['ArrowDown'], label: 'Select next line', group: 'Line' },
  { command: 'QTY_PLUS', keys: ['+'], label: 'Selected line +1', group: 'Line' },
  { command: 'QTY_MINUS', keys: ['-'], label: 'Selected line −1', group: 'Line' },
  { command: 'ESCAPE', keys: ['Esc'], label: 'Close panel / back to scan', group: 'Navigation', global: true },
];

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** Normalises a keyboard event into the notation used in SHORTCUTS (e.g. "Ctrl+Shift+Delete"). */
export function keyCombo(e: KeyLike): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  let key = e.key === 'Escape' ? 'Esc' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.key === '?' ) key = '/';
  // Shift is only significant for non-printable keys or combos (Shift+F4, Ctrl+Shift+Z).
  if (e.shiftKey && (e.key.length > 1 || e.ctrlKey || e.metaKey)) parts.push('Shift');
  if (key === '*' || key === '+' || key === '-') return parts.length ? `${parts.join('+')}+${key}` : key;
  parts.push(key);
  return parts.join('+');
}

const index = new Map<string, Shortcut>();
for (const s of SHORTCUTS) for (const k of s.keys) index.set(k.toUpperCase(), s);

export function commandFor(e: KeyLike): Shortcut | undefined {
  return index.get(keyCombo(e).toUpperCase());
}

/** Detects barcode-scanner bursts: scanners type a whole code in a few ms then send Enter. */
export class ScanBuffer {
  private buf = '';
  private last = 0;
  constructor(private readonly maxGapMs = 35, private readonly minLength = 4) {}

  /** Feed a printable key; returns nothing. */
  push(ch: string, now: number) {
    if (now - this.last > this.maxGapMs) this.buf = '';
    this.buf += ch;
    this.last = now;
  }

  /** On Enter: returns the code when the burst looks machine-typed, else null. */
  enter(now: number): string | null {
    const code = this.buf;
    const fast = now - this.last <= this.maxGapMs * 3;
    this.buf = '';
    return fast && code.length >= this.minLength ? code : null;
  }

  reset() {
    this.buf = '';
  }
}
