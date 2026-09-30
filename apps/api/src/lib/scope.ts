import { DbClient } from '@omnysync/platform';
import { ApiError, notFound } from './errors.js';
import { ErrorCode } from '@omnysync/contracts';

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * Loads a row by id *within the caller's organization*. Any id belonging to a
 * different organization is reported exactly like a missing id so record existence
 * is not leaked across tenants (SECURITY.md).
 */
export async function requireOrgRow<T = any>(
  q: DbClient,
  table: string,
  id: unknown,
  organizationId: string,
  label: string,
  opts: { forUpdate?: boolean } = {},
): Promise<T> {
  if (!IDENT_RE.test(table)) throw new Error(`Illegal table identifier ${table}`);
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) throw notFound(label);
  const res = await q.query<T>(
    `SELECT * FROM ${table} WHERE id::text = $1 AND organization_id = $2${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [id, organizationId],
  );
  if (res.rows.length === 0) throw notFound(label);
  return res.rows[0];
}

/**
 * Asserts that a referenced foreign id (party, item, warehouse, account...) exists
 * in the caller's organization. Used to stop cross-organization references which the
 * single-column FKs of the early migrations cannot prevent on their own.
 */
export async function assertOrgRef(
  q: DbClient,
  table: string,
  id: unknown,
  organizationId: string,
  label: string,
): Promise<void> {
  if (id === undefined || id === null || id === '') return;
  if (!IDENT_RE.test(table)) throw new Error(`Illegal table identifier ${table}`);
  const res = await q.query(`SELECT 1 FROM ${table} WHERE id::text = $1 AND organization_id = $2`, [String(id), organizationId]);
  if (res.rows.length === 0) {
    throw new ApiError(400, ErrorCode.FORBIDDEN_SCOPE, `${label} does not exist in this organization`, { field: label });
  }
}
