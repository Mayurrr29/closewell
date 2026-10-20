export function serializeMessage(m: Record<string, any>) {
  return {
    id: String(m._id),
    kind: m.kind,
    role: m.role,
    authorId: m.authorId ? String(m.authorId) : null,
    content: m.content,
    event: m.event?.type ? m.event : undefined,
    meta: m.meta ?? {},
    createdAt: m.createdAt,
  };
}

/** What the public widget may see: customer-facing messages only, no internal metadata. */
export function publicMessage(m: Record<string, any>) {
  return { id: String(m._id), role: m.role === 'customer' ? 'customer' : m.role === 'human' ? 'team' : 'assistant', content: m.content, createdAt: m.createdAt };
}

export function serializeConversation(c: Record<string, any>) {
  return {
    id: String(c._id),
    channel: c.channel,
    status: c.status,
    aiMode: c.aiMode,
    assignedTo: c.assignedTo ? String(c.assignedTo) : null,
    escalated: c.escalated,
    escalationReason: c.escalationReason,
    tags: c.tags,
    summary: c.summary,
    suggestedNextAction: c.suggestedNextAction,
    contact: c.contact,
    leadId: c.leadId ? String(c.leadId) : null,
    lastActivityAt: c.lastActivityAt,
    lastMessagePreview: c.lastMessagePreview,
    aiTurns: c.aiTurns,
    isTest: c.isTest,
    createdAt: c.createdAt,
    closedAt: c.closedAt,
  };
}
