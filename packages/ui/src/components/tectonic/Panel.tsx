import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export interface PanelProps {
  tone?: 'outline' | 'surface' | 'paper';
  title?: React.ReactNode;
  icon?: IconName;
  count?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({
  tone = 'surface',
  title,
  icon,
  count,
  action,
  children,
  className,
}) => {
  const toneStyles: Record<string, string> = {
    surface:
      'bg-[var(--surface,#131313)] text-[var(--ink,#f5f5f5)] border border-[var(--line,#262626)] rounded-[24px]',
    outline:
      'bg-transparent text-[var(--ink,#f5f5f5)] border border-[var(--line,#262626)] rounded-[24px]',
    paper:
      'bg-[var(--paper,#fffbfa)] text-[var(--on-inverse,#0b0b0b)] border border-transparent rounded-[24px] shadow-float',
  };

  const isPaper = tone === 'paper';

  return (
    <div
      className={twMerge(
        clsx(
          'p-5 transition-all duration-150 flex flex-col gap-4',
          toneStyles[tone] || toneStyles.surface,
          className,
        ),
      )}
    >
      {(title || icon || count || action) && (
        <div className="flex items-center justify-between gap-3 pb-1 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <span
                className={clsx(
                  'p-1.5 rounded-full flex items-center justify-center shrink-0',
                  isPaper
                    ? 'bg-[var(--paper-sunken,#d9d9d9)] text-[var(--on-inverse,#0b0b0b)]'
                    : 'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink,#f5f5f5)]',
                )}
              >
                <Icon name={icon} size={16} />
              </span>
            )}
            {title && (
              <h3
                className={clsx(
                  'font-sans font-medium text-base md:text-lg tracking-tight truncate',
                  isPaper ? 'text-[var(--on-inverse,#0b0b0b)]' : 'text-[var(--ink,#f5f5f5)]',
                )}
              >
                {title}
              </h3>
            )}
            {count !== undefined && count !== null && (
              <span
                className={clsx(
                  'text-xs font-semibold px-2 py-0.5 rounded-full border',
                  isPaper
                    ? 'border-[var(--paper-sunken,#d9d9d9)] text-[var(--on-inverse-muted,#55524f)]'
                    : 'border-[var(--line-strong,#6b6b6b)] text-[var(--ink-muted,#a3a3a3)]',
                )}
              >
                {count}
              </span>
            )}
          </div>

          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}

      <div className="flex-1 flex flex-col gap-3 min-h-0">{children}</div>
    </div>
  );
};
