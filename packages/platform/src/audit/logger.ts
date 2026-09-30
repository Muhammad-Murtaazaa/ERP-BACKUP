import crypto from 'node:crypto';
import { DbClient } from '../db/driver.js';

export interface AuditRecordInput {
  organization_id: string;
  user_id?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state?: any;
  after_state?: any;
  correlation_id?: string;
}

export class AuditLogger {
  private db: DbClient;

  constructor(db: DbClient) {
    this.db = db;
  }

  async record(input: AuditRecordInput, client?: DbClient): Promise<string> {
    const db = client || this.db;
    const id = crypto.randomUUID();
    await db.query(
      `
      INSERT INTO audit_logs (
        id, organization_id, user_id, action, entity_type, entity_id, before_state, after_state, correlation_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
      [
        id,
        input.organization_id,
        input.user_id || null,
        input.action,
        input.entity_type,
        input.entity_id,
        input.before_state ? JSON.stringify(input.before_state) : null,
        input.after_state ? JSON.stringify(input.after_state) : null,
        input.correlation_id || null,
      ],
    );
    return id;
  }

  async log(input: any, client?: DbClient): Promise<string> {
    return this.record(
      {
        organization_id: input.organizationId || input.organization_id,
        user_id: input.userId || input.user_id,
        action: input.action,
        entity_type: input.entityType || input.entity_type,
        entity_id: input.entityId || input.entity_id,
        before_state: input.beforeState || input.before_state,
        after_state: input.afterState || input.after_state,
        correlation_id: input.correlationId || input.correlation_id,
      },
      client,
    );
  }

  async queryLogs(organization_id: string, entity_type?: string, entity_id?: string, limit: number = 100) {
    let sql = `SELECT * FROM audit_logs WHERE organization_id = $1`;
    const params: any[] = [organization_id];

    if (entity_type) {
      params.push(entity_type);
      sql += ` AND entity_type = $${params.length}`;
    }
    if (entity_id) {
      params.push(entity_id);
      sql += ` AND entity_id = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const res = await this.db.query(sql, params);
    return res.rows;
  }
}
