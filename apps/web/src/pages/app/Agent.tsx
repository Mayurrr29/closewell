import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { PersonaSection, QualificationSection, RulesSection } from '../../components/agent/Sections';
import { Playground } from '../../components/agent/Playground';
import { useAgent } from '../../components/agent/useAgent';
import { Badge, Button, ErrorState, Notice, PageHeader, Panel, Spinner, Tabs, useToast } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';
import { useCan } from '../../lib/org';

type Tab = 'identity' | 'qualification' | 'rules' | 'test';

export default function AgentPage() {
  const a = useAgent();
  const can = useCan();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('identity');
  const publish = useMutation({
    mutationFn: () => api.post(`/orgs/${a.orgId}/agents/${a.agentId}/publish`),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['agent', a.orgId] }), toast('Published')),
    onError: (e) => toast(errorMessage(e), 'brick'),
  });
  const unpublish = useMutation({
    mutationFn: () => api.post(`/orgs/${a.orgId}/agents/${a.agentId}/unpublish`),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['agent', a.orgId] }), toast('Agent taken offline')),
  });
  if (a.isLoading || !a.draft || !a.detail.data) return <Spinner />;
  if (a.error) return <ErrorState error={a.error} />;
  const d = a.detail.data;
  const editable = can('agents:write');
  const missing = d.readiness.filter((r) => !r.ok);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={d.config.persona.displayName || 'Sales agent'}
        description="Edits are saved as a draft. Customers see the published version until you publish again."
        actions={
          <>
            {d.status === 'published' ? <Badge tone="pine">Live · version {d.publishedVersion}</Badge> : d.status === 'disabled' ? <Badge>Offline</Badge> : <Badge tone="ochre">Draft, not live</Badge>}
            {d.hasUnpublishedChanges && <Badge tone="ochre">Unpublished changes</Badge>}
            {can('agents:publish') && (
              <>
                {d.status === 'published' && <Button variant="secondary" loading={unpublish.isPending} onClick={() => unpublish.mutate()}>Take offline</Button>}
                <Button disabled={a.dirty || missing.length > 0 || !user?.emailVerified} loading={publish.isPending} onClick={() => publish.mutate()}>
                  {d.status === 'published' ? 'Publish changes' : 'Publish'}
                </Button>
              </>
            )}
          </>
        }
      />
      {d.provider.mode !== 'live' && (
        <div className="mb-4">
          <Notice tone="ochre" title={d.provider.mode === 'mock' ? 'Mock AI in use' : 'AI provider not configured'}>
            {d.provider.mode === 'mock' ? 'This server answers with a rule-based simulator, not a language model.' : 'AI_PROVIDER is openai but no API key is set.'} See <Link to="../integrations" relative="path" className="underline">Integrations</Link>.
          </Notice>
        </div>
      )}
      {missing.length > 0 && (
        <div className="mb-4">
          <Notice tone="brand" title="Before you can publish">
            <ul className="list-disc pl-5">{missing.map((m) => <li key={m.key}>{m.label}{m.key === 'simulation' && ' (use the Test tab)'}</li>)}</ul>
          </Notice>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} items={[{ value: 'identity', label: 'Identity' }, { value: 'qualification', label: 'Qualification' }, { value: 'rules', label: 'Rules and approvals' }, { value: 'test', label: 'Test' }]} />
      <div className="mt-6">
        {tab === 'test' ? (
          <Panel title="Test console" description={d.lastSimulationAt ? `Last test ${dateTime(d.lastSimulationAt)}` : 'Not tested since the last change.'}>
            {a.dirty && <div className="mb-3"><Notice tone="ochre">You have unsaved changes. Save them so the test uses them.</Notice></div>}
            <Playground orgId={a.orgId} agentId={a.agentId!} providerMode={d.provider.mode} onRan={() => qc.invalidateQueries({ queryKey: ['agent', a.orgId] })} />
          </Panel>
        ) : (
          <Panel padded>
            {tab === 'identity' && <PersonaSection cfg={a.draft} onChange={a.setDraft} disabled={!editable} />}
            {tab === 'qualification' && <QualificationSection cfg={a.draft} onChange={a.setDraft} disabled={!editable} />}
            {tab === 'rules' && <RulesSection cfg={a.draft} onChange={a.setDraft} disabled={!editable} tools={a.tools.data?.tools ?? []} />}
          </Panel>
        )}
      </div>
      {editable && tab !== 'test' && (
        <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-line bg-paper/95 py-3 backdrop-blur">
          {a.save.isError && <span className="text-sm text-brick">{errorMessage(a.save.error)}</span>}
          <Button disabled={!a.dirty} loading={a.save.isPending} onClick={() => a.save.mutate(a.draft!, { onSuccess: () => toast('Draft saved') })}>Save draft</Button>
          <Button variant="ghost" disabled={!a.dirty} onClick={() => a.setDraft(structuredClone(d.config))}>Discard changes</Button>
        </div>
      )}
    </div>
  );
}
