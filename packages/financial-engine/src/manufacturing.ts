import { Decimal } from 'decimal.js';
import { Money } from './money.js';
import {
  BillOfMaterials,
  BOMItem,
  WorkOrder,
  WorkOrderConsumption,
  AccountingPurpose,
  CreateJournalDraftInput,
} from '@omnysync/contracts';

export interface BOMRequirement {
  component_item_id: string;
  required_qty: string;
  scrap_percentage: string;
  estimated_unit_cost: string;
  estimated_total_cost: string;
}

export interface WorkOrderSummary {
  work_order_id: string;
  target_qty: string;
  completed_qty: string;
  scrapped_qty: string;
  total_material_cost: string;
  finished_unit_cost: string;
}

export class ManufacturingEngine {
  /**
   * Explodes a Bill of Materials for a specific target production quantity.
   * Calculates required raw material quantities accounting for yield and scrap percentages.
   */
  static explodeBOM(
    bom: BillOfMaterials,
    targetQty: string,
    componentCosts: Record<string, string> = {}
  ): BOMRequirement[] {
    const target = new Decimal(targetQty);
    const yieldQty = new Decimal(bom.yield_quantity || '1.0');
    if (yieldQty.isZero()) {
      throw new Error('BOM yield quantity cannot be zero');
    }

    const multiplier = target.div(yieldQty);

    return (bom.items || []).map((item) => {
      const baseQty = new Decimal(item.quantity);
      const scrapPct = new Decimal(item.scrap_percentage || '0.00');
      // required_qty = baseQty * multiplier * (1 + scrapPct / 100)
      const rawRequired = baseQty.mul(multiplier);
      const scrapMultiplier = new Decimal(1).plus(scrapPct.div(100));
      const finalRequired = rawRequired.mul(scrapMultiplier);

      const unitCost = new Decimal(componentCosts[item.component_item_id] || '0.00');
      const totalCost = finalRequired.mul(unitCost);

      return {
        component_item_id: item.component_item_id,
        required_qty: finalRequired.toFixed(8),
        scrap_percentage: item.scrap_percentage || '0.00',
        estimated_unit_cost: unitCost.toFixed(8),
        estimated_total_cost: totalCost.toFixed(8),
      };
    });
  }

  /**
   * Calculates total actual cost and per-unit finished goods cost from recorded consumptions.
   */
  static calculateWorkOrderCost(
    consumptions: WorkOrderConsumption[],
    completedQty: string,
    scrappedQty: string = '0'
  ): {
    total_material_cost: string;
    finished_goods_cost: string;
    scrap_cost: string;
    finished_unit_cost: string;
  } {
    let totalMaterialCost = new Decimal(0);

    for (const c of consumptions) {
      const lineCost = new Decimal(c.total_cost || new Decimal(c.consumed_qty).mul(new Decimal(c.unit_cost)).toFixed(8));
      totalMaterialCost = totalMaterialCost.plus(lineCost);
    }

    const completed = new Decimal(completedQty);
    const scrapped = new Decimal(scrappedQty);
    const totalUnits = completed.plus(scrapped);

    if (totalUnits.isZero()) {
      return {
        total_material_cost: totalMaterialCost.toFixed(8),
        finished_goods_cost: '0.00000000',
        scrap_cost: '0.00000000',
        finished_unit_cost: '0.00000000',
      };
    }

    // Allocate material cost proportionally between completed goods and scrapped units
    const unitCost = totalMaterialCost.div(totalUnits);
    const finishedGoodsCost = unitCost.mul(completed);
    const scrapCost = totalMaterialCost.minus(finishedGoodsCost);

    return {
      total_material_cost: totalMaterialCost.toFixed(8),
      finished_goods_cost: finishedGoodsCost.toFixed(8),
      scrap_cost: scrapCost.toFixed(8),
      finished_unit_cost: completed.isPositive() && !completed.isZero()
        ? finishedGoodsCost.div(completed).toFixed(8)
        : '0.00000000',
    };
  }

  /**
   * Generates a balanced General Ledger journal for finished goods completion from WIP:
   * Dr Finished Goods Inventory (113004)
   * Dr Manufacturing Scrap Expense (511003) [if any scrap]
   * Cr Work In Progress Inventory (113003)
   */
  static generateCompletionJournal(params: {
    workOrder: WorkOrder;
    organizationId: string;
    legalEntityId: string;
    finishedGoodsAccountId: string;
    wipAccountId: string;
    scrapExpenseAccountId: string;
    postingDate: string;
    documentDate: string;
    consumptions: WorkOrderConsumption[];
    baseCurrency?: string;
  }): CreateJournalDraftInput {
    const {
      workOrder,
      organizationId,
      legalEntityId,
      finishedGoodsAccountId,
      wipAccountId,
      scrapExpenseAccountId,
      postingDate,
      documentDate,
      consumptions,
      baseCurrency = 'PKR',
    } = params;

    const costs = this.calculateWorkOrderCost(
      consumptions,
      workOrder.completed_qty,
      workOrder.scrapped_qty
    );

    const totalCostDec = new Decimal(costs.total_material_cost);
    if (totalCostDec.isZero()) {
      throw new Error('Cannot generate completion journal for zero material cost');
    }

    const lines: any[] = [];
    let lineNumber = 1;

    // 1. Dr Finished Goods Inventory
    const finishedGoodsDec = new Decimal(costs.finished_goods_cost);
    if (finishedGoodsDec.greaterThan(0)) {
      lines.push({
        line_number: lineNumber++,
        account_id: finishedGoodsAccountId,
        debit_amount: finishedGoodsDec.toFixed(8),
        credit_amount: '0.00000000',
        currency: baseCurrency,
        fx_rate: '1.000000000000',
        base_debit: finishedGoodsDec.toFixed(8),
        base_credit: '0.00000000',
        description: `Production Completion: ${workOrder.work_order_number} (${workOrder.completed_qty} units completed)`,
      });
    }

    // 2. Dr Scrap Expense (if any)
    const scrapDec = new Decimal(costs.scrap_cost);
    if (scrapDec.greaterThan(0)) {
      lines.push({
        line_number: lineNumber++,
        account_id: scrapExpenseAccountId,
        debit_amount: scrapDec.toFixed(8),
        credit_amount: '0.00000000',
        currency: baseCurrency,
        fx_rate: '1.000000000000',
        base_debit: scrapDec.toFixed(8),
        base_credit: '0.00000000',
        description: `Manufacturing Scrap: ${workOrder.work_order_number} (${workOrder.scrapped_qty} units scrapped)`,
      });
    }

    // 3. Cr Work in Progress (WIP)
    lines.push({
      line_number: lineNumber++,
      account_id: wipAccountId,
      debit_amount: '0.00000000',
      credit_amount: totalCostDec.toFixed(8),
      currency: baseCurrency,
      fx_rate: '1.000000000000',
      base_debit: '0.00000000',
      base_credit: totalCostDec.toFixed(8),
      description: `WIP Settlement for WO: ${workOrder.work_order_number}`,
    });

    return {
      organization_id: organizationId,
      legal_entity_id: legalEntityId,
      posting_date: postingDate,
      document_date: documentDate,
      accounting_purpose: AccountingPurpose.MANUFACTURING_ASSEMBLY_RECEIPT,
      description: `Assembly Production & WIP Settlement: ${workOrder.work_order_number}`,
      base_currency: baseCurrency,
      lines,
    };
  }
}
