import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWidget, WidgetSettings } from '../../components/WidgetSettings';
import { Badge, Button, Dialog, Notice, PageHeader, Panel, Spinner, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useCan, useOrgId } from '../../lib/org';

/** Loads the real widget script on this page. The app origin counts as preview, so the draft agent answers and nothing is counted in reports. */
function usePreview(key: string | undefined, on: boolean) {
  useEffect(() => {
    if (!on || !key) return;
    const s = document.createElement('script');
    s.src = '/widget.js';
    s.dataset.closewellKey = key;
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.querySelector('[data-closewell-widget]')?.remove();
      delete (window as unknown as { __closewell?: boolean }).__closewell;
    };
  }, [key, on]);
}

export default function WidgetPage() {
  const orgId = useOrgId();
  const can = useCan();
  const q = useWidget(orgId);
  const qc = useQueryClient();
  const toast = useToast();
  const [preview, setPreview] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  usePreview(q.data?.publicKey, preview);
  const rotate = useMutation({ mutationFn: () => api.post(`/orgs/${orgId}/widget/rotate-key`), onSuccess: () => (qc.invalidateQueries({ queryKey: ['widget', orgId] }), setConfirmRotate(false), toast('New key created. Update the snippet on your site.')) });
  if (q.isLoading) return <Spinner />;
  const w = q.data!;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Website chat"
        description="Add the chat to your website with one script tag. It contains no secret keys."
        actions={
          <>
            {w.enabled ? <Badge tone="pine">Live on {w.allowedDomains.length} domain{w.allowedDomains.length === 1 ? '' : 's'}</Badge> : <Badge>Off</Badge>}
            <Button variant="secondary" onClick={() => setPreview((p) => !p)}><Eye className="size-4" /> {preview ? 'Hide preview' : 'Preview on this page'}</Button>
          </>
        }
      />
      {preview && <div className="mb-4"><Notice tone="brand">The chat button is in the corner of this page. Previews use your draft agent and are marked as test data.</Notice></div>}
      {w.agentStatus !== 'published' && <div className="mb-4"><Notice tone="ochre">Your agent is not published, so visitors on your website will see “not available yet”. The preview still works.</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Panel title="Settings">
          <WidgetSettings orgId={orgId} canManage={can('widget:manage')} />
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title="Install">
            <p className="text-sm text-muted">Paste this before the closing &lt;/body&gt; tag on every page where the chat should appear.</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-sunken p-3 text-xs leading-relaxed"><code>{w.snippet}</code></pre>
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(w.snippet).then(() => toast('Snippet copied'), () => toast('Copy failed. Select the text instead.', 'brick'))}><Copy className="size-4" /> Copy snippet</Button>
            <p className="mt-4 text-xs text-muted">The chat only loads on the domains you allow. Visitors get a private session that can only see their own conversation. Messages are rate-limited per visitor.</p>
          </Panel>
          {can('widget:manage') && (
            <Panel title="Public key">
              <p className="break-all text-xs text-muted">{w.publicKey}</p>
              <Button className="mt-3" variant="secondary" size="sm" onClick={() => setConfirmRotate(true)}><KeyRound className="size-4" /> Create a new key</Button>
            </Panel>
          )}
        </div>
      </div>
      <Dialog open={confirmRotate} onClose={() => setConfirmRotate(false)} title="Create a new public key?" footer={<><Button variant="secondary" onClick={() => setConfirmRotate(false)}>Cancel</Button><Button variant="danger" loading={rotate.isPending} onClick={() => rotate.mutate()}>Create new key</Button></>}>
        <p className="text-sm">The chat stops working on your website until you replace the snippet. Do this if someone is misusing your widget.</p>
      </Dialog>
    </div>
  );
}
