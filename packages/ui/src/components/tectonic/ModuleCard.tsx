import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';
import { IconButton } from './IconButton.js';

export type ModuleStatus = 'ready' | 'building' | 'draft' | 'error';

export interface ModuleCardProps {
  name: string;
  description?: string;
  icon?: IconName;
  status?: ModuleStatus;
  statusLabel?: string;
  meta?: string[];
  onOpen?: () => void;
  className?: string;
}

export const ModuleCard: React.FC<ModuleCardProps> = ({
  name,
  description,
  icon = 'box',
  status = 'ready',
  statusLabel,
  meta = [],
  onOpen,
  className,
}) => {
  const statusStyles: Record<ModuleStatus, { bg: string; text: string; defaultLabel: string; icon?: IconName }> = {
    ready: {
      bg: 'bg-[var(--positive-fill,#2f4a1c)] text-[var(--positive-text,#c2f59a)]',
      text: 'text-[var(--positive-text,#c2f59a)]',
      defaultLabel: 'Ready',
      icon: 'check',
    },
    building: {
      bg: 'bg-[var(--caution-fill,#4a4b12)] text-[var(--caution-text,#eef07a)]',
      text: 'text-[var(--caution-text,#eef07a)]',
      defaultLabel: 'Building',
      icon: 'loader',
    },
    draft: {
      bg: 'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)]',
      text: 'text-[var(--ink-muted,#a3a3a3)]',
      defaultLabel: 'Draft',
    },
    error: {
      bg: 'bg-[var(--danger-fill,#4f2219)] text-[var(--danger-text,#ff9f87)]',
      text: 'text-[var(--danger-text,#ff9f87)]',
      defaultLabel: 'Error',
      icon: 'alert',
    },
  };

  const st = statusStyles[status] || statusStyles.ready;

  return (
    <div
      onClick={onOpen}
      className={twMerge(
        clsx(
          'relative w-72 p-5 rounded-[24px] bg-[var(--surface,#131313)] border border-[var(--line,#262626)] hover:border-[var(--line-strong,#6b6b6b)]',
          'flex flex-col justify-between gap-4 text-left transition-all duration-150 select-none shadow-xs tt-notch cursor-pointer group',
          className,
        ),
      )}
    >
      {/* Top: Icon + Open button in notch */}
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-[12px] bg-[var(--surface-raised,#171717)] text-[var(--lime,#9df747)] flex items-center justify-center border border-[var(--line,#262626)]">
          <Icon name={icon} size={20} />
        </div>

        {onOpen && (
          <div className="absolute top-2 right-2">
            <IconButton
              icon="arrow-up-right"
              label={`Open ${name} module`}
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
            />
          </div>
        )}
      </div>

      {/* Name & Description */}
      <div className="flex flex-col gap-1 pr-8">
        <h3 className="font-sans font-semibold text-base text-[var(--ink,#f5f5f5)] group-hover:text-[var(--lime,#9df747)] transition-colors">
          {name}
        </h3>
        {description && (
          <p className="text-xs text-[var(--ink-muted,#a3a3a3)] leading-relaxed line-clamp-2">
            {description}
          </p>
        )}
      </div>

      {/* Bottom: Status Pill & Meta facts */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--line,#262626)]">
        <span
          className={clsx(
            'inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full leading-none',
            st.bg,
          )}
        >
          {st.icon && <Icon name={st.icon} size={11} />}
          <span>{statusLabel || st.defaultLabel}</span>
        </span>

        {meta.length > 0 && (
          <span className="text-[11px] font-mono text-[var(--ink-muted,#a3a3a3)] truncate">
            {meta.join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
};
