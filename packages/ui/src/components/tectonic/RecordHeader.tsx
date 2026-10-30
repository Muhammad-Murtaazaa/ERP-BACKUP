import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';
import { StatusPill, Tone } from './StatusPill.js';

export interface RecordFact {
  label: string;
  value: React.ReactNode;
}

export interface RecordHeaderProps {
  id: string;
  icon?: IconName;
  status?: string;
  statusTone?: Tone;
  title: React.ReactNode;
  actions?: React.ReactNode;
  meta?: RecordFact[];
  className?: string;
}

export const RecordHeader: React.FC<RecordHeaderProps> = ({
  id,
  icon,
  status,
  statusTone = 'neutral',
  title,
  actions,
  meta = [],
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'w-full p-5 rounded-[24px] bg-[var(--surface,#131313)] border border-[var(--line,#262626)] flex flex-col gap-4 text-left select-none',
          className,
        ),
      )}
    >
      {/* Top row: ID, icon, Status pill, and Right-side Action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {icon && (
            <span className="p-1 rounded-full bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)]">
              <Icon name={icon} size={16} />
            </span>
          )}
          <span className="font-mono font-medium text-xs text-[var(--ink-muted,#a3a3a3)] tracking-wider">
            {id}
          </span>
          {status && <StatusPill tone={statusTone}>{status}</StatusPill>}
        </div>

        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Title */}
      <h1 className="font-sans font-medium text-2xl md:text-3xl text-[var(--ink,#f5f5f5)] tracking-tight">
        {title}
      </h1>

      {/* Meta facts row */}
      {meta.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-3 border-t border-[var(--line,#262626)]">
          {meta.map((m, idx) => (
            <div key={idx} className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase font-semibold text-[var(--ink-muted,#a3a3a3)] tracking-wider">
                {m.label}
              </span>
              <span className="text-sm font-medium text-[var(--ink,#f5f5f5)] mt-0.5">
                {m.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
