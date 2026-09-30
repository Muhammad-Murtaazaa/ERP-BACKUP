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
  PayrollEngine,
  ManufacturingEngine,
  InventoryReconciliationEngine,
  ProjectsEngine,
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

describe('Financial Engine: Workforce & Payroll Calculations', () => {
  it('computes gross salary and progressive monthly tax accurately', () => {
    // Basic: 100,000, House Rent: 40,000, Utility: 10,000 => Monthly Gross = 150,000
    // Annual Gross = 1,800,000
    // Tax Slab (1.2M - 2.4M): 30,000 + (1,800,000 - 1,200,000)*0.15 = 30,000 + 90,000 = 120,000
    // Monthly Tax = 120,000 / 12 = 10,000
    const calc = PayrollEngine.computeEmployeePayroll('emp-1', {
      basic_salary: '100000.00',
      house_rent_allowance: '40000.00',
      utility_allowance: '10000.00',
    });

    expect(calc.gross_salary).toBe('150000.00');
    expect(calc.tax_deduction).toBe('10000.00');
    expect(calc.eobi_deduction).toBe('300.00');
    // Total deductions = 10,000 + 300 = 10,300
    expect(calc.total_deductions).toBe('10300.00');
    // Net salary = 150,000 - 10,300 = 139,700
    expect(calc.net_salary).toBe('139700.00');
  });

  it('aggregates payroll run totals and enforces Gross = Deductions + Net invariant', () => {
    const item1 = PayrollEngine.computeEmployeePayroll('emp-1', {
      basic_salary: '100000.00',
      house_rent_allowance: '50000.00',
    });
    const item2 = PayrollEngine.computeEmployeePayroll('emp-2', {
      basic_salary: '50000.00',
      house_rent_allowance: '20000.00',
    });

    const totals = PayrollEngine.aggregatePayrollRun([item1, item2]);
    expect(totals.total_gross).toBe('220000.00');
    expect(new Money(totals.total_deductions).add(new Money(totals.total_net)).format()).toBe(totals.total_gross);
  });

  it('generates strictly balanced General Ledger journal lines for payroll posting and disbursement', () => {
    const item = PayrollEngine.computeEmployeePayroll('emp-1', {
      basic_salary: '150000.00',
      house_rent_allowance: '50000.00',
    });
    const totals = PayrollEngine.aggregatePayrollRun([item]);

    const journalLines = PayrollEngine.generatePayrollJournalLines({
      totals,
      salariesExpenseAccountId: 'acc-sal-exp',
      taxPayableAccountId: 'acc-tax-pay',
      eobiPayableAccountId: 'acc-eobi-pay',
      salariesPayableAccountId: 'acc-sal-pay',
    });

    // Check balancing
    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    for (const l of journalLines) {
      totalDebit = totalDebit.add(new Money(l.debit_amount));
      totalCredit = totalCredit.add(new Money(l.credit_amount));
    }
    expect(totalDebit.format()).toBe(totalCredit.format());
    expect(totalDebit.format()).toBe('200000.00');

    // Test disbursement lines
    const disbLines = PayrollEngine.generateDisbursementJournalLines({
      totalNet: totals.total_net,
      salariesPayableAccountId: 'acc-sal-pay',
      bankAccountId: 'acc-bank',
    });
    expect(disbLines[0].debit_amount).toBe(totals.total_net);
    expect(disbLines[1].credit_amount).toBe(totals.total_net);
  });
});

describe('Financial Engine: Manufacturing & BOM Explode / Work Order Costing', () => {
  it('explodes BOM accurately factoring in yield and scrap percentage', () => {
    const bom: any = {
      id: 'bom-1',
      bom_number: 'BOM-100',
      finished_item_id: 'item-finish',
      name: 'Standard Desktop Computer Assembly',
      version: '1.0',
      yield_quantity: '1.00000000',
      items: [
        {
          component_item_id: 'comp-cpu',
          quantity: '1.00000000',
          scrap_percentage: '0.00',
        },
        {
          component_item_id: 'comp-ram',
          quantity: '2.00000000',
          scrap_percentage: '5.00', // 5% scrap
        },
      ],
    };

    // Target = 10 units
    const reqs = ManufacturingEngine.explodeBOM(bom, '10.00000000', {
      'comp-cpu': '25000.00000000',
      'comp-ram': '8000.00000000',
    });

    expect(reqs).toHaveLength(2);
    // CPU: 1 * 10 = 10 units @ 25,000 = 250,000
    expect(reqs[0].required_qty).toBe('10.00000000');
    expect(reqs[0].estimated_total_cost).toBe('250000.00000000');
    // RAM: 2 * 10 * 1.05 = 21 units @ 8,000 = 168,000
    expect(reqs[1].required_qty).toBe('21.00000000');
    expect(reqs[1].estimated_total_cost).toBe('168000.00000000');
  });

  it('calculates work order material cost and generates balanced completion journal', () => {
    const consumptions: any[] = [
      {
        component_item_id: 'comp-cpu',
        consumed_qty: '10.00000000',
        unit_cost: '25000.00000000',
        total_cost: '250000.00000000',
      },
      {
        component_item_id: 'comp-ram',
        consumed_qty: '20.00000000',
        unit_cost: '8000.00000000',
        total_cost: '160000.00000000',
      },
    ];

    // Total material cost = 250,000 + 160,000 = 410,000
    // 9 completed, 1 scrapped
    const costs = ManufacturingEngine.calculateWorkOrderCost(consumptions, '9', '1');
    expect(costs.total_material_cost).toBe('410000.00000000');
    expect(costs.finished_goods_cost).toBe('369000.00000000');
    expect(costs.scrap_cost).toBe('41000.00000000');
    expect(costs.finished_unit_cost).toBe('41000.00000000');

    // Generate completion journal draft
    const draft = ManufacturingEngine.generateCompletionJournal({
      workOrder: {
        id: 'wo-1',
        organization_id: 'org-1',
        work_order_number: 'WO-2026-001',
        bom_id: 'bom-1',
        finished_item_id: 'item-finish',
        warehouse_id: 'wh-prod',
        target_qty: '10',
        completed_qty: '9',
        scrapped_qty: '1',
        status: 'COMPLETED',
        start_date: '2026-03-01',
        due_date: '2026-03-05',
        total_material_cost: '410000.00000000',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      organizationId: 'org-1',
      legalEntityId: 'le-1',
      finishedGoodsAccountId: 'acc-fg-113004',
      wipAccountId: 'acc-wip-113003',
      scrapExpenseAccountId: 'acc-scrap-511003',
      postingDate: '2026-03-05',
      documentDate: '2026-03-05',
      consumptions,
    });

    let totalDr = Money.zero();
    let totalCr = Money.zero();
    for (const l of draft.lines) {
      totalDr = totalDr.add(new Money(l.debit_amount));
      totalCr = totalCr.add(new Money(l.credit_amount));
    }
    expect(totalDr.format()).toBe('410000.00');
    expect(totalCr.format()).toBe('410000.00');
  });
});

describe('Financial Engine: Physical Inventory Count & Adjustments', () => {
  it('calculates inventory count variances and generates balanced shrinkage adjustment journal', () => {
    const calc = InventoryReconciliationEngine.calculateVariances([
      {
        item_id: 'item-1',
        system_qty: '100.00000000',
        counted_qty: '95.00000000', // -5 shortage
        unit_cost: '1000.00000000',
      },
      {
        item_id: 'item-2',
        system_qty: '50.00000000',
        counted_qty: '52.00000000', // +2 surplus
        unit_cost: '500.00000000',
      },
    ]);

    // Item 1 variance: -5 * 1000 = -5000
    // Item 2 variance: +2 * 500 = +1000
    // Total variance = -4000 (net shortage)
    expect(calc.total_variance_value).toBe('-4000.00000000');

    const draft = InventoryReconciliationEngine.generateAdjustmentJournal({
      inventoryCount: {
        id: 'count-1',
        organization_id: 'org-1',
        count_number: 'CNT-2026-Q1',
        warehouse_id: 'wh-main',
        period_id: 'period-1',
        count_date: '2026-03-31',
        status: 'RECONCILED',
        total_variance_value: calc.total_variance_value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      organizationId: 'org-1',
      legalEntityId: 'le-1',
      inventoryAccountId: 'acc-inv-113001',
      adjustmentExpenseAccountId: 'acc-adj-511002',
      postingDate: '2026-03-31',
      documentDate: '2026-03-31',
    });

    expect(draft.lines).toHaveLength(2);
    // Dr Expense 4,000, Cr Asset 4,000
    expect(draft.lines[0].debit_amount).toBe('4000.00000000');
    expect(draft.lines[0].account_id).toBe('acc-adj-511002');
    expect(draft.lines[1].credit_amount).toBe('4000.00000000');
    expect(draft.lines[1].account_id).toBe('acc-inv-113001');
  });
});

describe('Financial Engine: Projects, BOQ & Progress Certificates (IPC)', () => {
  it('calculates progress certificate with cumulative quantities and retention money deduction', () => {
    const cert = ProjectsEngine.calculateProgressCertificate(
      [
        {
          boq_item_id: 'boq-item-1',
          previous_quantity: '20.00000000',
          current_quantity: '30.00000000',
          unit_rate: '15000.00000000', // 30 * 15,000 = 450,000
        },
        {
          boq_item_id: 'boq-item-2',
          previous_quantity: '0.00000000',
          current_quantity: '10.00000000',
          unit_rate: '25000.00000000', // 10 * 25,000 = 250,000
        },
      ],
      '5.00' // 5% retention
    );

    // Gross = 450,000 + 250,000 = 700,000
    // Retention = 700,000 * 5% = 35,000
    // Net = 700,000 - 35,000 = 665,000
    expect(cert.gross_certified_amount).toBe('700000.00000000');
    expect(cert.retention_amount).toBe('35000.00000000');
    expect(cert.net_certified_amount).toBe('665000.00000000');

    expect(cert.items[0].cumulative_quantity).toBe('50.00000000');
    expect(cert.items[0].current_amount).toBe('450000.00000000');
    expect(cert.items[1].cumulative_quantity).toBe('10.00000000');
    expect(cert.items[1].current_amount).toBe('250000.00000000');
  });

  it('validates and rejects over-certification against BOQ contract quantities', () => {
    const boqItems: any[] = [
      {
        id: 'boq-item-1',
        item_code: 'CIV-001',
        contract_quantity: '100.00000000',
        certified_quantity: '80.00000000',
      },
    ];

    // Attempting to certify 30 more when only 20 remaining
    const result = ProjectsEngine.validateBoqQuantities(boqItems, [
      { boq_item_id: 'boq-item-1', current_quantity: '30.00000000' },
    ]);

    expect(result.valid).toBe(false);
    expect(result.exceededItemCode).toBe('CIV-001');
    expect(result.exceededQty).toBe('10.00000000');

    // Valid certification of 20
    const validResult = ProjectsEngine.validateBoqQuantities(boqItems, [
      { boq_item_id: 'boq-item-1', current_quantity: '20.00000000' },
    ]);
    expect(validResult.valid).toBe(true);
  });

  it('generates perfectly balanced General Ledger progress invoice journal with retention split', () => {
    const journalDraft = ProjectsEngine.generateProgressInvoiceJournal({
      organization_id: 'org-1',
      legal_entity_id: 'le-1',
      period_id: 'per-2026-03',
      certificate_number: 'IPC-2026-001',
      project_code: 'PRJ-GULBERG',
      gross_amount: '1000000.00000000',
      retention_amount: '50000.00000000',
      net_amount: '950000.00000000',
      ar_account_id: 'acc-ar-112001',
      retention_receivable_account_id: 'acc-ret-112003',
      revenue_account_id: 'acc-rev-411003',
      user_id: 'user-admin',
    });

    expect(journalDraft.lines).toHaveLength(3);
    // Dr Trade AR: 950,000
    expect(journalDraft.lines[0].account_id).toBe('acc-ar-112001');
    expect(journalDraft.lines[0].debit_amount).toBe('950000.00000000');
    expect(journalDraft.lines[0].credit_amount).toBe('0.00000000');

    // Dr Retention Receivable: 50,000
    expect(journalDraft.lines[1].account_id).toBe('acc-ret-112003');
    expect(journalDraft.lines[1].debit_amount).toBe('50000.00000000');
    expect(journalDraft.lines[1].credit_amount).toBe('0.00000000');

    // Cr Milestone Revenue: 1,000,000
    expect(journalDraft.lines[2].account_id).toBe('acc-rev-411003');
    expect(journalDraft.lines[2].debit_amount).toBe('0.00000000');
    expect(journalDraft.lines[2].credit_amount).toBe('1000000.00000000');

    // Debit sum = 950,000 + 50,000 = 1,000,000 === Credit sum 1,000,000
    const totalDr = new Money(journalDraft.lines[0].debit_amount).add(new Money(journalDraft.lines[1].debit_amount));
    const totalCr = new Money(journalDraft.lines[2].credit_amount);
    expect(totalDr.format()).toBe(totalCr.format());
  });
});



