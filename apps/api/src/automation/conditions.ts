/**
 * Typed condition evaluation for event-triggered rules (no code execution, no eval).
 * Fields are dotted paths into the event payload; numeric comparisons use exact decimals.
 */
import { Money } from '@omnysync/financial-engine';

export const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'exists', 'not_exists'] as const;
export type Operator = (typeof OPERATORS)[number];
export interface Condition {
  field: string;
  op: Operator;
  value?: unknown;
}
export type ActionSpec =
  | { type: 'ALERT'; severity?: 'INFO' | 'WARNING' | 'CRITICAL'; title: string; body?: string; assigned_role?: string }
  | { type: 'TASK'; title: string; body?: string; assigned_role?: string; due_in_days?: number };

const DEC = /^-?\d+(\.\d+)?$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,4}$/;

export function getPath(obj: any, path: string): unknown {
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function cmp(a: unknown, b: unknown): number | null {
  const as = String(a ?? '');
  const bs = String(b ?? '');
  if (DEC.test(as) && DEC.test(bs)) return new Money(as).toDecimal().comparedTo(new Money(bs).toDecimal());
  if (/^\d{4}-\d{2}-\d{2}/.test(as) && /^\d{4}-\d{2}-\d{2}/.test(bs)) return as < bs ? -1 : as > bs ? 1 : 0;
  return null;
}

export function evaluate(cond: Condition, payload: any): boolean {
  const v = getPath(payload, cond.field);
  switch (cond.op) {
    case 'exists':
      return v !== undefined && v !== null && v !== '';
    case 'not_exists':
      return v === undefined || v === null || v === '';
    case 'eq':
      return cmp(v, cond.value) === 0 || String(v ?? '') === String(cond.value ?? '');
    case 'neq':
      return !(cmp(v, cond.value) === 0 || String(v ?? '') === String(cond.value ?? ''));
    case 'contains':
      return String(v ?? '').toLowerCase().includes(String(cond.value ?? '').toLowerCase());
    case 'in':
      return (Array.isArray(cond.value) ? cond.value : String(cond.value ?? '').split(',')).map((x) => String(x).trim()).includes(String(v ?? ''));
    default: {
      const c = cmp(v, cond.value);
      if (c === null) return false;
      return cond.op === 'gt' ? c > 0 : cond.op === 'gte' ? c >= 0 : cond.op === 'lt' ? c < 0 : c <= 0;
    }
  }
}

export const matchesAll = (conds: Condition[], payload: any) => conds.every((c) => evaluate(c, payload));

/** Validates a rule definition; returns a list of human-readable problems. */
export function validateDefinition(def: { event_type?: unknown; conditions?: unknown; actions?: unknown }): string[] {
  const errs: string[] = [];
  if (typeof def.event_type !== 'string' || !/^[A-Z][A-Z0-9_]{2,79}$/.test(def.event_type)) errs.push('Trigger event type is required (e.g. SERVICE_CASE_CREATED)');
  const conds = Array.isArray(def.conditions) ? def.conditions : null;
  if (!conds) errs.push('Conditions must be a list');
  else if (conds.length > 10) errs.push('At most 10 conditions');
  else
    conds.forEach((c: any, i) => {
      if (!c || typeof c.field !== 'string' || !FIELD.test(c.field)) errs.push(`Condition ${i + 1}: field must be a payload path`);
      if (!OPERATORS.includes(c?.op)) errs.push(`Condition ${i + 1}: unknown operator`);
      if (['gt', 'gte', 'lt', 'lte'].includes(c?.op) && !(DEC.test(String(c.value ?? '')) || /^\d{4}-\d{2}-\d{2}$/.test(String(c.value ?? '')))) errs.push(`Condition ${i + 1}: comparison needs a number or date`);
    });
  const acts = Array.isArray(def.actions) ? def.actions : null;
  if (!acts || acts.length === 0) errs.push('At least one action is required');
  else if (acts.length > 5) errs.push('At most 5 actions');
  else
    acts.forEach((a: any, i) => {
      if (!a || !['ALERT', 'TASK'].includes(a.type)) errs.push(`Action ${i + 1}: only ALERT and TASK actions are allowed (financial actions are never automated from events)`);
      if (!a?.title || String(a.title).length > 200) errs.push(`Action ${i + 1}: title is required (max 200)`);
      if (a?.type === 'ALERT' && a.severity && !['INFO', 'WARNING', 'CRITICAL'].includes(a.severity)) errs.push(`Action ${i + 1}: bad severity`);
      if (a?.type === 'TASK' && a.due_in_days !== undefined && !(Number.isInteger(a.due_in_days) && a.due_in_days >= 0 && a.due_in_days <= 365)) errs.push(`Action ${i + 1}: due_in_days 0-365`);
    });
  return errs;
}

/** Replaces {{path}} tokens with payload values (plain text, length bounded). */
export function renderTemplate(tpl: string, payload: any): string {
  return String(tpl)
    .replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, p) => {
      const v = getPath(payload, p);
      return v === undefined || v === null ? '' : String(v);
    })
    .slice(0, 1000);
}
