/**
 * Role-based access control. Roles are scoped to an organization
 * (stored on the Membership), except `platform_admin`, which is a flag on
 * the User and never grants access to tenant data by itself.
 */
export const ORG_ROLES = ['owner', 'admin', 'sales_manager', 'sales_rep', 'analyst'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Organization owner',
  admin: 'Organization administrator',
  sales_manager: 'Sales manager',
  sales_rep: 'Sales representative',
  analyst: 'Read-only analyst',
};

export const PERMISSIONS = [
  'org:read',
  'org:update',
  'org:delete',
  'members:read',
  'members:manage',
  'billing:read',
  'billing:manage',
  'products:read',
  'products:write',
  'knowledge:read',
  'knowledge:write',
  'agents:read',
  'agents:write',
  'agents:publish',
  'conversations:read',
  'conversations:reply',
  'conversations:manage',
  'leads:read:all',
  'leads:read:assigned',
  'leads:write:all',
  'leads:write:assigned',
  'leads:assign',
  'leads:export',
  'pipeline:manage',
  'approvals:read',
  'approvals:decide',
  'widget:read',
  'widget:manage',
  'integrations:read',
  'integrations:manage',
  'analytics:read',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== 'org:delete' && p !== 'billing:manage'),
  sales_manager: [
    'org:read',
    'members:read',
    'products:read',
    'products:write',
    'knowledge:read',
    'knowledge:write',
    'agents:read',
    'conversations:read',
    'conversations:reply',
    'conversations:manage',
    'leads:read:all',
    'leads:read:assigned',
    'leads:write:all',
    'leads:write:assigned',
    'leads:assign',
    'leads:export',
    'pipeline:manage',
    'approvals:read',
    'approvals:decide',
    'widget:read',
    'integrations:read',
    'analytics:read',
  ],
  sales_rep: [
    'org:read',
    'members:read',
    'products:read',
    'knowledge:read',
    'agents:read',
    'conversations:read',
    'conversations:reply',
    'leads:read:assigned',
    'leads:write:assigned',
    'approvals:read',
    'widget:read',
    'analytics:read',
  ],
  analyst: [
    'org:read',
    'members:read',
    'products:read',
    'knowledge:read',
    'agents:read',
    'conversations:read',
    'leads:read:all',
    'leads:read:assigned',
    'approvals:read',
    'widget:read',
    'integrations:read',
    'analytics:read',
    'billing:read',
  ],
};

export function hasPermission(role: OrgRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Roles a given role may grant to others (no one can grant above their own level). */
export function assignableRoles(role: OrgRole): OrgRole[] {
  if (role === 'owner') return [...ORG_ROLES];
  if (role === 'admin') return ['admin', 'sales_manager', 'sales_rep', 'analyst'];
  return [];
}
