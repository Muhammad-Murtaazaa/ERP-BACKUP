import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AgentMark } from './AgentMark.js';
import { Avatar } from './Avatar.js';
import { Button } from './Button.js';
import { Icon, IconName } from './Icon.js';

export interface AgentStep {
  label: string;
  detail?: string;
  status?: 'done' | 'running' | 'todo' | 'failed';
}

export interface AgentAction {
  label: string;
  icon?: IconName;
  primary?: boolean;
  onClick?: () => void;
}

export interface AgentMessageProps {
  from?: 'agent' | 'user';
  name?: string;
  time?: string;
  avatarSrc?: string;
  busy?: boolean;
  children?: React.ReactNode;
  steps?: AgentStep[];
  actions?: AgentAction[];
  className?: string;
}

export const AgentMessage: React.FC<AgentMessageProps> = ({
  from = 'agent',
  name,
  time,
  avatarSrc,
  busy = false,
  children,
  steps = [],
  actions = [],
  className,
}) => {
  const isAgent = from === 'agent';

  return (
    <div
      className={twMerge(
        clsx(
          'w-full flex items-start gap-3 select-none text-left',
          !isAgent && 'flex-row-reverse',
          className,
        ),
      )}
    >
      {/* Avatar or Agent Mark */}
      <div className="shrink-0 mt-0.5">
        {isAgent ? (
          <AgentMark size={32} busy={busy} />
        ) : (
          <Avatar name={name || 'User'} src={avatarSrc} size={32} />
        )}
      </div>

      {/* Message bubble */}
      <div
        className={clsx(
          'max-w-[85%] md:max-w-[75%] rounded-[20px] p-4 flex flex-col gap-2.5 transition-all duration-150',
          isAgent
            ? 'bg-[var(--surface,#131313)] border border-[var(--line,#262626)] text-[var(--ink,#f5f5f5)] shadow-xs'
            : 'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink,#f5f5f5)] rounded-tr-[4px]',
        )}
      >
        {/* Sender name & time */}
        <div className="flex items-center gap-2 text-xs">
          <span
            className={clsx(
              'font-semibold',
              isAgent ? 'text-[var(--lime-text,#9df747)]' : 'text-[var(--ink,#f5f5f5)]',
            )}
          >
            {name || (isAgent ? 'Tectonic Agent' : 'You')}
          </span>
          {time && <span className="text-[var(--ink-subtle,#8a8a8a)] text-[10px]">{time}</span>}
        </div>

        {/* Text body */}
        {children && (
          <div className="text-sm font-normal leading-relaxed text-[var(--ink,#f5f5f5)]">
            {children}
          </div>
        )}

        {/* Audit trail steps */}
        {steps.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-[var(--line,#262626)]">
            {steps.map((st, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs py-1 px-2 rounded-[8px] bg-[var(--surface-raised,#171717)] font-mono"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'w-4 h-4 rounded-full flex items-center justify-center text-[10px]',
                      st.status === 'done' || !st.status
                        ? 'bg-[var(--positive-fill,#2f4a1c)] text-[var(--positive-text,#c2f59a)]'
                        : st.status === 'failed'
                        ? 'bg-[var(--danger-fill,#4f2219)] text-[var(--danger-text,#ff9f87)]'
                        : 'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)]',
                    )}
                  >
                    {st.status === 'done' || !st.status ? (
                      <Icon name="check" size={10} strokeWidth={2.5} />
                    ) : st.status === 'failed' ? (
                      <Icon name="x" size={10} strokeWidth={2.5} />
                    ) : (
                      <Icon name="loader" size={10} className="animate-spin" />
                    )}
                  </span>
                  <span className="text-[var(--ink,#f5f5f5)]">{st.label}</span>
                </div>

                {st.detail && (
                  <span className="text-[var(--ink-muted,#a3a3a3)] text-[11px]">
                    {st.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        {actions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--line,#262626)]">
            {actions.map((act, i) => (
              <Button
                key={i}
                size="sm"
                variant={act.primary ? 'primary' : 'outline'}
                shape="pill"
                icon={act.icon}
                onClick={act.onClick}
              >
                {act.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
