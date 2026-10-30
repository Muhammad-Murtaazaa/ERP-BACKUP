import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Series, CHART_COLORS, compact } from './chartUtils.js';

export interface BarChartProps {
  labels: string[];
  series: Series[];
  stacked?: boolean;
  title?: string;
  subtitle?: string;
  format?: (v: number) => string;
  height?: number;
  target?: number;
  targetLabel?: string;
  highlight?: number;
  valueLabels?: boolean;
  className?: string;
}

export const BarChart: React.FC<BarChartProps> = ({
  labels = [],
  series = [],
  stacked = false,
  title,
  subtitle,
  format = compact,
  height = 240,
  target,
  targetLabel = 'Target',
  highlight,
  valueLabels = true,
  className,
}) => {
  if (labels.length === 0 || series.length === 0) return null;

  const maxVal = Math.max(
    ...labels.map((_, i) =>
      stacked
        ? series.reduce((sum, s) => sum + (s.values[i] || 0), 0)
        : Math.max(...series.map((s) => s.values[i] || 0)),
    ),
    target || 0,
    1,
  );

  const padLeft = 45;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 30;
  const chartWidth = 600;
  const innerWidth = chartWidth - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const groupWidth = innerWidth / labels.length;
  const colWidth = Math.min(24, (groupWidth * 0.7) / (stacked ? 1 : series.length));

  return (
    <div
      className={twMerge(
        clsx(
          'w-full p-5 rounded-[24px] bg-[var(--surface,#131313)] border border-[var(--line,#262626)] flex flex-col gap-4 select-none text-left shadow-xs',
          className,
        ),
      )}
    >
      {/* Header & target info */}
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

        {target && (
          <span className="text-xs font-mono text-[var(--ink-muted,#a3a3a3)]">
            {targetLabel}: <span className="font-bold text-[var(--ink,#f5f5f5)]">{format(target)}</span>
          </span>
        )}
      </div>

      {/* SVG Bar Chart */}
      <div className="w-full relative">
        <svg viewBox={`0 0 ${chartWidth} ${height}`} className="w-full h-auto overflow-visible">
          {/* Target Reference Line */}
          {target && (
            <g>
              <line
                x1={padLeft}
                y1={padTop + innerHeight * (1 - target / maxVal)}
                x2={chartWidth - padRight}
                y2={padTop + innerHeight * (1 - target / maxVal)}
                stroke="var(--ink-muted,#a3a3a3)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
              <text
                x={chartWidth - padRight}
                y={padTop + innerHeight * (1 - target / maxVal) - 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--ink-muted,#a3a3a3)"
                className="font-mono"
              >
                {targetLabel} ({format(target)})
              </text>
            </g>
          )}

          {/* Grid baseline */}
          <line
            x1={padLeft}
            y1={padTop + innerHeight}
            x2={chartWidth - padRight}
            y2={padTop + innerHeight}
            stroke="var(--line,#262626)"
            strokeWidth={1.5}
          />

          {/* Bars */}
          {labels.map((lbl, i) => {
            const groupX = padLeft + i * groupWidth + (groupWidth - colWidth * (stacked ? 1 : series.length)) / 2;
            const isHighlight = highlight !== undefined ? highlight === i : true;

            if (stacked) {
              let currentY = padTop + innerHeight;
              const totalVal = series.reduce((acc, s) => acc + (s.values[i] || 0), 0);

              return (
                <g key={i}>
                  {series.map((s, sIdx) => {
                    const val = s.values[i] || 0;
                    const h = (val / maxVal) * innerHeight;
                    currentY -= h;
                    const color = !isHighlight
                      ? 'var(--chart-muted,#3a3a3a)'
                      : s.color || CHART_COLORS[sIdx % CHART_COLORS.length];

                    return (
                      <rect
                        key={sIdx}
                        x={groupX}
                        y={currentY}
                        width={colWidth}
                        height={Math.max(0, h - 2)}
                        rx={sIdx === series.length - 1 ? 4 : 0}
                        fill={color}
                      />
                    );
                  })}

                  {valueLabels && totalVal > 0 && (
                    <text
                      x={groupX + colWidth / 2}
                      y={currentY - 4}
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--ink-muted,#a3a3a3)"
                      className="font-mono tabular-nums"
                    >
                      {format(totalVal)}
                    </text>
                  )}

                  <text
                    x={groupX + colWidth / 2}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--ink-subtle,#8a8a8a)"
                  >
                    {lbl}
                  </text>
                </g>
              );
            }

            // Grouped / Single series
            return (
              <g key={i}>
                {series.map((s, sIdx) => {
                  const val = s.values[i] || 0;
                  const h = (val / maxVal) * innerHeight;
                  const barX = groupX + sIdx * colWidth;
                  const barY = padTop + innerHeight - h;
                  const color = !isHighlight
                    ? 'var(--chart-muted,#3a3a3a)'
                    : s.color || CHART_COLORS[sIdx % CHART_COLORS.length];

                  return (
                    <g key={sIdx}>
                      <rect
                        x={barX}
                        y={barY}
                        width={colWidth}
                        height={h}
                        rx={4}
                        fill={color}
                      />
                      {valueLabels && val > 0 && (
                        <text
                          x={barX + colWidth / 2}
                          y={barY - 4}
                          textAnchor="middle"
                          fontSize="10"
                          fill="var(--ink,#f5f5f5)"
                          className="font-mono tabular-nums"
                        >
                          {format(val)}
                        </text>
                      )}
                    </g>
                  );
                })}

                <text
                  x={groupX + (colWidth * series.length) / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--ink-subtle,#8a8a8a)"
                >
                  {lbl}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
