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
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="flex flex-col gap-1 w-full text-left">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-[#182235]">
            {label} {props.required && <span className="text-[#A82430]">*</span>}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            className={twMerge(
              clsx(
                'w-full px-3 py-2 text-sm bg-white text-[#182235] border rounded transition-colors',
                'border-[#7D8799] hover:border-[#5940B8] focus:border-[#5940B8] focus:ring-1 focus:ring-[#5B3CC4] focus:outline-none',
                'disabled:bg-[#F1F4F9] disabled:text-[#5E6A7D] disabled:cursor-not-allowed',
                isMonetary && 'font-mono text-right tabular-nums',
                error && 'border-[#A82430] focus:ring-red-400',
                className,
              ),
            )}
            {...props}
          />
        </div>
        {error && <span className="text-xs text-[#A82430]">{error}</span>}
        {hint && !error && <span className="text-xs text-[#5E6A7D]">{hint}</span>}
      </div>
    );
  },
);

Input.displayName = 'Input';
