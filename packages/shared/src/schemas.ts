import { z } from 'zod';
import { INDUSTRY_IDS, SALES_STRATEGY_IDS, TONES } from './catalog';
import { ORG_ROLES } from './permissions';

const trimmed = (max: number) => z.string().trim().max(max);
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Include at least one letter and one number');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')).pipe(z.string().max(254));

export const registerSchema = z.object({
  name: trimmed(100).min(1, 'Enter your name'),
  email: emailSchema,
  password: passwordSchema,
});
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password').max(128) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');

export const orgProfileSchema = z.object({
  name: trimmed(120).min(1, 'Enter the business name'),
  industry: z.enum(INDUSTRY_IDS),
  website: z.union([z.literal(''), z.url('Enter a full URL, e.g. https://example.com').max(300)]).optional(),
  country: trimmed(80).min(2, 'Enter a country'),
  currency: currencySchema,
  timezone: trimmed(64).min(1, 'Choose a timezone'),
  description: trimmed(2000).min(10, 'Describe the business in a sentence or two'),
});
export type OrgProfileInput = z.infer<typeof orgProfileSchema>;

export const inviteSchema = z.object({ email: emailSchema, role: z.enum(ORG_ROLES).exclude(['owner']) });
export const updateMemberSchema = z.object({ role: z.enum(ORG_ROLES) });

export const faqSchema = z.object({ question: trimmed(300).min(3), answer: trimmed(3000).min(1) });

export const productSchema = z.object({
  name: trimmed(160).min(1, 'Enter a name'),
  kind: z.enum(['product', 'service']).default('product'),
  description: trimmed(5000).default(''),
  sku: trimmed(80).optional(),
  pricingModel: z.enum(['fixed', 'starting_at', 'quote_only']).default('fixed'),
  price: z.number().nonnegative().max(1e10).nullable().default(null),
  currency: currencySchema.optional(),
  priceUnit: trimmed(40).optional(),
  availability: z.enum(['available', 'limited', 'unavailable', 'unknown']).default('available'),
  tags: z.array(trimmed(40)).max(20).default([]),
  faqs: z.array(faqSchema).max(50).default([]),
  active: z.boolean().default(true),
}).refine((p) => p.pricingModel === 'quote_only' || p.price !== null, { message: 'Enter a price, or choose “quote only”', path: ['price'] });
export type ProductInput = z.input<typeof productSchema>;

export const knowledgeTextSchema = z.object({
  title: trimmed(200).min(1),
  type: z.enum(['text', 'faq']).default('text'),
  content: z.string().max(200_000).optional(),
  faqs: z.array(faqSchema).max(200).optional(),
});
export const knowledgeUrlSchema = z.object({ url: z.url().max(500), title: trimmed(200).optional() });

export const qualificationQuestionSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Lowercase letters, numbers and underscores'),
  question: trimmed(300).min(3),
  kind: z.enum(['text', 'budget', 'timeline', 'need', 'authority', 'contact']).default('text'),
  required: z.boolean().default(false),
  weight: z.number().int().min(0).max(40).default(10),
});

export const toolModeSchema = z.enum(['auto', 'approval', 'disabled']);

export const agentConfigSchema = z.object({
  name: trimmed(80).min(1),
  persona: z.object({
    displayName: trimmed(60).min(1),
    tone: z.enum(TONES).default('friendly'),
    language: trimmed(40).default('English'),
    introduction: trimmed(500).default(''),
  }),
  strategy: z.enum(SALES_STRATEGY_IDS).default('consultative'),
  goals: z.array(trimmed(200)).max(10).default([]),
  qualificationQuestions: z.array(qualificationQuestionSchema).max(15).default([]),
  scoring: z
    .object({
      qualifiedThreshold: z.number().int().min(0).max(100).default(60),
      budgetMinimum: z.number().nonnegative().nullable().default(null),
      timelineMaxDays: z.number().int().positive().nullable().default(null),
    })
    .default({ qualifiedThreshold: 60, budgetMinimum: null, timelineMaxDays: null }),
  policies: z
    .object({
      autoDiscountEnabled: z.boolean().default(false),
      maxAutoDiscountPercent: z.number().min(0).max(50).default(0),
      escalationKeywords: z.array(trimmed(60)).max(30).default([]),
      maxAiTurnsBeforeHandoff: z.number().int().min(0).max(200).default(0),
      businessRules: z.array(trimmed(500)).max(30).default([]),
      restrictedTopics: z.array(trimmed(120)).max(30).default([]),
      approvalExpiryHours: z.number().int().min(1).max(720).default(48),
    })
    .default({ autoDiscountEnabled: false, maxAutoDiscountPercent: 0, escalationKeywords: [], maxAiTurnsBeforeHandoff: 0, businessRules: [], restrictedTopics: [], approvalExpiryHours: 48 }),
  tools: z.record(z.string(), toolModeSchema).default({}),
});
export type AgentConfigInput = z.input<typeof agentConfigSchema>;

export const leadSchema = z.object({
  name: trimmed(160).optional(),
  email: z.union([z.literal(''), emailSchema]).optional(),
  phone: trimmed(40).optional(),
  company: trimmed(160).optional(),
  source: z.enum(['web_widget', 'whatsapp', 'voice', 'manual', 'import', 'playground']).default('manual'),
  industry: trimmed(80).optional(),
  requirements: trimmed(5000).optional(),
  budget: z.object({ amount: z.number().nonnegative().nullable(), currency: currencySchema.optional() }).partial().optional(),
  timeline: trimmed(200).optional(),
  dealValue: z.number().nonnegative().nullable().optional(),
  assignedTo: objectId.nullable().optional(),
  stageKey: z.string().max(40).optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
  consent: z
    .object({
      contactAllowed: z.boolean(),
      marketingAllowed: z.boolean(),
      preferredChannel: z.enum(['email', 'phone', 'whatsapp', 'none']),
    })
    .partial()
    .optional(),
  tags: z.array(trimmed(40)).max(20).optional(),
});
export const leadUpdateSchema = leadSchema.partial().omit({ source: true });
export const leadNoteSchema = z.object({ body: trimmed(5000).min(1) });
export const reminderSchema = z.object({ dueAt: z.coerce.date(), note: trimmed(500).default('') });
export const stageChangeSchema = z.object({ stageKey: z.string().min(1).max(40), reason: trimmed(500).optional() });

export const pipelineSchema = z.object({
  stages: z
    .array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), name: trimmed(60).min(1), type: z.enum(['open', 'won', 'lost']) }))
    .min(2)
    .max(20)
    .refine((s) => s.some((x) => x.type === 'won') && s.some((x) => x.type === 'lost'), 'Include at least one Won and one Lost stage')
    .refine((s) => new Set(s.map((x) => x.key)).size === s.length, 'Stage keys must be unique'),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const widgetConfigSchema = z.object({
  enabled: z.boolean(),
  agentId: objectId.nullable().optional(),
  brandName: trimmed(80).min(1),
  greeting: trimmed(500).min(1),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #2563eb'),
  position: z.enum(['right', 'left']).default('right'),
  allowedDomains: z
    .array(z.string().trim().toLowerCase().regex(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$|^localhost(:\d+)?$/, 'Enter a domain like example.com or *.example.com'))
    .max(20),
  collectContact: z.enum(['off', 'optional', 'before_chat']).default('optional'),
  businessHours: z
    .object({
      enabled: z.boolean().default(false),
      timezone: trimmed(64).default('UTC'),
      days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
      start: hhmm.default('09:00'),
      end: hhmm.default('17:00'),
      offlineMessage: trimmed(500).default('Our team is offline right now. Leave your details and we will get back to you.'),
    })
    .default({ enabled: false, timezone: 'UTC', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', offlineMessage: 'Our team is offline right now. Leave your details and we will get back to you.' }),
});
export type WidgetConfigInput = z.input<typeof widgetConfigSchema>;

export const messageInputSchema = z.object({
  content: z.string().trim().min(1, 'Type a message').max(4000, 'Messages are limited to 4,000 characters'),
  clientMessageId: z.string().min(8).max(64).optional(),
});

export const conversationUpdateSchema = z.object({
  assignedTo: objectId.nullable().optional(),
  tags: z.array(trimmed(40)).max(20).optional(),
  status: z.enum(['open', 'closed']).optional(),
});

export const approvalDecisionSchema = z.object({ note: trimmed(1000).optional() });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export { objectId as objectIdSchema };
