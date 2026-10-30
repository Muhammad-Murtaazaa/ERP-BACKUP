import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export type IconButtonVariant =
  | 'outline'
  | 'ghost'
  | 'inverse'
  | 'lime'
  | 'on-lime'
  | 'ink'
  | 'on-inverse';

export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  badge?: React.ReactNode;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  variant = 'outline',
  size = 'md',
  badge,
  className,
  disabled,
  ...props
}) => {
  const baseStyles =
    'relative inline-flex items-center justify-center rounded-full transition-all duration-150 select-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-ring shrink-0';

  const sizeStyles = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  };

  const iconSizes = {
    sm: 16,
    md: 18,
    lg: 20,
  };

  const variantStyles: Record<string, string> = {
    outline:
      'bg-transparent hover:bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink,#f5f5f5)] border border-[var(--line-strong,#6b6b6b)]',
    ghost:
      'bg-transparent hover:bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)] hover:text-[var(--ink,#f5f5f5)] border-transparent',
    inverse:
      'bg-[var(--inverse,#f3f3f3)] text-[var(--on-inverse,#0b0b0b)] hover:opacity-90 border-transparent',
    lime:
      'bg-[var(--lime,#9df747)] hover:bg-[var(--lime-soft,#b5fc96)] text-[var(--on-lime,#0b0b0b)] border-transparent',
    'on-lime':
      'bg-transparent hover:bg-black/10 text-[var(--on-lime,#0b0b0b)] border border-[var(--on-lime,#0b0b0b)]',
    ink:
      'bg-[var(--on-lime,#0b0b0b)] hover:bg-black/80 text-[var(--lime,#9df747)] border-transparent',
    'on-inverse':
      'bg-[var(--surface-strong,#2b2b2b)] hover:bg-[var(--surface-muted,#3a3a3a)] text-[var(--ink,#f5f5f5)] border border-[var(--line,#262626)]',
  };

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      className={twMerge(
        clsx(baseStyles, sizeStyles[size], variantStyles[variant], className),
      )}
      {...props}
    >
      <Icon name={icon} size={iconSizes[size]} />
      {badge !== undefined && badge !== null && (
        <span className="absolute -top-1 -right-1 bg-[var(--lime,#9df747)] text-[var(--on-lime,#0b0b0b)] text-[10px] font-bold px-1.5 py-0.2 rounded-full border-2 border-[var(--canvas,#0b0b0b)] leading-none min-w-[16px] h-4 flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
};
