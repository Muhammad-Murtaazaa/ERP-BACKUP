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
          <label htmlFor={inputId} className="text-xs font-semibold text-[#182235]">
            {label} {props.required && <span className="text-[#A82430]" aria-hidden="true">*</span>}
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
                'w-full h-9 px-3 py-2 text-sm bg-white text-[#182235] border rounded-md transition-colors placeholder:text-[#5E6A7D]',
                'border-[#7D8799] hover:border-[#5940B8] focus:border-[#5940B8] focus:ring-1 focus:ring-[#5B3CC4] focus:outline-none',
                'disabled:bg-[#F1F4F9] disabled:text-[#5E6A7D] disabled:cursor-not-allowed',
                isMonetary && 'font-mono text-right tabular-nums',
                error && 'border-[#A82430] focus:ring-[#A82430]',
                className,
              ),
            )}
            {...props}
          />
        </div>
        {error && (
          <span id={msgId} className="text-xs text-[#A82430]" aria-live="polite">
            {error}
          </span>
        )}
        {hint && !error && (
          <span id={msgId} className="text-xs text-[#5E6A7D]">
            {hint}
          </span>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
