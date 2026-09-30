/**
 * Side-drawer panels for the POS terminal. Every panel is keyboard-complete
 * (Enter submits, Esc closes via Drawer) and touch-friendly (>=56px targets).
 * Panels own their local state; the terminal passes callbacks.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Button, Badge } from '@omnysync/ui';
import { Money } from '@omnysync/financial-engine';
import type { TenderInput, TenderType } from '@omnysync/financial-engine';
import { Banknote, CreditCard, Gift, Smartphone, Star, Wallet, X as XIcon, Search, UserPlus, Printer, Mail } from 'lucide-react';
import { ApiClient, ApiRequestError } from '../api/client.js';
import { SHORTCUTS } from './shortcuts.js';
import { quickCashOptions, searchCatalog, summarizeTenders, type CatalogItem } from './cart.js';
import { applyKey, bigInput, countTotal, countsToDenoms, DenominationGrid, Field, fmt, Kbd, Keypad, Notice, textInput } from './ui.js';

export type RequestApproval = (action: string, context?: Record<string, unknown>) => Promise<string | null>;

export class ApprovalCancelled extends Error {
  constructor() {
    super('Manager approval cancelled');
  }
}

/** Runs `fn`; when the server answers APPROVAL_REQUIRED, asks for a manager PIN and retries once. */
export async function withApproval<T>(requestApproval: RequestApproval, action: string, fn: (approvalId?: string) => Promise<T>, context?: Record<string, unknown>): Promise<T> {
  try {
    return await fn(undefined);
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'APPROVAL_REQUIRED') {
      const id = await requestApproval(e.details?.action || action, context);
      if (!id) throw new ApprovalCancelled();
      return fn(id);
    }
    throw e;
  }
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const segBtn = (on: boolean) =>
  `h-12 rounded-[10px] border text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4] ${on ? 'bg-[#F2EEFF] border-[#5940B8] text-[#463091]' : 'bg-white border-[#D9DFEA] text-[#46536B] hover:border-[#5940B8]'}`;

// ---------------------------------------------------------------- cheat sheet
export const CheatSheetPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const groups = useMemo(() => {
    const m = new Map<string, typeof SHORTCUTS>();
    for (const s of SHORTCUTS) m.set(s.group, [...(m.get(s.group) || []), s]);
    return [...m.entries()];
  }, []);
  return (
    <Drawer isOpen={open} onClose={onClose} title="Keyboard shortcuts" subtitle="Everything on this terminal works without a mouse. Scan at any time: focus returns to the scan box automatically." size="2xl">
      <div className="grid grid-cols-2 gap-6">
        {groups.map(([g, list]) => (
          <section key={g} aria-labelledby={`cs-${g}`}>
            <h3 id={`cs-${g}`} className="text-[13px] font-semibold uppercase tracking-wide text-[#5E6A7D] mb-2">{g}</h3>
            <dl className="divide-y divide-[#EEF1F6] rounded-[10px] border border-[#D9DFEA]">
              {list.map((s) => (
                <div key={s.command} className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-[14px] text-[#182235]">{s.label}</dt>
                  <dd className="flex gap-1 shrink-0">{s.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <Notice tone="info"><strong>Quantity multiplier:</strong> type 3* then scan to add 3 units. Scanning the same item again adds one more.</Notice>
        <Notice tone="info"><strong>Scale labels:</strong> prefix 20/21 = weight, 22/23 = price-embedded; PLU codes (e.g. 00042) can be keyed directly.</Notice>
      </div>
    </Drawer>
  );
};

// ---------------------------------------------------------------- manager PIN
export const PinPanel: React.FC<{
  request: { action: string; context?: Record<string, unknown> } | null;
  sessionId: string | null;
  onApproved: (approvalId: string, approver: string) => void;
  onCancel: () => void;
}> = ({ request, sessionId, onApproved, onCancel }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setPin('');
    setError(null);
  }, [request]);
  const submit = async () => {
    if (!request || !sessionId || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ApiClient.post('/pos/approvals', { session_id: sessionId, action: request.action, pin, context: request.context });
      onApproved(r.approval_id, r.approver_name);
    } catch (e) {
      setError(errMsg(e));
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer isOpen={!!request} onClose={onCancel} title="Manager approval" subtitle={request ? `Action: ${request.action.replace(/_/g, ' ')}` : ''} size="sm" initialFocusRef={ref as React.RefObject<HTMLElement>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
        <Field label="Manager PIN" htmlFor="pos-pin" hint="A different user with POS manager rights enters their PIN. Each approval is single-use and expires in 5 minutes." error={error}>
          <input ref={ref} id="pos-pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} className={`${bigInput} tracking-[0.5em] text-center`} aria-invalid={!!error} />
        </Field>
        <Keypad allowDecimal={false} onKey={(k) => setPin((p) => (k === 'BACK' ? p.slice(0, -1) : k === '00' ? p : (p + k).slice(0, 8)))} />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" size="lg" onClick={onCancel}>Cancel <Kbd className="ml-2">Esc</Kbd></Button>
          <Button type="submit" size="lg" disabled={busy || pin.length < 4}>{busy ? 'Checking…' : 'Approve'} <Kbd className="ml-2">Enter</Kbd></Button>
        </div>
      </form>
    </Drawer>
  );
};

// ---------------------------------------------------------------- numeric / text prompt
export interface PromptSpec {
  title: string;
  label: string;
  initial?: string;
  hint?: string;
  numeric?: boolean;
  maxDecimals?: number;
  onSubmit: (v: string) => string | null | void | Promise<string | null | void>;
}

export const PromptPanel: React.FC<{ prompt: PromptSpec | null; onClose: () => void }> = ({ prompt, onClose }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setValue(prompt?.initial ?? '');
    setError(null);
    setTimeout(() => ref.current?.select(), 30);
  }, [prompt]);
  const submit = async () => {
    if (!prompt) return;
    const r = await prompt.onSubmit(value.trim());
    if (typeof r === 'string') setError(r);
    else onClose();
  };
  return (
    <Drawer isOpen={!!prompt} onClose={onClose} title={prompt?.title || ''} size="sm" initialFocusRef={ref as React.RefObject<HTMLElement>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
        <Field label={prompt?.label || ''} htmlFor="pos-prompt" hint={prompt?.hint} error={error}>
          <input ref={ref} id="pos-prompt" inputMode={prompt?.numeric ? 'decimal' : 'text'} autoComplete="off" value={value} onChange={(e) => setValue(prompt?.numeric ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value)} className={bigInput} aria-invalid={!!error} />
        </Field>
        {prompt?.numeric && <Keypad onKey={(k) => setValue((v) => applyKey(v, k, prompt.maxDecimals ?? 3))} />}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="lg">OK <Kbd className="ml-2">Enter</Kbd></Button>
        </div>
      </form>
    </Drawer>
  );
};

// ---------------------------------------------------------------- discount
export const DiscountPanel: React.FC<{
  target: { scope: 'line' | 'cart'; name: string; base: string; current?: { type: 'PERCENT' | 'AMOUNT'; value: string } | null } | null;
  limitPercent: string;
  onApply: (d: { type: 'PERCENT' | 'AMOUNT'; value: string } | null) => string | null;
  onClose: () => void;
}> = ({ target, limitPercent, onApply, onClose }) => {
  const [type, setType] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setType(target?.current?.type || 'PERCENT');
    setValue(target?.current?.value || '');
    setError(null);
  }, [target]);
  let pct = '0';
  try {
    if (value && target) pct = type === 'PERCENT' ? new Money(value).toFixed(2) : new Money(target.base).isZero() ? '0' : new Money(value).div(target.base).mul(100).round(2).toFixed(2);
  } catch {
    pct = '0';
  }
  const needsManager = new Money(pct).gt(limitPercent || '0');
  const submit = () => {
    const r = onApply(value ? { type, value } : null);
    if (r) setError(r);
    else onClose();
  };
  return (
    <Drawer isOpen={!!target} onClose={onClose} title={target?.scope === 'cart' ? 'Cart discount' : 'Line discount'} subtitle={target ? `${target.name} · base ${fmt(target.base)}` : ''} size="sm" initialFocusRef={ref as React.RefObject<HTMLElement>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Discount type" className="grid grid-cols-2 gap-2">
          {(['PERCENT', 'AMOUNT'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={segBtn(type === t)}>{t === 'PERCENT' ? 'Percent %' : 'Amount'}</button>
          ))}
        </div>
        <Field label={type === 'PERCENT' ? 'Discount %' : 'Discount amount'} htmlFor="pos-disc" error={error} hint={`Cashier limit ${limitPercent}% · this discount is about ${pct}%`}>
          <input ref={ref} id="pos-disc" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} className={bigInput} autoComplete="off" />
        </Field>
        {needsManager && <Notice tone="warning">Above the cashier limit: a manager PIN will be requested at payment.</Notice>}
        <Keypad onKey={(k) => setValue((v) => applyKey(v, k, 2))} />
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" variant="secondary" size="lg" onClick={() => { onApply(null); onClose(); }}>Remove</Button>
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="lg">Apply</Button>
        </div>
      </form>
    </Drawer>
  );
};

// ---------------------------------------------------------------- tender (split / multi-tender)
const TENDERS: { type: TenderType; label: string; icon: React.ReactNode; needsRef?: string; refRequired?: boolean }[] = [
  { type: 'CASH', label: 'Cash', icon: <Banknote size={20} aria-hidden="true" /> },
  { type: 'CARD', label: 'Card', icon: <CreditCard size={20} aria-hidden="true" />, needsRef: 'Card auth code / last 4 (optional)' },
  { type: 'WALLET', label: 'Wallet', icon: <Smartphone size={20} aria-hidden="true" />, needsRef: 'Wallet transaction ID (optional)' },
  { type: 'GIFT_CARD', label: 'Gift card', icon: <Gift size={20} aria-hidden="true" />, needsRef: 'Gift card code', refRequired: true },
  { type: 'STORE_CREDIT', label: 'Store credit', icon: <Wallet size={20} aria-hidden="true" />, needsRef: 'Store credit code', refRequired: true },
  { type: 'LOYALTY', label: 'Points', icon: <Star size={20} aria-hidden="true" /> },
];

export const TenderPanel: React.FC<{
  open: boolean;
  amountDue: string;
  roundingIncrement?: string | null;
  customer?: { name: string; points_balance?: number | string } | null;
  pointValue: string;
  busy: boolean;
  error: string | null;
  initial?: TenderInput[];
  onComplete: (tenders: TenderInput[]) => void;
  onClose: () => void;
}> = ({ open, amountDue, roundingIncrement, customer, pointValue, busy, error, initial, onComplete, onClose }) => {
  const [tenders, setTenders] = useState<TenderInput[]>([]);
  const [type, setType] = useState<TenderType>('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const summary = summarizeTenders(amountDue, tenders, { cashRoundingIncrement: roundingIncrement });

  useEffect(() => {
    if (open) {
      setTenders(initial || []);
      setType('CASH');
      setReference('');
      setLocal(null);
      setBalance(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setAmount(summary.remaining === '0.00' ? '' : summary.remaining);
  }, [summary.remaining, open]);

  const pointsMax = customer ? new Money(String(customer.points_balance || 0)).mul(pointValue).toFixed(2) : '0.00';
  const meta = TENDERS.find((t) => t.type === type)!;

  const lookupBalance = async (code: string) => {
    if (!code.trim() || (type !== 'GIFT_CARD' && type !== 'STORE_CREDIT')) return;
    try {
      const r = await ApiClient.get(`/pos/stored-value/${encodeURIComponent(code.trim().toUpperCase())}?kind=${type}`);
      setBalance(fmt(r.balance));
      if (new Money(r.balance).lt(amount || '0')) setAmount(new Money(r.balance).toFixed(2));
    } catch (e) {
      setBalance(null);
      setLocal(errMsg(e));
    }
  };

  const add = (amt?: string, t: TenderType = type) => {
    setLocal(null);
    let m: Money;
    try {
      m = new Money((amt ?? amount).trim());
    } catch {
      return setLocal('Enter a valid amount');
    }
    if (!m.isPositive()) return setLocal('Amount must be greater than zero');
    if (t !== 'CASH' && m.gt(summary.remaining)) return setLocal('Only cash can exceed the balance (change is given in cash)');
    const tm = TENDERS.find((x) => x.type === t)!;
    if (tm.refRequired && !reference.trim()) return setLocal(`${tm.needsRef} is required`);
    if (t === 'LOYALTY') {
      if (!customer) return setLocal('Attach a loyalty customer first (F6)');
      if (m.gt(pointsMax)) return setLocal(`Customer has ${fmt(pointsMax)} in points`);
    }
    const next = [...tenders, { type: t, amount: m.toFixed(2), reference: reference.trim() ? reference.trim().toUpperCase() : undefined }];
    setTenders(next);
    setReference('');
    setBalance(null);
    // After a card / wallet / stored-value part-payment the remainder is usually cash.
    if (t !== 'CASH') setType('CASH');
    if (summarizeTenders(amountDue, next, { cashRoundingIncrement: roundingIncrement }).canComplete) onComplete(next);
    else amountRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Alt+1..6 pick a tender type without leaving the amount field.
    if (e.altKey && /^[1-6]$/.test(e.key)) {
      e.preventDefault();
      setType(TENDERS[Number(e.key) - 1].type);
    }
  };

  return (
    <Drawer isOpen={open} onClose={onClose} title="Payment" subtitle="Split across any number of tenders. Only cash can exceed the balance." size="4xl" initialFocusRef={amountRef as React.RefObject<HTMLElement>} dirty={tenders.length > 0 && !busy} confirmMessage="Discard entered tenders?">
      <div className="grid grid-cols-[1fr_260px] gap-6" onKeyDown={onKeyDown}>
        <div className="flex flex-col gap-4 min-w-0">
          <div className="grid grid-cols-3 gap-2 rounded-[10px] bg-[#F7F8FC] border border-[#D9DFEA] p-3">
            <div>
              <div className="text-[12px] font-semibold uppercase text-[#5E6A7D]">Amount due</div>
              <div className="text-[28px] font-bold tabular-nums text-[#182235]" data-testid="tender-due">{fmt(summary.due)}</div>
              {summary.rounding !== '0.00' && <div className="text-[12px] text-[#46536B]">cash rounding {fmt(summary.rounding)}</div>}
            </div>
            <div>
              <div className="text-[12px] font-semibold uppercase text-[#5E6A7D]">Remaining</div>
              <div className={`text-[28px] font-bold tabular-nums ${summary.remaining === '0.00' ? 'text-[#146341]' : 'text-[#A82430]'}`} data-testid="tender-remaining">{fmt(summary.remaining)}</div>
            </div>
            <div>
              <div className="text-[12px] font-semibold uppercase text-[#5E6A7D]">Change</div>
              <div className="text-[28px] font-bold tabular-nums text-[#234FA3]" data-testid="tender-change">{fmt(summary.change)}</div>
            </div>
          </div>
          <div role="radiogroup" aria-label="Tender type" className="grid grid-cols-6 gap-2">
            {TENDERS.map((t, i) => (
              <button key={t.type} type="button" role="radio" aria-checked={type === t.type} aria-keyshortcuts={`Alt+${i + 1}`} disabled={t.type === 'LOYALTY' && !customer}
                onClick={() => { setType(t.type); amountRef.current?.focus(); }}
                className={`flex flex-col items-center justify-center gap-1 h-[76px] rounded-[10px] border text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4] disabled:opacity-40 ${type === t.type ? 'bg-[#5940B8] border-[#5940B8] text-white' : 'bg-white border-[#D9DFEA] text-[#182235] hover:border-[#5940B8]'}`}>
                {t.icon}
                {t.label}
                <span className={`text-[10px] font-mono ${type === t.type ? 'text-white/80' : 'text-[#5E6A7D]'}`}>Alt+{i + 1}</span>
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (summary.canComplete) onComplete(tenders); else add(); }} className="flex flex-col gap-3">
            <Field label={`${meta.label} amount`} htmlFor="tender-amount" error={local || summary.error} hint={type === 'LOYALTY' ? `Available: ${fmt(pointsMax)} (${customer?.points_balance ?? 0} pts)` : 'Enter adds the tender; the sale completes automatically once fully paid.'}>
              <input ref={amountRef} id="tender-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} className={bigInput} />
            </Field>
            {meta.needsRef && (
              <Field label={meta.needsRef} htmlFor="tender-ref" hint={balance ? `Balance ${balance}` : undefined}>
                <input id="tender-ref" value={reference} onChange={(e) => setReference(e.target.value)} onBlur={(e) => lookupBalance(e.target.value)} className={textInput} autoComplete="off" />
              </Field>
            )}
            {type === 'CASH' && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick cash">
                {quickCashOptions(summary.remaining === '0.00' ? amountDue : summary.remaining).map((q, i) => (
                  <button key={q} type="button" onClick={() => add(q, 'CASH')} className="h-12 px-4 rounded-[10px] border border-[#D9DFEA] bg-white text-[16px] font-semibold tabular-nums hover:border-[#5940B8] hover:bg-[#F2EEFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4]">
                    {i === 0 ? `Exact ${fmt(q)}` : fmt(q)}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" size="lg" onClick={() => add()} disabled={busy}>Add tender</Button>
              <Button type="button" size="lg" onClick={() => onComplete(tenders)} disabled={!summary.canComplete || busy} className="bg-[#146341] hover:bg-[#0F4F33]">{busy ? 'Posting…' : 'Complete sale'}</Button>
            </div>
            {error && <Notice tone="danger">{error}</Notice>}
            {/* Enables Enter-to-submit with two text fields (implicit submission needs a submit button). */}
            <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">Add</button>
          </form>
        </div>
        <div className="flex flex-col gap-3">
          <Keypad onKey={(k) => setAmount((v) => applyKey(v, k, 2))} />
          <div className="rounded-[10px] border border-[#D9DFEA]">
            <div className="px-3 py-2 border-b border-[#D9DFEA] text-[12px] font-semibold uppercase text-[#5E6A7D]">Tenders ({tenders.length})</div>
            {tenders.length === 0 ? (
              <p className="px-3 py-4 text-[13px] text-[#5E6A7D]">No tenders yet.</p>
            ) : (
              <ul>
                {tenders.map((t, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 border-b last:border-0 border-[#EEF1F6] text-[14px]">
                    <span><span className="font-semibold">{TENDERS.find((x) => x.type === t.type)?.label}</span>{t.reference && <span className="ml-1 text-[12px] text-[#5E6A7D]">{t.reference}</span>}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      {fmt(t.amount)}
                      <button type="button" aria-label={`Remove ${t.type} tender`} onClick={() => setTenders(tenders.filter((_, j) => j !== i))} className="p-1 rounded hover:bg-[#FDECEF] text-[#A82430] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4]"><XIcon size={14} aria-hidden="true" /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Drawer>
  );
};

// ---------------------------------------------------------------- product search
export const SearchPanel: React.FC<{ open: boolean; items: CatalogItem[]; onPick: (item: CatalogItem) => void; onClose: () => void }> = ({ open, items, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [cat, setCat] = useState<string>('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);
  const cats = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))] as string[], [items]);
  const results = useMemo(() => searchCatalog(cat ? items.filter((i) => i.category === cat) : items, q, 40), [items, q, cat]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); onPick(results[active]); }
  };
  return (
    <Drawer isOpen={open} onClose={onClose} title="Product search" subtitle="Name, SKU, barcode or PLU · ↑/↓ to move · Enter to add" size="2xl" initialFocusRef={ref as React.RefObject<HTMLElement>}>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5E6A7D]" aria-hidden="true" />
          <input ref={ref} role="combobox" aria-expanded="true" aria-controls="pos-search-results" aria-activedescendant={results[active] ? `psr-${results[active].id}` : undefined} aria-label="Search products"
            value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} className={`${bigInput} pl-12 text-[20px]`} autoComplete="off" />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
          {['', ...cats].map((c) => (
            <button key={c || 'all'} type="button" onClick={() => setCat(c)} aria-pressed={cat === c} className={`h-9 px-3 rounded-full border text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4] ${cat === c ? 'bg-[#5940B8] border-[#5940B8] text-white' : 'bg-white border-[#D9DFEA] text-[#46536B] hover:border-[#5940B8]'}`}>{c || 'All'}</button>
          ))}
        </div>
        <ul id="pos-search-results" role="listbox" aria-label="Products" className="grid grid-cols-2 gap-2">
          {results.length === 0 && <li className="col-span-2 py-8 text-center text-[14px] text-[#5E6A7D]">No products match “{q}”.</li>}
          {results.map((it, i) => {
            const stock = new Money(it.on_hand || '0');
            return (
              <li key={it.id} id={`psr-${it.id}`} role="option" aria-selected={i === active}>
                <button type="button" tabIndex={-1} onClick={() => onPick(it)} onMouseEnter={() => setActive(i)}
                  className={`w-full min-h-[64px] text-left rounded-[10px] border px-3 py-2 flex items-center justify-between gap-2 ${i === active ? 'border-[#5940B8] bg-[#F2EEFF]' : 'border-[#D9DFEA] bg-white hover:border-[#5940B8]'}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold text-[#182235]">{it.name}</span>
                    <span className="block text-[12px] text-[#5E6A7D] font-mono">{it.code}{it.barcode ? ` · ${it.barcode}` : ''}{it.plu_code ? ` · PLU ${it.plu_code}` : ''}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[15px] font-bold tabular-nums">{fmt(it.unit_price)}{it.is_weighed ? '/kg' : ''}</span>
                    <span className={`block text-[12px] tabular-nums ${stock.isPositive() ? 'text-[#146341]' : 'text-[#A82430]'}`}>stock {stock.toFixed(it.is_weighed ? 3 : 0)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Drawer>
  );
};

// ---------------------------------------------------------------- customer / loyalty
export interface PosCustomer {
  id: string;
  name: string;
  code?: string;
  phone?: string | null;
  email?: string | null;
  points_balance?: number | string;
  tier?: string;
  store_credit?: string;
}

export const CustomerPanel: React.FC<{ open: boolean; current?: PosCustomer | null; onPick: (c: PosCustomer | null) => void; onClose: () => void }> = ({ open, current, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PosCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        setRows(await ApiClient.get(`/pos/customers?q=${encodeURIComponent(q)}`));
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);
  const create = async () => {
    setError(null);
    try {
      const c = await ApiClient.post('/pos/customers', { name: form.name, phone: form.phone, email: form.email || undefined });
      onPick({ ...c, points_balance: 0 });
      setCreating(false);
      setForm({ name: '', phone: '', email: '' });
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <Drawer isOpen={open} onClose={onClose} title="Customer & loyalty" subtitle="Search by name, phone or code. Points are earned automatically on attached sales." size="lg" initialFocusRef={ref as React.RefObject<HTMLElement>}>
      <div className="flex flex-col gap-3">
        {current && (
          <Notice tone="success">
            Attached: <strong>{current.name}</strong> · {current.points_balance ?? 0} pts
            <button type="button" className="ml-2 underline font-semibold" onClick={() => onPick(null)}>Detach</button>
          </Notice>
        )}
        <input ref={ref} aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name / phone / code" className={textInput} autoComplete="off" />
        {error && <Notice tone="danger">{error}</Notice>}
        <ul className="flex flex-col gap-2" aria-busy={loading} aria-label="Customers">
          {!loading && rows.length === 0 && <li className="py-6 text-center text-[14px] text-[#5E6A7D]">No customers found.</li>}
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)} className="w-full min-h-[56px] rounded-[10px] border border-[#D9DFEA] bg-white px-3 py-2 text-left hover:border-[#5940B8] hover:bg-[#F2EEFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4] flex justify-between items-center">
                <span>
                  <span className="block text-[15px] font-semibold text-[#182235]">{c.name}</span>
                  <span className="block text-[12px] text-[#5E6A7D]">{c.code} {c.phone ? `· ${c.phone}` : ''}</span>
                </span>
                <span className="text-right">
                  <Badge variant="brand" size="sm">{c.points_balance ?? 0} pts</Badge>
                  {c.store_credit && new Money(c.store_credit).isPositive() && <span className="block text-[12px] text-[#146341] mt-1">credit {fmt(c.store_credit)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!creating ? (
          <Button type="button" variant="secondary" onClick={() => setCreating(true)}><UserPlus size={16} aria-hidden="true" className="mr-2" /> New loyalty customer</Button>
        ) : (
          <form className="flex flex-col gap-3 rounded-[10px] border border-[#D9DFEA] p-3" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <Field label="Name" htmlFor="nc-name"><input id="nc-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={textInput} /></Field>
            <Field label="Phone" htmlFor="nc-phone" hint="7–32 digits; used for lookup at the till"><input id="nc-phone" required inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={textInput} /></Field>
            <Field label="Email (optional, for e-receipts)" htmlFor="nc-email"><input id="nc-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={textInput} /></Field>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="quiet" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit">Create & attach</Button>
            </div>
          </form>
        )}
      </div>
    </Drawer>
  );
};

// ---------------------------------------------------------------- held carts
export const HoldsPanel: React.FC<{ open: boolean; registerId: string; onRecall: (id: string) => void; onClose: () => void }> = ({ open, registerId, onRecall, onClose }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setError(null);
    try {
      setRows(await ApiClient.get(`/pos/holds?register_id=${registerId}`));
    } catch (e) {
      setError(errMsg(e));
      setRows([]);
    }
  };
  useEffect(() => {
    if (open) {
      setRows(null);
      load();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const discard = async (id: string) => {
    try {
      await ApiClient.post(`/pos/holds/${id}/discard`, {});
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <Drawer isOpen={open} onClose={onClose} title="Held carts" subtitle="Parked sales on this register. Recall to continue; carts still held at shift close are discarded." size="lg">
      {error && <Notice tone="danger">{error}</Notice>}
      {rows === null ? (
        <p className="py-6 text-center text-[#5E6A7D]" aria-busy="true">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[#5E6A7D]">No held carts.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((h, i) => (
            <li key={h.id} className="flex items-center justify-between gap-2 rounded-[10px] border border-[#D9DFEA] px-3 py-2">
              <span>
                <span className="block text-[15px] font-semibold">{i + 1}. {h.label}</span>
                <span className="block text-[12px] text-[#5E6A7D]">{new Money(h.item_count).toFixed(0)} items · {fmt(h.estimated_total)} · {h.held_by_name} · {new Date(h.created_at).toLocaleTimeString()}</span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="quiet" onClick={() => discard(h.id)}>Discard</Button>
                <Button size="sm" onClick={() => onRecall(h.id)} autoFocus={i === 0}>Recall</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
};

// ---------------------------------------------------------------- receipt
export interface ReceiptView {
  text: string;
  html: string;
  email?: { subject: string };
  title?: string;
  reprint_count?: number;
}

export const ReceiptPanel: React.FC<{ receipt: ReceiptView | null; onClose: () => void; onNewSale?: () => void }> = ({ receipt, onClose, onNewSale }) => {
  const [view, setView] = useState<'text' | 'email'>('text');
  const print = () => {
    if (!receipt) return;
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return;
    const safe = receipt.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
    w.document.write(`<pre style="font:12px/1.35 ui-monospace,monospace;margin:0;padding:8px">${safe}</pre>`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <Drawer isOpen={!!receipt} onClose={onClose} title={receipt?.title || 'Receipt'} subtitle={receipt?.reprint_count ? `Reprint #${receipt.reprint_count} (logged)` : 'Print the slip, or use the email-ready version.'} size="lg"
      footer={
        <div className="flex justify-between w-full gap-2">
          <div className="flex gap-2">
            <Button variant={view === 'text' ? 'primary' : 'secondary'} size="sm" onClick={() => setView('text')}><Printer size={14} className="mr-1" aria-hidden="true" /> Slip</Button>
            <Button variant={view === 'email' ? 'primary' : 'secondary'} size="sm" onClick={() => setView('email')}><Mail size={14} className="mr-1" aria-hidden="true" /> Email-ready</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={print}>Print</Button>
            {onNewSale && <Button onClick={onNewSale} autoFocus>New sale <Kbd className="ml-2">Enter</Kbd></Button>}
          </div>
        </div>
      }>
      {receipt &&
        (view === 'text' ? (
          <pre data-testid="receipt-text" className="mx-auto w-fit rounded-[10px] border border-[#D9DFEA] bg-white px-4 py-3 font-mono text-[12px] leading-[1.35] text-[#182235] shadow-sm">{receipt.text}</pre>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-[#46536B]">Subject: <strong>{receipt.email?.subject}</strong>. Generated locally; the terminal sends no email (no external services).</p>
            <iframe title="Email receipt preview" sandbox="" srcDoc={receipt.html} className="w-full h-[520px] rounded-[10px] border border-[#D9DFEA] bg-white" />
          </div>
        ))}
    </Drawer>
  );
};

// ---------------------------------------------------------------- reports (X / Z)
const neg = (v: unknown) => (new Money(String(v ?? '0')).isZero() ? fmt('0') : `-${fmt(String(v))}`);

const ReportRow: React.FC<{ label: string; value: React.ReactNode; strong?: boolean }> = ({ label, value, strong }) => (
  <div className={`flex justify-between py-1.5 border-b border-[#EEF1F6] text-[14px] ${strong ? 'font-bold' : ''}`}>
    <span className="text-[#46536B]">{label}</span>
    <span className="tabular-nums text-[#182235]">{value}</span>
  </div>
);

export const ReportPanel: React.FC<{ report: any | null; onClose: () => void }> = ({ report, onClose }) => (
  <Drawer isOpen={!!report} onClose={onClose} title={report?.report_type === 'Z' ? `Z report #${report?.z_number}` : 'X report (read-only, mid-shift)'} subtitle={report ? `${report.register_code} · ${report.cashier_name} · business date ${report.business_date}` : ''} size="2xl">
    {report && (
      <div className="grid grid-cols-2 gap-6" data-testid="shift-report">
        <section>
          <h3 className="text-[13px] font-semibold uppercase text-[#5E6A7D] mb-1">Sales</h3>
          <ReportRow label="Transactions" value={report.sales_count} />
          <ReportRow label="Voids" value={report.void_count} />
          <ReportRow label="Gross sales" value={fmt(report.gross_sales)} />
          <ReportRow label="Discounts & promotions" value={fmt(report.discounts)} />
          <ReportRow label="Tax" value={fmt(report.tax)} />
          <ReportRow label="Net sales incl. tax" value={fmt(report.net_sales_incl_tax)} strong />
          <ReportRow label="Returns" value={`${report.returns_count} · ${fmt(report.returns_total)}`} />
          <h3 className="text-[13px] font-semibold uppercase text-[#5E6A7D] mt-4 mb-1">Tenders</h3>
          {(report.tenders || []).length === 0 ? <p className="text-[13px] text-[#5E6A7D]">No tenders.</p> : report.tenders.map((t: any) => <ReportRow key={t.type} label={`${t.type} (${t.count})`} value={fmt(t.amount)} />)}
        </section>
        <section>
          <h3 className="text-[13px] font-semibold uppercase text-[#5E6A7D] mb-1">Drawer</h3>
          <ReportRow label="Opening float" value={fmt(report.drawer?.opening_float)} />
          <ReportRow label="Cash sales" value={fmt(report.drawer?.cash_sales)} />
          <ReportRow label="Cash refunds" value={neg(report.drawer?.cash_refunds)} />
          <ReportRow label="Paid in" value={fmt(report.drawer?.paid_in)} />
          <ReportRow label="Paid out" value={neg(report.drawer?.paid_out)} />
          <ReportRow label="Safe drops" value={neg(report.drawer?.safe_drops)} />
          <ReportRow label="Expected cash" value={fmt(report.drawer?.expected_cash)} strong />
          {report.report_type === 'Z' && (
            <>
              <ReportRow label="Counted cash" value={fmt(report.counted_cash)} strong />
              <div className="my-2">
                <Badge variant={report.variance_status === 'BALANCED' ? 'success' : report.variance_status === 'OVER' ? 'warning' : 'danger'}>{report.variance_status} {fmt(report.variance)}</Badge>
              </div>
              <ReportRow label="Held carts discarded" value={report.held_carts_discarded} />
            </>
          )}
        </section>
      </div>
    )}
  </Drawer>
);

// ---------------------------------------------------------------- close shift (blind count)
export const CloseShiftPanel: React.FC<{ open: boolean; sessionId: string; requestApproval: RequestApproval; onClosed: (z: any) => void; onClose: () => void }> = ({ open, sessionId, requestApproval, onClosed, onClose }) => {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCounts({});
      setNotes('');
      setError(null);
    }
  }, [open]);
  const total = countTotal(counts);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await withApproval(requestApproval, 'CLOSE_VARIANCE', (approval_id) =>
        ApiClient.post(`/pos/sessions/${sessionId}/close`, { closing_count: countsToDenoms(counts), variance_notes: notes || undefined, approval_id }),
      );
      onClosed(r.z_report);
    } catch (e) {
      if (!(e instanceof ApprovalCancelled)) setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer isOpen={open} onClose={onClose} title="Close shift" subtitle="Blind count: count the drawer by denomination. The expected amount is revealed on the Z report." size="lg" dirty={Object.values(counts).some(Boolean)} confirmMessage="Discard the drawer count?">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
        <DenominationGrid counts={counts} onChange={setCounts} idPrefix="close" />
        <div className="flex justify-between items-center rounded-[10px] bg-[#F7F8FC] border border-[#D9DFEA] px-4 py-3">
          <span className="text-[14px] font-semibold text-[#46536B]">Counted total</span>
          <span className="text-[24px] font-bold tabular-nums" data-testid="close-count-total">{fmt(total)}</span>
        </div>
        <Field label="Variance notes" htmlFor="close-notes" hint="Required if the count differs from expected; a material variance also needs a manager PIN.">
          <textarea id="close-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-md border border-[#7D8799] text-[14px] focus:outline-none focus:ring-2 focus:ring-[#5B3CC4]" />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="destructive" disabled={busy}>{busy ? 'Closing…' : 'Close shift & print Z'}</Button>
        </div>
      </form>
    </Drawer>
  );
};

// ---------------------------------------------------------------- cash movements / no sale
type CashType = 'PAID_IN' | 'PAID_OUT' | 'SAFE_DROP' | 'NO_SALE';
export const CashPanel: React.FC<{ open: boolean; sessionId: string; requestApproval: RequestApproval; onDone: (msg: string) => void; onClose: () => void; initialType?: CashType }> = ({ open, sessionId, requestApproval, onDone, onClose, initialType }) => {
  const [type, setType] = useState<CashType>('SAFE_DROP');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setType(initialType || 'SAFE_DROP');
      setAmount('');
      setReason('');
      setError(null);
    }
  }, [open, initialType]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (type === 'NO_SALE') {
        await withApproval(requestApproval, 'NO_SALE', (approval_id) => ApiClient.post(`/pos/sessions/${sessionId}/drawer-open`, { reason, approval_id }));
        onDone('Drawer opened (no sale), logged');
      } else {
        await withApproval(requestApproval, 'PAID_OUT', (approval_id) => ApiClient.post(`/pos/sessions/${sessionId}/cash-movements`, { movement_type: type, amount, reason, approval_id }));
        onDone(`${type.replace('_', ' ')} of ${fmt(amount)} recorded`);
      }
    } catch (e) {
      if (!(e instanceof ApprovalCancelled)) setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const types: { v: CashType; l: string }[] = [
    { v: 'SAFE_DROP', l: 'Safe drop' },
    { v: 'PAID_IN', l: 'Paid in' },
    { v: 'PAID_OUT', l: 'Paid out' },
    { v: 'NO_SALE', l: 'No sale' },
  ];
  return (
    <Drawer isOpen={open} onClose={onClose} title="Drawer & cash movements" subtitle="Paid-outs and no-sale opens need a manager PIN. Every movement is journaled and appears on the X/Z report." size="md">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Movement type" className="grid grid-cols-4 gap-2">
          {types.map((t) => <button key={t.v} type="button" role="radio" aria-checked={type === t.v} onClick={() => setType(t.v)} className={segBtn(type === t.v)}>{t.l}</button>)}
        </div>
        {type !== 'NO_SALE' && (
          <Field label="Amount" htmlFor="cash-amt"><input id="cash-amt" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} className={bigInput} autoFocus /></Field>
        )}
        <Field label="Reason" htmlFor="cash-reason" hint="Recorded on the audit log"><input id="cash-reason" required value={reason} onChange={(e) => setReason(e.target.value)} className={textInput} /></Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record'}</Button>
        </div>
      </form>
    </Drawer>
  );
};

// ---------------------------------------------------------------- recent orders (reprint / void)
export const OrdersPanel: React.FC<{ open: boolean; sessionId: string; requestApproval: RequestApproval; onReceipt: (r: ReceiptView) => void; onChanged: (msg: string) => void; onClose: () => void }> = ({ open, sessionId, requestApproval, onReceipt, onChanged, onClose }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const load = async () => {
    try {
      setRows(await ApiClient.get(`/pos/orders?session_id=${sessionId}`));
    } catch (e) {
      setError(errMsg(e));
      setRows([]);
    }
  };
  useEffect(() => {
    if (open) {
      setRows(null);
      setError(null);
      setVoiding(null);
      load();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const reprint = async (o: any) => {
    try {
      const r = await ApiClient.post(`/pos/orders/${o.id}/reprint`, {});
      onReceipt({ ...r, title: `Receipt ${o.order_number}` });
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const doVoid = async () => {
    setError(null);
    try {
      await withApproval(requestApproval, 'VOID_ORDER', (approval_id) => ApiClient.post(`/pos/orders/${voiding.id}/void`, { reason, approval_id }), { order: voiding.order_number });
      onChanged(`Order ${voiding.order_number} voided; stock and ledger reversed`);
      setVoiding(null);
      setReason('');
      load();
    } catch (e) {
      if (!(e instanceof ApprovalCancelled)) setError(errMsg(e));
    }
  };
  const tone = (s: string): 'success' | 'danger' | 'warning' => (s === 'COMPLETED' ? 'success' : s === 'VOIDED' ? 'danger' : 'warning');
  return (
    <Drawer isOpen={open} onClose={onClose} title="This shift's orders" subtitle="Reprint any receipt (counted and logged). Void is only possible within the same open shift and needs a manager." size="4xl">
      {error && <Notice tone="danger">{error}</Notice>}
      {voiding && (
        <form className="my-3 flex items-end gap-2 rounded-[10px] border border-[#F4C7CE] bg-[#FDECEF] p-3" onSubmit={(e) => { e.preventDefault(); doVoid(); }}>
          <div className="flex-1"><Field label={`Void reason for ${voiding.order_number}`} htmlFor="void-reason"><input id="void-reason" required autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className={textInput} /></Field></div>
          <Button type="button" variant="secondary" onClick={() => setVoiding(null)}>Keep</Button>
          <Button type="submit" variant="destructive">Void sale</Button>
        </form>
      )}
      {rows === null ? (
        <p className="py-6 text-center text-[#5E6A7D]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[#5E6A7D]">No orders in this shift yet.</p>
      ) : (
        <table className="w-full text-[14px]">
          <thead className="sticky top-0 bg-[#F7F8FC] text-[12px] uppercase text-[#5E6A7D]">
            <tr>
              <th scope="col" className="text-left px-2 py-2">Order</th>
              <th scope="col" className="text-left px-2 py-2">Time</th>
              <th scope="col" className="text-left px-2 py-2">Customer</th>
              <th scope="col" className="text-right px-2 py-2">Total</th>
              <th scope="col" className="text-left px-2 py-2">Status</th>
              <th scope="col" className="px-2 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-[#EEF1F6]">
                <td className="px-2 py-2 font-mono text-[13px]">{o.order_number}</td>
                <td className="px-2 py-2">{new Date(o.created_at).toLocaleTimeString()}</td>
                <td className="px-2 py-2">{o.customer_name || '—'}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(o.total_amount)}</td>
                <td className="px-2 py-2"><Badge variant={tone(o.status)} size="sm">{o.status}</Badge></td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="quiet" onClick={() => reprint(o)}>Reprint</Button>
                  {o.status === 'COMPLETED' && <Button size="sm" variant="quiet" className="text-[#A82430]" onClick={() => setVoiding(o)}>Void</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Drawer>
  );
};

// ---------------------------------------------------------------- returns / exchanges
export const ReturnsPanel: React.FC<{ open: boolean; sessionId: string; items: CatalogItem[]; requestApproval: RequestApproval; onDone: (r: any) => void; onClose: () => void }> = ({ open, sessionId, items, requestApproval, onDone, onClose }) => {
  const [mode, setMode] = useState<'receipt' | 'noreceipt'>('receipt');
  const [orderNo, setOrderNo] = useState('');
  const [order, setOrder] = useState<any | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [refundTo, setRefundTo] = useState<'ORIGINAL' | 'STORE_CREDIT' | 'CASH'>('ORIGINAL');
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [nr, setNr] = useState<{ item: CatalogItem; quantity: string }[]>([]);
  const [nrSearch, setNrSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setMode('receipt');
      setOrderNo('');
      setOrder(null);
      setQty({});
      setRefundTo('ORIGINAL');
      setReason('');
      setRestock(true);
      setNr([]);
      setError(null);
    }
  }, [open]);
  const find = async () => {
    setError(null);
    try {
      const o = await ApiClient.get(`/pos/orders/${encodeURIComponent(orderNo.trim())}`);
      if (o.status === 'VOIDED') return setError('This sale was voided; nothing to return.');
      setOrder(o);
      setQty({});
    } catch (e) {
      setError(errMsg(e));
    }
  };
  // Mirrors computeLineRefund: pro-rata of what was paid, last unit takes the remainder.
  const preview = useMemo(() => {
    if (!order) return '0.00';
    let t = Money.zero();
    for (const l of order.lines) {
      const q = qty[l.id];
      if (!q) continue;
      try {
        const left = new Money(l.quantity).sub(l.returned_quantity || '0');
        if (!left.isPositive()) continue;
        const qq = Money.min(new Money(q), left);
        const paid = new Money(l.net_amount).add(l.tax_amount).sub(l.refunded_net || '0').sub(l.refunded_tax || '0');
        t = t.add(qq.eq(left) ? paid : paid.mul(qq).div(left).round(2));
      } catch {
        /* partial input */
      }
    }
    return t.toFixed(2);
  }, [order, qty]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { session_id: sessionId, reason, restock };
      let action = 'RETURN';
      if (mode === 'receipt') {
        if (!order) throw new Error('Find the original receipt first');
        const lines = order.lines.filter((l: any) => qty[l.id] && new Money(qty[l.id]).isPositive()).map((l: any) => ({ original_line_id: l.id, quantity: qty[l.id] }));
        if (lines.length === 0) throw new Error('Enter a return quantity on at least one line');
        Object.assign(body, { original_order_id: order.id, lines, refund_to: refundTo });
      } else {
        if (nr.length === 0) throw new Error('Add the returned items');
        action = 'RETURN_NO_RECEIPT';
        Object.assign(body, { lines: nr.map((l) => ({ item_id: l.item.id, quantity: l.quantity })), refund_to: refundTo === 'ORIGINAL' ? 'STORE_CREDIT' : refundTo });
      }
      const r = await withApproval(requestApproval, action, (approval_id) => ApiClient.post('/pos/returns', { ...body, approval_id }));
      onDone(r);
    } catch (e) {
      if (!(e instanceof ApprovalCancelled)) setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const nrResults = nrSearch ? searchCatalog(items, nrSearch, 6) : [];
  const trim = (v: string) => new Money(v || '0').toFixed(3).replace(/\.?0+$/, '');
  return (
    <Drawer isOpen={open} onClose={onClose} title="Return / exchange" subtitle="With a receipt: refunded at the price actually paid, back to the original tenders. Without: manager PIN, shelf price, store credit by default." size="4xl" initialFocusRef={ref as React.RefObject<HTMLElement>}>
      <div className="flex flex-col gap-4">
        <div role="tablist" aria-label="Return type" className="grid grid-cols-2 gap-2">
          {(['receipt', 'noreceipt'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => { setMode(m); setRefundTo(m === 'receipt' ? 'ORIGINAL' : 'STORE_CREDIT'); }} className={segBtn(mode === m)}>{m === 'receipt' ? 'With receipt' : 'No receipt'}</button>
          ))}
        </div>
        {mode === 'receipt' ? (
          <>
            <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); find(); }}>
              <div className="flex-1">
                <Field label="Receipt / order number" htmlFor="ret-order" hint="Scan the receipt or type the order number"><input ref={ref} id="ret-order" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} className={textInput} autoComplete="off" /></Field>
              </div>
              <Button type="submit" size="lg">Find</Button>
            </form>
            {order && (
              <table className="w-full text-[14px]" aria-label={`Lines on ${order.order_number}`}>
                <thead className="bg-[#F7F8FC] text-[12px] uppercase text-[#5E6A7D]">
                  <tr>
                    <th scope="col" className="text-left px-2 py-2">Item</th>
                    <th scope="col" className="text-right px-2 py-2">Sold</th>
                    <th scope="col" className="text-right px-2 py-2">Returned</th>
                    <th scope="col" className="text-right px-2 py-2">Paid</th>
                    <th scope="col" className="text-right px-2 py-2">Return qty</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l: any) => {
                    const left = new Money(l.quantity).sub(l.returned_quantity || '0');
                    return (
                      <tr key={l.id} className="border-b border-[#EEF1F6]">
                        <td className="px-2 py-2">{l.item_name}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{trim(l.quantity)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{trim(l.returned_quantity)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(new Money(l.net_amount).add(l.tax_amount).toFixed(2))}</td>
                        <td className="px-2 py-2 text-right">
                          <input aria-label={`Return quantity for ${l.item_name}`} inputMode="decimal" disabled={!left.isPositive()} value={qty[l.id] || ''} placeholder={left.isPositive() ? `max ${trim(left.toFixed(3))}` : 'done'} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/[^0-9.]/g, '') })} className="w-24 h-10 px-2 rounded-md border border-[#7D8799] text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[#5B3CC4] disabled:bg-[#F1F4F9]" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Field label="Find returned item" htmlFor="ret-nr" hint="Refunded at the current shelf price"><input id="ret-nr" value={nrSearch} onChange={(e) => setNrSearch(e.target.value)} className={textInput} autoComplete="off" /></Field>
            <div className="flex flex-wrap gap-2">
              {nrResults.map((it) => <Button key={it.id} size="sm" variant="secondary" onClick={() => { setNr([...nr, { item: it, quantity: '1' }]); setNrSearch(''); }}>+ {it.name}</Button>)}
            </div>
            {nr.map((l, i) => (
              <div key={i} className="flex items-center gap-2 rounded-[10px] border border-[#D9DFEA] px-3 py-2">
                <span className="flex-1">{l.item.name} · {fmt(l.item.unit_price)}</span>
                <input aria-label={`Quantity for ${l.item.name}`} value={l.quantity} onChange={(e) => setNr(nr.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^0-9.]/g, '') } : x)))} className="w-20 h-10 px-2 rounded-md border border-[#7D8799] text-right" />
                <Button size="sm" variant="quiet" onClick={() => setNr(nr.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <span id="ret-to-label" className="text-[13px] font-semibold text-[#182235]">Refund to</span>
            <div role="radiogroup" aria-labelledby="ret-to-label" className="grid grid-cols-3 gap-2">
              {(mode === 'receipt' ? (['ORIGINAL', 'STORE_CREDIT', 'CASH'] as const) : (['STORE_CREDIT', 'CASH'] as const)).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={refundTo === t} onClick={() => setRefundTo(t)} className={segBtn(refundTo === t)}>{t === 'ORIGINAL' ? 'Original tender' : t === 'STORE_CREDIT' ? 'Store credit' : 'Cash'}</button>
              ))}
            </div>
          </div>
          <Field label="Reason" htmlFor="ret-reason"><input id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={textInput} placeholder="e.g. damaged, wrong size" /></Field>
        </div>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-5 w-5 accent-[#5940B8]" /> Return items to sellable stock</label>
        {mode === 'receipt' && order && (
          <div className="flex justify-between items-center rounded-[10px] bg-[#F7F8FC] border border-[#D9DFEA] px-4 py-3">
            <span className="text-[14px] font-semibold text-[#46536B]">Estimated refund (server confirms)</span>
            <span className="text-[24px] font-bold tabular-nums" data-testid="return-preview">{fmt(preview)}</span>
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !reason.trim()} title={!reason.trim() ? 'Enter a reason' : undefined}>{busy ? 'Posting…' : 'Post return'}</Button>
        </div>
      </div>
    </Drawer>
  );
};

// ---------------------------------------------------------------- gift cards
export const GiftCardPanel: React.FC<{ open: boolean; sessionId: string; onDone: (msg: string) => void; onClose: () => void }> = ({ open, sessionId, onDone, onClose }) => {
  const [tab, setTab] = useState<'sell' | 'check'>('sell');
  const [amount, setAmount] = useState('');
  const [tender, setTender] = useState<'CASH' | 'CARD' | 'WALLET'>('CASH');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      setAmount('');
      setCode('');
    }
  }, [open]);
  const sell = async () => {
    setError(null);
    try {
      const r = await ApiClient.post('/pos/gift-cards', { session_id: sessionId, amount, tender_type: tender });
      setResult(`Gift card ${r.code} activated with ${fmt(r.balance ?? amount)}`);
      onDone(`Gift card ${r.code} sold`);
    } catch (e) {
      setError(errMsg(e));
    }
  };
  const check = async () => {
    setError(null);
    try {
      const r = await ApiClient.get(`/pos/stored-value/${encodeURIComponent(code.trim().toUpperCase())}?kind=GIFT_CARD`);
      setResult(`${r.code}: balance ${fmt(r.balance)}${r.is_active ? '' : ' (inactive)'}`);
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <Drawer isOpen={open} onClose={onClose} title="Gift cards" size="md">
      <div className="flex flex-col gap-4">
        <div role="tablist" aria-label="Gift card action" className="grid grid-cols-2 gap-2">
          {(['sell', 'check'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={segBtn(tab === t)}>{t === 'sell' ? 'Sell / activate' : 'Check balance'}</button>)}
        </div>
        {tab === 'sell' ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); sell(); }}>
            <Field label="Load amount" htmlFor="gc-amt"><input id="gc-amt" autoFocus required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} className={bigInput} /></Field>
            <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-3 gap-2">
              {(['CASH', 'CARD', 'WALLET'] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={tender === t} onClick={() => setTender(t)} className={segBtn(tender === t)}>{t}</button>)}
            </div>
            <Button type="submit">Activate gift card</Button>
          </form>
        ) : (
          <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); check(); }}>
            <div className="flex-1"><Field label="Gift card code" htmlFor="gc-code"><input id="gc-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} className={textInput} /></Field></div>
            <Button type="submit">Check</Button>
          </form>
        )}
        {result && <Notice tone="success">{result}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Drawer>
  );
};
