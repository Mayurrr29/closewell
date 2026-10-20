import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { TenantGuardError } from '../db/tenant';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}`, requestId: req.id } });
}

/** Converts every error into the standard envelope without leaking internals. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let e: AppError;
  if (err instanceof AppError) e = err;
  else if (err instanceof multer.MulterError) {
    e = err.code === 'LIMIT_FILE_SIZE' ? new AppError('payload_too_large', 'That file is larger than the upload limit.') : new AppError('bad_request', 'The upload could not be processed.');
  } else if (err instanceof mongoose.Error.CastError) e = new AppError('bad_request', `Invalid value for ${err.path}`);
  else if (err instanceof mongoose.Error.ValidationError) e = new AppError('validation_failed', 'Some fields need attention', { fields: Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message])) });
  else if ((err as { code?: number })?.code === 11000) e = new AppError('conflict', 'That record already exists.');
  else if ((err as { type?: string })?.type === 'entity.too.large') e = new AppError('payload_too_large', 'Request body is too large.');
  else if ((err as { type?: string })?.type === 'entity.parse.failed') e = new AppError('bad_request', 'Request body is not valid JSON.');
  else {
    const level = err instanceof TenantGuardError ? 'fatal' : 'error';
    logger[level]({ err, requestId: req.id, path: req.path }, 'Unhandled error');
    e = new AppError('internal', 'Something went wrong on our side. Try again, and contact support with the request id if it keeps happening.');
  }
  if (e.status >= 500 && !(err instanceof AppError && e.code !== 'internal')) {
    // already logged above
  }
  res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details, requestId: req.id } });
}
