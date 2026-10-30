import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from './Icon.js';

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hideLabel?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, hideLabel = false, checked = false, onChange, disabled, className, ...props }, ref) => {
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
        <span className="relative inline-flex items-center justify-center shrink-0">
          <input
            ref={ref}
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            aria-label={hideLabel ? label : undefined}
            className="peer sr-only"
            {...props}
          />
          <span
            className={clsx(
              'w-[18px] h-[18px] rounded-[4px] border transition-all duration-150 flex items-center justify-center',
              checked
                ? 'bg-[var(--lime,#9df747)] border-[var(--lime,#9df747)] text-[var(--on-lime,#0b0b0b)]'
                : 'bg-transparent border-[var(--line-strong,#6b6b6b)] hover:border-[var(--ink-muted,#a3a3a3)]',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--lime,#9df747)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--canvas,#0b0b0b)]',
            )}
          >
            {checked && <Icon name="check" size={12} strokeWidth={2.5} />}
          </span>
        </span>
        {!hideLabel && <span className="text-sm font-medium">{label}</span>}
      </label>
    );
  },
);
Checkbox.displayName = 'Checkbox';
