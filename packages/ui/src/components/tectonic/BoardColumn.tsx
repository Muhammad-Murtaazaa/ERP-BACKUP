import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from './Icon.js';

export interface BoardColumnProps {
  title: string;
  count?: React.ReactNode;
  onAdd?: () => void;
  children?: React.ReactNode;
  className?: string;
}

export const BoardColumn: React.FC<BoardColumnProps> = ({
  title,
  count,
  onAdd,
  children,
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'w-72 sm:w-80 shrink-0 p-4 rounded-[24px] bg-[var(--surface,#131313)] border border-[var(--line,#262626)] flex flex-col gap-3 select-none max-h-full',
          className,
        ),
      )}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <h3 className="font-sans font-semibold text-sm text-[var(--ink,#f5f5f5)]">
            {title}
          </h3>
          {count !== undefined && count !== null && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)] tabular-nums">
              {count}
            </span>
          )}
        </div>

        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            title={`Add item to ${title}`}
            aria-label={`Add item to ${title}`}
            className="p-1 rounded-full text-[var(--ink-muted,#a3a3a3)] hover:text-[var(--ink,#f5f5f5)] hover:bg-[var(--surface-strong,#2b2b2b)] transition-colors cursor-pointer"
          >
            <Icon name="plus" size={16} />
          </button>
        )}
      </div>

      {/* Cards container */}
      <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto no-scrollbar pr-0.5 min-h-[100px]">
        {children}
      </div>
    </div>
  );
};
