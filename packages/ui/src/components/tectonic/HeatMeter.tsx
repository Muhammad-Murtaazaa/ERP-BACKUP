import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface HeatMeterProps {
  level: 0 | 1 | 2 | 3 | 4 | 5;
  label?: string;
  className?: string;
}

export const HeatMeter: React.FC<HeatMeterProps> = ({
  level = 0,
  label,
  className,
}) => {
  const litColor = (idx: number) => {
    if (idx >= level) return 'bg-[var(--heat-1,#6b6b6b)] opacity-30'; // unlit
    if (level === 1) return 'bg-[var(--heat-2,#ff6a4d)]'; // red
    if (level === 2) return 'bg-[var(--heat-3,#ff9d3d)]'; // orange
    if (level === 3 || level === 4) return 'bg-[var(--heat-4,#f2e94e)]'; // yellow
    return 'bg-[var(--heat-5,#9df747)]'; // lime
  };

  const accessibleText = label || `Heat: ${level} of 5`;

  return (
    <div
      title={accessibleText}
      aria-label={accessibleText}
      className={twMerge(clsx('inline-flex flex-col gap-1 select-none', className))}
    >
      {label && (
        <span className="text-[10px] font-medium text-[var(--ink-muted,#a3a3a3)] leading-none">
          {label}
        </span>
      )}
      <div className="flex items-center gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={clsx(
              'w-1.5 h-1.5 rounded-full transition-colors duration-150',
              litColor(i),
            )}
          />
        ))}
      </div>
    </div>
  );
};
