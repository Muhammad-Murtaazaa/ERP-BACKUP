import { Decimal } from 'decimal.js';
import { Money } from './money.js';
import {
  AccountingPurpose,
  CreateJournalDraftInput,
  POSPaymentMethod,
} from '@omnysync/contracts';

export interface CalculatedPOSOrder {
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  cash_tendered: string;
  change_due: string;
  lines: {
    item_id: string;
    item_code: string;
    item_name: string;
    quantity: string;
    unit_price: string;
    line_total: string;
    tax_amount: string;
  }[];
}

export interface ReconciledPOSSession {
  opening_float: string;
  cash_sales_total: string;
  card_sales_total: string;
  expected_cash_drawer: string;
  actual_cash_drawer: string;
  cash_difference: string;
}

export interface GeneratePOSSessionCloseParams {
  organization_id: string;
  legal_entity_id: string;
  period_id: string;
  posting_date: string;
  session_id: string;
  register_code: string;
  cash_sales: string;
  card_sales: string;
  tax_amount: string;
  cash_difference: string;
  cash_account_id: string;
  card_clearing_account_id: string;
  sales_account_id: string;
  tax_payable_account_id: string;
  cash_variance_expense_account_id: string;
}

export class POSEngine {
  /**
   * Calculates POS order lines, item totals, discounts, taxes, and change due.
   */
  static calculateOrder(
    items: {
      item_id: string;
      item_code: string;
      item_name: string;
      quantity: string;
      unit_price: string;
    }[],
    discountAmount: string = '0.00',
    taxPercentage: string = '0.00',
    cashTendered: string = '0.00'
  ): CalculatedPOSOrder {
    let subtotalDec = new Decimal('0.00');

    const calculatedLines = items.map((it) => {
      const qty = new Decimal(it.quantity || '1.0');
      const price = new Decimal(it.unit_price || '0.00');
      const lineTotal = qty.mul(price);
      subtotalDec = subtotalDec.plus(lineTotal);

      return {
        item_id: it.item_id,
        item_code: it.item_code,
        item_name: it.item_name,
        quantity: qty.toFixed(8),
        unit_price: price.toFixed(8),
        line_total: lineTotal.toFixed(8),
        tax_amount: '0.00000000',
      };
    });

    const discountDec = new Decimal(discountAmount || '0.00');
    const netSubtotal = subtotalDec.minus(discountDec);
    const taxPct = new Decimal(taxPercentage || '0.00');
    const taxAmtDec = netSubtotal.mul(taxPct.div(100));
    const totalAmtDec = netSubtotal.plus(taxAmtDec);

    const tenderedDec = new Decimal(cashTendered || '0.00');
    const changeDueDec = tenderedDec.greaterThan(totalAmtDec)
      ? tenderedDec.minus(totalAmtDec)
      : new Decimal('0.00');

    return {
      subtotal: subtotalDec.toFixed(8),
      discount_amount: discountDec.toFixed(8),
      tax_amount: taxAmtDec.toFixed(8),
      total_amount: totalAmtDec.toFixed(8),
      cash_tendered: tenderedDec.toFixed(8),
      change_due: changeDueDec.toFixed(8),
      lines: calculatedLines,
    };
  }

  /**
   * Reconciles POS cashier session drawer:
   * Expected = Opening Float + Cash Sales
   * Difference = Actual Cash - Expected Cash
   */
  static reconcileSession(
    openingFloat: string,
    cashSales: string,
    cardSales: string,
    actualCash: string
  ): ReconciledPOSSession {
    const floatDec = new Decimal(openingFloat || '0.00');
    const cashSalesDec = new Decimal(cashSales || '0.00');
    const cardSalesDec = new Decimal(cardSales || '0.00');
    const actualDec = new Decimal(actualCash || '0.00');

    const expectedCash = floatDec.plus(cashSalesDec);
    const difference = actualDec.minus(expectedCash);

    return {
      opening_float: floatDec.toFixed(8),
      cash_sales_total: cashSalesDec.toFixed(8),
      card_sales_total: cardSalesDec.toFixed(8),
      expected_cash_drawer: expectedCash.toFixed(8),
      actual_cash_drawer: actualDec.toFixed(8),
      cash_difference: difference.toFixed(8),
    };
  }

  /**
   * Generates a balanced General Ledger journal entry for POS session shift closing:
   * Dr Cash on Hand / Drawer (cash_account_id) -> Cash Sales
   * Dr Card Clearing / Operating Bank (card_clearing_account_id) -> Card Sales
   * Dr Cash Shortage (variance_expense_account_id) -> if cash shortage
   * Cr Cash Surplus (variance_expense_account_id / other income) -> if cash surplus
   * Cr Product Sales Revenue (sales_account_id) -> Net Sales
   * Cr Output Sales Tax Payable (tax_payable_account_id) -> Sales Tax Collected
   */
  static generateSessionClosingJournal(
    params: GeneratePOSSessionCloseParams
  ): CreateJournalDraftInput {
    const cashMoney = Money.from(params.cash_sales);
    const cardMoney = Money.from(params.card_sales);
    const taxMoney = Money.from(params.tax_amount);
    const diffDec = new Decimal(params.cash_difference || '0.00');

    const totalGross = cashMoney.add(cardMoney);
    const netSales = totalGross.sub(taxMoney);

    let lineNumber = 1;
    const lines: any[] = [];

    // 1. Dr Cash Account (actual cash collected from sales taking variance into account)
    const actualCashCollected = cashMoney.add(new Money(diffDec.toFixed(8)));
    if (!actualCashCollected.isZero()) {
      lines.push({
        line_number: lineNumber++,
        account_id: params.cash_account_id,
        debit_amount: actualCashCollected.toFixed(8),
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: actualCashCollected.toFixed(8),
        base_credit: '0.00000000',
        description: `POS Session Cash Sales: ${params.register_code}`,
      });
    }

    // 2. Dr Card Clearing Account
    if (!cardMoney.isZero()) {
      lines.push({
        line_number: lineNumber++,
        account_id: params.card_clearing_account_id,
        debit_amount: cardMoney.toFixed(8),
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: cardMoney.toFixed(8),
        base_credit: '0.00000000',
        description: `POS Session Card Sales: ${params.register_code}`,
      });
    }

    // 3. Cash Short / Over Variance
    if (diffDec.lessThan(0)) {
      // Shortage -> Debit expense
      const shortage = diffDec.abs().toFixed(8);
      lines.push({
        line_number: lineNumber++,
        account_id: params.cash_variance_expense_account_id,
        debit_amount: shortage,
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: shortage,
        base_credit: '0.00000000',
        description: `POS Cash Drawer Shortage: ${params.register_code}`,
      });
    } else if (diffDec.greaterThan(0)) {
      // Over / Surplus -> Credit income/variance
      const surplus = diffDec.toFixed(8);
      lines.push({
        line_number: lineNumber++,
        account_id: params.cash_variance_expense_account_id,
        debit_amount: '0.00000000',
        credit_amount: surplus,
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: surplus,
        description: `POS Cash Drawer Surplus: ${params.register_code}`,
      });
    }

    // 4. Cr Product Sales Revenue
    if (!netSales.isZero()) {
      lines.push({
        line_number: lineNumber++,
        account_id: params.sales_account_id,
        debit_amount: '0.00000000',
        credit_amount: netSales.toFixed(8),
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: netSales.toFixed(8),
        description: `POS Net Revenue: ${params.register_code}`,
      });
    }

    // 5. Cr Output Sales Tax Payable
    if (!taxMoney.isZero()) {
      lines.push({
        line_number: lineNumber++,
        account_id: params.tax_payable_account_id,
        debit_amount: '0.00000000',
        credit_amount: taxMoney.toFixed(8),
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: taxMoney.toFixed(8),
        description: `POS Output Sales Tax: ${params.register_code}`,
      });
    }

    return {
      organization_id: params.organization_id,
      legal_entity_id: params.legal_entity_id,
      posting_date: params.posting_date,
      document_date: params.posting_date,
      journal_number: `JV-POS-${params.register_code}-${Date.now().toString().slice(-4)}`,
      description: `POS Shift Close Settlement: ${params.register_code}`,
      accounting_purpose: AccountingPurpose.POS_SESSION_CLOSE,
      base_currency: 'PKR',
      lines,
    };
  }
}
