import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AvatarStack } from './AvatarStack.js';
import { Person } from './Avatar.js';
import { Icon } from './Icon.js';

export interface WorkItemCardProps {
  id?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  priority?: 'high' | 'medium' | 'low';
  progress?: number;
  progressLabel?: string;
  progressValue?: string;
  progressTone?: 'lime' | 'warning' | 'danger' | 'neutral';
  due?: string;
  overdue?: boolean;
  people?: Person[];
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

export const WorkItemCard: React.FC<WorkItemCardProps> = ({
  id,
  title,
  subtitle,
  priority,
  progress,
  progressLabel = 'Output',
  progressValue,
  due,
  overdue,
  people = [],
  active = false,
  onClick,
  className,
}) => {
  const priorityStyles: Record<string, string> = {
    high: 'bg-[var(--danger-fill,#4f2219)] text-[var(--danger-text,#ff9f87)] border-[var(--danger-fill,#4f2219)]',
    medium:
      'bg-[var(--warning-fill,#4d3110)] text-[var(--warning-text,#ffbe73)] border-[var(--warning-fill,#4d3110)]',
    low: 'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)] border-[var(--line,#262626)]',
  };

  return (
    <div
      onClick={onClick}
      className={twMerge(
        clsx(
          'w-full p-4 rounded-[16px] bg-[var(--surface-raised,#171717)] border border-[var(--line,#262626)] hover:border-[var(--line-strong,#6b6b6b)]',
          'flex flex-col gap-2.5 text-left transition-all duration-150 select-none shadow-xs cursor-pointer',
          active && 'ring-2 ring-[var(--lime,#9df747)]',
          className,
        ),
      )}
    >
      {/* Top row: ID in mono and Priority pill */}
      <div className="flex items-center justify-between gap-2">
        {id && (
          <span className="font-mono text-xs text-[var(--ink-muted,#a3a3a3)]">
            {id}
          </span>
        )}
        {priority && (
          <span
            className={clsx(
              'text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border leading-none',
              priorityStyles[priority] || priorityStyles.low,
            )}
          >
            {priority}
          </span>
        )}
      </div>

      {/* Title & Subtitle context */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <h4 className="font-sans font-semibold text-sm text-[var(--ink,#f5f5f5)] leading-snug">
          {title}
        </h4>
        {subtitle && (
          <p className="text-xs text-[var(--ink-muted,#a3a3a3)] leading-tight">
            {subtitle}
          </p>
        )}
      </div>

      {/* Progress bar if present */}
      {progress !== undefined && (
        <div className="flex flex-col gap-1 pt-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted,#a3a3a3)] font-mono">
            <span>{progressLabel}</span>
            <span className="text-[var(--ink,#f5f5f5)] font-bold">
              {progressValue || `${progress}%`}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[var(--surface-strong,#2b2b2b)] overflow-hidden">
            <div
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              className="h-full rounded-full bg-[var(--lime,#9df747)] transition-all duration-300"
            />
          </div>
        </div>
      )}

      {/* Bottom row: Due date & People avatars */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {due && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 text-[11px] font-medium',
              overdue
                ? 'text-[var(--danger-text,#ff9f87)] font-semibold'
                : 'text-[var(--ink-muted,#a3a3a3)]',
            )}
          >
            <Icon name="clock" size={12} />
            <span>{due}</span>
          </span>
        )}

        {people.length > 0 && <AvatarStack people={people} size={20} />}
      </div>
    </div>
  );
};
