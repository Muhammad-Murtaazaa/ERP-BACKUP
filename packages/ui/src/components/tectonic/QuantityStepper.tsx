import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from './Icon.js';

export interface QuantityStepperProps {
  value?: number;
  defaultValue?: number;
  onChange?: (n: number) => void;
  min?: number;
  max?: number;
  label?: string;
  className?: string;
}

export const QuantityStepper: React.FC<QuantityStepperProps> = ({
  value,
  defaultValue = 1,
  onChange,
  min = 0,
  max,
  label = 'Quantity',
  className,
}) => {
  const [internalVal, setInternalVal] = useState<number>(defaultValue);
  const current = value !== undefined ? value : internalVal;

  const handleUpdate = (next: number) => {
    if (min !== undefined && next < min) return;
    if (max !== undefined && next > max) return;
    if (value === undefined) {
      setInternalVal(next);
    }
    onChange?.(next);
  };

  return (
    <div
      role="group"
      aria-label={label}
      className={twMerge(
        clsx(
          'inline-flex items-center justify-between h-8 px-2.5 rounded-full border border-[var(--line-strong,#6b6b6b)] bg-[var(--surface-raised,#171717)] text-[var(--ink,#f5f5f5)] text-xs font-mono font-bold select-none',
          className,
        ),
      )}
    >
      <button
        type="button"
        onClick={() => handleUpdate(current - 1)}
        disabled={min !== undefined && current <= min}
        title="Decrease quantity"
        aria-label="Decrease quantity"
        className="w-5 h-5 flex items-center justify-center text-[var(--ink-muted,#a3a3a3)] hover:text-[var(--ink,#f5f5f5)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        <Icon name="minus" size={12} strokeWidth={2} />
      </button>

      <span className="w-7 text-center tabular-nums px-1">{current}</span>

      <button
        type="button"
        onClick={() => handleUpdate(current + 1)}
        disabled={max !== undefined && current >= max}
        title="Increase quantity"
        aria-label="Increase quantity"
        className="w-5 h-5 flex items-center justify-center text-[var(--ink-muted,#a3a3a3)] hover:text-[var(--ink,#f5f5f5)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        <Icon name="plus" size={12} strokeWidth={2} />
      </button>
    </div>
  );
};
