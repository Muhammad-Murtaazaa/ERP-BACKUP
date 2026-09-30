import { DbClient } from '@omnysync/platform';
import { invalidState, notFound } from './errors.js';

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

export interface TransitionInput {
  table: string;
  id: string;
  organizationId: string;
  from: readonly string[];
  to: string;
  label: string;
  statusColumn?: string;
  /** Extra columns to set in the same statement (values are parameterised). */
  set?: Record<string, unknown>;
}

/**
 * Atomic compare-and-set state transition. The UPDATE only matches while the row is
 * still in one of the allowed source states, so two concurrent submits/approvals/
 * posts cannot both succeed (STATE-MACHINES.md race policy). Returns the updated row.
 */
export async function transition<T = any>(q: DbClient, input: TransitionInput): Promise<T> {
  const statusColumn = input.statusColumn || 'status';
  if (!IDENT_RE.test(input.table) || !IDENT_RE.test(statusColumn)) throw new Error('Illegal identifier');
  const params: unknown[] = [input.to, input.id, input.organizationId, input.from];
  const sets: string[] = [`${statusColumn} = $1`];
  for (const [col, val] of Object.entries(input.set || {})) {
    if (!IDENT_RE.test(col)) throw new Error('Illegal identifier');
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }
  const res = await q.query<T>(
    `UPDATE ${input.table} SET ${sets.join(', ')}
     WHERE id::text = $2 AND organization_id = $3 AND ${statusColumn} = ANY($4::text[])
     RETURNING *`,
    params,
  );
  if (res.rows.length > 0) return res.rows[0];

  const cur = await q.query<Record<string, unknown>>(
    `SELECT ${statusColumn} AS s FROM ${input.table} WHERE id::text = $1 AND organization_id = $2`,
    [input.id, input.organizationId],
  );
  if (cur.rows.length === 0) throw notFound(input.label);
  throw invalidState(
    `${input.label} cannot move to ${input.to} from ${String(cur.rows[0].s)} (allowed from: ${input.from.join(', ')})`,
    { current: cur.rows[0].s, requested: input.to, allowed_from: input.from },
  );
}

/** Pure transition-map check used by services and unit tests. */
export function assertTransition(map: Record<string, readonly string[]>, from: string, to: string, label: string): void {
  const allowed = map[from] || [];
  if (!allowed.includes(to)) {
    throw invalidState(`${label} cannot move from ${from} to ${to}`, { current: from, requested: to, allowed });
  }
}
