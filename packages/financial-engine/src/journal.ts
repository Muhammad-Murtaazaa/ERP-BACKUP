import { Account, JournalLine } from '@omnysync/contracts';
import { Money, sumMoney } from './money.js';

export interface JournalValidationResult {
  isValid: boolean;
  errors: string[];
  totalDebit: Money;
  totalCredit: Money;
  difference: Money;
}

export class JournalValidator {
  /**
   * Validates core accounting invariants for a journal before submission or posting:
   * 1. Must contain at least 2 lines.
   * 2. Each line must have valid decimal amounts (>= 0).
   * 3. A line cannot contain BOTH a positive debit and a positive credit.
   * 4. A line cannot have BOTH debit = 0 and credit = 0.
   * 5. Every referenced account must exist, be active, be level 4 (leaf), and have posting_allowed = true.
   * 6. Sum of base debits must exactly equal Sum of base credits (difference == 0).
   */
  static validate(
    lines: JournalLine[],
    accountMap: Map<string, Account>,
  ): JournalValidationResult {
    const errors: string[] = [];

    if (!lines || lines.length < 2) {
      errors.push('A journal entry must contain at least 2 lines');
      return {
        isValid: false,
        errors,
        totalDebit: Money.zero(),
        totalCredit: Money.zero(),
        difference: Money.zero(),
      };
    }

    const baseDebits: Money[] = [];
    const baseCredits: Money[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = line.line_number || i + 1;

      let debit: Money;
      let credit: Money;
      let baseDebit: Money;
      let baseCredit: Money;

      try {
        debit = new Money(line.debit_amount || '0');
        credit = new Money(line.credit_amount || '0');
        baseDebit = new Money(line.base_debit || line.debit_amount || '0');
        baseCredit = new Money(line.base_credit || line.credit_amount || '0');
      } catch (err: unknown) {
        errors.push(`Line ${lineNum}: Invalid numeric format (${err instanceof Error ? err.message : String(err)})`);
        continue;
      }

      if (debit.isNegative() || credit.isNegative() || baseDebit.isNegative() || baseCredit.isNegative()) {
        errors.push(`Line ${lineNum}: Monetary amounts cannot be negative`);
      }

      if (baseDebit.isPositive() && baseCredit.isPositive()) {
        errors.push(`Line ${lineNum}: A journal line cannot contain both a debit and a credit`);
      }

      if (baseDebit.isZero() && baseCredit.isZero()) {
        errors.push(`Line ${lineNum}: A journal line must have either a positive debit or credit amount`);
      }

      // Check account validity
      const account = accountMap.get(line.account_id);
      if (!account) {
        errors.push(`Line ${lineNum}: Account with ID "${line.account_id}" not found`);
      } else {
        if (!account.is_active) {
          errors.push(`Line ${lineNum}: Account "${account.code} - ${account.name}" is inactive`);
        }
        if (account.level !== 4) {
          errors.push(
            `Line ${lineNum}: Posting rejected! Account "${account.code} - ${account.name}" is Level ${account.level} (only Level 4 leaf accounts can be posted to)`,
          );
        }
        if (!account.posting_allowed) {
          errors.push(`Line ${lineNum}: Posting is not permitted on account "${account.code} - ${account.name}"`);
        }
      }

      baseDebits.push(baseDebit);
      baseCredits.push(baseCredit);
    }

    const totalDebit = sumMoney(baseDebits);
    const totalCredit = sumMoney(baseCredits);
    const difference = totalDebit.sub(totalCredit).abs();

    if (!totalDebit.eq(totalCredit)) {
      errors.push(
        `Journal is unbalanced! Total Base Debits (${totalDebit.toFixed(2)}) must equal Total Base Credits (${totalCredit.toFixed(2)}). Difference: ${difference.toFixed(2)}`,
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      totalDebit,
      totalCredit,
      difference,
    };
  }
}
