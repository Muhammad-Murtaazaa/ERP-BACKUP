import { ErrorCode } from '@omnysync/contracts';

/**
 * Typed application error. Route handlers throw these; the central error handler
 * converts them to the StandardErrorResponse envelope with the correct HTTP status.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const validationError = (message: string, details?: unknown) =>
  new ApiError(400, ErrorCode.VALIDATION_FAILED, message, details);

export const notFound = (what: string) => new ApiError(404, ErrorCode.RESOURCE_NOT_FOUND, `${what} not found`);

export const invalidState = (message: string, details?: unknown) =>
  new ApiError(409, ErrorCode.INVALID_STATE, message, details);

export const forbidden = (message: string) => new ApiError(403, ErrorCode.UNAUTHORIZED, message);

export const sodViolation = (message: string) => new ApiError(403, ErrorCode.SEGREGATION_OF_DUTIES, message);
