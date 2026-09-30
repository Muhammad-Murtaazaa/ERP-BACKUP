import { Journal, JournalLine, JournalStatus, AccountingPurpose } from '@omnysync/contracts';

export interface CreateReversalInput {
  originalJournal: Journal;
  reversalPostingDate: string;
  reversalDocumentDate: string;
  reason: string;
  reversingUserId: string;
}

export interface ReversalResult {
  reversalJournal: Omit<Journal, 'id' | 'created_at' | 'updated_at'> & {
    lines: Omit<JournalLine, 'id'>[];
  };
}

export class JournalReversalEngine {
  /**
   * Generates a linked mirror reversal journal:
   * 1. Reversal base debit = Original base credit
   * 2. Reversal base credit = Original base debit
   * 3. Sets accounting_purpose = REVERSAL
   * 4. Sets reversal_of_journal_id = originalJournal.id
   * 5. Validates original status is POSTED
   */
  static createLinkedReversal(input: CreateReversalInput): ReversalResult {
    const { originalJournal, reversalPostingDate, reversalDocumentDate, reason, reversingUserId } = input;

    if (originalJournal.status !== JournalStatus.POSTED) {
      throw new Error(`Cannot reverse journal with status "${originalJournal.status}". Only POSTED journals can be reversed.`);
    }

    if (originalJournal.reversed_by_journal_id) {
      throw new Error(`Journal ${originalJournal.journal_number} is already reversed by journal ID ${originalJournal.reversed_by_journal_id}`);
    }

    if (!originalJournal.lines || originalJournal.lines.length < 2) {
      throw new Error(`Cannot reverse journal ${originalJournal.journal_number}: missing original lines`);
    }

    // Mirror lines: Debits become Credits, Credits become Debits
    const reversalLines: Omit<JournalLine, 'id'>[] = originalJournal.lines.map((line, idx) => ({
      line_number: idx + 1,
      account_id: line.account_id,
      debit_amount: line.credit_amount,
      credit_amount: line.debit_amount,
      currency: line.currency,
      fx_rate: line.fx_rate,
      base_debit: line.base_credit,
      base_credit: line.base_debit,
      description: `Reversal of line ${line.line_number}: ${line.description || reason}`,
      party_id: line.party_id,
      dimension_branch_id: line.dimension_branch_id,
      dimension_project_id: line.dimension_project_id,
      dimension_cost_center_id: line.dimension_cost_center_id,
    }));

    const reversalJournal: Omit<Journal, 'id' | 'created_at' | 'updated_at'> & {
      lines: Omit<JournalLine, 'id'>[];
    } = {
      organization_id: originalJournal.organization_id,
      legal_entity_id: originalJournal.legal_entity_id,
      journal_number: `${originalJournal.journal_number}-REV`,
      posting_date: reversalPostingDate,
      document_date: reversalDocumentDate,
      accounting_purpose: AccountingPurpose.REVERSAL,
      status: JournalStatus.DRAFT, // Will be posted through posting engine
      base_currency: originalJournal.base_currency,
      total_base_debit: originalJournal.total_base_credit,
      total_base_credit: originalJournal.total_base_debit,
      description: `Reversal of ${originalJournal.journal_number}: ${reason}`,
      source_type: 'JOURNAL',
      source_id: originalJournal.id,
      source_version: 1,
      reversal_of_journal_id: originalJournal.id,
      reversed_by_journal_id: null,
      created_by: reversingUserId,
      approved_by: null,
      posted_by: null,
      posted_at: null,
      revision: 1,
      lines: reversalLines,
    };

    return { reversalJournal };
  }
}
