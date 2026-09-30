import type { Request, Response, NextFunction } from 'express';
import { ErrorCode, StandardErrorResponse } from '@omnysync/contracts';
import { ApiError } from './errors.js';

export function ok(req: Request, res: Response, data: unknown, status = 200, meta: Record<string, unknown> = {}) {
  return res.status(status).json({
    success: true,
    data,
    meta: { correlation_id: req.correlationId, timestamp: new Date().toISOString(), ...meta },
  });
}

/** Maps a PostgreSQL error (or trigger RAISE) to a typed API error. */
export function mapDbError(err: any): ApiError | null {
  const code: string | undefined = err?.code;
  const msg: string = String(err?.message || '');
  if (msg.startsWith('POSTED_FACT_IMMUTABLE')) return new ApiError(409, ErrorCode.POSTED_FACT_IMMUTABLE, msg);
  if (msg.startsWith('JOURNAL_UNBALANCED')) return new ApiError(400, ErrorCode.JOURNAL_UNBALANCED, msg);
  if (msg.startsWith('AUDIT_APPEND_ONLY')) return new ApiError(409, ErrorCode.POSTED_FACT_IMMUTABLE, msg);
  switch (code) {
    case '23505':
      return new ApiError(409, ErrorCode.DUPLICATE_RESOURCE, 'A record with the same unique identifier already exists', {
        constraint: err?.constraint,
      });
    case '23503':
      return new ApiError(400, ErrorCode.VALIDATION_FAILED, 'A referenced record does not exist', { constraint: err?.constraint });
    case '23514':
    case '23502':
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return new ApiError(400, ErrorCode.VALIDATION_FAILED, 'Input violates a data constraint', { constraint: err?.constraint });
    case '40001':
    case '40P01':
    case '55P03':
      return new ApiError(409, ErrorCode.STALE_REVISION, 'Concurrent update detected; retry the command');
    default:
      return null;
  }
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  let apiErr: ApiError | null = err instanceof ApiError ? err : mapDbError(err);
  if (!apiErr && err?.type === 'entity.parse.failed') {
    apiErr = new ApiError(400, ErrorCode.VALIDATION_FAILED, 'Malformed JSON body');
  }
  if (!apiErr && err?.type === 'entity.too.large') {
    apiErr = new ApiError(413, ErrorCode.VALIDATION_FAILED, 'Request body too large');
  }
  if (!apiErr && /Invalid decimal string format for Money|Invalid numeric input for Money|Division by zero/.test(String(err?.message))) {
    apiErr = new ApiError(400, ErrorCode.VALIDATION_FAILED, String(err.message));
  }
  if (!apiErr) {
    // Unexpected failure: log with correlation id, never leak internals to the client.
    console.error(`[${req.correlationId}] Unhandled error:`, err?.message || err);
    apiErr = new ApiError(500, ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred. Quote the correlation id to support.');
  }
  if (res.headersSent) return;
  const body: StandardErrorResponse = {
    success: false,
    error: { code: apiErr.code, message: apiErr.message, correlation_id: req.correlationId, details: apiErr.details },
  };
  res.status(apiErr.status).json(body);
}

/**
 * Express 4 does not forward rejected promises from async handlers; an exception in
 * any handler used to leave the request hanging. This patches the route registration
 * methods so every handler's rejection reaches the error middleware.
 */
export function wrapAsyncRoutes(app: any) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = app[method].bind(app);
    app[method] = (path: unknown, ...handlers: unknown[]) => {
      if (handlers.length === 0) return original(path);
      const wrapped = handlers.map((h) =>
        typeof h === 'function'
          ? (req: Request, res: Response, next: NextFunction) => {
              try {
                const out = (h as any)(req, res, next);
                if (out && typeof out.then === 'function') out.catch(next);
              } catch (e) {
                next(e);
              }
            }
          : h,
      );
      return original(path, ...wrapped);
    };
  }
}
