import { describe, it, expect } from 'vitest';
import { MaintenanceEngine } from '../src/maintenance.js';
import { PeriodManager } from '../src/periods.js';

describe('calendar arithmetic is time-zone independent', () => {
  it('adds days across month ends, leap days and DST dates', () => {
    expect(MaintenanceEngine.calculateNextDueDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(MaintenanceEngine.calculateNextDueDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(MaintenanceEngine.calculateNextDueDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(MaintenanceEngine.calculateNextDueDate('2026-03-07', 1)).toBe('2026-03-08'); // US DST start
    expect(MaintenanceEngine.calculateNextDueDate('2026-10-31', 1)).toBe('2026-11-01'); // US DST end
    expect(MaintenanceEngine.calculateNextDueDate('2026-03-01', 90)).toBe('2026-05-30');
  });

  it('accepts timestamps and falls back to today for invalid input', () => {
    expect(MaintenanceEngine.calculateNextDueDate('2026-03-01T00:00:00.000Z', 30)).toBe('2026-03-31');
    expect(MaintenanceEngine.calculateNextDueDate('not-a-date', 0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats period dates from strings or Dates', () => {
    expect(PeriodManager.formatDateString('2026-03-01')).toBe('2026-03-01');
    expect(PeriodManager.formatDateString(new Date(Date.UTC(2026, 2, 1)))).toBe('2026-03-01');
  });
});
