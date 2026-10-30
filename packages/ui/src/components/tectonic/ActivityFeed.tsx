import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon, IconName } from './Icon.js';
import { Avatar } from './Avatar.js';

export interface ActivityItem {
  who?: string;
  action: React.ReactNode;
  target?: React.ReactNode;
  time: string;
  icon?: IconName;
  agent?: boolean;
}

export interface ActivityFeedProps {
  items: ActivityItem[];
  className?: string;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  items = [],
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx('w-full flex flex-col gap-3 select-none text-left', className),
      )}
    >
      {items.map((item, idx) => {
        const isAgent = item.agent || item.who?.toLowerCase().includes('agent');

        return (
          <div
            key={idx}
            className="flex items-start gap-3 p-2.5 rounded-[12px] bg-[var(--surface-raised,#171717)] border border-[var(--line,#262626)] transition-all duration-150"
          >
            {/* Left avatar / agent spark badge */}
            <div className="shrink-0 mt-0.5">
              {isAgent ? (
                <div className="w-7 h-7 rounded-full bg-[var(--lime,#9df747)] text-[var(--on-lime,#0b0b0b)] flex items-center justify-center shadow-xs">
                  <Icon name="spark" size={14} />
                </div>
              ) : item.who ? (
                <Avatar name={item.who} size={28} />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)] flex items-center justify-center">
                  <Icon name={item.icon || 'file'} size={14} />
                </div>
              )}
            </div>

            {/* Content & Timestamp */}
            <div className="flex-1 min-w-0 flex flex-col leading-snug">
              <div className="text-xs text-[var(--ink,#f5f5f5)]">
                <span
                  className={clsx(
                    'font-semibold mr-1.5',
                    isAgent ? 'text-[var(--lime-text,#9df747)]' : 'text-[var(--ink,#f5f5f5)]',
                  )}
                >
                  {item.who || (isAgent ? 'Tectonic Agent' : 'System')}
                </span>
                <span className="text-[var(--ink-muted,#a3a3a3)] font-normal mr-1">
                  {item.action}
                </span>
                {item.target && (
                  <span className="font-mono font-semibold text-[var(--ink,#f5f5f5)]">
                    {item.target}
                  </span>
                )}
              </div>

              <span className="text-[10px] text-[var(--ink-subtle,#8a8a8a)] mt-0.5">
                {item.time}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
