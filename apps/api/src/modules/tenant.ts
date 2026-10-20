import { Router } from 'express';
import { requireAuth, requireOrg } from '../middleware/auth';
import { agentsRouter } from './agents/routes';
import { analyticsRouter } from './analytics/routes';
import { approvalsRouter } from './approvals/routes';
import { auditRouter } from './audit/routes';
import { billingRouter } from './billing/routes';
import { conversationsRouter } from './conversations/routes';
import { integrationsRouter } from './integrations/routes';
import { knowledgeRouter } from './knowledge/routes';
import { leadsRouter, pipelineRouter } from './leads/routes';
import { orgScopedRouter } from './orgs/routes';
import { productsRouter } from './products/routes';
import { widgetAdminRouter } from './widget/admin';

/**
 * Everything under /api/orgs/:orgId. requireAuth + requireOrg run once here,
 * so no tenant route can be reached without a verified membership.
 */
export const tenantRouter = Router({ mergeParams: true });
tenantRouter.use(requireAuth, requireOrg);
tenantRouter.use('/products', productsRouter);
tenantRouter.use('/knowledge', knowledgeRouter);
tenantRouter.use('/leads', leadsRouter);
tenantRouter.use('/pipeline', pipelineRouter);
tenantRouter.use('/agents', agentsRouter);
tenantRouter.use('/conversations', conversationsRouter);
tenantRouter.use('/approvals', approvalsRouter);
tenantRouter.use('/widget', widgetAdminRouter);
tenantRouter.use('/analytics', analyticsRouter);
tenantRouter.use('/billing', billingRouter);
tenantRouter.use('/audit', auditRouter);
tenantRouter.use('/integrations', integrationsRouter);
tenantRouter.use('/', orgScopedRouter);
