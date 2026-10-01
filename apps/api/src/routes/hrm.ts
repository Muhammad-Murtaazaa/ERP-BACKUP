import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { Money, PayrollEngine } from '@omnysync/financial-engine';
import { AccountingPurpose, ErrorCode, Permission } from '@omnysync/contracts';
import { db, auditLogger, outboxService, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError, sodViolation } from '../lib/errors.js';
import { dateOnly, decimal, oneOf, optionalStr, optionalUuid, str, toIsoDate, bool } from '../lib/validate.js';
import { assertOrgRef, requireOrgRow } from '../lib/scope.js';
import { transition } from '../lib/state.js';
import { postJournal } from '../lib/posting.js';
import { nextDocumentNumber } from '../lib/numbering.js';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;
const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'] as const;

/** Masks all but the last 4 characters of sensitive identifiers. */
export function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value);
  if (v.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`;
}

function canSeeSensitive(req: Request) {
  const p = req.session!.permissions;
  return p.includes(Permission.HRM_MANAGE) || p.includes(Permission.PAYROLL_MANAGE);
}

async function loadPayrollInputs(legalEntityId: string, organizationId: string) {
  const employeesRes = await db.query(
    `SELECT e.id as employee_id, e.employee_number, e.first_name, e.last_name,
            ss.basic_salary, ss.house_rent_allowance, ss.utility_allowance, ss.medical_allowance, ss.other_allowances
     FROM employees e
     JOIN employee_salary_assignments esa ON esa.employee_id = e.id AND esa.is_current = true
     JOIN salary_structures ss ON ss.id = esa.salary_structure_id
     WHERE e.legal_entity_id = $1 AND e.organization_id = $2 AND e.status = 'ACTIVE'
     ORDER BY e.employee_number ASC`,
    [legalEntityId, organizationId],
  );
  if (employeesRes.rows.length === 0) {
    throw validationError('No active employees with assigned salary structures found');
  }
  const items = employeesRes.rows.map((emp: any) => {
    let calc;
    try {
      calc = PayrollEngine.computeEmployeePayroll(emp.employee_id, {
        basic_salary: emp.basic_salary,
        house_rent_allowance: emp.house_rent_allowance,
        utility_allowance: emp.utility_allowance,
        medical_allowance: emp.medical_allowance,
        other_allowances: emp.other_allowances,
      });
    } catch (err: any) {
      throw validationError(err.message);
    }
    return { ...calc, employee_number: emp.employee_number, employee_name: `${emp.first_name} ${emp.last_name}`, payment_status: 'PENDING' };
  });
  return { items, totals: PayrollEngine.aggregatePayrollRun(items) };
}

async function requirePayrollPeriod(periodId: string, monthYear: string, organizationId: string) {
  const period = await requireOrgRow(db, 'fiscal_periods', periodId, organizationId, 'Fiscal period');
  const start = toIsoDate(period.start_date);
  if (start.slice(0, 7) !== monthYear) {
    throw validationError(`month_year ${monthYear} does not match fiscal period ${period.period_name} (${start.slice(0, 7)})`, {
      field: 'month_year',
    });
  }
  return period;
}

export function registerHrmRoutes(app: Express): void {
  // 17. Workforce & Human Resources (M4)
  const hrRead = requireAnyPermission(Permission.HRM_MANAGE, Permission.PAYROLL_MANAGE, Permission.FINANCE_REPORTS_VIEW);

  app.get('/api/hrm/departments', authenticate, hrRead, async (req: Request, res: Response) => {
    const result = await db.query(`SELECT * FROM departments WHERE organization_id = $1 AND legal_entity_id = $2 ORDER BY code ASC`, [
      req.session!.organization_id,
      req.session!.legal_entity_id,
    ]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/departments', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const code = str(req.body?.code, 'code', { max: 32 });
    const name = str(req.body?.name, 'name', { max: 255 });
    const cost_center_code = optionalStr(req.body?.cost_center_code, 'cost_center_code', 64);
    const deptId = crypto.randomUUID();
    await db.query(
      `INSERT INTO departments (id, organization_id, legal_entity_id, code, name, cost_center_code, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [deptId, req.session!.organization_id, req.session!.legal_entity_id, code, name, cost_center_code],
    );
    const dept = (await db.query(`SELECT * FROM departments WHERE id = $1`, [deptId])).rows[0];
    return ok(req, res, dept, 201);
  });

  app.get('/api/hrm/designations', authenticate, hrRead, async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT d.*, dept.name as department_name
       FROM designations d LEFT JOIN departments dept ON dept.id = d.department_id
       WHERE d.organization_id = $1 AND d.legal_entity_id = $2 ORDER BY d.code ASC`,
      [req.session!.organization_id, req.session!.legal_entity_id],
    );
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/designations', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const code = str(req.body?.code, 'code', { max: 32 });
    const title = str(req.body?.title, 'title', { max: 255 });
    const department_id = optionalUuid(req.body?.department_id, 'department_id');
    await assertOrgRef(db, 'departments', department_id, req.session!.organization_id, 'department_id');
    const desigId = crypto.randomUUID();
    await db.query(
      `INSERT INTO designations (id, organization_id, legal_entity_id, code, title, department_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [desigId, req.session!.organization_id, req.session!.legal_entity_id, code, title, department_id],
    );
    const desig = (await db.query(`SELECT * FROM designations WHERE id = $1`, [desigId])).rows[0];
    return ok(req, res, desig, 201);
  });

  app.get('/api/hrm/salary-structures', authenticate, requireAnyPermission(Permission.HRM_MANAGE, Permission.PAYROLL_MANAGE), async (req: Request, res: Response) => {
    const result = await db.query(`SELECT * FROM salary_structures WHERE organization_id = $1 AND legal_entity_id = $2 ORDER BY name ASC`, [
      req.session!.organization_id,
      req.session!.legal_entity_id,
    ]);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/salary-structures', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const b = req.body || {};
    const name = str(b.name, 'name', { max: 255 });
    const currency = optionalStr(b.currency, 'currency', 3) || 'PKR';
    const basic_salary = decimal(b.basic_salary, 'basic_salary', { sign: 'positive', scale: 2 });
    const house_rent_allowance = decimal(b.house_rent_allowance, 'house_rent_allowance', { required: false, scale: 2 });
    const utility_allowance = decimal(b.utility_allowance, 'utility_allowance', { required: false, scale: 2 });
    const medical_allowance = decimal(b.medical_allowance, 'medical_allowance', { required: false, scale: 2 });
    const other_allowances = decimal(b.other_allowances, 'other_allowances', { required: false, scale: 2 });
    const { gross } = PayrollEngine.computeGross({ basic_salary, house_rent_allowance, utility_allowance, medical_allowance, other_allowances });

    const structId = crypto.randomUUID();
    await db.query(
      `INSERT INTO salary_structures (
        id, organization_id, legal_entity_id, name, currency,
        basic_salary, house_rent_allowance, utility_allowance, medical_allowance, other_allowances, gross_salary, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
      [
        structId,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        name,
        currency,
        new Money(basic_salary).format(),
        new Money(house_rent_allowance).format(),
        new Money(utility_allowance).format(),
        new Money(medical_allowance).format(),
        new Money(other_allowances).format(),
        gross.format(),
      ],
    );
    const struct = (await db.query(`SELECT * FROM salary_structures WHERE id = $1`, [structId])).rows[0];
    return ok(req, res, struct, 201);
  });

  app.get('/api/hrm/employees', authenticate, hrRead, async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT e.*, dept.name as department_name, desig.title as designation_title,
              ss.id as salary_structure_id, ss.name as salary_structure_name, ss.basic_salary, ss.gross_salary
       FROM employees e
       LEFT JOIN departments dept ON dept.id = e.department_id
       LEFT JOIN designations desig ON desig.id = e.designation_id
       LEFT JOIN employee_salary_assignments esa ON esa.employee_id = e.id AND esa.is_current = true
       LEFT JOIN salary_structures ss ON ss.id = esa.salary_structure_id
       WHERE e.organization_id = $1 AND e.legal_entity_id = $2
       ORDER BY e.employee_number ASC`,
      [req.session!.organization_id, req.session!.legal_entity_id],
    );
    // Sensitive compensation, bank and identity fields are only returned to HR/payroll
    // roles; other readers get masked values (UX-SCREEN-SPECS §8, SECURITY.md).
    const sensitive = canSeeSensitive(req);
    const formatted = result.rows.map((r: any) => ({
      id: r.id,
      organization_id: r.organization_id,
      legal_entity_id: r.legal_entity_id,
      employee_number: r.employee_number,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      phone: r.phone,
      national_id: sensitive ? r.national_id : mask(r.national_id),
      department_id: r.department_id,
      department_name: r.department_name,
      designation_id: r.designation_id,
      designation_title: r.designation_title,
      employment_type: r.employment_type,
      joining_date: r.joining_date,
      status: r.status,
      bank_name: r.bank_name,
      bank_account_number: sensitive ? r.bank_account_number : mask(r.bank_account_number),
      salary_structure: r.salary_structure_id
        ? {
            id: r.salary_structure_id,
            name: r.salary_structure_name,
            basic_salary: sensitive ? r.basic_salary : null,
            gross_salary: sensitive ? r.gross_salary : null,
          }
        : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    return ok(req, res, formatted, 200, { total_count: formatted.length, sensitive_fields: sensitive ? 'visible' : 'masked' });
  });

  app.post('/api/hrm/employees', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const b = req.body || {};
    const org = req.session!.organization_id;
    const joining_date = dateOnly(b.joining_date, 'joining_date');
    const first_name = str(b.first_name, 'first_name', { max: 100 });
    const last_name = str(b.last_name, 'last_name', { max: 100 });
    const email = optionalStr(b.email, 'email', 255);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validationError('email is not valid', { field: 'email' });
    const department_id = optionalUuid(b.department_id, 'department_id');
    const designation_id = optionalUuid(b.designation_id, 'designation_id');
    const salary_structure_id = optionalUuid(b.salary_structure_id, 'salary_structure_id');
    await assertOrgRef(db, 'departments', department_id, org, 'department_id');
    await assertOrgRef(db, 'designations', designation_id, org, 'designation_id');
    await assertOrgRef(db, 'salary_structures', salary_structure_id, org, 'salary_structure_id');
    const employment_type = oneOf(b.employment_type, 'employment_type', EMPLOYMENT_TYPES, 'FULL_TIME');

    const empId = crypto.randomUUID();
    const emp = await db.transaction(async (tx) => {
      // Auto-numbering when the employee number is not supplied.
      const employee_number = optionalStr(b.employee_number, 'employee_number', 32) || (await nextDocumentNumber(tx, org, 'EMP', joining_date, 4));
      await tx.query(
        `INSERT INTO employees (
          id, organization_id, legal_entity_id, employee_number, first_name, last_name,
          email, phone, national_id, department_id, designation_id, employment_type, joining_date,
          status, bank_name, bank_account_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ACTIVE', $14, $15)`,
        [
          empId,
          org,
          req.session!.legal_entity_id,
          employee_number,
          first_name,
          last_name,
          email,
          optionalStr(b.phone, 'phone', 32),
          optionalStr(b.national_id, 'national_id', 32),
          department_id,
          designation_id,
          employment_type,
          joining_date,
          optionalStr(b.bank_name, 'bank_name', 100),
          optionalStr(b.bank_account_number, 'bank_account_number', 64),
        ],
      );
      if (salary_structure_id) {
        await tx.query(
          `INSERT INTO employee_salary_assignments (id, employee_id, salary_structure_id, effective_from, is_current)
           VALUES ($1, $2, $3, $4, true)`,
          [crypto.randomUUID(), empId, salary_structure_id, joining_date],
        );
      }
      // Audit without sensitive payload (AGENTS.md: never log payroll/bank details).
      await auditLogger.record(
        {
          organization_id: org,
          user_id: req.session!.user_id,
          action: 'EMPLOYEE_CREATED',
          entity_type: 'EMPLOYEE',
          entity_id: empId,
          after_state: { employee_number, department_id, designation_id, employment_type, joining_date },
          correlation_id: req.correlationId,
        },
        tx,
      );
      return (await tx.query(`SELECT * FROM employees WHERE id = $1`, [empId])).rows[0];
    });
    return ok(req, res, emp, 201);
  });

  /** Employment status change (effective-dated evidence in the audit trail). */
  app.post('/api/hrm/employees/:id/status', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const status = oneOf(req.body?.status, 'status', EMPLOYEE_STATUSES);
    const effective_date = dateOnly(req.body?.effective_date, 'effective_date');
    const reason = str(req.body?.reason, 'reason', { max: 500 });
    const out = await db.transaction(async (tx) => {
      const emp = await requireOrgRow(tx, 'employees', req.params.id, req.session!.organization_id, 'Employee', { forUpdate: true });
      if (emp.status === 'TERMINATED') throw new ApiError(409, ErrorCode.INVALID_STATE, 'Terminated employees must be rehired as a new employment record');
      await tx.query('UPDATE employees SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [status, emp.id]);
      await auditLogger.record(
        {
          organization_id: req.session!.organization_id,
          user_id: req.session!.user_id,
          action: 'EMPLOYEE_STATUS_CHANGED',
          entity_type: 'EMPLOYEE',
          entity_id: emp.id,
          before_state: { status: emp.status },
          after_state: { status, effective_date, reason },
          correlation_id: req.correlationId,
        },
        tx,
      );
      return { id: emp.id, status };
    });
    return ok(req, res, out);
  });

  // ==========================================
  // 18. Payroll Calculation & Runs (M4)
  // ==========================================
  app.post('/api/hrm/payroll/calculate', authenticate, requirePermission(Permission.PAYROLL_MANAGE), async (req: Request, res: Response) => {
    const period_id = str(req.body?.period_id, 'period_id', { max: 64 });
    const month_year = str(req.body?.month_year, 'month_year', { pattern: /^\d{4}-\d{2}$/, max: 7 });
    await requirePayrollPeriod(period_id, month_year, req.session!.organization_id);
    const { items, totals } = await loadPayrollInputs(req.session!.legal_entity_id, req.session!.organization_id);
    return ok(req, res, { period_id, month_year, totals, items });
  });

  app.get('/api/hrm/payroll-runs', authenticate, requireAnyPermission(Permission.PAYROLL_MANAGE, Permission.PAYROLL_APPROVE), async (req: Request, res: Response) => {
    // Fixed: previously selected non-existent fp.name, failing every request.
    const runsRes = await db.query(
      `SELECT pr.*, fp.period_name as period_name
       FROM payroll_runs pr LEFT JOIN fiscal_periods fp ON fp.id = pr.period_id
       WHERE pr.organization_id = $1 AND pr.legal_entity_id = $2
       ORDER BY pr.created_at DESC`,
      [req.session!.organization_id, req.session!.legal_entity_id],
    );
    const runsWithItems = [];
    for (const run of runsRes.rows) {
      const itemsRes = await db.query(
        `SELECT pri.*, e.employee_number, e.first_name, e.last_name
         FROM payroll_run_items pri JOIN employees e ON e.id = pri.employee_id
         WHERE pri.payroll_run_id = $1 ORDER BY e.employee_number ASC`,
        [run.id],
      );
      runsWithItems.push({ ...run, items: itemsRes.rows.map((it: any) => ({ ...it, employee_name: `${it.first_name} ${it.last_name}` })) });
    }
    return ok(req, res, runsWithItems, 200, { total_count: runsWithItems.length });
  });

  app.post('/api/hrm/payroll-runs', authenticate, requirePermission(Permission.PAYROLL_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const period_id = str(req.body?.period_id, 'period_id', { max: 64 });
    const month_year = str(req.body?.month_year, 'month_year', { pattern: /^\d{4}-\d{2}$/, max: 7 });
    const off_cycle = bool(req.body?.off_cycle, false);
    const period = await requirePayrollPeriod(period_id, month_year, org);
    if (period.status === 'HARD_CLOSED') throw new ApiError(400, ErrorCode.PERIOD_CLOSED, 'Cannot create a pay run for a hard-closed period');
    const { items, totals } = await loadPayrollInputs(req.session!.legal_entity_id, org);

    const runId = crypto.randomUUID();
    const run = await db.transaction(async (tx) => {
      if (!off_cycle) {
        const dup = await tx.query(
          `SELECT run_number FROM payroll_runs WHERE organization_id = $1 AND legal_entity_id = $2 AND month_year = $3 AND run_type = 'REGULAR' AND status <> 'CANCELLED'`,
          [org, req.session!.legal_entity_id, month_year],
        );
        if (dup.rows.length > 0) {
          throw new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, `A regular pay run (${dup.rows[0].run_number}) already exists for ${month_year}; use an off-cycle run for corrections`);
        }
      }
      const run_number = optionalStr(req.body?.run_number, 'run_number', 64) || (await nextDocumentNumber(tx, org, 'PR', `${month_year}-01`, 3));
      await tx.query(
        `INSERT INTO payroll_runs (
          id, organization_id, legal_entity_id, period_id, run_number, month_year,
          total_gross, total_tax, total_eobi, total_provident_fund, total_other_deductions,
          total_deductions, total_net, status, created_by, run_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'DRAFT', $14, $15)`,
        [
          runId,
          org,
          req.session!.legal_entity_id,
          period_id,
          run_number,
          month_year,
          totals.total_gross,
          totals.total_tax,
          totals.total_eobi,
          totals.total_provident_fund,
          totals.total_other_deductions,
          totals.total_deductions,
          totals.total_net,
          req.session!.user_id,
          off_cycle ? 'OFF_CYCLE' : 'REGULAR',
        ],
      );
      for (const item of items) {
        await tx.query(
          `INSERT INTO payroll_run_items (
            id, payroll_run_id, employee_id, basic_salary, allowances_total, gross_salary,
            tax_deduction, eobi_deduction, provident_fund_deduction, other_deductions,
            total_deductions, net_salary, payment_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PENDING')`,
          [
            crypto.randomUUID(),
            runId,
            item.employee_id,
            item.basic_salary,
            item.allowances_total,
            item.gross_salary,
            item.tax_deduction,
            item.eobi_deduction,
            item.provident_fund_deduction,
            item.other_deductions,
            item.total_deductions,
            item.net_salary,
          ],
        );
      }
      await auditLogger.record(
        {
          organization_id: org,
          user_id: req.session!.user_id,
          action: 'PAYROLL_RUN_CALCULATED',
          entity_type: 'PAYROLL_RUN',
          entity_id: runId,
          after_state: { run_number, month_year, employees: items.length },
          correlation_id: req.correlationId,
        },
        tx,
      );
      return (await tx.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId])).rows[0];
    });
    return ok(req, res, { ...run, totals, items }, 201);
  });

  app.post('/api/hrm/payroll-runs/:id/approve', authenticate, requirePermission(Permission.PAYROLL_APPROVE), async (req: Request, res: Response) => {
    const out = await db.transaction(async (tx) => {
      const run = await requireOrgRow(tx, 'payroll_runs', req.params.id, req.session!.organization_id, 'Payroll run', { forUpdate: true });
      if (run.created_by === req.session!.user_id) {
        throw sodViolation('Segregation of duties: the payroll preparer cannot approve the same pay run');
      }
      await transition(tx, {
        table: 'payroll_runs',
        id: run.id,
        organizationId: req.session!.organization_id,
        from: ['DRAFT'],
        to: 'APPROVED',
        label: 'Payroll run',
        set: { approved_by: req.session!.user_id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      });
      await auditLogger.record(
        { organization_id: req.session!.organization_id, user_id: req.session!.user_id, action: 'PAYROLL_RUN_APPROVED', entity_type: 'PAYROLL_RUN', entity_id: run.id, before_state: { status: run.status }, after_state: { status: 'APPROVED' }, correlation_id: req.correlationId },
        tx,
      );
      return { id: run.id, status: 'APPROVED' };
    });
    return ok(req, res, out);
  });

  app.post('/api/hrm/payroll-runs/:id/post', authenticate, requirePermission(Permission.PAYROLL_POST), async (req: Request, res: Response) => {
    const out = await db.transaction(async (tx) => {
      const run = await requireOrgRow(tx, 'payroll_runs', req.params.id, req.session!.organization_id, 'Payroll run', { forUpdate: true });
      if (run.status !== 'APPROVED') {
        throw new ApiError(409, ErrorCode.INVALID_STATE, `Only APPROVED payroll runs can be posted (current: ${run.status})`);
      }
      const period = await requireOrgRow(tx, 'fiscal_periods', run.period_id, req.session!.organization_id, 'Fiscal period');
      const accounts = await tx.query(`SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('521002','212002','212003','212004','211004','211009')`, [
        req.session!.organization_id,
      ]);
      const map = new Map(accounts.rows.map((a: any) => [a.code, a.id]));
      if (!map.get('521002') || !map.get('212002') || !map.get('212003') || !map.get('211004')) {
        throw new ApiError(400, ErrorCode.MAPPING_MISSING, 'Required payroll GL accounts (521002, 212002, 212003, 211004) are missing in COA');
      }
      let lines;
      try {
        lines = PayrollEngine.generatePayrollJournalLines({
          totals: run,
          salariesExpenseAccountId: map.get('521002')!,
          taxPayableAccountId: map.get('212002')!,
          eobiPayableAccountId: map.get('212003')!,
          providentFundPayableAccountId: map.get('212004'),
          otherDeductionsPayableAccountId: map.get('211009'),
          salariesPayableAccountId: map.get('211004')!,
        });
      } catch (err: any) {
        throw new ApiError(400, ErrorCode.MAPPING_MISSING, err.message);
      }
      // Accrual is dated at the pay period end (previously "today", which put the
      // expense in whichever month the button was pressed).
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session!.organization_id,
        legalEntityId: run.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: toIsoDate(period.end_date),
        purpose: AccountingPurpose.PAYROLL_RUN,
        description: `Payroll expense and liabilities accrual for ${run.month_year} (${run.run_number})`,
        sourceType: 'PAYROLL_RUN',
        sourceId: run.id,
        sourceKey: `PAYROLL_RUN:${run.id}`,
        numberPrefix: 'JV-PAY',
        approvedBy: run.approved_by,
        correlationId: req.correlationId,
        lines: lines.map((l) => ({ account_id: l.account_id, debit: l.base_debit, credit: l.base_credit, description: l.description })),
      });
      await transition(tx, {
        table: 'payroll_runs',
        id: run.id,
        organizationId: req.session!.organization_id,
        from: ['APPROVED'],
        to: 'POSTED',
        label: 'Payroll run',
        set: { posted_journal_id: posted?.journalId ?? null, posted_by: req.session!.user_id, updated_at: new Date().toISOString() },
      });
      return { id: run.id, status: 'POSTED', posted_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });

  app.post('/api/hrm/payroll-runs/:id/disburse', authenticate, requirePermission(Permission.PAYROLL_DISBURSE), async (req: Request, res: Response) => {
    const bank_account_id = optionalUuid(req.body?.bank_account_id, 'bank_account_id');
    const payment_date = dateOnly(req.body?.payment_date, 'payment_date', { required: false });
    const out = await db.transaction(async (tx) => {
      const run = await requireOrgRow(tx, 'payroll_runs', req.params.id, req.session!.organization_id, 'Payroll run', { forUpdate: true });
      if (run.status !== 'POSTED') {
        throw new ApiError(409, ErrorCode.INVALID_STATE, `Only POSTED payroll runs can be disbursed (current: ${run.status})`);
      }
      if (run.created_by === req.session!.user_id) {
        throw sodViolation('Segregation of duties: the payroll preparer cannot release the disbursement');
      }
      const period = await requireOrgRow(tx, 'fiscal_periods', run.period_id, req.session!.organization_id, 'Fiscal period');
      let bankId = bank_account_id;
      if (bankId) {
        const bank = await tx.query(`SELECT id, control_type FROM accounts WHERE id = $1 AND organization_id = $2 AND level = 4`, [bankId, req.session!.organization_id]);
        if (bank.rows.length === 0) throw validationError('Bank account not found', { field: 'bank_account_id' });
      } else {
        const bankRes = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [req.session!.organization_id]);
        if (bankRes.rows.length === 0) throw new ApiError(400, ErrorCode.MAPPING_MISSING, 'Bank account not found for disbursement');
        bankId = bankRes.rows[0].id;
      }
      const postingDate = payment_date || toIsoDate(period.end_date);
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session!.organization_id,
        legalEntityId: run.legal_entity_id,
        userId: req.session!.user_id,
        postingDate,
        purpose: AccountingPurpose.PAYROLL_DISBURSEMENT,
        description: `Bank disbursement of net salaries for ${run.month_year} (${run.run_number})`,
        sourceType: 'PAYROLL_RUN',
        sourceId: run.id,
        sourceKey: `PAYROLL_DISBURSEMENT:${run.id}`,
        numberPrefix: 'JV-PAYD',
        correlationId: req.correlationId,
        lines: [
          { account_code: '211004', debit: run.total_net, description: 'Disbursement clearing for net salaries' },
          { account_id: bankId, credit: run.total_net, description: 'Bank transfer payment for net salaries' },
        ],
      });
      await transition(tx, {
        table: 'payroll_runs',
        id: run.id,
        organizationId: req.session!.organization_id,
        from: ['POSTED'],
        to: 'DISBURSED',
        label: 'Payroll run',
        set: { disbursement_journal_id: posted?.journalId ?? null, disbursed_by: req.session!.user_id, updated_at: new Date().toISOString() },
      });
      await tx.query(`UPDATE payroll_run_items SET payment_status = 'PAID' WHERE payroll_run_id = $1`, [run.id]);
      return { id: run.id, status: 'DISBURSED', disbursement_journal_id: posted?.journalId ?? null };
    });
    return ok(req, res, out);
  });

  /** Cancel a pay run that has not been posted (frees the month for a new regular run). */
  app.post('/api/hrm/payroll-runs/:id/cancel', authenticate, requirePermission(Permission.PAYROLL_MANAGE), async (req: Request, res: Response) => {
    const reason = str(req.body?.reason, 'reason', { max: 500 });
    const out = await db.transaction(async (tx) => {
      const run = await transition(tx, {
        table: 'payroll_runs',
        id: req.params.id,
        organizationId: req.session!.organization_id,
        from: ['DRAFT', 'APPROVED'],
        to: 'CANCELLED',
        label: 'Payroll run',
        set: { updated_at: new Date().toISOString() },
      });
      await auditLogger.record(
        { organization_id: req.session!.organization_id, user_id: req.session!.user_id, action: 'PAYROLL_RUN_CANCELLED', entity_type: 'PAYROLL_RUN', entity_id: run.id, after_state: { reason }, correlation_id: req.correlationId },
        tx,
      );
      return { id: run.id, status: 'CANCELLED' };
    });
    return ok(req, res, out);
  });

  // ==========================================
  // Workman Services HRM Enhancements
  // ==========================================

  // --- 1. Staff Advances & Floats (Hisaab) ---
  app.get('/api/hrm/advances', authenticate, hrRead, async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT a.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name
       FROM hrm_advances a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.organization_id = $1
       ORDER BY a.created_at DESC`,
      [req.session!.organization_id],
    );
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/advances', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const employee_id = str(req.body?.employee_id, 'employee_id');
    const advance_type = oneOf(req.body?.advance_type, 'advance_type', ['CASH', 'TRAVEL', 'PARTS_FLOAT', 'EMERGENCY_LOAN']);
    const amount = decimal(req.body?.amount, 'amount', { sign: 'positive' });
    const purpose = str(req.body?.purpose, 'purpose', { max: 1000 });
    const repayment_months = Math.max(1, Number(req.body?.repayment_months || 1));
    const monthly_deduction = new Money(amount).div(repayment_months).toFixed(8);

    await assertOrgRef(db, 'employees', employee_id, req.session!.organization_id, 'employee_id');
    const docNumber = await nextDocumentNumber(db, req.session!.organization_id, 'ADV');

    const advId = crypto.randomUUID();
    await db.query(
      `INSERT INTO hrm_advances (id, organization_id, legal_entity_id, number, employee_id, advance_type, amount, purpose, repayment_months, monthly_deduction, balance_amount, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12)`,
      [advId, req.session!.organization_id, req.session!.legal_entity_id, docNumber, employee_id, advance_type, amount, purpose, repayment_months, monthly_deduction, amount, req.session!.user_id],
    );
    const row = (await db.query(`SELECT * FROM hrm_advances WHERE id = $1`, [advId])).rows[0];
    return ok(req, res, row, 201);
  });

  app.post('/api/hrm/advances/:id/approve', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const out = await db.transaction(async (tx) => {
      const adv = await requireOrgRow(tx, 'hrm_advances', req.params.id, req.session!.organization_id, 'Staff advance', { forUpdate: true });
      if (adv.status !== 'DRAFT' && adv.status !== 'SUBMITTED') {
        throw new ApiError(409, ErrorCode.INVALID_STATE, `Only DRAFT or SUBMITTED advances can be approved (current: ${adv.status})`);
      }
      if (adv.created_by === req.session!.user_id) {
        throw sodViolation('Segregation of duties: preparer cannot approve staff advance');
      }
      await tx.query(
        `UPDATE hrm_advances SET status = 'APPROVED', approved_by = $2, updated_at = NOW() WHERE id = $1`,
        [adv.id, req.session!.user_id],
      );
      return { id: adv.id, status: 'APPROVED' };
    });
    return ok(req, res, out);
  });

  app.post('/api/hrm/advances/:id/disburse', authenticate, requirePermission(Permission.PAYROLL_DISBURSE), async (req: Request, res: Response) => {
    const payment_date = dateOnly(req.body?.payment_date, 'payment_date', { required: false }) || new Date().toISOString().slice(0, 10);
    const out = await db.transaction(async (tx) => {
      const adv = await requireOrgRow(tx, 'hrm_advances', req.params.id, req.session!.organization_id, 'Staff advance', { forUpdate: true });
      if (adv.status !== 'APPROVED') {
        throw new ApiError(409, ErrorCode.INVALID_STATE, `Only APPROVED advances can be disbursed (current: ${adv.status})`);
      }
      const bankRes = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [req.session!.organization_id]);
      if (bankRes.rows.length === 0) throw new ApiError(400, ErrorCode.MAPPING_MISSING, 'Operating bank account not found');
      const bankId = bankRes.rows[0].id;

      const advanceAcc = (await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code IN ('112006', '112004', '113005') ORDER BY code ASC LIMIT 1`, [req.session!.organization_id])).rows[0]?.id;

      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session!.organization_id,
        legalEntityId: adv.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: payment_date,
        purpose: AccountingPurpose.PAYROLL_DISBURSEMENT,
        description: `Disbursement of staff advance ${adv.number} - ${adv.advance_type}`,
        sourceType: 'HRM_ADVANCE',
        sourceId: adv.id,
        sourceKey: `HRM_ADVANCE:${adv.id}`,
        numberPrefix: 'JV-ADV',
        correlationId: req.correlationId,
        lines: [
          advanceAcc
            ? { account_id: advanceAcc, debit: adv.amount, description: `Staff advance receivable ${adv.number}` }
            : { account_code: '112006', debit: adv.amount, description: `Staff advance receivable ${adv.number}` },
          { account_id: bankId, credit: adv.amount, description: `Bank disbursement for advance ${adv.number}` },
        ],
      });

      // Generate recovery schedule
      const months = Number(adv.repayment_months);
      const monthlyAmt = new Money(adv.amount).div(months).toFixed(8);
      for (let i = 1; i <= months; i++) {
        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() + i);
        await tx.query(
          `INSERT INTO hrm_advance_installments (id, advance_id, installment_number, due_date, amount, status)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PENDING')`,
          [adv.id, i, dueDate.toISOString().slice(0, 10), monthlyAmt],
        );
      }

      await tx.query(
        `UPDATE hrm_advances SET status = 'DISBURSED', disbursement_journal_id = $2, disbursed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [adv.id, posted?.journalId ?? null],
      );

      return { id: adv.id, status: 'DISBURSED', journal_id: posted?.journalId };
    });
    return ok(req, res, out);
  });

  // --- 2. Geofence Zones & Shifts ---
  app.get('/api/hrm/geofences', authenticate, hrRead, async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT * FROM hrm_geofence_zones WHERE organization_id = $1 ORDER BY code ASC`,
      [req.session!.organization_id],
    );
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/geofences', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const code = str(req.body?.code, 'code', { max: 32 });
    const name = str(req.body?.name, 'name', { max: 255 });
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const radius_meters = Number(req.body?.radius_meters || 100);

    const geoId = crypto.randomUUID();
    await db.query(
      `INSERT INTO hrm_geofence_zones (id, organization_id, code, name, latitude, longitude, radius_meters, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, radius_meters = EXCLUDED.radius_meters`,
      [geoId, req.session!.organization_id, code, name, latitude, longitude, radius_meters],
    );
    const row = (await db.query(`SELECT * FROM hrm_geofence_zones WHERE id = $1`, [geoId])).rows[0];
    return ok(req, res, row, 201);
  });

  app.get('/api/hrm/shifts', authenticate, hrRead, async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT * FROM hrm_shifts WHERE organization_id = $1 ORDER BY code ASC`,
      [req.session!.organization_id],
    );
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/shifts', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const code = str(req.body?.code, 'code', { max: 32 });
    const name = str(req.body?.name, 'name', { max: 255 });
    const start_time = str(req.body?.start_time, 'start_time', { max: 5 });
    const end_time = str(req.body?.end_time, 'end_time', { max: 5 });
    const grace_period_minutes = Number(req.body?.grace_period_minutes || 15);
    const half_day_hours = Number(req.body?.half_day_hours || 4.5);

    const shiftId = crypto.randomUUID();
    await db.query(
      `INSERT INTO hrm_shifts (id, organization_id, code, name, start_time, end_time, grace_period_minutes, half_day_hours, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [shiftId, req.session!.organization_id, code, name, start_time, end_time, grace_period_minutes, half_day_hours],
    );
    const row = (await db.query(`SELECT * FROM hrm_shifts WHERE id = $1`, [shiftId])).rows[0];
    return ok(req, res, row, 201);
  });

  // --- 3. Attendance Logs with Geofencing & Verification ---
  app.get('/api/hrm/attendance', authenticate, hrRead, async (req: Request, res: Response) => {
    const date = req.query?.date ? String(req.query.date) : null;
    const params: any[] = [req.session!.organization_id];
    let query = `
      SELECT a.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name,
             s.name AS shift_name, g.name AS geofence_zone_name
      FROM hrm_attendance_logs a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN hrm_shifts s ON s.id = a.shift_id
      LEFT JOIN hrm_geofence_zones g ON g.id = a.geofence_zone_id
      WHERE a.organization_id = $1
    `;
    if (date) {
      params.push(date);
      query += ` AND a.work_date = $2`;
    }
    query += ` ORDER BY a.work_date DESC, a.created_at DESC`;
    const result = await db.query(query, params);
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/attendance/check-in', authenticate, async (req: Request, res: Response) => {
    const employee_id = str(req.body?.employee_id, 'employee_id');
    const work_date = dateOnly(req.body?.work_date, 'work_date', { required: false }) || new Date().toISOString().slice(0, 10);
    const shift_id = optionalUuid(req.body?.shift_id, 'shift_id');
    const latitude = Number(req.body?.latitude || 0);
    const longitude = Number(req.body?.longitude || 0);
    const verification_method = oneOf(req.body?.verification_method, 'verification_method', ['GEOFENCE', 'FACE_VERIFIED', 'BIOMETRIC', 'MANUAL']);
    const notes = optionalStr(req.body?.notes, 'notes', 500);

    await assertOrgRef(db, 'employees', employee_id, req.session!.organization_id, 'employee_id');

    // Find closest geofence zone
    const zones = (await db.query(`SELECT * FROM hrm_geofence_zones WHERE organization_id = $1 AND is_active = true`, [req.session!.organization_id])).rows;
    let insideZoneId: string | null = null;
    let geofence_status: 'INSIDE_GEOFENCE' | 'OUTSIDE_GEOFENCE' = 'OUTSIDE_GEOFENCE';

    for (const z of zones) {
      const d = Math.hypot((Number(z.latitude) - latitude) * 111320, (Number(z.longitude) - longitude) * 111320 * Math.cos((latitude * Math.PI) / 180));
      if (d <= Number(z.radius_meters)) {
        insideZoneId = z.id;
        geofence_status = 'INSIDE_GEOFENCE';
        break;
      }
    }

    const logId = crypto.randomUUID();
    await db.query(
      `INSERT INTO hrm_attendance_logs (id, organization_id, employee_id, work_date, shift_id, check_in_time, check_in_lat, check_in_lng, geofence_zone_id, geofence_status, verification_method, status, notes)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, 'PRESENT', $11)
       ON CONFLICT (employee_id, work_date) DO UPDATE SET
         check_in_time = NOW(), check_in_lat = EXCLUDED.check_in_lat, check_in_lng = EXCLUDED.check_in_lng, geofence_zone_id = EXCLUDED.geofence_zone_id, geofence_status = EXCLUDED.geofence_status`,
      [logId, req.session!.organization_id, employee_id, work_date, shift_id, latitude, longitude, insideZoneId, geofence_status, verification_method, notes],
    );
    const row = (await db.query(`SELECT * FROM hrm_attendance_logs WHERE employee_id = $1 AND work_date = $2`, [employee_id, work_date])).rows[0];
    return ok(req, res, row, 201);
  });

  app.post('/api/hrm/attendance/check-out', authenticate, async (req: Request, res: Response) => {
    const employee_id = str(req.body?.employee_id, 'employee_id');
    const work_date = dateOnly(req.body?.work_date, 'work_date', { required: false }) || new Date().toISOString().slice(0, 10);

    const log = (await db.query(`SELECT * FROM hrm_attendance_logs WHERE employee_id = $1 AND work_date = $2 AND organization_id = $3`, [employee_id, work_date, req.session!.organization_id])).rows[0];
    if (!log) throw new ApiError(404, ErrorCode.RESOURCE_NOT_FOUND, 'Check-in record not found for this date');

    const checkIn = new Date(log.check_in_time);
    const now = new Date();
    const hours = Math.max(0, (now.getTime() - checkIn.getTime()) / (1000 * 60 * 60));

    await db.query(
      `UPDATE hrm_attendance_logs SET check_out_time = NOW(), total_hours = $3 WHERE employee_id = $1 AND work_date = $2`,
      [employee_id, work_date, hours.toFixed(2)],
    );
    const row = (await db.query(`SELECT * FROM hrm_attendance_logs WHERE employee_id = $1 AND work_date = $2`, [employee_id, work_date])).rows[0];
    return ok(req, res, row);
  });

  // --- 4. Leave Types & Allocations ---
  app.get('/api/hrm/leave-types', authenticate, hrRead, async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT * FROM hrm_leave_types WHERE organization_id = $1 ORDER BY code ASC`,
      [req.session!.organization_id],
    );
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/leave-types', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const code = str(req.body?.code, 'code', { max: 32 });
    const name = str(req.body?.name, 'name', { max: 255 });
    const annual_quota = Number(req.body?.annual_quota || 0);
    const is_paid = bool(req.body?.is_paid, true);

    const typeId = crypto.randomUUID();
    await db.query(
      `INSERT INTO hrm_leave_types (id, organization_id, code, name, annual_quota, is_paid, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, annual_quota = EXCLUDED.annual_quota, is_paid = EXCLUDED.is_paid`,
      [typeId, req.session!.organization_id, code, name, annual_quota, is_paid],
    );
    const row = (await db.query(`SELECT * FROM hrm_leave_types WHERE id = $1`, [typeId])).rows[0];
    return ok(req, res, row, 201);
  });

  app.get('/api/hrm/leave-allocations', authenticate, hrRead, async (req: Request, res: Response) => {
    const year = Number(req.query?.year || new Date().getFullYear());
    const result = await db.query(
      `SELECT la.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name, lt.name AS leave_type_name, lt.code AS leave_type_code
       FROM hrm_leave_allocations la
       JOIN employees e ON e.id = la.employee_id
       JOIN hrm_leave_types lt ON lt.id = la.leave_type_id
       WHERE la.organization_id = $1 AND la.year = $2
       ORDER BY e.employee_number ASC`,
      [req.session!.organization_id, year],
    );
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/leave-allocations', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const employee_id = str(req.body?.employee_id, 'employee_id');
    const leave_type_id = str(req.body?.leave_type_id, 'leave_type_id');
    const year = Number(req.body?.year || new Date().getFullYear());
    const allocated_days = Number(req.body?.allocated_days || 0);

    const allocId = crypto.randomUUID();
    await db.query(
      `INSERT INTO hrm_leave_allocations (id, organization_id, employee_id, leave_type_id, year, allocated_days, used_days, remaining_days)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $6)
       ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET allocated_days = EXCLUDED.allocated_days, remaining_days = EXCLUDED.allocated_days - hrm_leave_allocations.used_days`,
      [allocId, req.session!.organization_id, employee_id, leave_type_id, year, allocated_days],
    );
    const row = (await db.query(`SELECT * FROM hrm_leave_allocations WHERE id = $1`, [allocId])).rows[0];
    return ok(req, res, row, 201);
  });

  // --- 5. Staff & Technician Expense Claims ---
  app.get('/api/hrm/expenses', authenticate, hrRead, async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT exp.*, e.employee_number, e.first_name || ' ' || e.last_name AS employee_name
       FROM hrm_expense_claims exp
       JOIN employees e ON e.id = exp.employee_id
       WHERE exp.organization_id = $1
       ORDER BY exp.claim_date DESC, exp.created_at DESC`,
      [req.session!.organization_id],
    );
    return ok(req, res, result.rows, 200, { total_count: result.rows.length });
  });

  app.post('/api/hrm/expenses', authenticate, async (req: Request, res: Response) => {
    const employee_id = str(req.body?.employee_id, 'employee_id');
    const claim_date = dateOnly(req.body?.claim_date, 'claim_date', { required: false }) || new Date().toISOString().slice(0, 10);
    const category = oneOf(req.body?.category, 'category', ['TRAVEL', 'FUEL', 'TOOLS', 'PARTS', 'FOOD', 'OTHER']);
    const amount = decimal(req.body?.amount, 'amount', { sign: 'positive' });
    const description = str(req.body?.description, 'description', { max: 1000 });
    const receipt_reference = optionalStr(req.body?.receipt_reference, 'receipt_reference', 255);

    await assertOrgRef(db, 'employees', employee_id, req.session!.organization_id, 'employee_id');
    const docNumber = await nextDocumentNumber(db, req.session!.organization_id, 'EXP');

    const expId = crypto.randomUUID();
    await db.query(
      `INSERT INTO hrm_expense_claims (id, organization_id, legal_entity_id, number, employee_id, claim_date, category, amount, description, receipt_reference, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SUBMITTED', $11)`,
      [expId, req.session!.organization_id, req.session!.legal_entity_id, docNumber, employee_id, claim_date, category, amount, description, receipt_reference, req.session!.user_id],
    );
    const row = (await db.query(`SELECT * FROM hrm_expense_claims WHERE id = $1`, [expId])).rows[0];
    return ok(req, res, row, 201);
  });

  app.post('/api/hrm/expenses/:id/approve', authenticate, requirePermission(Permission.HRM_MANAGE), async (req: Request, res: Response) => {
    const out = await db.transaction(async (tx) => {
      const exp = await requireOrgRow(tx, 'hrm_expense_claims', req.params.id, req.session!.organization_id, 'Expense claim', { forUpdate: true });
      if (exp.status !== 'SUBMITTED') {
        throw new ApiError(409, ErrorCode.INVALID_STATE, `Only SUBMITTED expense claims can be approved (current: ${exp.status})`);
      }
      if (exp.created_by === req.session!.user_id) {
        throw sodViolation('Segregation of duties: claim submitter cannot approve expense');
      }
      await tx.query(
        `UPDATE hrm_expense_claims SET status = 'APPROVED', approved_by = $2, approved_at = NOW() WHERE id = $1`,
        [exp.id, req.session!.user_id],
      );
      return { id: exp.id, status: 'APPROVED' };
    });
    return ok(req, res, out);
  });

  app.post('/api/hrm/expenses/:id/settle', authenticate, requirePermission(Permission.PAYROLL_DISBURSE), async (req: Request, res: Response) => {
    const payment_date = dateOnly(req.body?.payment_date, 'payment_date', { required: false }) || new Date().toISOString().slice(0, 10);
    const out = await db.transaction(async (tx) => {
      const exp = await requireOrgRow(tx, 'hrm_expense_claims', req.params.id, req.session!.organization_id, 'Expense claim', { forUpdate: true });
      if (exp.status !== 'APPROVED') {
        throw new ApiError(409, ErrorCode.INVALID_STATE, `Only APPROVED expense claims can be settled (current: ${exp.status})`);
      }
      const bankRes = await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [req.session!.organization_id]);
      if (bankRes.rows.length === 0) throw new ApiError(400, ErrorCode.MAPPING_MISSING, 'Operating bank account not found');
      const bankId = bankRes.rows[0].id;

      const expAcc = (await tx.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code IN ('521014', '521010', '521013') ORDER BY code ASC LIMIT 1`, [req.session!.organization_id])).rows[0]?.id;

      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: req.session!.organization_id,
        legalEntityId: exp.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: payment_date,
        purpose: AccountingPurpose.PAYROLL_DISBURSEMENT,
        description: `Cash reimbursement for expense claim ${exp.number} (${exp.category})`,
        sourceType: 'HRM_EXPENSE_CLAIM',
        sourceId: exp.id,
        sourceKey: `HRM_EXPENSE_CLAIM:${exp.id}`,
        numberPrefix: 'JV-EXP',
        correlationId: req.correlationId,
        lines: [
          expAcc
            ? { account_id: expAcc, debit: exp.amount, description: `Field expense ${exp.number}` }
            : { account_code: '521014', debit: exp.amount, description: `Field expense ${exp.number}` },
          { account_id: bankId, credit: exp.amount, description: `Cash reimbursement for ${exp.number}` },
        ],
      });

      await tx.query(
        `UPDATE hrm_expense_claims SET status = 'SETTLED_CASH', settlement_journal_id = $2 WHERE id = $1`,
        [exp.id, posted?.journalId ?? null],
      );

      return { id: exp.id, status: 'SETTLED_CASH', journal_id: posted?.journalId };
    });
    return ok(req, res, out);
  });
}

