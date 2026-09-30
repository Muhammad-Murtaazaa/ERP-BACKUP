import type { Express, Request, Response } from 'express';
import { Money, ManufacturingEngine } from '@omnysync/financial-engine';
import { AccountingPurpose, ErrorCode, Permission } from '@omnysync/contracts';
import { db, auditLogger, outboxService, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { arrayOf, dateOnly, decimal, optionalStr, optionalUuid, str, toIsoDate, todayIso, uuid } from '../lib/validate.js';
import { assertOrgRef, requireOrgRow } from '../lib/scope.js';
import { transition } from '../lib/state.js';
import { postJournal } from '../lib/posting.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { lockItems, postStockMovement } from '../lib/stock.js';

const MFG_READ = [
  Permission.BOM_MANAGE,
  Permission.WORK_ORDER_MANAGE,
  Permission.WORK_ORDER_RELEASE,
  Permission.WORK_ORDER_CONSUME,
  Permission.WORK_ORDER_COMPLETE,
  Permission.INVENTORY_MANAGE,
  Permission.FINANCE_REPORTS_VIEW,
];

async function accountId(q: any, org: string, code: string): Promise<string> {
  const r = await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = $2`, [org, code]);
  if (!r.rows[0]) throw new ApiError(400, ErrorCode.MAPPING_MISSING, `Required GL account ${code} not found in COA`);
  return r.rows[0].id;
}

export function registerManufacturingRoutes(app: Express): void {
  const mfgRead = requireAnyPermission(...MFG_READ);

  app.get('/api/manufacturing/boms', authenticate, mfgRead, async (req: Request, res: Response) => {
    const boms = (
      await db.query(
        `SELECT b.*, i.code as finished_item_code, i.name as finished_item_name FROM bill_of_materials b
         JOIN items i ON b.finished_item_id = i.id WHERE b.organization_id = $1 ORDER BY b.created_at DESC`,
        [req.session!.organization_id],
      )
    ).rows;
    for (const b of boms) {
      b.items = (
        await db.query(
          `SELECT bi.*, i.code as component_code, i.name as component_name, i.uom as component_uom FROM bom_items bi
           JOIN items i ON bi.component_item_id = i.id WHERE bi.bom_id = $1`,
          [b.id],
        )
      ).rows;
    }
    return ok(req, res, boms, 200, { total_count: boms.length });
  });

  app.post('/api/manufacturing/boms', authenticate, requirePermission(Permission.BOM_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const finished_item_id = uuid(req.body?.finished_item_id, 'finished_item_id');
    const name = str(req.body?.name, 'name', { max: 255 });
    const version = optionalStr(req.body?.version, 'version', 32) || '1.0';
    const yieldQty = decimal(req.body?.yield_quantity, 'yield_quantity', { sign: 'positive', required: false, defaultValue: '1' });
    await assertOrgRef(db, 'items', finished_item_id, org, 'finished_item_id');
    const items = arrayOf<any>(req.body?.items, 'items', { min: 1, max: 500 }).map((it, i) => {
      const scrap = decimal(it?.scrap_percentage, `items[${i}].scrap_percentage`, { required: false, defaultValue: '0' });
      if (new Money(scrap).gt(100)) throw validationError('scrap_percentage cannot exceed 100', { field: `items[${i}].scrap_percentage` });
      return {
        component_item_id: uuid(it?.component_item_id, `items[${i}].component_item_id`),
        quantity: decimal(it?.quantity, `items[${i}].quantity`, { sign: 'positive' }),
        scrap_percentage: scrap,
        notes: optionalStr(it?.notes, 'notes', 500),
      };
    });
    const seen = new Set<string>();
    for (const it of items) {
      if (it.component_item_id === finished_item_id) throw validationError('A BOM cannot consume its own finished item', { field: 'items' });
      if (seen.has(it.component_item_id)) throw validationError('Duplicate component in BOM', { field: 'items' });
      seen.add(it.component_item_id);
      await assertOrgRef(db, 'items', it.component_item_id, org, 'component_item_id');
    }
    const bom = await db.transaction(async (tx) => {
      const num = optionalStr(req.body?.bom_number, 'bom_number', 64) || (await nextDocumentNumber(tx, org, 'BOM', todayIso()));
      const b = (
        await tx.query(
          `INSERT INTO bill_of_materials (bom_number, finished_item_id, name, version, yield_quantity, status, organization_id)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6) RETURNING *`,
          [num, finished_item_id, name, version, yieldQty, org],
        )
      ).rows[0];
      b.items = [];
      for (const it of items) {
        b.items.push(
          (
            await tx.query(`INSERT INTO bom_items (bom_id, component_item_id, quantity, scrap_percentage, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [
              b.id,
              it.component_item_id,
              it.quantity,
              it.scrap_percentage,
              it.notes,
            ])
          ).rows[0],
        );
      }
      return b;
    });
    return ok(req, res, bom, 201);
  });

  app.get('/api/manufacturing/work-orders', authenticate, mfgRead, async (req: Request, res: Response) => {
    const wos = (
      await db.query(
        `SELECT wo.*, b.name as bom_name, i.code as finished_item_code, i.name as finished_item_name, w.name as warehouse_name
         FROM work_orders wo JOIN bill_of_materials b ON wo.bom_id = b.id JOIN items i ON wo.finished_item_id = i.id
         JOIN warehouses w ON wo.warehouse_id = w.id WHERE wo.organization_id = $1 ORDER BY wo.created_at DESC`,
        [req.session!.organization_id],
      )
    ).rows;
    for (const wo of wos) {
      wo.consumptions = (
        await db.query(
          `SELECT c.*, i.code as component_code, i.name as component_name FROM work_order_consumptions c
           JOIN items i ON c.component_item_id = i.id WHERE c.work_order_id = $1`,
          [wo.id],
        )
      ).rows;
    }
    return ok(req, res, wos, 200, { total_count: wos.length });
  });

  /** Material requirements (BOM explosion) for a work order — read-only planning aid. */
  app.get('/api/manufacturing/work-orders/:id/requirements', authenticate, mfgRead, async (req: Request, res: Response) => {
    const wo = await requireOrgRow(db, 'work_orders', req.params.id, req.session!.organization_id, 'Work order');
    const bom = await requireOrgRow(db, 'bill_of_materials', wo.bom_id, req.session!.organization_id, 'BOM');
    const bomItems = (await db.query(`SELECT bi.*, i.unit_cost FROM bom_items bi JOIN items i ON i.id = bi.component_item_id WHERE bi.bom_id = $1`, [bom.id])).rows;
    const exploded = ManufacturingEngine.explodeBOM(
      { ...bom, items: bomItems } as any,
      wo.target_qty,
      Object.fromEntries(bomItems.map((b: any) => [b.component_item_id, b.unit_cost])),
    );
    return ok(req, res, exploded);
  });

  app.post('/api/manufacturing/work-orders', authenticate, requirePermission(Permission.WORK_ORDER_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const bom_id = uuid(req.body?.bom_id, 'bom_id');
    const warehouse_id = uuid(req.body?.warehouse_id, 'warehouse_id');
    const target_qty = decimal(req.body?.target_qty, 'target_qty', { sign: 'positive' });
    const start_date = dateOnly(req.body?.start_date, 'start_date', { defaultValue: todayIso() });
    const due_date = dateOnly(req.body?.due_date, 'due_date', {
      required: false,
      defaultValue: new Date(Date.parse(`${start_date}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10),
    });
    if (due_date < start_date) throw validationError('due_date cannot be before start_date', { field: 'due_date' });
    const bom = await requireOrgRow(db, 'bill_of_materials', bom_id, org, 'BOM');
    if (bom.status !== 'ACTIVE') throw new ApiError(409, ErrorCode.INVALID_STATE, 'Only ACTIVE BOMs can be used for work orders');
    await assertOrgRef(db, 'warehouses', warehouse_id, org, 'warehouse_id');
    const wo = await db.transaction(async (tx) => {
      const num = optionalStr(req.body?.work_order_number, 'work_order_number', 64) || (await nextDocumentNumber(tx, org, 'WO', start_date));
      const r = await tx.query(
        `INSERT INTO work_orders (work_order_number, bom_id, finished_item_id, warehouse_id, target_qty, status, start_date, due_date, organization_id)
         VALUES ($1, $2, $3, $4, $5, 'PLANNED', $6, $7, $8) RETURNING *`,
        [num, bom_id, bom.finished_item_id, warehouse_id, target_qty, start_date, due_date, org],
      );
      return r.rows[0];
    });
    return ok(req, res, wo, 201);
  });

  app.post('/api/manufacturing/work-orders/:id/release', authenticate, requirePermission(Permission.WORK_ORDER_RELEASE), async (req: Request, res: Response) => {
    const wo = await transition(db, {
      table: 'work_orders',
      id: req.params.id,
      organizationId: req.session!.organization_id,
      from: ['PLANNED'],
      to: 'RELEASED',
      label: 'Work order',
      set: { updated_at: new Date().toISOString() },
    });
    return ok(req, res, { id: wo.id, status: 'RELEASED' });
  });

  app.post('/api/manufacturing/work-orders/:id/cancel', authenticate, requirePermission(Permission.WORK_ORDER_MANAGE), async (req: Request, res: Response) => {
    const out = await db.transaction(async (tx) => {
      const wo = await requireOrgRow(tx, 'work_orders', req.params.id, req.session!.organization_id, 'Work order', { forUpdate: true });
      const cons = await tx.query(`SELECT 1 FROM work_order_consumptions WHERE work_order_id = $1 LIMIT 1`, [wo.id]);
      if (cons.rows.length > 0) throw new ApiError(409, ErrorCode.INVALID_STATE, 'Work orders with material issues must be completed (or scrapped), not cancelled');
      await transition(tx, { table: 'work_orders', id: wo.id, organizationId: req.session!.organization_id, from: ['PLANNED', 'RELEASED'], to: 'CANCELLED', label: 'Work order' });
      return { id: wo.id, status: 'CANCELLED' };
    });
    return ok(req, res, out);
  });

  app.post('/api/manufacturing/work-orders/:id/consume', authenticate, requirePermission(Permission.WORK_ORDER_CONSUME), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const component_item_id = uuid(req.body?.component_item_id, 'component_item_id');
    const consumed_qty = decimal(req.body?.consumed_qty, 'consumed_qty', { sign: 'positive' });
    const lot_id = optionalUuid(req.body?.lot_id, 'lot_id');
    const posting_date = dateOnly(req.body?.posting_date, 'posting_date', { defaultValue: todayIso() });
    const out = await db.transaction(async (tx) => {
      const wo = await requireOrgRow(tx, 'work_orders', req.params.id, org, 'Work order', { forUpdate: true });
      if (!['RELEASED', 'IN_PROGRESS'].includes(wo.status)) {
        throw new ApiError(409, ErrorCode.WORK_ORDER_NOT_RELEASED, `Materials can only be issued to RELEASED/IN_PROGRESS work orders (current: ${wo.status})`);
      }
      const inBom = await tx.query(`SELECT 1 FROM bom_items WHERE bom_id = $1 AND component_item_id = $2`, [wo.bom_id, component_item_id]);
      if (inBom.rows.length === 0) throw validationError('Component is not part of the work order BOM', { field: 'component_item_id' });
      if (lot_id) await assertOrgRef(tx, 'item_lots', lot_id, org, 'lot_id');
      const items = await lockItems(tx, org, [component_item_id]);
      const item = items.get(component_item_id);
      const unitCost = new Money(item.unit_cost || '0').toFixed(8);
      const totalCost = new Money(consumed_qty).mul(unitCost).toFixed(8);
      const cons = (
        await tx.query(
          `INSERT INTO work_order_consumptions (work_order_id, component_item_id, consumed_qty, unit_cost, total_cost, lot_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [wo.id, component_item_id, consumed_qty, unitCost, totalCost, lot_id],
        )
      ).rows[0];
      // Stock leaves the production warehouse (previously no stock or GL effect at all).
      await postStockMovement(tx, {
        organizationId: org,
        legalEntityId: req.session!.legal_entity_id,
        itemId: component_item_id,
        warehouseId: wo.warehouse_id,
        movementType: 'PRODUCTION_ISSUE',
        movementDate: posting_date,
        quantity: new Money(consumed_qty).negated().toFixed(8),
        unitCost,
        referenceType: 'WORK_ORDER',
        referenceId: wo.id,
        description: `Material issue to ${wo.work_order_number}`,
      });
      // Dr WIP / Cr component inventory account.
      const invAccount = item.inventory_account_id || (await accountId(tx, org, '113001'));
      await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: req.session!.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: posting_date,
        purpose: AccountingPurpose.MANUFACTURING_ASSEMBLY_RECEIPT,
        description: `Material issue to WIP: ${wo.work_order_number}`,
        sourceType: 'WORK_ORDER_CONSUMPTION',
        sourceId: cons.id,
        sourceKey: `WO_CONSUMPTION:${cons.id}`,
        numberPrefix: 'JV-MFI',
        correlationId: req.correlationId,
        lines: [
          { account_code: '113003', debit: new Money(totalCost).toFixed(8), description: `WIP ${wo.work_order_number}` },
          { account_id: invAccount, credit: new Money(totalCost).toFixed(8), description: `Component issue ${item.code}` },
        ],
      });
      const agg = await tx.query(`SELECT COALESCE(SUM(total_cost), 0)::text AS t FROM work_order_consumptions WHERE work_order_id = $1`, [wo.id]);
      await tx.query(`UPDATE work_orders SET status = 'IN_PROGRESS', total_material_cost = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [agg.rows[0].t, wo.id]);
      return cons;
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/manufacturing/work-orders/:id/complete', authenticate, requirePermission(Permission.WORK_ORDER_COMPLETE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const posting_date = dateOnly(req.body?.posting_date, 'posting_date', { defaultValue: todayIso() });
    const out = await db.transaction(async (tx) => {
      const wo = await requireOrgRow(tx, 'work_orders', req.params.id, org, 'Work order', { forUpdate: true });
      if (wo.status === 'COMPLETED' || wo.status === 'CLOSED') throw new ApiError(409, ErrorCode.WORK_ORDER_ALREADY_COMPLETED, 'Work order already completed');
      if (wo.status !== 'IN_PROGRESS') throw new ApiError(409, ErrorCode.INVALID_STATE, `Work order must be IN_PROGRESS to complete (current: ${wo.status})`);
      const completed_qty = decimal(req.body?.completed_qty, 'completed_qty', { sign: 'nonNegative', required: false, defaultValue: wo.target_qty });
      const scrapped_qty = decimal(req.body?.scrapped_qty, 'scrapped_qty', { sign: 'nonNegative', required: false, defaultValue: '0' });
      if (new Money(completed_qty).add(scrapped_qty).isZero()) throw validationError('completed_qty + scrapped_qty must be greater than zero');
      const consumptions = (await tx.query(`SELECT * FROM work_order_consumptions WHERE work_order_id = $1`, [wo.id])).rows;
      if (consumptions.length === 0) throw new ApiError(400, ErrorCode.INSUFFICIENT_RAW_MATERIALS, 'No materials recorded as consumed for this work order');

      const woForCalc = { ...wo, completed_qty, scrapped_qty };
      const fgItem = (await lockItems(tx, org, [wo.finished_item_id])).get(wo.finished_item_id);
      const fgAccount = fgItem.inventory_account_id || (await accountId(tx, org, '113004'));
      const draft = ManufacturingEngine.generateCompletionJournal({
        workOrder: woForCalc,
        organizationId: org,
        legalEntityId: req.session!.legal_entity_id,
        finishedGoodsAccountId: fgAccount,
        wipAccountId: await accountId(tx, org, '113003'),
        scrapExpenseAccountId: await accountId(tx, org, '511003'),
        postingDate: posting_date,
        documentDate: posting_date,
        consumptions,
      });
      const costs = ManufacturingEngine.calculateWorkOrderCost(consumptions, completed_qty, scrapped_qty);
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: req.session!.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: posting_date,
        purpose: AccountingPurpose.MANUFACTURING_ASSEMBLY_RECEIPT,
        description: draft.description,
        sourceType: 'WORK_ORDER',
        sourceId: wo.id,
        sourceKey: `WO_COMPLETION:${wo.id}`,
        numberPrefix: 'JV-MFG',
        correlationId: req.correlationId,
        lines: draft.lines.map((l: any) => ({ account_id: l.account_id, debit: l.base_debit, credit: l.base_credit, description: l.description })),
      });
      if (new Money(completed_qty).isPositive()) {
        await postStockMovement(tx, {
          organizationId: org,
          legalEntityId: req.session!.legal_entity_id,
          itemId: wo.finished_item_id,
          warehouseId: wo.warehouse_id,
          movementType: 'PRODUCTION_RECEIPT',
          movementDate: posting_date,
          quantity: new Money(completed_qty).toFixed(8),
          unitCost: costs.finished_unit_cost,
          referenceType: 'WORK_ORDER',
          referenceId: wo.id,
          description: `Finished goods receipt from ${wo.work_order_number}`,
        });
      }
      await transition(tx, {
        table: 'work_orders',
        id: wo.id,
        organizationId: org,
        from: ['IN_PROGRESS'],
        to: 'COMPLETED',
        label: 'Work order',
        set: { completed_qty, scrapped_qty, completion_journal_id: posted?.journalId ?? null, updated_at: new Date().toISOString() },
      });
      await auditLogger.record(
        { organization_id: org, user_id: req.session!.user_id, action: 'WORK_ORDER_COMPLETED', entity_type: 'WORK_ORDER', entity_id: wo.id, after_state: { completed_qty, scrapped_qty, ...costs }, correlation_id: req.correlationId },
        tx,
      );
      return { id: wo.id, status: 'COMPLETED', completion_journal_id: posted?.journalId ?? null, completed_qty, finished_unit_cost: costs.finished_unit_cost };
    });
    return ok(req, res, out);
  });
}
