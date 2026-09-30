import { describe, it, expect, beforeAll } from 'vitest';
import { app, db } from '../src/index.js';
import { DbMigrator, SyntheticSeedRunner } from '@omnysync/platform';
import { Money } from '@omnysync/financial-engine';
import { ErrorCode } from '@omnysync/contracts';
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
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req: any = {
      method,
      url: pathStr,
      originalUrl: pathStr,
      headers,
      body: body || {},
      query: {},
      params: {},
    };

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

describe('API Modular Monolith: Financial & Trading Workflows E2E Integration', () => {
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

  // ==========================================
  // Milestone 1 Tests: Core Financial Ledger
  // ==========================================
  it('queries 4-level Chart of Accounts tree structure', async () => {
    const res = await makeRequest('GET', '/api/coa/tree', undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

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
        { account_id: bankAcc.id, debit_amount: '1000.00', credit_amount: '0.00' },
        { account_id: revAcc.id, debit_amount: '0.00', credit_amount: '800.00' },
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
        { account_id: headingAcc.id, debit_amount: '500.00', credit_amount: '0.00' },
        { account_id: revAcc.id, debit_amount: '0.00', credit_amount: '500.00' },
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
          { account_id: officeEquipmentAcc.id, debit_amount: '1500000.00', credit_amount: '0.00', description: '10x Workstations' },
          { account_id: bankAcc.id, debit_amount: '0.00', credit_amount: '1500000.00', description: 'Bank Wire Transfer' },
        ],
      },
      accountantToken,
    );
    expect(draftRes.status).toBe(201);
    const journalId = draftRes.body.data.id;

    // 2. Submit & Approve & Post
    await makeRequest('POST', `/api/journals/${journalId}/submit`, {}, accountantToken);
    await makeRequest('POST', `/api/journals/${journalId}/approve`, {}, controllerToken);
    const postRes = await makeRequest('POST', `/api/journals/${journalId}/post`, {}, controllerToken);
    expect(postRes.status).toBe(200);

    // 3. Query Trial Balance
    const tbRes = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(tbRes.status).toBe(200);
    expect(tbRes.body.data.is_balanced).toBe(true);
    const eqAccountSummary = tbRes.body.data.accounts.find((a: any) => a.account_code === '121001');
    expect(eqAccountSummary.net_balance).toBe('8500000.00');

    // 4. Execute Linked Reversal
    const reverseRes = await makeRequest(
      'POST',
      `/api/journals/${journalId}/reverse`,
      { reversal_posting_date: '2026-03-20', reason: 'Order cancelled before delivery' },
      controllerToken,
    );
    expect(reverseRes.status).toBe(201);

    // 5. Verify Trial Balance after reversal
    const tbAfterRev = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(tbAfterRev.body.data.is_balanced).toBe(true);
    const eqAfterRev = tbAfterRev.body.data.accounts.find((a: any) => a.account_code === '121001');
    expect(eqAfterRev.net_balance).toBe('7000000.00');
  });

  // ==========================================
  // Milestone 2 Tests: Integrated Trading Workflows
  // ==========================================
  it('manages parties (customers & vendors) and item catalog', async () => {
    // 1. Create a Customer Party
    const partyRes = await makeRequest(
      'POST',
      '/api/parties',
      {
        code: 'CUST-E2E-01',
        name: 'Alpha Systems Ltd',
        party_type: 'CUSTOMER',
        tax_identifier: 'NTN-1122334',
        credit_limit: '5000000.00',
      },
      adminToken,
    );
    expect(partyRes.status).toBe(201);
    expect(partyRes.body.data.code).toBe('CUST-E2E-01');

    // 2. Query Parties
    const listRes = await makeRequest('GET', '/api/parties?type=CUSTOMER', undefined, adminToken);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((p: any) => p.code === 'CUST-E2E-01')).toBe(true);

    // 3. Query Catalog Items & On-hand inventory
    const itemsRes = await makeRequest('GET', '/api/items', undefined, adminToken);
    expect(itemsRes.status).toBe(200);
    const switchItem = itemsRes.body.data.find((i: any) => i.code === 'ITEM-SW-48');
    expect(switchItem).toBeDefined();
    expect(parseFloat(switchItem.on_hand_qty)).toBeGreaterThanOrEqual(25);
  });

  it('executes Order-to-Cash: Sales Order -> Confirm -> Fulfill (COGS Voucher) -> AR Invoice -> GL Post', async () => {
    const partiesRes = await makeRequest('GET', '/api/parties?type=CUSTOMER', undefined, adminToken);
    const customer = partiesRes.body.data[0];
    const itemsRes = await makeRequest('GET', '/api/items', undefined, adminToken);
    const serverItem = itemsRes.body.data.find((i: any) => i.code === 'ITEM-SRV-01'); // Enterprise Server

    const initialStockRes = await makeRequest('GET', '/api/inventory/stock', undefined, adminToken);
    const initialServerStock = initialStockRes.body.data.find((s: any) => s.item_code === 'ITEM-SRV-01');
    const initialQty = parseFloat(initialServerStock.on_hand_qty);

    // 1. Create Sales Order for 2 Enterprise Servers @ PKR 450,000 = PKR 900,000
    const soRes = await makeRequest(
      'POST',
      '/api/sales/orders',
      {
        party_id: customer.id,
        order_date: '2026-03-22',
        lines: [{ item_id: serverItem.id, quantity: '2', unit_price: '450000.00' }],
      },
      controllerToken,
    );
    expect(soRes.status).toBe(201);
    const soId = soRes.body.data.id;
    expect(soRes.body.data.status).toBe('DRAFT');

    // 2. Confirm Sales Order
    const confirmRes = await makeRequest('POST', `/api/sales/orders/${soId}/confirm`, {}, controllerToken);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.status).toBe('CONFIRMED');

    // 3. Fulfill / Ship Order (Decrements physical stock and posts COGS journal voucher)
    const fulfillRes = await makeRequest('POST', `/api/sales/orders/${soId}/fulfill`, {}, controllerToken);
    expect(fulfillRes.status).toBe(200);
    expect(fulfillRes.body.data.status).toBe('FULFILLED');

    // Verify stock reduced by 2
    const postStockRes = await makeRequest('GET', '/api/inventory/stock', undefined, adminToken);
    const postServerStock = postStockRes.body.data.find((s: any) => s.item_code === 'ITEM-SRV-01');
    expect(parseFloat(postServerStock.on_hand_qty)).toBe(initialQty - 2);

    // 4. Create AR Customer Invoice for the Order
    const arRes = await makeRequest(
      'POST',
      '/api/ar/invoices',
      {
        party_id: customer.id,
        sales_order_id: soId,
        invoice_date: '2026-03-22',
        due_date: '2026-04-22',
        lines: [{ item_id: serverItem.id, quantity: '2', unit_price: '450000.00' }],
      },
      accountantToken,
    );
    expect(arRes.status).toBe(201);
    const invoiceId = arRes.body.data.id;
    expect(arRes.body.data.status).toBe('DRAFT');

    // 5. Post AR Invoice to General Ledger (Dr AR Control 112001, Cr Sales 411001)
    const postInvRes = await makeRequest('POST', `/api/ar/invoices/${invoiceId}/post`, {}, controllerToken);
    expect(postInvRes.status).toBe(200);
    expect(postInvRes.body.data.status).toBe('POSTED');

    // 6. Record Customer Receipt Payment and Allocate against Invoice
    const accountsRes = await makeRequest('GET', '/api/coa/accounts', undefined, adminToken);
    const bankAcc = accountsRes.body.data.find((a: any) => a.code === '111002');

    const paymentRes = await makeRequest(
      'POST',
      '/api/payments/receipt',
      {
        party_id: customer.id,
        bank_account_id: bankAcc.id,
        amount: '900000.00',
        payment_date: '2026-03-25',
        reference: 'CHQ-987654',
        allocations: [{ invoice_id: invoiceId, amount: '900000.00' }],
      },
      accountantToken,
    );
    expect(paymentRes.status).toBe(201);
    expect(paymentRes.body.data.status).toBe('POSTED');

    // Verify AR Invoice is marked PAID and outstanding is 0
    const checkInvRes = await makeRequest('GET', `/api/ar/invoices/${invoiceId}`, undefined, accountantToken);
    expect(checkInvRes.status).toBe(200);
    expect(checkInvRes.body.data.status).toBe('PAID');
    expect(parseFloat(checkInvRes.body.data.outstanding_amount)).toBe(0);
  });

  it('executes Procure-to-Pay: Purchase Order -> Approve -> Receive (GRNI Accrual) -> AP Bill -> GL Post -> Settle', async () => {
    const partiesRes = await makeRequest('GET', '/api/parties?type=VENDOR', undefined, adminToken);
    const vendor = partiesRes.body.data[0];
    const itemsRes = await makeRequest('GET', '/api/items', undefined, adminToken);
    const switchItem = itemsRes.body.data.find((i: any) => i.code === 'ITEM-SW-48'); // Managed Switch

    // 1. Create Purchase Order for 10 switches @ PKR 120,000 = PKR 1,200,000
    const poRes = await makeRequest(
      'POST',
      '/api/procurement/orders',
      {
        party_id: vendor.id,
        po_date: '2026-03-20',
        expected_date: '2026-03-28',
        lines: [{ item_id: switchItem.id, quantity: '10', unit_price: '120000.00' }],
      },
      controllerToken,
    );
    expect(poRes.status).toBe(201);
    const poId = poRes.body.data.id;
    expect(poRes.body.data.status).toBe('DRAFT');

    // 2. Approve Purchase Order
    const approvePoRes = await makeRequest('POST', `/api/procurement/orders/${poId}/approve`, {}, controllerToken);
    expect(approvePoRes.status).toBe(200);
    expect(approvePoRes.body.data.status).toBe('APPROVED');

    // 3. Receive Goods into Inventory (Increases on_hand and posts Dr Inventory / Cr GRNI Liability)
    const receiveRes = await makeRequest('POST', `/api/procurement/orders/${poId}/receive`, {}, controllerToken);
    expect(receiveRes.status).toBe(200);
    expect(receiveRes.body.data.status).toBe('RECEIVED');

    // 4. Create AP Supplier Bill
    const billRes = await makeRequest(
      'POST',
      '/api/ap/invoices',
      {
        party_id: vendor.id,
        purchase_order_id: poId,
        invoice_number: `BILL-TEST-${Date.now().toString().slice(-4)}`,
        invoice_date: '2026-03-24',
        due_date: '2026-04-24',
        lines: [{ item_id: switchItem.id, quantity: '10', unit_price: '120000.00' }],
      },
      accountantToken,
    );
    expect(billRes.status).toBe(201);
    const billId = billRes.body.data.id;

    // 5. Post AP Bill to General Ledger (Dr GRNI Liability 211002, Cr AP Control 211001)
    const postBillRes = await makeRequest('POST', `/api/ap/invoices/${billId}/post`, {}, controllerToken);
    expect(postBillRes.status).toBe(200);
    expect(postBillRes.body.data.status).toBe('POSTED');

    // 6. Record Supplier Disbursement Payment and Allocate against Bill
    const accountsRes = await makeRequest('GET', '/api/coa/accounts', undefined, adminToken);
    const bankAcc = accountsRes.body.data.find((a: any) => a.code === '111002');

    const pmtRes = await makeRequest(
      'POST',
      '/api/payments/disbursement',
      {
        party_id: vendor.id,
        bank_account_id: bankAcc.id,
        amount: '1200000.00',
        payment_date: '2026-03-26',
        reference: 'WIRE-VEN-001',
        allocations: [{ invoice_id: billId, amount: '1200000.00' }],
      },
      accountantToken,
    );
    expect(pmtRes.status).toBe(201);
    expect(pmtRes.body.data.status).toBe('POSTED');

    // 7. Verify Trial Balance remains strictly double-entry balanced after all trading activities
    const finalTb = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(finalTb.status).toBe(200);
    expect(finalTb.body.data.is_balanced).toBe(true);
    expect(finalTb.body.data.net_difference).toBe('0.00');
  });

  // ==========================================
  // Milestone 3 Tests: Treasury, FX & Onboarding
  // ==========================================
  it('manages multi-currency spot exchange rates', async () => {
    // 1. Post USD/PKR Exchange Rate
    const fxRes = await makeRequest(
      'POST',
      '/api/fx/rates',
      {
        from_currency: 'USD',
        to_currency: 'PKR',
        rate: '278.450000000000',
        effective_date: '2026-03-25',
        source: 'State Bank of Pakistan',
      },
      controllerToken,
    );
    expect(fxRes.status).toBe(201);
    expect(fxRes.body.data.from_currency).toBe('USD');

    // 2. Query FX rates
    const listRes = await makeRequest('GET', '/api/fx/rates', undefined, accountantToken);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((r: any) => r.from_currency === 'USD')).toBe(true);
  });

  it('executes Bank Reconciliation: Import Statement -> Clear Matches -> Sign-Off Reconciliation', async () => {
    const accountsRes = await makeRequest('GET', '/api/coa/accounts', undefined, adminToken);
    const bankAcc = accountsRes.body.data.find((a: any) => a.code === '111002');

    // 1. Upload Electronic Bank Statement
    const uploadRes = await makeRequest(
      'POST',
      '/api/treasury/statements/upload',
      {
        bank_account_id: bankAcc.id,
        statement_reference: `STMT-E2E-${Date.now().toString().slice(-4)}`,
        statement_date: '2026-03-31',
        opening_balance: '10000000.00',
        closing_balance: '9700000.00', // 10M + 900k (customer receipt) - 1.2M (supplier payment) = 9.7M
        lines: [
          {
            transaction_date: '2026-03-25',
            reference: 'CHQ-987654',
            description: 'Customer Receipt Horizon',
            amount: '900000.00',
          },
          {
            transaction_date: '2026-03-26',
            reference: 'WIRE-VEN-001',
            description: 'Supplier Wire Apex',
            amount: '-1200000.00',
          },
        ],
      },
      accountantToken,
    );
    expect(uploadRes.status).toBe(201);
    const statementId = uploadRes.body.data.id;

    // 2. Fetch Statement Detail & Match Lines
    const stmtDetail = await makeRequest('GET', `/api/treasury/statements/${statementId}`, undefined, accountantToken);
    expect(stmtDetail.status).toBe(200);
    expect(stmtDetail.body.data.lines).toHaveLength(2);

    for (const line of stmtDetail.body.data.lines) {
      const matchRes = await makeRequest(
        'POST',
        '/api/treasury/reconciliation/match',
        { statement_line_id: line.id, is_matched: true },
        accountantToken,
      );
      expect(matchRes.status).toBe(200);
    }

    // 3. Sign-Off Bank Reconciliation
    const signOffRes = await makeRequest(
      'POST',
      '/api/treasury/reconciliation/sign-off',
      { statement_id: statementId, notes: 'E2E Month-End Bank Reconciliation Completed' },
      controllerToken,
    );
    expect(signOffRes.status).toBe(200);
    expect(signOffRes.body.data.status).toBe('RECONCILED');

    // 4. Verify Audit Log contains BANK_STATEMENT_RECONCILED
    const auditRes = await makeRequest('GET', '/api/audit/logs', undefined, adminToken);
    expect(auditRes.body.data.some((l: any) => l.action === 'BANK_STATEMENT_RECONCILED')).toBe(true);
  });

  it('provisions Industry Template Profile in Onboarding Wizard', async () => {
    // 1. Query Onboarding Profile
    const getRes = await makeRequest('GET', '/api/onboarding/profile', undefined, adminToken);
    expect(getRes.status).toBe(200);

    // 2. Provision Wholesale Distribution Template
    const provRes = await makeRequest(
      'POST',
      '/api/onboarding/provision',
      { industry_template: 'WHOLESALE_DISTRIBUTION' },
      adminToken,
    );
    expect(provRes.status).toBe(201);
    expect(provRes.body.data.industry_template).toBe('WHOLESALE_DISTRIBUTION');
    expect(provRes.body.data.is_completed).toBe(true);
  });

  it('executes full Milestone 4 Workforce & Payroll lifecycle: Department -> Employee -> Salary Structure -> Calculate -> Approve -> Post GL -> Disburse', async () => {
    // 1. Create Department
    const deptRes = await makeRequest(
      'POST',
      '/api/hrm/departments',
      { code: 'ENG', name: 'Software Engineering', cost_center_code: 'CC-ENG-01' },
      adminToken,
    );
    expect(deptRes.status).toBe(201);
    const deptId = deptRes.body.data.id;

    // 2. Create Designation
    const desigRes = await makeRequest(
      'POST',
      '/api/hrm/designations',
      { code: 'SSE', title: 'Senior Software Engineer', department_id: deptId },
      adminToken,
    );
    expect(desigRes.status).toBe(201);
    const desigId = desigRes.body.data.id;

    // 3. Create Salary Structure
    // Basic: 200,000, HRA: 80,000, Util: 20,000 => Gross: 300,000 / mo (Annual: 3.6M)
    const structRes = await makeRequest(
      'POST',
      '/api/hrm/salary-structures',
      {
        name: 'Senior Executive Grade 1',
        currency: 'PKR',
        basic_salary: '200000.00',
        house_rent_allowance: '80000.00',
        utility_allowance: '20000.00',
        medical_allowance: '0.00',
        other_allowances: '0.00',
      },
      adminToken,
    );
    expect(structRes.status).toBe(201);
    expect(new Money(structRes.body.data.gross_salary).format()).toBe('300000.00');
    const structId = structRes.body.data.id;

    // 4. Onboard Employee
    const empRes = await makeRequest(
      'POST',
      '/api/hrm/employees',
      {
        employee_number: 'EMP-001',
        first_name: 'Bilal',
        last_name: 'Ahmed',
        email: 'bilal.ahmed@omnysync.internal',
        phone: '+92 300 1234567',
        national_id: '42101-1234567-1',
        department_id: deptId,
        designation_id: desigId,
        employment_type: 'FULL_TIME',
        joining_date: '2026-01-01',
        salary_structure_id: structId,
        bank_name: 'Meezan Bank Ltd',
        bank_account_number: 'PK00MEZN00123456789012',
      },
      adminToken,
    );
    expect(empRes.status).toBe(201);
    expect(empRes.body.data.employee_number).toBe('EMP-001');

    // 5. Fetch Open Fiscal Period
    const periodsRes = await makeRequest('GET', '/api/periods', undefined, accountantToken);
    expect(periodsRes.status).toBe(200);
    const openPeriod = periodsRes.body.data.find((p: any) => p.status === 'OPEN');
    expect(openPeriod).toBeDefined();

    // 6. Preview Payroll Calculation
    const calcRes = await makeRequest(
      'POST',
      '/api/hrm/payroll/calculate',
      { period_id: openPeriod.id, month_year: '2026-03' },
      accountantToken,
    );
    expect(calcRes.status).toBe(200);
    expect(calcRes.body.data.totals.total_gross).toBe('300000.00');
    expect(calcRes.body.data.items).toHaveLength(1);

    // 7. Create Draft Payroll Run
    const runRes = await makeRequest(
      'POST',
      '/api/hrm/payroll-runs',
      { period_id: openPeriod.id, month_year: '2026-03', run_number: 'PR-2026-03-001' },
      accountantToken,
    );
    expect(runRes.status).toBe(201);
    expect(runRes.body.data.status).toBe('DRAFT');
    const runId = runRes.body.data.id;

    // 8. Approve Payroll Run
    const approveRes = await makeRequest(
      'POST',
      `/api/hrm/payroll-runs/${runId}/approve`,
      {},
      controllerToken,
    );
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('APPROVED');

    // 9. Post Payroll Run to General Ledger
    const postRes = await makeRequest(
      'POST',
      `/api/hrm/payroll-runs/${runId}/post`,
      {},
      controllerToken,
    );
    expect(postRes.status).toBe(200);
    expect(postRes.body.data.status).toBe('POSTED');
    expect(postRes.body.data.posted_journal_id).toBeDefined();

    // 10. Disburse Payroll via Bank
    const disbRes = await makeRequest(
      'POST',
      `/api/hrm/payroll-runs/${runId}/disburse`,
      {},
      controllerToken,
    );
    expect(disbRes.status).toBe(200);
    expect(disbRes.body.data.status).toBe('DISBURSED');
    expect(disbRes.body.data.disbursement_journal_id).toBeDefined();

    // 11. Verify General Ledger Trial Balance remains perfectly balanced
    const tbRes = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(tbRes.status).toBe(200);
    expect(tbRes.body.data.is_balanced).toBe(true);
    expect(tbRes.body.data.net_difference).toBe('0.00');
  });

  it('12. Milestone 5 E2E: Warehouses, Transfers, Cycle Counts, BOM & Work Order Assembly Production', async () => {
    // 1. Fetch Warehouses and Items
    const whsRes = await makeRequest('GET', '/api/inventory/warehouses', undefined, adminToken);
    expect(whsRes.status).toBe(200);
    expect(whsRes.body.data.length).toBeGreaterThanOrEqual(2);
    const mainWh = whsRes.body.data.find((w: any) => w.code === 'WH-MAIN');
    const prodWh = whsRes.body.data.find((w: any) => w.code === 'WH-PROD');

    const itemsRes = await makeRequest('GET', '/api/items', undefined, adminToken);
    const rawMaterialItem = itemsRes.body.data.find((i: any) => i.item_type === 'INVENTORY');
    expect(rawMaterialItem).toBeDefined();

    // 2. Create Finished Product Item
    const fgItemRes = await makeRequest(
      'POST',
      '/api/items',
      {
        code: 'FG-PC-001',
        name: 'Omnysync Custom Workstation PC',
        item_type: 'INVENTORY',
        uom: 'UNIT',
        unit_price: '120000.00',
        unit_cost: '75000.00',
      },
      adminToken,
    );
    expect(fgItemRes.status).toBe(201);
    const finishedItem = fgItemRes.body.data;

    // 3. Inter-Warehouse Stock Transfer
    const transferRes = await makeRequest(
      'POST',
      '/api/inventory/transfers',
      {
        source_warehouse_id: mainWh.id,
        destination_warehouse_id: prodWh.id,
        transfer_date: '2026-03-10',
        notes: 'Replenishing raw materials for assembly line',
        items: [
          {
            item_id: rawMaterialItem.id,
            requested_qty: '20.00000000',
          },
        ],
      },
      adminToken,
    );
    expect(transferRes.status).toBe(201);
    expect(transferRes.body.data.status).toBe('DRAFT');
    const transferId = transferRes.body.data.id;

    // Ship Transfer
    const shipRes = await makeRequest('POST', `/api/inventory/transfers/${transferId}/ship`, {}, adminToken);
    expect(shipRes.status).toBe(200);
    expect(shipRes.body.data.status).toBe('IN_TRANSIT');

    // Receive Transfer
    const receiveRes = await makeRequest('POST', `/api/inventory/transfers/${transferId}/receive`, {}, adminToken);
    expect(receiveRes.status).toBe(200);
    expect(receiveRes.body.data.status).toBe('COMPLETED');

    // 4. Physical Inventory Cycle Count & Variance Posting
    const periodsRes = await makeRequest('GET', '/api/periods', undefined, controllerToken);
    const openPeriod = periodsRes.body.data.find((p: any) => p.status === 'OPEN');

    const countRes = await makeRequest(
      'POST',
      '/api/inventory/counts',
      {
        warehouse_id: mainWh.id,
        period_id: openPeriod.id,
        count_date: '2026-03-15',
        count_number: 'CNT-2026-001',
      },
      controllerToken,
    );
    expect(countRes.status).toBe(201);
    const countId = countRes.body.data.id;

    // Record count with small shortage variance (-2 units)
    const recordRes = await makeRequest(
      'POST',
      `/api/inventory/counts/${countId}/record`,
      {
        counts: [
          {
            item_id: rawMaterialItem.id,
            counted_qty: '8.00000000', // e.g. system has 10, counted 8 => variance -2
          },
        ],
      },
      controllerToken,
    );
    expect(recordRes.status).toBe(200);
    expect(recordRes.body.data.status).toBe('RECONCILED');

    // Post Count Adjustment to GL
    const postCountRes = await makeRequest(
      'POST',
      `/api/inventory/counts/${countId}/reconcile-and-post`,
      {},
      controllerToken,
    );
    expect(postCountRes.status).toBe(200);
    expect(postCountRes.body.data.status).toBe('POSTED');

    // 5. Create Bill of Materials (BOM)
    const bomRes = await makeRequest(
      'POST',
      '/api/manufacturing/boms',
      {
        bom_number: 'BOM-PC-PRO',
        name: 'Workstation PC Specification',
        finished_item_id: finishedItem.id,
        yield_quantity: '1.00000000',
        items: [
          {
            component_item_id: rawMaterialItem.id,
            quantity: '2.00000000',
            scrap_percentage: '0.00',
          },
        ],
      },
      adminToken,
    );
    expect(bomRes.status).toBe(201);
    const bomId = bomRes.body.data.id;

    // 6. Create Work Order
    const woRes = await makeRequest(
      'POST',
      '/api/manufacturing/work-orders',
      {
        work_order_number: 'WO-2026-BATCH-01',
        bom_id: bomId,
        warehouse_id: prodWh.id,
        target_qty: '5.00000000',
      },
      adminToken,
    );
    expect(woRes.status).toBe(201);
    expect(woRes.body.data.status).toBe('PLANNED');
    const woId = woRes.body.data.id;

    // 7. Release Work Order
    const releaseRes = await makeRequest('POST', `/api/manufacturing/work-orders/${woId}/release`, {}, adminToken);
    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body.data.status).toBe('RELEASED');

    // 8. Record Material Consumption into WIP (5 units target * 2 qty = 10 components)
    const consumeRes = await makeRequest(
      'POST',
      `/api/manufacturing/work-orders/${woId}/consume`,
      {
        component_item_id: rawMaterialItem.id,
        consumed_qty: '10.00000000',
      },
      adminToken,
    );
    expect(consumeRes.status).toBe(201);

    // 9. Complete Work Order & Post Assembly GL Voucher (Dr FG 113004 / Cr WIP 113003)
    const completeRes = await makeRequest(
      'POST',
      `/api/manufacturing/work-orders/${woId}/complete`,
      {
        completed_qty: '5.00000000',
        scrapped_qty: '0.00000000',
      },
      adminToken,
    );
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe('COMPLETED');
    expect(completeRes.body.data.completion_journal_id).toBeDefined();

    // 10. Verify Trial Balance is strictly balanced
    const finalTbRes = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(finalTbRes.status).toBe(200);
    expect(finalTbRes.body.data.is_balanced).toBe(true);
    expect(finalTbRes.body.data.net_difference).toBe('0.00');
  });

  it('executes full Milestone 6 Projects & Contracts lifecycle: Cost Center -> Project -> WBS -> BOQ -> IPC Measurement -> Certify -> Post GL Progress Invoice', async () => {
    // 1. Create Cost Center
    const ccRes = await makeRequest(
      'POST',
      '/api/projects/cost-centers',
      {
        code: 'CC-PRJ-GULBERG',
        name: 'Gulberg Commercial Site Cost Center',
        cost_center_type: 'PROJECT',
        manager_name: 'Engr. Bilal Khan',
      },
      adminToken,
    );
    expect(ccRes.status).toBe(201);
    expect(ccRes.body.data.code).toBe('CC-PRJ-GULBERG');
    const ccId = ccRes.body.data.id;

    // 2. Create Project
    const prjRes = await makeRequest(
      'POST',
      '/api/projects',
      {
        code: 'PRJ-2026-001',
        name: 'Gulberg Heights Commercial Tower',
        manager_name: 'Engr. Bilal Khan',
        project_type: 'CONSTRUCTION',
        contract_value: '10000000.00',
        budgeted_cost: '7500000.00',
        retention_percentage: '5.00',
        start_date: '2026-03-01',
        cost_center_id: ccId,
      },
      adminToken,
    );
    expect(prjRes.status).toBe(201);
    expect(prjRes.body.data.status).toBe('APPROVED');
    const prjId = prjRes.body.data.id;

    // 3. Create WBS Node
    const wbsRes = await makeRequest(
      'POST',
      `/api/projects/${prjId}/wbs`,
      {
        wbs_code: 'WBS-01-CIVIL',
        name: 'Civil & Foundation Works',
        budget_cost: '3000000.00',
        status: 'IN_PROGRESS',
      },
      adminToken,
    );
    expect(wbsRes.status).toBe(201);
    const wbsId = wbsRes.body.data.id;

    // 4. Create Bill of Quantities (BOQ)
    const boqRes = await makeRequest(
      'POST',
      `/api/projects/${prjId}/boq`,
      {
        boq_number: 'BOQ-GULBERG-01',
        title: 'Main Foundation & Structural BOQ',
        version: '1.0',
        items: [
          {
            wbs_node_id: wbsId,
            item_code: 'BOQ-CONC-C30',
            description: 'Ready-Mix Concrete Grade C30/37 in Substructure',
            uom: 'M3',
            contract_quantity: '200.00000000',
            unit_rate: '15000.00000000', // Total 3,000,000
          },
          {
            wbs_node_id: wbsId,
            item_code: 'BOQ-STEEL-G60',
            description: 'High Tensile Deformed Steel Rebar Grade 60',
            uom: 'TON',
            contract_quantity: '20.00000000',
            unit_rate: '250000.00000000', // Total 5,000,000
          },
        ],
      },
      adminToken,
    );
    expect(boqRes.status).toBe(201);
    expect(new Money(boqRes.body.data.total_amount).format()).toBe('8000000.00');
    const boqId = boqRes.body.data.id;

    // Fetch BOQ with items
    const getBoqRes = await makeRequest('GET', `/api/projects/${prjId}/boq`, undefined, adminToken);
    expect(getBoqRes.status).toBe(200);
    const boqItems = getBoqRes.body.data[0].items;
    expect(boqItems).toHaveLength(2);
    const concreteBoqItem = boqItems.find((b: any) => b.item_code === 'BOQ-CONC-C30');

    // 5. Test Over-Certification Rejection
    const periodsRes = await makeRequest('GET', '/api/periods', undefined, adminToken);
    const openPeriod = periodsRes.body.data.find((p: any) => p.status === 'OPEN');

    const overCertRes = await makeRequest(
      'POST',
      `/api/projects/${prjId}/certificates`,
      {
        certificate_number: 'IPC-INVALID-01',
        boq_id: boqId,
        period_id: openPeriod.id,
        items: [
          {
            boq_item_id: concreteBoqItem.id,
            current_quantity: '250.00000000', // Exceeds contract quantity of 200!
          },
        ],
      },
      adminToken,
    );
    expect(overCertRes.status).toBe(422);
    expect(overCertRes.body.error.code).toBe(ErrorCode.OVER_CERTIFICATION);

    // 6. Create Valid Interim Payment Certificate (IPC-001)
    // Measure 50 M3 Concrete @ 15,000 = 750,000 Gross
    // 5% Retention = 37,500
    // Net Billable = 712,500
    const validCertRes = await makeRequest(
      'POST',
      `/api/projects/${prjId}/certificates`,
      {
        certificate_number: 'IPC-2026-001',
        boq_id: boqId,
        period_id: openPeriod.id,
        certificate_date: '2026-03-31',
        items: [
          {
            boq_item_id: concreteBoqItem.id,
            current_quantity: '50.00000000',
          },
        ],
      },
      adminToken,
    );
    expect(validCertRes.status).toBe(201);
    expect(new Money(validCertRes.body.data.gross_certified_amount).format()).toBe('750000.00');
    expect(new Money(validCertRes.body.data.retention_amount).format()).toBe('37500.00');
    expect(new Money(validCertRes.body.data.net_certified_amount).format()).toBe('712500.00');
    const certId = validCertRes.body.data.id;

    // 7. Certify Progress Certificate (IPC)
    const certifyRes = await makeRequest(
      'POST',
      `/api/projects/${prjId}/certificates/${certId}/certify`,
      {},
      adminToken,
    );
    expect(certifyRes.status).toBe(200);
    expect(certifyRes.body.data.status).toBe('CERTIFIED');

    // 8. Generate & Post Balanced GL Progress Invoice
    const invoiceRes = await makeRequest(
      'POST',
      `/api/projects/${prjId}/certificates/${certId}/generate-invoice`,
      {},
      adminToken,
    );
    expect(invoiceRes.status).toBe(200);
    expect(invoiceRes.body.data.status).toBe('INVOICED');
    expect(invoiceRes.body.data.journal_id).toBeDefined();

    // 9. Verify General Ledger & Trial Balance
    const tbRes = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(tbRes.status).toBe(200);
    expect(tbRes.body.data.is_balanced).toBe(true);
    expect(tbRes.body.data.net_difference).toBe('0.00');
  });

  it('Fixed Assets Workflow: Asset Category -> Asset Registration -> Monthly Depreciation -> Asset Disposal with Gain -> Verify Trial Balance (M7)', async () => {
    // 1. Fetch open period
    const periodsRes = await makeRequest('GET', '/api/periods', undefined, accountantToken);
    expect(periodsRes.status).toBe(200);
    const openPeriod = periodsRes.body.data.find((p: any) => p.status === 'OPEN');
    expect(openPeriod).toBeDefined();

    // 2. Create Asset Category (IT Equipment)
    const catRes = await makeRequest(
      'POST',
      '/api/assets/categories',
      {
        code: 'CAT-IT',
        name: 'IT & Computing Equipment',
        depreciation_method: 'STRAIGHT_LINE',
        useful_life_months: 36,
        salvage_value_percentage: 5.0,
      },
      adminToken,
    );
    expect(catRes.status).toBe(201);
    const catId = catRes.body.data.id;

    // 3. Register Fixed Asset: High-Performance Dev Workstation
    // Cost: 360,000 PKR, Salvage: 18,000 PKR, Useful Life: 36 Months
    // Depreciable Base: 342,000 PKR => Monthly Depreciation: 342,000 / 36 = 9,500 PKR
    const assetRes = await makeRequest(
      'POST',
      '/api/assets',
      {
        asset_number: 'FA-IT-2026-001',
        name: 'Dev Studio Workstation Max',
        category_id: catId,
        acquisition_date: '2026-01-15',
        acquisition_cost: '360000.00',
        salvage_value: '18000.00',
        useful_life_months: 36,
        depreciation_method: 'STRAIGHT_LINE',
        location: 'Head Office - Engineering Bay',
        custodian_name: 'Lead Architect',
        serial_number: 'SN-APPLE-99281',
      },
      adminToken,
    );
    expect(assetRes.status).toBe(201);
    expect(assetRes.body.data.status).toBe('ACTIVE');
    const assetId = assetRes.body.data.id;

    // 4. Run Monthly Depreciation for the Asset
    const depRes = await makeRequest(
      'POST',
      `/api/assets/${assetId}/depreciate`,
      {
        period_id: openPeriod.id,
        period_months: 1,
      },
      adminToken,
    );
    expect(depRes.status).toBe(200);
    expect(new Money(depRes.body.data.depreciation_amount).format()).toBe('9500.00');
    expect(new Money(depRes.body.data.accumulated_depreciation).format()).toBe('9500.00');
    expect(new Money(depRes.body.data.current_book_value).format()).toBe('350500.00');
    expect(depRes.body.data.journal_id).toBeDefined();

    // 5. Dispose Asset at Proceeds of 370,000 PKR
    // Book value was 350,500 PKR => Gain on Disposal: 19,500 PKR
    // Debits: Bank 370,000 + AccumDeprec 9,500 = 379,500
    // Credits: AssetCost 360,000 + Gain 19,500 = 379,500
    const dispRes = await makeRequest(
      'POST',
      `/api/assets/${assetId}/dispose`,
      {
        proceeds: '370000.00',
        disposal_date: '2026-03-31',
      },
      adminToken,
    );
    expect(dispRes.status).toBe(200);
    expect(dispRes.body.data.status).toBe('DISPOSED');
    expect(dispRes.body.data.journal_id).toBeDefined();

    // 6. Verify Trial Balance is balanced
    const tbRes = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(tbRes.status).toBe(200);
    expect(tbRes.body.data.is_balanced).toBe(true);
    expect(tbRes.body.data.net_difference).toBe('0.00');
  });

  it('Point of Sale (POS) Workflow: Cashier Register -> Open Shift -> Process Cash & Card Sales -> Close Shift with Drawer Count & GL Posting -> Verify Trial Balance', async () => {
    // 1. Fetch an Item from catalog
    const itemsRes = await makeRequest('GET', '/api/items', undefined, accountantToken);
    expect(itemsRes.status).toBe(200);
    const item = itemsRes.body.data[0];
    expect(item).toBeDefined();

    // 2. Create POS Register
    const regRes = await makeRequest(
      'POST',
      '/api/pos/registers',
      {
        register_code: 'POS-TERM-01',
        name: 'Main Store Express Checkout',
      },
      adminToken,
    );
    expect(regRes.status).toBe(201);
    const registerId = regRes.body.data.id;

    // 3. Open POS Cashier Shift with 5,000 PKR Float
    const openSessRes = await makeRequest(
      'POST',
      '/api/pos/sessions/open',
      {
        register_id: registerId,
        opening_float: '5000.00',
      },
      adminToken,
    );
    expect(openSessRes.status).toBe(201);
    expect(openSessRes.body.data.status).toBe('OPEN');
    const sessionId = openSessRes.body.data.id;

    // 4. Process POS Order 1: Cash Sale
    // 2 units @ 500 = 1000, 100 discount = 900, 16% Tax = 144 => Total = 1044 PKR
    // Tendered: 1100 PKR, Change: 56 PKR
    const order1Res = await makeRequest(
      'POST',
      '/api/pos/orders',
      {
        session_id: sessionId,
        payment_method: 'CASH',
        items: [
          {
            item_id: item.id,
            item_code: item.code,
            item_name: item.name,
            quantity: '2.00',
            unit_price: '500.00',
          },
        ],
        discount_amount: '100.00',
        tax_percentage: '16.00',
        cash_tendered: '1100.00',
      },
      adminToken,
    );
    expect(order1Res.status).toBe(201);
    expect(new Money(order1Res.body.data.total_amount).format()).toBe('1044.00');
    expect(new Money(order1Res.body.data.change_due).format()).toBe('56.00');

    // 5. Process POS Order 2: Card Sale
    // 4 units @ 500 = 2000, 0 discount, 16% Tax = 320 => Total = 2320 PKR
    const order2Res = await makeRequest(
      'POST',
      '/api/pos/orders',
      {
        session_id: sessionId,
        payment_method: 'CARD',
        items: [
          {
            item_id: item.id,
            item_code: item.code,
            item_name: item.name,
            quantity: '4.00',
            unit_price: '500.00',
          },
        ],
        discount_amount: '0.00',
        tax_percentage: '16.00',
      },
      adminToken,
    );
    expect(order2Res.status).toBe(201);
    expect(new Money(order2Res.body.data.total_amount).format()).toBe('2320.00');

    // 6. Close POS Session with exact cash count
    // Opening float = 5,000 + Cash sales = 1,044 => Expected cash = 6,044 PKR
    const closeRes = await makeRequest(
      'POST',
      `/api/pos/sessions/${sessionId}/close`,
      {
        actual_cash_drawer: '6044.00',
      },
      adminToken,
    );
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('CLOSED');
    expect(new Money(closeRes.body.data.cash_difference).format()).toBe('0.00');
    expect(closeRes.body.data.closing_journal_id).toBeDefined();

    // 7. Verify Trial Balance is balanced
    const tbRes = await makeRequest('GET', '/api/ledger/trial-balance?as_of_date=2026-03-31', undefined, controllerToken);
    expect(tbRes.status).toBe(200);
    expect(tbRes.body.data.is_balanced).toBe(true);
    expect(tbRes.body.data.net_difference).toBe('0.00');
  });
});



