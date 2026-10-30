import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from './Icon.js';

export type StageStatus = 'done' | 'current' | 'todo' | 'blocked';

export interface StageStep {
  label: string;
  caption?: string;
  status?: StageStatus;
}

export interface StageTrackerProps {
  steps: StageStep[];
  label?: string;
  className?: string;
}

export const StageTracker: React.FC<StageTrackerProps> = ({
  steps = [],
  label = 'Lifecycle progress',
  className,
}) => {
  return (
    <div
      aria-label={label}
      className={twMerge(
        clsx(
          'w-full flex items-center justify-between gap-2 py-3 select-none overflow-x-auto no-scrollbar',
          className,
        ),
      )}
    >
      {steps.map((step, idx) => {
        const isDone = step.status === 'done';
        const isCurrent = step.status === 'current';
        const isBlocked = step.status === 'blocked';
        const isLast = idx === steps.length - 1;

        return (
          <React.Fragment key={idx}>
            <div className="flex flex-col items-center text-center gap-1.5 shrink-0">
              <div
                className={clsx(
                  'w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150',
                  isDone && 'bg-[var(--lime,#9df747)] text-[var(--on-lime,#0b0b0b)]',
                  isCurrent &&
                    'border-2 border-[var(--ink,#f5f5f5)] bg-transparent text-[var(--ink,#f5f5f5)]',
                  isBlocked &&
                    'bg-[var(--danger-fill,#4f2219)] text-[var(--danger-text,#ff9f87)] border border-[var(--danger-text,#ff9f87)]',
                  !isDone &&
                    !isCurrent &&
                    !isBlocked &&
                    'border border-[var(--line-strong,#6b6b6b)] text-transparent bg-transparent',
                )}
              >
                {isDone ? (
                  <Icon name="check" size={13} strokeWidth={2.5} />
                ) : isCurrent ? (
                  <span className="w-2 h-2 rounded-full bg-[var(--ink,#f5f5f5)]" />
                ) : isBlocked ? (
                  <Icon name="x" size={12} strokeWidth={2.5} />
                ) : null}
              </div>

              <div className="flex flex-col items-center leading-tight">
                <span
                  className={clsx(
                    'text-xs font-medium',
                    isCurrent ? 'text-[var(--ink,#f5f5f5)] font-bold' : 'text-[var(--ink-muted,#a3a3a3)]',
                  )}
                >
                  {step.label}
                </span>
                {step.caption && (
                  <span className="text-[10px] text-[var(--ink-subtle,#8a8a8a)] mt-0.5">
                    {step.caption}
                  </span>
                )}
              </div>
            </div>

            {!isLast && (
              <div
                className={clsx(
                  'flex-1 h-0.5 min-w-[24px] mx-1 transition-colors duration-150',
                  isDone ? 'bg-[var(--lime,#9df747)]' : 'bg-[var(--line-strong,#6b6b6b)] opacity-40',
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
