import { Money } from '@omnysync/financial-engine';
import crypto from 'node:crypto';
import { DbClient } from '../db/driver.js';
import { AuthService } from '../auth/service.js';
import { STANDARD_COA_TEMPLATE } from '@omnysync/financial-engine';
import { UserRole, JournalStatus, AccountingPurpose } from '@omnysync/contracts';

export interface SeedResult {
  organizationId: string;
  legalEntityId: string;
  branchId: string;
  users: { id: string; email: string; role: string }[];
  accountsCreated: number;
  periodsCreated: number;
  openingJournalId: string;
}

export class SyntheticSeedRunner {
  private db: DbClient;

  constructor(db: DbClient) {
    this.db = db;
  }

  async runSeed(): Promise<SeedResult> {
    const orgId = '10000000-0000-0000-0000-000000000001';
    const legalEntityId = '20000000-0000-0000-0000-000000000001';
    const branchId = '30000000-0000-0000-0000-000000000001';

    // 1. Organization
    await this.db.query(
      `
      INSERT INTO organizations (id, name, code, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    `,
      [orgId, 'Omnysync Global Trading LLC', 'OGT-GLOBAL'],
    );

    // 2. Legal Entity
    await this.db.query(
      `
      INSERT INTO legal_entities (id, organization_id, name, code, functional_currency, tax_identifier, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
    `,
      [legalEntityId, orgId, 'Omnysync Pakistan Pvt Ltd', 'OGT-PK', 'PKR', 'NTN-7890123-4'],
    );

    // 3. Branch
    await this.db.query(
      `
      INSERT INTO branches (id, organization_id, legal_entity_id, name, code, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (legal_entity_id, code) DO UPDATE SET name = EXCLUDED.name
    `,
      [branchId, orgId, legalEntityId, 'Karachi Main Operations', 'KHI-HQ'],
    );

    // 4. Persona Users
    const personas = [
      {
        id: '40000000-0000-0000-0000-000000000001',
        email: 'admin@omnysync.internal',
        name: 'System Administrator',
        role: UserRole.ADMIN,
      },
      {
        id: '40000000-0000-0000-0000-000000000002',
        email: 'controller@omnysync.internal',
        name: 'Financial Controller',
        role: UserRole.CONTROLLER,
      },
      {
        id: '40000000-0000-0000-0000-000000000003',
        email: 'accountant@omnysync.internal',
        name: 'Senior Accountant',
        role: UserRole.ACCOUNTANT,
      },
      {
        id: '40000000-0000-0000-0000-000000000004',
        email: 'auditor@omnysync.internal',
        name: 'Internal Auditor',
        role: UserRole.AUDITOR,
      },
      {
        id: '40000000-0000-0000-0000-000000000005',
        email: 'viewer@omnysync.internal',
        name: 'Executive Viewer',
        role: UserRole.VIEWER,
      },
      {
        id: '40000000-0000-0000-0000-000000000006',
        email: 'cashier@omnysync.internal',
        name: 'Front Counter Cashier',
        role: UserRole.CASHIER,
      },
      {
        id: '40000000-0000-0000-0000-000000000007',
        email: 'storemanager@omnysync.internal',
        name: 'Store Manager',
        role: UserRole.STORE_MANAGER,
      },
    ];

    const defaultPasswordHash = AuthService.hashPassword('Password123!');
    const usersCreated: { id: string; email: string; role: string }[] = [];

    for (const p of personas) {
      await this.db.query(
        `
        INSERT INTO users (id, email, name, password_hash, is_active)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
      `,
        [p.id, p.email, p.name, defaultPasswordHash],
      );

      const membershipId = crypto.randomUUID();
      await this.db.query(
        `
        INSERT INTO memberships (id, organization_id, legal_entity_id, user_id, roles, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (user_id, organization_id) DO UPDATE SET roles = EXCLUDED.roles
      `,
        [membershipId, orgId, legalEntityId, p.id, JSON.stringify([p.role])],
      );

      usersCreated.push({ id: p.id, email: p.email, role: p.role });
    }

    // 5. Chart of Accounts (COA)
    const codeToIdMap = new Map<string, string>();
    let accountsCount = 0;

    for (const item of STANDARD_COA_TEMPLATE) {
      const accountId = crypto.randomUUID();
      const parentId = item.parentCode ? codeToIdMap.get(item.parentCode) || null : null;

      await this.db.query(
        `
        INSERT INTO accounts (
          id, organization_id, legal_entity_id, code, name, parent_id, level,
          statement_class, normal_balance, posting_allowed, control_type, currency_restriction, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
        ON CONFLICT (organization_id, code) DO UPDATE SET
          name = EXCLUDED.name,
          posting_allowed = EXCLUDED.posting_allowed,
          control_type = EXCLUDED.control_type
      `,
        [
          accountId,
          orgId,
          legalEntityId,
          item.code,
          item.name,
          parentId,
          item.level,
          item.statementClass,
          item.normalBalance,
          item.postingAllowed,
          item.controlType,
          item.currencyRestriction || null,
        ],
      );

      // Query actual ID in case of update
      const row = await this.db.query<{ id: string }>(
        `SELECT id FROM accounts WHERE organization_id = $1 AND code = $2`,
        [orgId, item.code],
      );
      if (row.rows[0]) {
        codeToIdMap.set(item.code, row.rows[0].id);
      }
      accountsCount++;
    }

    // 6. Fiscal Periods for 2026
    const months = [
      { num: 1, name: 'Jan 2026', start: '2026-01-01', end: '2026-01-31', status: 'HARD_CLOSED' },
      { num: 2, name: 'Feb 2026', start: '2026-02-01', end: '2026-02-28', status: 'SOFT_CLOSED' },
      { num: 3, name: 'Mar 2026', start: '2026-03-01', end: '2026-03-31', status: 'OPEN' },
      { num: 4, name: 'Apr 2026', start: '2026-04-01', end: '2026-04-30', status: 'OPEN' },
      { num: 5, name: 'May 2026', start: '2026-05-01', end: '2026-05-31', status: 'OPEN' },
      { num: 6, name: 'Jun 2026', start: '2026-06-01', end: '2026-06-30', status: 'OPEN' },
      { num: 7, name: 'Jul 2026', start: '2026-07-01', end: '2026-07-31', status: 'OPEN' },
      { num: 8, name: 'Aug 2026', start: '2026-08-01', end: '2026-08-31', status: 'OPEN' },
      { num: 9, name: 'Sep 2026', start: '2026-09-01', end: '2026-09-30', status: 'OPEN' },
      { num: 10, name: 'Oct 2026', start: '2026-10-01', end: '2026-10-31', status: 'OPEN' },
      { num: 11, name: 'Nov 2026', start: '2026-11-01', end: '2026-11-30', status: 'OPEN' },
      { num: 12, name: 'Dec 2026', start: '2026-12-01', end: '2026-12-31', status: 'OPEN' },
    ];

    let periodsCount = 0;
    for (const m of months) {
      const pId = crypto.randomUUID();
      await this.db.query(
        `
        INSERT INTO fiscal_periods (
          id, organization_id, legal_entity_id, fiscal_year, period_number, period_name, start_date, end_date, status
        )
        VALUES ($1, $2, $3, 2026, $4, $5, $6, $7, $8)
        ON CONFLICT (legal_entity_id, fiscal_year, period_number) DO UPDATE SET status = EXCLUDED.status
      `,
        [pId, orgId, legalEntityId, m.num, m.name, m.start, m.end, m.status],
      );
      periodsCount++;
    }

    // 7. Seed Opening Balance Journal Entry (Posted & Reconciled)
    const openingJournalId = '50000000-0000-0000-0000-000000000001';
    const bankId = codeToIdMap.get('111002')!;
    const inventoryId = codeToIdMap.get('113001')!;
    const equipmentId = codeToIdMap.get('121001')!;
    const shareCapitalId = codeToIdMap.get('311001')!;
    const retainedEarningsId = codeToIdMap.get('321001')!;

    // Journal header + lines form one unit of work: the deferred balance constraint
    // (migration 011) validates the posted journal at COMMIT.
    await this.db.transaction(async (tx) => {
    await tx.query(
      `
      INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date,
        accounting_purpose, status, base_currency, total_base_debit, total_base_credit,
        description, created_by, approved_by, posted_by, posted_at, revision
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, 1)
      ON CONFLICT (legal_entity_id, journal_number) DO NOTHING
    `,
      [
        openingJournalId,
        orgId,
        legalEntityId,
        'JV-2026-0001-OPENING',
        '2026-03-01',
        '2026-03-01',
        AccountingPurpose.OPENING_BALANCE,
        JournalStatus.POSTED,
        'PKR',
        '25000000.00000000',
        '25000000.00000000',
        'Deterministic synthetic opening balance for demonstration and testing',
        personas[0].id,
        personas[1].id,
        personas[1].id,
      ],
    );

    // Insert Opening Journal Lines
    const lines = [
      { num: 1, acc: bankId, dr: '10000000.00000000', cr: '0.00000000', desc: 'Opening Operating Bank Balance' },
      { num: 2, acc: inventoryId, dr: '8000000.00000000', cr: '0.00000000', desc: 'Opening Trading Inventory' },
      { num: 3, acc: equipmentId, dr: '7000000.00000000', cr: '0.00000000', desc: 'Opening Equipment & Assets' },
      { num: 4, acc: shareCapitalId, dr: '0.00000000', cr: '20000000.00000000', desc: 'Owner Contributed Capital' },
      { num: 5, acc: retainedEarningsId, dr: '0.00000000', cr: '5000000.00000000', desc: 'Cumulative Retained Earnings' },
    ];

    for (const l of lines) {
      const lineId = crypto.randomUUID();
      await tx.query(
        `
        INSERT INTO journal_lines (
          id, journal_id, line_number, account_id, debit_amount, credit_amount,
          currency, fx_rate, base_debit, base_credit, description
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'PKR', 1.0, $7, $8, $9)
        ON CONFLICT (journal_id, line_number) DO NOTHING
      `,
        [lineId, openingJournalId, l.num, l.acc, l.dr, l.cr, l.dr, l.cr, l.desc],
      );
    }
    });

    // 8. Seed Parties (Customers & Vendors)
    const parties = [
      {
        id: '60000000-0000-0000-0000-000000000001',
        code: 'VEND-001',
        name: 'Apex Industrial Supplies Ltd',
        type: 'VENDOR',
        email: 'billing@apexsupplies.pk',
        tax: 'NTN-4567890-1',
        limit: '0',
      },
      {
        id: '60000000-0000-0000-0000-000000000002',
        code: 'CUST-001',
        name: 'Horizon Retail Enterprises',
        type: 'CUSTOMER',
        email: 'orders@horizonretail.com',
        tax: 'NTN-1234567-8',
        limit: '5000000.00',
      },
      {
        id: '60000000-0000-0000-0000-000000000003',
        code: 'CUST-002',
        name: 'Crescent Logistics & Trade',
        type: 'CUSTOMER',
        email: 'accounts@crescenttrade.pk',
        tax: 'NTN-9876543-2',
        limit: '10000000.00',
      },
    ];

    for (const p of parties) {
      await this.db.query(
        `
        INSERT INTO parties (
          id, organization_id, legal_entity_id, code, name, party_type, tax_identifier, email, credit_limit, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, credit_limit = EXCLUDED.credit_limit
      `,
        [p.id, orgId, legalEntityId, p.code, p.name, p.type, p.tax, p.email, p.limit],
      );
    }

    // 9. Seed Items
    const salesAccId = codeToIdMap.get('411001')!;
    const cogsAccId = codeToIdMap.get('511001')!;
    const items = [
      {
        id: '70000000-0000-0000-0000-000000000001',
        code: 'ITEM-SRV-01',
        name: 'Enterprise Server Rack Unit',
        type: 'INVENTORY',
        uom: 'UNIT',
        price: '450000.00',
        cost: '320000.00',
        qty: '15',
      },
      {
        id: '70000000-0000-0000-0000-000000000002',
        code: 'ITEM-SW-48',
        name: 'Managed Switch 48-Port PoE',
        type: 'INVENTORY',
        uom: 'UNIT',
        price: '180000.00',
        cost: '120000.00',
        qty: '25',
      },
      {
        // Brings the opening stock subledger (7.8M + 0.2M) into agreement with the
        // 8,000,000 opening Inventory control balance (113001). Previously the
        // subledger totalled 7,800,000 and never reconciled to the GL.
        id: '70000000-0000-0000-0000-000000000004',
        code: 'ITEM-CAT6-BOX',
        name: 'Cat6 Patch Cable Box (305m)',
        type: 'INVENTORY',
        uom: 'BOX',
        price: '7500.00',
        cost: '5000.00',
        qty: '40',
      },
      {
        id: '70000000-0000-0000-0000-000000000003',
        code: 'SRV-CONSULT',
        name: 'Cloud Deployment Consultation',
        type: 'SERVICE',
        uom: 'HOUR',
        price: '25000.00',
        cost: '0.00',
        qty: '0',
      },
    ];

    for (const itm of items) {
      await this.db.query(
        `
        INSERT INTO items (
          id, organization_id, legal_entity_id, code, name, item_type, uom,
          unit_price, unit_cost, sales_account_id, cogs_account_id, inventory_account_id, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
        ON CONFLICT (organization_id, code) DO UPDATE SET
          name = EXCLUDED.name, unit_price = EXCLUDED.unit_price, unit_cost = EXCLUDED.unit_cost
      `,
        [
          itm.id,
          orgId,
          legalEntityId,
          itm.code,
          itm.name,
          itm.type,
          itm.uom,
          itm.price,
          itm.cost,
          salesAccId,
          cogsAccId,
          itm.type === 'INVENTORY' ? inventoryId : null,
        ],
      );

      // Add opening stock movement if inventory item
      if (itm.type === 'INVENTORY') {
        // Deterministic id + ON CONFLICT: re-running the seed no longer duplicates
        // opening stock (it previously doubled on-hand quantity on every run).
        const movId = `7a000000-0000-0000-0000-${itm.id.slice(-12)}`;
        const totalVal = new Money(itm.cost).mul(itm.qty).toFixed(8);
        await this.db.query(
          `
          INSERT INTO stock_movements (
            id, organization_id, legal_entity_id, item_id, warehouse_id,
            movement_type, movement_date, quantity, unit_cost, total_value, description
          )
          VALUES ($1, $2, $3, $4, $5, 'OPENING', '2026-03-01', $6, $7, $8, 'Opening Stock Layer')
          ON CONFLICT (id) DO NOTHING
        `,
          [movId, orgId, legalEntityId, itm.id, branchId, itm.qty, itm.cost, totalVal],
        );
      }
    }

    // 10. Seed Warehouses & Bins
    const mainWhId = '00000000-0000-0000-0000-000000000010';
    const prodWhId = '00000000-0000-0000-0000-000000000011';
    await this.db.query(
      `
      INSERT INTO warehouses (id, code, name, address, is_default, is_active, organization_id)
      VALUES ($1, 'WH-MAIN', 'Central Distribution Warehouse', 'Plot 45, Sector 15, Korangi Industrial Area, Karachi', true, true, $2)
      ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
    `,
      [mainWhId, orgId],
    );

    await this.db.query(
      `
      INSERT INTO warehouses (id, code, name, address, is_default, is_active, organization_id)
      VALUES ($1, 'WH-PROD', 'Manufacturing & Assembly Plant', 'Plot 12, Industrial Estate, SITE, Karachi', false, true, $2)
      ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
    `,
      [prodWhId, orgId],
    );

    const zoneId = '00000000-0000-0000-0000-000000000020';
    await this.db.query(
      `
      INSERT INTO warehouse_zones (id, warehouse_id, code, name, zone_type)
      VALUES ($1, $2, 'ZONE-A', 'Primary Pallet Racking Zone', 'STORAGE')
      ON CONFLICT (warehouse_id, code) DO UPDATE SET name = EXCLUDED.name
    `,
      [zoneId, mainWhId],
    );

    await this.db.query(
      `
      INSERT INTO warehouse_bins (id, warehouse_id, zone_id, bin_code, max_weight_capacity, is_active)
      VALUES ($1, $2, $3, 'BIN-A-01-01', 1000.00, true)
      ON CONFLICT (warehouse_id, bin_code) DO UPDATE SET is_active = true
    `,
      ['00000000-0000-0000-0000-000000000030', mainWhId, zoneId],
    );

    return {
      organizationId: orgId,
      legalEntityId: legalEntityId,
      branchId: branchId,
      users: usersCreated,
      accountsCreated: accountsCount,
      periodsCreated: periodsCount,
      openingJournalId,
    };
  }
}
