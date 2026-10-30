import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from './Icon.js';

export interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>, 'prefix'> {
  label?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  multiline?: boolean;
  rows?: number;
}

export const TextField = React.forwardRef<HTMLInputElement & HTMLTextAreaElement, TextFieldProps>(
  ({ label, hint, error, prefix, suffix, multiline = false, rows = 3, className, id, ...props }, ref) => {
    const autoId = React.useId();
    const inputId = id || `tf-${autoId.replace(/:/g, '')}`;
    const descId = error || hint ? `${inputId}-desc` : undefined;

    return (
      <div className="flex flex-col gap-1.5 w-full text-left">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-[var(--ink,#f5f5f5)]">
            {label}
            {props.required && <span className="text-[var(--danger-text,#ff9f87)] ml-0.5">*</span>}
          </label>
        )}

        <div className="relative flex items-center w-full">
          {prefix && (
            <span className="absolute left-3.5 text-xs font-medium text-[var(--ink-muted,#a3a3a3)] pointer-events-none select-none">
              {prefix}
            </span>
          )}

          {multiline ? (
            <textarea
              ref={ref}
              id={inputId}
              rows={rows}
              aria-invalid={error ? true : undefined}
              aria-describedby={descId}
              className={twMerge(
                clsx(
                  'w-full px-3.5 py-2.5 rounded-[12px] bg-[var(--surface-raised,#171717)] text-[var(--ink,#f5f5f5)] text-sm transition-all duration-150',
                  'border placeholder:text-[var(--ink-subtle,#8a8a8a)] resize-y outline-none',
                  error
                    ? 'border-[var(--danger-text,#ff9f87)] focus:ring-2 focus:ring-[var(--danger-text,#ff9f87)]'
                    : 'border-[var(--line-strong,#6b6b6b)] hover:border-[var(--ink-muted,#a3a3a3)] focus:border-[var(--lime,#9df747)] focus:ring-2 focus:ring-[var(--lime,#9df747)]',
                  prefix && 'pl-9',
                  suffix && 'pr-9',
                  className,
                ),
              )}
              {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          ) : (
            <input
              ref={ref}
              id={inputId}
              aria-invalid={error ? true : undefined}
              aria-describedby={descId}
              className={twMerge(
                clsx(
                  'w-full h-10 px-3.5 rounded-[12px] bg-[var(--surface-raised,#171717)] text-[var(--ink,#f5f5f5)] text-sm transition-all duration-150',
                  'border placeholder:text-[var(--ink-subtle,#8a8a8a)] outline-none',
                  error
                    ? 'border-[var(--danger-text,#ff9f87)] focus:ring-2 focus:ring-[var(--danger-text,#ff9f87)]'
                    : 'border-[var(--line-strong,#6b6b6b)] hover:border-[var(--ink-muted,#a3a3a3)] focus:border-[var(--lime,#9df747)] focus:ring-2 focus:ring-[var(--lime,#9df747)]',
                  prefix && 'pl-9',
                  suffix && 'pr-9',
                  className,
                ),
              )}
              {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
            />
          )}

          {suffix && (
            <span className="absolute right-3.5 text-xs font-medium text-[var(--ink-muted,#a3a3a3)] pointer-events-none select-none">
              {suffix}
            </span>
          )}
        </div>

        {error && (
          <p id={descId} className="flex items-center gap-1 text-xs text-[var(--danger-text,#ff9f87)] mt-0.5">
            <Icon name="alert" size={13} />
            <span>{error}</span>
          </p>
        )}

        {hint && !error && (
          <p id={descId} className="text-xs text-[var(--ink-subtle,#8a8a8a)] mt-0.5">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
TextField.displayName = 'TextField';
