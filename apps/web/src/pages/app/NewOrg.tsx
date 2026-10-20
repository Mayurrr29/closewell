import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Logo } from '../../components/Brand';
import { OrgProfileForm } from '../../components/OrgProfileForm';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/** Onboarding step 1 for a brand-new account: creates the organization. */
export default function NewOrg() {
  const nav = useNavigate();
  const { reload, user } = useAuth();
  const qc = useQueryClient();
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Logo to="/app" />
      <p className="mt-10 text-sm font-medium text-brand">Step 1 of 8</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Tell us about your business</h1>
      <p className="prose-measure mt-2 text-muted">Hi {user?.name?.split(' ')[0]}. Your sales agent treats what you write here as verified fact, so keep it accurate. You can change it later.</p>
      <div className="mt-8 rounded-xl border border-line bg-surface p-6">
        <OrgProfileForm
          submitLabel="Create organization"
          onSubmit={async (v) => {
            const org = await api.post<{ id: string }>('/orgs', v);
            await reload();
            qc.clear();
            nav(`/app/${org.id}/onboarding?step=2`, { replace: true });
          }}
        />
      </div>
    </div>
  );
}
