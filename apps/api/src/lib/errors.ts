export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'limit_exceeded'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'email_not_verified'
  | 'provider_unavailable'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  limit_exceeded: 402,
  payload_too_large: 413,
  unsupported_media_type: 415,
  email_not_verified: 403,
  provider_unavailable: 503,
  internal: 500,
};

/** An error whose message is safe to show to the API caller. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'Resource') => new AppError('not_found', `${what} not found`);
export const forbidden = (msg = 'You do not have permission to do that') => new AppError('forbidden', msg);
export const badRequest = (msg: string, details?: unknown) => new AppError('bad_request', msg, details);
export const conflict = (msg: string) => new AppError('conflict', msg);
