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

export function registerMastersRoutes(app: Express): void {
  // 8. M2: Parties (Customers & Vendors)
  // ==========================================
  app.get('/api/parties', authenticate, async (req: Request, res: Response) => {
    const { type, search } = req.query;
    let sql = 'SELECT * FROM parties WHERE organization_id = $1 AND is_active = true';
    const params: any[] = [req.session!.organization_id];

    if (type) {
      params.push(type);
      sql += ` AND (party_type = $${params.length} OR party_type = 'BOTH')`;
    }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (name ILIKE $${params.length} OR code ILIKE $${params.length})`;
    }

    sql += ' ORDER BY name ASC';
    const partiesRes = await db.query(sql, params);

    return res.json({
      success: true,
      data: partiesRes.rows,
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        total_count: partiesRes.rows.length,
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/parties', authenticate, requirePermission(Permission.PARTIES_MANAGE), async (req: Request, res: Response) => {
    const { code, name, party_type, tax_identifier, email, phone, address, credit_limit } = req.body;

    if (!code || !name || !party_type) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'code, name, and party_type are required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    await db.query(
      `
      INSERT INTO parties (
        id, organization_id, legal_entity_id, code, name, party_type,
        tax_identifier, email, phone, address, credit_limit, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
    `,
      [
        id,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        code,
        name,
        party_type,
        tax_identifier || null,
        email || null,
        phone || null,
        address || null,
        credit_limit || '0',
      ],
    );

    return res.status(201).json({
      success: true,
      data: { id, code, name, party_type },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
  // 9. M2: Items & Inventory Catalog
  // ==========================================
  app.get('/api/items', authenticate, async (req: Request, res: Response) => {
    const itemsRes = await db.query(
      `
      SELECT i.*, 
        COALESCE((SELECT SUM(quantity) FROM stock_movements sm WHERE sm.item_id = i.id), 0) as on_hand_qty
      FROM items i
      WHERE i.organization_id = $1 AND i.is_active = true
      ORDER BY i.name ASC
    `,
      [req.session!.organization_id],
    );

    return res.json({
      success: true,
      data: itemsRes.rows,
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        total_count: itemsRes.rows.length,
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/items', authenticate, requirePermission(Permission.ITEMS_MANAGE), async (req: Request, res: Response) => {
    const { code, name, item_type, uom, unit_price, unit_cost, sales_account_id, cogs_account_id, inventory_account_id } = req.body;

    if (!code || !name) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'code and name are required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const id = crypto.randomUUID();
    await db.query(
      `
      INSERT INTO items (
        id, organization_id, legal_entity_id, code, name, item_type, uom,
        unit_price, unit_cost, sales_account_id, cogs_account_id, inventory_account_id, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
    `,
      [
        id,
        req.session!.organization_id,
        req.session!.legal_entity_id,
        code,
        name,
        item_type || 'INVENTORY',
        uom || 'UNIT',
        unit_price || '0',
        unit_cost || '0',
        sales_account_id || null,
        cogs_account_id || null,
        inventory_account_id || null,
      ],
    );

    return res.status(201).json({
      success: true,
      data: { id, code, name },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.get('/api/inventory/stock', authenticate, async (req: Request, res: Response) => {
    const stockRes = await db.query(
      `
      SELECT 
        i.id as item_id,
        i.code as item_code,
        i.name as item_name,
        i.uom,
        i.unit_cost,
        i.unit_price,
        COALESCE(SUM(sm.quantity), 0) as on_hand_qty,
        COALESCE(SUM(sm.total_value), 0) as total_valuation
      FROM items i
      LEFT JOIN stock_movements sm ON sm.item_id = i.id
      WHERE i.organization_id = $1 AND i.item_type = 'INVENTORY'
      GROUP BY i.id, i.code, i.name, i.uom, i.unit_cost, i.unit_price
      ORDER BY i.name ASC
    `,
      [req.session!.organization_id],
    );

    return res.json({
      success: true,
      data: stockRes.rows,
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        total_count: stockRes.rows.length,
      },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
}
