import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Button, ButtonProps } from './Button.js';
import { IconName } from './Icon.js';

export interface ActionItem {
  icon?: IconName;
  label: string;
  variant?: ButtonProps['variant'];
  onClick?: () => void;
}

export interface ActionBarProps {
  lead?: React.ReactNode;
  actions?: ActionItem[];
  className?: string;
  children?: React.ReactNode;
}

export const ActionBar: React.FC<ActionBarProps> = ({
  lead,
  actions = [],
  className,
  children,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'w-full h-12 px-4 rounded-full bg-[var(--surface-raised,#171717)] border border-[var(--line,#262626)] text-[var(--ink,#f5f5f5)]',
          'flex items-center justify-between gap-4 shadow-lg select-none shrink-0 z-20',
          className,
        ),
      )}
    >
      <div className="flex items-center gap-3 min-w-0 truncate text-xs font-medium text-[var(--ink-muted,#a3a3a3)]">
        {lead}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actions.map((act, idx) => (
          <Button
            key={idx}
            size="sm"
            variant={act.variant || 'outline'}
            shape="pill"
            icon={act.icon}
            onClick={act.onClick}
          >
            {act.label}
          </Button>
        ))}
        {children}
      </div>
    </div>
  );
};
