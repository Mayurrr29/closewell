import { Router } from 'express';
import { providerStatus } from '../../ai/providers';
import { env } from '../../config/env';
import { ok } from '../../lib/http';
import { ctx, requirePermission } from '../../middleware/auth';
import { WidgetConfig } from '../../models/conversations';

export const integrationsRouter = Router({ mergeParams: true });

/**
 * Real status of every integration. Nothing is reported as live unless it
 * is configured and working in this deployment.
 */
integrationsRouter.get('/', requirePermission('integrations:read', 'org:read'), async (req, res) => {
  const c = ctx(req);
  const widget = await WidgetConfig.findOne({ orgId: c.orgId }, { enabled: 1, allowedDomains: 1 }).lean();
  const ai = providerStatus();
  res.json(
    ok([
      {
        id: 'ai',
        name: 'AI model provider',
        mode: ai.mode,
        status: ai.mode === 'live' ? 'connected' : ai.mode === 'mock' ? 'mock' : 'needs_credentials',
        detail:
          ai.mode === 'mock'
            ? 'Replies come from a rule-based simulator, not a language model. Set AI_PROVIDER=openai and OPENAI_API_KEY on the server to use OpenAI.'
            : ai.mode === 'live'
              ? `${ai.label}. The key is stored on the server only.`
              : 'AI_PROVIDER=openai is set but OPENAI_API_KEY is missing.',
        requiredEnv: ['AI_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL'],
      },
      {
        id: 'web_widget',
        name: 'Website chat widget',
        mode: 'live',
        status: widget?.enabled ? 'connected' : 'disabled',
        detail: widget?.enabled ? `Enabled for ${widget.allowedDomains.join(', ')}` : 'Built in. Enable it in Widget settings and add your domain.',
        requiredEnv: [],
      },
      {
        id: 'email',
        name: 'Email delivery',
        mode: env.EMAIL_MODE === 'smtp' ? 'live' : 'mock',
        status: env.EMAIL_MODE === 'smtp' ? 'connected' : 'mock',
        detail: env.EMAIL_MODE === 'smtp' ? `SMTP via ${env.SMTP_HOST}` : 'Emails are captured on the server and not delivered (mock mode).',
        requiredEnv: ['EMAIL_MODE=smtp', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'],
      },
      { id: 'whatsapp', name: 'WhatsApp Business Platform', mode: 'not_configured', status: 'not_built', detail: 'Planned for the next milestone (Cloud API adapter with sandbox mode). Not available yet.', requiredEnv: [] },
      { id: 'voice', name: 'Voice calls', mode: 'not_configured', status: 'not_built', detail: 'Planned (telephony + speech adapters with a call simulator). Not available yet.', requiredEnv: [] },
      { id: 'calendar', name: 'Google Calendar', mode: 'not_configured', status: 'not_built', detail: 'Planned with appointment booking. Not available yet.', requiredEnv: [] },
      { id: 'payments', name: 'Payments', mode: 'not_configured', status: 'not_built', detail: 'No payment provider is connected. Plans and limits are enforced; nothing is charged.', requiredEnv: [] },
    ]),
  );
});
