import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  values = [],
  width = 96,
  height = 32,
  color = 'var(--chart-1,#62a802)',
  label = 'Trend from first to last',
  className,
}) => {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 3;

  const points = values.map((val, idx) => {
    const x = padding + (idx / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((val - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const pathData = `M ${points.join(' L ')}`;
  const [lastX, lastY] = points[points.length - 1].split(',').map(Number);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={twMerge(clsx('overflow-visible select-none shrink-0', className))}
      aria-label={label}
      role="img"
    >
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={3}
        fill={color}
        stroke="var(--surface,#131313)"
        strokeWidth={1.5}
      />
    </svg>
  );
};
