/** Static catalogs shared by API and UI. */

export const INDUSTRIES = [
  { id: 'ecommerce', label: 'E-commerce' },
  { id: 'real_estate', label: 'Real estate' },
  { id: 'software_agency', label: 'Software development agency' },
  { id: 'saas', label: 'SaaS' },
  { id: 'education', label: 'Education' },
  { id: 'travel', label: 'Travel' },
  { id: 'automotive', label: 'Automotive' },
  { id: 'healthcare_admin', label: 'Healthcare administration' },
  { id: 'financial_services', label: 'Financial services' },
  { id: 'professional_services', label: 'Professional services' },
  { id: 'manufacturing', label: 'Manufacturing' },
  { id: 'b2b', label: 'B2B sales' },
  { id: 'local_business', label: 'Local business' },
  { id: 'other', label: 'Other' },
] as const;
export type IndustryId = (typeof INDUSTRIES)[number]['id'];
export const INDUSTRY_IDS = INDUSTRIES.map((i) => i.id) as [IndustryId, ...IndustryId[]];

export const SALES_STRATEGIES = [
  { id: 'consultative', label: 'Consultative selling', hint: 'Understand the problem first, then recommend.' },
  { id: 'product_led', label: 'Product-led selling', hint: 'Guide prospects to the right product and trial quickly.' },
  { id: 'b2b_qualification', label: 'B2B qualification', hint: 'Establish budget, authority, need and timeline.' },
  { id: 'appointment', label: 'Appointment-based selling', hint: 'Qualify briefly and get a meeting on the calendar.' },
  { id: 'ecommerce_assist', label: 'E-commerce assistance', hint: 'Help shoppers find, compare and choose products.' },
  { id: 'service_quotation', label: 'Service quotation', hint: 'Collect scope details so the team can quote.' },
  { id: 'inbound_qualification', label: 'Inbound lead qualification', hint: 'Capture contact details and route qualified leads.' },
] as const;
export type SalesStrategyId = (typeof SALES_STRATEGIES)[number]['id'];
export const SALES_STRATEGY_IDS = SALES_STRATEGIES.map((s) => s.id) as [SalesStrategyId, ...SalesStrategyId[]];

export const TONES = ['friendly', 'professional', 'concise', 'warm', 'enthusiastic', 'formal'] as const;
export type Tone = (typeof TONES)[number];

/**
 * Action categories (spec section 8):
 *  A: low risk, may run automatically.
 *  B: controlled, needs configured permission, validation and consent.
 *  C: sensitive, needs human approval unless a bounded rule allows it.
 */
export type ActionCategory = 'A' | 'B' | 'C';
/** What the organization has configured for a tool. */
export type ToolMode = 'auto' | 'approval' | 'disabled';

export interface ToolCatalogEntry {
  name: string;
  label: string;
  description: string;
  category: ActionCategory;
  /** Modes an organization may choose. Category C can never be 'auto' except via bounded rules. */
  allowedModes: ToolMode[];
  defaultMode: ToolMode;
  /** Requires the customer's consent recorded on the lead. */
  requiresConsent?: boolean;
  /** Not implemented in this release; always disabled. */
  comingSoon?: boolean;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { name: 'search_knowledge', label: 'Search knowledge base', description: 'Look up approved business information.', category: 'A', allowedModes: ['auto'], defaultMode: 'auto' },
  { name: 'get_products', label: 'Look up products', description: 'Read product and service details and list prices.', category: 'A', allowedModes: ['auto'], defaultMode: 'auto' },
  { name: 'record_lead_details', label: 'Record lead details', description: 'Save contact details and requirements the customer shares.', category: 'A', allowedModes: ['auto', 'disabled'], defaultMode: 'auto' },
  { name: 'record_qualification_answer', label: 'Record qualification answer', description: 'Save an answer to a configured qualification question.', category: 'A', allowedModes: ['auto', 'disabled'], defaultMode: 'auto' },
  { name: 'request_human_handoff', label: 'Hand off to a human', description: 'Escalate the conversation to the team.', category: 'A', allowedModes: ['auto'], defaultMode: 'auto' },
  { name: 'update_lead_stage', label: 'Update pipeline stage', description: 'Move the lead to a different open pipeline stage.', category: 'B', allowedModes: ['auto', 'approval', 'disabled'], defaultMode: 'approval' },
  { name: 'send_quotation', label: 'Send quotation', description: 'Send a quotation built from catalog prices.', category: 'B', allowedModes: ['approval', 'disabled'], defaultMode: 'approval', requiresConsent: true },
  { name: 'book_appointment', label: 'Book appointment', description: 'Book a meeting in an available slot.', category: 'B', allowedModes: ['disabled'], defaultMode: 'disabled', comingSoon: true },
  { name: 'schedule_follow_up', label: 'Schedule follow-up', description: 'Schedule a follow-up message.', category: 'B', allowedModes: ['disabled'], defaultMode: 'disabled', comingSoon: true },
  { name: 'offer_discount', label: 'Offer discount', description: 'Offer a discount. Within your bounded rule it can be automatic; anything else needs approval.', category: 'C', allowedModes: ['approval', 'disabled'], defaultMode: 'approval' },
  { name: 'propose_custom_terms', label: 'Propose custom terms', description: 'Payment terms, contractual commitments, refunds or legal terms. Always needs approval.', category: 'C', allowedModes: ['approval', 'disabled'], defaultMode: 'approval' },
];

export const DEFAULT_PIPELINE_STAGES = [
  { key: 'new', name: 'New', type: 'open' },
  { key: 'contacted', name: 'Contacted', type: 'open' },
  { key: 'qualified', name: 'Qualified', type: 'open' },
  { key: 'meeting_scheduled', name: 'Meeting Scheduled', type: 'open' },
  { key: 'proposal_sent', name: 'Proposal Sent', type: 'open' },
  { key: 'negotiation', name: 'Negotiation', type: 'open' },
  { key: 'won', name: 'Won', type: 'won' },
  { key: 'lost', name: 'Lost', type: 'lost' },
] as const;
export type StageType = 'open' | 'won' | 'lost';

export const CHANNELS = ['web', 'whatsapp', 'voice', 'playground'] as const;
export type Channel = (typeof CHANNELS)[number];

export const INTEGRATION_MODES = ['mock', 'sandbox', 'live', 'not_configured'] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

/** Dashboard metric definitions; the UI shows these verbatim. */
export const METRIC_DEFINITIONS: Record<string, string> = {
  total_leads: 'Leads created in the selected period, from any source.',
  qualified_leads: 'Leads created in the period whose current stage is Qualified or later (including Won).',
  active_conversations: 'Conversations that are open right now, regardless of period.',
  conversations: 'Conversations started in the selected period.',
  won_deals: 'Leads moved to a Won stage during the period. Only a stage change recorded by your team or an approved action counts; an AI conversation alone never counts as a sale.',
  recorded_revenue: 'Sum of the deal value entered on leads won during the period, in your organization currency.',
  conversion_rate: 'Won deals in the period divided by leads created in the period. Shown only when at least one lead was created.',
  ai_messages: 'AI replies sent in the period.',
  ai_cost: 'Estimated provider cost of AI replies in the period, from token counts and the configured price table. Not an invoice.',
  pending_approvals: 'Actions the AI requested that are waiting for a human decision.',
};
