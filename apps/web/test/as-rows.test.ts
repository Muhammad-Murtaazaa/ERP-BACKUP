import { describe, it, expect } from 'vitest';
import { asRows } from '../src/lib/rows.js';

describe('asRows (ApiClient already unwraps { success, data })', () => {
  it('accepts an unwrapped array, a wrapped one, and anything else as empty', () => {
    expect(asRows([1, 2])).toEqual([1, 2]);
    expect(asRows({ data: [3] })).toEqual([3]);
    expect(asRows(null)).toEqual([]);
    expect(asRows({ data: { id: 1 } })).toEqual([]);
  });
});
