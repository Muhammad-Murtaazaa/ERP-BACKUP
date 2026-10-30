import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';

export interface SideRailItem {
  icon: IconName;
  label: string;
  active?: boolean;
}

export interface SideRailProps {
  items: SideRailItem[];
  accent?: 'inverse' | 'lime';
  showLabels?: boolean;
  onSelect?: (item: SideRailItem, index: number) => void;
  label?: string;
  className?: string;
  bottomItems?: React.ReactNode;
}

export const SideRail: React.FC<SideRailProps> = ({
  items,
  accent = 'inverse',
  showLabels = false,
  onSelect,
  label = 'Navigation',
  className,
  bottomItems,
}) => {
  return (
    <nav
      aria-label={label}
      className={twMerge(
        clsx(
          'w-[72px] h-full flex flex-col items-center justify-between py-3 select-none shrink-0 z-20',
          className,
        ),
      )}
    >
      <div className="flex flex-col items-center gap-3 w-full">
        {items.map((item, index) => {
          const isActive = item.active;

          let buttonStyle =
            'w-11 h-11 rounded-full flex flex-col items-center justify-center transition-all duration-150 cursor-pointer focus-visible:outline-none focus-ring';

          if (isActive) {
            buttonStyle +=
              accent === 'lime'
                ? ' bg-[var(--lime,#9df747)] text-[var(--on-lime,#0b0b0b)] shadow-sm'
                : ' bg-[var(--inverse,#f3f3f3)] text-[var(--on-inverse,#0b0b0b)] shadow-sm';
          } else {
            buttonStyle +=
              ' bg-transparent text-[var(--ink-muted,#a3a3a3)] hover:text-[var(--ink,#f5f5f5)] hover:bg-[var(--surface-strong,#2b2b2b)]';
          }

          return (
            <button
              key={index}
              type="button"
              title={item.label}
              aria-label={item.label}
              onClick={() => onSelect?.(item, index)}
              className="group flex flex-col items-center gap-1 w-full"
            >
              <div className={buttonStyle}>
                <Icon name={item.icon} size={20} />
              </div>
              {showLabels && (
                <span className="text-[10px] font-medium tracking-tight truncate max-w-[64px] text-center text-[var(--ink-muted,#a3a3a3)] group-hover:text-[var(--ink,#f5f5f5)]">
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {bottomItems && <div className="flex flex-col items-center gap-2">{bottomItems}</div>}
    </nav>
  );
};
