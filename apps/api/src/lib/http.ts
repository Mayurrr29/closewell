import type { Request } from 'express';
import type { z } from 'zod';
import { AppError } from './errors';

/** Consistent response envelopes: { data } and { data, meta } for lists. */
export const ok = <T>(data: T) => ({ data });
export const paged = <T>(data: T[], page: number, pageSize: number, total: number) => ({
  data,
  meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
});

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new AppError('validation_failed', 'Some fields need attention', { fields });
  }
  return r.data;
}

export const body = <S extends z.ZodType>(req: Request, schema: S) => parse(schema, req.body ?? {});
export const query = <S extends z.ZodType>(req: Request, schema: S) => parse(schema, req.query);

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Truncate an IP for storage (data minimisation): keep /24 for IPv4, /48 for IPv6. */
export function coarseIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.0';
  return ip.split(':').slice(0, 3).join(':') + '::';
}
