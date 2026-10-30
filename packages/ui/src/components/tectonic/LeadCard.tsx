import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Avatar } from './Avatar.js';
import { HeatMeter } from './HeatMeter.js';
import { IconButton } from './IconButton.js';

export interface LeadCardProps {
  name: string;
  role?: string;
  avatarSrc?: string;
  sources?: string[];
  heat?: 0 | 1 | 2 | 3 | 4 | 5;
  heatLabel?: string;
  onOpen?: () => void;
  className?: string;
}

export const LeadCard: React.FC<LeadCardProps> = ({
  name,
  role,
  avatarSrc,
  sources = [],
  heat = 4,
  heatLabel,
  onOpen,
  className,
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'relative w-64 p-4 rounded-[16px] bg-[var(--surface-raised,#171717)] border border-[var(--line,#262626)] flex flex-col justify-between gap-3 text-left select-none transition-all duration-150 tt-notch',
          className,
        ),
      )}
    >
      {/* Top: Avatar and Open Arrow Button in the Notch */}
      <div className="flex items-start justify-between">
        <Avatar name={name} src={avatarSrc} size={36} />

        {onOpen && (
          <div className="absolute top-2 right-2">
            <IconButton
              icon="arrow-up-right"
              label={`Open lead record for ${name}`}
              size="sm"
              variant="outline"
              onClick={onOpen}
            />
          </div>
        )}
      </div>

      {/* Center: Name & Role */}
      <div className="flex flex-col min-w-0 pr-8">
        <h4 className="font-sans font-semibold text-sm text-[var(--ink,#f5f5f5)] truncate">
          {name}
        </h4>
        {role && (
          <p className="text-xs text-[var(--ink-muted,#a3a3a3)] truncate mt-0.5">
            {role}
          </p>
        )}
      </div>

      {/* Bottom: Sources & HeatMeter */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--line,#262626)]">
        <div className="flex items-center gap-1 overflow-hidden">
          {sources.map((src, i) => (
            <span
              key={i}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--surface-strong,#2b2b2b)] text-[var(--ink-muted,#a3a3a3)]"
            >
              {src}
            </span>
          ))}
        </div>

        <HeatMeter level={heat} label={heatLabel} />
      </div>
    </div>
  );
};
