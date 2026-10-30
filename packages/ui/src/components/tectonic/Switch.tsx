import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SwitchProps {
  label?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  label,
  checked,
  defaultChecked = false,
  onChange,
  disabled = false,
  className,
}) => {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const isChecked = checked !== undefined ? checked : internalChecked;

  const toggle = () => {
    if (disabled) return;
    const next = !isChecked;
    if (checked === undefined) {
      setInternalChecked(next);
    }
    onChange?.(next);
  };

  return (
    <label
      className={twMerge(
        clsx(
          'inline-flex items-center gap-2.5 select-none cursor-pointer text-sm text-[var(--ink,#f5f5f5)]',
          disabled && 'opacity-40 cursor-not-allowed',
          className,
        ),
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={isChecked}
        disabled={disabled}
        onClick={toggle}
        className={clsx(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-in-out cursor-pointer focus-visible:outline-none focus-ring',
          isChecked ? 'bg-[var(--lime,#9df747)]' : 'bg-[var(--surface-strong,#2b2b2b)] border border-[var(--line-strong,#6b6b6b)]',
        )}
      >
        <span
          className={clsx(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full shadow-md transition duration-200 ease-in-out mt-0.5',
            isChecked
              ? 'translate-x-5 bg-[var(--on-lime,#0b0b0b)]'
              : 'translate-x-0.5 bg-[var(--ink,#f5f5f5)]',
          )}
        />
      </button>

      {label && <span className="text-sm font-medium">{label}</span>}
    </label>
  );
};
