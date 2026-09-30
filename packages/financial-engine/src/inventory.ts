import { Decimal } from 'decimal.js';
import {
  InventoryCount,
  InventoryCountItem,
  AccountingPurpose,
  CreateJournalDraftInput,
} from '@omnysync/contracts';

export class InventoryReconciliationEngine {
  /**
   * Calculates item-level and aggregate variance value for an inventory count.
   */
  static calculateVariances(
    items: Array<{
      item_id: string;
      system_qty: string;
      counted_qty: string;
      unit_cost: string;
      lot_id?: string | null;
    }>
  ): {
    items: Array<{
      item_id: string;
      system_qty: string;
      counted_qty: string;
      variance_qty: string;
      unit_cost: string;
      variance_value: string;
      lot_id?: string | null;
    }>;
    total_variance_value: string;
  } {
    let totalVarianceVal = new Decimal(0);

    const calculatedItems = items.map((item) => {
      const sysQty = new Decimal(item.system_qty || '0');
      const cntQty = new Decimal(item.counted_qty || '0');
      const cost = new Decimal(item.unit_cost || '0');

      const varQty = cntQty.minus(sysQty);
      const varVal = varQty.mul(cost);

      totalVarianceVal = totalVarianceVal.plus(varVal);

      return {
        item_id: item.item_id,
        system_qty: sysQty.toFixed(8),
        counted_qty: cntQty.toFixed(8),
        variance_qty: varQty.toFixed(8),
        unit_cost: cost.toFixed(8),
        variance_value: varVal.toFixed(8),
        lot_id: item.lot_id || null,
      };
    });

    return {
      items: calculatedItems,
      total_variance_value: totalVarianceVal.toFixed(8),
    };
  }

  /**
   * Generates a balanced General Ledger journal for physical count variances:
   * Case 1: Net Shortage / Shrinkage (Variance Value < 0)
   *   Dr Inventory Adjustments & Shrinkage (511002)
   *   Cr Trading Inventory Asset (113001)
   * 
   * Case 2: Net Surplus (Variance Value > 0)
   *   Dr Trading Inventory Asset (113001)
   *   Cr Inventory Adjustments & Shrinkage (511002)
   */
  static generateAdjustmentJournal(params: {
    inventoryCount: InventoryCount;
    organizationId: string;
    legalEntityId: string;
    inventoryAccountId: string;
    adjustmentExpenseAccountId: string;
    postingDate: string;
    documentDate: string;
    baseCurrency?: string;
  }): CreateJournalDraftInput {
    const {
      inventoryCount,
      organizationId,
      legalEntityId,
      inventoryAccountId,
      adjustmentExpenseAccountId,
      postingDate,
      documentDate,
      baseCurrency = 'PKR',
    } = params;

    const totalVarianceDec = new Decimal(inventoryCount.total_variance_value);
    if (totalVarianceDec.isZero()) {
      throw new Error('Cannot generate adjustment journal for zero variance');
    }

    const absAmount = totalVarianceDec.abs().toFixed(8);
    const lines: any[] = [];

    if (totalVarianceDec.isNegative()) {
      // Shortage / Shrinkage
      // 1. Dr Expense
      lines.push({
        line_number: 1,
        account_id: adjustmentExpenseAccountId,
        debit_amount: absAmount,
        credit_amount: '0.00000000',
        currency: baseCurrency,
        fx_rate: '1.000000000000',
        base_debit: absAmount,
        base_credit: '0.00000000',
        description: `Inventory Shrinkage/Loss: Physical Count ${inventoryCount.count_number}`,
      });
      // 2. Cr Asset
      lines.push({
        line_number: 2,
        account_id: inventoryAccountId,
        debit_amount: '0.00000000',
        credit_amount: absAmount,
        currency: baseCurrency,
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: absAmount,
        description: `Inventory Reduction: Physical Count ${inventoryCount.count_number}`,
      });
    } else {
      // Surplus / Gain
      // 1. Dr Asset
      lines.push({
        line_number: 1,
        account_id: inventoryAccountId,
        debit_amount: absAmount,
        credit_amount: '0.00000000',
        currency: baseCurrency,
        fx_rate: '1.000000000000',
        base_debit: absAmount,
        base_credit: '0.00000000',
        description: `Inventory Surplus/Found: Physical Count ${inventoryCount.count_number}`,
      });
      // 2. Cr Expense (Offset)
      lines.push({
        line_number: 2,
        account_id: adjustmentExpenseAccountId,
        debit_amount: '0.00000000',
        credit_amount: absAmount,
        currency: baseCurrency,
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: absAmount,
        description: `Inventory Gain: Physical Count ${inventoryCount.count_number}`,
      });
    }

    return {
      organization_id: organizationId,
      legal_entity_id: legalEntityId,
      posting_date: postingDate,
      document_date: documentDate,
      accounting_purpose: AccountingPurpose.INVENTORY_ADJUSTMENT,
      description: `Physical Count Adjustment: ${inventoryCount.count_number}`,
      base_currency: baseCurrency,
      lines,
    };
  }
}
