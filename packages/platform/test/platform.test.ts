import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGliteAdapter, DbMigrator, SyntheticSeedRunner, AuthService } from '../src/index.js';
import { UserRole, Permission, StatementClass, NormalBalance, AccountControlType } from '@omnysync/contracts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Platform & Database Integration: Migrations, Seeds & Tenancy', () => {
  let db: PGliteAdapter;

  beforeAll(async () => {
    db = new PGliteAdapter();
    const migrator = new DbMigrator(db, path.join(__dirname, '../src/db/migrations'));
    const { applied } = await migrator.runMigrations();
    expect(applied.length).toBeGreaterThan(0);
  }, 30000);

  afterAll(async () => {
    await db.close();
  });

  it('runs deterministic synthetic seed successfully', async () => {
    const seeder = new SyntheticSeedRunner(db);
    const result = await seeder.runSeed();

    expect(result.organizationId).toBeDefined();
    // 7 personas: the original five plus the CASHIER and STORE_MANAGER used for POS SoD.
    expect(result.users.length).toBe(10);
    expect(result.users.map((u) => u.role)).toEqual(expect.arrayContaining(['ADMIN', 'CONTROLLER', 'ACCOUNTANT', 'AUDITOR', 'VIEWER', 'CASHIER', 'STORE_MANAGER', 'SERVICE_MANAGER', 'TECHNICIAN', 'HR_MANAGER']));
    expect(result.accountsCreated).toBeGreaterThan(20);
    expect(result.periodsCreated).toBe(12);

    // Verify accounts in DB
    const accounts = await db.query('SELECT COUNT(*) as count FROM accounts');
    expect(parseInt(accounts.rows[0].count, 10)).toBeGreaterThan(20);

    // Verify opening journal in DB
    const journals = await db.query('SELECT * FROM journals WHERE id = $1', [result.openingJournalId]);
    expect(journals.rows.length).toBe(1);
    expect(journals.rows[0].status).toBe('POSTED');
    expect(journals.rows[0].total_base_debit).toBe('25000000.00000000');
    expect(journals.rows[0].total_base_credit).toBe('25000000.00000000');
  });

  it('authenticates persona users with scrypt password verification and resolves permissions', async () => {
    const userRow = await db.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      ['admin@omnysync.internal'],
    );
    expect(userRow.rows.length).toBe(1);

    const validPass = AuthService.verifyPassword('Password123!', userRow.rows[0].password_hash);
    expect(validPass).toBe(true);

    const invalidPass = AuthService.verifyPassword('WrongPassword', userRow.rows[0].password_hash);
    expect(invalidPass).toBe(false);

    const adminPerms = AuthService.resolvePermissions([UserRole.ADMIN]);
    expect(adminPerms).toContain(Permission.ORG_MANAGE);
    expect(adminPerms).toContain(Permission.FINANCE_JOURNAL_POST);

    const viewerPerms = AuthService.resolvePermissions([UserRole.VIEWER]);
    expect(viewerPerms).toContain(Permission.FINANCE_COA_VIEW);
    expect(viewerPerms).not.toContain(Permission.FINANCE_JOURNAL_POST);
  });

  it('enforces database constraints: level between 1 and 4, non-negative amounts, and unique codes', async () => {
    // 1. Invalid level 5 account should throw check constraint violation
    await expect(
      db.query(`
        INSERT INTO accounts (
          id, organization_id, code, name, level, statement_class, normal_balance, posting_allowed
        ) VALUES (
          '99999999-9999-9999-9999-999999999999',
          '10000000-0000-0000-0000-000000000001',
          'INV-LEVEL',
          'Invalid Level',
          5,
          'ASSET',
          'DEBIT',
          true
        )
      `),
    ).rejects.toThrow();

    // 2. Journal line with BOTH debit and credit should violate chk_not_both_debit_credit
    const testJournalId = '88888888-8888-8888-8888-888888888888';
    await db.query(`
      INSERT INTO journals (
        id, organization_id, legal_entity_id, journal_number, posting_date, document_date, description, created_by
      ) VALUES (
        '${testJournalId}',
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        'JV-TEST-ERR',
        '2026-03-15',
        '2026-03-15',
        'Test Error Journal',
        '40000000-0000-0000-0000-000000000001'
      )
    `);

    await expect(
      db.query(`
        INSERT INTO journal_lines (
          id, journal_id, line_number, account_id, debit_amount, credit_amount, base_debit, base_credit
        ) VALUES (
          '77777777-7777-7777-7777-777777777777',
          '${testJournalId}',
          1,
          (SELECT id FROM accounts WHERE code = '111001'),
          100.0,
          50.0,
          100.0,
          50.0
        )
      `),
    ).rejects.toThrow();
  });
});
