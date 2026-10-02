/**
 * Big-box retail POS terminal (scan-first, keyboard-first, touch-friendly).
 *
 * - Pure cart logic: ../pos/cart.ts (unit-tested). Pricing uses the same engine as the server.
 * - Keyboard map: ../pos/shortcuts.ts (single source for the handler and the F1 cheat sheet).
 * - Side-drawer panels: ../pos/PosPanels.tsx.
 * - Offline tolerance: cart + catalogue persisted in localStorage; sales made while the API is
 *   unreachable are queued with their client_ref and replayed idempotently when it returns.
 * The server stays authoritative for prices, approvals, stock and postings.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Badge, Combobox } from '@omnysync/ui';
import { Money } from '@omnysync/financial-engine';
import type { PricedCart, TenderInput } from '@omnysync/financial-engine';
import {
  Barcode, Search, Hash, Percent, PauseCircle, UserRound, Undo2, Trash2, Printer, Inbox, Tag, Ticket, ListOrdered, Gift, Wallet,
  Keyboard, Store, Wifi, WifiOff, Maximize2, Minimize2, Minus, Plus, CreditCard, Banknote, LogOut, FileBarChart, Unlock,
} from 'lucide-react';
import { ApiClient, ApiRequestError } from '../api/client.js';
import {
  addItem, addScan, emptyCart, enqueueSale, flushQueue, loadCart, loadCatalog, manualDiscountPercent, orderPayload, priceLocal,
  readQueue, roundCash, saveCart, saveCatalog, setLineDiscount, setPriceOverride, setQuantity, voidLine,
  type Catalog, type CatalogItem, type PosCart,
} from '../pos/cart.js';
import { commandFor, type PosCommand } from '../pos/shortcuts.js';
import {
  CashPanel, CheatSheetPanel, CloseShiftPanel, CustomerPanel, DiscountPanel, errMsg, GiftCardPanel, HoldsPanel,
  OrdersPanel, PinPanel, PromptPanel, ReceiptPanel, ReportPanel, ReturnsPanel, SearchPanel, TenderPanel,
  type PosCustomer, type PromptSpec, type ReceiptView,
} from '../pos/PosPanels.js';
import { countTotal, countsToDenoms, DenominationGrid, fmt, FnTile, Kbd, Notice } from '../pos/ui.js';

type Panel = 'help' | 'search' | 'tender' | 'customer' | 'holds' | 'returns' | 'orders' | 'cash' | 'gift' | 'close' | null;
type CashType = 'PAID_IN' | 'PAID_OUT' | 'SAFE_DROP' | 'NO_SALE';

const kv = typeof window !== 'undefined' ? window.localStorage : (undefined as unknown as Storage);
const REGISTER_KEY = 'omnysync.pos.register';

/** Short confirmation / error tones (Web Audio; silent if unavailable). */
function beep(ok: boolean) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (beep as any).ctx || ((beep as any).ctx = new Ctx());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1560 : 220;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.06 : 0.25));
  } catch {
    /* audio is optional */
  }
}

const trimQty = (q: string) => new Money(q).toFixed(3).replace(/\.?0+$/, '');

export const PosTerminalView: React.FC = () => {
  const [me, setMe] = useState<{ name: string; permissions: string[] } | null>(null);
  const [registers, setRegisters] = useState<any[]>([]);
  const [registerId, setRegisterId] = useState<string>(() => kv?.getItem(REGISTER_KEY) || '');
  const [session, setSession] = useState<any | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog>({ items: [], promotions: [] });
  const [catalogStale, setCatalogStale] = useState(false);
  const [cart, setCartState] = useState<PosCart>(emptyCart());
  const [scanText, setScanText] = useState('');
  const [flash, setFlash] = useState<{ tone: 'success' | 'danger' | 'info' | 'warning'; text: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  const [panel, setPanel] = useState<Panel>(null);
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const [discountTarget, setDiscountTarget] = useState<{ scope: 'line' | 'cart'; index: number; name: string; base: string; current?: any } | null>(null);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [receiptIsSale, setReceiptIsSale] = useState(false);
  const [report, setReport] = useState<any | null>(null);
  const [cashType, setCashType] = useState<CashType>('SAFE_DROP');
  const [pinRequest, setPinRequest] = useState<{ action: string; context?: Record<string, unknown>; resolve: (id: string | null) => void } | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);

  // open-shift form
  const [openCounts, setOpenCounts] = useState<Record<string, string>>({ '1000': '4', '500': '1', '100': '5' });
  const [opening, setOpening] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);
  const cartListRef = useRef<HTMLTableSectionElement>(null);

  const isManager = !!me?.permissions?.includes('pos.register.manage');
  const register = registers.find((r) => r.id === (session?.register_id || registerId)) || null;
  const roundingInc = register && new Money(register.cash_rounding_increment || '0').isPositive() ? new Money(register.cash_rounding_increment).toFixed(2) : null;
  const discountLimit = register ? new Money(register.max_cashier_discount_percent ?? '10').toFixed(2) : '10.00';

  const say = useCallback((tone: 'success' | 'danger' | 'info' | 'warning', text: string) => {
    setFlash({ tone, text });
  }, []);

  const setCart = useCallback(
    (c: PosCart) => {
      setCartState(c);
      if (session?.register_id) saveCart(kv, session.register_id, c);
    },
    [session?.register_id],
  );

  const focusScan = useCallback(() => setTimeout(() => scanRef.current?.focus(), 0), []);

  // ------------------------------------------------------------ boot
  const loadCatalogFor = useCallback(async (regId: string) => {
    try {
      const c = await ApiClient.get(`/pos/catalog?register_id=${regId}`);
      setCatalog(c);
      setCatalogStale(false);
      saveCatalog(kv, regId, c);
      setOnline(true);
    } catch (e) {
      const cached = loadCatalog(kv, regId);
      if (cached) {
        setCatalog(cached);
        setCatalogStale(true);
      }
      if (e instanceof ApiRequestError && e.offline) setOnline(false);
    }
  }, []);

  const boot = useCallback(async () => {
    setBooting(true);
    setBootError(null);
    try {
      const [u, regs, active] = await Promise.all([ApiClient.get('/auth/me'), ApiClient.get('/pos/registers'), ApiClient.get('/pos/sessions/active')]);
      setMe(u);
      const list = Array.isArray(regs) ? regs : regs?.data || [];
      setRegisters(list);
      setSession(active || null);
      const regId = active?.register_id || (list.some((r: any) => r.id === registerId) ? registerId : list[0]?.id || '');
      setRegisterId(regId);
      if (active) {
        setCartState(loadCart(kv, active.register_id) || emptyCart());
        await loadCatalogFor(active.register_id);
      }
    } catch (e) {
      setBootError(errMsg(e));
      if (e instanceof ApiRequestError && e.offline) setOnline(false);
    } finally {
      setBooting(false);
    }
  }, [loadCatalogFor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.tone === 'danger' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [flash]);

  // ------------------------------------------------------------ offline outbox
  const flush = useCallback(async () => {
    if (readQueue(kv).length === 0) {
      setQueued(0);
      return;
    }
    const r = await flushQueue(kv, (p) => ApiClient.post('/pos/orders', p));
    setQueued(r.pending);
    if (r.sent > 0) {
      setOnline(true);
      say('success', `${r.sent} offline sale(s) synced to the server`);
    }
    if (r.failed.length > 0) say('danger', `Queued sale ${r.failed[0].client_ref} rejected: ${r.failed[0].last_error}. Call a supervisor.`);
  }, [say]);

  useEffect(() => {
    setQueued(readQueue(kv).length);
    flush();
    const t = setInterval(flush, 15_000);
    const on = () => {
      setOnline(true);
      flush();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [flush]);

  // ------------------------------------------------------------ pricing
  const priced: PricedCart | null = useMemo(() => {
    try {
      return priceLocal(cart, catalog.promotions || []);
    } catch {
      return null;
    }
  }, [cart, catalog.promotions]);
  const grand = priced?.grand_total || '0.00';
  const itemCount = cart.lines.reduce((s, l) => s.add(l.is_weighed || l.fixed_line_total ? 1 : l.quantity), Money.zero()).toFixed(0);
  const onHand = useMemo(() => new Map(catalog.items.map((i) => [i.id, i.on_hand || '0'])), [catalog.items]);

  useEffect(() => {
    // Keep the selected row in view for long baskets.
    const row = cartListRef.current?.querySelector(`[data-row="${cart.selected}"]`);
    (row as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }, [cart.selected, cart.lines.length]);

  // ------------------------------------------------------------ approvals
  const requestApproval = useCallback(
    (action: string, context?: Record<string, unknown>) =>
      new Promise<string | null>((resolve) => {
        setPinRequest({ action, context, resolve });
      }),
    [],
  );

  const logEvent = useCallback(
    (event_type: string, details: Record<string, unknown>) => {
      if (!session) return;
      ApiClient.post(`/pos/sessions/${session.id}/events`, { event_type, details }).catch(() => undefined);
    },
    [session],
  );

  // ------------------------------------------------------------ scanning
  const handleScan = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const mult = /^(\d+(?:\.\d+)?)\*(.+)$/.exec(text);
      const qty = mult ? mult[1] : '1';
      const code = mult ? mult[2].trim() : text;
      const r = addScan(cart, catalog, code, qty);
      if (r.ok) {
        setCart(r.cart);
        const l = r.cart.lines[r.cart.selected];
        beep(true);
        say('success', `${r.incremented ? 'Qty +' + qty : 'Added'}: ${r.item.name} · ${trimQty(l.quantity)} × ${fmt(l.override_price || l.unit_price)}`);
        if (new Money(onHand.get(r.item.id) || '0').lt(l.quantity)) say('warning', `${r.item.name}: only ${trimQty(onHand.get(r.item.id) || '0')} on hand. The sale may need a manager override.`);
        return;
      }
      // Not in the cached catalogue: ask the server (new item since last sync).
      if (online) {
        try {
          const found = await ApiClient.get(`/pos/lookup?code=${encodeURIComponent(code)}`);
          const item: CatalogItem = { ...found.item, on_hand: found.item.on_hand ?? '0' };
          setCatalog((c) => ({ ...c, items: [...c.items.filter((i) => i.id !== item.id), item] }));
          const a = found.fixed_line_total
            ? addScan(cart, { ...catalog, items: [...catalog.items, item] }, code)
            : addItem(cart, item, mult ? qty : found.quantity || '1', code);
          if (a.ok) {
            setCart(a.cart);
            beep(true);
            say('success', `Added: ${item.name}`);
            return;
          }
          say('danger', a.error);
          beep(false);
          return;
        } catch {
          /* fall through to not-found */
        }
      }
      beep(false);
      say('danger', r.error);
      logEvent('SCAN_NOT_FOUND', { code });
    },
    [cart, catalog, online, onHand, say, setCart, logEvent],
  );

  const pickItem = (item: CatalogItem) => {
    setPanel(null);
    if (item.is_weighed) {
      setPrompt({
        title: `Weigh: ${item.name}`,
        label: 'Weight (kg)',
        numeric: true,
        hint: `Price ${fmt(item.unit_price)} / kg. Or scan the scale label instead.`,
        onSubmit: (v) => {
          const r = addItem(cart, item, v || '0');
          if (!r.ok) return r.error;
          setCart(r.cart);
          focusScan();
          return null;
        },
      });
      return;
    }
    const r = addItem(cart, item, '1');
    if (r.ok) {
      setCart(r.cart);
      beep(true);
      say('success', `Added: ${item.name}`);
    } else say('danger', r.error);
    focusScan();
  };

  // ------------------------------------------------------------ sale submission
  const finishSale = (res: any) => {
    setLastOrderId(res.id);
    setCart(emptyCart());
    setPanel(null);
    setReceipt({ ...res.receipt, title: `Sale ${res.order_number}` });
    setReceiptIsSale(true);
    // Local stock deduction for the cached catalogue (server already posted the movement).
    const sold = new Map<string, Money>();
    for (const l of res.lines || []) sold.set(l.item_id, (sold.get(l.item_id) || Money.zero()).add(l.quantity));
    setCatalog((c) => ({ ...c, items: c.items.map((i) => (sold.has(i.id) ? { ...i, on_hand: new Money(i.on_hand || '0').sub(sold.get(i.id)!).toFixed(3) } : i)) }));
    say('success', new Money(res.change_due || '0').isPositive() ? `Change due ${fmt(res.change_due)}` : `Sale ${res.order_number} complete`);
    beep(true);
  };

  const submitSale = async (tenders: TenderInput[], extra: Record<string, string> = {}): Promise<void> => {
    if (!session || cart.lines.length === 0) return;
    setPaying(true);
    setPayError(null);
    const payload = { ...orderPayload(cart, session.id, tenders), ...extra };
    try {
      const res = await ApiClient.post('/pos/orders', payload);
      setOnline(true);
      finishSale(res);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'APPROVAL_REQUIRED' && !extra.discount_approval_id) {
        setPaying(false);
        const id = await requestApproval(e.details?.action || 'DISCOUNT', { total: grand });
        if (id) return submitSale(tenders, { ...extra, discount_approval_id: id });
        setPayError('Manager approval was cancelled');
        return;
      }
      if (e instanceof ApiRequestError && e.code === 'INSUFFICIENT_STOCK' && !extra.negative_stock_approval_id) {
        setPaying(false);
        setPayError(`${e.message}. A manager can approve selling below zero stock.`);
        const id = await requestApproval('NEGATIVE_STOCK', { message: e.message });
        if (id) return submitSale(tenders, { ...extra, negative_stock_approval_id: id });
        return;
      }
      if (e instanceof ApiRequestError && e.offline) {
        // Offline: park the sale in the outbox; client_ref makes the later replay idempotent.
        const q = enqueueSale(kv, payload);
        setQueued(q.length);
        setOnline(false);
        setCart(emptyCart());
        setPanel(null);
        say('warning', `Offline: sale saved on this terminal (${q.length} queued). It will post automatically when the server is back.`);
        return;
      }
      setPayError(errMsg(e));
      beep(false);
    } finally {
      setPaying(false);
    }
  };

  // ------------------------------------------------------------ commands
  const selectedLine = cart.selected >= 0 ? cart.lines[cart.selected] : undefined;
  const requireLine = () => {
    if (!selectedLine) {
      say('warning', 'Select a line first (↑/↓ or tap a row)');
      return false;
    }
    return true;
  };

  const holdCart = async () => {
    if (!session) return;
    if (cart.lines.length === 0) return setPanel('holds');
    try {
      const label = cart.customer?.name || `Hold ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      await ApiClient.post('/pos/holds', { session_id: session.id, cart, label, customer_id: cart.customer?.id, estimated_total: grand });
      setCart(emptyCart());
      say('info', `Cart held as “${label}”. Shift+F5 to recall.`);
    } catch (e) {
      say('danger', errMsg(e));
    }
  };

  const recall = async (id: string) => {
    if (!session) return;
    if (cart.lines.length > 0) return say('warning', 'Finish or hold the current cart before recalling another');
    try {
      const r = await ApiClient.post(`/pos/holds/${id}/recall`, { session_id: session.id });
      setCart({ ...emptyCart(), ...r.cart, client_ref: emptyCart().client_ref });
      setPanel(null);
      say('success', `Recalled “${r.label}”`);
      focusScan();
    } catch (e) {
      say('danger', errMsg(e));
    }
  };

  const reprintLast = async () => {
    if (!lastOrderId) return setPanel('orders');
    try {
      const r = await ApiClient.post(`/pos/orders/${lastOrderId}/reprint`, {});
      setReceipt({ ...r, title: 'Receipt reprint' });
      setReceiptIsSale(false);
    } catch (e) {
      say('danger', errMsg(e));
    }
  };

  const openXReport = async () => {
    if (!session) return;
    try {
      setReport(await ApiClient.get(`/pos/sessions/${session.id}/x-report`));
    } catch (e) {
      say('danger', errMsg(e));
    }
  };

  const bumpQty = (i: number, delta: 1 | -1) => {
    const l = cart.lines[i];
    if (!l) return;
    if (l.is_weighed || l.fixed_line_total) return say('warning', 'Weighed lines: use F3 or rescan');
    const next = new Money(l.quantity).add(delta);
    if (!next.isPositive()) {
      setCart(voidLine(cart, i));
      logEvent('LINE_VOIDED', { item: l.sku, name: l.name, quantity: l.quantity, unit_price: l.override_price || l.unit_price });
      return say('info', `Voided: ${l.name}`);
    }
    const r = setQuantity({ ...cart, selected: i }, i, next.toFixed(0));
    if (typeof r !== 'string') setCart({ ...r, selected: i });
    if (delta < 0) logEvent('QTY_CHANGED', { item: l.sku, from: l.quantity, to: next.toFixed(0) });
  };

  const run = (cmd: PosCommand) => {
    switch (cmd) {
      case 'HELP':
        return setPanel(panel === 'help' ? null : 'help');
      case 'SEARCH':
        return setPanel('search');
      case 'QTY':
        if (!requireLine()) return;
        return setPrompt({
          title: `Quantity: ${selectedLine!.name}`,
          label: selectedLine!.is_weighed ? 'Weight (kg)' : 'Quantity',
          numeric: true,
          initial: trimQty(selectedLine!.quantity),
          maxDecimals: selectedLine!.is_weighed ? 3 : 0,
          onSubmit: (v) => {
            const r = setQuantity(cart, cart.selected, v);
            if (typeof r === 'string') return r;
            if (new Money(v).lt(selectedLine!.quantity)) logEvent('QTY_CHANGED', { item: selectedLine!.sku, from: selectedLine!.quantity, to: v });
            setCart(r);
            focusScan();
            return null;
          },
        });
      case 'DISCOUNT':
        if (!requireLine() || !priced) return;
        return setDiscountTarget({ scope: 'line', index: cart.selected, name: selectedLine!.name, base: priced.lines[cart.selected].gross_amount, current: selectedLine!.line_discount });
      case 'CART_DISCOUNT':
        if (cart.lines.length === 0 || !priced) return say('warning', 'Cart is empty');
        return setDiscountTarget({ scope: 'cart', index: -1, name: 'Whole cart', base: new Money(priced.subtotal).sub(priced.promo_discount_total).toFixed(2), current: cart.cart_discount });
      case 'HOLD':
        return holdCart();
      case 'RECALL':
        return setPanel('holds');
      case 'CUSTOMER':
        return setPanel('customer');
      case 'RETURNS':
        return setPanel('returns');
      case 'VOID_LINE': {
        if (!requireLine()) return;
        const l = selectedLine!;
        setCart(voidLine(cart, cart.selected));
        logEvent('LINE_VOIDED', { item: l.sku, name: l.name, quantity: l.quantity, unit_price: l.override_price || l.unit_price });
        return say('info', `Voided: ${l.name}`);
      }
      case 'VOID_CART':
        if (cart.lines.length === 0) return;
        return setPrompt({
          title: 'Void entire cart',
          label: 'Reason',
          hint: `${cart.lines.length} line(s), ${fmt(grand)}. Logged to the shift audit trail.`,
          onSubmit: (v) => {
            if (!v) return 'A reason is required';
            logEvent('CART_VOIDED', { reason: v, lines: cart.lines.length, total: grand });
            setCart(emptyCart());
            say('info', 'Cart cleared');
            focusScan();
            return null;
          },
        });
      case 'REPRINT':
        return reprintLast();
      case 'DRAWER':
        setCashType('NO_SALE');
        return setPanel('cash');
      case 'CASH_MOVE':
        setCashType('SAFE_DROP');
        return setPanel('cash');
      case 'PRICE': {
        if (!requireLine()) return;
        const l = selectedLine!;
        if (l.fixed_line_total) return say('warning', 'Scale-label prices cannot be overridden; void and rescan');
        return setPrompt({
          title: `Price override: ${l.name}`,
          label: 'New unit price',
          numeric: true,
          maxDecimals: 2,
          initial: new Money(l.override_price || l.unit_price).toFixed(2),
          hint: `Shelf price ${fmt(l.unit_price)}. ${isManager ? 'You are authorised as a POS manager.' : 'A manager PIN is required.'}`,
          onSubmit: async (v) => {
            let price: Money;
            try {
              price = new Money(v);
            } catch {
              return 'Enter a valid price';
            }
            if (price.isNegative()) return 'Price cannot be negative';
            if (price.eq(l.unit_price)) {
              setCart(setPriceOverride(cart, cart.selected, null, null));
              return null;
            }
            let approvalId: string | null = null;
            if (!isManager) {
              approvalId = await requestApproval('PRICE_OVERRIDE', { item: l.sku, from: l.unit_price, to: price.toFixed(2) });
              if (!approvalId) return 'Manager approval cancelled';
            }
            setCart(setPriceOverride(cart, cart.selected, price.toFixed(2), approvalId));
            say('info', `Price of ${l.name} set to ${fmt(price.toFixed(2))}`);
            focusScan();
            return null;
          },
        });
      }
      case 'PAY':
        if (cart.lines.length === 0) return say('warning', 'Scan an item first');
        setPayError(null);
        return setPanel('tender');
      case 'CASH_EXACT':
        if (cart.lines.length === 0) return;
        return submitSale([{ type: 'CASH', amount: roundCash(grand, roundingInc) }]);
      case 'CARD':
        if (cart.lines.length === 0) return;
        return submitSale([{ type: 'CARD', amount: grand }]);
      case 'COUPON':
        return setPrompt({
          title: 'Coupon',
          label: 'Coupon code',
          hint: 'Scan or type the coupon. Conditions (minimum spend, items) are checked automatically.',
          onSubmit: (v) => {
            const code = v.toUpperCase();
            if (!code) return 'Enter a code';
            if (cart.coupon_codes.includes(code)) return 'Coupon already applied';
            const next = { ...cart, coupon_codes: [...cart.coupon_codes, code] };
            const p = priceLocal(next, catalog.promotions || []);
            if (p.rejected_coupons.includes(code)) return `${code} is not valid for this cart (unknown code or conditions not met)`;
            setCart(next);
            say('success', `Coupon ${code} applied`);
            return null;
          },
        });
      case 'GIFT_CARD':
        return setPanel('gift');
      case 'ORDERS':
        return setPanel('orders');
      case 'X_REPORT':
        return openXReport();
      case 'CLOSE_SHIFT':
        if (cart.lines.length > 0) return say('warning', 'Finish or hold the current sale before closing the shift');
        return setPanel('close');
      case 'LINE_UP':
        return cart.lines.length && setCart({ ...cart, selected: Math.max(0, (cart.selected < 0 ? cart.lines.length : cart.selected) - 1) });
      case 'LINE_DOWN':
        return cart.lines.length && setCart({ ...cart, selected: Math.min(cart.lines.length - 1, cart.selected + 1) });
      case 'QTY_PLUS':
      case 'QTY_MINUS':
        if (!requireLine()) return;
        return bumpQty(cart.selected, cmd === 'QTY_PLUS' ? 1 : -1);
      case 'ESCAPE':
        setScanText('');
        return focusScan();
    }
  };

  // ------------------------------------------------------------ global keyboard
  const anyOverlay = !!(panel || prompt || discountTarget || receipt || report || pinRequest);
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  handlerRef.current = (e: KeyboardEvent) => {
    if (!session) return;
    const sc = commandFor(e);
    if (anyOverlay) {
      // Drawers own the keyboard; only stop the browser's own F-key actions (help, reload, find…).
      if (/^F\d{1,2}$/.test(e.key)) e.preventDefault();
      if (sc?.command === 'HELP' && panel === 'help') setPanel(null);
      return;
    }
    const t = e.target as HTMLElement | null;
    const inScan = t === scanRef.current;
    const inField = !inScan && !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || !!t.closest?.('[role="combobox"]'));
    if (sc && (sc.global || !inField)) {
      const onlyWhenEmpty = ['QTY_PLUS', 'QTY_MINUS', 'LINE_UP', 'LINE_DOWN'].includes(sc.command) || (sc.command === 'QTY' && e.key === '*');
      if (onlyWhenEmpty && (inField || (inScan && scanText !== ''))) return;
      e.preventDefault();
      e.stopPropagation();
      run(sc.command);
      return;
    }
    // Any printable key outside a field goes to the scan box, so a scanner never "misses".
    if (!inField && !inScan && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setScanText((s) => s + e.key);
      scanRef.current?.focus();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  useEffect(() => {
    if (!anyOverlay && session) focusScan();
  }, [anyOverlay, session, focusScan]);

  // ------------------------------------------------------------ shift open
  const openShift = async () => {
    setOpening(true);
    setBootError(null);
    try {
      const s = await ApiClient.post('/pos/sessions/open', { register_id: registerId, opening_count: countsToDenoms(openCounts) });
      kv?.setItem(REGISTER_KEY, registerId);
      const active = await ApiClient.get('/pos/sessions/active');
      setSession(active || s);
      setCartState(loadCart(kv, registerId) || emptyCart());
      await loadCatalogFor(registerId);
      say('success', 'Shift opened. Ready to scan.');
    } catch (e) {
      setBootError(errMsg(e));
    } finally {
      setOpening(false);
    }
  };

  const [creatingReg, setCreatingReg] = useState(false);
  const createDefaultRegister = async () => {
    setCreatingReg(true);
    setBootError(null);
    try {
      await ApiClient.post('/pos/registers', {
        register_code: 'POS-01',
        name: 'Main Counter Register 1',
        default_tax_rate: '18',
        max_cashier_discount_percent: '10',
        receipt_header: 'OMNYSYNC RETAIL MART\nMain Counter Terminal',
        receipt_footer: 'Thank you for shopping!\nExchange within 14 days with receipt.',
      });
      await boot();
    } catch (e) {
      setBootError(errMsg(e));
    } finally {
      setCreatingReg(false);
    }
  };

  const onShiftClosed = (z: any) => {
    setPanel(null);
    setReport(z);
    setSession(null);
    setCartState(emptyCart());
    if (register) kv?.removeItem(`omnysync.pos.cart.${register.id}`);
  };

  const shell = focusMode ? 'fixed inset-0 z-30' : '-m-6 h-[calc(100vh-56px)]';

  if (booting) {
    return (
      <div className="flex items-center justify-center h-64 text-[14px] text-[#5E6A7D]" role="status">
        <span className="inline-block motion-safe:animate-spin h-5 w-5 border-2 border-[#5940B8] border-t-transparent rounded-full mr-2" aria-hidden="true" />
        Loading terminal…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        {report && <ReportPanel report={report} onClose={() => setReport(null)} />}
        <div className="rounded-[12px] border border-[#D9DFEA] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-12 w-12 rounded-[10px] bg-[#F2EEFF] text-[#5940B8] flex items-center justify-center"><Store size={24} aria-hidden="true" /></div>
            <div>
              <h1 className="text-[20px] font-bold text-[#182235]">Open shift</h1>
              <p className="text-[14px] text-[#46536B]">Count the opening float by denomination. The count is saved with the shift for accountability.</p>
            </div>
          </div>
          {bootError && <div className="mb-4"><Notice tone="danger">{bootError}</Notice></div>}
          {!bootError && registers.length === 0 ? (
            <div className="flex flex-col gap-4">
              <Notice tone="warning">No POS registers are set up yet for this organization.</Notice>
              {isManager ? (
                <div className="pt-2">
                  <Button size="md" onClick={createDefaultRegister} disabled={creatingReg}>
                    {creatingReg ? 'Creating register…' : 'Quick Setup: Create Default Register (POS-01)'}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-[#5E6A7D]">Please ask a store manager or administrator to configure a POS register for this organization.</p>
              )}
            </div>
          ) : registers.length > 0 ? (
            <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); openShift(); }}>
              <div className="flex flex-col gap-1">
                <Combobox label="Register" value={registerId} onChange={(e) => setRegisterId(e.target.value)} options={registers.map((r) => ({ value: r.id, label: `${r.register_code} · ${r.name}` }))} />
              </div>
              <DenominationGrid counts={openCounts} onChange={setOpenCounts} idPrefix="open" />
              <div className="flex items-center justify-between rounded-[10px] bg-[#F7F8FC] border border-[#D9DFEA] px-4 py-3">
                <span className="text-[14px] font-semibold text-[#46536B]">Opening float</span>
                <span className="text-[28px] font-bold tabular-nums text-[#182235]" data-testid="open-float">{fmt(countTotal(openCounts))}</span>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="lg" disabled={opening || !registerId}>{opening ? 'Opening…' : 'Open shift & start selling'}</Button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    );
  }

  const tiles: { cmd: PosCommand; label: string; hint: string; icon: React.ReactNode; tone?: 'default' | 'danger' }[] = [
    { cmd: 'SEARCH', label: 'Search', hint: 'F2', icon: <Search size={16} aria-hidden="true" /> },
    { cmd: 'QTY', label: 'Quantity', hint: 'F3 / *', icon: <Hash size={16} aria-hidden="true" /> },
    { cmd: 'DISCOUNT', label: 'Discount', hint: 'F4 · ⇧F4 cart', icon: <Percent size={16} aria-hidden="true" /> },
    { cmd: 'HOLD', label: cart.lines.length ? 'Hold' : 'Recall', hint: 'F5 · ⇧F5', icon: <PauseCircle size={16} aria-hidden="true" /> },
    { cmd: 'CUSTOMER', label: 'Customer', hint: 'F6', icon: <UserRound size={16} aria-hidden="true" /> },
    { cmd: 'RETURNS', label: 'Return', hint: 'F7', icon: <Undo2 size={16} aria-hidden="true" /> },
    { cmd: 'VOID_LINE', label: 'Void line', hint: 'F8', icon: <Trash2 size={16} aria-hidden="true" />, tone: 'danger' },
    { cmd: 'REPRINT', label: 'Reprint', hint: 'F9', icon: <Printer size={16} aria-hidden="true" /> },
    { cmd: 'DRAWER', label: 'No sale', hint: 'F10', icon: <Unlock size={16} aria-hidden="true" /> },
    { cmd: 'PRICE', label: 'Price', hint: 'F11', icon: <Tag size={16} aria-hidden="true" /> },
    { cmd: 'COUPON', label: 'Coupon', hint: 'Ctrl+K', icon: <Ticket size={16} aria-hidden="true" /> },
    { cmd: 'ORDERS', label: 'Orders', hint: 'Ctrl+O', icon: <ListOrdered size={16} aria-hidden="true" /> },
  ];

  const promoByLine = (i: number) => priced?.lines[i];

  return (
    <div className={`${shell} flex flex-col bg-[#F7F8FC]`} data-testid="pos-terminal">
      {/* status bar */}
      <div className="h-14 shrink-0 flex items-center justify-between gap-4 px-4 bg-white border-b border-[#D9DFEA]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-[8px] bg-[#5940B8] text-white flex items-center justify-center"><Store size={18} aria-hidden="true" /></div>
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-[#182235] truncate">{session.register_code || register?.register_code} · {session.register_name || register?.name}</div>
            <div className="text-[12px] text-[#46536B] truncate">Cashier {session.cashier_name} · business date {String(session.business_date || '').slice(0, 10)} · opened {new Date(session.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[12px] font-semibold ${online ? 'bg-[#EAF7EF] text-[#146341]' : 'bg-[#FFF4D6] text-[#7A4700]'}`}>
            {online ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}
            {online ? 'Online' : 'Offline mode'}
            {queued > 0 && ` · ${queued} queued`}
          </span>
          {catalogStale && <Badge variant="warning" size="sm">Cached catalogue</Badge>}
          {isManager && <Badge variant="brand" size="sm">Manager</Badge>}
          <span className="text-[14px] font-semibold tabular-nums text-[#182235] px-2" aria-label="Time">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <Button variant="secondary" size="sm" onClick={() => openXReport()} aria-keyshortcuts="Control+Shift+X"><FileBarChart size={14} className="mr-1" aria-hidden="true" /> X report</Button>
          <Button variant="secondary" size="sm" onClick={() => run('CASH_MOVE')} aria-keyshortcuts="Control+M"><Wallet size={14} className="mr-1" aria-hidden="true" /> Cash</Button>
          <Button variant="secondary" size="sm" onClick={() => run('GIFT_CARD')} aria-keyshortcuts="Control+G"><Gift size={14} className="mr-1" aria-hidden="true" /> Gift card</Button>
          <Button variant="secondary" size="sm" onClick={() => run('CLOSE_SHIFT')} aria-keyshortcuts="Control+Shift+Z"><LogOut size={14} className="mr-1" aria-hidden="true" /> Close shift</Button>
          <Button variant="quiet" size="sm" onClick={() => setPanel('help')} aria-keyshortcuts="F1"><Keyboard size={14} className="mr-1" aria-hidden="true" /> Shortcuts <Kbd className="ml-1">F1</Kbd></Button>
          <Button variant="quiet" size="sm" onClick={() => setFocusMode((f) => !f)} aria-pressed={focusMode} aria-label={focusMode ? 'Exit full-screen terminal' : 'Full-screen terminal'}>
            {focusMode ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_420px] gap-4 p-4">
        {/* ---------------- left: scan + basket */}
        <section aria-label="Basket" className="min-h-0 flex flex-col rounded-[10px] border border-[#D9DFEA] bg-white shadow-sm overflow-hidden">
          <form className="p-3 border-b border-[#D9DFEA] bg-white" onSubmit={(e) => { e.preventDefault(); const v = scanText; setScanText(''); handleScan(v); }}>
            <label htmlFor="pos-scan" className="sr-only">Scan or enter barcode, SKU or PLU</label>
            <div className="relative">
              <Barcode size={22} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5940B8]" aria-hidden="true" />
              <input
                ref={scanRef}
                id="pos-scan"
                value={scanText}
                onChange={(e) => setScanText(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Scan or type barcode / SKU / PLU · 3*code for quantity · F2 to search"
                className="w-full h-14 pl-12 pr-28 rounded-[10px] border-2 border-[#5940B8] bg-[#FBFAFF] text-[20px] font-semibold text-[#182235] placeholder:text-[15px] placeholder:font-normal placeholder:text-[#5E6A7D] focus:outline-none focus:ring-4 focus:ring-[#5B3CC4]/25"
                data-testid="scan-input"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[12px] text-[#5E6A7D]"><Kbd>Enter</Kbd> add</span>
            </div>
            <div aria-live="polite" className="min-h-[36px] mt-2">
              {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
            </div>
          </form>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <table className="w-full text-[15px]" aria-label="Cart lines" aria-rowcount={cart.lines.length}>
              <thead className="sticky top-0 z-10 bg-[#F7F8FC] text-[12px] uppercase tracking-wide text-[#5E6A7D] shadow-[inset_0_-1px_0_#D9DFEA]">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 text-left">#</th>
                  <th scope="col" className="px-3 py-2 text-left">Item</th>
                  <th scope="col" className="w-[150px] px-3 py-2 text-center">Qty</th>
                  <th scope="col" className="w-[110px] px-3 py-2 text-right">Price</th>
                  <th scope="col" className="w-[110px] px-3 py-2 text-right">Savings</th>
                  <th scope="col" className="w-[120px] px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody ref={cartListRef}>
                {cart.lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-20 text-center">
                      <Barcode size={40} className="mx-auto text-[#D9DFEA]" aria-hidden="true" />
                      <p className="mt-2 text-[16px] font-semibold text-[#46536B]">Ready: scan the first item</p>
                      <p className="text-[13px] text-[#5E6A7D]">or press <Kbd>F2</Kbd> to search · <Kbd>Shift+F5</Kbd> to recall a held cart · <Kbd>F1</Kbd> for all shortcuts</p>
                    </td>
                  </tr>
                )}
                {cart.lines.map((l, i) => {
                  const p = promoByLine(i);
                  const saving = p ? new Money(p.promo_discount).add(p.manual_discount).add(p.cart_discount) : Money.zero();
                  const sel = i === cart.selected;
                  const low = new Money(onHand.get(l.item_id) || '0').lt(l.quantity);
                  return (
                    <tr key={l.line_id} data-row={i} aria-selected={sel} onClick={() => setCart({ ...cart, selected: i })}
                      className={`cursor-pointer border-b border-[#EEF1F6] ${sel ? 'bg-[#F2EEFF] shadow-[inset_4px_0_0_#5940B8]' : 'hover:bg-[#F7F8FC]'}`}>
                      <td className="px-3 py-2 text-[13px] text-[#5E6A7D] tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 min-w-0">
                        <div className="font-semibold text-[#182235] truncate">{l.name}</div>
                        <div className="flex flex-wrap items-center gap-1 text-[12px] text-[#5E6A7D]">
                          <span className="font-mono">{l.sku}</span>
                          {l.is_weighed && <Badge size="sm" variant="info">weighed</Badge>}
                          {l.fixed_line_total && <Badge size="sm" variant="info">scale label</Badge>}
                          {l.override_price && <Badge size="sm" variant="warning">price override</Badge>}
                          {l.line_discount && <Badge size="sm" variant="warning">{l.line_discount.type === 'PERCENT' ? `${l.line_discount.value}% off` : `-${fmt(l.line_discount.value)}`}</Badge>}
                          {(p?.applied_promotions || []).map((code) => <Badge key={code} size="sm" variant="success">{code}</Badge>)}
                          {low && <Badge size="sm" variant="danger">low stock</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" tabIndex={-1} aria-label={`Decrease ${l.name}`} onClick={(e) => { e.stopPropagation(); bumpQty(i, -1); }} disabled={!!(l.is_weighed || l.fixed_line_total)} className="h-10 w-10 rounded-[8px] border border-[#D9DFEA] flex items-center justify-center hover:border-[#5940B8] disabled:opacity-30"><Minus size={16} aria-hidden="true" /></button>
                          <span className="min-w-[52px] text-center font-bold tabular-nums">{trimQty(l.quantity)}{l.is_weighed ? <span className="text-[11px] font-normal text-[#5E6A7D]"> kg</span> : null}</span>
                          <button type="button" tabIndex={-1} aria-label={`Increase ${l.name}`} onClick={(e) => { e.stopPropagation(); bumpQty(i, 1); }} disabled={!!(l.is_weighed || l.fixed_line_total)} className="h-10 w-10 rounded-[8px] border border-[#D9DFEA] flex items-center justify-center hover:border-[#5940B8] disabled:opacity-30"><Plus size={16} aria-hidden="true" /></button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.override_price ? (<><span className="block">{fmt(l.override_price)}</span><s className="block text-[12px] text-[#5E6A7D]">{fmt(l.unit_price)}</s></>) : fmt(l.unit_price)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#146341]">{saving.isPositive() ? `-${fmt(saving.toFixed(2))}` : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-[#182235]">{p ? fmt(p.total_amount) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-t border-[#D9DFEA] bg-[#F7F8FC] text-[13px] text-[#46536B]">
            <span><strong className="text-[#182235]">{cart.lines.length}</strong> lines · <strong className="text-[#182235]">{itemCount}</strong> items</span>
            <span className="flex flex-wrap items-center gap-1">
              {cart.coupon_codes.map((c) => (
                <button key={c} type="button" onClick={() => setCart({ ...cart, coupon_codes: cart.coupon_codes.filter((x) => x !== c) })} className="inline-flex items-center gap-1 h-7 px-2 rounded-full border border-[#B7E1C6] bg-[#EAF7EF] text-[12px] font-semibold text-[#146341]" aria-label={`Remove coupon ${c}`}>
                  <Ticket size={12} aria-hidden="true" /> {c} ×
                </button>
              ))}
              {cart.cart_discount && <Badge size="sm" variant="warning">cart {cart.cart_discount.type === 'PERCENT' ? `${cart.cart_discount.value}%` : fmt(cart.cart_discount.value)} off</Badge>}
            </span>
            <button type="button" onClick={() => run('VOID_CART')} disabled={cart.lines.length === 0} className="text-[#A82430] font-semibold hover:underline disabled:opacity-40">Void cart <Kbd className="ml-1">Ctrl+Shift+Del</Kbd></button>
          </div>
        </section>

        {/* ---------------- right: customer, totals, function keys, pay */}
        <aside aria-label="Totals and actions" className="min-h-0 flex flex-col gap-3 overflow-y-auto">
          <button type="button" onClick={() => run('CUSTOMER')} className="flex items-center justify-between gap-3 rounded-[10px] border border-[#D9DFEA] bg-white px-4 py-3 text-left hover:border-[#5940B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4]">
            <span className="flex items-center gap-3">
              <span className="h-10 w-10 rounded-full bg-[#F2EEFF] text-[#5940B8] flex items-center justify-center"><UserRound size={18} aria-hidden="true" /></span>
              <span>
                <span className="block text-[15px] font-semibold text-[#182235]">{cart.customer ? cart.customer.name : 'Walk-in customer'}</span>
                <span className="block text-[12px] text-[#5E6A7D]">{cart.customer ? `${cart.customer.points_balance ?? 0} loyalty pts${cart.customer.phone ? ' · ' + cart.customer.phone : ''}` : 'Attach loyalty member (F6)'}</span>
              </span>
            </span>
            <Kbd>F6</Kbd>
          </button>

          <div className="rounded-[10px] border border-[#D9DFEA] bg-white px-4 py-3" aria-label="Totals">
            {[
              ['Subtotal', priced?.subtotal],
              ['Promotions', priced && new Money(priced.promo_discount_total).isPositive() ? `-${fmt(priced.promo_discount_total)}` : null],
              ['Discounts', priced && new Money(priced.manual_discount_total).add(priced.cart_discount_total).isPositive() ? `-${fmt(new Money(priced.manual_discount_total).add(priced.cart_discount_total).toFixed(2))}` : null],
              ['Tax', priced?.tax_total],
            ].filter(([, v]) => v !== null).map(([k, v]) => (
              <div key={k as string} className="flex justify-between py-1 text-[14px]">
                <span className="text-[#46536B]">{k}</span>
                <span className={`tabular-nums ${String(v).startsWith('-') ? 'text-[#146341] font-semibold' : 'text-[#182235]'}`}>{String(v).startsWith('-') ? v : fmt(v as string)}</span>
              </div>
            ))}
            <div className="mt-2 pt-2 border-t border-[#D9DFEA] flex items-end justify-between">
              <span className="text-[14px] font-semibold uppercase text-[#46536B]">Total</span>
              <span className="text-[40px] leading-none font-bold tabular-nums text-[#182235]" data-testid="cart-total">{fmt(grand)}</span>
            </div>
            {roundingInc && <div className="text-right text-[12px] text-[#5E6A7D] mt-1">cash: {fmt(roundCash(grand, roundingInc))}</div>}
            {priced && manualDiscountPercent(priced, catalog.promotions || []) !== '0' && new Money(manualDiscountPercent(priced, catalog.promotions || [])).gt(discountLimit) && (
              <div className="mt-2"><Notice tone="warning">Manual discount {manualDiscountPercent(priced, catalog.promotions || [])}% exceeds the {discountLimit}% cashier limit: manager PIN at payment.</Notice></div>
            )}
            {!priced && cart.lines.length > 0 && <div className="mt-2"><Notice tone="danger">This cart cannot be priced; check discounts.</Notice></div>}
          </div>

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Function keys">
            {tiles.map((t) => <FnTile key={t.cmd} label={t.label} hint={t.hint} icon={t.icon} tone={t.tone} onClick={() => run(t.cmd)} />)}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <FnTile label="Exact cash" hint="Shift+F12" icon={<Banknote size={16} aria-hidden="true" />} onClick={() => run('CASH_EXACT')} disabled={cart.lines.length === 0 || paying} />
            <FnTile label="Card (full)" hint="Ctrl+F12" icon={<CreditCard size={16} aria-hidden="true" />} onClick={() => run('CARD')} disabled={cart.lines.length === 0 || paying} />
          </div>
          <button type="button" onClick={() => run('PAY')} disabled={cart.lines.length === 0} aria-keyshortcuts="F12"
            className="h-20 shrink-0 rounded-[12px] bg-[#146341] text-white flex items-center justify-between px-6 hover:bg-[#0F4F33] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5B3CC4]/40" data-testid="pay-button">
            <span className="text-left">
              <span className="block text-[22px] font-bold">Pay</span>
              <span className="block text-[12px] font-mono text-white/85">F12 · Ctrl+Enter</span>
            </span>
            <span className="text-[28px] font-bold tabular-nums">{fmt(grand)}</span>
          </button>
          {paying && <p role="status" className="text-center text-[13px] text-[#46536B]">Posting sale…</p>}
        </aside>
      </div>

      {/* hint bar */}
      <div className="shrink-0 h-10 flex items-center gap-4 px-4 border-t border-[#D9DFEA] bg-white text-[12px] text-[#46536B] overflow-x-auto" aria-label="Shortcut hints">
        {[['F1', 'Help'], ['F2', 'Search'], ['F3', 'Qty'], ['F4', 'Disc'], ['F5', 'Hold'], ['F6', 'Cust'], ['F7', 'Return'], ['F8', 'Void'], ['F9', 'Reprint'], ['F10', 'Drawer'], ['F11', 'Price'], ['F12', 'Pay'], ['↑↓', 'Line'], ['+/−', 'Qty ±1'], ['Esc', 'Scan']].map(([k, l]) => (
          <span key={k} className="flex items-center gap-1 whitespace-nowrap"><Kbd>{k}</Kbd>{l}</span>
        ))}
        <span className="ml-auto flex items-center gap-1 whitespace-nowrap"><Inbox size={12} aria-hidden="true" /> Cart autosaved on this terminal</span>
      </div>

      {/* ---------------- panels */}
      <CheatSheetPanel open={panel === 'help'} onClose={() => setPanel(null)} />
      <SearchPanel open={panel === 'search' && !pinRequest} items={catalog.items} onPick={pickItem} onClose={() => setPanel(null)} />
      <CustomerPanel open={panel === 'customer'} current={cart.customer as PosCustomer | null} onPick={(c) => { setCart({ ...cart, customer: c }); setPanel(null); if (c) say('success', `Customer: ${c.name} (${c.points_balance ?? 0} pts)`); }} onClose={() => setPanel(null)} />
      <HoldsPanel open={panel === 'holds'} registerId={session.register_id} onRecall={recall} onClose={() => setPanel(null)} />
      <TenderPanel open={panel === 'tender' && !pinRequest} amountDue={grand} roundingIncrement={roundingInc} customer={cart.customer} pointValue={catalog.loyalty?.point_value || '1.00'} busy={paying} error={payError} onComplete={(t) => submitSale(t)} onClose={() => setPanel(null)} />
      <ReturnsPanel open={panel === 'returns' && !pinRequest} sessionId={session.id} items={catalog.items} requestApproval={requestApproval}
        onDone={(r) => { setPanel(null); say('success', `Return ${r.return_number}: refunded ${fmt(r.total_amount)} ${r.refunds.map((x: any) => `${x.type} ${fmt(x.amount)}`).join(' + ')}${r.store_credit_code ? ` · store credit ${r.store_credit_code}` : ''}`); loadCatalogFor(session.register_id); }}
        onClose={() => setPanel(null)} />
      <OrdersPanel open={panel === 'orders' && !pinRequest} sessionId={session.id} requestApproval={requestApproval} onReceipt={(r) => { setReceipt(r); setReceiptIsSale(false); }} onChanged={(m) => { say('success', m); loadCatalogFor(session.register_id); }} onClose={() => setPanel(null)} />
      <CashPanel open={panel === 'cash' && !pinRequest} sessionId={session.id} requestApproval={requestApproval} initialType={cashType} onDone={(m) => { setPanel(null); say('success', m); }} onClose={() => setPanel(null)} />
      <GiftCardPanel open={panel === 'gift'} sessionId={session.id} onDone={(m) => say('success', m)} onClose={() => setPanel(null)} />
      <CloseShiftPanel open={panel === 'close' && !pinRequest} sessionId={session.id} requestApproval={requestApproval} onClosed={onShiftClosed} onClose={() => setPanel(null)} />
      <PromptPanel prompt={pinRequest ? null : prompt} onClose={() => { setPrompt(null); focusScan(); }} />
      <DiscountPanel target={discountTarget} limitPercent={discountLimit}
        onApply={(d) => {
          if (!discountTarget) return null;
          if (discountTarget.scope === 'line') setCart(setLineDiscount(cart, discountTarget.index, d));
          else setCart({ ...cart, cart_discount: d, discount_approval_id: null });
          return null;
        }}
        onClose={() => { setDiscountTarget(null); focusScan(); }} />
      <ReceiptPanel receipt={receipt} onClose={() => { setReceipt(null); focusScan(); }} onNewSale={receiptIsSale ? () => { setReceipt(null); focusScan(); } : undefined} />
      <ReportPanel report={report} onClose={() => setReport(null)} />
      <PinPanel request={pinRequest} sessionId={session.id}
        onApproved={(id, who) => { pinRequest?.resolve(id); setPinRequest(null); say('success', `Approved by ${who}`); }}
        onCancel={() => { pinRequest?.resolve(null); setPinRequest(null); }} />
    </div>
  );
};

export default PosTerminalView;
