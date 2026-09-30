import { Money } from './money.js';
import { Decimal } from 'decimal.js';

export interface FxConversionResult {
  foreignAmount: string;
  fxRate: string;
  baseAmount: string;
  currency: string;
  baseCurrency: string;
}

export interface RealizedFxGainLossResult {
  originalBaseAmount: string;
  settledBaseAmount: string;
  gainLossAmount: string;
  isGain: boolean;
  isLoss: boolean;
  isZero: boolean;
}

export class FxEngine {
  /**
   * Converts a foreign currency amount to base currency using exact decimal calculation (24,12 rate scale).
   */
  static convertToBase(params: {
    amount: string;
    fxRate: string;
    currency: string;
    baseCurrency?: string;
  }): FxConversionResult {
    const foreignAmt = new Money(params.amount);
    const rateDec = new Decimal(params.fxRate);

    // base = foreign * fxRate
    const baseDec = foreignAmt.toDecimal().mul(rateDec);
    const baseAmt = Money.fromDecimal(baseDec);

    return {
      foreignAmount: foreignAmt.toFixed(2),
      fxRate: rateDec.toFixed(12),
      baseAmount: baseAmt.toFixed(2),
      currency: params.currency,
      baseCurrency: params.baseCurrency || 'PKR',
    };
  }

  /**
   * Computes realized FX gain or loss on settlement of an open invoice/bill.
   * For AR:
   *   Gain = (Settlement Rate - Invoice Rate) * Foreign Amount
   * For AP:
   *   Gain = (Bill Rate - Settlement Rate) * Foreign Amount
   */
  static computeRealizedGainLoss(params: {
    foreignAmount: string;
    originalFxRate: string;
    settlementFxRate: string;
    transactionType: 'AR' | 'AP';
  }): RealizedFxGainLossResult {
    const amt = new Decimal(params.foreignAmount);
    const origRate = new Decimal(params.originalFxRate);
    const settleRate = new Decimal(params.settlementFxRate);

    const origBase = amt.mul(origRate);
    const settleBase = amt.mul(settleRate);

    let diff: Decimal;
    if (params.transactionType === 'AR') {
      // Customer pays: if settleRate > origRate, we get more base currency => Gain
      diff = settleBase.sub(origBase);
    } else {
      // We pay vendor: if settleRate < origRate, we pay less base currency => Gain
      diff = origBase.sub(settleBase);
    }

    return {
      originalBaseAmount: Money.fromDecimal(origBase).toFixed(2),
      settledBaseAmount: Money.fromDecimal(settleBase).toFixed(2),
      gainLossAmount: Money.fromDecimal(diff.abs()).toFixed(2),
      isGain: diff.isPositive() && !diff.isZero(),
      isLoss: diff.isNegative(),
      isZero: diff.isZero(),
    };
  }
}
