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
  // Self-service link: the demo technician login owns employee EMP-105.
  const tech = (await q.query(`SELECT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.organization_id = $1 AND u.email = 'tech@omnysync.internal'`, [c.org])).rows[0];
  if (tech) {
    const [first, ...rest] = String(tech.name || 'Field Technician').split(' ');
    await q.query(
      `INSERT INTO employees (id, organization_id, legal_entity_id, employee_number, first_name, last_name, email, employment_type, joining_date, status, user_id)
       VALUES (gen_random_uuid(), $1, $2, 'EMP-105', $3, $4, 'tech@omnysync.internal', 'FULL_TIME', '2024-06-01', 'ACTIVE', $5) ON CONFLICT (legal_entity_id, employee_number) DO NOTHING`,
      [c.org, c.le, first, rest.join(' ') || '-', tech.id],
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

registerSeeder('LND', async (q, c) => {
  const exists = (await q.query(`SELECT 1 FROM lnd_loans WHERE organization_id = $1 AND number = 'LN-DEMO-001'`, [c.org])).rows.length;
  if (exists) return;
  const party = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') ORDER BY code LIMIT 1`, [c.org])).rows[0];
  if (!party) return;
  await q.query(
    `INSERT INTO lnd_loans (organization_id, legal_entity_id, number, party_id, purpose, principal, annual_rate, term_months, method, application_date, status, created_by) VALUES ($1,$2,'LN-DEMO-001',$3,'VRF upgrade financed over 12 months',850000,16,12,'ANNUITY',CURRENT_DATE,'DRAFT',$4)`,
    [c.org, c.le, party.id, c.admin],
  );
});

registerSeeder('GRC', async (q, c) => {
  const risks: [string, string, string, number, number, number | null, number | null, string][] = [
    ['RSK-HVAC-01', 'Refrigerant leak / gas handling injury on site', 'SAFETY', 3, 5, 2, 4, 'Service manager'],
    ['RSK-HVAC-02', 'Fall from height during outdoor unit installation', 'SAFETY', 3, 5, null, null, 'Service manager'],
    ['RSK-FIN-01', 'Technician cash collections not deposited', 'FINANCIAL', 3, 3, 2, 2, 'Controller'],
    ['RSK-OPS-01', 'Warranty claims accepted outside coverage', 'OPERATIONAL', 4, 2, null, null, 'Service manager'],
    ['RSK-IT-01', 'Customer data exposure from lost technician phone', 'IT', 2, 4, null, null, 'IT lead'],
  ];
  for (const [code, title, cat, l, i, rl, ri, owner] of risks) {
    await q.query(
      `INSERT INTO grc_risks (organization_id, legal_entity_id, code, title, category, owner, likelihood, impact, residual_likelihood, residual_impact, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPEN',$11) ON CONFLICT (organization_id, code) DO NOTHING`,
      [c.org, c.le, code, title, cat, owner, l, i, rl, ri, c.admin],
    );
  }
  const controls: [string, string, string, string, string][] = [
    ['CTL-HVAC-01', 'RSK-HVAC-01', 'Leak detector + PPE checklist completed before charging', 'PREVENTIVE', 'MONTHLY'],
    ['CTL-FIN-01', 'RSK-FIN-01', 'Daily technician cash-up reconciled to job billing', 'DETECTIVE', 'MONTHLY'],
    ['CTL-OPS-01', 'RSK-OPS-01', 'Warranty eligibility check on case intake', 'PREVENTIVE', 'QUARTERLY'],
  ];
  for (const [code, risk, title, type, freq] of controls) {
    await q.query(
      `INSERT INTO grc_controls (organization_id, legal_entity_id, code, title, risk_id, control_type, frequency, owner, next_test_due, status, created_by) SELECT $1,$2,$3,$4,r.id,$5,$6,r.owner,CURRENT_DATE + 14,'OPERATING',$7 FROM grc_risks r WHERE r.organization_id = $1 AND r.code = $8 ON CONFLICT (organization_id, code) DO NOTHING`,
      [c.org, c.le, code, title, type, freq, c.admin, risk],
    );
  }
});

registerSeeder('TAL', async (q, c) => {
  const has = (await q.query(`SELECT 1 FROM tal_requisitions WHERE organization_id = $1 AND number = 'REQ-DEMO-001'`, [c.org])).rows.length;
  if (has) return;
  await q.query(
    `INSERT INTO tal_requisitions (organization_id, legal_entity_id, number, title, department, location, positions, salary_min, salary_max, justification, status, created_by) VALUES
     ($1,$2,'REQ-DEMO-001','HVAC Technician (split & VRF)','Field Service','Lahore',3,65000,95000,'Summer backlog: SLA breaches up; 3 extra technicians needed before May.','OPEN',$3),
     ($1,$2,'REQ-DEMO-002','Service Dispatcher','Field Service','Lahore',1,55000,75000,'Dispatch currently done by service manager.','DRAFT',$3)`,
    [c.org, c.le, c.admin],
  );
  const cands = [
    ['Ahmed Raza', 'ahmed.raza@example.pk', 'REFERRAL', 'R-410A charging, VRF commissioning, brazing', 6],
    ['Bilal Hussain', 'bilal.h@example.pk', 'JOB_BOARD', 'Split AC install, basic electrical', 2],
    ['Usman Tariq', 'usman.tariq@example.pk', 'WALK_IN', 'Chiller maintenance, ducting', 9],
  ] as const;
  for (const [n, e, s, sk, y] of cands) {
    await q.query(`INSERT INTO tal_candidates (organization_id, legal_entity_id, full_name, email, source, skills, years_experience, current_city, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'Lahore',$8) ON CONFLICT DO NOTHING`, [c.org, c.le, n, e, s, sk, y, c.admin]);
  }
  await q.query(
    `INSERT INTO tal_applications (organization_id, legal_entity_id, requisition_id, candidate_id, status, created_by)
     SELECT $1, $2, r.id, k.id, CASE k.email WHEN 'ahmed.raza@example.pk' THEN 'INTERVIEW' WHEN 'usman.tariq@example.pk' THEN 'SCREENING' ELSE 'APPLIED' END, $3
     FROM tal_requisitions r, tal_candidates k WHERE r.organization_id = $1 AND r.number = 'REQ-DEMO-001' AND k.organization_id = $1 ON CONFLICT DO NOTHING`,
    [c.org, c.le, c.admin],
  );
});

registerSeeder('FX', async (q, c) => {
  const rates = [
    ['USD', 'PKR', '278.500000000000', '2026-01-01'],
    ['USD', 'PKR', '279.100000000000', '2026-02-01'],
    ['USD', 'PKR', '278.850000000000', '2026-03-01'],
    ['EUR', 'PKR', '302.200000000000', '2026-03-01'],
    ['GBP', 'PKR', '355.800000000000', '2026-03-01'],
    ['AED', 'PKR', '75.820000000000', '2026-03-01'],
    ['SAR', 'PKR', '74.250000000000', '2026-03-01'],
  ];
  for (const [from, to, rate, dt] of rates) {
    await q.query(
      `INSERT INTO exchange_rates (id, organization_id, from_currency, to_currency, rate, effective_date, source)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'MANUAL')
       ON CONFLICT (organization_id, from_currency, to_currency, effective_date) DO NOTHING`,
      [c.org, from, to, rate, dt],
    );
  }
});

registerSeeder('TREASURY', async (q, c) => {
  const bankAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [c.org])).rows[0];
  if (!bankAcc) return;

  const stmtId = '80000000-0000-0000-0000-000000000001';
  await q.query(
    `INSERT INTO bank_statements (id, organization_id, legal_entity_id, bank_account_id, statement_reference, statement_date, opening_balance, closing_balance, status, created_by)
     VALUES ($1, $2, $3, $4, 'STMT-2026-03', '2026-03-31', 10000000, 11450000, 'RECONCILING', $5)
     ON CONFLICT (legal_entity_id, bank_account_id, statement_reference) DO NOTHING`,
    [stmtId, c.org, c.le, bankAcc.id, c.admin],
  );

  const lines = [
    [1, '2026-03-05', '450000.00', 'CR-001', 'Direct Customer Wire - Horizon Retail', false],
    [2, '2026-03-12', '-120000.00', 'DR-002', 'Utility Bill Direct Debit - K-Electric', false],
    [3, '2026-03-18', '1250000.00', 'CR-003', 'POS Daily Settlement - Merchant Batch 881', false],
    [4, '2026-03-25', '-130000.00', 'DR-004', 'Supplier Cheque Clearing - Apex Industrial', false],
  ];
  for (const [num, dt, amt, ref, desc, matched] of lines) {
    await q.query(
      `INSERT INTO bank_statement_lines (id, statement_id, line_number, transaction_date, amount, reference, description, is_matched)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (statement_id, line_number) DO NOTHING`,
      [stmtId, num, dt, amt, ref, desc, matched],
    );
  }
});

registerSeeder('RETAIL_EXTRA', async (q, c) => {
  const salesAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '411001'`, [c.org])).rows[0]?.id;
  const cogsAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '511001'`, [c.org])).rows[0]?.id;
  const invAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '113001'`, [c.org])).rows[0]?.id;
  const branch = (await q.query(`SELECT id FROM branches WHERE organization_id = $1 LIMIT 1`, [c.org])).rows[0]?.id;
  const wh = (await q.query(`SELECT id FROM warehouses WHERE organization_id = $1 ORDER BY is_default DESC LIMIT 1`, [c.org])).rows[0]?.id;

  const extraRetail = [
    { n: 20, code: 'RTL-MILK-1L', name: 'MilkPak Full Cream 1L', price: '290', cost: '240', qty: '120', tax: '0', cat: 'DAIRY', barcode: '8961000000204' },
    { n: 21, code: 'RTL-YOGURT-400', name: 'Nestle Sweet Yogurt 400g', price: '160', cost: '125', qty: '80', tax: '0', cat: 'DAIRY', barcode: '8961000000211' },
    { n: 22, code: 'RTL-COKE-15', name: 'Coca Cola 1.5L', price: '230', cost: '170', qty: '140', tax: '18', cat: 'BEVERAGE', barcode: '8961000000228' },
    { n: 23, code: 'RTL-SPRITE-15', name: 'Sprite 1.5L', price: '230', cost: '170', qty: '100', tax: '18', cat: 'BEVERAGE', barcode: '8961000000235' },
    { n: 24, code: 'RTL-BISCUIT-LU', name: 'LU Prince Chocolate Biscuits Half Roll', price: '60', cost: '42', qty: '250', tax: '18', cat: 'SNACK', barcode: '8961000000242' },
    { n: 25, code: 'RTL-SOAP-DOVE', name: 'Dove Beauty Bar 100g', price: '240', cost: '185', qty: '110', tax: '18', cat: 'HOUSEHOLD', barcode: '8961000000259' },
    { n: 26, code: 'RTL-SHAMPOO-200', name: 'Head & Shoulders Shampoo 200ml', price: '580', cost: '460', qty: '60', tax: '18', cat: 'HOUSEHOLD', barcode: '8961000000266' },
    { n: 27, code: 'RTL-RICE-BAS-5K', name: 'Guard Super Basmati Rice 5kg', price: '2450', cost: '2100', qty: '45', tax: '0', cat: 'GROCERY', barcode: '8961000000273' },
    { n: 28, code: 'RTL-SUGAR-1K', name: 'Refined White Sugar 1kg', price: '160', cost: '135', qty: '300', tax: '0', cat: 'GROCERY', barcode: '8961000000280' },
    { n: 29, code: 'RTL-FLOUR-10K', name: 'Sunridge Chakki Atta 10kg', price: '1450', cost: '1280', qty: '50', tax: '0', cat: 'GROCERY', barcode: '8961000000297' },
    { n: 30, code: 'RTL-APPLE-KG', name: 'Kala Kulla Apples (per kg)', price: '340', cost: '260', qty: '75', tax: '0', cat: 'PRODUCE', plu: '00044', weighed: true },
    { n: 31, code: 'RTL-POTATO-KG', name: 'Fresh Potatoes (per kg)', price: '90', cost: '60', qty: '200', tax: '0', cat: 'PRODUCE', plu: '00045', weighed: true },
    { n: 32, code: 'RTL-CHICKEN-KG', name: 'Fresh Whole Chicken (per kg)', price: '620', cost: '510', qty: '90', tax: '0', cat: 'MEAT', plu: '00051', weighed: true },
    { n: 33, code: 'RTL-USB-DRIVE', name: 'SanDisk 64GB USB 3.0 Flash Drive', price: '1650', cost: '1150', qty: '35', tax: '18', cat: 'ELECTRONICS', barcode: '8961000000334' },
    { n: 34, code: 'RTL-HDMI-CBL', name: 'High-Speed HDMI Cable 2.0 (2m)', price: '850', cost: '480', qty: '40', tax: '18', cat: 'ELECTRONICS', barcode: '8961000000341' },
    { n: 35, code: 'RTL-LED-12W', name: 'Philips 12W Cool Daylight LED Bulb', price: '450', cost: '310', qty: '120', tax: '18', cat: 'HOUSEHOLD', barcode: '8961000000358' },
  ];

  for (const r of extraRetail) {
    const id = `71000000-0000-0000-0000-${String(r.n).padStart(12, '0')}`;
    await q.query(
      `INSERT INTO items (id, organization_id, legal_entity_id, code, name, item_type, uom, unit_price, unit_cost,
         sales_account_id, cogs_account_id, inventory_account_id, is_active, barcode, plu_code, tax_rate, is_weighed, category, reorder_point, reorder_qty)
       VALUES ($1,$2,$3,$4,$5,'INVENTORY',$6,$7,$8,$9,$10,$11,true,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, unit_price = EXCLUDED.unit_price, barcode = EXCLUDED.barcode, plu_code = EXCLUDED.plu_code`,
      [id, c.org, c.le, r.code, r.name, r.weighed ? 'KG' : 'UNIT', r.price, r.cost, salesAcc, cogsAcc, invAcc,
        r.barcode ?? null, r.plu ?? null, r.tax, !!r.weighed, r.cat, r.weighed ? '10' : '20', r.weighed ? '50' : '100'],
    );
    if (branch && wh) {
      await q.query(
        `INSERT INTO stock_movements (id, organization_id, legal_entity_id, item_id, warehouse_id, location_id,
           movement_type, movement_date, quantity, unit_cost, total_value, description)
         VALUES ($1,$2,$3,$4,$5,$6,'OPENING','2026-03-01',$7,$8,$9,'Retail extra stock')
         ON CONFLICT (id) DO NOTHING`,
        [`7b000000-0000-0000-0000-${String(r.n).padStart(12, '0')}`, c.org, c.le, id, branch, wh, r.qty, r.cost, (Number(r.cost) * Number(r.qty)).toFixed(8)],
      );
    }
  }

  // Extra POS Registers
  const reg2 = '72000000-0000-0000-0000-000000000002';
  const reg3 = '72000000-0000-0000-0000-000000000003';
  if (wh) {
    await q.query(
      `INSERT INTO pos_registers (id, register_code, name, warehouse_id, is_active, organization_id, default_tax_rate, max_cashier_discount_percent, receipt_header, receipt_footer)
       VALUES ($1, 'POS-02', 'Express Checkout 2', $2, true, $3, '18', '10', 'OMNYSYNC MART - EXPRESS', 'Thank you for shopping!'),
              ($4, 'POS-03', 'Customer Service & Returns', $2, true, $3, '18', '15', 'OMNYSYNC MART - RETURNS DESK', 'Returns policy applies.')
       ON CONFLICT (organization_id, register_code) DO NOTHING`,
      [reg2, wh, c.org, reg3],
    );
  }
});

registerSeeder('TRADING', async (q, c) => {
  const cust = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND code = 'CUST-001'`, [c.org])).rows[0];
  const cust2 = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND code = 'CUST-002'`, [c.org])).rows[0];
  const vend = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND code = 'VEND-001'`, [c.org])).rows[0];
  const itmSrv = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SRV-01'`, [c.org])).rows[0];
  const itmSw = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SW-48'`, [c.org])).rows[0];
  const itmCat6 = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-CAT6-BOX'`, [c.org])).rows[0];
  const bankAcc = (await q.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = '111002'`, [c.org])).rows[0];

  if (cust && itmSrv && itmSw) {
    // 1. Sales Order
    const soId = '90000000-0000-0000-0000-000000000001';
    await q.query(
      `INSERT INTO sales_orders (id, organization_id, legal_entity_id, party_id, order_number, order_date, delivery_date, status, subtotal, tax_amount, total_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, 'SO-2026-0001', '2026-03-10', '2026-03-20', 'CONFIRMED', 1260000, 226800, 1486800, 'Data Center Server & Switch Supply', $5)
       ON CONFLICT (legal_entity_id, order_number) DO NOTHING`,
      [soId, c.org, c.le, cust.id, c.admin],
    );
    await q.query(
      `INSERT INTO sales_order_lines (id, sales_order_id, line_number, item_id, quantity, unit_price, line_total, description)
       VALUES (gen_random_uuid(), $1, 1, $2, 2, 450000, 900000, 'Server Rack Unit'),
              (gen_random_uuid(), $1, 2, $3, 2, 180000, 360000, 'Managed Switch 48-Port')
       ON CONFLICT (sales_order_id, line_number) DO NOTHING`,
      [soId, itmSrv.id, itmSw.id],
    );

    // 2. AR Invoice (Posted)
    const invId = '91000000-0000-0000-0000-000000000001';
    await q.query(
      `INSERT INTO ar_invoices (id, organization_id, legal_entity_id, party_id, sales_order_id, invoice_number, invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, 'INV-2026-0001', '2026-03-12', '2026-04-11', 'POSTED', 1260000, 226800, 1486800, 1486800, 'Invoice for SO-2026-0001', $6)
       ON CONFLICT (legal_entity_id, invoice_number) DO NOTHING`,
      [invId, c.org, c.le, cust.id, soId, c.admin],
    );
    await q.query(
      `INSERT INTO ar_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, description)
       VALUES (gen_random_uuid(), $1, 1, $2, 2, 450000, 900000, 'Server Rack Unit'),
              (gen_random_uuid(), $1, 2, $3, 2, 180000, 360000, 'Managed Switch 48-Port')
       ON CONFLICT (invoice_id, line_number) DO NOTHING`,
      [invId, itmSrv.id, itmSw.id],
    );
  }

  if (vend && itmCat6) {
    // 3. Purchase Order
    const poId = '92000000-0000-0000-0000-000000000001';
    await q.query(
      `INSERT INTO purchase_orders (id, organization_id, legal_entity_id, party_id, po_number, po_date, expected_date, status, subtotal, tax_amount, total_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, 'PO-2026-0001', '2026-03-05', '2026-03-15', 'APPROVED', 200000, 36000, 236000, 'Bulk Cat6 Cable Procurement', $5)
       ON CONFLICT (legal_entity_id, po_number) DO NOTHING`,
      [poId, c.org, c.le, vend.id, c.admin],
    );
    await q.query(
      `INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, item_id, quantity, unit_price, line_total, description)
       VALUES (gen_random_uuid(), $1, 1, $2, 40, 5000, 200000, 'Cat6 Cable Box')
       ON CONFLICT (purchase_order_id, line_number) DO NOTHING`,
      [poId, itmCat6.id],
    );

    // 4. AP Bill
    const billId = '93000000-0000-0000-0000-000000000001';
    await q.query(
      `INSERT INTO ap_invoices (id, organization_id, legal_entity_id, party_id, purchase_order_id, invoice_number, invoice_date, due_date, status, subtotal, tax_amount, total_amount, outstanding_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, 'BILL-2026-0001', '2026-03-08', '2026-04-07', 'POSTED', 200000, 36000, 236000, 236000, 'Apex Supplies Invoice for PO-2026-0001', $6)
       ON CONFLICT (legal_entity_id, invoice_number) DO NOTHING`,
      [billId, c.org, c.le, vend.id, poId, c.admin],
    );
    await q.query(
      `INSERT INTO ap_invoice_lines (id, invoice_id, line_number, item_id, quantity, unit_price, line_total, description)
       VALUES (gen_random_uuid(), $1, 1, $2, 40, 5000, 200000, 'Cat6 Cable Box')
       ON CONFLICT (invoice_id, line_number) DO NOTHING`,
      [billId, itmCat6.id],
    );
  }
});

registerSeeder('HRM_PAYROLL', async (q, c) => {
  const depts = [
    ['DEPT-EXEC', 'Executive Management'],
    ['DEPT-FIN', 'Finance & Accounting'],
    ['DEPT-ENG', 'Engineering & Operations'],
    ['DEPT-SRV', 'Field Service & HVAC'],
    ['DEPT-SALES', 'Commercial & Sales'],
    ['DEPT-HR', 'Human Resources'],
  ];
  for (const [code, name] of depts) {
    await q.query(
      `INSERT INTO departments (id, organization_id, legal_entity_id, code, name, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
       ON CONFLICT (legal_entity_id, code) DO NOTHING`,
      [c.org, c.le, code, name],
    );
  }

  const desigs = [
    ['DESIG-CEO', 'Chief Executive Officer'],
    ['DESIG-CFO', 'Chief Financial Officer'],
    ['DESIG-ENG-SR', 'Senior Systems Engineer'],
    ['DESIG-TECH-LEAD', 'Lead HVAC Technician'],
    ['DESIG-ACC-SR', 'Senior Accountant'],
    ['DESIG-SALES-MGR', 'Commercial Sales Manager'],
  ];
  for (const [code, title] of desigs) {
    await q.query(
      `INSERT INTO designations (id, organization_id, legal_entity_id, code, title, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
       ON CONFLICT (legal_entity_id, code) DO NOTHING`,
      [c.org, c.le, code, title],
    );
  }

  const salStructures = [
    ['Executive Grade E1', 'PKR', 300000, 100000, 30000, 20000, 0, 450000],
    ['Senior Professional P3', 'PKR', 140000, 50000, 15000, 15000, 0, 220000],
    ['Technical Specialist T2', 'PKR', 60000, 20000, 5000, 5000, 0, 90000],
  ] as const;
  for (const [name, curr, basic, hra, util, med, other, gross] of salStructures) {
    await q.query(
      `INSERT INTO salary_structures (id, organization_id, legal_entity_id, name, currency, basic_salary, house_rent_allowance, utility_allowance, medical_allowance, other_allowances, gross_salary, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       ON CONFLICT DO NOTHING`,
      [c.org, c.le, name, curr, basic, hra, util, med, other, gross],
    );
  }
});

registerSeeder('MANUFACTURING', async (q, c) => {
  const finished = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SRV-01'`, [c.org])).rows[0];
  const comp1 = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SW-48'`, [c.org])).rows[0];
  const comp2 = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-CAT6-BOX'`, [c.org])).rows[0];
  const wh = (await q.query(`SELECT id FROM warehouses WHERE organization_id = $1 ORDER BY is_default ASC LIMIT 1`, [c.org])).rows[0];

  if (!finished || !comp1 || !comp2 || !wh) return;

  const bomId = '94000000-0000-0000-0000-000000000001';
  await q.query(
    `INSERT INTO bill_of_materials (id, organization_id, bom_number, finished_item_id, name, version, yield_quantity, status)
     VALUES ($1, $2, 'BOM-SRV-RACK', $3, 'Enterprise Server Rack Assembly BOM', '1.0', 1.0, 'ACTIVE')
     ON CONFLICT (organization_id, bom_number) DO NOTHING`,
    [bomId, c.org, finished.id],
  );

  await q.query(
    `INSERT INTO bom_items (id, bom_id, component_item_id, quantity, scrap_percentage, notes)
     VALUES (gen_random_uuid(), $1, $2, 2, 0, '2x Managed Switches'),
            (gen_random_uuid(), $1, $3, 4, 2.5, '4x Cat6 Cable Boxes')
     ON CONFLICT DO NOTHING`,
    [bomId, comp1.id, comp2.id],
  );

  await q.query(
    `INSERT INTO work_orders (id, organization_id, work_order_number, bom_id, finished_item_id, warehouse_id, target_qty, completed_qty, status, start_date, due_date)
     VALUES (gen_random_uuid(), $1, 'WO-2026-001', $2, $3, $4, 5, 0, 'IN_PROGRESS', '2026-03-15', '2026-03-30')
     ON CONFLICT (organization_id, work_order_number) DO NOTHING`,
    [c.org, bomId, finished.id, wh.id],
  );
});

registerSeeder('PROJECTS', async (q, c) => {
  const cust = (await q.query(`SELECT id FROM parties WHERE organization_id = $1 AND party_type IN ('CUSTOMER','BOTH') LIMIT 1`, [c.org])).rows[0];

  const ccId = '95000000-0000-0000-0000-000000000001';
  await q.query(
    `INSERT INTO cost_centers (id, organization_id, code, name, cost_center_type, manager_name)
     VALUES ($1, $2, 'CC-KHI-DC', 'Karachi Data Center Projects', 'PROJECT', 'Director Projects')
     ON CONFLICT (organization_id, code) DO NOTHING`,
    [ccId, c.org],
  );

  const prjId = '95000000-0000-0000-0000-000000000002';
  await q.query(
    `INSERT INTO projects (id, organization_id, code, name, customer_id, manager_name, project_type, contract_value, budgeted_cost, retention_percentage, status, start_date, end_date, cost_center_id)
     VALUES ($1, $2, 'PRJ-2026-001', 'Karachi Tier-3 Data Center Expansion', $3, 'Engr. Farhan Siddiqui', 'EPC', 35000000, 24000000, 5.0, 'IN_PROGRESS', '2026-01-15', '2026-12-31', $4)
     ON CONFLICT (organization_id, code) DO NOTHING`,
    [prjId, c.org, cust?.id ?? null, ccId],
  );

  await q.query(
    `INSERT INTO project_wbs_nodes (id, project_id, wbs_code, name, budget_cost, progress_percentage, status)
     VALUES (gen_random_uuid(), $1, '1.0', 'Civil & Raised Flooring', 6000000, 100, 'COMPLETED'),
            (gen_random_uuid(), $1, '2.0', 'HVAC Precision Cooling & Containment', 10000000, 65, 'IN_PROGRESS'),
            (gen_random_uuid(), $1, '3.0', 'Power Infrastructure & UPS Busways', 8000000, 40, 'IN_PROGRESS')
     ON CONFLICT (project_id, wbs_code) DO NOTHING`,
    [prjId],
  );
});

registerSeeder('FIXED_ASSETS', async (q, c) => {
  const assetCatId = '96000000-0000-0000-0000-000000000001';
  await q.query(
    `INSERT INTO asset_categories (id, organization_id, code, name, depreciation_method, useful_life_months, salvage_value_percentage)
     VALUES ($1, $2, 'CAT-MACHINERY', 'Heavy Plant Machinery & Equipment', 'STRAIGHT_LINE', 60, 5.0)
     ON CONFLICT (organization_id, code) DO NOTHING`,
    [assetCatId, c.org],
  );

  await q.query(
    `INSERT INTO fixed_assets (id, organization_id, asset_number, name, category_id, acquisition_date, acquisition_cost, salvage_value, useful_life_months, depreciation_method, status, location, custodian_name, current_book_value, accumulated_depreciation)
     VALUES (gen_random_uuid(), $1, 'AST-FL-001', 'Toyota 3-Ton Electric Forklift', $2, '2025-01-01', 4500000, 225000, 60, 'STRAIGHT_LINE', 'ACTIVE', 'Central Warehouse KHI', 'Warehouse Incharge', 3645000, 855000),
            (gen_random_uuid(), $1, 'AST-GEN-002', 'Perkins 150kVA Standby Generator', $2, '2024-06-01', 5800000, 290000, 60, 'STRAIGHT_LINE', 'ACTIVE', 'Karachi Plant Substation', 'Plant Maintenance Lead', 3866666, 1933334)
     ON CONFLICT (organization_id, asset_number) DO NOTHING`,
    [c.org, assetCatId],
  );
});

registerSeeder('QUALITY', async (q, c) => {
  const itm = (await q.query(`SELECT id FROM items WHERE organization_id = $1 AND code = 'ITEM-SW-48'`, [c.org])).rows[0];
  if (!itm) return;

  const planId = '97000000-0000-0000-0000-000000000001';
  await q.query(
    `INSERT INTO quality_inspection_plans (id, organization_id, plan_code, name, item_id, inspection_type, sample_size, status)
     VALUES ($1, $2, 'QP-SW-INCOMING', 'Managed Switch Receiving Quality Checklist', $3, 'RECEIVING', 2.0, 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [planId, c.org, itm.id],
  );

  await q.query(
    `INSERT INTO quality_inspection_plan_params (id, plan_id, param_name, data_type, target_value, min_tolerance, max_tolerance, uom, is_mandatory)
     VALUES (gen_random_uuid(), $1, 'PoE Output Voltage', 'NUMERIC', '48.0', 46.0, 52.0, 'V', true),
            (gen_random_uuid(), $1, 'Port Link Integrity Check', 'BOOLEAN', 'true', null, null, null, true)
     ON CONFLICT (id) DO NOTHING`,
    [planId],
  );

  const lotId = '97000000-0000-0000-0000-000000000002';
  await q.query(
    `INSERT INTO quality_inspection_lots (id, organization_id, legal_entity_id, lot_number, source_type, item_id, batch_number, quantity, status, usage_decision_notes)
     VALUES ($1, $2, $3, 'QLOT-2026-001', 'GRN', $4, 'BATCH-2026-Q1', 25, 'ACCEPTED', 'All 48 ports and PoE parameters verified compliant.')
     ON CONFLICT (id) DO NOTHING`,
    [lotId, c.org, c.le, itm.id],
  );
});

registerSeeder('MAINTENANCE', async (q, c) => {
  const eqId = '98000000-0000-0000-0000-000000000001';
  await q.query(
    `INSERT INTO maintenance_equipment (id, organization_id, legal_entity_id, equipment_code, name, category, location, criticality, status, operating_hours)
     VALUES ($1, $2, $3, 'EQ-CHILLER-HQ', 'Carrier 60TR Central Screw Chiller', 'HVAC', 'HQ Plant Room', 'HIGH', 'OPERATIONAL', 4200)
     ON CONFLICT (id) DO NOTHING`,
    [eqId, c.org, c.le],
  );

  const schedId = '98000000-0000-0000-0000-000000000002';
  await q.query(
    `INSERT INTO pm_schedules (id, organization_id, equipment_id, schedule_name, frequency_type, frequency_interval, next_due_date, status)
     VALUES ($1, $2, $3, 'Quarterly Oil & Filter Preventive Service', 'TIME_BASED_DAYS', 90, '2026-04-15', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [schedId, c.org, eqId],
  );

  await q.query(
    `INSERT INTO maintenance_work_orders (id, organization_id, legal_entity_id, work_order_number, equipment_id, pm_schedule_id, order_type, priority, status, description, total_cost)
     VALUES (gen_random_uuid(), $1, $2, 'MWO-2026-001', $3, $4, 'PREVENTIVE', 'HIGH', 'COMPLETED', 'Completed 90-day oil change, refrigerant pressure check and coil wash.', 45000)
     ON CONFLICT (id) DO NOTHING`,
    [c.org, c.le, eqId, schedId],
  );
});

registerSeeder('HRM_WORKMAN_EXTRA', async (q, c) => {
  // 1. Geofence Zones
  const geo1 = '99000000-0000-0000-0000-000000000001';
  const geo2 = '99000000-0000-0000-0000-000000000002';
  await q.query(
    `INSERT INTO hrm_geofence_zones (id, organization_id, code, name, latitude, longitude, radius_meters, is_active)
     VALUES ($1, $2, 'GEO-KHI-HQ', 'Karachi Main Operations HQ', 24.8607000, 67.0011000, 150.0, true),
            ($3, $2, 'GEO-LHR-GUL', 'Lahore Service Center - Gulberg III', 31.5204000, 74.3587000, 200.0, true)
     ON CONFLICT (organization_id, code) DO NOTHING`,
    [geo1, c.org, geo2],
  );

  // 2. Shifts
  const shift1 = '99100000-0000-0000-0000-000000000001';
  const shift2 = '99100000-0000-0000-0000-000000000002';
  await q.query(
    `INSERT INTO hrm_shifts (id, organization_id, code, name, start_time, end_time, grace_period_minutes, half_day_hours, is_active)
     VALUES ($1, $2, 'SHIFT-STD-0918', 'Standard Office Shift (09:00 - 18:00)', '09:00', '18:00', 15, 4.5, true),
            ($3, $2, 'SHIFT-FIELD-0817', 'Field Technician Roster (08:00 - 17:00)', '08:00', '17:00', 20, 4.0, true)
     ON CONFLICT (organization_id, code) DO NOTHING`,
    [shift1, c.org, shift2],
  );

  // 3. Leave Types & Allocations
  const ltAnnual = '99200000-0000-0000-0000-000000000001';
  const ltSick = '99200000-0000-0000-0000-000000000002';
  const ltCasual = '99200000-0000-0000-0000-000000000003';
  await q.query(
    `INSERT INTO hrm_leave_types (id, organization_id, code, name, annual_quota, is_paid, is_active)
     VALUES ($1, $2, 'ANNUAL', 'Annual Paid Leave', 14, true, true),
            ($3, $2, 'SICK', 'Medical / Sick Leave', 8, true, true),
            ($4, $2, 'CASUAL', 'Casual / Personal Leave', 10, true, true)
     ON CONFLICT (organization_id, code) DO NOTHING`,
    [ltAnnual, c.org, ltSick, ltCasual],
  );

  const emps = (await q.query(`SELECT id FROM employees WHERE organization_id = $1 LIMIT 5`, [c.org])).rows;
  for (const emp of emps) {
    await q.query(
      `INSERT INTO hrm_leave_allocations (id, organization_id, employee_id, leave_type_id, year, allocated_days, used_days, remaining_days)
       VALUES (gen_random_uuid(), $1, $2, $3, 2026, 14, 2, 12),
              (gen_random_uuid(), $1, $2, $4, 2026, 8, 1, 7)
       ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING`,
      [c.org, emp.id, ltAnnual, ltSick],
    );
  }

  // 4. Staff Advances
  if (emps[0]) {
    const advId = '99300000-0000-0000-0000-000000000001';
    await q.query(
      `INSERT INTO hrm_advances (id, organization_id, legal_entity_id, number, employee_id, advance_type, amount, purpose, repayment_months, monthly_deduction, recovered_amount, balance_amount, status, created_by)
       VALUES ($1, $2, $3, 'ADV-2026-001', $4, 'PARTS_FLOAT', 45000, 'Emergency site spare parts float (VRF valves)', 3, 15000, 15000, 30000, 'DISBURSED', $5)
       ON CONFLICT (organization_id, number) DO NOTHING`,
      [advId, c.org, c.le, emps[0].id, c.admin],
    );
    await q.query(
      `INSERT INTO hrm_advance_installments (id, advance_id, installment_number, due_date, amount, recovered_amount, status)
       VALUES (gen_random_uuid(), $1, 1, '2026-02-28', 15000, 15000, 'DEDUCTED_IN_PAYROLL'),
              (gen_random_uuid(), $1, 2, '2026-03-31', 15000, 0, 'PENDING'),
              (gen_random_uuid(), $1, 3, '2026-04-30', 15000, 0, 'PENDING')
       ON CONFLICT (advance_id, installment_number) DO NOTHING`,
      [advId],
    );
  }

  // 5. Daily Attendance Logs
  if (emps[0]) {
    await q.query(
      `INSERT INTO hrm_attendance_logs (id, organization_id, employee_id, work_date, shift_id, check_in_time, check_out_time, check_in_lat, check_in_lng, geofence_zone_id, geofence_status, verification_method, status, total_hours, notes)
       VALUES (gen_random_uuid(), $1, $2, '2026-03-30', $3, '2026-03-30 08:58:00+05', '2026-03-30 18:02:00+05', 24.8607100, 67.0011200, $4, 'INSIDE_GEOFENCE', 'FACE_VERIFIED', 'PRESENT', 9.06, 'On-time biometric + GPS check-in')
       ON CONFLICT (employee_id, work_date) DO NOTHING`,
      [c.org, emps[0].id, shift1, geo1],
    );
  }

  // 6. Expense Claims
  if (emps[0]) {
    await q.query(
      `INSERT INTO hrm_expense_claims (id, organization_id, legal_entity_id, number, employee_id, claim_date, category, amount, description, receipt_reference, status, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'EXP-2026-001', $3, '2026-03-25', 'FUEL', 8500, 'Fuel refill for site survey van (LEB-21-4410)', 'PSO-RECEIPT-88912', 'APPROVED', $4),
              (gen_random_uuid(), $1, $2, 'EXP-2026-002', $3, '2026-03-28', 'TOOLS', 12500, 'Refrigerant manifold gauge set replacement', 'TOOL-INV-4419', 'SUBMITTED', $4)
       ON CONFLICT (organization_id, number) DO NOTHING`,
      [c.org, c.le, emps[0].id, c.admin],
    );
  }
});


