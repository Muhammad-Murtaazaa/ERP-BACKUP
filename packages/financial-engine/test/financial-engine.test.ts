import { describe, it, expect } from 'vitest';
import {
  Money,
  sumMoney,
  CoaHierarchyValidator,
  STANDARD_COA_TEMPLATE,
  PeriodManager,
  FiscalPeriod,
  JournalValidator,
  LedgerEngine,
  JournalReversalEngine,
  BankReconciliationEngine,
  FxEngine,
} from '../src/index.js';
import {
  Account,
  CoaLevel,
  StatementClass,
  NormalBalance,
  AccountControlType,
  JournalStatus,
  JournalLine,
  PeriodStatus,
  Journal,
} from '@omnysync/contracts';

describe('Financial Engine: Money & Decimal Precision', () => {
  it('performs exact decimal arithmetic without IEEE 754 float drift', () => {
    // 0.1 + 0.2 in JS float is 0.30000000000000004
    const a = new Money('0.1');
    const b = new Money('0.2');
    const result = a.add(b);
    expect(result.toFixed(2)).toBe('0.30');
    expect(result.toFixed(8)).toBe('0.30000000');
    expect(result.toString()).toBe('0.3');
  });

  it('correctly rounds half-up on currency scale boundaries', () => {
    const m1 = new Money('100.555');
    expect(m1.toCurrencyDisplay(2)).toBe('100.56');

    const m2 = new Money('100.554');
    expect(m2.toCurrencyDisplay(2)).toBe('100.55');
  });

  it('rejects invalid, NaN, or non-decimal string inputs', () => {
    expect(() => new Money('abc')).toThrow();
    expect(() => new Money('12.34.56')).toThrow();
    expect(() => new Money(NaN)).toThrow();
  });

  it('correctly sums arrays of decimal values', () => {
    const items = ['10.50', '20.25', '5.25'];
    const sum = sumMoney(items);
    expect(sum.toFixed(2)).toBe('36.00');
  });
});

describe('Financial Engine: 4-Level Chart of Accounts (COA)', () => {
  it('validates that Level 1-3 heading accounts strictly forbid posting', () => {
    const l1: Partial<Account> = {
      level: 1,
      statement_class: StatementClass.ASSET,
      posting_allowed: true, // Should be rejected!
    };
    const check1 = CoaHierarchyValidator.validateAccount(l1);
    expect(check1.valid).toBe(false);
    expect(check1.error).toContain('Posting is strictly forbidden on Level 1');

    const l2: Partial<Account> = {
      level: 2,
      parent_id: '11111111-1111-1111-1111-111111111111',
      statement_class: StatementClass.ASSET,
      posting_allowed: true, // Should be rejected!
    };
    const parentL1: Account = {
      id: '11111111-1111-1111-1111-111111111111',
      organization_id: 'org-1',
      code: '1000',
      name: 'Assets',
      level: 1,
      statement_class: StatementClass.ASSET,
      normal_balance: NormalBalance.DEBIT,
      posting_allowed: false,
      control_type: AccountControlType.GENERAL,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const check2 = CoaHierarchyValidator.validateAccount(l2, parentL1);
    expect(check2.valid).toBe(false);
    expect(check2.error).toContain('Posting is strictly forbidden on Level 2');
  });

  it('validates that Level 4 leaf accounts require posting_allowed = true', () => {
    const l4: Partial<Account> = {
      level: 4,
      parent_id: '33333333-3333-3333-3333-333333333333',
      statement_class: StatementClass.ASSET,
      posting_allowed: true,
    };
    const parentL3: Account = {
      id: '33333333-3333-3333-3333-333333333333',
      organization_id: 'org-1',
      code: '1110',
      name: 'Cash and Bank',
      level: 3,
      statement_class: StatementClass.ASSET,
      normal_balance: NormalBalance.DEBIT,
      posting_allowed: false,
      control_type: AccountControlType.GENERAL,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const check = CoaHierarchyValidator.validateAccount(l4, parentL3);
    expect(check.valid).toBe(true);
  });

  it('contains valid standard COA template with all 4 levels', () => {
    expect(STANDARD_COA_TEMPLATE.length).toBeGreaterThan(15);
    const l4Accounts = STANDARD_COA_TEMPLATE.filter((a) => a.level === 4);
    expect(l4Accounts.every((a) => a.postingAllowed === true)).toBe(true);
    const nonL4Accounts = STANDARD_COA_TEMPLATE.filter((a) => a.level < 4);
    expect(nonL4Accounts.every((a) => a.postingAllowed === false)).toBe(true);
  });
});

describe('Financial Engine: Fiscal Periods & Posting Guard', () => {
  const samplePeriods: FiscalPeriod[] = [
    {
      id: 'p-1',
      organization_id: 'org-1',
      legal_entity_id: 'le-1',
      fiscal_year: 2026,
      period_number: 1,
      period_name: 'Jan 2026',
      start_date: '2026-01-01',
      end_date: '2026-01-31',
      status: PeriodStatus.HARD_CLOSED,
    },
    {
      id: 'p-2',
      organization_id: 'org-1',
      legal_entity_id: 'le-1',
      fiscal_year: 2026,
      period_number: 2,
      period_name: 'Feb 2026',
      start_date: '2026-02-01',
      end_date: '2026-02-28',
      status: PeriodStatus.SOFT_CLOSED,
    },
    {
      id: 'p-3',
      organization_id: 'org-1',
      legal_entity_id: 'le-1',
      fiscal_year: 2026,
      period_number: 3,
      period_name: 'Mar 2026',
      start_date: '2026-03-01',
      end_date: '2026-03-31',
      status: PeriodStatus.OPEN,
    },
  ];

  it('allows posting into an OPEN period', () => {
    const period = PeriodManager.findPeriodForDate(samplePeriods, '2026-03-15');
    expect(period?.period_name).toBe('Mar 2026');
    const check = PeriodManager.assertPostingAllowed(period, '2026-03-15');
    expect(check.allowed).toBe(true);
  });

  it('rejects posting into a HARD_CLOSED period', () => {
    const period = PeriodManager.findPeriodForDate(samplePeriods, '2026-01-10');
    expect(period?.period_name).toBe('Jan 2026');
    const check = PeriodManager.assertPostingAllowed(period, '2026-01-10');
    expect(check.allowed).toBe(false);
    expect(check.error).toContain('HARD_CLOSED');
  });

  it('rejects normal posting into a SOFT_CLOSED period but allows closing adjustment', () => {
    const period = PeriodManager.findPeriodForDate(samplePeriods, '2026-02-14');
    expect(period?.period_name).toBe('Feb 2026');

    const normalCheck = PeriodManager.assertPostingAllowed(period, '2026-02-14', false);
    expect(normalCheck.allowed).toBe(false);
    expect(normalCheck.error).toContain('SOFT_CLOSED');

    const adjustmentCheck = PeriodManager.assertPostingAllowed(period, '2026-02-14', true);
    expect(adjustmentCheck.allowed).toBe(true);
  });
});

describe('Financial Engine: Journal Invariants & Double-Entry Balancing', () => {
  const bankAccount: Account = {
    id: 'acc-bank',
    organization_id: 'org-1',
    code: '111002',
    name: 'Operating Bank PKR',
    level: 4,
    statement_class: StatementClass.ASSET,
    normal_balance: NormalBalance.DEBIT,
    posting_allowed: true,
    control_type: AccountControlType.BANK,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const revenueAccount: Account = {
    id: 'acc-revenue',
    organization_id: 'org-1',
    code: '411001',
    name: 'Product Sales',
    level: 4,
    statement_class: StatementClass.REVENUE,
    normal_balance: NormalBalance.CREDIT,
    posting_allowed: true,
    control_type: AccountControlType.GENERAL,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const parentHeadingAccount: Account = {
    id: 'acc-heading',
    organization_id: 'org-1',
    code: '1110',
    name: 'Cash and Bank',
    level: 3,
    statement_class: StatementClass.ASSET,
    normal_balance: NormalBalance.DEBIT,
    posting_allowed: false,
    control_type: AccountControlType.GENERAL,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const accountMap = new Map<string, Account>([
    [bankAccount.id, bankAccount],
    [revenueAccount.id, revenueAccount],
    [parentHeadingAccount.id, parentHeadingAccount],
  ]);

  it('validates balanced journal with Debit 1000.00 and Credit 1000.00', () => {
    const lines: JournalLine[] = [
      {
        line_number: 1,
        account_id: bankAccount.id,
        debit_amount: '1000.00000000',
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '1000.00000000',
        base_credit: '0.00000000',
      },
      {
        line_number: 2,
        account_id: revenueAccount.id,
        debit_amount: '0.00000000',
        credit_amount: '1000.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: '1000.00000000',
      },
    ];

    const result = JournalValidator.validate(lines, accountMap);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.difference.isZero()).toBe(true);
    expect(result.totalDebit.toFixed(2)).toBe('1000.00');
    expect(result.totalCredit.toFixed(2)).toBe('1000.00');
  });

  it('rejects unbalanced journal (Debit 1000.00 vs Credit 950.00)', () => {
    const lines: JournalLine[] = [
      {
        line_number: 1,
        account_id: bankAccount.id,
        debit_amount: '1000.00000000',
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '1000.00000000',
        base_credit: '0.00000000',
      },
      {
        line_number: 2,
        account_id: revenueAccount.id,
        debit_amount: '0.00000000',
        credit_amount: '950.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: '950.00000000',
      },
    ];

    const result = JournalValidator.validate(lines, accountMap);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('unbalanced'))).toBe(true);
  });

  it('rejects journal referencing non-leaf parent account', () => {
    const lines: JournalLine[] = [
      {
        line_number: 1,
        account_id: parentHeadingAccount.id, // Level 3!
        debit_amount: '500.00000000',
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '500.00000000',
        base_credit: '0.00000000',
      },
      {
        line_number: 2,
        account_id: revenueAccount.id,
        debit_amount: '0.00000000',
        credit_amount: '500.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: '500.00000000',
      },
    ];

    const result = JournalValidator.validate(lines, accountMap);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Level 3'))).toBe(true);
  });
});

describe('Financial Engine: Linked Reversal and Trial Balance', () => {
  const originalJournal: Journal = {
    id: 'j-001',
    organization_id: 'org-1',
    legal_entity_id: 'le-1',
    journal_number: 'JV-2026-0001',
    posting_date: '2026-03-01',
    document_date: '2026-03-01',
    accounting_purpose: 'MANUAL_JOURNAL',
    status: JournalStatus.POSTED,
    base_currency: 'PKR',
    total_base_debit: '5000.00',
    total_base_credit: '5000.00',
    description: 'Original equipment purchase',
    source_type: null,
    source_id: null,
    source_version: 1,
    reversal_of_journal_id: null,
    reversed_by_journal_id: null,
    created_by: 'user-1',
    approved_by: 'user-2',
    posted_by: 'user-2',
    posted_at: '2026-03-01T10:00:00Z',
    revision: 1,
    created_at: '2026-03-01T09:00:00Z',
    updated_at: '2026-03-01T10:00:00Z',
    lines: [
      {
        id: 'jl-1',
        line_number: 1,
        account_id: 'acc-equipment',
        debit_amount: '5000.00',
        credit_amount: '0.00',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '5000.00',
        base_credit: '0.00',
      },
      {
        id: 'jl-2',
        line_number: 2,
        account_id: 'acc-bank',
        debit_amount: '0.00',
        credit_amount: '5000.00',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00',
        base_credit: '5000.00',
      },
    ],
  };

  it('creates linked reversal with swapped debits and credits and linkage', () => {
    const { reversalJournal } = JournalReversalEngine.createLinkedReversal({
      originalJournal,
      reversalPostingDate: '2026-03-05',
      reversalDocumentDate: '2026-03-05',
      reason: 'Incorrect equipment valuation',
      reversingUserId: 'user-2',
    });

    expect(reversalJournal.reversal_of_journal_id).toBe(originalJournal.id);
    expect(reversalJournal.lines[0].base_debit).toBe('0.00');
    expect(reversalJournal.lines[0].base_credit).toBe('5000.00');
    expect(reversalJournal.lines[1].base_debit).toBe('5000.00');
    expect(reversalJournal.lines[1].base_credit).toBe('0.00');
  });

  it('computes balanced Trial Balance when original and reversal are posted', () => {
    const accounts: Account[] = [
      {
        id: 'acc-equipment',
        organization_id: 'org-1',
        code: '121001',
        name: 'Office Equipment Cost',
        level: 4,
        statement_class: StatementClass.ASSET,
        normal_balance: NormalBalance.DEBIT,
        posting_allowed: true,
        control_type: AccountControlType.GENERAL,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'acc-bank',
        organization_id: 'org-1',
        code: '111002',
        name: 'Operating Bank PKR',
        level: 4,
        statement_class: StatementClass.ASSET,
        normal_balance: NormalBalance.DEBIT,
        posting_allowed: true,
        control_type: AccountControlType.BANK,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    // Original lines + Reversal lines
    const allLines: JournalLine[] = [
      ...originalJournal.lines!,
      {
        line_number: 1,
        account_id: 'acc-equipment',
        debit_amount: '0.00',
        credit_amount: '5000.00',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00',
        base_credit: '5000.00',
      },
      {
        line_number: 2,
        account_id: 'acc-bank',
        debit_amount: '5000.00',
        credit_amount: '0.00',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '5000.00',
        base_credit: '0.00',
      },
    ];

    const tb = LedgerEngine.computeTrialBalance(accounts, allLines, '2026-03-31', 'le-1');
    expect(tb.is_balanced).toBe(true);
    expect(tb.net_difference).toBe('0.00');

    // Both accounts should have net balance 0.00 after full reversal
    const eqAccount = tb.accounts.find((a) => a.account_id === 'acc-equipment');
    const bankAcc = tb.accounts.find((a) => a.account_id === 'acc-bank');
    expect(eqAccount?.net_balance).toBe('0.00');
    expect(bankAcc?.net_balance).toBe('0.00');
  });
});

describe('Financial Engine: Bank Statement Reconciliation', () => {
  it('computes bank reconciliation summary and zero variance on fully matched statement', () => {
    const statementLines: any[] = [
      { id: 'sl-1', statement_id: 's-1', line_number: 1, transaction_date: '2026-03-10', amount: '50000.00', is_matched: true },
      { id: 'sl-2', statement_id: 's-1', line_number: 2, transaction_date: '2026-03-15', amount: '-15000.00', is_matched: true },
    ];

    const summary = BankReconciliationEngine.computeReconciliation({
      statementOpeningBalance: '100000.00',
      statementClosingBalance: '135000.00', // 100k + 50k - 15k = 135k
      glBalanceAsOfDate: '135000.00',
      statementLines,
    });

    expect(summary.isReconciled).toBe(true);
    expect(summary.unreconciledDifference).toBe('0.00');
    expect(summary.clearedDeposits).toBe('50000.00');
    expect(summary.clearedWithdrawals).toBe('15000.00');
    expect(summary.matchedLinesCount).toBe(2);
    expect(summary.unmatchedLinesCount).toBe(0);
  });

  it('detects variance when GL balance and statement balance disagree', () => {
    const statementLines: any[] = [
      { id: 'sl-1', statement_id: 's-1', line_number: 1, transaction_date: '2026-03-10', amount: '50000.00', is_matched: true },
    ];

    const summary = BankReconciliationEngine.computeReconciliation({
      statementOpeningBalance: '100000.00',
      statementClosingBalance: '150000.00',
      glBalanceAsOfDate: '140000.00', // 10,000 difference
      statementLines,
    });

    expect(summary.isReconciled).toBe(false);
    expect(summary.unreconciledDifference).toBe('10000.00');
  });

  it('auto-matches statement lines with un-reconciled GL lines by amount', () => {
    const statementLines: any[] = [
      { id: 'sl-1', amount: '25000.00', is_matched: false },
      { id: 'sl-2', amount: '-8000.00', is_matched: false },
    ];

    const glLines: any[] = [
      { id: 'gl-1', debit_amount: '25000.00', credit_amount: '0.00' },
      { id: 'gl-2', debit_amount: '0.00', credit_amount: '8000.00' },
    ];

    const matches = BankReconciliationEngine.autoMatchLines(statementLines, glLines);
    expect(matches).toHaveLength(2);
    expect(matches[0].journalLineId).toBe('gl-1');
    expect(matches[0].matchType).toBe('EXACT_AMOUNT');
    expect(matches[1].journalLineId).toBe('gl-2');
  });
});

describe('Financial Engine: Multi-Currency & FX Calculations', () => {
  it('converts foreign currency amount using exact 24,12 precision rate', () => {
    const res = FxEngine.convertToBase({
      amount: '1500.50',
      fxRate: '278.452319000000',
      currency: 'USD',
      baseCurrency: 'PKR',
    });

    expect(res.foreignAmount).toBe('1500.50');
    // 1500.50 * 278.452319 = 417817.7046595 -> 417817.70
    expect(res.baseAmount).toBe('417817.70');
  });

  it('computes Realized FX Gain on customer AR invoice settlement', () => {
    // Invoiced $10,000 @ 275 PKR = 2,750,000 PKR
    // Settled $10,000 @ 280 PKR = 2,800,000 PKR
    // Gain = +50,000 PKR
    const res = FxEngine.computeRealizedGainLoss({
      foreignAmount: '10000.00',
      originalFxRate: '275.000000000000',
      settlementFxRate: '280.000000000000',
      transactionType: 'AR',
    });

    expect(res.isGain).toBe(true);
    expect(res.isLoss).toBe(false);
    expect(res.gainLossAmount).toBe('50000.00');
    expect(res.originalBaseAmount).toBe('2750000.00');
    expect(res.settledBaseAmount).toBe('2800000.00');
  });

  it('computes Realized FX Loss on vendor AP bill payment', () => {
    // Billed $5,000 @ 275 PKR = 1,375,000 PKR
    // Paid $5,000 @ 282 PKR = 1,410,000 PKR (we had to pay more base currency => Loss)
    const res = FxEngine.computeRealizedGainLoss({
      foreignAmount: '5000.00',
      originalFxRate: '275.000000000000',
      settlementFxRate: '282.000000000000',
      transactionType: 'AP',
    });

    expect(res.isLoss).toBe(true);
    expect(res.isGain).toBe(false);
    expect(res.gainLossAmount).toBe('35000.00');
  });
});

