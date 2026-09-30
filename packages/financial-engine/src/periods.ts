import { PeriodStatus } from '@omnysync/contracts';

export interface FiscalPeriod {
  id: string;
  organization_id: string;
  legal_entity_id: string;
  fiscal_year: number;
  period_number: number;
  period_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  status: PeriodStatus;
}

export class PeriodManager {
  static formatDateString(dateVal: string | Date): string {
    if (dateVal instanceof Date) {
      return dateVal.toISOString().slice(0, 10);
    }
    return String(dateVal).trim().slice(0, 10);
  }

  /**
   * Finds the fiscal period corresponding to a specific business posting date.
   */
  static findPeriodForDate(periods: FiscalPeriod[], dateVal: string | Date): FiscalPeriod | null {
    const target = this.formatDateString(dateVal);
    for (const p of periods) {
      const pStart = this.formatDateString(p.start_date);
      const pEnd = this.formatDateString(p.end_date);
      if (target >= pStart && target <= pEnd) {
        return p;
      }
    }
    return null;
  }

  /**
   * Asserts whether a transaction is allowed to post into the given period.
   * - OPEN: Posting permitted
   * - SOFT_CLOSED: Normal posting forbidden (only special period-closing adjustments with elevated permission)
   * - HARD_CLOSED: Strictly forbidden to all users
   */
  static assertPostingAllowed(
    period: FiscalPeriod | null,
    dateStr: string,
    isClosingAdjustment: boolean = false,
  ): { allowed: boolean; error?: string } {
    if (!period) {
      return {
        allowed: false,
        error: `No defined fiscal period found for business posting date ${dateStr}`,
      };
    }

    if (period.status === PeriodStatus.HARD_CLOSED) {
      return {
        allowed: false,
        error: `Posting rejected: Fiscal period ${period.period_name} (${period.start_date} to ${period.end_date}) is HARD_CLOSED`,
      };
    }

    if (period.status === PeriodStatus.SOFT_CLOSED && !isClosingAdjustment) {
      return {
        allowed: false,
        error: `Posting rejected: Fiscal period ${period.period_name} is SOFT_CLOSED. Only authorized closing adjustments are permitted`,
      };
    }

    return { allowed: true };
  }
}
