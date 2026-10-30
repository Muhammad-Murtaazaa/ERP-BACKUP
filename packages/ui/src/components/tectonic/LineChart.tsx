import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Series, CHART_COLORS, compact } from './chartUtils.js';

export interface LineChartProps {
  labels: string[];
  series: Series[];
  title?: string;
  subtitle?: string;
  format?: (v: number) => string;
  area?: boolean;
  height?: number;
  className?: string;
}

export const LineChart: React.FC<LineChartProps> = ({
  labels = [],
  series = [],
  title,
  subtitle,
  format = compact,
  area = false,
  height = 240,
  className,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (labels.length === 0 || series.length === 0) return null;

  const allValues = series.flatMap((s) => s.values);
  const minVal = Math.min(0, ...allValues);
  const maxVal = Math.max(...allValues) || 1;
  const range = maxVal - minVal || 1;

  const padLeft = 45;
  const padRight = 30;
  const padTop = 20;
  const padBottom = 30;
  const chartWidth = 600;
  const innerWidth = chartWidth - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;

  const getX = (idx: number) =>
    padLeft + (idx / Math.max(1, labels.length - 1)) * innerWidth;
  const getY = (val: number) =>
    padTop + innerHeight - ((val - minVal) / range) * innerHeight;

  return (
    <div
      className={twMerge(
        clsx(
          'w-full p-5 rounded-[24px] bg-[var(--surface,#131313)] border border-[var(--line,#262626)] flex flex-col gap-4 select-none text-left shadow-xs',
          className,
        ),
      )}
    >
      {/* Chart header & Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {title && (
            <h4 className="font-sans font-semibold text-sm text-[var(--ink,#f5f5f5)]">
              {title}
            </h4>
          )}
          {subtitle && (
            <p className="text-xs text-[var(--ink-muted,#a3a3a3)] mt-0.5">
              {subtitle}
            </p>
          )}
        </div>

        {series.length > 1 && (
          <div className="flex items-center gap-4 text-xs font-medium">
            {series.map((s, idx) => {
              const color = s.color || CHART_COLORS[idx % CHART_COLORS.length];
              return (
                <span key={idx} className="flex items-center gap-1.5 text-[var(--ink-muted,#a3a3a3)]">
                  <span
                    style={{ backgroundColor: color }}
                    className="w-2.5 h-2.5 rounded-full inline-block"
                  />
                  <span>{s.name}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* SVG Line chart */}
      <div className="w-full relative">
        <svg
          viewBox={`0 0 ${chartWidth} ${height}`}
          className="w-full h-auto overflow-visible"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Horizontal Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
            const y = padTop + innerHeight * (1 - pct);
            const val = minVal + range * pct;
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={chartWidth - padRight}
                  y2={y}
                  stroke="var(--line,#262626)"
                  strokeWidth={1}
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--ink-subtle,#8a8a8a)"
                  className="font-mono tabular-nums"
                >
                  {format(val)}
                </text>
              </g>
            );
          })}

          {/* X-axis labels */}
          {labels.map((lbl, idx) => {
            const x = getX(idx);
            return (
              <text
                key={idx}
                x={x}
                y={height - 8}
                textAnchor="middle"
                fontSize="11"
                fill="var(--ink-subtle,#8a8a8a)"
              >
                {lbl}
              </text>
            );
          })}

          {/* Hover vertical line */}
          {hoverIndex !== null && (
            <line
              x1={getX(hoverIndex)}
              y1={padTop}
              x2={getX(hoverIndex)}
              y2={padTop + innerHeight}
              stroke="var(--chart-axis,#4a4a4a)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          )}

          {/* Series lines & optional single-series area wash */}
          {series.map((s, sIdx) => {
            const color = s.color || CHART_COLORS[sIdx % CHART_COLORS.length];
            const points = s.values.map((v, i) => `${getX(i)},${getY(v)}`);
            const pathD = `M ${points.join(' L ')}`;

            return (
              <g key={sIdx}>
                {area && sIdx === 0 && (
                  <path
                    d={`${pathD} L ${getX(s.values.length - 1)},${padTop + innerHeight} L ${padLeft},${padTop + innerHeight} Z`}
                    fill={color}
                    fillOpacity={0.12}
                  />
                )}
                <path
                  d={pathD}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* End dot with 2px surface ring */}
                {s.values.length > 0 && (
                  <circle
                    cx={getX(s.values.length - 1)}
                    cy={getY(s.values[s.values.length - 1])}
                    r={4}
                    fill={color}
                    stroke="var(--surface,#131313)"
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}

          {/* Invisible hover triggers */}
          {labels.map((_, idx) => (
            <rect
              key={idx}
              x={getX(idx) - (innerWidth / labels.length) / 2}
              y={padTop}
              width={innerWidth / labels.length}
              height={innerHeight}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(idx)}
              className="cursor-crosshair"
            />
          ))}
        </svg>

        {/* Hover Tooltip */}
        {hoverIndex !== null && (
          <div
            style={{
              left: `${(getX(hoverIndex) / chartWidth) * 100}%`,
              transform: 'translateX(-50%)',
              top: '10px',
            }}
            className="absolute pointer-events-none p-2 rounded-[8px] bg-[var(--surface-strong,#2b2b2b)] border border-[var(--line-strong,#6b6b6b)] text-xs text-[var(--ink,#f5f5f5)] shadow-md z-30 min-w-[100px]"
          >
            <div className="font-semibold pb-1 border-b border-[var(--line,#262626)] mb-1 text-[var(--ink-muted,#a3a3a3)]">
              {labels[hoverIndex]}
            </div>
            {series.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-3 font-mono text-[11px]">
                <span className="text-[var(--ink-muted,#a3a3a3)]">{s.name}:</span>
                <span className="font-bold">{format(s.values[hoverIndex] || 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
