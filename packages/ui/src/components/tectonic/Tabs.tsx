import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export interface TabItem {
  id?: string;
  label: string;
  icon?: IconName;
  count?: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  onChange?: (id: string) => void;
  label?: string;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  value,
  onChange,
  label = 'View selection',
  className,
}) => {
  const [internalVal, setInternalVal] = useState<string>(
    items[0]?.id || items[0]?.label || '',
  );

  const currentVal = value !== undefined ? value : internalVal;

  const handleSelect = (tabId: string) => {
    if (value === undefined) {
      setInternalVal(tabId);
    }
    onChange?.(tabId);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={twMerge(
        clsx(
          'inline-flex items-center p-1 rounded-full bg-[var(--surface-raised,#171717)] border border-[var(--line,#262626)] select-none overflow-x-auto no-scrollbar',
          className,
        ),
      )}
    >
      {items.map((tab, idx) => {
        const tabId = tab.id || tab.label;
        const isSelected = currentVal === tabId;

        return (
          <button
            key={idx}
            role="tab"
            type="button"
            aria-selected={isSelected}
            onClick={() => handleSelect(tabId)}
            className={clsx(
              'inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer whitespace-nowrap focus-visible:outline-none focus-ring',
              isSelected
                ? 'bg-[var(--inverse,#f3f3f3)] text-[var(--on-inverse,#0b0b0b)] font-semibold shadow-xs'
                : 'text-[var(--ink-muted,#a3a3a3)] hover:text-[var(--ink,#f5f5f5)] hover:bg-[var(--surface-strong,#2b2b2b)]',
            )}
          >
            {tab.icon && <Icon name={tab.icon} size={14} />}
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count !== null && (
              <span
                className={clsx(
                  'text-[10px] font-bold px-1.5 py-0.2 rounded-full leading-none ml-0.5',
                  isSelected
                    ? 'bg-[var(--on-inverse,#0b0b0b)] text-[var(--inverse,#f3f3f3)]'
                    : 'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)]',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
