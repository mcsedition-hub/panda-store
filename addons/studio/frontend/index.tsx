import { useEffect, useRef, useState } from 'react';
import { api, download, moduleUrl } from '../../../web/src/api';
import type { Brief, Creative, ModuleProps, Run } from '../../../web/src/contracts';
import Research from './Research';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';

function CreativeEditor({
  creative,
  canWrite,
  workspaceId,
  onSave,
}: {
  creative: Creative;
  canWrite: boolean;
  workspaceId: string;
  onSave: (creative: Creative) => void;
}) {
  const [draft, setDraft] = useState(creative);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const dirty =
    draft.hook !== creative.hook || draft.script !== creative.script || draft.cta !== creative.cta;
  function update(key: 'hook' | 'script' | 'cta', value: string) {
    setDraft((old) => ({ ...old, [key]: value, approved: false }));
    setSaved('');
  }
  async function save(approve = false) {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const next = await api<Creative>(
        moduleUrl(workspaceId, 'studio', `creatives/${creative.id}/`),
        {
          method: 'PATCH',
          feedback: { success: approve ? 'Script approved.' : 'Script saved.' },
          body: JSON.stringify(
            approve
              ? { approved: true }
              : { hook: draft.hook, script: draft.script, cta: draft.cta },
          ),
        },
      );
      setDraft(next);
      onSave(next);
      setSaved(approve ? 'Script approved.' : 'Changes saved.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="creative-card">
      <div className="creative-top">
        <span className={`pill ${draft.approved ? 'approved' : ''}`}>
          {draft.approved ? 'Approved' : dirty ? 'Unsaved changes' : 'Needs review'}
        </span>
      </div>
      <h3>{creative.angle}</h3>
      <label>
        Hook
        <textarea
          aria-label={`Hook — ${creative.angle}`}
          className="hook-input"
          rows={3}
          maxLength={500}
          value={draft.hook}
          onChange={(e) => update('hook', e.target.value)}
          disabled={!canWrite}
        />
      </label>
      <label>
        Script
        <textarea
          aria-label={`Script — ${creative.angle}`}
          rows={12}
          maxLength={6000}
          value={draft.script}
          onChange={(e) => update('script', e.target.value)}
          disabled={!canWrite}
        />
      </label>
      <label>
        Call to action
        <textarea
          aria-label={`Call to action — ${creative.angle}`}
          rows={2}
          maxLength={300}
          value={draft.cta}
          onChange={(e) => update('cta', e.target.value)}
          disabled={!canWrite}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="saved" role="status">
          {saved}
        </p>
      )}
      <div className="creative-actions">
        <button
          className="button secondary"
          onClick={() => save()}
          disabled={!canWrite || busy || !dirty}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          className="text-button"
          onClick={() => save(true)}
          disabled={!canWrite || busy || dirty || draft.approved}
        >
          Approve script
        </button>
      </div>
    </article>
  );
}

export default function Studio({
  workspace,
  apps,
  selectedApp,
  selectApp,
  navigate,
  demoMode,
  previewMode,
}: ModuleProps) {
  const [section, setSection] = useState<'research' | 'scripts'>('research');
  const [brief, setBrief] = useState<Brief>({
    audience: '',
    goal: '',
    tone: '',
  });
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canWrite = workspace.role !== 'viewer';
  const appId = selectedApp?.id;
  const base = moduleUrl(workspace.id, 'studio', `apps/${appId}/`);
  const run = runs.find((item) => item.id === runId) ?? runs[0];
  const pending = runs.some((item) => ['queued', 'running', 'canceling'].includes(item.status));
  const currentBase = useRef(base);
  currentBase.current = base;

  useEffect(() => {
    setError('');
    setNotice('');
    setRuns([]);
    setRunId('');
    setBusy(false);
    setLoadFailed(false);
    setBrief({ audience: '', goal: '', tone: '' });
    if (!appId) return;
    let active = true;
    setLoading(true);
    Promise.all([api<Brief>(base + 'brief/'), api<Run[]>(base + 'runs/')])
      .then(([nextBrief, nextRuns]) => {
        if (active) {
          setBrief(nextBrief);
          setRuns(nextRuns);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoadFailed(true);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [appId, base]);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await api<Run[]>(base + 'runs/');
        if (active) {
          setRuns(data);
          timer = setTimeout(poll, 1500);
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pending, base]);
  async function saveBrief() {
    return api<Brief>(base + 'brief/', {
      method: 'PUT',
      feedback: { success: 'Brief saved.' },
      body: JSON.stringify(brief),
    });
  }
  async function retry() {
    if (!run) return;
    const next = await api<Run>(moduleUrl(workspace.id, 'studio', `runs/${run.id}/retry/`), {
      method: 'POST',
      feedback: { success: 'Generation retry started.' },
      body: JSON.stringify({ request_id: crypto.randomUUID() }),
    });
    if (currentBase.current !== base) return;
    setRuns((old) => [next, ...old.filter((item) => item.id !== next.id)]);
    setRunId(next.id);
  }
  async function submit(generate: boolean) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await saveBrief();
      if (currentBase.current !== base) return;
      if (generate) {
        const next = await api<Run>(base + 'runs/', {
          method: 'POST',
          feedback: { success: 'Script generation started.' },
          body: JSON.stringify({ request_id: crypto.randomUUID() }),
        });
        if (currentBase.current !== base) return;
        setRuns((old) => [next, ...old]);
        setRunId(next.id);
        setNotice('Brief saved.');
      } else setNotice('Brief saved.');
    } catch (err) {
      if (currentBase.current === base) setError((err as Error).message);
    } finally {
      if (currentBase.current === base) setBusy(false);
    }
  }
  if (!selectedApp)
    return (
      <>
        <div className="page-heading">
          <h1>Studio</h1>
        </div>
        <section className="catalog-empty">
          <img src="/modules/studio.webp" alt="" />
          <h2>No app selected</h2>
          <button className="button primary" onClick={() => navigate('apple_store')}>
            Import an app
          </button>
        </section>
      </>
    );
  return (
    <>
      <div className="page-heading heading-split">
        <div>
          <h1>Studio</h1>
        </div>
        <label className="compact-label">
          App
          <select
            value={selectedApp.id}
            disabled={busy || pending}
            onChange={(e) => {
              const app = apps.find((a) => a.id === e.target.value);
              if (app) selectApp(app);
            }}
          >
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <nav className="aso-tabs" aria-label="Studio sections">
        <button
          aria-current={section === 'research' ? 'page' : undefined}
          onClick={() => setSection('research')}
        >
          Research
        </button>
        <button
          aria-current={section === 'scripts' ? 'page' : undefined}
          onClick={() => setSection('scripts')}
        >
          Scripts
        </button>
      </nav>
      <div hidden={section !== 'research'}>
        <Research
          key={`${workspace.id}:${selectedApp.id}`}
          workspace={workspace}
          app={selectedApp}
          previewMode={previewMode}
        />
      </div>
      <div hidden={section !== 'scripts'}>
        <div className="studio-disclosure">
          <span className="signal-dot" />
          <p>These demo scripts use templates. AI creation from your research is the next step.</p>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading brief…</p>
        ) : loadFailed ? (
          <p>We could not load the brief. Reopen this module to try again.</p>
        ) : (
          <>
            <section className="brief-panel">
              <div className="brief-intro">
                <h2>Brief</h2>
                <p>{selectedApp.metadata?.data.subtitle}</p>
                <div className="feature-tags">
                  {selectedApp.metadata?.data.features.map((feature) => (
                    <span key={feature}>{feature}</span>
                  ))}
                </div>
              </div>
              <form
                className="brief-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit(true);
                }}
              >
                <label>
                  Audience
                  <textarea
                    name="audience"
                    rows={2}
                    maxLength={500}
                    value={brief.audience}
                    onChange={(e) => setBrief({ ...brief, audience: e.target.value })}
                    disabled={!canWrite || busy}
                  />
                </label>
                <div className="brief-fields">
                  <label>
                    Goal
                    <input
                      name="goal"
                      required
                      maxLength={500}
                      value={brief.goal}
                      onChange={(e) => setBrief({ ...brief, goal: e.target.value })}
                      disabled={!canWrite || busy}
                    />
                  </label>
                  <label>
                    Tone
                    <input
                      name="tone"
                      required
                      maxLength={80}
                      value={brief.tone}
                      onChange={(e) => setBrief({ ...brief, tone: e.target.value })}
                      disabled={!canWrite || busy}
                    />
                  </label>
                </div>
                <div className="brief-actions">
                  <button
                    type="submit"
                    className="button primary"
                    disabled={!canWrite || busy || pending || !demoMode}
                  >
                    {busy || pending ? 'Creating scripts…' : 'Create scripts'}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!canWrite || busy}
                    onClick={() => submit(false)}
                  >
                    Save brief
                  </button>
                </div>
                {notice && (
                  <p className="saved" role="status">
                    {notice}
                  </p>
                )}
              </form>
            </section>
            <section className="results">
              <div className="results-heading">
                <div>
                  <h2>Scripts</h2>
                </div>
                <div className="results-tools">
                  {runs.length > 1 && (
                    <label>
                      Session
                      <select
                        aria-label="Creative session"
                        value={run?.id}
                        onChange={(e) => setRunId(e.target.value)}
                      >
                        {runs.map((item) => (
                          <option key={item.id} value={item.id}>
                            {new Date(item.created_at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              second: '2-digit',
                            })}{' '}
                            ·{' '}
                            {item.status === 'succeeded'
                              ? 'Completed'
                              : item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {run?.status === 'succeeded' && !previewMode && (
                    <a
                      className="button secondary"
                      href={moduleUrl(workspace.id, 'studio', `runs/${run.id}/export/`)}
                      onClick={(event) => {
                        event.preventDefault();
                        void download(
                          moduleUrl(workspace.id, 'studio', `runs/${run.id}/export/`),
                          `panda-scripts-${run.id}.md`,
                        ).catch((err) => setError(err.message));
                      }}
                    >
                      Export scripts
                    </a>
                  )}
                </div>
              </div>
              {!run && (
                <div className="results-empty">
                  <p>No scripts yet.</p>
                </div>
              )}
              {run?.workflow_id && !previewMode && (
                <WorkflowPanel
                  key={run.workflow_id}
                  workspaceId={workspace.id}
                  workflowId={run.workflow_id}
                  canWrite={canWrite}
                  onRetry={retry}
                  onStatus={(status) => {
                    setRuns((old) =>
                      old.map((item) => (item.id === run.id ? { ...item, status } : item)),
                    );
                    if (['succeeded', 'failed', 'canceled'].includes(status)) {
                      api<Run[]>(base + 'runs/')
                        .then((next) => {
                          if (currentBase.current === base) setRuns(next);
                        })
                        .catch((err) => {
                          if (currentBase.current === base) setError(err.message);
                        });
                    }
                  }}
                />
              )}
              {pending && !run?.workflow_id && (
                <p className="notice" role="status">
                  Creating scripts…
                </p>
              )}
              {run?.status === 'failed' && !run.workflow_id && (
                <p className="error" role="alert">
                  {run.error}
                </p>
              )}
              {run?.status === 'succeeded' && (
                <div className="creative-grid">
                  {run.creatives.map((creative) => (
                    <CreativeEditor
                      key={creative.id}
                      creative={creative}
                      canWrite={canWrite}
                      workspaceId={workspace.id}
                      onSave={(next) =>
                        setRuns((old) =>
                          old.map((item) =>
                            item.id === run.id
                              ? {
                                  ...item,
                                  creatives: item.creatives.map((c) =>
                                    c.id === next.id ? next : c,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
