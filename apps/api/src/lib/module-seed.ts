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
