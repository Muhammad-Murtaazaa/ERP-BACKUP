import { describe, it, expect } from 'vitest';
import { insertBefore, moveBefore, shiftBy } from '../src/lib/reorder.js';

const L = ['a', 'b', 'c', 'd'].map((key) => ({ key }));
const keys = (l: { key: string }[]) => l.map((x) => x.key).join('');

describe('BI builder reordering', () => {
  it('moves a card in front of the drop target, or to the end', () => {
    expect(keys(moveBefore(L, 'd', 'a'))).toBe('dabc');
    expect(keys(moveBefore(L, 'a', 'c'))).toBe('bacd');
    expect(keys(moveBefore(L, 'b', null))).toBe('acdb');
    expect(moveBefore(L, 'b', 'b')).toBe(L); // dropped on itself
    expect(moveBefore(L, 'zz', 'a')).toBe(L); // unknown
  });
  it('inserts new widgets at the drop point and shifts with bounds', () => {
    expect(keys(insertBefore(L, { key: 'n' }, 'c'))).toBe('abncd');
    expect(keys(insertBefore(L, { key: 'n' }))).toBe('abcdn');
    expect(keys(shiftBy(L, 'b', -1))).toBe('bacd');
    expect(keys(shiftBy(L, 'd', 1))).toBe('abcd');
    expect(keys(shiftBy(L, 'a', -1))).toBe('abcd');
  });
});
