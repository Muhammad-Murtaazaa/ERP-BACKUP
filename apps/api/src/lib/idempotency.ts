import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@omnysync/contracts';
import { DbClient } from '@omnysync/platform';

/**
 * Command idempotency (logic.md step 4, API-AND-EVENTS.md). When a client sends an
 * `Idempotency-Key` header on a mutation, the first completed response is stored and
 * replayed for retries with the same payload; a different payload under the same
 * key is a conflict, and a concurrent duplicate while the first is still running is
 * rejected instead of executing twice (double-submit protection).
 */
export function idempotency(db: DbClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'];
    if (req.method !== 'POST' || typeof key !== 'string' || !key || !req.session) return next();
    if (key.length > 128) {
      return res.status(400).json({
        success: false,
        error: { code: ErrorCode.VALIDATION_FAILED, message: 'Idempotency-Key too long', correlation_id: req.correlationId },
      });
    }
    const hash = crypto
      .createHash('sha256')
      .update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? {})}`)
      .digest('hex');
    const org = req.session.organization_id;
    const user = req.session.user_id;

    try {
      const claimed = await db.query(
        `INSERT INTO idempotency_keys (organization_id, user_id, idem_key, request_hash, method, path)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING idem_key`,
        [org, user, key, hash, req.method, req.originalUrl.slice(0, 512)],
      );
      if (claimed.rows.length === 0) {
        const existing = await db.query(
          'SELECT * FROM idempotency_keys WHERE organization_id = $1 AND user_id = $2 AND idem_key = $3',
          [org, user, key],
        );
        const row = existing.rows[0];
        if (!row || row.request_hash !== hash) {
          return res.status(409).json({
            success: false,
            error: {
              code: ErrorCode.IDEMPOTENCY_CONFLICT,
              message: 'Idempotency-Key was already used with a different request',
              correlation_id: req.correlationId,
            },
          });
        }
        if (row.state !== 'COMPLETED') {
          return res.status(409).json({
            success: false,
            error: {
              code: ErrorCode.IDEMPOTENCY_CONFLICT,
              message: 'An identical request is still being processed',
              correlation_id: req.correlationId,
            },
          });
        }
        res.setHeader('idempotent-replay', 'true');
        const body = typeof row.response_body === 'string' ? JSON.parse(row.response_body) : row.response_body;
        return res.status(row.response_status).json(body);
      }
    } catch (err) {
      return next(err);
    }

    const originalJson = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      const status = res.statusCode;
      const persist =
        status < 500
          ? db.query(
              `UPDATE idempotency_keys SET state = 'COMPLETED', response_status = $4, response_body = $5
               WHERE organization_id = $1 AND user_id = $2 AND idem_key = $3`,
              [org, user, key, status, JSON.stringify(body)],
            )
          : db.query('DELETE FROM idempotency_keys WHERE organization_id = $1 AND user_id = $2 AND idem_key = $3', [org, user, key]);
      persist
        .catch(() => undefined)
        .finally(() => originalJson(body));
      return res;
    };
    next();
  };
}
