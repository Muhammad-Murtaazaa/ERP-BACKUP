import { Decimal } from 'decimal.js';
import { Money } from './money.js';
import {
  AccountingPurpose,
  CreateJournalDraftInput,
  InspectionLotStatus,
  ParamDataType,
  QualityInspectionResult,
} from '@omnysync/contracts';

export interface QualityParamSpec {
  param_name: string;
  data_type: ParamDataType;
  target_value?: string | null;
  min_tolerance?: string | null;
  max_tolerance?: string | null;
  is_mandatory: boolean;
}

export interface QualityMeasuredValue {
  param_name: string;
  measured_numeric_value?: string | null;
  measured_text_value?: string | null;
  inspector_notes?: string | null;
}

export interface LotEvaluationResult {
  overall_status: InspectionLotStatus;
  all_mandatory_passed: boolean;
  evaluated_results: QualityInspectionResult[];
}

export interface GenerateQualityScrapParams {
  organization_id: string;
  legal_entity_id: string;
  period_id: string;
  posting_date: string;
  ncr_number: string;
  item_code: string;
  item_name: string;
  quantity: string;
  unit_cost: string;
  scrap_expense_account_id: string;
  inventory_account_id: string;
}

export class QualityEngine {
  /**
   * Validates a single measured parameter against specification tolerances.
   */
  static validateParameter(
    spec: QualityParamSpec,
    measured: QualityMeasuredValue
  ): { is_pass: boolean; reason?: string } {
    if (spec.data_type === 'NUMERIC') {
      if (!measured.measured_numeric_value) {
        return { is_pass: !spec.is_mandatory, reason: 'Missing numeric measurement' };
      }

      const val = new Decimal(measured.measured_numeric_value);
      if (spec.min_tolerance !== null && spec.min_tolerance !== undefined) {
        const min = new Decimal(spec.min_tolerance);
        if (val.lessThan(min)) {
          return { is_pass: false, reason: `Value ${val.toString()} below minimum tolerance ${min.toString()}` };
        }
      }

      if (spec.max_tolerance !== null && spec.max_tolerance !== undefined) {
        const max = new Decimal(spec.max_tolerance);
        if (val.greaterThan(max)) {
          return { is_pass: false, reason: `Value ${val.toString()} exceeds maximum tolerance ${max.toString()}` };
        }
      }

      return { is_pass: true };
    }

    if (spec.data_type === 'BOOLEAN') {
      const val = (measured.measured_text_value || '').toLowerCase().trim();
      const isPass = val === 'true' || val === 'pass' || val === 'yes' || val === '1';
      return { is_pass: isPass };
    }

    // TEXT match
    if (spec.target_value && spec.target_value.trim()) {
      const isMatch = (measured.measured_text_value || '').trim().toLowerCase() === spec.target_value.trim().toLowerCase();
      return { is_pass: isMatch };
    }

    return { is_pass: (measured.measured_text_value || '').trim().length > 0 };
  }

  /**
   * Evaluates entire inspection lot measurements against quality inspection plan specifications.
   */
  static evaluateLot(
    specs: QualityParamSpec[],
    measurements: QualityMeasuredValue[]
  ): LotEvaluationResult {
    const specMap = new Map<string, QualityParamSpec>(specs.map((s) => [s.param_name, s]));
    const evaluated_results: QualityInspectionResult[] = [];
    let allMandatoryPassed = true;

    for (const meas of measurements) {
      const spec = specMap.get(meas.param_name);
      if (!spec) {
        evaluated_results.push({
          param_name: meas.param_name,
          measured_numeric_value: meas.measured_numeric_value || null,
          measured_text_value: meas.measured_text_value || null,
          is_pass: true,
          inspector_notes: meas.inspector_notes || null,
        });
        continue;
      }

      const evalRes = this.validateParameter(spec, meas);
      if (spec.is_mandatory && !evalRes.is_pass) {
        allMandatoryPassed = false;
      }

      evaluated_results.push({
        param_name: meas.param_name,
        measured_numeric_value: meas.measured_numeric_value || null,
        measured_text_value: meas.measured_text_value || null,
        is_pass: evalRes.is_pass,
        inspector_notes: meas.inspector_notes || evalRes.reason || null,
      });
    }

    // Check if any mandatory spec was omitted from measurements
    for (const spec of specs) {
      if (spec.is_mandatory && !measurements.some((m) => m.param_name === spec.param_name)) {
        allMandatoryPassed = false;
      }
    }

    return {
      overall_status: allMandatoryPassed ? 'ACCEPTED' : 'REJECTED',
      all_mandatory_passed: allMandatoryPassed,
      evaluated_results,
    };
  }

  /**
   * Generates a balanced General Ledger journal entry for defective stock scrap / write-off:
   * Dr Manufacturing Scrap & Variance (511003)
   * Cr Inventory Asset (113001/113002)
   */
  static generateScrapWriteOffJournal(
    params: GenerateQualityScrapParams
  ): CreateJournalDraftInput {
    const qtyMoney = Money.from(params.quantity);
    const costMoney = Money.from(params.unit_cost);
    const totalScrapValue = qtyMoney.mul(costMoney);

    if (totalScrapValue.isZero() || totalScrapValue.isNegative()) {
      throw new Error('Total scrap value must be greater than zero');
    }

    const lines: any[] = [
      {
        line_number: 1,
        account_id: params.scrap_expense_account_id,
        debit_amount: totalScrapValue.toFixed(8),
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: totalScrapValue.toFixed(8),
        base_credit: '0.00000000',
        description: `Quality Scrap Expense for NCR ${params.ncr_number} (${params.item_code})`,
      },
      {
        line_number: 2,
        account_id: params.inventory_account_id,
        debit_amount: '0.00000000',
        credit_amount: totalScrapValue.toFixed(8),
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: totalScrapValue.toFixed(8),
        description: `Inventory Derecognition for Defective Stock (${params.item_code} - ${params.item_name})`,
      },
    ];

    return {
      organization_id: params.organization_id,
      legal_entity_id: params.legal_entity_id,
      posting_date: params.posting_date,
      document_date: params.posting_date,
      journal_number: `JV-SCRAP-${params.ncr_number}`,
      description: `Defective Stock Scrap Write-Off: NCR ${params.ncr_number}`,
      accounting_purpose: AccountingPurpose.QUALITY_SCRAP_WRITEOFF,
      base_currency: 'PKR',
      lines,
    };
  }
}
