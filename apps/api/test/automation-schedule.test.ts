import { describe, it, expect } from 'vitest';
import { addMonthsIso, backoffMs, localDate, nextRun, occurrenceKey, zonedToUtc } from '../src/automation/schedule.js';

describe('automation schedule maths', () => {
  it('daily runs at local wall-clock time in Asia/Karachi (UTC+5)', () => {
    const spec = { schedule_kind: 'DAILY' as const, run_at_local: '06:00', timezone: 'Asia/Karachi' };
    expect(nextRun(spec, new Date('2026-10-01T00:30:00Z')).toISOString()).toBe('2026-10-01T01:00:00.000Z');
    // Exactly at the slot → strictly after, so the next day
    expect(nextRun(spec, new Date('2026-10-01T01:00:00Z')).toISOString()).toBe('2026-10-02T01:00:00.000Z');
  });

  it('handles the spring-forward gap (America/New_York 2026-03-08 02:30 does not exist)', () => {
    const t = zonedToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
    expect(t.toISOString()).toBe('2026-03-08T07:00:00.000Z'); // 03:00 EDT
    const spec = { schedule_kind: 'DAILY' as const, run_at_local: '02:30', timezone: 'America/New_York' };
    expect(nextRun(spec, new Date('2026-03-08T05:00:00Z')).toISOString()).toBe('2026-03-08T07:00:00.000Z');
    // Next day back to normal 02:30 EDT
    expect(nextRun(spec, new Date('2026-03-08T07:00:00Z')).toISOString()).toBe('2026-03-09T06:30:00.000Z');
  });

  it('resolves the ambiguous fall-back hour to the first occurrence and runs once', () => {
    const t = zonedToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York');
    expect(t.toISOString()).toBe('2026-11-01T05:30:00.000Z'); // 01:30 EDT
    const spec = { schedule_kind: 'DAILY' as const, run_at_local: '01:30', timezone: 'America/New_York' };
    // Both 05:30Z and 06:30Z are 01:30 local on the same day → same occurrence key (dedupe)
    expect(occurrenceKey(spec, new Date('2026-11-01T05:30:00Z'))).toBe(occurrenceKey(spec, new Date('2026-11-01T06:30:00Z')));
    expect(nextRun(spec, new Date('2026-11-01T05:30:00Z')).toISOString()).toBe('2026-11-02T06:30:00.000Z');
  });

  it('monthly schedules roll over the year and clamp day_of_month to 28', () => {
    const spec = { schedule_kind: 'MONTHLY' as const, run_at_local: '02:00', day_of_month: 31, timezone: 'Asia/Karachi' };
    expect(nextRun(spec, new Date('2026-12-29T00:00:00Z')).toISOString()).toBe('2027-01-27T21:00:00.000Z');
    expect(occurrenceKey(spec, new Date('2027-01-27T21:00:00Z'))).toBe('M:2027-01');
  });

  it('interval slots are aligned and keyed per slot', () => {
    const spec = { schedule_kind: 'INTERVAL' as const, interval_minutes: 15 };
    expect(nextRun(spec, new Date('2026-10-01T10:07:00Z')).toISOString()).toBe('2026-10-01T10:15:00.000Z');
    expect(occurrenceKey(spec, new Date('2026-10-01T10:15:00Z'))).toBe(occurrenceKey(spec, new Date('2026-10-01T10:29:59Z')));
    expect(occurrenceKey(spec, new Date('2026-10-01T10:15:00Z'))).not.toBe(occurrenceKey(spec, new Date('2026-10-01T10:30:00Z')));
    // interval below the floor is clamped to 5 minutes
    expect(nextRun({ schedule_kind: 'INTERVAL', interval_minutes: 1 }, new Date('2026-10-01T10:01:00Z')).toISOString()).toBe('2026-10-01T10:05:00.000Z');
  });

  it('daily keys use the local calendar date, not UTC', () => {
    const spec = { schedule_kind: 'DAILY' as const, timezone: 'Asia/Karachi' };
    expect(occurrenceKey(spec, new Date('2026-09-30T20:00:00Z'))).toBe('D:2026-10-01');
    expect(localDate(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
  });

  it('backoff is exponential and bounded; month arithmetic crosses years', () => {
    expect([1, 2, 3, 4, 10].map((a) => backoffMs(a) / 60000)).toEqual([1, 2, 4, 8, 60]);
    expect(addMonthsIso('2026-11-15', 2, 15)).toBe('2027-01-15');
    expect(addMonthsIso('2026-12-28', 1, 28)).toBe('2027-01-28');
  });
});
