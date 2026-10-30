import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Avatar, Person } from './Avatar.js';

export interface AvatarStackProps {
  people: Array<Person | string>;
  max?: number;
  size?: number;
  className?: string;
}

export const AvatarStack: React.FC<AvatarStackProps> = ({
  people = [],
  max = 3,
  size = 28,
  className,
}) => {
  const visible = people.slice(0, max);
  const remaining = people.length - max;

  return (
    <div
      className={twMerge(
        clsx('inline-flex items-center -space-x-2 select-none', className),
      )}
    >
      {visible.map((p, idx) => {
        const name = typeof p === 'string' ? p : p.name;
        const src = typeof p === 'string' ? undefined : p.src;
        return (
          <div
            key={idx}
            className="rounded-full ring-2 ring-[var(--canvas,#0b0b0b)]"
            style={{ zIndex: 10 - idx }}
          >
            <Avatar name={name} src={src} size={size} />
          </div>
        );
      })}

      {remaining > 0 && (
        <div
          style={{ width: size, height: size, zIndex: 1 }}
          className="rounded-full ring-2 ring-[var(--canvas,#0b0b0b)] bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)] flex items-center justify-center text-[10px] font-bold"
        >
          +{remaining}
        </div>
      )}
    </div>
  );
};
