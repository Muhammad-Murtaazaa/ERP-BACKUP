import { Account, JournalLine, NormalBalance, StatementClass } from '@omnysync/contracts';
import { Money, sumMoney } from './money.js';

export interface AccountLedgerSummary {
  account_id: string;
  account_code: string;
  account_name: string;
  level: number;
  statement_class: StatementClass;
  normal_balance: NormalBalance;
  parent_id?: string | null;
  total_debit: string;
  total_credit: string;
  net_balance: string; // Positive if balance aligns with normal balance
}

export interface TrialBalanceReport {
  as_of_date: string;
  legal_entity_id: string;
  currency: string;
  accounts: AccountLedgerSummary[];
  total_debits: string;
  total_credits: string;
  is_balanced: boolean;
  net_difference: string;
}

export class LedgerEngine {
  /**
   * Computes a Trial Balance from posted journal lines and account metadata.
   */
  static computeTrialBalance(
    accounts: Account[],
    postedLines: JournalLine[],
    asOfDate: string,
    legalEntityId: string,
    currency: string = 'PKR',
  ): TrialBalanceReport {
    const debitMap = new Map<string, Money>();
    const creditMap = new Map<string, Money>();

    // Initialize account maps
    for (const acc of accounts) {
      debitMap.set(acc.id, Money.zero());
      creditMap.set(acc.id, Money.zero());
    }

    // Accumulate debits and credits from posted lines
    for (const line of postedLines) {
      const curDebit = debitMap.get(line.account_id) || Money.zero();
      const curCredit = creditMap.get(line.account_id) || Money.zero();

      const lineDebit = new Money(line.base_debit || '0');
      const lineCredit = new Money(line.base_credit || '0');

      debitMap.set(line.account_id, curDebit.add(lineDebit));
      creditMap.set(line.account_id, curCredit.add(lineCredit));
    }

    const summaries: AccountLedgerSummary[] = [];
    let grandTotalDebit = Money.zero();
    let grandTotalCredit = Money.zero();

    for (const acc of accounts) {
      const d = debitMap.get(acc.id) || Money.zero();
      const c = creditMap.get(acc.id) || Money.zero();

      // Only leaf accounts have direct postings in double entry; parent accounts can be rolled up
      let net: Money;
      if (acc.normal_balance === NormalBalance.DEBIT) {
        net = d.sub(c);
      } else {
        net = c.sub(d);
      }

      if (acc.level === 4) {
        grandTotalDebit = grandTotalDebit.add(d);
        grandTotalCredit = grandTotalCredit.add(c);
      }

      summaries.push({
        account_id: acc.id,
        account_code: acc.code,
        account_name: acc.name,
        level: acc.level,
        statement_class: acc.statement_class,
        normal_balance: acc.normal_balance,
        parent_id: acc.parent_id,
        total_debit: d.toFixed(2),
        total_credit: c.toFixed(2),
        net_balance: net.toFixed(2),
      });
    }

    // Sort by account code
    summaries.sort((a, b) => a.account_code.localeCompare(b.account_code));

    const diff = grandTotalDebit.sub(grandTotalCredit).abs();
    const isBalanced = diff.isZero();

    return {
      as_of_date: asOfDate,
      legal_entity_id: legalEntityId,
      currency,
      accounts: summaries,
      total_debits: grandTotalDebit.toFixed(2),
      total_credits: grandTotalCredit.toFixed(2),
      is_balanced: isBalanced,
      net_difference: diff.toFixed(2),
    };
  }
}
