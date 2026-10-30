import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Avatar, Person } from './Avatar.js';
import { AvatarStack } from './AvatarStack.js';
import { Icon, IconName } from './Icon.js';
import { IconButton } from './IconButton.js';

export interface TaskCardProps {
  active?: boolean;
  person?: Person;
  icon?: IconName;
  title: React.ReactNode;
  date?: React.ReactNode;
  people?: Person[];
  assignee?: Person & { status?: string };
  status?: React.ReactNode;
  actions?: Array<{
    icon: IconName;
    label: string;
    primary?: boolean;
    onClick?: () => void;
  }>;
  onOpen?: () => void;
  onRemind?: () => void;
  className?: string;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  active = false,
  person,
  icon = 'calendar',
  title,
  date,
  people = [],
  assignee,
  status,
  actions = [],
  onOpen,
  onRemind,
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'relative w-72 p-4 rounded-[16px] transition-all duration-150 flex flex-col justify-between gap-3 text-left select-none tt-notch--2',
          active
            ? 'bg-[var(--lime,#9df747)] text-[var(--on-lime,#0b0b0b)] border border-transparent shadow-md'
            : 'bg-[var(--surface-muted,#3a3a3a)] text-[var(--ink,#f5f5f5)] border border-[var(--line,#262626)]',
          className,
        ),
      )}
    >
      {/* Top Person Info + Remind and Open double buttons */}
      <div className="flex items-start justify-between">
        {person && (
          <div className="flex items-center gap-2.5 min-w-0 pr-16">
            <Avatar
              name={person.name}
              src={person.src}
              size={32}
              tone={active ? 'lime' : undefined}
            />
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-xs truncate">{person.name}</span>
              {person.role && (
                <span
                  className={clsx(
                    'text-[10px] truncate',
                    active ? 'text-black/70' : 'text-[var(--ink-muted,#a3a3a3)]',
                  )}
                >
                  {person.role}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Double notch buttons in top-right */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {onRemind && (
            <IconButton
              icon="bell"
              label="Remind"
              size="sm"
              variant={active ? 'on-lime' : 'outline'}
              onClick={onRemind}
            />
          )}
          {onOpen && (
            <IconButton
              icon="arrow-up-right"
              label="Open record"
              size="sm"
              variant={active ? 'on-lime' : 'outline'}
              onClick={onOpen}
            />
          )}
        </div>
      </div>

      {/* Title & Date */}
      <div className="flex flex-col gap-1 pr-6">
        <div className="flex items-center gap-1.5 font-medium text-xs">
          <Icon name={icon} size={13} />
          <span className="font-semibold truncate">{title}</span>
        </div>
        {date && (
          <span
            className={clsx(
              'text-[11px] font-medium ml-4',
              active ? 'text-black/80' : 'text-[var(--ink-muted,#a3a3a3)]',
            )}
          >
            {date}
          </span>
        )}
      </div>

      {/* Bottom: Assignee/people stack + action pills */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-black/10 dark:border-white/10">
        <div className="flex items-center gap-1.5">
          {assignee && (
            <span
              className={clsx(
                'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                active
                  ? 'bg-black/15 text-black'
                  : 'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)]',
              )}
            >
              <Avatar
                name={assignee.name}
                size={16}
                tone={active ? 'lime' : undefined}
              />
              <span>{status || assignee.status || 'Assigned'}</span>
            </span>
          )}

          {people.length > 0 && <AvatarStack people={people} size={20} />}
        </div>

        {actions.length > 0 && (
          <div className="flex items-center gap-1">
            {actions.map((act, i) => (
              <button
                key={i}
                type="button"
                onClick={act.onClick}
                title={act.label}
                className={clsx(
                  'p-1.5 rounded-full transition-colors cursor-pointer',
                  active
                    ? 'bg-black/20 text-black hover:bg-black/30'
                    : 'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink,#f5f5f5)] hover:bg-[var(--line-strong,#6b6b6b)]',
                )}
              >
                <Icon name={act.icon} size={14} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
