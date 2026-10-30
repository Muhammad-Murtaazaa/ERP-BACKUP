import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  isMonetary?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, isMonetary, className, id, ...props }, ref) => {
    const autoId = React.useId();
    const inputId = id || `in-${autoId.replace(/:/g, '')}`;
    const msgId = error || hint ? `${inputId}-msg` : undefined;

    return (
      <div className="flex flex-col gap-1 w-full text-left">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-[var(--ink)]">
            {label} {props.required && <span className="text-[var(--danger)]" aria-hidden="true">*</span>}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={msgId}
            className={twMerge(
              clsx(
                'w-full h-9 px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] border rounded-lg transition-colors placeholder:text-[var(--ink-subtle)]',
                'border-[var(--line-strong)] hover:border-[var(--lime)] focus:border-[var(--lime)] focus:ring-1 focus:ring-[var(--lime)] focus:outline-none',
                'disabled:bg-[var(--surface-muted)] disabled:text-[var(--ink-subtle)] disabled:cursor-not-allowed',
                isMonetary && 'font-mono text-right tabular-nums',
                error && 'border-[var(--danger)] focus:ring-[var(--danger)]',
                className,
              ),
            )}
            {...props}
          />
        </div>
        {error && (
          <span id={msgId} className="text-xs text-[var(--danger)]" aria-live="polite">
            {error}
          </span>
        )}
        {hint && !error && (
          <span id={msgId} className="text-xs text-[var(--ink-muted)]">
            {hint}
          </span>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
