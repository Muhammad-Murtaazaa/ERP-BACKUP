import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { Money, FixedAssetsEngine } from '@omnysync/financial-engine';
import { AccountingPurpose, ErrorCode, Permission } from '@omnysync/contracts';
import { db, auditLogger, outboxService, authenticate, requirePermission, requireAnyPermission } from '../context.js';
import { ok } from '../lib/http.js';
import { ApiError, validationError } from '../lib/errors.js';
import { bool, dateOnly, decimal, int, oneOf, optionalStr, optionalUuid, str, todayIso, toIsoDate, uuid } from '../lib/validate.js';
import { requireOrgRow } from '../lib/scope.js';
import { postJournal } from '../lib/posting.js';
import { nextDocumentNumber } from '../lib/numbering.js';
import { accountByCode } from '../lib/trading.js';

const METHODS = ['STRAIGHT_LINE', 'DECLINING_BALANCE'] as const;

async function leafOrNull(org: string, id: string | null, field: string) {
  if (!id) return null;
  const r = await db.query(`SELECT id FROM accounts WHERE id = $1 AND organization_id = $2 AND level = 4 AND is_active = true`, [id, org]);
  if (!r.rows[0]) throw validationError(`${field} must be an active posting account`, { field });
  return id;
}

/**
 * Depreciates one asset for one fiscal period. Shared by the API and the scheduled
 * depreciation run (automation). Idempotent per (asset, period): the unique index on
 * asset_depreciation_entries plus the journal source key prevent double depreciation.
 */
export async function depreciateAsset(tx: any, ctx: { organizationId: string; legalEntityId: string; userId: string; correlationId?: string }, assetId: string, periodId: string, periodMonths = 1) {
  const org = ctx.organizationId;
  const asset = (
    await tx.query(
      `SELECT fa.*, ac.deprec_expense_account_id, ac.accumulated_deprec_account_id FROM fixed_assets fa
       JOIN asset_categories ac ON ac.id = fa.category_id WHERE fa.id::text = $1 AND fa.organization_id = $2 FOR UPDATE OF fa`,
      [assetId, org],
    )
  ).rows[0];
  if (!asset) throw new ApiError(404, ErrorCode.RESOURCE_NOT_FOUND, 'Fixed asset not found');
  if (asset.status !== 'ACTIVE') throw new ApiError(409, ErrorCode.ASSET_NOT_ACTIVE, `Asset is ${asset.status}, not eligible for depreciation`);
  const period = await requireOrgRow(tx, 'fiscal_periods', periodId, org, 'Fiscal period');
  const periodEnd = toIsoDate(period.end_date);
  if (periodEnd < toIsoDate(asset.acquisition_date)) throw validationError('Cannot depreciate for a period ending before the acquisition date', { field: 'period_id' });
  const dup = await tx.query(`SELECT id FROM asset_depreciation_entries WHERE asset_id = $1 AND period_id = $2`, [asset.id, period.id]);
  if (dup.rows.length) throw new ApiError(409, ErrorCode.ALREADY_POSTED, `Asset ${asset.asset_number} is already depreciated for ${period.period_name}`);

  const expenseAccountId = asset.deprec_expense_account_id || (await accountByCode(tx, org, '521004'));
  const accumulatedAccountId = asset.accumulated_deprec_account_id || (await accountByCode(tx, org, '121002'));
  const calc = FixedAssetsEngine.calculateDepreciation(asset.acquisition_cost, asset.accumulated_depreciation, asset.salvage_value, asset.useful_life_months, asset.depreciation_method, periodMonths);
  // Round to currency and never depreciate below salvage (the final period absorbs the residual).
  const bookValue = new Money(asset.acquisition_cost).sub(asset.accumulated_depreciation);
  const headroom = bookValue.sub(asset.salvage_value);
  let amount = new Money(calc.depreciation_amount).round(2);
  if (amount.gt(headroom)) amount = headroom;
  if (!amount.isPositive()) throw new ApiError(409, ErrorCode.VALIDATION_FAILED, 'Asset is already fully depreciated down to salvage value');
  const accumulatedAfter = new Money(asset.accumulated_depreciation).add(amount);
  const bookAfter = new Money(asset.acquisition_cost).sub(accumulatedAfter);

  const posted = await postJournal(tx, auditLogger, outboxService, {
    organizationId: org,
    legalEntityId: ctx.legalEntityId,
    userId: ctx.userId,
    postingDate: periodEnd,
    purpose: AccountingPurpose.FIXED_ASSET_DEPRECIATION,
    description: `Depreciation ${asset.asset_number} ${asset.name} — ${period.period_name}`,
    sourceType: 'FIXED_ASSET',
    sourceId: asset.id,
    sourceKey: `DEPRECIATION:${asset.id}:${period.id}`,
    numberPrefix: 'JV-DEP',
    correlationId: ctx.correlationId,
    lines: [
      { account_id: expenseAccountId, debit: amount.toFixed(8), description: `Depreciation expense ${asset.asset_number}` },
      { account_id: accumulatedAccountId, credit: amount.toFixed(8), description: `Accumulated depreciation ${asset.asset_number}` },
    ],
  });
  await tx.query(
    `INSERT INTO asset_depreciation_entries (id, asset_id, period_id, entry_date, depreciation_amount, accumulated_depreciation_after, book_value_after, journal_id, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [crypto.randomUUID(), asset.id, period.id, periodEnd, amount.toFixed(8), accumulatedAfter.toFixed(8), bookAfter.toFixed(8), posted?.journalId ?? null, org],
  );
  const newStatus = bookAfter.lte(asset.salvage_value) ? 'FULLY_DEPRECIATED' : 'ACTIVE';
  await tx.query(`UPDATE fixed_assets SET accumulated_depreciation = $1, current_book_value = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`, [
    accumulatedAfter.toFixed(8),
    bookAfter.toFixed(8),
    newStatus,
    asset.id,
  ]);
  return { id: asset.id, asset_number: asset.asset_number, depreciation_amount: amount.format(), accumulated_depreciation: accumulatedAfter.format(), current_book_value: bookAfter.format(), status: newStatus, journal_id: posted?.journalId ?? null };
}

export function registerAssetsRoutes(app: Express): void {
  const assetRead = requireAnyPermission(Permission.ASSET_MANAGE, Permission.ASSET_DEPRECIATE, Permission.ASSET_DISPOSE, Permission.FINANCE_REPORTS_VIEW, Permission.FINANCE_COA_VIEW);

  app.get('/api/assets/categories', authenticate, assetRead, async (req: Request, res: Response) => {
    const r = await db.query('SELECT * FROM asset_categories WHERE organization_id = $1 ORDER BY code ASC', [req.session!.organization_id]);
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  app.post('/api/assets/categories', authenticate, requirePermission(Permission.ASSET_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const b = req.body || {};
    const code = str(b.code, 'code', { max: 32 });
    const name = str(b.name, 'name', { max: 255 });
    const method = oneOf(b.depreciation_method, 'depreciation_method', METHODS, 'STRAIGHT_LINE');
    const life = int(b.useful_life_months, 'useful_life_months', { min: 1, max: 1200, defaultValue: 60 });
    const salvagePct = decimal(b.salvage_value_percentage == null ? undefined : String(b.salvage_value_percentage), 'salvage_value_percentage', { required: false, defaultValue: '0', scale: 4 });
    if (new Money(salvagePct).gt(100)) throw validationError('salvage_value_percentage cannot exceed 100', { field: 'salvage_value_percentage' });
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO asset_categories (id, code, name, depreciation_method, useful_life_months, salvage_value_percentage, asset_cost_account_id, accumulated_deprec_account_id, deprec_expense_account_id, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        code,
        name,
        method,
        life,
        salvagePct,
        await leafOrNull(org, optionalUuid(b.asset_cost_account_id, 'asset_cost_account_id'), 'asset_cost_account_id'),
        await leafOrNull(org, optionalUuid(b.accumulated_deprec_account_id, 'accumulated_deprec_account_id'), 'accumulated_deprec_account_id'),
        await leafOrNull(org, optionalUuid(b.deprec_expense_account_id, 'deprec_expense_account_id'), 'deprec_expense_account_id'),
        org,
      ],
    );
    return ok(req, res, { id, code, name }, 201);
  });

  app.get('/api/assets', authenticate, assetRead, async (req: Request, res: Response) => {
    const r = await db.query(
      `SELECT fa.*, ac.name as category_name FROM fixed_assets fa JOIN asset_categories ac ON ac.id = fa.category_id
       WHERE fa.organization_id = $1 ORDER BY fa.asset_number ASC`,
      [req.session!.organization_id],
    );
    return ok(req, res, r.rows, 200, { total_count: r.rows.length });
  });

  app.get('/api/assets/:id/schedule', authenticate, assetRead, async (req: Request, res: Response) => {
    const asset = await requireOrgRow(db, 'fixed_assets', req.params.id, req.session!.organization_id, 'Fixed asset');
    const r = await db.query(
      `SELECT e.*, fp.period_name FROM asset_depreciation_entries e JOIN fiscal_periods fp ON fp.id = e.period_id WHERE e.asset_id = $1 ORDER BY e.entry_date`,
      [asset.id],
    );
    return ok(req, res, { asset, entries: r.rows });
  });

  app.post('/api/assets', authenticate, requirePermission(Permission.ASSET_MANAGE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const b = req.body || {};
    const name = str(b.name, 'name', { max: 255 });
    const category_id = uuid(b.category_id, 'category_id');
    const category = await requireOrgRow(db, 'asset_categories', category_id, org, 'Asset category');
    const acquisition_date = dateOnly(b.acquisition_date, 'acquisition_date', { defaultValue: todayIso() });
    const cost = decimal(b.acquisition_cost, 'acquisition_cost', { sign: 'positive', scale: 2 });
    const salvage = decimal(b.salvage_value, 'salvage_value', {
      required: false,
      scale: 2,
      defaultValue: new Money(cost).mul(category.salvage_value_percentage || '0').div(100).round(2).toFixed(2),
    });
    if (new Money(salvage).gt(cost)) throw validationError('salvage_value cannot exceed acquisition_cost', { field: 'salvage_value' });
    const life = int(b.useful_life_months, 'useful_life_months', { min: 1, max: 1200, defaultValue: Number(category.useful_life_months) || 60 });
    const method = oneOf(b.depreciation_method, 'depreciation_method', METHODS, category.depreciation_method || 'STRAIGHT_LINE');
    // Capitalisation posting is explicit: registering a migrated asset (already in the
    // opening GL balance) must not post again, while a new purchase should.
    const postAcquisition = bool(b.post_acquisition, false);
    const fundingAccountId = optionalUuid(b.funding_account_id, 'funding_account_id');
    const id = crypto.randomUUID();
    const out = await db.transaction(async (tx) => {
      const asset_number = optionalStr(b.asset_number, 'asset_number', 64) || (await nextDocumentNumber(tx, org, 'FA', acquisition_date));
      await tx.query(
        `INSERT INTO fixed_assets (id, asset_number, name, category_id, acquisition_date, acquisition_cost, salvage_value, useful_life_months, depreciation_method, status,
           location, custodian_name, serial_number, current_book_value, accumulated_depreciation, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, $11, $12, $6, 0, $13)`,
        [id, asset_number, name, category_id, acquisition_date, cost, salvage, life, method, optionalStr(b.location, 'location', 255), optionalStr(b.custodian_name, 'custodian_name', 255), optionalStr(b.serial_number, 'serial_number', 128), org],
      );
      let journalId: string | null = null;
      if (postAcquisition) {
        const costAcc = category.asset_cost_account_id || (await accountByCode(tx, org, '121001'));
        const funding = fundingAccountId ? (await leafOrNull(org, fundingAccountId, 'funding_account_id'))! : await accountByCode(tx, org, '211001');
        const posted = await postJournal(tx, auditLogger, outboxService, {
          organizationId: org,
          legalEntityId: req.session!.legal_entity_id,
          userId: req.session!.user_id,
          postingDate: acquisition_date,
          purpose: AccountingPurpose.FIXED_ASSET_ACQUISITION,
          description: `Capitalisation of ${asset_number} ${name}`,
          sourceType: 'FIXED_ASSET',
          sourceId: id,
          sourceKey: `ASSET_ACQUISITION:${id}`,
          numberPrefix: 'JV-FA',
          correlationId: req.correlationId,
          lines: [
            { account_id: costAcc, debit: cost, description: `Asset cost ${asset_number}` },
            { account_id: funding, credit: cost, description: `Funding for ${asset_number}` },
          ],
        });
        journalId = posted?.journalId ?? null;
      }
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'ASSET_REGISTERED', entity_type: 'FIXED_ASSET', entity_id: id, after_state: { asset_number, cost, salvage, life, method, acquisition_journal_id: journalId }, correlation_id: req.correlationId }, tx);
      return { id, asset_number, name, acquisition_cost: cost, status: 'ACTIVE', acquisition_journal_id: journalId };
    });
    return ok(req, res, out, 201);
  });

  app.post('/api/assets/:id/depreciate', authenticate, requirePermission(Permission.ASSET_DEPRECIATE), async (req: Request, res: Response) => {
    const period_id = str(req.body?.period_id, 'period_id', { max: 64 });
    const months = int(req.body?.period_months, 'period_months', { min: 1, max: 12, defaultValue: 1 });
    const out = await db.transaction((tx) =>
      depreciateAsset(tx, { organizationId: req.session!.organization_id, legalEntityId: req.session!.legal_entity_id, userId: req.session!.user_id, correlationId: req.correlationId }, req.params.id, period_id, months),
    );
    return ok(req, res, out);
  });

  /** Batch depreciation run for all ACTIVE assets in a period (skips already-run assets). */
  app.post('/api/assets/depreciation-run', authenticate, requirePermission(Permission.ASSET_DEPRECIATE), async (req: Request, res: Response) => {
    const period_id = str(req.body?.period_id, 'period_id', { max: 64 });
    await requireOrgRow(db, 'fiscal_periods', period_id, req.session!.organization_id, 'Fiscal period');
    const assets = (await db.query(`SELECT id FROM fixed_assets WHERE organization_id = $1 AND status = 'ACTIVE' ORDER BY asset_number`, [req.session!.organization_id])).rows;
    const results: any[] = [];
    for (const a of assets) {
      try {
        results.push({ ...(await db.transaction((tx) => depreciateAsset(tx, { organizationId: req.session!.organization_id, legalEntityId: req.session!.legal_entity_id, userId: req.session!.user_id, correlationId: req.correlationId }, a.id, period_id))), outcome: 'POSTED' });
      } catch (err: any) {
        results.push({ id: a.id, outcome: 'SKIPPED', reason: err.message });
      }
    }
    return ok(req, res, results, 200, { posted: results.filter((r) => r.outcome === 'POSTED').length, skipped: results.filter((r) => r.outcome === 'SKIPPED').length });
  });

  app.post('/api/assets/:id/dispose', authenticate, requirePermission(Permission.ASSET_DISPOSE), async (req: Request, res: Response) => {
    const org = req.session!.organization_id;
    const proceeds = decimal(req.body?.proceeds, 'proceeds', { required: false, defaultValue: '0', scale: 2 });
    const disposal_date = dateOnly(req.body?.disposal_date, 'disposal_date', { defaultValue: todayIso() });
    const bankAccountId = optionalUuid(req.body?.bank_account_id, 'bank_account_id');
    const out = await db.transaction(async (tx) => {
      const asset = (
        await tx.query(
          `SELECT fa.*, ac.asset_cost_account_id, ac.accumulated_deprec_account_id FROM fixed_assets fa JOIN asset_categories ac ON ac.id = fa.category_id
           WHERE fa.id::text = $1 AND fa.organization_id = $2 FOR UPDATE OF fa`,
          [req.params.id, org],
        )
      ).rows[0];
      if (!asset) throw new ApiError(404, ErrorCode.RESOURCE_NOT_FOUND, 'Fixed asset not found');
      if (asset.status === 'DISPOSED' || asset.status === 'WRITTEN_OFF') throw new ApiError(409, ErrorCode.ASSET_ALREADY_DISPOSED, 'Asset already disposed');
      if (disposal_date < toIsoDate(asset.acquisition_date)) throw validationError('disposal_date cannot be before acquisition_date', { field: 'disposal_date' });
      // Gains/losses go to dedicated accounts (previously Service Income / Product COGS).
      const draft = FixedAssetsEngine.generateDisposalJournal({
        organization_id: org,
        legal_entity_id: req.session!.legal_entity_id,
        period_id: '',
        posting_date: disposal_date,
        asset_number: asset.asset_number,
        asset_name: asset.name,
        acquisition_cost: asset.acquisition_cost,
        accumulated_depreciation: asset.accumulated_depreciation,
        proceeds: new Money(proceeds).toFixed(8),
        asset_cost_account_id: asset.asset_cost_account_id || (await accountByCode(tx, org, '121001')),
        accumulated_deprec_account_id: asset.accumulated_deprec_account_id || (await accountByCode(tx, org, '121002')),
        bank_account_id: bankAccountId ? (await leafOrNull(org, bankAccountId, 'bank_account_id'))! : await accountByCode(tx, org, '111002'),
        gain_account_id: await accountByCode(tx, org, '411005'),
        loss_account_id: await accountByCode(tx, org, '521007'),
      });
      const posted = await postJournal(tx, auditLogger, outboxService, {
        organizationId: org,
        legalEntityId: req.session!.legal_entity_id,
        userId: req.session!.user_id,
        postingDate: disposal_date,
        purpose: AccountingPurpose.FIXED_ASSET_DISPOSAL,
        description: draft.description,
        sourceType: 'FIXED_ASSET',
        sourceId: asset.id,
        sourceKey: `ASSET_DISPOSAL:${asset.id}`,
        numberPrefix: 'JV-DSP',
        correlationId: req.correlationId,
        lines: draft.lines.map((l: any) => ({ account_id: l.account_id, debit: l.base_debit, credit: l.base_credit, description: l.description })),
      });
      await tx.query(
        `UPDATE fixed_assets SET status = 'DISPOSED', disposal_date = $1, disposal_proceeds = $2, disposal_journal_id = $3, current_book_value = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
        [disposal_date, proceeds, posted?.journalId ?? null, asset.id],
      );
      const nbv = new Money(asset.acquisition_cost).sub(asset.accumulated_depreciation);
      await auditLogger.record({ organization_id: org, user_id: req.session!.user_id, action: 'ASSET_DISPOSED', entity_type: 'FIXED_ASSET', entity_id: asset.id, before_state: { status: asset.status, book_value: nbv.format() }, after_state: { proceeds, gain_loss: new Money(proceeds).sub(nbv).format() }, correlation_id: req.correlationId }, tx);
      return { id: asset.id, status: 'DISPOSED', journal_id: posted?.journalId ?? null, gain_loss: new Money(proceeds).sub(nbv).format() };
    });
    return ok(req, res, out);
  });
}
