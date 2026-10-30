import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className,
}) => {
  const baseStyles = 'inline-flex items-center gap-1 font-medium rounded-full whitespace-nowrap leading-4 transition-colors';

  const sizeStyles = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs font-semibold',
  };

  const variantStyles = {
    neutral: 'bg-[var(--surface-raised)] text-[var(--ink-muted)] border border-[var(--line)]',
    brand: 'bg-[var(--lime-soft)] text-[var(--lime)] border border-[var(--lime-line)]',
    success: 'bg-[var(--positive-soft)] text-[var(--positive)] border border-[var(--positive-line)]',
    warning: 'bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning-line)]',
    danger: 'bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger-line)]',
    info: 'bg-[var(--info-soft)] text-[var(--info)] border border-[var(--info-line)]',
  };

  return (
    <span className={twMerge(clsx(baseStyles, sizeStyles[size], variantStyles[variant], className))}>
      {children}
    </span>
  );
};
