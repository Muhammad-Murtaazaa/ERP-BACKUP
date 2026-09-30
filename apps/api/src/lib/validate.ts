import { validationError } from './errors.js';

/**
 * Boundary validators. Money/quantity values stay exact decimal strings end-to-end
 * (AGENTS.md rule 1); these helpers only normalise and reject — they never round.
 */

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DecimalSign = 'any' | 'nonNegative' | 'positive';

export interface DecimalOptions {
  sign?: DecimalSign;
  /** Maximum fractional digits accepted (default 8 = NUMERIC(24,8)). */
  scale?: number;
  /** Maximum integer digits (default 16 = NUMERIC(24,8)). */
  integerDigits?: number;
  required?: boolean;
  defaultValue?: string;
}

function toDecimalText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const text = String(value);
    // Exponent notation (1e21, 1e-7) is never accepted for money input.
    if (/e/i.test(text)) return null;
    return text;
  }
  return null;
}

export function decimal(value: unknown, field: string, opts: DecimalOptions = {}): string {
  const { sign = 'nonNegative', scale = 8, integerDigits = 16, required = true, defaultValue } = opts;
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    if (!required) return '0';
    throw validationError(`${field} is required`, { field });
  }
  const text = toDecimalText(value);
  if (text === null || !DECIMAL_RE.test(text)) {
    throw validationError(`${field} must be an exact decimal string (e.g. "1250.50")`, { field, value });
  }
  const [intPartRaw, frac = ''] = text.replace('-', '').split('.');
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '');
  if (frac.length > scale) {
    throw validationError(`${field} supports at most ${scale} decimal places`, { field, value });
  }
  if (intPart.length > integerDigits) {
    throw validationError(`${field} exceeds the supported magnitude`, { field, value });
  }
  const isZero = /^0*$/.test(intPart + frac);
  const negative = text.startsWith('-') && !isZero;
  if (sign === 'nonNegative' && negative) {
    throw validationError(`${field} cannot be negative`, { field, value });
  }
  if (sign === 'positive' && (negative || isZero)) {
    throw validationError(`${field} must be greater than zero`, { field, value });
  }
  return isZero ? '0' : text;
}

export function optionalDecimal(value: unknown, field: string, opts: Omit<DecimalOptions, 'required'> = {}): string | null {
  if (value === undefined || value === null || value === '') return null;
  return decimal(value, field, opts);
}

/** Date-only business date (YYYY-MM-DD) validated against the calendar. */
export function dateOnly(value: unknown, field: string, opts: { required?: boolean; defaultValue?: string } = {}): string {
  const { required = true, defaultValue } = opts;
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    if (!required) return '';
    throw validationError(`${field} is required`, { field });
  }
  if (typeof value !== 'string') throw validationError(`${field} must be a date string YYYY-MM-DD`, { field });
  const m = DATE_RE.exec(value.trim().slice(0, 10));
  if (!m || value.trim().length !== 10) throw validationError(`${field} must be a date string YYYY-MM-DD`, { field, value });
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2999) {
    throw validationError(`${field} is not a valid calendar date`, { field, value });
  }
  return value.trim();
}

export function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return dateOnly(value, field);
}

export function str(
  value: unknown,
  field: string,
  opts: { required?: boolean; max?: number; min?: number; pattern?: RegExp } = {},
): string {
  const { required = true, max = 255, min = 1, pattern } = opts;
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (!required) return '';
    throw validationError(`${field} is required`, { field });
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw validationError(`${field} must be text`, { field });
  }
  const text = String(value).trim();
  if (text.length < min) throw validationError(`${field} must be at least ${min} characters`, { field });
  if (text.length > max) throw validationError(`${field} must be at most ${max} characters`, { field });
  if (pattern && !pattern.test(text)) throw validationError(`${field} has an invalid format`, { field });
  return text;
}

export function optionalStr(value: unknown, field: string, max = 2000): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  return str(value, field, { max });
}

export function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[], defaultValue?: T): T {
  if ((value === undefined || value === null || value === '') && defaultValue !== undefined) return defaultValue;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw validationError(`${field} must be one of: ${allowed.join(', ')}`, { field, value });
  }
  return value as T;
}

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw validationError(`${field} must be a valid identifier`, { field });
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuid(value, field);
}

export function arrayOf<T = any>(value: unknown, field: string, opts: { min?: number; max?: number } = {}): T[] {
  const { min = 1, max = 500 } = opts;
  if (!Array.isArray(value)) throw validationError(`${field} must be a list`, { field });
  if (value.length < min) throw validationError(`${field} requires at least ${min} entr${min === 1 ? 'y' : 'ies'}`, { field });
  if (value.length > max) throw validationError(`${field} allows at most ${max} entries`, { field });
  return value as T[];
}

export function int(value: unknown, field: string, opts: { min?: number; max?: number; defaultValue?: number } = {}): number {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, defaultValue } = opts;
  if ((value === undefined || value === null || value === '') && defaultValue !== undefined) return defaultValue;
  const n = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw validationError(`${field} must be a whole number`, { field });
  if (n < min || n > max) throw validationError(`${field} must be between ${min} and ${max}`, { field });
  return n;
}

export function bool(value: unknown, defaultValue = false): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw validationError('Expected a boolean value');
}

/** Pagination with hard upper bound (MODULE-CONTRACT: filter limits). */
export function pagination(query: Record<string, unknown>, defaults = { limit: 100, max: 500 }) {
  const limit = int(query.limit, 'limit', { min: 1, max: defaults.max, defaultValue: defaults.limit });
  const offset = int(query.offset, 'offset', { min: 0, max: 1_000_000, defaultValue: 0 });
  return { limit, offset };
}

export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalises a DB DATE value to YYYY-MM-DD. PGlite parses DATE as UTC midnight,
 * so UTC getters are used to avoid shifting the business date by the host TZ.
 */
export function toIsoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}
