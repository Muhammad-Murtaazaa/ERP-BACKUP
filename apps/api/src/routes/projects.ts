/* eslint-disable */
import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import {
  PGliteAdapter,
  DbMigrator,
  SyntheticSeedRunner,
  AuthService,
  AuditLogger,
  OutboxService,
} from '@omnysync/platform';
import {
  Money,
  JournalValidator,
  CoaHierarchyValidator,
  PeriodManager,
  LedgerEngine,
  JournalReversalEngine,
  BankReconciliationEngine,
  FxEngine,
  PayrollEngine,
  ManufacturingEngine,
  InventoryReconciliationEngine,
  ProjectsEngine,
  FixedAssetsEngine,
  POSEngine,
  QualityEngine,
  MaintenanceEngine,
} from '@omnysync/financial-engine';
import {
  ErrorCode,
  StandardErrorResponse,
  StandardSuccessResponse,
  AuthSession,
  UserRole,
  Permission,
  JournalStatus,
  AccountingPurpose,
  PeriodStatus,
  Account,
  Journal,
  JournalLine,
} from '@omnysync/contracts';

import { db, authService, auditLogger, outboxService, authenticate, requirePermission } from '../context.js';

export function registerProjectsRoutes(app: Express): void {
  // 20. Projects, Cost Centers, BOQ & Progress Invoicing (M6)
  // ==========================================

  // Cost Centers
  app.get('/api/projects/cost-centers', authenticate, requirePermission(Permission.FINANCE_COA_VIEW), async (req: Request, res: Response) => {
    const result = await db.query(
      'SELECT * FROM cost_centers WHERE organization_id = $1 ORDER BY code ASC',
      [req.session!.organization_id]
    );

    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/projects/cost-centers', authenticate, requirePermission(Permission.PROJECT_MANAGE), async (req: Request, res: Response) => {
    const { code, name, cost_center_type, manager_name } = req.body;

    if (!code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Code and name are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO cost_centers (id, code, name, cost_center_type, manager_name, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, code, name, cost_center_type || 'OPERATIONAL', manager_name || null, req.session!.organization_id]
    );

    return res.status(201).json({
      success: true,
      data: { id, code, name, cost_center_type: cost_center_type || 'OPERATIONAL', manager_name },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Projects Master
  app.get('/api/projects', authenticate, requirePermission(Permission.FINANCE_REPORTS_VIEW), async (req: Request, res: Response) => {
    const result = await db.query(
      `SELECT p.*, c.name as customer_name, cc.name as cost_center_name 
       FROM projects p 
       LEFT JOIN parties c ON c.id = p.customer_id 
       LEFT JOIN cost_centers cc ON cc.id = p.cost_center_id 
       WHERE p.organization_id = $1 
       ORDER BY p.code ASC`,
      [req.session!.organization_id]
    );

    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/projects', authenticate, requirePermission(Permission.PROJECT_MANAGE), async (req: Request, res: Response) => {
    const {
      code,
      name,
      customer_id,
      manager_name,
      project_type,
      contract_value,
      budgeted_cost,
      retention_percentage,
      start_date,
      end_date,
      cost_center_id,
    } = req.body;

    if (!code || !name || !start_date) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Code, name, and start_date are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO projects (
        id, code, name, customer_id, manager_name, project_type,
        contract_value, budgeted_cost, retention_percentage, status,
        start_date, end_date, cost_center_id, organization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'APPROVED', $10, $11, $12, $13)`,
      [
        id,
        code,
        name,
        customer_id || null,
        manager_name || null,
        project_type || 'CONSTRUCTION',
        new Money(contract_value || '0').toFixed(8),
        new Money(budgeted_cost || '0').toFixed(8),
        retention_percentage || 5.0,
        start_date,
        end_date || null,
        cost_center_id || null,
        req.session!.organization_id,
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id, code, name, status: 'APPROVED' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Project WBS
  app.get('/api/projects/:id/wbs', authenticate, requirePermission(Permission.PROJECT_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await db.query(
      'SELECT * FROM project_wbs_nodes WHERE project_id = $1 ORDER BY wbs_code ASC',
      [id]
    );

    return res.json({
      success: true,
      data: result.rows,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/projects/:id/wbs', authenticate, requirePermission(Permission.PROJECT_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;
    const { wbs_code, name, parent_id, budget_cost, progress_percentage, status } = req.body;

    if (!wbs_code || !name) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'WBS code and name are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const nodeId = crypto.randomUUID();
    await db.query(
      `INSERT INTO project_wbs_nodes (id, project_id, wbs_code, name, parent_id, budget_cost, progress_percentage, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        nodeId,
        id,
        wbs_code,
        name,
        parent_id || null,
        new Money(budget_cost || '0').toFixed(8),
        progress_percentage || 0.0,
        status || 'NOT_STARTED',
      ]
    );

    return res.status(201).json({
      success: true,
      data: { id: nodeId, project_id: id, wbs_code, name },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Bill of Quantities (BOQ)
  app.get('/api/projects/:id/boq', authenticate, requirePermission(Permission.BOQ_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;
    const boqRes = await db.query(
      `SELECT b.*, p.code as project_code, p.name as project_name 
       FROM bill_of_quantities b
       JOIN projects p ON p.id = b.project_id
       WHERE b.project_id = $1 AND b.organization_id = $2
       ORDER BY b.created_at DESC`,
      [id, req.session!.organization_id]
    );

    const boqs = [];
    for (const boq of boqRes.rows) {
      const itemsRes = await db.query(
        `SELECT bi.*, w.wbs_code 
         FROM boq_items bi 
         LEFT JOIN project_wbs_nodes w ON w.id = bi.wbs_node_id 
         WHERE bi.boq_id = $1 
         ORDER BY bi.item_code ASC`,
        [boq.id]
      );
      boqs.push({
        ...boq,
        items: itemsRes.rows,
      });
    }

    return res.json({
      success: true,
      data: boqs,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/projects/:id/boq', authenticate, requirePermission(Permission.BOQ_MANAGE), async (req: Request, res: Response) => {
    const { id } = req.params;
    const { boq_number, title, version, items } = req.body;

    if (!boq_number || !title || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'boq_number, title, and at least one item are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    let totalAmount = Money.zero();
    const calculatedItems = items.map((it: any) => {
      const qty = new Money(it.contract_quantity || '0');
      const rate = new Money(it.unit_rate || '0');
      const lineTotal = qty.mul(rate);
      totalAmount = totalAmount.add(lineTotal);
      return {
        ...it,
        contract_quantity: qty.toFixed(8),
        unit_rate: rate.toFixed(8),
        total_amount: lineTotal.toFixed(8),
      };
    });

    const boqId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO bill_of_quantities (id, project_id, boq_number, title, version, total_amount, status, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', $7)`,
        [boqId, id, boq_number, title, version || '1.0', totalAmount.toFixed(8), req.session!.organization_id]
      );

      for (const item of calculatedItems) {
        await tx.query(
          `INSERT INTO boq_items (id, boq_id, wbs_node_id, item_code, description, uom, contract_quantity, unit_rate, total_amount, certified_quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '0.00000000')`,
          [
            crypto.randomUUID(),
            boqId,
            item.wbs_node_id || null,
            item.item_code,
            item.description,
            item.uom || 'UNIT',
            item.contract_quantity,
            item.unit_rate,
            item.total_amount,
          ]
        );
      }
    });

    return res.status(201).json({
      success: true,
      data: { id: boqId, boq_number, title, total_amount: totalAmount.toFixed(8), status: 'APPROVED' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // Progress Certificates (Interim Payment Certificates - IPC)
  app.get('/api/projects/:id/certificates', authenticate, requirePermission(Permission.PROGRESS_CERTIFY), async (req: Request, res: Response) => {
    const { id } = req.params;
    const certRes = await db.query(
      `SELECT pc.*, p.name as project_name 
       FROM progress_certificates pc 
       JOIN projects p ON p.id = pc.project_id 
       WHERE pc.project_id = $1 AND pc.organization_id = $2 
       ORDER BY pc.certificate_date DESC, pc.certificate_number DESC`,
      [id, req.session!.organization_id]
    );

    const certs = [];
    for (const cert of certRes.rows) {
      const itemsRes = await db.query(
        `SELECT pci.*, bi.item_code, bi.description 
         FROM progress_certificate_items pci 
         JOIN boq_items bi ON bi.id = pci.boq_item_id 
         WHERE pci.certificate_id = $1`,
        [cert.id]
      );
      certs.push({
        ...cert,
        items: itemsRes.rows,
      });
    }

    return res.json({
      success: true,
      data: certs,
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/projects/:id/certificates', authenticate, requirePermission(Permission.PROGRESS_CERTIFY), async (req: Request, res: Response) => {
    const { id } = req.params;
    const { certificate_number, boq_id, period_id, certificate_date, items } = req.body;

    if (!certificate_number || !boq_id || !period_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'certificate_number, boq_id, period_id, and items are required', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    // Fetch project
    const prjRes = await db.query('SELECT * FROM projects WHERE id = $1 AND organization_id = $2', [id, req.session!.organization_id]);
    if (prjRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Project not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }
    const project = prjRes.rows[0];

    // Fetch BOQ items
    const boqItemsRes = await db.query('SELECT * FROM boq_items WHERE boq_id = $1', [boq_id]);
    const boqItems = boqItemsRes.rows;

    // Validate quantities
    const validation = ProjectsEngine.validateBoqQuantities(boqItems, items);
    if (!validation.valid) {
      return res.status(422).json({
        success: false,
        error: {
          code: ErrorCode.OVER_CERTIFICATION,
          message: `Certification quantity exceeds contract quantity for item ${validation.exceededItemCode} by ${validation.exceededQty}`,
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    // Prepare items with unit rate and previous quantity
    const itemsForCalc = items.map((it: any) => {
      const boqItem = boqItems.find((b) => b.id === it.boq_item_id);
      if (!boqItem) {
        throw new Error(`BOQ item ${it.boq_item_id} not found`);
      }
      return {
        boq_item_id: it.boq_item_id,
        previous_quantity: boqItem.certified_quantity || '0.00000000',
        current_quantity: new Money(it.current_quantity || '0').toFixed(8),
        unit_rate: boqItem.unit_rate,
      };
    });

    const calculated = ProjectsEngine.calculateProgressCertificate(itemsForCalc, project.retention_percentage.toString());
    const certId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO progress_certificates (
          id, certificate_number, project_id, boq_id, period_id,
          certificate_date, gross_certified_amount, retention_amount, net_certified_amount,
          status, organization_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'DRAFT', $10)`,
        [
          certId,
          certificate_number,
          id,
          boq_id,
          period_id,
          certificate_date || new Date().toISOString().slice(0, 10),
          calculated.gross_certified_amount,
          calculated.retention_amount,
          calculated.net_certified_amount,
          req.session!.organization_id,
        ]
      );

      for (const item of calculated.items) {
        await tx.query(
          `INSERT INTO progress_certificate_items (
            id, certificate_id, boq_item_id, previous_quantity, current_quantity, cumulative_quantity, unit_rate, current_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            crypto.randomUUID(),
            certId,
            item.boq_item_id,
            item.previous_quantity,
            item.current_quantity,
            item.cumulative_quantity,
            item.unit_rate,
            item.current_amount,
          ]
        );
      }
    });

    return res.status(201).json({
      success: true,
      data: {
        id: certId,
        certificate_number,
        gross_certified_amount: calculated.gross_certified_amount,
        retention_amount: calculated.retention_amount,
        net_certified_amount: calculated.net_certified_amount,
        status: 'DRAFT',
      },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/projects/:id/certificates/:certId/certify', authenticate, requirePermission(Permission.PROGRESS_CERTIFY), async (req: Request, res: Response) => {
    const { id, certId } = req.params;

    const certRes = await db.query(
      'SELECT * FROM progress_certificates WHERE id = $1 AND project_id = $2 AND organization_id = $3',
      [certId, id, req.session!.organization_id]
    );
    if (certRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Progress certificate not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const cert = certRes.rows[0];
    if (cert.status !== 'DRAFT') {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: `Certificate cannot be certified from status ${cert.status}`, correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const itemsRes = await db.query('SELECT * FROM progress_certificate_items WHERE certificate_id = $1', [certId]);

    await db.transaction(async (tx) => {
      for (const item of itemsRes.rows) {
        await tx.query(
          'UPDATE boq_items SET certified_quantity = $1 WHERE id = $2',
          [item.cumulative_quantity, item.boq_item_id]
        );
      }

      await tx.query(
        "UPDATE progress_certificates SET status = 'CERTIFIED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [certId]
      );
    });

    return res.json({
      success: true,
      data: { id: certId, status: 'CERTIFIED' },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/projects/:id/certificates/:certId/generate-invoice', authenticate, requirePermission(Permission.PROGRESS_INVOICE), async (req: Request, res: Response) => {
    const { id, certId } = req.params;

    const certRes = await db.query(
      `SELECT pc.*, p.code as project_code, p.cost_center_id 
       FROM progress_certificates pc 
       JOIN projects p ON p.id = pc.project_id 
       WHERE pc.id = $1 AND pc.project_id = $2 AND pc.organization_id = $3`,
      [certId, id, req.session!.organization_id]
    );

    if (certRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Progress certificate not found', correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    const cert = certRes.rows[0];
    if (cert.status !== 'CERTIFIED') {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: `Cannot generate invoice for certificate in status ${cert.status}. Must be CERTIFIED.`, correlation_id: req.correlationId },
      } satisfies StandardErrorResponse);
    }

    // Look up accounts:
    // AR: 112001 (Trade AR Control)
    // Retention Receivable: 112003 (Project Retention Receivable)
    // Revenue: 411003 (Project Milestone & Contract Revenue)
    const accRes = await db.query(
      `SELECT id, code FROM accounts WHERE organization_id = $1 AND code IN ('112001', '112003', '411003')`,
      [req.session!.organization_id]
    );
    const accountsMap = new Map<string, string>(accRes.rows.map((r) => [r.code, r.id]));

    const arAccountId = accountsMap.get('112001');
    const retentionAccountId = accountsMap.get('112003');
    const revenueAccountId = accountsMap.get('411003');

    if (!arAccountId || !retentionAccountId || !revenueAccountId) {
      return res.status(422).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Required accounts (112001, 112003, 411003) not found in COA',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const journalDraft = ProjectsEngine.generateProgressInvoiceJournal({
      organization_id: req.session!.organization_id,
      legal_entity_id: req.session!.legal_entity_id,
      period_id: cert.period_id,
      certificate_number: cert.certificate_number,
      project_code: cert.project_code,
      gross_amount: cert.gross_certified_amount,
      retention_amount: cert.retention_amount,
      net_amount: cert.net_certified_amount,
      ar_account_id: arAccountId,
      retention_receivable_account_id: retentionAccountId,
      revenue_account_id: revenueAccountId,
      cost_center_id: cert.cost_center_id,
      user_id: req.session!.user_id,
    });

    const journalId = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);

    await db.transaction(async (tx) => {
      // Insert journal
      await tx.query(
        `INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, source_type, source_id, created_by, posted_by, posted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'POSTED', 'PKR', $8, $9, $10, 'PROGRESS_CERTIFICATE', $11, $12, $12, CURRENT_TIMESTAMP)`,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          journalDraft.journal_number,
          today,
          today,
          journalDraft.accounting_purpose,
          cert.gross_certified_amount,
          cert.gross_certified_amount,
          journalDraft.description,
          certId,
          req.session!.user_id,
        ]
      );

      // Insert journal lines
      for (let i = 0; i < journalDraft.lines.length; i++) {
        const line = journalDraft.lines[i];
        await tx.query(
          `INSERT INTO journal_lines (
            id, journal_id, line_number, account_id, debit_amount, credit_amount, currency, fx_rate, base_debit, base_credit, description
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PKR', '1.000000000000', $7, $8, $9)`,
          [
            crypto.randomUUID(),
            journalId,
            i + 1,
            line.account_id,
            line.debit_amount,
            line.credit_amount,
            line.base_debit,
            line.base_credit,
            line.description,
          ]
        );
      }

      // Update progress certificate
      await tx.query(
        "UPDATE progress_certificates SET status = 'INVOICED', journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [journalId, certId]
      );
    });

    return res.json({
      success: true,
      data: {
        id: certId,
        status: 'INVOICED',
        journal_id: journalId,
        gross_amount: cert.gross_certified_amount,
        retention_amount: cert.retention_amount,
        net_amount: cert.net_certified_amount,
      },
      meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString() },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
}
