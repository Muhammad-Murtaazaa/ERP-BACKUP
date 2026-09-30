import crypto from 'node:crypto';
import { DbClient, AuditLogger, OutboxService } from '@omnysync/platform';
import { JournalValidator, PeriodManager, PostingEngine, PostingIntentLine } from '@omnysync/financial-engine';
import { Account, ErrorCode, JournalLine } from '@omnysync/contracts';
import { ApiError } from './errors.js';
import { nextDocumentNumber } from './numbering.js';

export interface PostJournalInput {
  organizationId: string;
  legalEntityId: string;
  userId: string;
  postingDate: string;
  documentDate?: string;
  purpose: string;
  description: string;
  sourceType?: string | null;
  sourceId?: string | null;
  /**
   * Idempotency key for the (source, purpose, version) — reposting the same key
   * returns the existing journal instead of double-posting.
   */
  sourceKey?: string | null;
  lines: PostingIntentLine[];
  correlationId?: string;
  currency?: string;
  /** Number prefix, e.g. JV-AR. Defaults to JV. */
  numberPrefix?: string;
  /** Explicit journal number (reversals keep a link to the original number). */
  journalNumber?: string;
  reversalOfJournalId?: string | null;
  approvedBy?: string | null;
  /** Closing adjustments may post into a SOFT_CLOSED period. */
  isClosingAdjustment?: boolean;
}

export interface PostJournalResult {
  journalId: string;
  journalNumber: string;
  totalDebit: string;
  replayed: boolean;
}

/**
 * The single posting routine for every module (FINANCIAL-CONTROLS.md: "Only the
 * financial engine can create posted journals"). Must be called inside the source
 * command's unit of work so the source transition, journal, audit and outbox commit
 * atomically. It:
 *  1. nets and validates intent lines (non-negative, one side, zero lines omitted),
 *  2. resolves account codes to org-scoped leaf accounts (MAPPING_MISSING otherwise),
 *  3. locks the fiscal period row (same guard as period close) and enforces status,
 *  4. dedupes on sourceKey,
 *  5. inserts the posted journal + lines, audit record and JOURNAL_POSTED outbox event.
 * Returns null when every line nets to zero (nothing to post).
 */
export async function postJournal(
  q: DbClient,
  audit: AuditLogger,
  outbox: OutboxService,
  input: PostJournalInput,
): Promise<PostJournalResult | null> {
  let normalized;
  try {
    normalized = PostingEngine.normalize(input.lines);
  } catch (err: any) {
    throw new ApiError(400, ErrorCode.VALIDATION_FAILED, err.message);
  }
  if (normalized.lines.length === 0) return null;

  // Resolve accounts within the organization.
  const accountsRes = await q.query<Account>('SELECT * FROM accounts WHERE organization_id = $1', [input.organizationId]);
  const byId = new Map(accountsRes.rows.map((a) => [a.id, a]));
  const byCode = new Map(accountsRes.rows.map((a) => [a.code, a]));
  const resolved: JournalLine[] = normalized.lines.map((l, idx) => {
    const acc = (l.account_id && byId.get(l.account_id)) || (l.account_code && byCode.get(l.account_code)) || null;
    if (!acc) {
      throw new ApiError(
        400,
        ErrorCode.MAPPING_MISSING,
        `Account mapping missing for posting line ${idx + 1} (${l.account_code || l.account_id || 'unspecified'})`,
        { account_code: l.account_code, account_id: l.account_id },
      );
    }
    return {
      line_number: idx + 1,
      account_id: acc.id,
      debit_amount: l.debit,
      credit_amount: l.credit,
      base_debit: l.debit,
      base_credit: l.credit,
      currency: input.currency || 'PKR',
      fx_rate: '1',
      description: l.description,
      party_id: l.party_id,
      dimension_project_id: l.project_id,
      dimension_cost_center_id: l.cost_center_id,
      dimension_branch_id: l.branch_id,
    } as unknown as JournalLine;
  });

  const accountMap = new Map(accountsRes.rows.map((a) => [a.id, a]));
  const validation = JournalValidator.validate(resolved, accountMap);
  if (!validation.isValid) {
    throw new ApiError(400, ErrorCode.JOURNAL_UNBALANCED, validation.errors.join('; '), validation.errors);
  }

  // Period guard with row lock (serialises against period close, TX-006).
  const periodRes = await q.query(
    `SELECT * FROM fiscal_periods
     WHERE organization_id = $1 AND legal_entity_id = $2 AND start_date <= $3::date AND end_date >= $3::date
     FOR UPDATE`,
    [input.organizationId, input.legalEntityId, input.postingDate],
  );
  const period = PeriodManager.findPeriodForDate(periodRes.rows, input.postingDate);
  const check = PeriodManager.assertPostingAllowed(period, input.postingDate, input.isClosingAdjustment === true);
  if (!check.allowed) {
    throw new ApiError(400, period ? ErrorCode.PERIOD_CLOSED : ErrorCode.PERIOD_NOT_FOUND, check.error || 'Period closed');
  }

  if (input.sourceKey) {
    const existing = await q.query<{ id: string; journal_number: string; total_base_debit: string }>(
      'SELECT id, journal_number, total_base_debit FROM journals WHERE organization_id = $1 AND source_key = $2',
      [input.organizationId, input.sourceKey],
    );
    if (existing.rows.length > 0) {
      const ex = existing.rows[0];
      if (validation.totalDebit.eq(ex.total_base_debit)) {
        return { journalId: ex.id, journalNumber: ex.journal_number, totalDebit: validation.totalDebit.toFixed(8), replayed: true };
      }
      throw new ApiError(409, ErrorCode.DUPLICATE_SOURCE_PURPOSE, `Source ${input.sourceKey} was already posted with a different amount`);
    }
  }

  const journalId = crypto.randomUUID();
  const journalNumber =
    input.journalNumber || (await nextDocumentNumber(q, input.organizationId, input.numberPrefix || 'JV', input.postingDate, 6));
  const total = validation.totalDebit.toFixed(8);

  await q.query(
    `INSERT INTO journals (
      id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
      accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
      description, source_type, source_id, source_key, reversal_of_journal_id,
      created_by, approved_by, posted_by, posted_at, revision
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'POSTED',$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$15,CURRENT_TIMESTAMP,1)`,
    [
      journalId,
      input.organizationId,
      input.legalEntityId,
      journalNumber,
      input.postingDate,
      input.documentDate || input.postingDate,
      input.purpose,
      input.currency || 'PKR',
      total,
      input.description,
      input.sourceType || null,
      input.sourceId || null,
      input.sourceKey || null,
      input.reversalOfJournalId || null,
      input.userId,
      input.approvedBy || null,
    ],
  );

  for (const l of resolved) {
    await q.query(
      `INSERT INTO journal_lines (
        id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate,
        base_debit, base_credit, description, party_id, dimension_branch_id, dimension_project_id, dimension_cost_center_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$5,$6,$8,$9,$10,$11,$12)`,
      [
        crypto.randomUUID(),
        journalId,
        l.line_number,
        l.account_id,
        l.base_debit,
        l.base_credit,
        input.currency || 'PKR',
        l.description || null,
        l.party_id || null,
        l.dimension_branch_id || null,
        l.dimension_project_id || null,
        l.dimension_cost_center_id || null,
      ],
    );
  }

  await audit.record(
    {
      organization_id: input.organizationId,
      user_id: input.userId,
      action: 'JOURNAL_POSTED',
      entity_type: 'JOURNAL',
      entity_id: journalId,
      after_state: {
        journal_number: journalNumber,
        purpose: input.purpose,
        source_type: input.sourceType,
        source_id: input.sourceId,
        total_base_debit: total,
      },
      correlation_id: input.correlationId,
    },
    q,
  );
  await outbox.emit(
    {
      organization_id: input.organizationId,
      event_type: 'JOURNAL_POSTED',
      payload: { journal_id: journalId, journal_number: journalNumber, purpose: input.purpose, source_type: input.sourceType, source_id: input.sourceId, total_base_debit: total },
    },
    q,
  );

  return { journalId, journalNumber, totalDebit: total, replayed: false };
}
