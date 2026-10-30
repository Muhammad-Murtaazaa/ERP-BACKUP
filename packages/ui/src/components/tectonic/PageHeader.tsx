import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconButton } from './IconButton.js';
import { Stat, StatProps } from './Stat.js';

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onBack?: () => void;
  action?: React.ReactNode;
  stats?: StatProps[];
  children?: React.ReactNode;
  className?: string;
}

/**
 * Tectonic PageHeader:
 * Top of a module: back button, module title in display caps (48px / 52px · 500 · -0.02em),
 * one create action (inverse Button), and module KPIs as Stats.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  onBack,
  action,
  stats = [],
  children,
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'w-full flex flex-col md:flex-row md:items-center md:justify-between gap-4 py-2 select-none shrink-0',
          className,
        ),
      )}
    >
      {/* Left side: Back button + Title in display caps */}
      <div className="flex items-center gap-3 min-w-0">
        {onBack && (
          <IconButton
            icon="arrow-left"
            label="Back"
            size="md"
            variant="outline"
            onClick={onBack}
          />
        )}
        <div className="min-w-0">
          <h1 className="font-sans font-medium text-3xl md:text-4xl lg:text-[48px] leading-[1.08] tracking-[-0.02em] uppercase text-[var(--ink,#f5f5f5)] truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm font-normal text-[var(--ink-muted,#a3a3a3)] mt-0.5 tracking-tight">
              {subtitle}
            </p>
          )}
        </div>

        {action && <div className="ml-2 shrink-0">{action}</div>}
      </div>

      {/* Right side: Stats & Extra actions */}
      <div className="flex items-center gap-6 overflow-x-auto no-scrollbar shrink-0">
        {stats.map((s, idx) => (
          <Stat key={idx} {...s} />
        ))}
        {children}
      </div>
    </div>
  );
};
