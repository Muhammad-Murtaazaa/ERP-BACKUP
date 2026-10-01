import React, { useState } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

// ============================================================================
// 1. BKLIT LIGHT-THEME SPARKLINE
// ============================================================================
export interface SparklineProps {
  data: number[];
  color?: string;
  fillColor?: string;
  width?: number;
  height?: number;
}

export const BklitSparkline: React.FC<SparklineProps> = ({
  data,
  color = '#5940B8',
  fillColor = '#8B5CF6',
  width = 120,
  height = 40,
}) => {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 8) - 4;
    return { x, y };
  });

  const pathD = points.reduce((acc, p, idx) => {
    if (idx === 0) return `M ${p.x} ${p.y}`;
    const prev = points[idx - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
  }, '');

  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  const gradId = `spark-grad-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={fillColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={fillColor} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={color} stroke="#FFFFFF" strokeWidth="1.5" />
    </svg>
  );
};

// ============================================================================
// 2. BKLIT LIGHT-THEME KPI METRIC CARD
// ============================================================================
export interface BklitKpiCardProps {
  title: string;
  value: string;
  change?: string;
  isPositive?: boolean;
  period?: string;
  icon?: React.ReactNode;
  sparklineData?: number[];
  onClick?: () => void;
}

export const BklitKpiCard: React.FC<BklitKpiCardProps> = ({
  title,
  value,
  change,
  isPositive = true,
  period = 'vs last month',
  sparklineData = [12, 18, 15, 24, 28, 35, 42],
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-zinc-200/90 p-5 shadow-xs hover:shadow-md hover:border-purple-300 transition-all duration-200 flex flex-col justify-between select-none ${
        onClick ? 'cursor-pointer hover:-translate-y-0.5 group' : ''
      }`}
    >
      {/* Top row: Title + Clean top-right arrow action button */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 pr-2">
          <span className="text-xs font-semibold text-zinc-500 tracking-wider uppercase">{title}</span>
          <div className="text-2xl font-black text-zinc-900 tracking-tight mt-1 font-sans">{value}</div>
        </div>

        {onClick && (
          <div
            className="h-8 w-8 rounded-full bg-zinc-100 text-zinc-500 group-hover:bg-[#5940B8] group-hover:text-white flex items-center justify-center transition-all duration-200 shadow-2xs shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            title={`View ${title}`}
          >
            <ArrowUpRight size={15} strokeWidth={2.5} />
          </div>
        )}
      </div>

      {/* Bottom row: Change pill + Period + Sparkline */}
      <div className="flex items-end justify-between mt-4 pt-3 border-t border-zinc-100">
        <div className="flex items-center gap-1.5 flex-wrap">
          {change && (
            <span
              className={`inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                isPositive ? 'bg-purple-50 text-purple-700 border border-purple-200/60' : 'bg-rose-50 text-rose-700 border border-rose-200/60'
              }`}
            >
              {isPositive ? <ArrowUpRight size={13} strokeWidth={2.5} /> : <ArrowDownRight size={13} strokeWidth={2.5} />}
              {change}
            </span>
          )}
          <span className="text-[11px] text-zinc-400 font-medium">{period}</span>
        </div>

        {sparklineData && (
          <div className="shrink-0">
            <BklitSparkline data={sparklineData} color={isPositive ? '#5940B8' : '#E11D48'} fillColor={isPositive ? '#8B5CF6' : '#F43F5E'} />
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 3. BKLIT LIGHT-THEME AREA CHART
// ============================================================================
export interface AreaDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  formattedValue?: string;
  formattedSecondary?: string;
}

export interface BklitAreaChartProps {
  title: string;
  description?: string;
  data: AreaDataPoint[];
  primarySeriesName?: string;
  secondarySeriesName?: string;
  primaryColor?: string;
  secondaryColor?: string;
  height?: number;
  badgeText?: string;
}

export const BklitAreaChart: React.FC<BklitAreaChartProps> = ({
  title,
  description,
  data,
  primarySeriesName = 'Revenue',
  secondarySeriesName = 'Expenses',
  primaryColor = '#5940B8',
  secondaryColor = '#3B82F6',
  height = 240,
  badgeText,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) return null;

  const allVals = data.flatMap((d) => [d.value, d.secondaryValue ?? 0]);
  const maxVal = Math.max(...allVals, 100);
  const chartHeight = height - 40;
  const width = 640;

  const pointsPrimary = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = chartHeight - (d.value / maxVal) * (chartHeight - 30) - 15;
    return { x, y, data: d };
  });

  const pathPrimary = pointsPrimary.reduce((acc, p, idx) => {
    if (idx === 0) return `M ${p.x} ${p.y}`;
    const prev = pointsPrimary[idx - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
  }, '');

  const areaPrimary = `${pathPrimary} L ${width} ${chartHeight} L 0 ${chartHeight} Z`;

  const hasSecondary = data.some((d) => d.secondaryValue !== undefined);
  let pathSecondary = '';
  let areaSecondary = '';
  let pointsSecondary: { x: number; y: number }[] = [];

  if (hasSecondary) {
    pointsSecondary = data.map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = chartHeight - ((d.secondaryValue || 0) / maxVal) * (chartHeight - 30) - 15;
      return { x, y };
    });

    pathSecondary = pointsSecondary.reduce((acc, p, idx) => {
      if (idx === 0) return `M ${p.x} ${p.y}`;
      const prev = pointsSecondary[idx - 1];
      const cx = (prev.x + p.x) / 2;
      return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
    }, '');

    areaSecondary = `${pathSecondary} L ${width} ${chartHeight} L 0 ${chartHeight} Z`;
  }

  const activePoint = hoverIndex !== null ? data[hoverIndex] : data[data.length - 1];
  const activeCoord = hoverIndex !== null ? pointsPrimary[hoverIndex] : pointsPrimary[pointsPrimary.length - 1];

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
            {badgeText && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200/60">
                {badgeText}
              </span>
            )}
          </div>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs font-semibold">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: primaryColor }} />
            <span className="text-zinc-700">{primarySeriesName}</span>
          </div>
          {hasSecondary && (
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: secondaryColor }} />
              <span className="text-zinc-700">{secondarySeriesName}</span>
            </div>
          )}
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="relative mt-4 w-full" style={{ height }}>
        {/* SVG Curve */}
        <svg
          viewBox={`0 0 ${width} ${chartHeight}`}
          preserveAspectRatio="none"
          className="w-full h-full overflow-visible"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="area-primary-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={primaryColor} stopOpacity="0.28" />
              <stop offset="100%" stopColor={primaryColor} stopOpacity="0.0" />
            </linearGradient>
            {hasSecondary && (
              <linearGradient id="area-secondary-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={secondaryColor} stopOpacity="0.20" />
                <stop offset="100%" stopColor={secondaryColor} stopOpacity="0.0" />
              </linearGradient>
            )}
          </defs>

          {/* Horizontal Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
            const y = chartHeight * ratio;
            return (
              <line
                key={idx}
                x1="0"
                y1={y}
                x2={width}
                y2={y}
                stroke="#F1F5F9"
                strokeWidth="1"
                strokeDasharray={idx === 4 ? undefined : '3 3'}
              />
            );
          })}

          {/* Secondary Series */}
          {hasSecondary && (
            <>
              <path d={areaSecondary} fill="url(#area-secondary-grad)" />
              <path d={pathSecondary} fill="none" stroke={secondaryColor} strokeWidth="2.5" strokeLinecap="round" />
            </>
          )}

          {/* Primary Series */}
          <path d={areaPrimary} fill="url(#area-primary-grad)" />
          <path d={pathPrimary} fill="none" stroke={primaryColor} strokeWidth="2.5" strokeLinecap="round" />

          {/* Interactive Hover Vertical Crosshair */}
          {activeCoord && (
            <>
              <line
                x1={activeCoord.x}
                y1="0"
                x2={activeCoord.x}
                y2={chartHeight}
                stroke="#5940B8"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                className="transition-all duration-150"
              />
              <circle
                cx={activeCoord.x}
                cy={activeCoord.y}
                r="5"
                fill="#5940B8"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                className="transition-all duration-150"
              />
            </>
          )}

          {/* Hover hit regions */}
          {data.map((_, idx) => {
            const stepW = width / data.length;
            return (
              <rect
                key={idx}
                x={idx * stepW}
                y="0"
                width={stepW}
                height={chartHeight}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIndex(idx)}
              />
            );
          })}
        </svg>

        {/* Floating Tooltip Pill */}
        {activePoint && activeCoord && (
          <div
            className="absolute -top-3 pointer-events-none transform -translate-x-1/2 bg-zinc-900/95 text-white px-3 py-1.5 rounded-xl shadow-xl text-xs flex flex-col gap-0.5 z-20 backdrop-blur-xs border border-zinc-700 transition-all duration-100"
            style={{ left: `${(activeCoord.x / width) * 100}%` }}
          >
            <div className="text-[10px] text-zinc-400 font-mono font-bold uppercase">{activePoint.label}</div>
            <div className="font-extrabold text-white flex items-center gap-1.5 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
              {activePoint.formattedValue || activePoint.value.toLocaleString()}
            </div>
            {activePoint.secondaryValue !== undefined && (
              <div className="text-[10.5px] text-blue-300 font-mono">
                {primarySeriesName !== 'Revenue' ? '' : 'Exp: '}{activePoint.formattedSecondary || activePoint.secondaryValue.toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* X-Axis Labels */}
      <div className="flex items-center justify-between text-xs font-semibold text-zinc-400 mt-2 pt-2 border-t border-zinc-100">
        {data.map((d, i) => (
          <span
            key={i}
            className={`transition-colors ${
              (hoverIndex === null && i === data.length - 1) || hoverIndex === i
                ? 'text-[#5940B8] font-bold'
                : 'hover:text-zinc-600'
            }`}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// 4. BKLIT LIGHT-THEME BAR CHART (COMPARATIVE / BREAKDOWN)
// ============================================================================
export interface BarDataPoint {
  label: string;
  primary: number;
  secondary?: number;
  formattedPrimary?: string;
  formattedSecondary?: string;
}

export interface BklitBarChartProps {
  title: string;
  description?: string;
  data: BarDataPoint[];
  primaryLabel?: string;
  secondaryLabel?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

export const BklitBarChart: React.FC<BklitBarChartProps> = ({
  title,
  description,
  data,
  primaryLabel = 'Target',
  secondaryLabel = 'Actual',
  primaryColor = '#5940B8',
  secondaryColor = '#E2E8F0',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxVal = Math.max(...data.flatMap((d) => [d.primary, d.secondary ?? 0]), 10);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
        <div>
          <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: primaryColor }} />
            <span className="text-zinc-700">{primaryLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: secondaryColor }} />
            <span className="text-zinc-700">{secondaryLabel}</span>
          </div>
        </div>
      </div>

      {/* Bar Columns Container */}
      <div className="mt-6 flex items-end justify-between gap-3 h-48 pt-4">
        {data.map((item, idx) => {
          const h1 = (item.primary / maxVal) * 100;
          const h2 = item.secondary ? (item.secondary / maxVal) * 100 : 0;
          const isHovered = hoveredIdx === idx;

          return (
            <div
              key={idx}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer"
            >
              <div className="w-full flex items-end justify-center gap-1.5 h-full relative">
                {/* Secondary Bar */}
                {item.secondary !== undefined && (
                  <div
                    style={{ height: `${h2}%`, backgroundColor: isHovered ? '#CBD5E1' : secondaryColor }}
                    className="w-1/2 rounded-t-md transition-all duration-200"
                  />
                )}
                {/* Primary Bar */}
                <div
                  style={{ height: `${h1}%`, backgroundColor: isHovered ? '#463091' : primaryColor }}
                  className="w-1/2 rounded-t-md transition-all duration-200 shadow-2xs group-hover:scale-y-[1.02] origin-bottom"
                />

                {/* Tooltip on hover */}
                {isHovered && (
                  <div className="absolute -top-10 bg-zinc-900 text-white text-[10.5px] px-2.5 py-1 rounded-lg shadow-lg font-mono font-bold whitespace-nowrap z-20 pointer-events-none">
                    {item.formattedPrimary || item.primary}
                  </div>
                )}
              </div>

              <span className="text-[11px] font-semibold text-zinc-500 mt-2.5 truncate w-full text-center group-hover:text-[#5940B8] transition-colors">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 5. BKLIT LIGHT-THEME DONUT / CATEGORY BREAKDOWN CHART
// ============================================================================
export interface DonutCategory {
  label: string;
  value: number;
  color: string;
  formattedValue?: string;
}

export interface BklitDonutChartProps {
  title: string;
  description?: string;
  totalLabel?: string;
  totalValue: string;
  categories: DonutCategory[];
}

export const BklitDonutChart: React.FC<BklitDonutChartProps> = ({
  title,
  description,
  totalLabel = 'Total Portfolio',
  totalValue,
  categories,
}) => {
  const sum = categories.reduce((acc, c) => acc + c.value, 0) || 1;

  let cumulativePercent = 0;

  const slices = categories.map((cat) => {
    const percent = cat.value / sum;
    const startAngle = cumulativePercent * 360;
    cumulativePercent += percent;
    const endAngle = cumulativePercent * 360;
    return { ...cat, percent, startAngle, endAngle };
  });

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      <div className="pb-4 border-b border-zinc-100">
        <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-6 mt-4">
        {/* SVG Donut Ring with Center Metrics */}
        <div className="relative flex items-center justify-center">
          <svg viewBox="0 0 100 100" className="w-44 h-44 sm:w-48 sm:h-48 transform -rotate-90">
            {slices.map((slice, idx) => {
              const radius = 39;
              const circumference = 2 * Math.PI * radius;
              const strokeDasharray = `${slice.percent * circumference} ${circumference}`;
              const strokeDashoffset = -slices.slice(0, idx).reduce((acc, s) => acc + s.percent * circumference, 0);

              return (
                <circle
                  key={idx}
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="transparent"
                  stroke={slice.color}
                  strokeWidth="11"
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-300 hover:opacity-85"
                />
              );
            })}
          </svg>

          {/* Centered Total without overflow */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none p-2">
            <span className="text-[9.5px] uppercase font-bold text-zinc-400 tracking-widest leading-none mb-1">
              {totalLabel}
            </span>
            <span className="text-sm sm:text-base font-black text-zinc-900 font-mono tracking-tight leading-tight max-w-[120px] break-words">
              {totalValue}
            </span>
          </div>
        </div>

        {/* Category Breakdown & Progress Bars */}
        <div className="flex flex-col gap-3 justify-center">
          {categories.map((cat, idx) => {
            const pct = Math.round((cat.value / sum) * 100);
            return (
              <div key={idx} className="flex flex-col gap-1.5 group cursor-default">
                <div className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: cat.color }} />
                    <span className="text-zinc-700 font-medium truncate group-hover:text-zinc-900 transition-colors">
                      {cat.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 font-mono text-xs">
                    <span className="font-bold text-zinc-900">{cat.formattedValue || cat.value}</span>
                    <span className="text-zinc-400 font-medium text-[11px]">({pct}%)</span>
                  </div>
                </div>
                <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${pct}%`, backgroundColor: cat.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 6. BKLIT LIGHT-THEME LINE CHART (@bklit/line-chart)
// ============================================================================
export interface BklitLineChartProps {
  title: string;
  description?: string;
  data: AreaDataPoint[];
  lineColor?: string;
  height?: number;
  badgeText?: string;
}

export const BklitLineChart: React.FC<BklitLineChartProps> = ({
  title,
  description,
  data,
  lineColor = '#5940B8',
  height = 240,
  badgeText,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 600;
  const chartHeight = 180;

  if (!data || data.length === 0) return null;

  const minVal = Math.min(...data.map((d) => d.value), 0);
  const maxVal = Math.max(...data.map((d) => d.value), 10);
  const range = maxVal - minVal || 1;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = chartHeight - ((d.value - minVal) / range) * (chartHeight - 20) - 10;
    return { x, y };
  });

  const pathD = points.reduce((acc, p, idx) => {
    if (idx === 0) return `M ${p.x} ${p.y}`;
    const prev = points[idx - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
  }, '');

  const activePoint = hoverIndex !== null ? data[hoverIndex] : data[data.length - 1];
  const activeCoord = hoverIndex !== null ? points[hoverIndex] : points[points.length - 1];

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none group">
      <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
        <div>
          <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        {badgeText && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200/70">
            {badgeText}
          </span>
        )}
      </div>

      <div className="relative mt-4 w-full" style={{ height }}>
        <svg
          viewBox={`0 0 ${width} ${chartHeight}`}
          preserveAspectRatio="none"
          className="w-full h-full overflow-visible"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Horizontal Grid lines */}
          {[0, 0.33, 0.66, 1].map((ratio, idx) => (
            <line
              key={idx}
              x1="0"
              y1={chartHeight * ratio}
              x2={width}
              y2={chartHeight * ratio}
              stroke="#F1F5F9"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          ))}

          <path
            d={pathD}
            fill="none"
            stroke={lineColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-all duration-700 ease-out"
          />

          {points.map((p, idx) => (
            <circle
              key={idx}
              cx={p.x}
              cy={p.y}
              r={hoverIndex === idx ? '6' : '3.5'}
              fill={lineColor}
              stroke="#FFFFFF"
              strokeWidth="2"
              className="transition-all duration-200 cursor-pointer"
            />
          ))}

          {activeCoord && (
            <line
              x1={activeCoord.x}
              y1="0"
              x2={activeCoord.x}
              y2={chartHeight}
              stroke="#5940B8"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          )}

          {data.map((_, idx) => {
            const stepW = width / data.length;
            return (
              <rect
                key={idx}
                x={idx * stepW}
                y="0"
                width={stepW}
                height={chartHeight}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIndex(idx)}
              />
            );
          })}
        </svg>

        {activePoint && activeCoord && (
          <div
            className="absolute -top-3 pointer-events-none transform -translate-x-1/2 bg-zinc-900/95 text-white px-3 py-1.5 rounded-xl shadow-xl text-xs flex flex-col gap-0.5 z-20 backdrop-blur-xs border border-zinc-700"
            style={{ left: `${(activeCoord.x / width) * 100}%` }}
          >
            <div className="text-[10px] text-zinc-400 font-mono font-bold uppercase">{activePoint.label}</div>
            <div className="font-extrabold text-white font-mono">
              {activePoint.formattedValue || activePoint.value.toLocaleString()}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs font-semibold text-zinc-400 mt-2 pt-2 border-t border-zinc-100">
        {data.map((d, i) => (
          <span key={i} className={hoverIndex === i ? 'text-[#5940B8] font-bold' : ''}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// 7. BKLIT LIGHT-THEME PIE CHART (@bklit/pie-chart)
// ============================================================================
export interface BklitPieChartProps {
  title: string;
  description?: string;
  categories: DonutCategory[];
}

export const BklitPieChart: React.FC<BklitPieChartProps> = ({
  title,
  description,
  categories,
}) => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const sum = categories.reduce((acc, c) => acc + c.value, 0) || 1;

  let cumulativeAngle = 0;
  const slices = categories.map((cat, idx) => {
    const fraction = cat.value / sum;
    const startAngle = cumulativeAngle;
    const angle = fraction * 2 * Math.PI;
    cumulativeAngle += angle;
    const endAngle = cumulativeAngle;

    const x1 = 50 + 40 * Math.cos(startAngle);
    const y1 = 50 + 40 * Math.sin(startAngle);
    const x2 = 50 + 40 * Math.cos(endAngle);
    const y2 = 50 + 40 * Math.sin(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;

    const pathData = `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`;

    return { ...cat, fraction, pathData, idx };
  });

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      <div className="pb-4 border-b border-zinc-100">
        <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-6 mt-4">
        <div className="relative flex items-center justify-center">
          <svg viewBox="0 0 100 100" className="w-44 h-44 sm:w-48 sm:h-48 transform -rotate-90">
            {slices.map((s) => (
              <path
                key={s.idx}
                d={s.pathData}
                fill={s.color}
                stroke="#FFFFFF"
                strokeWidth="1.5"
                className={`transition-all duration-300 cursor-pointer ${
                  activeIdx === s.idx ? 'opacity-100 scale-105 origin-center' : 'opacity-90 hover:opacity-100'
                }`}
                onMouseEnter={() => setActiveIdx(s.idx)}
                onMouseLeave={() => setActiveIdx(null)}
              />
            ))}
          </svg>
        </div>

        <div className="flex flex-col gap-2.5 justify-center">
          {categories.map((cat, idx) => {
            const pct = Math.round((cat.value / sum) * 100);
            return (
              <div
                key={idx}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseLeave={() => setActiveIdx(null)}
                className={`flex items-center justify-between p-2 rounded-xl transition-colors cursor-pointer ${
                  activeIdx === idx ? 'bg-purple-50' : 'hover:bg-zinc-50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: cat.color }} />
                  <span className="text-xs font-semibold text-zinc-800 truncate">{cat.label}</span>
                </div>
                <div className="font-mono text-xs font-bold text-zinc-900 shrink-0">
                  {cat.formattedValue || cat.value} <span className="text-zinc-400 font-normal">({pct}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 8. BKLIT LIGHT-THEME FUNNEL CHART (@bklit/funnel-chart)
// ============================================================================
export interface FunnelStage {
  label: string;
  value: number;
  formattedValue?: string;
  conversionRate?: string;
}

export interface BklitFunnelChartProps {
  title: string;
  description?: string;
  stages: FunnelStage[];
  baseColor?: string;
}

export const BklitFunnelChart: React.FC<BklitFunnelChartProps> = ({
  title,
  description,
  stages,
}) => {
  const maxVal = stages[0]?.value || 1;

  const colors = ['#5940B8', '#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD'];

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      <div className="pb-4 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-purple-50 text-[#5940B8] border border-purple-200/60">
          Conversion Pipeline
        </span>
      </div>

      <div className="flex flex-col gap-3 mt-4">
        {stages.map((stage, idx) => {
          const widthPct = Math.max(15, Math.round((stage.value / maxVal) * 100));
          const color = colors[idx % colors.length];

          return (
            <div key={idx} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs font-semibold">
                <div className="flex items-center gap-2">
                  <span className="h-5 w-5 rounded-md bg-purple-50 text-[#5940B8] flex items-center justify-center text-[10px] font-mono font-bold">
                    0{idx + 1}
                  </span>
                  <span className="text-zinc-800 font-bold">{stage.label}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="font-extrabold text-zinc-900">{stage.formattedValue || stage.value}</span>
                  {stage.conversionRate && (
                    <span className="text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded text-[11px] font-bold">
                      {stage.conversionRate}
                    </span>
                  )}
                </div>
              </div>
              <div className="w-full h-7 bg-zinc-100/80 rounded-xl overflow-hidden p-1 flex items-center">
                <div
                  className="h-full rounded-lg transition-all duration-700 ease-out flex items-center justify-end px-3 shadow-xs"
                  style={{ width: `${widthPct}%`, backgroundColor: color }}
                >
                  <span className="text-[10px] font-mono font-bold text-white tracking-wider">
                    {widthPct}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 9. BKLIT LIGHT-THEME SANKEY FLOW CHART (@bklit/sankey-chart)
// ============================================================================
export interface SankeyFlow {
  from: string;
  to: string;
  value: number;
  formattedValue?: string;
  color?: string;
}

export interface BklitSankeyChartProps {
  title: string;
  description?: string;
  flows: SankeyFlow[];
}

export const BklitSankeyChart: React.FC<BklitSankeyChartProps> = ({
  title,
  description,
  flows,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      <div className="pb-4 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-purple-50 text-[#5940B8] border border-purple-200/60">
          Flow Topology
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        {flows.map((flow, idx) => (
          <div
            key={idx}
            className="p-3.5 rounded-xl border border-zinc-200/80 bg-zinc-50/50 hover:bg-purple-50/30 hover:border-purple-300 transition-all flex items-center justify-between group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-white border border-zinc-200 text-[#5940B8] flex items-center justify-center font-mono font-bold text-xs shadow-2xs group-hover:bg-[#5940B8] group-hover:text-white group-hover:border-[#5940B8] transition-colors">
                →
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-zinc-900 truncate">
                  {flow.from} <span className="text-[#5940B8] font-normal">to</span> {flow.to}
                </div>
                <div className="text-[11px] text-zinc-500">Routing allocation</div>
              </div>
            </div>
            <div className="font-mono font-extrabold text-sm text-zinc-900 shrink-0">
              {flow.formattedValue || flow.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// 10. BKLIT LIGHT-THEME GAUGE CHART (@bklit/gauge-chart)
// ============================================================================
export interface BklitGaugeChartProps {
  title: string;
  description?: string;
  value: number; // 0 to 100
  label?: string;
  statusText?: string;
  color?: string;
}

export const BklitGaugeChart: React.FC<BklitGaugeChartProps> = ({
  title,
  description,
  value,
  label = 'Capacity Utilization',
  statusText = 'Optimal',
  color = '#5940B8',
}) => {
  const clampVal = Math.min(Math.max(value, 0), 100);
  const radius = 40;
  const circumference = Math.PI * radius; // Semi-circle
  const strokeDashoffset = circumference - (clampVal / 100) * circumference;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      <div className="pb-4 border-b border-zinc-100">
        <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>

      <div className="relative flex flex-col items-center justify-center mt-4">
        <svg viewBox="0 0 100 60" className="w-48 h-32 overflow-visible">
          {/* Background track arc */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="#F1F5F9"
            strokeWidth="10"
            strokeLinecap="round"
          />
          {/* Active progress arc */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-700 ease-out"
          />
        </svg>

        <div className="absolute bottom-2 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-black font-mono text-zinc-900">{clampVal}%</span>
          <span className="text-[10.5px] font-bold text-zinc-500 uppercase tracking-wider">{label}</span>
          <span className="mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200/70">
            {statusText}
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 11. BKLIT LIGHT-THEME RING / RADIAL CHART (@bklit/ring-chart)
// ============================================================================
export interface RingMetric {
  label: string;
  value: number; // 0 to 100
  color: string;
  formattedValue?: string;
}

export interface BklitRingChartProps {
  title: string;
  description?: string;
  metrics: RingMetric[];
}

export const BklitRingChart: React.FC<BklitRingChartProps> = ({
  title,
  description,
  metrics,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      <div className="pb-4 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-purple-50 text-[#5940B8] border border-purple-200/60">
          Target Health
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-6 mt-4">
        {/* Concentric Rings */}
        <div className="relative flex items-center justify-center">
          <svg viewBox="0 0 100 100" className="w-44 h-44 transform -rotate-90">
            {metrics.map((m, idx) => {
              const radius = 42 - idx * 9;
              const circumference = 2 * Math.PI * radius;
              const strokeDashoffset = circumference - (Math.min(m.value, 100) / 100) * circumference;

              return (
                <g key={idx}>
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="transparent"
                    stroke="#F1F5F9"
                    strokeWidth="6"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="transparent"
                    stroke={m.color}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    className="transition-all duration-700 ease-out"
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-3 justify-center">
          {metrics.map((m, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs font-semibold">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full shadow-2xs" style={{ backgroundColor: m.color }} />
                  <span className="text-zinc-700 font-medium">{m.label}</span>
                </div>
                <span className="font-mono font-bold text-zinc-900">
                  {m.formattedValue || `${m.value}%`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 12. BKLIT LIGHT-THEME COMPOSED CHART (@bklit/composed-chart)
// ============================================================================
export interface ComposedDataPoint {
  label: string;
  barValue: number;
  lineValue: number;
  formattedBar?: string;
  formattedLine?: string;
}

export interface BklitComposedChartProps {
  title: string;
  description?: string;
  data: ComposedDataPoint[];
  barLabel?: string;
  lineLabel?: string;
  barColor?: string;
  lineColor?: string;
}

export const BklitComposedChart: React.FC<BklitComposedChartProps> = ({
  title,
  description,
  data,
  barLabel = 'Volume',
  lineLabel = 'Fulfillment %',
  barColor = '#8B5CF6',
  lineColor = '#5940B8',
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const maxBar = Math.max(...data.map((d) => d.barValue), 10);
  const maxLine = Math.max(...data.map((d) => d.lineValue), 100);

  const width = 500;
  const height = 150;

  const linePoints = data.map((d, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - (d.lineValue / maxLine) * (height - 20) - 10;
    return { x, y };
  });

  const lineD = linePoints.reduce((acc, p, idx) => {
    if (idx === 0) return `M ${p.x} ${p.y}`;
    const prev = linePoints[idx - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
  }, '');

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
        <div>
          <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: barColor }} />
            <span className="text-zinc-700">{barLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: lineColor }} />
            <span className="text-zinc-700">{lineLabel}</span>
          </div>
        </div>
      </div>

      <div className="relative mt-6 h-48 w-full flex items-end justify-between gap-3 pt-4">
        {/* Background Overlay Line */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
        >
          <path d={lineD} fill="none" stroke={lineColor} strokeWidth="3" strokeLinecap="round" />
          {linePoints.map((p, idx) => (
            <circle
              key={idx}
              cx={p.x}
              cy={p.y}
              r={hoverIdx === idx ? '5' : '3.5'}
              fill={lineColor}
              stroke="#FFFFFF"
              strokeWidth="2"
            />
          ))}
        </svg>

        {/* Bars */}
        {data.map((item, idx) => {
          const h = (item.barValue / maxBar) * 100;
          return (
            <div
              key={idx}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              className="flex-1 flex flex-col items-center h-full justify-end cursor-pointer group z-0"
            >
              <div className="w-full flex items-end justify-center h-full">
                <div
                  className="w-7/12 rounded-t-lg transition-all duration-500 ease-out group-hover:opacity-85"
                  style={{ height: `${h}%`, backgroundColor: barColor }}
                />
              </div>
              <span className="text-[11px] font-semibold text-zinc-500 mt-2 truncate group-hover:text-zinc-900">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 13. BKLIT LIGHT-THEME HEATMAP CHART (@bklit/heatmap-chart)
// ============================================================================
export interface HeatmapCell {
  day: string; // e.g. Mon, Tue
  hour: string; // e.g. 9am, 12pm, 3pm, 6pm
  intensity: number; // 0 to 4
  label: string;
}

export interface BklitHeatmapChartProps {
  title: string;
  description?: string;
  cells: HeatmapCell[];
}

export const BklitHeatmapChart: React.FC<BklitHeatmapChartProps> = ({
  title,
  description,
  cells,
}) => {
  const intensityColors = [
    'bg-zinc-100', // 0: None
    'bg-purple-100', // 1: Low
    'bg-purple-300', // 2: Medium
    'bg-purple-500', // 3: High
    'bg-[#5940B8]', // 4: Peak
  ];

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = ['9 AM', '12 PM', '3 PM', '6 PM', '9 PM'];

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/90 p-6 shadow-xs flex flex-col justify-between select-none">
      <div className="pb-4 border-b border-zinc-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-zinc-900 uppercase tracking-wider">{title}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-zinc-500">
          <span>Less</span>
          <span className="h-3 w-3 rounded bg-zinc-100" />
          <span className="h-3 w-3 rounded bg-purple-100" />
          <span className="h-3 w-3 rounded bg-purple-300" />
          <span className="h-3 w-3 rounded bg-[#5940B8]" />
          <span>More</span>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-2 mt-4">
        {days.map((d, dIdx) => (
          <div key={dIdx} className="flex flex-col gap-2">
            <span className="text-[11px] font-mono font-bold text-zinc-400 text-center uppercase">{d}</span>
            <div className="flex flex-col gap-1.5">
              {hours.map((h, hIdx) => {
                const cell = cells.find((c) => c.day === d && c.hour === h);
                const level = cell ? cell.intensity : (dIdx + hIdx) % 5;
                return (
                  <div
                    key={hIdx}
                    title={`${d} ${h}: ${cell?.label || 'Normal Load'}`}
                    className={`h-7 rounded-lg transition-all duration-300 hover:scale-105 cursor-pointer flex items-center justify-center text-[10px] font-mono font-bold text-white/90 ${
                      intensityColors[level]
                    }`}
                  >
                    {level > 2 ? `${level * 4}j` : ''}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

