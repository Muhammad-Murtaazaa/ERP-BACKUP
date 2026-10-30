import React from 'react';
import { clsx } from 'clsx';
import { Icon } from './Icon.js';

export interface AgentMarkProps {
  size?: number;
  busy?: boolean;
  className?: string;
}

export const AgentMark: React.FC<AgentMarkProps> = ({
  size = 28,
  busy = false,
  className,
}) => {
  return (
    <div
      style={{ width: size, height: size }}
      className={clsx(
        'rounded-full bg-[var(--lime,#9df747)] text-[var(--on-lime,#0b0b0b)] flex items-center justify-center shrink-0 shadow-xs transition-transform',
        busy && 'animate-pulse',
        className,
      )}
    >
      <Icon name="spark" size={Math.round(size * 0.55)} />
    </div>
  );
};
