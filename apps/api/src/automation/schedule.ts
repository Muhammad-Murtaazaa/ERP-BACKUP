/**
 * Pure scheduling maths for automation rules. Times are computed in the rule's
 * IANA timezone (DST-safe: local wall-clock times are converted with the zone's
 * real offset at that instant). Every occurrence has a stable key so a trigger
 * delivered twice (two API instances, retries, restarts) runs once.
 */
export type ScheduleKind = 'INTERVAL' | 'DAILY' | 'MONTHLY';

export interface ScheduleSpec {
  schedule_kind: ScheduleKind;
  interval_minutes?: number | null;
  /** "HH:MM" or "HH:MM:SS" local time. */
  run_at_local?: string | null;
  day_of_month?: number | null;
  timezone?: string | null;
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

export function localParts(at: Date, tz: string): LocalParts {
  const p = Object.fromEntries(formatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute };
}

/** Offset (minutes) of `tz` from UTC at instant `at`. */
function offsetMinutes(at: Date, tz: string): number {
  const p = localParts(at, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/**
 * Converts a local wall-clock time to a UTC instant. Non-existent local times
 * (spring-forward gap) move forward to the first valid minute; ambiguous times
 * (fall-back) resolve to the first occurrence.
 */
export function zonedToUtc(p: LocalParts, tz: string): Date {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  const o2 = offsetMinutes(new Date(t), tz);
  t = guess - o2 * 60000;
  const back = localParts(new Date(t), tz);
  if (back.hour !== p.hour || back.minute !== p.minute) {
    // In a DST gap: step forward minute by minute (at most 2h) to the first valid local time.
    for (let i = 1; i <= 120; i++) {
      const c = new Date(t + i * 60000);
      const lp = localParts(c, tz);
      if (lp.day === p.day && (lp.hour > p.hour || (lp.hour === p.hour && lp.minute >= p.minute))) return c;
    }
  }
  // Ambiguous (fall-back): prefer the earlier instant if it maps to the same wall time.
  const earlier = new Date(t - 60 * 60000);
  const e = localParts(earlier, tz);
  if (e.hour === p.hour && e.minute === p.minute && e.day === p.day) return earlier;
  return new Date(t);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function parseTime(s: string | null | undefined): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '06:00');
  const hour = Math.min(23, Math.max(0, Number(m?.[1] ?? 6)));
  const minute = Math.min(59, Math.max(0, Number(m?.[2] ?? 0)));
  return { hour, minute };
}

function addDays(p: { year: number; month: number; day: number }, n: number) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Next run instant strictly after `after`. */
export function nextRun(spec: ScheduleSpec, after: Date): Date {
  const tz = spec.timezone || 'Asia/Karachi';
  if (spec.schedule_kind === 'INTERVAL') {
    const mins = Math.max(5, spec.interval_minutes || 60);
    const step = mins * 60000;
    return new Date((Math.floor(after.getTime() / step) + 1) * step);
  }
  const { hour, minute } = parseTime(spec.run_at_local);
  const now = localParts(after, tz);
  if (spec.schedule_kind === 'DAILY') {
    for (let i = 0; i < 3; i++) {
      const d = addDays(now, i);
      const t = zonedToUtc({ ...d, hour, minute }, tz);
      if (t.getTime() > after.getTime()) return t;
    }
  }
  // MONTHLY
  const dom = Math.min(28, Math.max(1, spec.day_of_month || 1));
  for (let i = 0; i < 3; i++) {
    const y = now.year + Math.floor((now.month - 1 + i) / 12);
    const mo = ((now.month - 1 + i) % 12) + 1;
    const t = zonedToUtc({ year: y, month: mo, day: dom, hour, minute }, tz);
    if (t.getTime() > after.getTime()) return t;
  }
  throw new Error('Unable to compute next run');
}

/** Stable key of the occurrence a scheduled instant belongs to (local calendar, not UTC). */
export function occurrenceKey(spec: ScheduleSpec, at: Date): string {
  const tz = spec.timezone || 'Asia/Karachi';
  if (spec.schedule_kind === 'INTERVAL') {
    const mins = Math.max(5, spec.interval_minutes || 60);
    return `I${mins}:${Math.floor(at.getTime() / (mins * 60000))}`;
  }
  const p = localParts(at, tz);
  if (spec.schedule_kind === 'DAILY') return `D:${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return `M:${p.year}-${pad(p.month)}`;
}

/** Bounded exponential backoff for retries: 1, 2, 4 … minutes, capped at 60. */
export function backoffMs(attempt: number): number {
  return Math.min(60, 2 ** Math.max(0, attempt - 1)) * 60000;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(at: Date, tz = 'Asia/Karachi'): string {
  const p = localParts(at, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Adds whole months to a YYYY-MM-DD date keeping the day (<= 28 by construction). */
export function addMonthsIso(iso: string, n: number, dayOfMonth: number): string {
  const [y, m] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-${pad(Math.min(28, dayOfMonth))}`;
}
