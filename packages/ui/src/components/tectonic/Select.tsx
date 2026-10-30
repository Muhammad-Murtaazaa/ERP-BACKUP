import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from './Icon.js';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: React.ReactNode;
  options: Array<string | { value: string; label: string }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hint, options, className, id, ...props }, ref) => {
    const autoId = React.useId();
    const selectId = id || `sel-${autoId.replace(/:/g, '')}`;

    return (
      <div className="flex flex-col gap-1.5 w-full text-left">
        {label && (
          <label htmlFor={selectId} className="text-xs font-medium text-[var(--ink,#f5f5f5)]">
            {label}
            {props.required && <span className="text-[var(--danger-text,#ff9f87)] ml-0.5">*</span>}
          </label>
        )}

        <div className="relative flex items-center w-full">
          <select
            ref={ref}
            id={selectId}
            className={twMerge(
              clsx(
                'w-full h-10 pl-3.5 pr-9 rounded-[12px] bg-[var(--surface-raised,#171717)] text-[var(--ink,#f5f5f5)] text-sm transition-all duration-150',
                'border border-[var(--line-strong,#6b6b6b)] hover:border-[var(--ink-muted,#a3a3a3)] focus:border-[var(--lime,#9df747)] focus:ring-2 focus:ring-[var(--lime,#9df747)]',
                'appearance-none outline-none cursor-pointer',
                className,
              ),
            )}
            {...props}
          >
            {options.map((opt, idx) => {
              const val = typeof opt === 'string' ? opt : opt.value;
              const lbl = typeof opt === 'string' ? opt : opt.label;
              return (
                <option
                  key={idx}
                  value={val}
                  className="bg-[var(--surface,#131313)] text-[var(--ink,#f5f5f5)]"
                >
                  {lbl}
                </option>
              );
            })}
          </select>

          <span className="absolute right-3 text-[var(--ink-muted,#a3a3a3)] pointer-events-none flex items-center">
            <Icon name="chevron-down" size={16} />
          </span>
        </div>

        {hint && (
          <p className="text-xs text-[var(--ink-subtle,#8a8a8a)] mt-0.5">
            {hint}
          </p>
        )}
      </div>
    );
  },
);
Select.displayName = 'Select';
