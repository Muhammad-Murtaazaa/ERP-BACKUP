/**
 * Demo/sandbox seed for the modules added after the core pack (AGENTS.md rule 11: sample data
 * only in demo installations). Idempotent: every insert is ON CONFLICT DO NOTHING / guarded by
 * an existence check, so restarts and re-seeds do not duplicate records.
 */
import type { DbClient } from '@omnysync/platform';

const ORG = '10000000-0000-0000-0000-000000000001';
const LE = '20000000-0000-0000-0000-000000000001';
const ADMIN = '40000000-0000-0000-0000-000000000001';

export type ModuleSeeder = (q: DbClient, ctx: { org: string; le: string; admin: string }) => Promise<void>;
const seeders: { name: string; fn: ModuleSeeder }[] = [];
export function registerSeeder(name: string, fn: ModuleSeeder) {
  seeders.push({ name, fn });
}

export async function seedModules(q: DbClient): Promise<string[]> {
  const org = await q.query(`SELECT id FROM organizations WHERE id = $1`, [ORG]);
  if (!org.rows.length) return [];
  const done: string[] = [];
  for (const s of seeders) {
    await q.transaction(async (tx) => s.fn(tx, { org: ORG, le: LE, admin: ADMIN }));
    done.push(s.name);
  }
  return done;
}

registerSeeder('TAX', async (q, c) => {
  const codes = [
    ['GST18', 'Sales tax 18% (output)', 'OUTPUT', '18', '212001'],
    ['GST18-IN', 'Sales tax 18% (input, recoverable)', 'INPUT', '18', '114001'],
    ['WHT-S', 'Withholding on services 4.5%', 'WITHHOLDING', '4.5', '212002'],
    ['EXEMPT', 'Exempt supply', 'EXEMPT', '0', null],
  ];
  for (const [code, name, kind, rate, acc] of codes) {
    await q.query(
      `INSERT INTO tax_codes (organization_id, legal_entity_id, code, name, kind, rate, account_code, effective_from, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'2024-01-01',$8) ON CONFLICT (organization_id, code, effective_from) DO NOTHING`,
      [c.org, c.le, code, name, kind, rate, acc, c.admin],
    );
  }
});

registerSeeder('WMS', async (q, c) => {
  const wh = (await q.query(`SELECT id FROM warehouses WHERE organization_id = $1 ORDER BY is_default DESC, code LIMIT 1`, [c.org])).rows[0];
  if (!wh) return;
  for (const [code, type, cap] of [['A-01-01', 'PICK', '500'], ['A-01-02', 'PICK', '500'], ['B-BULK-01', 'BULK', null], ['STG-01', 'STAGING', null], ['QC-HOLD', 'QUARANTINE', null]]) {
    await q.query(`INSERT INTO warehouse_bins (warehouse_id, bin_code, bin_type, capacity_qty) VALUES ($1,$2,$3,$4) ON CONFLICT (warehouse_id, bin_code) DO NOTHING`, [wh.id, code, type, cap]);
  }
});

registerSeeder('AUT', async (q, c) => {
  const rules = [
    {
      code: 'EVT-HIGH-PRIORITY-CASE',
      name: 'Critical service case → alert service manager',
      event_type: 'SERVICE_CASE_CREATED',
      conditions: [{ field: 'priority', op: 'eq', value: 'CRITICAL' }],
      actions: [{ type: 'ALERT', severity: 'CRITICAL', title: 'Critical case {{number}}: {{title}}', assigned_role: 'SERVICE_MANAGER' }],
    },
    {
      code: 'EVT-BIG-DEAL-WON',
      name: 'Won opportunity ≥ 1M → onboarding task',
      event_type: 'CRM_OPPORTUNITY_WIN',
      conditions: [{ field: 'amount', op: 'gte', value: '1000000' }],
      actions: [{ type: 'TASK', title: 'Kick-off onboarding for {{name}}', assigned_role: 'SERVICE_MANAGER', due_in_days: 2 }],
    },
  ];
  for (const r of rules) {
    const def = { event_type: r.event_type, conditions: r.conditions, actions: r.actions };
    await q.query(
      `INSERT INTO automation_event_rules (organization_id, legal_entity_id, code, name, event_type, conditions, actions, status, version, published_definition, published_at, published_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PUBLISHED',1,$8,NOW(),$9,$9) ON CONFLICT (organization_id, code) DO NOTHING`,
      [c.org, c.le, r.code, r.name, r.event_type, JSON.stringify(r.conditions), JSON.stringify(r.actions), JSON.stringify(def), c.admin],
    );
  }
});

registerSeeder('SRV', async (q, c) => {
  const acc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '411002'`, [c.org])).rows[0];
  await q.query(
    `INSERT INTO items (id, organization_id, legal_entity_id, code, name, item_type, uom, unit_price, unit_cost, sales_account_id)
     VALUES (gen_random_uuid(), $1, $2, 'SRV-LABOUR', 'Service labour (per hour)', 'SERVICE', 'HOUR', 2500, 0, $3) ON CONFLICT (organization_id, code) DO NOTHING`,
    [c.org, c.le, acc?.id ?? null],
  );
  const techs = [
    ['T-001', 'Bilal Ahmed', '40000000-0000-0000-0000-000000000009', 'Split AC, VRF, refrigerant', 'Lahore – Gulberg', '900'],
    ['T-002', 'Usman Tariq', null, 'Chillers, ducting, electrical', 'Lahore – DHA', '1100'],
    ['T-003', 'Hamza Riaz', null, 'Installation, inverter AC', 'Lahore – Johar Town', '800'],
  ];
  for (const [code, name, user, skills, zone, cost] of techs) {
    const userOk = user ? (await q.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rows.length > 0 : false;
    await q.query(
      `INSERT INTO srv_technicians (organization_id, legal_entity_id, code, name, user_id, skills, zone, hourly_cost, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (organization_id, code) DO NOTHING`,
      [c.org, c.le, code, name, userOk ? user : null, skills, zone, cost, c.admin],
    );
  }
  const party = (await q.query(`SELECT id, name FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`, [c.org])).rows[0];
  if (!party) return;
  const has = await q.query(`SELECT 1 FROM srv_contracts WHERE organization_id = $1 AND number = 'SVC-DEMO-001'`, [c.org]);
  if (!has.rows.length) {
    await q.query(
      `INSERT INTO srv_contracts (organization_id, legal_entity_id, number, party_id, contract_type, title, site_address, equipment, start_date, end_date, response_hours, resolution_hours, covers_labour, covers_parts, visits_included, pm_interval_months, next_pm_date, contract_value, status, created_by)
       VALUES ($1,$2,'SVC-DEMO-001',$3,'AMC','Annual maintenance — HQ HVAC plant','Plot 12, Main Boulevard, Gulberg III, Lahore','2 × 10TR ducted split, 1 × VRF outdoor unit','2026-01-01','2026-12-31',4,24,true,false,4,3,'2026-10-01',480000,'ACTIVE',$4)`,
      [c.org, c.le, party.id, c.admin],
    );
  }
});

registerSeeder('CRM', async (q, c) => {
  const has = await q.query(`SELECT 1 FROM crm_leads WHERE organization_id = $1 LIMIT 1`, [c.org]);
  if (has.rows.length) return;
  const leads = [
    ['LEAD-DEMO-001', 'Ayesha Malik', 'Malik Residence', 'ayesha.malik@example.pk', '0300-1234567', 'REFERRAL', '3 × 1.5-ton inverter split install', 'Lahore', '420000', 'QUALIFIED'],
    ['LEAD-DEMO-002', 'Faisal Qureshi', 'Qureshi Textiles', 'faisal@qureshitex.example.pk', '0321-7654321', 'WEBSITE', 'Factory floor ducted cooling, ~60TR', 'Faisalabad', '5800000', 'CONTACTED'],
    ['LEAD-DEMO-003', 'Sana Javed', null, 'sana.j@example.pk', '0333-5550001', 'SOCIAL', 'AMC for 2 units', 'Lahore', '36000', 'NEW'],
  ];
  const { normPhone } = await import('../routes/crm.js');
  for (const [num, name, company, email, phone, source, interest, city, val, status] of leads) {
    await q.query(
      `INSERT INTO crm_leads (organization_id, legal_entity_id, number, name, company, email, email_norm, phone, phone_norm, source, interest, city, estimated_value, status, owner_user_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$15,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [c.org, c.le, num, name, company, email, phone, normPhone(phone), source, interest, city, val, status, c.admin, String(email).toLowerCase()],
    );
  }
  const party = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`, [c.org])).rows[0];
  if (!party) return;
  const opps = [
    ['OPP-DEMO-001', 'Office tower VRF retrofit', '12500000', 'PROPOSAL', 60, '2026-11-15'],
    ['OPP-DEMO-002', 'Clinic chiller AMC renewal', '850000', 'NEGOTIATION', 80, '2026-10-20'],
    ['OPP-DEMO-003', 'Showroom split units (8)', '1640000', 'SITE_SURVEY', 40, '2026-12-05'],
  ];
  for (const [num, name, amt, stage, prob, close] of opps) {
    await q.query(
      `INSERT INTO crm_opportunities (organization_id, legal_entity_id, number, name, party_id, amount, stage, probability, expected_close_date, owner_user_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [c.org, c.le, num, name, party.id, amt, stage, prob, close, c.admin],
    );
  }
});

registerSeeder('TIM', async (q, c) => {
  const emps = [
    ['EMP-101', 'Bilal', 'Ahmed', 'bilal.ahmed@omnysync.internal', '2024-03-01'],
    ['EMP-102', 'Usman', 'Tariq', 'usman.tariq@omnysync.internal', '2023-07-15'],
    ['EMP-103', 'Hamza', 'Riaz', 'hamza.riaz@omnysync.internal', '2025-01-10'],
    ['EMP-104', 'Mariam', 'Siddiqui', 'mariam.s@omnysync.internal', '2022-11-01'],
  ];
  for (const [num, first, last, email, joined] of emps) {
    await q.query(
      `INSERT INTO employees (id, organization_id, legal_entity_id, employee_number, first_name, last_name, email, employment_type, joining_date, status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'FULL_TIME', $7, 'ACTIVE') ON CONFLICT (legal_entity_id, employee_number) DO NOTHING`,
      [c.org, c.le, num, first, last, email, joined],
    );
  }
});

registerSeeder('SUP', async (q, c) => {
  const vendors = (await q.query(`SELECT id, name FROM parties WHERE organization_id = $1 AND party_type IN ('VENDOR','BOTH') ORDER BY code LIMIT 2`, [c.org])).rows;
  const cats = ['EQUIPMENT', 'SPARE_PARTS'];
  for (const [i, v] of vendors.entries()) {
    const r = await q.query(
      `INSERT INTO sup_profiles (organization_id, legal_entity_id, party_id, category, risk_level, contact_name, status, submitted_by, approved_by, approved_at, created_by)
       VALUES ($1,$2,$3,$4,'MEDIUM',$5,'APPROVED',$6,$6,NOW(),$6) ON CONFLICT (organization_id, party_id) DO NOTHING RETURNING id`,
      [c.org, c.le, v.id, cats[i], i === 0 ? 'Procurement desk' : 'Parts counter', c.admin],
    );
    if (!r.rows[0]) continue;
    for (const [type, ref, exp] of [['NTN', `NTN-${4410000 + i}`, null], ['STRN', `STRN-32770${i}`, null], ['OEM_AUTHORISATION', `OEM-${i}-2026`, i === 0 ? '2026-10-20' : '2027-06-30']]) {
      await q.query(`INSERT INTO sup_certificates (organization_id, legal_entity_id, profile_id, cert_type, reference, issued_on, expires_on, created_by) VALUES ($1,$2,$3,$4,$5,'2025-01-01',$6,$7)`, [c.org, c.le, r.rows[0].id, type, ref, exp, c.admin]);
    }
  }
});

registerSeeder('LOG', async (q, c) => {
  const vendor = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('VENDOR','BOTH') ORDER BY code LIMIT 1`, [c.org])).rows[0];
  const carriers = [
    ['TCS', 'TCS Express', 'COURIER', null, 'https://www.tcsexpress.com/track/{tracking}'],
    ['LEOPARDS', 'Leopards Courier', 'COURIER', null, null],
    ['DAEWOO-CARGO', 'Daewoo FastEx Cargo', 'ROAD', vendor?.id ?? null, null],
    ['OWN', 'OMNYSYNC service vans', 'OWN_FLEET', null, null],
  ];
  for (const [code, name, mode, party, url] of carriers) {
    await q.query(`INSERT INTO log_carriers (organization_id, legal_entity_id, code, name, mode, party_id, tracking_url_template, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, code, name, mode, party, url, c.admin]);
  }
});

registerSeeder('BI', async (q, c) => {
  const boards = [
    ['EXEC-OVERVIEW', 'Executive overview', 'Revenue trend, receivables risk, pipeline and field-service health.', [
      { dataset: 'revenue_by_month', chart: 'LINE', title: 'Revenue by month', measure: 'revenue' },
      { dataset: 'ar_aging', chart: 'BAR', title: 'Receivables aging', measure: 'outstanding' },
      { dataset: 'pipeline_by_stage', chart: 'BAR', title: 'Weighted pipeline', measure: 'weighted' },
      { dataset: 'service_cases_by_status', chart: 'BAR', title: 'Service cases (YTD)', measure: 'cases' },
      { dataset: 'expense_by_account', chart: 'TABLE', title: 'Top expenses', measure: 'amount' },
      { dataset: 'stock_value_by_item', chart: 'BAR', title: 'Stock value (top items)', measure: 'value' },
    ]],
    ['SERVICE-OPS', 'Service operations', 'SLA attainment and technician utilisation.', [
      { dataset: 'service_sla_by_priority', chart: 'BAR', title: 'SLA attainment % by priority', measure: 'attainment_pct' },
      { dataset: 'technician_hours', chart: 'BAR', title: 'Approved hours per technician', measure: 'hours' },
      { dataset: 'service_cases_by_status', chart: 'TABLE', title: 'Cases by status', measure: 'cases' },
    ]],
  ] as const;
  for (const [code, name, desc, widgets] of boards) {
    await q.query(`INSERT INTO bi_dashboards (organization_id, legal_entity_id, code, name, description, widgets, visibility, created_by) VALUES ($1,$2,$3,$4,$5,$6,'SHARED',$7) ON CONFLICT (organization_id, code) DO NOTHING`, [c.org, c.le, code, name, desc, JSON.stringify(widgets), c.admin]);
  }
});

registerSeeder('FLT', async (q, c) => {
  const vans = [
    ['VAN-01', 'LEB-21-4410', 'Suzuki Every 660cc', 2022, 'PETROL', '48210', '2027-03-31', '2026-10-15'],
    ['VAN-02', 'LEC-23-1187', 'Toyota Hiace 2.8', 2023, 'DIESEL', '61540', '2026-12-31', '2027-01-31'],
    ['BIKE-01', 'LEF-24-9022', 'Honda CD 70', 2024, 'PETROL', '12880', '2027-06-30', null],
  ];
  for (const [code, reg, mm, yr, fuel, odo, ins, fit] of vans) {
    await q.query(
      `INSERT INTO flt_vehicles (organization_id, legal_entity_id, code, registration, make_model, model_year, fuel_type, odometer_km, insurance_expiry, fitness_expiry, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (organization_id, code) DO NOTHING`,
      [c.org, c.le, code, reg, mm, yr, fuel, odo, ins, fit, c.admin],
    );
  }
});

registerSeeder('COM', async (q, c) => {
  const acc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '411007'`, [c.org])).rows[0];
  await q.query(
    `INSERT INTO items (id, organization_id, legal_entity_id, code, name, item_type, uom, unit_price, unit_cost, sales_account_id) VALUES (gen_random_uuid(), $1, $2, 'AMC-SUB', 'AMC subscription fee', 'SERVICE', 'PERIOD', 0, 0, $3) ON CONFLICT (organization_id, code) DO NOTHING`,
    [c.org, c.le, acc?.id ?? null],
  );
  const item = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'AMC-SUB'`, [c.org])).rows[0];
  const plans = [
    ['AMC-HOME', 'Home AMC — up to 3 split units', 'MONTHLY', '2500', 2, 'Two preventive visits a year, priority response, labour included.'],
    ['AMC-PLUS', 'Home AMC Plus — up to 6 units', 'QUARTERLY', '12000', 4, 'Quarterly visits, gas top-up labour, 4-hour response.'],
    ['AMC-COMM', 'Commercial AMC — VRF / ducted', 'ANNUAL', '180000', 12, 'Monthly visits for commercial plant, 2-hour critical response.'],
  ];
  for (const [code, name, interval, price, visits, desc] of plans) {
    await q.query(
      `INSERT INTO com_plans (organization_id, legal_entity_id, code, name, description, billing_interval, price, item_id, visits_per_year, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (organization_id, code) DO NOTHING`,
      [c.org, c.le, code, name, desc, interval, price, item.id, visits, c.admin],
    );
  }
});

registerSeeder('EPM', async (q, c) => {
  const b = await q.query(
    `INSERT INTO epm_budgets (organization_id, legal_entity_id, code, name, fiscal_year, scenario, version, notes, status, created_by) VALUES ($1,$2,'FY2026-OPS','FY2026 operating budget',2026,'BUDGET',1,'Demo budget — HVAC service revenue and core opex.','DRAFT',$3) ON CONFLICT (organization_id, code, version) DO NOTHING RETURNING id`,
    [c.org, c.le, c.admin],
  );
  if (!b.rows[0]) return;
  const annual: Record<string, number> = { '411001': 36000000, '411002': 24000000, '411007': 6000000, '511001': 21600000, '521001': 3600000, '521002': 14400000, '521003': 1800000, '521011': 2400000, '521012': 900000 };
  for (const [code, amt] of Object.entries(annual)) {
    const a = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = $2`, [c.org, code])).rows[0];
    if (!a) continue;
    for (let m = 1; m <= 12; m++) {
      // Mild seasonality: HVAC demand peaks May–August.
      const f = m >= 5 && m <= 8 ? 1.3 : m === 12 || m <= 2 ? 0.8 : 0.95;
      await q.query(`INSERT INTO epm_budget_lines (organization_id, budget_id, account_id, period_month, amount) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [c.org, b.rows[0].id, a.id, m, ((amt / 12) * (code.startsWith('4') || code === '511001' ? f : 1)).toFixed(2)]);
    }
  }
});
