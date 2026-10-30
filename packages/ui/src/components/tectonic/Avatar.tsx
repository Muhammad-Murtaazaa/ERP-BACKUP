import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface Person {
  name: string;
  role?: string;
  src?: string;
}

export interface AvatarProps {
  name: string;
  src?: string;
  size?: number; // 24, 28, 32, 36
  tone?: 'lime' | 'paper';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  size = 32,
  tone,
  className,
}) => {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  const fontSize = size <= 24 ? 'text-[9px]' : size <= 28 ? 'text-[10px]' : 'text-xs';

  let toneStyle =
    'bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink,#f5f5f5)] border border-[var(--line,#262626)]';
  if (tone === 'lime') {
    toneStyle =
      'bg-[var(--on-lime,#0b0b0b)] text-[var(--lime,#9df747)] border border-[var(--on-lime,#0b0b0b)]';
  } else if (tone === 'paper') {
    toneStyle =
      'bg-[var(--paper-sunken,#d9d9d9)] text-[var(--on-inverse,#0b0b0b)] border border-transparent';
  }

  return (
    <div
      title={name}
      aria-label={name}
      style={{ width: size, height: size }}
      className={twMerge(
        clsx(
          'relative inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 select-none font-bold tracking-wider',
          fontSize,
          toneStyle,
          className,
        ),
      )}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <span>{initials || 'U'}</span>
      )}
    </div>
  );
};
