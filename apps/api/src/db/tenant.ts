import type { Schema } from 'mongoose';

/**
 * Tenant guard: every query on a tenant-owned model must filter by orgId.
 *
 * Route handlers always take orgId from the server-side membership check
 * (req.ctx.orgId), never from the client. This plugin is the second line
 * of defence: if a developer forgets the orgId filter, the query throws
 * instead of silently reading or writing across tenants.
 *
 * Internal system jobs that intentionally work across tenants (e.g. an
 * expiry sweep) must opt out explicitly with `.setOptions({ crossTenant: true })`.
 */
export class TenantGuardError extends Error {}

const QUERY_OPS = [
  'find',
  'findOne',
  'countDocuments',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'replaceOne',
  'distinct',
] as const;

export function tenantPlugin(schema: Schema) {
  for (const op of QUERY_OPS) {
    schema.pre(op as 'find', function () {
      const opts = this.getOptions() as { crossTenant?: boolean };
      if (opts.crossTenant) return;
      const filter = this.getFilter() as Record<string, unknown>;
      if (filter.orgId === undefined || filter.orgId === null) {
        throw new TenantGuardError(`Tenant guard: ${this.model.modelName}.${op} called without an orgId filter`);
      }
    });
  }
  schema.pre('aggregate', function () {
    const opts = this.options as { crossTenant?: boolean };
    if (opts.crossTenant) return;
    const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
    if (!first?.$match || first.$match.orgId === undefined) {
      throw new TenantGuardError('Tenant guard: aggregate pipelines must start with a $match on orgId');
    }
  });
}
