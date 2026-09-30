import { DbClient } from '@omnysync/platform';

/**
 * Gap-tolerant, collision-free document numbering. Counters live in
 * document_sequences and are incremented with an atomic upsert inside the caller's
 * unit of work, replacing the old `Date.now().slice(-5)` scheme that produced
 * duplicate numbers for requests in the same millisecond window.
 */
export async function nextDocumentNumber(
  q: DbClient,
  organizationId: string,
  prefix: string,
  businessDate?: string,
  width = 5,
): Promise<string> {
  const year = (businessDate && /^\d{4}/.test(businessDate) ? businessDate.slice(0, 4) : String(new Date().getFullYear()));
  const res = await q.query<{ last_value: string | number }>(
    `INSERT INTO document_sequences (organization_id, prefix, period_key, last_value)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (organization_id, prefix, period_key)
     DO UPDATE SET last_value = document_sequences.last_value + 1, updated_at = CURRENT_TIMESTAMP
     RETURNING last_value`,
    [organizationId, prefix, year],
  );
  const n = String(res.rows[0].last_value).padStart(width, '0');
  return `${prefix}-${year}-${n}`;
}
