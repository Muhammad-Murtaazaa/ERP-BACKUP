import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export type ButtonVariant =
  | 'primary'
  | 'inverse'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'secondary'
  | 'quiet'
  | 'destructive';

export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonShape = 'pill' | 'rect';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  icon?: IconName;
  iconEnd?: IconName;
  block?: boolean;
  isLoading?: boolean;
  children?: React.ReactNode;
}

/**
 * Tectonic Button:
 * - primary: lime (#9df747) with on-lime (#0b0b0b) text. Max one per screen view!
 * - inverse: contrast pill (light in dark mode, dark in light mode) for page-header actions (+ New task).
 * - outline: line-strong border on surface/canvas.
 * - ghost: transparent fill for row actions and tertiary controls.
 * - danger: destructive action (red tinted).
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'outline',
  size = 'md',
  shape = 'pill',
  icon,
  iconEnd,
  block = false,
  isLoading = false,
  className,
  disabled,
  children,
  ...props
}) => {
  // Normalize legacy variants
  let normalizedVariant = variant;
  if (variant === 'secondary') normalizedVariant = 'outline';
  if (variant === 'quiet') normalizedVariant = 'ghost';
  if (variant === 'destructive') normalizedVariant = 'danger';

  const baseStyles =
    'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 select-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-ring';

  const shapeStyles = {
    pill: 'rounded-full',
    rect: 'rounded-[12px]',
  };

  const sizeStyles = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base font-semibold',
  };

  const variantStyles: Record<string, string> = {
    primary:
      'bg-[var(--lime,#9df747)] hover:bg-[var(--lime-soft,#b5fc96)] text-[var(--on-lime,#0b0b0b)] border border-transparent active:translate-y-px',
    inverse:
      'bg-[var(--inverse,#f3f3f3)] hover:opacity-90 text-[var(--on-inverse,#0b0b0b)] border border-transparent active:translate-y-px',
    outline:
      'bg-transparent hover:bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink,#f5f5f5)] border border-[var(--line-strong,#6b6b6b)] active:translate-y-px',
    ghost:
      'bg-transparent hover:bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink,#f5f5f5)] border border-transparent active:translate-y-px',
    danger:
      'bg-[var(--danger-fill,#4f2219)] text-[var(--danger-text,#ff9f87)] border border-[var(--danger-fill,#4f2219)] hover:opacity-90 active:translate-y-px',
  };

  const iconSizes = {
    sm: 14,
    md: 16,
    lg: 18,
  };

  return (
    <button
      className={twMerge(
        clsx(
          baseStyles,
          shapeStyles[shape],
          sizeStyles[size],
          variantStyles[normalizedVariant] || variantStyles.outline,
          block && 'w-full',
          className,
        ),
      )}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span className="animate-spin mr-1">
          <Icon name="loader" size={iconSizes[size]} />
        </span>
      ) : icon ? (
        <Icon name={icon} size={iconSizes[size]} />
      ) : null}

      {children}

      {iconEnd && !isLoading && <Icon name={iconEnd} size={iconSizes[size]} />}
    </button>
  );
};
