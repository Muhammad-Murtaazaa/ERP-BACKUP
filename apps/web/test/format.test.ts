import { describe, it, expect } from 'vitest';
import { cmpDec, fmtDec, fmtMoney, fmtQty, isNegative, isPositive, mulDec, sumDec } from '../src/lib/format.js';

describe('decimal-safe display helpers', () => {
  it('formats money with grouping, HALF_UP and no float drift', () => {
    expect(fmtMoney('1234567.5')).toBe('1,234,567.50');
    expect(fmtMoney('0.005')).toBe('0.01'); // HALF_UP (float toFixed gives 0.01 or 0.00 inconsistently)
    expect(fmtMoney('1.005')).toBe('1.01'); // (1.005).toFixed(2) === "1.00" with floats
    expect(fmtMoney('-1500')).toBe('-1,500.00');
    expect(fmtMoney('-0.001')).toBe('0.00'); // never "-0.00"
    expect(fmtMoney('99999999999999999.99')).toBe('99,999,999,999,999,999.99'); // beyond float precision
    expect(fmtMoney(null)).toBe('0.00');
    expect(fmtMoney('abc')).toBe('abc');
  });

  it('formats rates and quantities', () => {
    expect(fmtDec('278.5', 4)).toBe('278.5000');
    expect(fmtDec('-0.0001', 2)).toBe('0.00');
    expect(fmtQty('1500.000')).toBe('1,500');
    expect(fmtQty('2.500')).toBe('2.5');
    expect(fmtQty('0.1234', 3)).toBe('0.123');
  });

  it('sums and multiplies exactly', () => {
    expect(sumDec(['0.1', '0.2'])).toBe('0.30'); // 0.1 + 0.2 = 0.30000000000000004 in floats
    expect(sumDec(['1,000.10', '', null, '2.05'])).toBe('1002.15');
    expect(mulDec('1000', '278.5')).toBe('278500.00');
    expect(mulDec('0.07', '3', 2)).toBe('0.21');
  });

  it('compares and tests sign', () => {
    expect(isPositive('0.01')).toBe(true);
    expect(isPositive('0')).toBe(false);
    expect(isNegative('-0.01')).toBe(true);
    expect(isNegative('0')).toBe(false);
    expect(cmpDec('10.00', '9.999')).toBe(1);
    expect(cmpDec('1.10', '1.1')).toBe(0);
  });
});
