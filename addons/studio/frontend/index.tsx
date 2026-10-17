import { useEffect, useRef, useState } from 'react';
import { api, ApiError, download, moduleUrl } from '../../../web/src/api';
import AIOptions, { type AIChoice } from '../../../web/src/ai/AIOptions';
import type { Brief, Creative, ModuleProps, Run, ResearchSource } from '../../../web/src/contracts';
import Research from './Research';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';

function CreativeEditor({
  creative,
  canWrite,
  workspaceId,
  onSave,
  sources = [],
}: {
  creative: Creative;
  canWrite: boolean;
  workspaceId: string;
  onSave: (creative: Creative) => void;
  sources?: ResearchSource[];
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
      {creative.provenance?.adaptation && (
        <details className="script-provenance">
          <summary>Research adaptation</summary>
          <p>{creative.provenance.adaptation}</p>
          {sources
            .filter((source) => creative.provenance?.source_page_ids.includes(source.page_id))
            .map((source) => (
              <p key={source.page_id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title} ↗
                </a>
              </p>
            ))}
          <p className="note">Original AI notes. Your edits are not automatically rechecked.</p>
          {creative.provenance.product_claims.map((claim, i) => (
            <p key={i}>
              “{claim.claim}” — confirmed fact: “{claim.fact_quote}”
            </p>
          ))}
        </details>
      )}
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
  const [engine, setEngine] = useState(
    selectedApp?.is_demo || previewMode ? 'demo_templates' : 'ai',
  );
  const [choice, setChoice] = useState<AIChoice>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [factsConfirmed, setFactsConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const generationRequest = useRef<{ body: string; endpoint: string } | null>(null);
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
    currentBase.current = base;
    setError('');
    setNotice('');
    setRuns([]);
    setRunId('');
    setBusy(false);
    setUncertain(false);
    generationRequest.current = null;
    setFactsConfirmed(false);
    setEngine(selectedApp?.is_demo || previewMode ? 'demo_templates' : 'ai');
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
      currentBase.current = '';
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
  async function saveBrief(value = brief) {
    return api<Brief>(base + 'brief/', {
      method: 'PUT',
      feedback: { success: 'Brief saved.' },
      body: JSON.stringify(value),
    });
  }
  function editBrief(value: Brief) {
    setBrief(value);
    setFactsConfirmed(false);
  }
  async function useResearch(researchId: string, pageIds: string[]) {
    setBusy(true);
    try {
      const saved = await saveBrief({ ...brief, research: researchId, research_page_ids: pageIds });
      if (currentBase.current !== base) return;
      setBrief(saved);
      setFactsConfirmed(false);
      setEngine('ai');
      setSection('scripts');
    } finally {
      if (currentBase.current === base) setBusy(false);
    }
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
      const saved = generationRequest.current ? brief : await saveBrief();
      if (currentBase.current !== base) return;
      setBrief(saved);
      if (generate) {
        if (!generationRequest.current) {
          const endpoint = base + (engine === 'ai' ? 'ai-runs/' : 'runs/');
          const body =
            engine === 'ai'
              ? {
                  request_id: crypto.randomUUID(),
                  snapshot_id: selectedApp?.metadata?.id,
                  research_id: saved.research,
                  page_ids: saved.research_page_ids,
                  brief: {
                    audience: saved.audience,
                    goal: saved.goal,
                    tone: saved.tone,
                    product_facts: saved.product_facts,
                    language: saved.language || 'English',
                    duration_seconds: saved.duration_seconds || 30,
                  },
                  facts_confirmed: factsConfirmed,
                  provider: choice?.provider,
                  model: choice?.model,
                }
              : { request_id: crypto.randomUUID() };
          generationRequest.current = { endpoint, body: JSON.stringify(body) };
        }
        const next = await api<Run>(generationRequest.current.endpoint, {
          method: 'POST',
          feedback: { success: 'Script generation started.' },
          body: generationRequest.current.body,
        });
        if (currentBase.current !== base) return;
        setRuns((old) => [next, ...old.filter((item) => item.id !== next.id)]);
        generationRequest.current = null;
        setUncertain(false);
        setRunId(next.id);
        setNotice('Brief saved.');
      } else setNotice('Brief saved.');
    } catch (err) {
      if (currentBase.current === base) {
        const unknown =
          !!generationRequest.current &&
          (!(err instanceof ApiError) || err.status === 0 || err.status >= 500);
        setUncertain(unknown);
        if (!unknown) generationRequest.current = null;
        setError((err as Error).message);
      }
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
            disabled={busy || pending || uncertain}
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
          onUseInBrief={useResearch}
          briefBusy={busy || loading || loadFailed || uncertain}
        />
      </div>
      <div hidden={section !== 'scripts'}>
        {engine === 'demo_templates' && (
          <p className="studio-disclosure">Demo templates · No AI calls.</p>
        )}
        {uncertain && (
          <p className="notice">
            The start could not be confirmed. Retry the same request or reload to check saved
            sessions.
          </p>
        )}
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
                <h3>Research selected</h3>
                {brief.research_sources?.length ? (
                  brief.research_sources.map((source) => (
                    <article className="brief-source" key={source.page_id}>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title} ↗
                      </a>
                      <p>{source.finding.structure}</p>
                    </article>
                  ))
                ) : (
                  <p className="note">Select observations in Research to prepare AI scripts.</p>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setSection('research')}
                >
                  Choose research
                </button>
              </div>
              <div className="brief-form">
                <label>
                  Audience
                  <textarea
                    name="audience"
                    rows={2}
                    maxLength={500}
                    value={brief.audience}
                    onChange={(e) => editBrief({ ...brief, audience: e.target.value })}
                    disabled={!canWrite || busy || uncertain}
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
                      onChange={(e) => editBrief({ ...brief, goal: e.target.value })}
                      disabled={!canWrite || busy || uncertain}
                    />
                  </label>
                  <label>
                    Tone
                    <input
                      name="tone"
                      required
                      maxLength={80}
                      value={brief.tone}
                      onChange={(e) => editBrief({ ...brief, tone: e.target.value })}
                      disabled={!canWrite || busy || uncertain}
                    />
                  </label>
                </div>
                {demoMode && (
                  <label>
                    Generation mode
                    <select
                      value={engine}
                      disabled={!canWrite || busy || pending || uncertain}
                      onChange={(e) => setEngine(e.target.value)}
                    >
                      <option value="ai">AI from research</option>
                      <option value="demo_templates">Demo templates · No AI</option>
                    </select>
                  </label>
                )}
                {engine === 'ai' && (
                  <>
                    <label>
                      Product facts
                      <textarea
                        rows={5}
                        maxLength={4000}
                        value={brief.product_facts || ''}
                        placeholder="Features and claims you can confirm about your app"
                        disabled={!canWrite || busy || uncertain}
                        onChange={(e) => editBrief({ ...brief, product_facts: e.target.value })}
                      />
                    </label>
                    {!brief.product_facts && selectedApp.metadata?.data.description && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={!canWrite || busy || uncertain}
                        onClick={() =>
                          editBrief({
                            ...brief,
                            product_facts: selectedApp.metadata!.data.description.slice(0, 4000),
                          })
                        }
                      >
                        Use imported description
                      </button>
                    )}
                    <div className="brief-fields">
                      <label>
                        Script language
                        <input
                          maxLength={40}
                          value={brief.language || 'English'}
                          disabled={!canWrite || busy || uncertain}
                          onChange={(e) => editBrief({ ...brief, language: e.target.value })}
                        />
                      </label>
                      <label>
                        Target duration
                        <select
                          value={brief.duration_seconds || 30}
                          disabled={!canWrite || busy || uncertain}
                          onChange={(e) =>
                            editBrief({ ...brief, duration_seconds: Number(e.target.value) })
                          }
                        >
                          {[15, 30, 45, 60].map((n) => (
                            <option key={n} value={n}>
                              {n} seconds
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <AIOptions
                      key={`${workspace.id}:${appId}`}
                      workspaceId={workspace.id}
                      owner={workspace.role === 'owner'}
                      disabled={!canWrite || busy || pending || uncertain}
                      emptyLabel="Choose a provider"
                      onChange={(next, loading) => {
                        setChoice(next);
                        setAiLoading(loading);
                      }}
                    />
                    <label className="research-select">
                      <input
                        type="checkbox"
                        checked={factsConfirmed}
                        disabled={!canWrite || busy || uncertain}
                        onChange={(e) => setFactsConfirmed(e.target.checked)}
                      />
                      I checked these product facts for this app.
                    </label>
                    <p className="note">
                      Two model calls: writing and review. Scripts need your approval before use.
                    </p>
                  </>
                )}
                <div className="brief-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void submit(true)}
                    disabled={
                      !canWrite ||
                      busy ||
                      pending ||
                      (engine === 'demo_templates'
                        ? !demoMode
                        : !selectedApp.metadata ||
                          !brief.research ||
                          !brief.research_page_ids?.length ||
                          (brief.product_facts || '').trim().length < 10 ||
                          !brief.audience.trim() ||
                          !brief.goal.trim() ||
                          !brief.tone.trim() ||
                          !(brief.language || '').trim() ||
                          !factsConfirmed ||
                          !choice?.model ||
                          aiLoading)
                    }
                  >
                    {busy || pending
                      ? 'Creating scripts…'
                      : uncertain
                        ? 'Retry same request'
                        : 'Create scripts'}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!canWrite || busy || uncertain}
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
              </div>
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
              {run?.context && (
                <details className="script-context">
                  <summary>
                    {run.context.ai.model} · {run.context.brief.language} ·{' '}
                    {run.context.brief.duration_seconds}s target
                  </summary>
                  <p>
                    Frozen brief: {run.context.brief.audience} · {run.context.brief.goal} ·{' '}
                    {run.context.brief.tone}
                  </p>
                  <h4>Product facts confirmed for this generation</h4>
                  <p className="pre-wrap">{run.context.brief.product_facts}</p>
                  {run.context.sources.map((source) => (
                    <p key={source.page_id}>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title} ↗
                      </a>
                      {' · '}
                      {new Date(source.captured_at).toLocaleDateString('en-US')}
                    </p>
                  ))}
                  {run.review?.calls?.map((call) => (
                    <p className="note" key={call.step}>
                      {call.step} · {call.model} · {call.usage.input_tokens ?? '—'} input tokens ·{' '}
                      {call.usage.output_tokens ?? '—'} output tokens
                    </p>
                  ))}
                  <p className="note">
                    Reused steps retain their original usage. Timed-out calls may still be billed.
                  </p>
                </details>
              )}
              {run?.review?.checks && (
                <details className="script-context" open={run.review.rejected || undefined}>
                  <summary>
                    {run.review.rejected ? 'Scripts withheld · Review issues' : 'Automated review'}
                  </summary>
                  {run.review.checks.map((check) => (
                    <p key={check.variant}>
                      Variant {check.variant}: {check.reason}
                    </p>
                  ))}
                  <p className="note">
                    This review does not replace checking the script against your app.
                  </p>
                </details>
              )}
              {run?.workflow_id && !previewMode && (
                <WorkflowPanel
                  key={run.workflow_id}
                  workspaceId={workspace.id}
                  workflowId={run.workflow_id}
                  canWrite={canWrite && !run.review?.rejected}
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
                      sources={run.context?.sources}
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
