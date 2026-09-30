import { Decimal } from 'decimal.js';
import { Money } from './money.js';
import {
  AccountingPurpose,
  CreateJournalDraftInput,
  DepreciationMethod,
} from '@omnysync/contracts';

export interface DepreciationCalculationResult {
  depreciation_amount: string;
  accumulated_depreciation_after: string;
  book_value_after: string;
}

export interface GenerateAssetDepreciationParams {
  organization_id: string;
  legal_entity_id: string;
  period_id: string;
  posting_date: string;
  asset_number: string;
  asset_name: string;
  depreciation_amount: string;
  expense_account_id: string;
  accumulated_account_id: string;
}

export interface GenerateAssetDisposalParams {
  organization_id: string;
  legal_entity_id: string;
  period_id: string;
  posting_date: string;
  asset_number: string;
  asset_name: string;
  acquisition_cost: string;
  accumulated_depreciation: string;
  proceeds: string;
  asset_cost_account_id: string;
  accumulated_deprec_account_id: string;
  bank_account_id: string;
  gain_account_id: string;
  loss_account_id: string;
}

export class FixedAssetsEngine {
  /**
   * Calculates monthly or periodic depreciation based on straight-line or declining balance method.
   */
  static calculateDepreciation(
    cost: string,
    currentAccumulatedDeprec: string,
    salvageValue: string,
    usefulLifeMonths: number,
    depreciationMethod: DepreciationMethod = 'STRAIGHT_LINE',
    periodMonths: number = 1
  ): DepreciationCalculationResult {
    const costDec = new Decimal(cost);
    const accumDec = new Decimal(currentAccumulatedDeprec || '0.00');
    const salvageDec = new Decimal(salvageValue || '0.00');
    const currentBookValue = costDec.minus(accumDec);

    if (currentBookValue.lessThanOrEqualTo(salvageDec)) {
      return {
        depreciation_amount: '0.00000000',
        accumulated_depreciation_after: accumDec.toFixed(8),
        book_value_after: currentBookValue.toFixed(8),
      };
    }

    let deprecAmountDec = new Decimal('0.00');

    if (depreciationMethod === 'STRAIGHT_LINE') {
      const depreciableBase = costDec.minus(salvageDec);
      const monthlyRate = depreciableBase.div(usefulLifeMonths);
      deprecAmountDec = monthlyRate.mul(periodMonths);
    } else if (depreciationMethod === 'DECLINING_BALANCE') {
      // Double declining balance: (2 / usefulLifeYears) * bookValue
      const usefulLifeYears = new Decimal(usefulLifeMonths).div(12);
      const annualRate = new Decimal(2).div(usefulLifeYears);
      const monthlyRate = annualRate.div(12);
      deprecAmountDec = currentBookValue.mul(monthlyRate).mul(periodMonths);
    } else {
      // Fallback to straight-line
      const depreciableBase = costDec.minus(salvageDec);
      const monthlyRate = depreciableBase.div(usefulLifeMonths);
      deprecAmountDec = monthlyRate.mul(periodMonths);
    }

    // Do not depreciate below salvage value
    const maxDeprec = currentBookValue.minus(salvageDec);
    if (deprecAmountDec.greaterThan(maxDeprec)) {
      deprecAmountDec = maxDeprec;
    }

    const newAccum = accumDec.plus(deprecAmountDec);
    const newBookValue = costDec.minus(newAccum);

    return {
      depreciation_amount: deprecAmountDec.toFixed(8),
      accumulated_depreciation_after: newAccum.toFixed(8),
      book_value_after: newBookValue.toFixed(8),
    };
  }

  /**
   * Generates a balanced General Ledger journal entry for fixed asset periodic depreciation:
   * Dr Depreciation Expense (521004)
   * Cr Accumulated Depreciation (121002)
   */
  static generateDepreciationJournal(
    params: GenerateAssetDepreciationParams
  ): CreateJournalDraftInput {
    const amountMoney = Money.from(params.depreciation_amount);
    if (amountMoney.isZero() || amountMoney.isNegative()) {
      throw new Error('Depreciation amount must be greater than zero');
    }

    const lines: any[] = [
      {
        line_number: 1,
        account_id: params.expense_account_id,
        debit_amount: amountMoney.toFixed(8),
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: amountMoney.toFixed(8),
        base_credit: '0.00000000',
        description: `Depreciation expense for ${params.asset_number} (${params.asset_name})`,
      },
      {
        line_number: 2,
        account_id: params.accumulated_account_id,
        debit_amount: '0.00000000',
        credit_amount: amountMoney.toFixed(8),
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: amountMoney.toFixed(8),
        description: `Accumulated depreciation for ${params.asset_number} (${params.asset_name})`,
      },
    ];

    return {
      organization_id: params.organization_id,
      legal_entity_id: params.legal_entity_id,
      posting_date: params.posting_date,
      document_date: params.posting_date,
      journal_number: `JV-DEP-${params.asset_number}`,
      description: `Periodic depreciation for asset ${params.asset_number} - ${params.asset_name}`,
      accounting_purpose: AccountingPurpose.FIXED_ASSET_DEPRECIATION,
      base_currency: 'PKR',
      lines,
    };
  }

  /**
   * Generates a balanced General Ledger journal entry for fixed asset disposal / retirement:
   * Dr Operating Bank (Proceeds from sale)
   * Dr Accumulated Depreciation (Clear accumulated depreciation)
   * Dr Loss on Disposal (if Net Book Value > Proceeds)
   * Cr Fixed Asset Cost (Derecognize gross asset cost)
   * Cr Gain on Disposal (if Proceeds > Net Book Value)
   */
  static generateDisposalJournal(
    params: GenerateAssetDisposalParams
  ): CreateJournalDraftInput {
    const costMoney = Money.from(params.acquisition_cost);
    const accumMoney = Money.from(params.accumulated_depreciation);
    const proceedsMoney = Money.from(params.proceeds || '0.00');

    const netBookValue = costMoney.sub(accumMoney);

    let lineNumber = 1;
    const lines: any[] = [];

    // 1. Dr Bank for Proceeds
    if (!proceedsMoney.isZero()) {
      lines.push({
        line_number: lineNumber++,
        account_id: params.bank_account_id,
        debit_amount: proceedsMoney.toFixed(8),
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: proceedsMoney.toFixed(8),
        base_credit: '0.00000000',
        description: `Disposal proceeds for ${params.asset_number}`,
      });
    }

    // 2. Dr Accumulated Depreciation to clear balance
    if (!accumMoney.isZero()) {
      lines.push({
        line_number: lineNumber++,
        account_id: params.accumulated_deprec_account_id,
        debit_amount: accumMoney.toFixed(8),
        credit_amount: '0.00000000',
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: accumMoney.toFixed(8),
        base_credit: '0.00000000',
        description: `Accumulated depreciation clearance for ${params.asset_number}`,
      });
    }

    // 3. Compare Proceeds with Net Book Value
    if (proceedsMoney.gt(netBookValue)) {
      // Gain on disposal
      const gain = proceedsMoney.sub(netBookValue);
      lines.push({
        line_number: lineNumber++,
        account_id: params.asset_cost_account_id,
        debit_amount: '0.00000000',
        credit_amount: costMoney.toFixed(8),
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: costMoney.toFixed(8),
        description: `Derecognition of asset cost for ${params.asset_number}`,
      });
      lines.push({
        line_number: lineNumber++,
        account_id: params.gain_account_id,
        debit_amount: '0.00000000',
        credit_amount: gain.toFixed(8),
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: gain.toFixed(8),
        description: `Gain on disposal for ${params.asset_number}`,
      });
    } else {
      // Loss on disposal (or break-even)
      const loss = netBookValue.sub(proceedsMoney);
      if (!loss.isZero()) {
        lines.push({
          line_number: lineNumber++,
          account_id: params.loss_account_id,
          debit_amount: loss.toFixed(8),
          credit_amount: '0.00000000',
          currency: 'PKR',
          fx_rate: '1.000000000000',
          base_debit: loss.toFixed(8),
          base_credit: '0.00000000',
          description: `Loss on disposal / write-off for ${params.asset_number}`,
        });
      }
      lines.push({
        line_number: lineNumber++,
        account_id: params.asset_cost_account_id,
        debit_amount: '0.00000000',
        credit_amount: costMoney.toFixed(8),
        currency: 'PKR',
        fx_rate: '1.000000000000',
        base_debit: '0.00000000',
        base_credit: costMoney.toFixed(8),
        description: `Derecognition of asset cost for ${params.asset_number}`,
      });
    }

    return {
      organization_id: params.organization_id,
      legal_entity_id: params.legal_entity_id,
      posting_date: params.posting_date,
      document_date: params.posting_date,
      journal_number: `JV-DISP-${params.asset_number}`,
      description: `Disposal & Derecognition of asset ${params.asset_number} - ${params.asset_name}`,
      accounting_purpose: AccountingPurpose.FIXED_ASSET_DISPOSAL,
      base_currency: 'PKR',
      lines,
    };
  }
}
