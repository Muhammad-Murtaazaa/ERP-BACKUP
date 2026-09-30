/** Small touch-first building blocks shared by the POS terminal panels. */
import React from 'react';
import { clsx } from 'clsx';
import { Money } from '@omnysync/financial-engine';
import { Delete } from 'lucide-react';

export const fmt = (v: string | number | null | undefined) => {
  try {
    const [int, dec] = new Money(String(v ?? '0')).toFixed(2).split('.');
    const neg = int.startsWith('-');
    const digits = neg ? int.slice(1) : int;
    return `${neg ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
  } catch {
    return String(v ?? '');
  }
};

export const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <kbd className={clsx('inline-flex items-center justify-center min-w-[24px] h-[22px] px-1.5 rounded-[4px] border border-[#7D8799] bg-white text-[11px] font-mono font-semibold text-[#182235] shadow-[0_1px_0_#7D8799]', className)}>
    {children}
  </kbd>
);

/** Big function-key tile: touch target >= 56px, keyboard hint top-right. */
export const FnTile: React.FC<{
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'brand' | 'danger' | 'success';
  disabled?: boolean;
  className?: string;
  ariaKeyshortcuts?: string;
}> = ({ label, hint, icon, onClick, tone = 'default', disabled, className, ariaKeyshortcuts }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-keyshortcuts={ariaKeyshortcuts}
    className={clsx(
      'relative flex flex-col items-start justify-between gap-1 min-h-[60px] rounded-[10px] border px-3 py-2 text-left transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4] focus-visible:ring-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      tone === 'default' && 'bg-white border-[#D9DFEA] text-[#182235] hover:border-[#5940B8] hover:bg-[#F2EEFF]',
      tone === 'brand' && 'bg-[#5940B8] border-[#5940B8] text-white hover:bg-[#463091]',
      tone === 'danger' && 'bg-[#FDECEF] border-[#F4C7CE] text-[#A82430] hover:border-[#A82430]',
      tone === 'success' && 'bg-[#146341] border-[#146341] text-white hover:bg-[#0F4F33]',
      className,
    )}
  >
    <span className="flex items-center gap-2 text-[14px] font-semibold leading-tight">
      {icon}
      {label}
    </span>
    {hint && (
      <span className={clsx('text-[11px] font-mono font-semibold', tone === 'brand' || tone === 'success' ? 'text-white/85' : 'text-[#5E6A7D]')}>{hint}</span>
    )}
  </button>
);

/** On-screen numeric keypad for touch operation (also fully usable with a keyboard). */
export const Keypad: React.FC<{ onKey: (k: string) => void; allowDecimal?: boolean; className?: string }> = ({ onKey, allowDecimal = true, className }) => {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', allowDecimal ? '.' : '00', '0', 'BACK'];
  return (
    <div className={clsx('grid grid-cols-3 gap-2', className)} role="group" aria-label="Numeric keypad">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          tabIndex={-1}
          onClick={() => onKey(k)}
          aria-label={k === 'BACK' ? 'Backspace' : k}
          className="h-14 rounded-[10px] border border-[#D9DFEA] bg-white text-[20px] font-semibold text-[#182235] hover:bg-[#F2EEFF] hover:border-[#5940B8] active:bg-[#E6DFFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3CC4]"
        >
          {k === 'BACK' ? <Delete size={20} className="mx-auto" aria-hidden="true" /> : k}
        </button>
      ))}
    </div>
  );
};

export const applyKey = (value: string, k: string, maxDecimals = 3) => {
  if (k === 'BACK') return value.slice(0, -1);
  if (k === 'CLEAR') return '';
  if (k === '.' && value.includes('.')) return value;
  const next = value === '0' && k !== '.' ? k : value + k;
  const dec = next.split('.')[1];
  if (dec && dec.length > maxDecimals) return value;
  return next;
};

export const Field: React.FC<{ label: string; htmlFor: string; hint?: string; error?: string | null; children: React.ReactNode }> = ({ label, htmlFor, hint, error, children }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={htmlFor} className="text-[13px] font-semibold text-[#182235]">
      {label}
    </label>
    {children}
    {error ? (
      <p id={`${htmlFor}-err`} role="alert" className="text-[12px] text-[#A82430]">
        {error}
      </p>
    ) : hint ? (
      <p id={`${htmlFor}-hint`} className="text-[12px] text-[#5E6A7D]">
        {hint}
      </p>
    ) : null}
  </div>
);

export const bigInput =
  'w-full h-14 px-4 rounded-[10px] border border-[#7D8799] bg-white text-[24px] font-semibold text-[#182235] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#5B3CC4] focus:border-[#5940B8]';
export const textInput =
  'w-full h-11 px-3 rounded-md border border-[#7D8799] bg-white text-[15px] text-[#182235] focus:outline-none focus:ring-2 focus:ring-[#5B3CC4] focus:border-[#5940B8]';

export const Notice: React.FC<{ tone: 'danger' | 'warning' | 'success' | 'info'; children: React.ReactNode }> = ({ tone, children }) => (
  <div
    role={tone === 'danger' ? 'alert' : 'status'}
    className={clsx(
      'rounded-[10px] border px-3 py-2 text-[13px] font-medium',
      tone === 'danger' && 'bg-[#FDECEF] border-[#F4C7CE] text-[#A82430]',
      tone === 'warning' && 'bg-[#FFF4D6] border-[#F3D98B] text-[#7A4700]',
      tone === 'success' && 'bg-[#EAF7EF] border-[#B7E1C6] text-[#146341]',
      tone === 'info' && 'bg-[#EDF3FF] border-[#BFD1F5] text-[#234FA3]',
    )}
  >
    {children}
  </div>
);

/** PKR note/coin denominations used for drawer counts. */
export const DENOMINATIONS = ['5000', '1000', '500', '100', '50', '20', '10', '5', '2', '1'];

export const DenominationGrid: React.FC<{ counts: Record<string, string>; onChange: (c: Record<string, string>) => void; idPrefix: string }> = ({ counts, onChange, idPrefix }) => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
    {DENOMINATIONS.map((d) => {
      const n = Number.parseInt(counts[d] || '0', 10) || 0;
      return (
        <div key={d} className="flex items-center gap-2">
          <label htmlFor={`${idPrefix}-${d}`} className="w-16 text-right text-[14px] font-semibold text-[#182235] tabular-nums">
            {Number(d).toLocaleString()}
          </label>
          <span className="text-[#5E6A7D]" aria-hidden="true">×</span>
          <input
            id={`${idPrefix}-${d}`}
            inputMode="numeric"
            value={counts[d] || ''}
            onChange={(e) => onChange({ ...counts, [d]: e.target.value.replace(/\D/g, '').slice(0, 5) })}
            placeholder="0"
            className="w-20 h-10 px-2 rounded-md border border-[#7D8799] text-right text-[15px] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#5B3CC4]"
          />
          <span className="flex-1 text-right text-[13px] text-[#46536B] tabular-nums">{fmt(new Money(d).mul(n).toFixed(2))}</span>
        </div>
      );
    })}
  </div>
);

export const countsToDenoms = (counts: Record<string, string>) =>
  DENOMINATIONS.map((d) => ({ value: d, count: Number.parseInt(counts[d] || '0', 10) || 0 })).filter((x) => x.count > 0);

export const countTotal = (counts: Record<string, string>) =>
  countsToDenoms(counts).reduce((s, d) => s.add(new Money(d.value).mul(d.count)), Money.zero()).toFixed(2);
