/**
 * Event dispatcher: delivers committed outbox events to PUBLISHED event rules. Each
 * (rule, event) pair is claimed through a unique delivery row inside the same transaction as
 * the actions, so a replay, a second API instance or a crashed tick never repeats an action.
 * Only events committed after the rule's publication are considered (no retroactive storms).
 */
import type { DbClient } from '@omnysync/platform';
import { matchesAll, renderTemplate, type ActionSpec, type Condition } from './conditions.js';

const MAX_EVENTS = 500;

function addDays(d: Date, n: number) {
  const x = new Date(d.getTime() + n * 86400000);
  return x.toISOString().slice(0, 10);
}

export async function applyActions(q: DbClient, rule: any, def: { actions: ActionSpec[] }, ev: any, payload: any) {
  const results: any[] = [];
  for (const a of def.actions) {
    const title = renderTemplate(a.title, payload);
    const body = a.body ? renderTemplate(a.body, payload) : null;
    if (a.type === 'ALERT') {
      const dedupe = `EVENT_RULE:${rule.id}:${ev.id}`;
      await q.query(
        `INSERT INTO automation_alerts (organization_id, rule_id, category, severity, title, body, entity_type, entity_id, dedupe_key, data, assigned_role)
         VALUES ($1, NULL, 'EVENT_RULE', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [rule.organization_id, a.severity || 'INFO', title, body, ev.event_type, typeof payload.id === 'string' && /^[0-9a-f-]{36}$/i.test(payload.id) ? payload.id : null, dedupe, JSON.stringify({ rule: rule.code, event_id: ev.id }), a.assigned_role || null],
      );
      results.push({ type: 'ALERT', title });
    } else if (a.type === 'TASK') {
      await q.query(
        `INSERT INTO automation_tasks (organization_id, rule_id, event_id, title, body, assigned_role, due_date, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [rule.organization_id, rule.id, ev.id, title, body, a.assigned_role || null, a.due_in_days !== undefined ? addDays(new Date(ev.created_at), a.due_in_days) : null, ev.event_type, typeof payload.id === 'string' && /^[0-9a-f-]{36}$/i.test(payload.id) ? payload.id : null],
      );
      results.push({ type: 'TASK', title });
    }
  }
  return results;
}

export async function processEvents(db: DbClient, orgId?: string): Promise<{ delivered: number; matched: number }> {
  const params: any[] = [];
  let where = `r.status = 'PUBLISHED'`;
  if (orgId) {
    params.push(orgId);
    where += ` AND r.organization_id = $1`;
  }
  const pending = await db.query(
    `SELECT r.id AS rule_id, e.id AS event_id FROM automation_event_rules r
     JOIN outbox_events e ON e.organization_id = r.organization_id AND e.event_type = r.event_type AND e.created_at >= r.published_at
     WHERE ${where} AND NOT EXISTS (SELECT 1 FROM automation_event_deliveries d WHERE d.rule_id = r.id AND d.event_id = e.id)
     ORDER BY e.created_at LIMIT ${MAX_EVENTS}`,
    params,
  );
  let delivered = 0;
  let matched = 0;
  for (const p of pending.rows) {
    await db.transaction(async (tx) => {
      const rule = (await tx.query(`SELECT * FROM automation_event_rules WHERE id = $1 AND status = 'PUBLISHED'`, [p.rule_id])).rows[0];
      if (!rule) return;
      const ev = (await tx.query(`SELECT * FROM outbox_events WHERE id = $1`, [p.event_id])).rows[0];
      const def = typeof rule.published_definition === 'string' ? JSON.parse(rule.published_definition) : rule.published_definition;
      const payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload || {};
      const isMatch = matchesAll((def.conditions || []) as Condition[], payload);
      const claim = await tx.query(
        `INSERT INTO automation_event_deliveries (organization_id, rule_id, rule_version, event_id, matched) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (rule_id, event_id) DO NOTHING RETURNING id`,
        [rule.organization_id, rule.id, rule.version, ev.id, isMatch],
      );
      if (!claim.rows.length) return; // already delivered by a concurrent dispatcher
      delivered++;
      if (!isMatch) return;
      matched++;
      const results = await applyActions(tx, rule, def, ev, payload);
      await tx.query(`UPDATE automation_event_deliveries SET outcome = $2 WHERE id = $1`, [claim.rows[0].id, JSON.stringify(results)]);
    });
  }
  return { delivered, matched };
}
