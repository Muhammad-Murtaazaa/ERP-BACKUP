import crypto from 'node:crypto';
import { DbClient } from '../db/driver.js';

export interface OutboxMessageInput {
  organization_id: string;
  event_type: string;
  payload: any;
}

export class OutboxService {
  private db: DbClient;

  constructor(db: DbClient) {
    this.db = db;
  }

  async emit(message: OutboxMessageInput, client?: DbClient): Promise<string> {
    const db = client || this.db;
    const id = crypto.randomUUID();
    await db.query(
      `
      INSERT INTO outbox_events (
        id, organization_id, event_type, payload, status
      ) VALUES ($1, $2, $3, $4, 'PENDING')
    `,
      [id, message.organization_id, message.event_type, JSON.stringify(message.payload)],
    );
    return id;
  }

  async fetchPending(limit: number = 50) {
    const res = await this.db.query(
      `SELECT * FROM outbox_events WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT $1`,
      [limit],
    );
    return res.rows;
  }

  async markProcessed(id: string) {
    await this.db.query(
      `UPDATE outbox_events SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id],
    );
  }
}
