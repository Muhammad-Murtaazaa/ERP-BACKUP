import { Decimal } from 'decimal.js';
import { Money } from './money.js';
import {
  ProgressCertificate,
  ProgressCertificateItem,
  AccountingPurpose,
  CreateJournalDraftInput,
  BOQItem,
} from '@omnysync/contracts';

export interface CalculatedProgressCertificateItem {
  boq_item_id: string;
  previous_quantity: string;
  current_quantity: string;
  cumulative_quantity: string;
  unit_rate: string;
  current_amount: string;
}

export interface CalculatedProgressCertificate {
  gross_certified_amount: string;
  retention_amount: string;
  net_certified_amount: string;
  items: CalculatedProgressCertificateItem[];
}

export interface GenerateProgressInvoiceParams {
  organization_id: string;
  legal_entity_id: string;
  period_id: string;
  certificate_number: string;
  project_code: string;
  gross_amount: string;
  retention_amount: string;
  net_amount: string;
  ar_account_id: string;
  retention_receivable_account_id: string;
  revenue_account_id: string;
  cost_center_id?: string;
  user_id: string;
}

export class ProjectsEngine {
  /**
   * Calculates progress certificate items and total amounts.
   * Cumulative Qty = Previous Qty + Current Qty
   * Current Amount = Current Qty * Unit Rate
   * Gross Certified Amount = Sum(Current Amounts)
   * Retention Amount = Gross Certified Amount * (Retention % / 100)
   * Net Certified Amount = Gross Certified Amount - Retention Amount
   */
  static calculateProgressCertificate(
    items: {
      boq_item_id: string;
      previous_quantity: string;
      current_quantity: string;
      unit_rate: string;
    }[],
    retentionPercentage: string = '5.00'
  ): CalculatedProgressCertificate {
    let grossTotal = new Decimal('0.00');

    const calculatedItems: CalculatedProgressCertificateItem[] = items.map((item) => {
      const prevQty = new Decimal(item.previous_quantity || '0.00');
      const currQty = new Decimal(item.current_quantity || '0.00');
      const rate = new Decimal(item.unit_rate || '0.00');

      const cumulativeQty = prevQty.plus(currQty);
      const currentAmt = currQty.mul(rate);
      grossTotal = grossTotal.plus(currentAmt);

      return {
        boq_item_id: item.boq_item_id,
        previous_quantity: prevQty.toFixed(8),
        current_quantity: currQty.toFixed(8),
        cumulative_quantity: cumulativeQty.toFixed(8),
        unit_rate: rate.toFixed(8),
        current_amount: currentAmt.toFixed(8),
      };
    });

    const retentionPct = new Decimal(retentionPercentage || '0.00');
    const retentionAmt = grossTotal.mul(retentionPct.div(100));
    const netAmt = grossTotal.minus(retentionAmt);

    return {
      gross_certified_amount: grossTotal.toFixed(8),
      retention_amount: retentionAmt.toFixed(8),
      net_certified_amount: netAmt.toFixed(8),
      items: calculatedItems,
    };
  }

  /**
   * Validates if certifying quantities would exceed contract quantities.
   */
  static validateBoqQuantities(
    boqItems: BOQItem[],
    certifiedItems: { boq_item_id: string; current_quantity: string }[]
  ): { valid: boolean; exceededItemCode?: string; exceededQty?: string } {
    for (const cert of certifiedItems) {
      const boqItem = boqItems.find((b) => b.id === cert.boq_item_id);
      if (boqItem) {
        const contractQty = new Decimal(boqItem.contract_quantity);
        const alreadyCertified = new Decimal(boqItem.certified_quantity || '0.00');
        const currentQty = new Decimal(cert.current_quantity);
        const newTotal = alreadyCertified.plus(currentQty);

        if (newTotal.greaterThan(contractQty)) {
          return {
            valid: false,
            exceededItemCode: boqItem.item_code,
            exceededQty: newTotal.minus(contractQty).toFixed(8),
          };
        }
      }
    }
    return { valid: true };
  }

  /**
   * Generates a balanced General Ledger journal entry for Progress Billing / IPC Invoicing.
   * Dr Trade AR Control (112001) - Net Billable Amount
   * Dr Project Retention Receivable (112003) - Withheld Retention Amount
   * Cr Project Milestone & Contract Revenue (411003) - Gross Certified Amount
   * Net + Retention == Gross, guaranteeing exact zero-difference balance.
   */
  static generateProgressInvoiceJournal(
    params: GenerateProgressInvoiceParams
  ): CreateJournalDraftInput {
    const netMoney = Money.from(params.net_amount);
    const retentionMoney = Money.from(params.retention_amount);
    const grossMoney = Money.from(params.gross_amount);

    // Verify invariant: Net + Retention === Gross
    const sumDebits = netMoney.add(retentionMoney);
    if (!sumDebits.equals(grossMoney)) {
      throw new Error(
        `Invariant violation: Net (${netMoney.format()}) + Retention (${retentionMoney.format()}) does not equal Gross (${grossMoney.format()})`
      );
    }

    let lineNumber = 1;
    const lines: any[] = [
      {
        line_number: lineNumber++,
        account_id: params.ar_account_id,
        debit_amount: netMoney.toFixed(8),
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: netMoney.toFixed(8),
        base_credit: '0.00000000',
        description: `Progress billing ${params.certificate_number} (Net) - ${params.project_code}`,
      },
    ];

    if (!retentionMoney.isZero()) {
      lines.push({
        line_number: lineNumber++,
        account_id: params.retention_receivable_account_id,
        debit_amount: retentionMoney.toFixed(8),
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: retentionMoney.toFixed(8),
        base_credit: '0.00000000',
        description: `Progress billing ${params.certificate_number} (Retention Withheld) - ${params.project_code}`,
      });
    }

    lines.push({
      line_number: lineNumber++,
      account_id: params.revenue_account_id,
      debit_amount: '0.00000000',
      credit_amount: grossMoney.toFixed(8),
      currency: 'PKR',
      fx_rate: '1.000000000000',
      base_debit: '0.00000000',
      base_credit: grossMoney.toFixed(8),
      description: `Project milestone revenue ${params.certificate_number} (Gross) - ${params.project_code}`,
    });

    const today = new Date().toISOString().slice(0, 10);

    return {
      organization_id: params.organization_id,
      legal_entity_id: params.legal_entity_id,
      posting_date: today,
      document_date: today,
      journal_number: `JV-PRJ-IPC-${params.certificate_number}`,
      description: `Progress billing invoice for project ${params.project_code} (Certificate #${params.certificate_number})`,
      accounting_purpose: AccountingPurpose.PROJECT_PROGRESS_INVOICE,
      base_currency: 'PKR',
      lines,
    };
  }
}
