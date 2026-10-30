import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export type AlertTone = 'info' | 'positive' | 'warning' | 'danger' | 'agent';

export interface AlertProps {
  tone?: AlertTone;
  variant?: 'info' | 'success' | 'warning' | 'danger';
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  icon?: IconName;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  tone,
  variant,
  title,
  children,
  action,
  onDismiss,
  icon,
  className,
}) => {
  const resolvedTone: AlertTone =
    tone || (variant === 'success' ? 'positive' : (variant as AlertTone)) || 'info';

  const toneStyles: Record<AlertTone, { bg: string; text: string; border: string; defaultIcon: IconName }> = {
    info: {
      bg: 'bg-[var(--surface-raised,#171717)]',
      text: 'text-[var(--ink,#f5f5f5)]',
      border: 'border-[var(--line,#262626)]',
      defaultIcon: 'info',
    },
    positive: {
      bg: 'bg-[var(--positive-fill,#2f4a1c)]/60',
      text: 'text-[var(--positive-text,#c2f59a)]',
      border: 'border-[var(--positive-fill,#2f4a1c)]',
      defaultIcon: 'check-circle',
    },
    warning: {
      bg: 'bg-[var(--warning-fill,#4d3110)]/60',
      text: 'text-[var(--warning-text,#ffbe73)]',
      border: 'border-[var(--warning-fill,#4d3110)]',
      defaultIcon: 'alert',
    },
    danger: {
      bg: 'bg-[var(--danger-fill,#4f2219)]/60',
      text: 'text-[var(--danger-text,#ff9f87)]',
      border: 'border-[var(--danger-fill,#4f2219)]',
      defaultIcon: 'alert',
    },
    agent: {
      bg: 'bg-[var(--lime-tint,#1c2b12)]',
      text: 'text-[var(--lime-text,#9df747)]',
      border: 'border-[var(--lime-tint,#1c2b12)]',
      defaultIcon: 'spark',
    },
  };

  const current = toneStyles[resolvedTone] || toneStyles.info;
  const iconToUse = icon || current.defaultIcon;

  return (
    <div
      role="alert"
      className={twMerge(
        clsx(
          'w-full p-4 rounded-[16px] border flex items-start justify-between gap-3 select-none text-left transition-all duration-150',
          current.bg,
          current.text,
          current.border,
          className,
        ),
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="p-0.5 shrink-0 mt-0.5">
          <Icon name={iconToUse} size={18} />
        </span>
        <div className="flex-1 flex flex-col gap-0.5 min-w-0">
          {title && <h4 className="font-semibold text-sm leading-snug">{title}</h4>}
          {children && (
            <div className="text-xs opacity-90 leading-relaxed font-normal">
              {children}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {action && <div>{action}</div>}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            title="Dismiss message"
            aria-label="Dismiss message"
            className="p-1 rounded-full opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
