/**
 * Business-hours SLA clock (SRV-003). Times are UTC instants; business hours are evaluated in
 * a fixed-offset local zone (Asia/Karachi is UTC+5 with no DST). Holidays are local dates.
 * Pauses (awaiting customer / parts) are excluded by extending the due time by the paused
 * business minutes.
 */
export interface BusinessHours {
  start: string; // HH:MM local
  end: string; // HH:MM local
  days: number[]; // 0=Sun..6=Sat (local)
  holidays?: string[]; // YYYY-MM-DD local
  offsetMinutes?: number; // default +300 (PKT)
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function localParts(t: number, off: number) {
  const d = new Date(t + off * 60000);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes(), dayStartUtc: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - off * 60000 };
}

function isWorkingDay(h: BusinessHours, date: string, dow: number) {
  return h.days.includes(dow) && !(h.holidays || []).includes(date);
}

/** Adds `minutes` of business time to `from` and returns the due instant. */
export function addBusinessMinutes(from: Date, minutes: number, h: BusinessHours): Date {
  const off = h.offsetMinutes ?? 300;
  const open = toMin(h.start);
  const close = toMin(h.end);
  if (close <= open) throw new Error('Business hours must close after they open');
  if (!h.days.length) throw new Error('At least one working day is required');
  let t = from.getTime();
  let left = Math.max(0, Math.round(minutes));
  for (let guard = 0; guard < 3700; guard++) {
    const p = localParts(t, off);
    const working = isWorkingDay(h, p.date, p.dow);
    if (!working || p.minute >= close) {
      t = p.dayStartUtc + 86400000 + open * 60000; // next day opening
      continue;
    }
    if (p.minute < open) {
      t = p.dayStartUtc + open * 60000;
      continue;
    }
    const avail = close - p.minute;
    if (left <= avail) return new Date(t + left * 60000);
    left -= avail;
    t = p.dayStartUtc + 86400000 + open * 60000;
  }
  throw new Error('SLA horizon exceeded (check business hours / holidays)');
}

/** Business minutes elapsed between two instants. */
export function businessMinutesBetween(a: Date, b: Date, h: BusinessHours): number {
  if (b.getTime() <= a.getTime()) return 0;
  const off = h.offsetMinutes ?? 300;
  const open = toMin(h.start);
  const close = toMin(h.end);
  let total = 0;
  let t = a.getTime();
  const end = b.getTime();
  for (let guard = 0; guard < 3700 && t < end; guard++) {
    const p = localParts(t, off);
    const dayOpen = p.dayStartUtc + open * 60000;
    const dayClose = p.dayStartUtc + close * 60000;
    if (isWorkingDay(h, p.date, p.dow)) {
      const s = Math.max(t, dayOpen);
      const e = Math.min(end, dayClose);
      if (e > s) total += (e - s) / 60000;
    }
    t = p.dayStartUtc + 86400000;
  }
  return Math.round(total);
}

export type SlaState = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'MET' | 'PAUSED';

/** SLA state against a due instant: at risk inside the last 20% of the window. */
export function slaState(opts: { start: Date; due: Date; now: Date; doneAt?: Date | null; paused?: boolean }): SlaState {
  if (opts.doneAt) return opts.doneAt.getTime() <= opts.due.getTime() ? 'MET' : 'BREACHED';
  if (opts.paused) return 'PAUSED';
  if (opts.now.getTime() > opts.due.getTime()) return 'BREACHED';
  const window = opts.due.getTime() - opts.start.getTime();
  return opts.due.getTime() - opts.now.getTime() <= window * 0.2 ? 'AT_RISK' : 'ON_TRACK';
}

/** Two [start, end) windows overlap (touching ends do not). */
export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
