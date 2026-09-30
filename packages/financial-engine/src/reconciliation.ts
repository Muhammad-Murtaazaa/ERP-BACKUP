import { Money } from './money.js';
import { BankStatementLine, JournalLine } from '@omnysync/contracts';

export interface ReconciliationMatchResult {
  statementLineId: string;
  journalLineId?: string;
  matchType: 'EXACT_AMOUNT_DATE' | 'EXACT_AMOUNT' | 'UNMATCHED';
  confidence: number;
}

export interface BankReconciliationSummary {
  statementOpeningBalance: string;
  statementClosingBalance: string;
  glCalculatedBalance: string;
  clearedDeposits: string;
  clearedWithdrawals: string;
  unreconciledDifference: string;
  isReconciled: boolean;
  totalLinesCount: number;
  matchedLinesCount: number;
  unmatchedLinesCount: number;
}

export class BankReconciliationEngine {
  /**
   * Automatically suggests matches between statement lines and un-reconciled bank GL lines.
   */
  static autoMatchLines(
    statementLines: BankStatementLine[],
    unreconciledGlLines: JournalLine[],
  ): ReconciliationMatchResult[] {
    const results: ReconciliationMatchResult[] = [];
    const matchedGlIds = new Set<string>();

    for (const sLine of statementLines) {
      if (sLine.is_matched && sLine.matched_journal_line_id) {
        matchedGlIds.add(sLine.matched_journal_line_id);
        results.push({
          statementLineId: sLine.id,
          journalLineId: sLine.matched_journal_line_id,
          matchType: 'EXACT_AMOUNT_DATE',
          confidence: 1.0,
        });
        continue;
      }

      const stmtAmt = new Money(sLine.amount);

      // Look for matching GL line:
      // Positive statement amount (deposit) corresponds to debit on bank account.
      // Negative statement amount (withdrawal) corresponds to credit on bank account.
      const candidate = unreconciledGlLines.find((gl) => {
        if (matchedGlIds.has(gl.id || '')) return false;

        if (stmtAmt.isPositive()) {
          const glDebit = new Money(gl.debit_amount);
          return glDebit.equals(stmtAmt);
        } else {
          const glCredit = new Money(gl.credit_amount);
          return glCredit.equals(stmtAmt.abs());
        }
      });

      if (candidate && candidate.id) {
        matchedGlIds.add(candidate.id);
        results.push({
          statementLineId: sLine.id,
          journalLineId: candidate.id,
          matchType: 'EXACT_AMOUNT',
          confidence: 0.9,
        });
      } else {
        results.push({
          statementLineId: sLine.id,
          matchType: 'UNMATCHED',
          confidence: 0.0,
        });
      }
    }

    return results;
  }

  /**
   * Computes bank reconciliation summary and variance check.
   */
  static computeReconciliation(params: {
    statementOpeningBalance: string;
    statementClosingBalance: string;
    glBalanceAsOfDate: string;
    statementLines: BankStatementLine[];
  }): BankReconciliationSummary {
    const opening = new Money(params.statementOpeningBalance);
    const closing = new Money(params.statementClosingBalance);
    const glClosing = new Money(params.glBalanceAsOfDate);

    let deposits = Money.zero();
    let withdrawals = Money.zero();
    let matchedCount = 0;

    for (const l of params.statementLines) {
      const amt = new Money(l.amount);
      if (amt.isPositive()) {
        deposits = deposits.add(amt);
      } else {
        withdrawals = withdrawals.add(amt.abs());
      }
      if (l.is_matched) {
        matchedCount++;
      }
    }

    // Calculated Statement Closing = Opening + Deposits - Withdrawals
    const calcStatementClosing = opening.add(deposits).sub(withdrawals);

    // Difference between Statement Closing and GL Balance
    const diff = closing.sub(glClosing).abs();
    const isReconciled = diff.isZero() && matchedCount === params.statementLines.length;

    return {
      statementOpeningBalance: opening.toFixed(2),
      statementClosingBalance: closing.toFixed(2),
      glCalculatedBalance: glClosing.toFixed(2),
      clearedDeposits: deposits.toFixed(2),
      clearedWithdrawals: withdrawals.toFixed(2),
      unreconciledDifference: diff.toFixed(2),
      isReconciled,
      totalLinesCount: params.statementLines.length,
      matchedLinesCount: matchedCount,
      unmatchedLinesCount: params.statementLines.length - matchedCount,
    };
  }

  /**
   * Deterministic auto-match suggestions (no external services):
   *  1. exact signed amount (decimal compare),
   *  2. GL date within +/- toleranceDays of the bank transaction date,
   *  3. prefer candidates whose text contains the bank reference, then the closest date,
   *     then the lowest id (stable tie-break). Each GL line is used at most once.
   */
  static suggestMatches(
    statementLines: { id: string; date: string; amount: string; reference?: string; description?: string }[],
    glLines: { id: string; date: string; amount: string; text?: string }[],
    toleranceDays = 5,
  ): { statementLineId: string; journalLineId: string; score: number; reason: string }[] {
    const used = new Set<string>();
    const out: { statementLineId: string; journalLineId: string; score: number; reason: string }[] = [];
    const day = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
    for (const s of statementLines) {
      const amt = new Money(s.amount);
      const ref = (s.reference || '').trim().toUpperCase();
      const candidates = glLines
        .filter((g) => !used.has(g.id) && new Money(g.amount).eq(amt) && Math.abs(day(g.date) - day(s.date)) <= toleranceDays)
        .map((g) => {
          const refHit = ref.length >= 3 && (g.text || '').toUpperCase().includes(ref);
          const dist = Math.abs(day(g.date) - day(s.date));
          return { g, refHit, dist, score: (refHit ? 100 : 50) - dist };
        })
        .sort((a, b) => b.score - a.score || a.g.id.localeCompare(b.g.id));
      const best = candidates[0];
      if (!best) continue;
      // Ambiguity guard: two equally scored candidates without a reference hit are left for a human.
      if (!best.refHit && candidates[1] && candidates[1].score === best.score) continue;
      used.add(best.g.id);
      out.push({ statementLineId: s.id, journalLineId: best.g.id, score: best.score, reason: best.refHit ? 'amount+reference' : 'amount+date' });
    }
    return out;
  }
}
