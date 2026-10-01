/** Moves the item with `key` in front of `before` (or to the end when `before` is null). Pure; unknown keys are a no-op. */
export function moveBefore<T extends { key: string }>(list: T[], key: string, before: string | null): T[] {
  const item = list.find((x) => x.key === key);
  if (!item || key === before) return list;
  const rest = list.filter((x) => x.key !== key);
  const i = before ? rest.findIndex((x) => x.key === before) : -1;
  return i < 0 ? [...rest, item] : [...rest.slice(0, i), item, ...rest.slice(i)];
}

/** Inserts `item` in front of `before` (or appends). */
export function insertBefore<T extends { key: string }>(list: T[], item: T, before?: string | null): T[] {
  const i = before ? list.findIndex((x) => x.key === before) : -1;
  return i < 0 ? [...list, item] : [...list.slice(0, i), item, ...list.slice(i)];
}

/** Swaps the item with its neighbour (delta −1 / +1); out-of-range is a no-op. */
export function shiftBy<T extends { key: string }>(list: T[], key: string, delta: number): T[] {
  const i = list.findIndex((x) => x.key === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
