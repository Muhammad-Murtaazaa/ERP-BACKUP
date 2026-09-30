import { describe, it, expect, beforeAll } from 'vitest';
import { app, db } from '../src/index.js';
import { DbMigrator, SyntheticSeedRunner } from '@omnysync/platform';
import { Money } from '@omnysync/financial-engine';
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
});


