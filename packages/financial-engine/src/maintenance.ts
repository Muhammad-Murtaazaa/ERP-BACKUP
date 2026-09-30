import { Decimal } from 'decimal.js';
import { Money } from './money.js';
import {
  AccountingPurpose,
  CreateJournalDraftInput,
} from '@omnysync/contracts';

export interface MaintCostPartInput {
  quantity: string;
  unit_cost: string;
}

export interface MaintCostLaborInput {
  labor_hours: string;
  hourly_rate: string;
}

export interface WorkOrderCostingResult {
  total_parts_cost: string;
  total_labor_cost: string;
  total_cost: string;
}

export interface GenerateMaintenanceSettlementParams {
  organization_id: string;
  legal_entity_id: string;
  period_id: string;
  posting_date: string;
  work_order_number: string;
  equipment_code: string;
  equipment_name: string;
  total_parts_cost: string;
  total_labor_cost: string;
  maint_expense_account_id: string;
  spare_parts_inventory_account_id: string;
  labor_clearing_account_id: string;
}

export class MaintenanceEngine {
  /**
   * Calculates total maintenance work order costs (parts + labor) with exact decimal precision.
   */
  static calculateWorkOrderCost(
    parts: MaintCostPartInput[],
    labor: MaintCostLaborInput[]
  ): WorkOrderCostingResult {
    let totalParts = new Decimal('0.00');
    for (const p of parts) {
      const qty = new Decimal(p.quantity || '0');
      const unitCost = new Decimal(p.unit_cost || '0');
      totalParts = totalParts.plus(qty.mul(unitCost));
    }

    let totalLabor = new Decimal('0.00');
    for (const l of labor) {
      const hours = new Decimal(l.labor_hours || '0');
      const rate = new Decimal(l.hourly_rate || '0');
      totalLabor = totalLabor.plus(hours.mul(rate));
    }

    const totalCost = totalParts.plus(totalLabor);

    return {
      total_parts_cost: totalParts.toFixed(8),
      total_labor_cost: totalLabor.toFixed(8),
      total_cost: totalCost.toFixed(8),
    };
  }

  /**
   * Calculates next maintenance schedule due date based on last performed date and frequency interval in days.
   */
  static calculateNextDueDate(lastDateStr: string, intervalDays: number): string {
    const baseDate = new Date(lastDateStr);
    if (isNaN(baseDate.getTime())) {
      const now = new Date();
      now.setDate(now.getDate() + intervalDays);
      return now.toISOString().slice(0, 10);
    }

    baseDate.setDate(baseDate.getDate() + intervalDays);
    return baseDate.toISOString().slice(0, 10);
  }

  /**
   * Generates a balanced General Ledger journal entry for maintenance work order settlement:
   * Dr Equipment Maintenance Expense (521005) -> Total Cost
   * Cr Spare Parts Inventory (113002) -> Total Parts Cost
   * Cr Labor / Salaries Clearing (211004) -> Total Labor Cost
   */
  static generateSettlementJournal(
    params: GenerateMaintenanceSettlementParams
  ): CreateJournalDraftInput {
    const partsMoney = Money.from(params.total_parts_cost || '0.00');
    const laborMoney = Money.from(params.total_labor_cost || '0.00');
    const totalExpense = partsMoney.add(laborMoney);

    if (totalExpense.isZero() || totalExpense.isNegative()) {
      throw new Error('Total maintenance expense must be greater than zero for GL settlement');
    }

    let lineNumber = 1;
    const lines: any[] = [];

    // 1. Dr Maintenance Expense
    lines.push({
      line_number: lineNumber++,
      account_id: params.maint_expense_account_id,
      debit_amount: totalExpense.toFixed(8),
      credit_amount: '0.00000000',
      currency: 'PKR',
      fx_rate: '1.000000000000',
      base_debit: totalExpense.toFixed(8),
      base_credit: '0.00000000',
      description: `Equipment Maintenance & Repairs: WO ${params.work_order_number} (${params.equipment_code})`,
    });

    // 2. Cr Spare Parts Inventory
    if (!partsMoney.isZero()) {
      lines.push({
        line_number: lineNumber++,
        account_id: params.spare_parts_inventory_account_id,
        debit_amount: '0.00000000',
        credit_amount: partsMoney.toFixed(8),
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: partsMoney.toFixed(8),
        description: `Spare parts consumed for WO ${params.work_order_number} (${params.equipment_code})`,
      });
    }

    // 3. Cr Labor / Salaries Clearing
    if (!laborMoney.isZero()) {
      lines.push({
        line_number: lineNumber++,
        account_id: params.labor_clearing_account_id,
        debit_amount: '0.00000000',
        credit_amount: laborMoney.toFixed(8),
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: laborMoney.toFixed(8),
        description: `Technician labor applied for WO ${params.work_order_number} (${params.equipment_code})`,
      });
    }

    return {
      organization_id: params.organization_id,
      legal_entity_id: params.legal_entity_id,
      posting_date: params.posting_date,
      document_date: params.posting_date,
      journal_number: `JV-MAINT-${params.work_order_number}`,
      description: `Maintenance Settlement: WO ${params.work_order_number} - ${params.equipment_name}`,
      accounting_purpose: AccountingPurpose.MAINTENANCE_EXPENSE_SETTLEMENT,
      base_currency: 'PKR',
      lines,
    };
  }
}
