import { TOOL_CATALOG, type AgentConfigInput, type IndustryId, type SalesStrategyId } from '@closewell/shared';

const STRATEGY_BY_INDUSTRY: Partial<Record<IndustryId, SalesStrategyId>> = {
  ecommerce: 'ecommerce_assist',
  real_estate: 'appointment',
  software_agency: 'service_quotation',
  saas: 'product_led',
  education: 'consultative',
  travel: 'consultative',
  automotive: 'appointment',
  healthcare_admin: 'appointment',
  financial_services: 'consultative',
  professional_services: 'service_quotation',
  manufacturing: 'b2b_qualification',
  b2b: 'b2b_qualification',
  local_business: 'inbound_qualification',
};

export function defaultToolModes(): Record<string, 'auto' | 'approval' | 'disabled'> {
  return Object.fromEntries(TOOL_CATALOG.map((t) => [t.name, t.defaultMode]));
}

/** A sensible starting agent for any industry. The business edits everything in onboarding. */
export function defaultAgentConfig(org: { name: string; industry: string }): AgentConfigInput {
  return {
    name: `${org.name} sales assistant`,
    persona: { displayName: 'Alex', tone: 'friendly', language: 'English', introduction: '' },
    strategy: STRATEGY_BY_INDUSTRY[org.industry as IndustryId] ?? 'consultative',
    goals: ['Understand what the customer needs', 'Recommend a suitable product or service', 'Capture contact details for follow-up'],
    qualificationQuestions: [
      { key: 'need', question: 'What are you hoping to achieve?', kind: 'need', required: true, weight: 15 },
      { key: 'timeline', question: 'When are you hoping to get started?', kind: 'timeline', required: false, weight: 10 },
      { key: 'budget', question: 'Do you have a budget range in mind?', kind: 'budget', required: false, weight: 10 },
    ],
    scoring: { qualifiedThreshold: 60, budgetMinimum: null, timelineMaxDays: null },
    policies: {
      autoDiscountEnabled: false,
      maxAutoDiscountPercent: 0,
      escalationKeywords: ['speak to a human', 'talk to a person', 'complaint', 'lawyer', 'refund'],
      maxAiTurnsBeforeHandoff: 0,
      businessRules: [],
      restrictedTopics: [],
      approvalExpiryHours: 48,
    },
    tools: defaultToolModes(),
  };
}
