export interface Series {
  name: string;
  values: number[];
  color?: string;
}

export const CHART_COLORS = [
  'var(--chart-1,#62a802)', // lime / brand
  'var(--chart-2,#3987e5)', // blue
  'var(--chart-3,#d55181)', // magenta
  'var(--chart-4,#c98500)', // amber
  'var(--chart-5,#9085e9)', // violet
  'var(--chart-6,#d95926)', // orange
];

/**
 * Compact number formatter used by charts and KPIs:
 * 1200 -> "1.2K", 3400000 -> "3.4M"
 */
export function compact(n: number): string {
  if (n === null || n === undefined || isNaN(n)) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `${sign}${abs}`;
}
