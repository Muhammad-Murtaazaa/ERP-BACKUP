/** ApiClient already unwraps `{ success, data }`; tolerate either shape when a list is expected. */
export function asRows<T = any>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const d = (r as any)?.data;
  return Array.isArray(d) ? (d as T[]) : [];
}
