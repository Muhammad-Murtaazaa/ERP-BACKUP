import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'destructive' | 'outline' | 'ghost' | 'inverse' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  shape?: 'pill' | 'rect';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  shape = 'pill',
  isLoading = false,
  className,
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--lime)] disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

  const shapeStyles = shape === 'pill' ? 'rounded-full' : 'rounded-lg';

  const sizeStyles = {
    sm: 'min-h-8 px-3 py-1 text-xs font-semibold',
    md: 'min-h-9 px-4 py-1.5 text-sm',
    lg: 'min-h-11 px-6 py-2.5 text-base font-semibold',
  };

  const variantStyles = {
    primary:
      'bg-[var(--lime)] hover:brightness-105 text-[var(--on-lime)] font-semibold border border-transparent shadow-sm',
    inverse:
      'bg-[var(--pill-bg)] hover:opacity-90 text-[var(--pill-ink)] font-semibold border border-transparent shadow-sm',
    secondary:
      'bg-[var(--surface-raised)] hover:bg-[var(--surface-strong)] text-[var(--ink)] border border-[var(--line-strong)] shadow-sm',
    outline:
      'bg-transparent hover:bg-[var(--surface-raised)] text-[var(--ink)] border border-[var(--line-strong)]',
    quiet:
      'bg-transparent hover:bg-[var(--surface-raised)] text-[var(--ink-muted)] hover:text-[var(--ink)] border-transparent',
    ghost:
      'bg-transparent hover:bg-[var(--surface-raised)] text-[var(--ink-muted)] hover:text-[var(--ink)] border-transparent',
    destructive:
      'bg-[var(--danger-soft)] hover:bg-[var(--danger)]/20 text-[var(--danger)] border border-[var(--danger-line)] focus-visible:ring-[var(--danger)]',
    danger:
      'bg-[var(--danger-soft)] hover:bg-[var(--danger)]/20 text-[var(--danger)] border border-[var(--danger-line)] focus-visible:ring-[var(--danger)]',
  };

  return (
    <button
      className={twMerge(clsx(baseStyles, shapeStyles, sizeStyles[size], variantStyles[variant], className))}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-current" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Loading...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
};
