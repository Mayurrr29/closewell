import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Inbox,
  LogOut,
  Menu,
  MessageSquareCode,
  Package,
  PlugZap,
  Settings,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import type { Permission } from '@closewell/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOrg, useOrgId } from '../lib/org';
import { Logo, ThemeToggle } from './Brand';
import { Badge, ErrorState, Notice, Spinner, cx } from './ui';

const NAV: { to: string; label: string; icon: typeof Inbox; perm?: Permission; group: string }[] = [
  { to: '', label: 'Overview', icon: BarChart3, group: 'Sell', perm: 'analytics:read' },
  { to: 'inbox', label: 'Inbox', icon: Inbox, group: 'Sell', perm: 'conversations:read' },
  { to: 'leads', label: 'Leads', icon: UsersRound, group: 'Sell' },
  { to: 'approvals', label: 'Approvals', icon: CheckCircle2, group: 'Sell', perm: 'approvals:read' },
  { to: 'agent', label: 'Sales agent', icon: Bot, group: 'Configure', perm: 'agents:read' },
  { to: 'products', label: 'Products', icon: Package, group: 'Configure', perm: 'products:read' },
  { to: 'knowledge', label: 'Knowledge', icon: BookOpen, group: 'Configure', perm: 'knowledge:read' },
  { to: 'widget', label: 'Website chat', icon: MessageSquareCode, group: 'Configure', perm: 'widget:read' },
  { to: 'integrations', label: 'Integrations', icon: PlugZap, group: 'Configure' },
  { to: 'team', label: 'Team', icon: Users, group: 'Organization', perm: 'members:read' },
  { to: 'billing', label: 'Plan and usage', icon: CreditCard, group: 'Organization' },
  { to: 'audit', label: 'Audit log', icon: ClipboardList, group: 'Organization', perm: 'audit:read' },
  { to: 'settings', label: 'Settings', icon: Settings, group: 'Organization' },
];

export default function AppShell() {
  const orgId = useOrgId();
  const { user, memberships, logout, reload } = useAuth();
  const org = useOrg();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const pending = useQuery({
    queryKey: ['approvals-count', orgId],
    queryFn: () => api.list(`/orgs/${orgId}/approvals?pageSize=1`).then((r) => r.meta.total),
    enabled: !!org.data?.permissions.includes('approvals:read'),
    refetchInterval: 30_000,
  });

  if (org.isLoading) return <div className="px-6"><Spinner /></div>;
  if (org.isError) return <div className="mx-auto max-w-lg p-6"><ErrorState error={org.error} onRetry={() => nav('/app')} /></div>;
  const perms = org.data!.permissions;
  const items = NAV.filter((n) => !n.perm || perms.includes(n.perm));
  const groups = [...new Set(items.map((i) => i.group))];

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <div className="px-2">
        <Logo to={`/app/${orgId}`} />
      </div>
      {memberships.length > 1 ? (
        <select aria-label="Switch organization" className="mx-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" value={orgId} onChange={(e) => nav(`/app/${e.target.value}`)}>
          {memberships.map((m) => (
            <option key={m.orgId} value={m.orgId}>
              {m.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="truncate px-2 text-sm font-medium text-muted">{org.data!.name}</p>
      )}
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1 px-2 text-xs font-medium text-muted">{g}</p>
          <ul className="flex flex-col gap-0.5">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    end={i.to === ''}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition', isActive ? 'bg-brand-soft font-semibold text-brand' : 'text-ink hover:bg-sunken')}
                  >
                    <i.icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1">{i.label}</span>
                    {i.to === 'approvals' && !!pending.data && <Badge tone="ochre">{pending.data}</Badge>}
                  </NavLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <div className="mt-auto border-t border-line px-2 pt-4">
        <p className="truncate text-sm font-medium">{user?.name}</p>
        <p className="truncate text-xs text-muted">{user?.email}</p>
        <div className="mt-2 flex items-center gap-1">
          <ThemeToggle />
          <button onClick={() => logout().then(() => nav('/login'))} className="inline-flex items-center gap-1.5 rounded-lg p-2 text-sm text-muted hover:bg-sunken hover:text-ink">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface lg:block">{sidebar}</aside>
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Logo to={`/app/${orgId}`} />
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-sunken" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-lg p-1.5 hover:bg-sunken" aria-label="Close menu">
              <X className="size-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
        {user && !user.emailVerified && (
          <div className="mb-6">
            <VerifyBanner onReload={reload} />
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

function VerifyBanner({ onReload }: { onReload: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [mode, setMode] = useState('');
  return (
    <Notice tone="ochre" title="Verify your email address">
      Check your inbox for the verification link. You need a verified email to invite teammates and publish your agent.{' '}
      <button
        className="font-semibold underline underline-offset-2"
        onClick={() =>
          api
            .post<{ mode?: string }>('/auth/resend-verification')
            .then((r) => (setState('sent'), setMode(r.mode ?? '')))
            .catch(() => setState('error'))
        }
      >
        Resend the email
      </button>{' '}
      ·{' '}
      <button className="font-semibold underline underline-offset-2" onClick={() => void onReload()}>
        I've verified
      </button>
      {state === 'sent' && <span className="block pt-1">Sent.{mode === 'mock' && <> Email is in mock mode on this server: open the <a className="underline" href="/dev/mailbox">dev mailbox</a> to find the link.</>}</span>}
      {state === 'error' && <span className="block pt-1">Could not send the email. Try again in a few minutes.</span>}
    </Notice>
  );
}
