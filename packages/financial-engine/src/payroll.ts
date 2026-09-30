import { Decimal } from 'decimal.js';
import { Money } from './money.js';

export interface SalaryBreakdownInput {
  basic_salary: string;
  house_rent_allowance?: string;
  utility_allowance?: string;
  medical_allowance?: string;
  other_allowances?: string;
}

export interface EmployeePayrollCalculation {
  employee_id: string;
  basic_salary: string;
  allowances_total: string;
  gross_salary: string;
  tax_deduction: string;
  eobi_deduction: string;
  provident_fund_deduction: string;
  other_deductions: string;
  total_deductions: string;
  net_salary: string;
}

export interface PayrollRunTotals {
  total_gross: string;
  total_tax: string;
  total_eobi: string;
  total_provident_fund: string;
  total_other_deductions: string;
  total_deductions: string;
  total_net: string;
}

export class PayrollEngine {
  /**
   * Computes gross salary from basic pay and allowances using exact decimal arithmetic.
   */
  static computeGross(input: SalaryBreakdownInput): {
    basic: Money;
    allowances: Money;
    gross: Money;
  } {
    const basic = new Money(input.basic_salary || '0');
    const hra = new Money(input.house_rent_allowance || '0');
    const util = new Money(input.utility_allowance || '0');
    const med = new Money(input.medical_allowance || '0');
    const other = new Money(input.other_allowances || '0');

    const allowances = hra.add(util).add(med).add(other);
    const gross = basic.add(allowances);

    return { basic, allowances, gross };
  }

  /**
   * Computes progressive statutory withholding income tax based on annual taxable estimation.
   * ILLUSTRATIVE slab table (not a qualified statutory rule — AGENTS.md rule 13 and
   * LOCALIZATION.md require source, effective date and reviewer sign-off before any
   * live use). Slabs:
   * 0 - 600,000: 0%
   * 600,001 - 1,200,000: 5% of amount exceeding 600,000
   * 1,200,001 - 2,400,000: 30,000 + 15% of amount exceeding 1,200,000
   * 2,400,001 - 3,600,000: 210,000 + 25% of amount exceeding 2,400,000
   * > 3,600,000: 510,000 + 35% of amount exceeding 3,600,000
   */
  static computeMonthlyTax(monthlyGross: Money): Money {
    const annualGross = monthlyGross.multiply(12);
    const annualDec = annualGross.toDecimal();

    let annualTaxDec = new Decimal(0);

    if (annualDec.lte(600000)) {
      annualTaxDec = new Decimal(0);
    } else if (annualDec.lte(1200000)) {
      annualTaxDec = annualDec.minus(600000).times('0.05');
    } else if (annualDec.lte(2400000)) {
      annualTaxDec = new Decimal(30000).plus(annualDec.minus(1200000).times('0.15'));
    } else if (annualDec.lte(3600000)) {
      annualTaxDec = new Decimal(210000).plus(annualDec.minus(2400000).times('0.25'));
    } else {
      annualTaxDec = new Decimal(510000).plus(annualDec.minus(3600000).times('0.35'));
    }

    const monthlyTaxDec = annualTaxDec.dividedBy(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return Money.fromDecimal(monthlyTaxDec);
  }

  /**
   * Computes statutory EOBI / Social Security employee contribution.
   * Standard flat minimum contribution = PKR 300.00 / month.
   */
  static computeEobi(basic: Money): Money {
    if (basic.toDecimal().isZero()) {
      return Money.zero();
    }
    return new Money('300.00');
  }

  /**
   * Computes full employee net payroll breakdown.
   */
  static computeEmployeePayroll(
    employeeId: string,
    breakdown: SalaryBreakdownInput,
    customDeductions?: { provident_fund?: string; other?: string },
  ): EmployeePayrollCalculation {
    const { basic, allowances, gross } = this.computeGross(breakdown);
    const tax = this.computeMonthlyTax(gross);
    const eobi = this.computeEobi(basic);
    const pf = new Money(customDeductions?.provident_fund || '0');
    const other = new Money(customDeductions?.other || '0');

    if (gross.isNegative() || pf.isNegative() || other.isNegative()) {
      throw new Error(`Payroll inputs cannot be negative for employee ${employeeId}`);
    }
    const totalDeductions = tax.add(eobi).add(pf).add(other);
    const net = gross.subtract(totalDeductions);
    if (net.isNegative()) {
      // Deductions exceeding gross would create a negative payable; it must be
      // resolved as an explicit recovery, not a negative net salary line.
      throw new Error(
        `Deductions (${totalDeductions.format()}) exceed gross pay (${gross.format()}) for employee ${employeeId}`,
      );
    }

    return {
      employee_id: employeeId,
      basic_salary: basic.format(),
      allowances_total: allowances.format(),
      gross_salary: gross.format(),
      tax_deduction: tax.format(),
      eobi_deduction: eobi.format(),
      provident_fund_deduction: pf.format(),
      other_deductions: other.format(),
      total_deductions: totalDeductions.format(),
      net_salary: net.format(),
    };
  }

  /**
   * Aggregates employee items and verifies double-entry integrity.
   */
  static aggregatePayrollRun(items: EmployeePayrollCalculation[]): PayrollRunTotals {
    let gross = Money.zero();
    let tax = Money.zero();
    let eobi = Money.zero();
    let pf = Money.zero();
    let other = Money.zero();
    let totalDed = Money.zero();
    let net = Money.zero();

    for (const it of items) {
      gross = gross.add(new Money(it.gross_salary));
      tax = tax.add(new Money(it.tax_deduction));
      eobi = eobi.add(new Money(it.eobi_deduction));
      pf = pf.add(new Money(it.provident_fund_deduction));
      other = other.add(new Money(it.other_deductions));
      totalDed = totalDed.add(new Money(it.total_deductions));
      net = net.add(new Money(it.net_salary));
    }

    // Invariant check: Gross must equal Deductions + Net
    const balancedSum = totalDed.add(net);
    if (!gross.equals(balancedSum)) {
      throw new Error(`Payroll calculation unbalanced: Gross ${gross.format()} != Total Deductions ${totalDed.format()} + Net ${net.format()}`);
    }

    return {
      total_gross: gross.format(),
      total_tax: tax.format(),
      total_eobi: eobi.format(),
      total_provident_fund: pf.format(),
      total_other_deductions: other.format(),
      total_deductions: totalDed.format(),
      total_net: net.format(),
    };
  }

  /**
   * Generates double-entry General Ledger journal lines for posting a payroll run:
   * Dr Salaries & Wages Expense (521002) : Total Gross
   * Cr Withholding Tax Payable (212002)  : Total Tax
   * Cr EOBI Payable (212003)             : Total EOBI
   * Cr Provident Fund Payable (212004)    : Total Provident Fund
   * Cr Salaries Payable (211004)         : Total Net
   */
  static generatePayrollJournalLines(params: {
    totals: PayrollRunTotals;
    salariesExpenseAccountId: string;
    taxPayableAccountId: string;
    eobiPayableAccountId: string;
    providentFundPayableAccountId?: string;
    otherDeductionsPayableAccountId?: string;
    salariesPayableAccountId: string;
    currency?: string;
  }): {
    line_number: number;
    account_id: string;
    debit_amount: string;
    credit_amount: string;
    base_debit: string;
    base_credit: string;
    description: string;
  }[] {
    const currency = params.currency || 'PKR';
    const lines = [];
    let lineNo = 1;

    // Line 1: Debit Gross Salaries Expense
    lines.push({
      line_number: lineNo++,
      account_id: params.salariesExpenseAccountId,
      debit_amount: params.totals.total_gross,
      credit_amount: '0.00',
      base_debit: params.totals.total_gross,
      base_credit: '0.00',
      description: `Payroll gross salary expense (${currency})`,
    });

    // Line 2: Credit Tax Withholding (if > 0)
    if (new Money(params.totals.total_tax).toDecimal().gt(0)) {
      lines.push({
        line_number: lineNo++,
        account_id: params.taxPayableAccountId,
        debit_amount: '0.00',
        credit_amount: params.totals.total_tax,
        base_debit: '0.00',
        base_credit: params.totals.total_tax,
        description: 'Statutory employee income tax withholding',
      });
    }

    // Line 3: Credit EOBI / Pension (if > 0)
    if (new Money(params.totals.total_eobi).toDecimal().gt(0)) {
      lines.push({
        line_number: lineNo++,
        account_id: params.eobiPayableAccountId,
        debit_amount: '0.00',
        credit_amount: params.totals.total_eobi,
        base_debit: '0.00',
        base_credit: params.totals.total_eobi,
        description: 'Statutory EOBI / Social security payable',
      });
    }

    // Line 4: Credit Provident Fund (if > 0). A missing PF account previously
    // dropped the credit silently and produced an unbalanced voucher.
    const pfTotal = new Money(params.totals.total_provident_fund || '0');
    if (pfTotal.isPositive() && !params.providentFundPayableAccountId) {
      throw new Error('Provident fund deductions exist but no provident fund payable account is mapped');
    }
    if (params.providentFundPayableAccountId && pfTotal.isPositive()) {
      lines.push({
        line_number: lineNo++,
        account_id: params.providentFundPayableAccountId,
        debit_amount: '0.00',
        credit_amount: params.totals.total_provident_fund,
        base_debit: '0.00',
        base_credit: params.totals.total_provident_fund,
        description: 'Employee provident fund payable',
      });
    }

    // Line 5: Credit Other Deductions Payable (previously never credited -> unbalanced)
    const otherTotal = new Money(params.totals.total_other_deductions || '0');
    if (otherTotal.isPositive()) {
      if (!params.otherDeductionsPayableAccountId) {
        throw new Error('Other payroll deductions exist but no deductions payable account is mapped');
      }
      lines.push({
        line_number: lineNo++,
        account_id: params.otherDeductionsPayableAccountId,
        debit_amount: '0.00',
        credit_amount: params.totals.total_other_deductions,
        base_debit: '0.00',
        base_credit: params.totals.total_other_deductions,
        description: 'Other employee deductions payable',
      });
    }

    // Line 6: Credit Net Salaries Payable
    lines.push({
      line_number: lineNo++,
      account_id: params.salariesPayableAccountId,
      debit_amount: '0.00',
      credit_amount: params.totals.total_net,
      base_debit: '0.00',
      base_credit: params.totals.total_net,
      description: 'Employee net salaries payable clearing',
    });

    return lines;
  }

  /**
   * Generates double-entry General Ledger journal lines for bank disbursement:
   * Dr Salaries Payable (211004) : Total Net
   * Cr Operating Bank Account (111002) : Total Net
   */
  static generateDisbursementJournalLines(params: {
    totalNet: string;
    salariesPayableAccountId: string;
    bankAccountId: string;
    currency?: string;
  }): {
    line_number: number;
    account_id: string;
    debit_amount: string;
    credit_amount: string;
    base_debit: string;
    base_credit: string;
    description: string;
  }[] {
    const currency = params.currency || 'PKR';
    return [
      {
        line_number: 1,
        account_id: params.salariesPayableAccountId,
        debit_amount: params.totalNet,
        credit_amount: '0.00',
        base_debit: params.totalNet,
        base_credit: '0.00',
        description: `Disbursement clearing for net salaries (${currency})`,
      },
      {
        line_number: 2,
        account_id: params.bankAccountId,
        debit_amount: '0.00',
        credit_amount: params.totalNet,
        base_debit: '0.00',
        base_credit: params.totalNet,
        description: `Bank transfer payment for net salaries (${currency})`,
      },
    ];
  }
}
