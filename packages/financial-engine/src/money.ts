import { Decimal } from 'decimal.js';

// Configure Decimal global precision and explicit rounding mode: HALF_UP
Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});

export const MONETARY_WORKING_SCALE = 8;
export const FX_RATE_SCALE = 12;
export const QUANTITY_SCALE = 8;

export class Money {
  private readonly val: Decimal;

  constructor(value: string | number | Decimal | Money) {
    if (value instanceof Money) {
      this.val = value.val;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value) || Number.isNaN(value)) {
        throw new Error(`Invalid numeric input for Money: ${value}`);
      }
      this.val = new Decimal(value.toString());
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error(`Invalid decimal string format for Money: "${value}"`);
      }
      this.val = new Decimal(trimmed);
    } else {
      this.val = new Decimal(value);
    }
  }

  static zero(): Money {
    return new Money('0');
  }

  static from(value: string | number | Decimal | Money): Money {
    return new Money(value);
  }

  static fromDecimal(value: Decimal): Money {
    return new Money(value);
  }

  toDecimal(): Decimal {
    return this.val;
  }

  add(other: Money | string | number): Money {
    const o = other instanceof Money ? other.val : new Money(other).val;
    return new Money(this.val.plus(o));
  }

  sub(other: Money | string | number): Money {
    const o = other instanceof Money ? other.val : new Money(other).val;
    return new Money(this.val.minus(o));
  }

  subtract(other: Money | string | number): Money {
    return this.sub(other);
  }

  mul(other: Money | string | number): Money {
    const o = other instanceof Money ? other.val : new Money(other).val;
    return new Money(this.val.times(o));
  }

  multiply(other: Money | string | number): Money {
    return this.mul(other);
  }

  div(other: Money | string | number): Money {
    const o = other instanceof Money ? other.val : new Money(other).val;
    if (o.isZero()) {
      throw new Error('Division by zero in monetary arithmetic');
    }
    return new Money(this.val.dividedBy(o));
  }

  abs(): Money {
    return new Money(this.val.abs());
  }

  negated(): Money {
    return new Money(this.val.negated());
  }

  isZero(): boolean {
    return this.val.isZero();
  }

  isPositive(): boolean {
    return this.val.isPositive() && !this.val.isZero();
  }

  isNegative(): boolean {
    return this.val.isNegative() && !this.val.isZero();
  }

  eq(other: Money | string | number): boolean {
    const o = other instanceof Money ? other.val : new Money(other).val;
    return this.val.equals(o);
  }

  equals(other: Money | string | number): boolean {
    return this.eq(other);
  }

  gt(other: Money | string | number): boolean {
    const o = other instanceof Money ? other.val : new Money(other).val;
    return this.val.greaterThan(o);
  }

  gte(other: Money | string | number): boolean {
    const o = other instanceof Money ? other.val : new Money(other).val;
    return this.val.greaterThanOrEqualTo(o);
  }

  lt(other: Money | string | number): boolean {
    const o = other instanceof Money ? other.val : new Money(other).val;
    return this.val.lessThan(o);
  }

  lte(other: Money | string | number): boolean {
    const o = other instanceof Money ? other.val : new Money(other).val;
    return this.val.lessThanOrEqualTo(o);
  }

  /**
   * Serializes to standard database NUMERIC string format with exact scale.
   */
  toFixed(scale: number = MONETARY_WORKING_SCALE): string {
    return this.val.toFixed(scale);
  }

  /**
   * Currency display format (e.g., 2 decimal places for PKR/USD).
   */
  toCurrencyDisplay(currencyScale: number = 2): string {
    return this.val.toFixed(currencyScale);
  }

  format(scale: number = 2): string {
    return this.val.toFixed(scale);
  }

  toString(): string {
    return this.val.toString();
  }
}

/**
 * Calculates sum of an array of money strings/instances.
 */
export function sumMoney(items: (Money | string | number)[]): Money {
  return items.reduce<Money>((acc, item) => acc.add(item), Money.zero());
}
