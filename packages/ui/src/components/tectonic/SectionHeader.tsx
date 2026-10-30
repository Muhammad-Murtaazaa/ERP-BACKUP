import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { IconButton } from './IconButton.js';
import { Chip } from './Chip.js';

export interface SectionHeaderProps {
  title: string;
  count?: React.ReactNode;
  countLabel?: string;
  filters?: string[];
  active?: string;
  onFilter?: (f: string) => void;
  onSearch?: (() => void) | false;
  onFilterMenu?: (() => void) | false;
  children?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  count,
  countLabel,
  filters = [],
  active,
  onFilter,
  onSearch,
  onFilterMenu,
  children,
  className,
}) => {
  const [internalActive, setInternalActive] = useState<string>(
    filters[0] || 'All',
  );
  const currentFilter = active !== undefined ? active : internalActive;

  const handleFilterClick = (f: string) => {
    if (active === undefined) {
      setInternalActive(f);
    }
    onFilter?.(f);
  };

  return (
    <div
      className={twMerge(
        clsx(
          'w-full flex flex-wrap items-center justify-between gap-3 py-1 select-none',
          className,
        ),
      )}
    >
      {/* Title & Count */}
      <div className="flex items-baseline gap-2">
        <h2 className="font-sans font-medium text-xl md:text-2xl text-[var(--ink,#f5f5f5)] tracking-[-0.015em]">
          {title}
        </h2>
        {count !== undefined && count !== null && (
          <span className="text-sm font-medium text-[var(--ink-muted,#a3a3a3)]">
            <span className="tabular-nums font-bold text-[var(--ink,#f5f5f5)] mr-1">
              {count}
            </span>
            {countLabel && (
              <span className="underline decoration-[var(--line-strong,#6b6b6b)] underline-offset-2">
                {countLabel}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Tools: Search, Filter icon, Filter chips */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
        {onSearch !== false && onSearch && (
          <IconButton
            icon="search"
            label="Search this section"
            size="sm"
            variant="outline"
            onClick={onSearch}
          />
        )}
        {onFilterMenu !== false && onFilterMenu && (
          <IconButton
            icon="sliders"
            label="Filter options"
            size="sm"
            variant="outline"
            onClick={onFilterMenu}
          />
        )}

        {filters.length > 0 && (
          <div className="flex items-center gap-1.5 ml-1">
            {filters.map((f) => (
              <Chip
                key={f}
                selected={currentFilter === f}
                onClick={() => handleFilterClick(f)}
              >
                {f}
              </Chip>
            ))}
          </div>
        )}

        {children}
      </div>
    </div>
  );
};
