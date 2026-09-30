/**
 * Module manifest (MODULE-CATALOG.md, 33 modules) with honest capability readiness and
 * hard dependencies, plus the lifecycle guard used by module write endpoints.
 * Lifecycle: available -> enabled -> draining -> read_only -> disabled.
 *  - enabled: all commands allowed
 *  - draining: no new root records, existing work may complete (commands allowed)
 *  - read_only / disabled: historical reads only (reads are never blocked, legal access retained)
 */
import type { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@omnysync/contracts';
import type { DbClient } from '@omnysync/platform';
import { db } from '../context.js';

export type Readiness = 'planned' | 'implemented' | 'verified' | 'partial';
export interface ModuleManifest {
  code: string;
  name: string;
  depends: string[];
  readiness: Readiness;
  core?: boolean;
}

export const MODULES: ModuleManifest[] = [
  { code: 'PLT', name: 'Platform, security & audit', depends: [], readiness: 'verified', core: true },
  { code: 'ADM', name: 'Client administration', depends: ['PLT'], readiness: 'implemented', core: true },
  { code: 'CFG', name: 'Configuration & settings', depends: ['PLT'], readiness: 'implemented', core: true },
  { code: 'GL', name: 'General ledger', depends: ['PLT'], readiness: 'verified', core: true },
  { code: 'AR', name: 'Receivables & billing', depends: ['GL'], readiness: 'verified' },
  { code: 'AP', name: 'Payables & expenses', depends: ['GL'], readiness: 'verified' },
  { code: 'TRY', name: 'Treasury & bank', depends: ['GL'], readiness: 'verified' },
  { code: 'TAX', name: 'Tax compliance', depends: ['GL'], readiness: 'implemented' },
  { code: 'SAL', name: 'Sales orders', depends: ['AR'], readiness: 'verified' },
  { code: 'PUR', name: 'Procurement', depends: ['AP'], readiness: 'verified' },
  { code: 'INV', name: 'Inventory', depends: ['GL'], readiness: 'verified' },
  { code: 'WMS', name: 'Warehouse execution', depends: ['INV'], readiness: 'implemented' },
  { code: 'MFG', name: 'Manufacturing', depends: ['INV'], readiness: 'verified' },
  { code: 'QLT', name: 'Quality & PLM', depends: ['INV'], readiness: 'verified' },
  { code: 'AST', name: 'Assets & maintenance', depends: ['GL'], readiness: 'verified' },
  { code: 'PRJ', name: 'Projects & BOQ', depends: ['GL'], readiness: 'verified' },
  { code: 'HR', name: 'HR core', depends: ['PLT'], readiness: 'verified' },
  { code: 'PAY', name: 'Payroll & benefits', depends: ['HR', 'GL'], readiness: 'verified' },
  { code: 'POS', name: 'POS & retail', depends: ['INV', 'AR'], readiness: 'verified' },
  { code: 'AUT', name: 'Automation', depends: ['PLT'], readiness: 'implemented' },
  { code: 'SRV', name: 'Service & field operations', depends: ['SAL', 'INV', 'AR'], readiness: 'implemented' },
  { code: 'CRM', name: 'CRM', depends: ['PLT'], readiness: 'implemented' },
  { code: 'TIM', name: 'Time & workforce', depends: ['HR'], readiness: 'implemented' },
  { code: 'SUP', name: 'Supplier management', depends: ['PUR'], readiness: 'implemented' },
  { code: 'LOG', name: 'Logistics & trade', depends: ['SAL'], readiness: 'implemented' },
  { code: 'BI', name: 'Reporting & analytics', depends: ['PLT'], readiness: 'implemented' },
  { code: 'DOC', name: 'Documents & collaboration', depends: ['PLT'], readiness: 'implemented' },
  { code: 'FLT', name: 'Fleet & rental', depends: ['GL'], readiness: 'implemented' },
  { code: 'GRC', name: 'Governance, risk & compliance', depends: ['PLT'], readiness: 'implemented' },
  { code: 'LND', name: 'Lending & servicing', depends: ['GL'], readiness: 'implemented' },
  { code: 'EPM', name: 'Planning & budgeting', depends: ['GL'], readiness: 'implemented' },
  { code: 'TAL', name: 'Recruitment & talent', depends: ['HR'], readiness: 'implemented' },
  { code: 'COM', name: 'Subscription commerce', depends: ['AR'], readiness: 'implemented' },
];
export const MODULE_BY_CODE = new Map(MODULES.map((m) => [m.code, m]));

export async function moduleStates(q: DbClient, org: string): Promise<Map<string, string>> {
  const r = await q.query(`SELECT module_code, state FROM module_states WHERE organization_id = $1`, [org]);
  const m = new Map<string, string>(MODULES.map((x) => [x.code, 'enabled']));
  for (const row of r.rows) m.set(row.module_code, row.state);
  return m;
}

/** Pure lifecycle validation used by the admin endpoint and unit tests. */
export function validateModuleTransition(code: string, to: string, states: Map<string, string>): string | null {
  const m = MODULE_BY_CODE.get(code);
  if (!m) return `Unknown module ${code}`;
  const from = states.get(code) || 'enabled';
  const allowed: Record<string, string[]> = {
    available: ['enabled'],
    enabled: ['draining'],
    draining: ['enabled', 'read_only'],
    read_only: ['enabled', 'disabled'],
    disabled: ['enabled'],
  };
  if (!allowed[from]?.includes(to)) return `${code} cannot move from ${from} to ${to} (allowed: ${(allowed[from] || []).join(', ')})`;
  if (m.core && to !== 'enabled') return `${code} is a core module and cannot be disabled`;
  if (to === 'enabled') {
    const missing = m.depends.filter((d) => states.get(d) !== 'enabled');
    if (missing.length) return `Enable dependencies first: ${missing.join(', ')}`;
  } else {
    const dependents = MODULES.filter((x) => x.depends.includes(code) && (states.get(x.code) || 'enabled') === 'enabled').map((x) => x.code);
    if (dependents.length) return `Modules depending on ${code} are still enabled: ${dependents.join(', ')}`;
  }
  return null;
}

/** Express guard: blocks writes when the module is not enabled (draining allows commands, not creates). */
export function requireModule(code: string, kind: 'create' | 'command' = 'command') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = await db.query(`SELECT state FROM module_states WHERE organization_id = $1 AND module_code = $2`, [req.session!.organization_id, code]);
      const state = r.rows[0]?.state || 'enabled';
      if (state === 'enabled' || (state === 'draining' && kind === 'command')) return next();
      return res.status(409).json({
        success: false,
        error: { code: ErrorCode.MODULE_DISABLED, message: `Module ${code} is ${state}; ${state === 'draining' ? 'new records are blocked while it drains' : 'it is read-only'}`, correlation_id: req.correlationId },
      });
    } catch (e) {
      next(e);
    }
  };
}
