import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface AlertProps {
  variant?: 'info' | 'success' | 'warning' | 'danger';
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

const styles = {
  info: 'bg-[var(--info-soft)] border-[var(--info-line)] text-[var(--info)]',
  success: 'bg-[var(--positive-soft)] border-[var(--positive-line)] text-[var(--positive)]',
  warning: 'bg-[var(--warning-soft)] border-[var(--warning-line)] text-[var(--warning)]',
  danger: 'bg-[var(--danger-soft)] border-[var(--danger-line)] text-[var(--danger)]',
};

/** Inline status message (Tectonic Design System). Danger/warning are announced (role=alert). */
export const Alert: React.FC<AlertProps> = ({ variant = 'info', title, children, action, className }) => (
  <div
    role={variant === 'danger' || variant === 'warning' ? 'alert' : 'status'}
    className={twMerge(clsx('flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-[13px] transition-colors', styles[variant], className))}
  >
    <div className="min-w-0">
      {title && <div className="font-semibold text-[var(--ink)]">{title}</div>}
      {children && <div className="text-[var(--ink-muted)] mt-0.5">{children}</div>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
