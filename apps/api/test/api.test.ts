import { describe, it, expect, beforeAll } from 'vitest';
import { app, db } from '../src/index.js';
import { DbMigrator, SyntheticSeedRunner } from '@omnysync/platform';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for testing express endpoints without opening external network ports
async function makeRequest(
  method: 'GET' | 'POST',
  pathStr: string,
  body?: any,
  token?: string,
) {
  // Use node fetch or express request simulation
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    // Mock express request
    const req: any = {
      method,
      url: pathStr,
      originalUrl: pathStr,
      headers,
      body: body || {},
      query: {},
      params: {},
    };

    // Parse query params
    if (pathStr.includes('?')) {
      const [p, q] = pathStr.split('?');
      req.url = p;
      req.originalUrl = pathStr;
      const searchParams = new URLSearchParams(q);
      for (const [k, v] of searchParams.entries()) {
        req.query[k] = v;
      }
    }

    const res: any = {
      statusCode: 200,
      headers: {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      json(data: any) {
        resolve({ status: this.statusCode, body: data });
      },
      on(_event: string, _cb: any) {},
    };

    (app as any).handle(req, res, (err: any) => {
      if (err) reject(err);
      else resolve({ status: res.statusCode, body: null });
    });
  });
}

describe('API Modular Monolith: Financial Workflow E2E Integration', () => {
  let adminToken: string;
  let controllerToken: string;
  let accountantToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    const migrator = new DbMigrator(db, path.join(__dirname, '../../../packages/platform/src/db/migrations'));
    await migrator.runMigrations();
    const seeder = new SyntheticSeedRunner(db);
    await seeder.runSeed();

    // Authenticate Admin
    const adminRes = await makeRequest('POST', '/api/auth/login', {
      email: 'admin@omnysync.internal',
      password: 'Password123!',
    });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.data.token;

    // Authenticate Controller
    const controllerRes = await makeRequest('POST', '/api/auth/login', {
      email: 'controller@omnysync.internal',
      password: 'Password123!',
    });
    controllerToken = controllerRes.body.data.token;

    // Authenticate Accountant
    const accountantRes = await makeRequest('POST', '/api/auth/login', {
      email: 'accountant@omnysync.internal',
      password: 'Password123!',
    });
    accountantToken = accountantRes.body.data.token;

    // Authenticate Viewer
    const viewerRes = await makeRequest('POST', '/api/auth/login', {
      email: 'viewer@omnysync.internal',
      password: 'Password123!',
    });
    viewerToken = viewerRes.body.data.token;
  });

  it('queries 4-level Chart of Accounts tree structure', async () => {
    const res = await makeRequest('GET', '/api/coa/tree', undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    // Root nodes must be Level 1 (Classes)
    const roots = res.body.data;
    expect(roots.every((r: any) => r.level === 1)).toBe(true);
    expect(roots.every((r: any) => r.posting_allowed === false)).toBe(true);
  });

  it('rejects journal creation with unbalanced debits and credits', async () => {
    const accountsRes = await makeRequest('GET', '/api/coa/accounts', undefined, adminToken);
    const bankAcc = accountsRes.body.data.find((a: any) => a.code === '111002');
    const revAcc = accountsRes.body.data.find((a: any) => a.code === '411001');

    const unbalancedDraft = {
      posting_date: '2026-03-15',
      document_date: '2026-03-15',
      description: 'Unbalanced Journal Test',
      lines: [
        {
          account_id: bankAcc.id,
          debit_amount: '1000.00',
          credit_amount: '0.00',
        },
        {
          account_id: revAcc.id,
          debit_amount: '0.00',
          credit_amount: '800.00', // Unbalanced by 200
        },
      ],
    };

    const res = await makeRequest('POST', '/api/journals/draft', unbalancedDraft, accountantToken);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('JOURNAL_UNBALANCED');
  });

  it('rejects posting to a non-leaf heading account (L1-L3)', async () => {
    const accountsRes = await makeRequest('GET', '/api/coa/accounts', undefined, adminToken);
    const headingAcc = accountsRes.body.data.find((a: any) => a.level === 3);
    const revAcc = accountsRes.body.data.find((a: any) => a.code === '411001');

    const nonLeafDraft = {
      posting_date: '2026-03-15',
      document_date: '2026-03-15',
      description: 'Posting to heading account test',
      lines: [
        {
          account_id: headingAcc.id,
          debit_amount: '500.00',
          credit_amount: '0.00',
        },
        {
          account_id: revAcc.id,
          debit_amount: '0.00',
          credit_amount: '500.00',
        },
      ],
    };

    const res = await makeRequest('POST', '/api/journals/draft', nonLeafDraft, accountantToken);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.details.some((d: string) => d.includes('Level 3'))).toBe(true);
  });

  it('executes full M1 journal lifecycle: Draft -> Submit -> Approve -> Post -> Reversal -> Trial Balance', async () => {
    const accountsRes = await makeRequest('GET', '/api/coa/accounts', undefined, adminToken);
    const officeEquipmentAcc = accountsRes.body.data.find((a: any) => a.code === '121001');
    const bankAcc = accountsRes.body.data.find((a: any) => a.code === '111002');

    // 1. Create Balanced Draft
    const draftRes = await makeRequest(
      'POST',
      '/api/journals/draft',
      {
        posting_date: '2026-03-15',
        document_date: '2026-03-15',
        description: 'New Laptops for Engineering Team',
        lines: [
          {
            account_id: officeEquipmentAcc.id,
            debit_amount: '1500000.00',
            credit_amount: '0.00',
            description: '10x Developer Workstations',
          },
          {
            account_id: bankAcc.id,
            debit_amount: '0.00',
            credit_amount: '1500000.00',
            description: 'Bank Wire Transfer',
          },
        ],
      },
      accountantToken,
    );
    expect(draftRes.status).toBe(201);
    const journalId = draftRes.body.data.id;
    expect(draftRes.body.data.status).toBe('DRAFT');

    // 2. Submit Draft (Accountant)
    const submitRes = await makeRequest('POST', `/api/journals/${journalId}/submit`, {}, accountantToken);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.data.status).toBe('SUBMITTED');

    // 3. Approve Journal (Controller)
    const approveRes = await makeRequest('POST', `/api/journals/${journalId}/approve`, {}, controllerToken);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('APPROVED');

    // 4. Authoritatively Post to General Ledger (Controller)
    const postRes = await makeRequest('POST', `/api/journals/${journalId}/post`, {}, controllerToken);
    expect(postRes.status).toBe(200);
    expect(postRes.body.data.status).toBe('POSTED');

    // 5. Query Trial Balance (Verifying Double-Entry Reconciled Balance)
    const tbRes = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(tbRes.status).toBe(200);
    expect(tbRes.body.data.is_balanced).toBe(true);
    expect(tbRes.body.data.net_difference).toBe('0.00');

    // Check that Office Equipment contains 7,000,000 (opening) + 1,500,000 (posted) = 8,500,000
    const eqAccountSummary = tbRes.body.data.accounts.find((a: any) => a.account_code === '121001');
    expect(eqAccountSummary.net_balance).toBe('8500000.00');

    // 6. Execute Linked Reversal (Controller)
    const reverseRes = await makeRequest(
      'POST',
      `/api/journals/${journalId}/reverse`,
      {
        reversal_posting_date: '2026-03-20',
        reason: 'Order cancelled before delivery',
      },
      controllerToken,
    );
    expect(reverseRes.status).toBe(201);
    expect(reverseRes.body.data.status).toBe('REVERSED');

    // 7. Verify Trial Balance after reversal (Office Equipment back to 7,000,000.00)
    const tbAfterRev = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(tbAfterRev.body.data.is_balanced).toBe(true);
    expect(tbAfterRev.body.data.net_difference).toBe('0.00');
    const eqAfterRev = tbAfterRev.body.data.accounts.find((a: any) => a.account_code === '121001');
    expect(eqAfterRev.net_balance).toBe('7000000.00');
  });

  it('rejects posting when target fiscal period is HARD_CLOSED', async () => {
    const accountsRes = await makeRequest('GET', '/api/coa/accounts', undefined, adminToken);
    const bankAcc = accountsRes.body.data.find((a: any) => a.code === '111002');
    const revAcc = accountsRes.body.data.find((a: any) => a.code === '411001');

    // Create draft in January 2026 (Jan 2026 is HARD_CLOSED in seed)
    const draftRes = await makeRequest(
      'POST',
      '/api/journals/draft',
      {
        posting_date: '2026-01-15',
        document_date: '2026-01-15',
        description: 'Posting into closed period',
        lines: [
          { account_id: bankAcc.id, debit_amount: '100.00', credit_amount: '0.00' },
          { account_id: revAcc.id, debit_amount: '0.00', credit_amount: '100.00' },
        ],
      },
      adminToken,
    );

    const jId = draftRes.body.data.id;
    await makeRequest('POST', `/api/journals/${jId}/submit`, {}, adminToken);
    await makeRequest('POST', `/api/journals/${jId}/approve`, {}, adminToken);

    const postRes = await makeRequest('POST', `/api/journals/${jId}/post`, {}, adminToken);
    expect(postRes.status).toBe(400);
    expect(postRes.body.error.code).toBe('PERIOD_CLOSED');
    expect(postRes.body.error.message).toContain('HARD_CLOSED');
  });

  it('verifies append-only audit trail logs', async () => {
    const auditRes = await makeRequest('GET', '/api/audit/logs', undefined, adminToken);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.length).toBeGreaterThan(0);

    const actions = auditRes.body.data.map((l: any) => l.action);
    expect(actions).toContain('JOURNAL_POSTED');
    expect(actions).toContain('JOURNAL_REVERSED');
  });
});
