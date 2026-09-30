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

export function registerPaymentsRoutes(app: Express): void {
  // 13. M2: Payments & Allocations (Receipts & Disbursements)
  // ==========================================
  app.get('/api/payments', authenticate, async (req: Request, res: Response) => {
    const paymentsRes = await db.query(
      `
      SELECT pmt.*, p.name as party_name, a.name as bank_account_name
      FROM payments pmt
      JOIN parties p ON p.id = pmt.party_id
      JOIN accounts a ON a.id = pmt.bank_account_id
      WHERE pmt.organization_id = $1
      ORDER BY pmt.payment_date DESC, pmt.created_at DESC
    `,
      [req.session!.organization_id],
    );

    return res.json({
      success: true,
      data: paymentsRes.rows,
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        total_count: paymentsRes.rows.length,
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/payments/receipt', authenticate, requirePermission(Permission.PAYMENT_MANAGE), async (req: Request, res: Response) => {
    const { party_id, amount, bank_account_id, payment_date, reference, allocations } = req.body;

    if (!party_id || !amount || !bank_account_id) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'party_id, amount, and bank_account_id are required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const pmtAmount = new Money(amount);
    const paymentId = crypto.randomUUID();
    const paymentNumber = `RCT-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    // Accounts: Operating Bank (111002 / custom) and AR Control (112001)
    const arAccRes = await db.query("SELECT id FROM accounts WHERE code = '112001' AND organization_id = $1", [req.session!.organization_id]);
    const arAccId = arAccRes.rows[0].id;
    const journalId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      // 1. Post GL Journal (Dr Bank, Cr AR Control)
      await tx.query(
        `
        INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, source_type, source_id, created_by, posted_by, posted_at
        ) VALUES ($1, $2, $3, $4, $5, $5, 'CUSTOMER_PAYMENT', 'POSTED', 'PKR', $6, $6, $7, 'PAYMENT', $8, $9, $9, CURRENT_TIMESTAMP)
      `,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          `JV-${paymentNumber}`,
          payment_date || new Date().toISOString().slice(0, 10),
          pmtAmount.toFixed(8),
          `Customer Receipt ${paymentNumber}`,
          paymentId,
          req.session!.user_id,
        ],
      );

      await tx.query(
        `
        INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description, party_id)
        VALUES
          ($1, $2, 1, $3, $4, 0, $4, 0, 'Cash received in bank', $5),
          ($6, $2, 2, $7, 0, $4, 0, $4, 'AR settlement', $5)
      `,
        [
          crypto.randomUUID(),
          journalId,
          bank_account_id,
          pmtAmount.toFixed(8),
          party_id,
          crypto.randomUUID(),
          arAccId,
        ],
      );

      // 2. Insert Payment Record
      await tx.query(
        `
        INSERT INTO payments (
          id, organization_id, legal_entity_id, party_id, payment_type, payment_number,
          payment_date, bank_account_id, amount, currency, reference, status, posted_journal_id, created_by
        ) VALUES ($1, $2, $3, $4, 'RECEIPT', $5, $6, $7, $8, 'PKR', $9, 'POSTED', $10, $11)
      `,
        [
          paymentId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          party_id,
          paymentNumber,
          payment_date || new Date().toISOString().slice(0, 10),
          bank_account_id,
          pmtAmount.toFixed(8),
          reference || null,
          journalId,
          req.session!.user_id,
        ],
      );

      // 3. Process Allocations against AR Invoices
      if (allocations && Array.isArray(allocations)) {
        for (const alloc of allocations) {
          const allocId = crypto.randomUUID();
          const allocAmt = new Money(alloc.amount);

          await tx.query(
            `
            INSERT INTO allocations (id, organization_id, payment_id, invoice_id, invoice_type, allocated_amount, allocated_date)
            VALUES ($1, $2, $3, $4, 'AR', $5, $6)
          `,
            [allocId, req.session!.organization_id, paymentId, alloc.invoice_id, allocAmt.toFixed(8), payment_date || new Date().toISOString().slice(0, 10)],
          );

          // Update AR invoice outstanding balance and status
          await tx.query(
            `
            UPDATE ar_invoices
            SET 
              outstanding_amount = GREATEST(0, outstanding_amount - $1),
              status = CASE WHEN outstanding_amount - $1 <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `,
            [allocAmt.toFixed(8), alloc.invoice_id],
          );
        }
      }
    });

    return res.status(201).json({
      success: true,
      data: { id: paymentId, payment_number: paymentNumber, status: 'POSTED' },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  app.post('/api/payments/disbursement', authenticate, requirePermission(Permission.PAYMENT_MANAGE), async (req: Request, res: Response) => {
    const { party_id, amount, bank_account_id, payment_date, reference, allocations } = req.body;

    if (!party_id || !amount || !bank_account_id) {
      return res.status(400).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'party_id, amount, and bank_account_id are required',
          correlation_id: req.correlationId,
        },
      } satisfies StandardErrorResponse);
    }

    const pmtAmount = new Money(amount);
    const paymentId = crypto.randomUUID();
    const paymentNumber = `DISB-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    // Accounts: Trade AP Control (211001) and Operating Bank
    const apAccRes = await db.query("SELECT id FROM accounts WHERE code = '211001' AND organization_id = $1", [req.session!.organization_id]);
    const apAccId = apAccRes.rows[0].id;
    const journalId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      // 1. Post GL Journal (Dr AP Control, Cr Bank)
      await tx.query(
        `
        INSERT INTO journals (
          id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
          accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
          description, source_type, source_id, created_by, posted_by, posted_at
        ) VALUES ($1, $2, $3, $4, $5, $5, 'SUPPLIER_PAYMENT', 'POSTED', 'PKR', $6, $6, $7, 'PAYMENT', $8, $9, $9, CURRENT_TIMESTAMP)
      `,
        [
          journalId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          `JV-${paymentNumber}`,
          payment_date || new Date().toISOString().slice(0, 10),
          pmtAmount.toFixed(8),
          `Supplier Payment ${paymentNumber}`,
          paymentId,
          req.session!.user_id,
        ],
      );

      await tx.query(
        `
        INSERT INTO journal_lines (id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit, description, party_id)
        VALUES
          ($1, $2, 1, $3, $4, 0, $4, 0, 'AP settlement', $5),
          ($6, $2, 2, $7, 0, $4, 0, $4, 'Cash paid from bank', $5)
      `,
        [
          crypto.randomUUID(),
          journalId,
          apAccId,
          pmtAmount.toFixed(8),
          party_id,
          crypto.randomUUID(),
          bank_account_id,
        ],
      );

      // 2. Insert Payment Record
      await tx.query(
        `
        INSERT INTO payments (
          id, organization_id, legal_entity_id, party_id, payment_type, payment_number,
          payment_date, bank_account_id, amount, currency, reference, status, posted_journal_id, created_by
        ) VALUES ($1, $2, $3, $4, 'DISBURSEMENT', $5, $6, $7, $8, 'PKR', $9, 'POSTED', $10, $11)
      `,
        [
          paymentId,
          req.session!.organization_id,
          req.session!.legal_entity_id,
          party_id,
          paymentNumber,
          payment_date || new Date().toISOString().slice(0, 10),
          bank_account_id,
          pmtAmount.toFixed(8),
          reference || null,
          journalId,
          req.session!.user_id,
        ],
      );

      // 3. Process Allocations against AP Bills
      if (allocations && Array.isArray(allocations)) {
        for (const alloc of allocations) {
          const allocId = crypto.randomUUID();
          const allocAmt = new Money(alloc.amount);

          await tx.query(
            `
            INSERT INTO allocations (id, organization_id, payment_id, invoice_id, invoice_type, allocated_amount, allocated_date)
            VALUES ($1, $2, $3, $4, 'AP', $5, $6)
          `,
            [allocId, req.session!.organization_id, paymentId, alloc.invoice_id, allocAmt.toFixed(8), payment_date || new Date().toISOString().slice(0, 10)],
          );

          // Update AP invoice outstanding balance and status
          await tx.query(
            `
            UPDATE ap_invoices
            SET 
              outstanding_amount = GREATEST(0, outstanding_amount - $1),
              status = CASE WHEN outstanding_amount - $1 <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `,
            [allocAmt.toFixed(8), alloc.invoice_id],
          );
        }
      }
    });

    return res.status(201).json({
      success: true,
      data: { id: paymentId, payment_number: paymentNumber, status: 'POSTED' },
      meta: {
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    } satisfies StandardSuccessResponse<any>);
  });

  // ==========================================
}
