import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Icon } from './Icon.js';

export interface SchedulePerson {
  name: string;
  role?: string;
  src?: string;
}

export interface ScheduleEvent {
  people: SchedulePerson[];
  label?: string;
  time?: string;
  live?: boolean;
  onOpen?: () => void;
  onJoin?: () => void;
}

export interface TopBarProps {
  title?: string;
  date?: React.ReactNode;
  events?: ScheduleEvent[];
  onExpand?: () => void;
  className?: string;
  children?: React.ReactNode; // Extra right-side actions like theme switcher, persona, search
}

export const TopBar: React.FC<TopBarProps> = ({
  title = 'Your Schedule',
  date = '30 October',
  events = [],
  onExpand,
  className,
  children,
}) => {
  return (
    <header
      className={twMerge(
        clsx(
          'w-full h-12 px-3 rounded-full bg-[var(--inverse,#f3f3f3)] text-[var(--on-inverse,#0b0b0b)]',
          'flex items-center justify-between gap-3 shadow-md select-none shrink-0 transition-colors duration-150',
          className,
        ),
      )}
    >
      {/* Left: Title & Date pill */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-semibold tracking-tight px-2">{title}</span>
        {date && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--canvas,#0b0b0b)] text-[var(--ink,#f5f5f5)] border border-[var(--line,#262626)]">
            <Icon name="calendar" size={13} />
            <span>{date}</span>
          </span>
        )}
      </div>

      {/* Center: Meeting pills track */}
      <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
        {events.map((evt, idx) => {
          const initials = evt.people
            .map((p) => p.name.slice(0, 2).toUpperCase())
            .join(' ');

          if (evt.live) {
            return (
              <div
                key={idx}
                className="flex items-center gap-2.5 px-3 py-1 rounded-full bg-[var(--lime-soft,#b5fc96)] text-[var(--on-lime,#0b0b0b)] font-medium text-xs shadow-xs animate-pulse-subtle shrink-0"
              >
                <span className="flex items-center gap-1 font-bold text-[10px] tracking-wider uppercase bg-[var(--on-lime,#0b0b0b)] text-[var(--lime,#9df747)] px-1.5 py-0.5 rounded-full">
                  {initials}
                </span>
                <span className="font-semibold">{evt.label || 'Live meeting'}</span>
                {evt.time && <span className="opacity-70 text-[11px]">{evt.time}</span>}
                {evt.onJoin && (
                  <button
                    type="button"
                    onClick={evt.onJoin}
                    title="Join live call"
                    className="p-1 rounded-full bg-[var(--on-lime,#0b0b0b)] text-[var(--lime,#9df747)] hover:opacity-90 cursor-pointer"
                  >
                    <Icon name="video" size={12} />
                  </button>
                )}
              </div>
            );
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={evt.onOpen}
              className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-[var(--canvas,#0b0b0b)] text-[var(--ink,#f5f5f5)] border border-[var(--line,#262626)] hover:bg-[var(--surface-strong,#2b2b2b)] transition-colors text-xs shrink-0 cursor-pointer"
            >
              <span className="font-bold text-[10px] tracking-wider uppercase bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)] px-1.5 py-0.5 rounded-full">
                {initials}
              </span>
              <span className="truncate max-w-[140px] font-medium">{evt.label}</span>
              {evt.time && <span className="text-[var(--ink-muted,#a3a3a3)] text-[11px]">{evt.time}</span>}
            </button>
          );
        })}
      </div>

      {/* Right: Expand arrow & slot for custom tools (search, theme, user) */}
      <div className="flex items-center gap-2 shrink-0">
        {children}
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            title="Open full schedule"
            className="w-7 h-7 rounded-full bg-[var(--canvas,#0b0b0b)] text-[var(--ink,#f5f5f5)] hover:bg-[var(--surface-strong,#2b2b2b)] flex items-center justify-center transition-colors cursor-pointer"
          >
            <Icon name="arrow-up-right" size={14} />
          </button>
        )}
      </div>
    </header>
  );
};
