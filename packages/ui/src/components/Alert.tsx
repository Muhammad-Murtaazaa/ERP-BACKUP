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
  info: 'bg-[#EDF3FF] border-[#cbe0ff] text-[#234FA3]',
  success: 'bg-[#EAF7EF] border-[#c3edd2] text-[#146341]',
  warning: 'bg-[#FFF4D6] border-[#fae29f] text-[#7A4700]',
  danger: 'bg-[#FDECEF] border-[#f7c2c9] text-[#A82430]',
};

/** Inline status message (design-system.md §Feedback). Danger/warning are announced (role=alert). */
export const Alert: React.FC<AlertProps> = ({ variant = 'info', title, children, action, className }) => (
  <div
    role={variant === 'danger' || variant === 'warning' ? 'alert' : 'status'}
    className={twMerge(clsx('flex items-start justify-between gap-3 rounded-[10px] border px-4 py-3 text-[13px]', styles[variant], className))}
  >
    <div className="min-w-0">
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className="text-[#46536B] mt-0.5">{children}</div>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
