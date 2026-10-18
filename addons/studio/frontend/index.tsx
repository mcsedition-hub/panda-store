import { t, getLocale, getLanguage } from '../../../web/src/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, download, moduleUrl } from '../../../web/src/api';
import AIOptions, { type AIChoice } from '../../../web/src/ai/AIOptions';
import type { Brief, Creative, ModuleProps, Run, ResearchSource } from '../../../web/src/contracts';
import Research from './Research';
import SocialResearch from './SocialResearch';
import Scenes from './Scenes';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';

function CreativeEditor({
  creative,
  canWrite,
  workspaceId,
  onSave,
  onPlan,
  sources = [],
}: {
  creative: Creative;
  canWrite: boolean;
  workspaceId: string;
  onSave: (creative: Creative) => void;
  onPlan: () => void;
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
          {draft.approved ? t('Approved') : dirty ? t('Unsaved changes') : t('Needs review')}
        </span>
      </div>
      <h3>{creative.angle}</h3>
      {creative.provenance?.content_format && (
        <p className="note">
          {t('Format: ')}
          {t(creative.provenance.content_format.replaceAll('_', ' '))}
        </p>
      )}
      {creative.provenance?.adaptation && (
        <details className="script-provenance">
          <summary>{t('Research adaptation')}</summary>
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
          <p className="note">
            {t('Original AI notes. Your edits are not automatically rechecked.')}
          </p>
          {creative.provenance.product_claims.map((claim, i) => (
            <p key={i}>
              “{claim.claim}
              {t('” — confirmed fact: “')}
              {claim.fact_quote}”
            </p>
          ))}
        </details>
      )}
      <label>
        {t('Hook ')}
        <textarea
          aria-label={t('Hook — {0}', creative.angle)}
          className="hook-input"
          rows={3}
          maxLength={500}
          value={draft.hook}
          onChange={(e) => update('hook', e.target.value)}
          disabled={!canWrite}
        />
      </label>
      <label>
        {t('Script ')}
        <textarea
          aria-label={t('Script — {0}', creative.angle)}
          rows={12}
          maxLength={6000}
          value={draft.script}
          onChange={(e) => update('script', e.target.value)}
          disabled={!canWrite}
        />
      </label>
      <label>
        {t('Call to action ')}
        <textarea
          aria-label={t('Call to action — {0}', creative.angle)}
          rows={2}
          maxLength={300}
          value={draft.cta}
          onChange={(e) => update('cta', e.target.value)}
          disabled={!canWrite}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      {saved && (
        <p className="saved" role="status">
          {t(saved)}
        </p>
      )}
      <div className="creative-actions">
        {!['carousel', 'image', 'text'].includes(creative.provenance?.content_format || '') && (
          <button className="button secondary" disabled={busy || dirty} onClick={onPlan}>
            {t('Plan scenes')}
          </button>
        )}
        <button
          className="button secondary"
          onClick={() => save()}
          disabled={!canWrite || busy || !dirty}
        >
          {busy ? t('Saving…') : t('Save')}
        </button>
        <button
          className="text-button"
          onClick={() => save(true)}
          disabled={!canWrite || busy || dirty || draft.approved}
        >
          {t('Approve script')}
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
  registerLeaveGuard,
}: ModuleProps) {
  const [section, setSection] = useState<'research' | 'scripts' | 'scenes'>('research');
  const [newResearchRequest, setNewResearchRequest] = useState(0);
  const [canOpenNewResearch, setCanOpenNewResearch] = useState(false);
  const [sceneCreativeId, setSceneCreativeId] = useState('');
  const scenesGuard = useRef<() => Promise<boolean>>(async () => true);
  const registerScenesGuard = useCallback(
    (guard: () => Promise<boolean>) => {
      scenesGuard.current = guard;
      const release = registerLeaveGuard?.(guard);
      return () => {
        scenesGuard.current = async () => true;
        release?.();
      };
    },
    [registerLeaveGuard],
  );
  async function openScenes(id: string) {
    if (!(await scenesGuard.current()) || currentBase.current !== base) return;
    setSceneCreativeId(id);
    setSection('scenes');
  }
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
  const [briefSource, setBriefSource] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canWrite = workspace.role !== 'viewer';
  const appId = selectedApp?.id;
  const base = moduleUrl(workspace.id, 'studio', `apps/${appId}/`);
  const run = runs.find((item) => item.id === runId) ?? runs[0];
  const project = selectedApp?.metadata?.data.project;
  const productDescription =
    project?.specification || selectedApp?.metadata?.data.description || '';
  const pending = runs.some((item) => ['queued', 'running', 'canceling'].includes(item.status));
  const currentBase = useRef(base);
  currentBase.current = base;

  useEffect(() => {
    currentBase.current = base;
    setError('');
    setNotice('');
    setRuns([]);
    setSceneCreativeId('');
    setRunId('');
    setBusy(false);
    setUncertain(false);
    generationRequest.current = null;
    setFactsConfirmed(false);
    setEngine(selectedApp?.is_demo || previewMode ? 'demo_templates' : 'ai');
    setLoadFailed(false);
    setBriefSource('');
    setBrief({ audience: '', goal: '', tone: '' });
    if (!appId) return;
    let active = true;
    setLoading(true);
    Promise.all([api<Brief>(base + 'brief/'), api<Run[]>(base + 'runs/')])
      .then(([nextBrief, nextRuns]) => {
        if (active) {
          setBrief(nextBrief);
          setBriefSource(base);
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
                    language: saved.language || (getLanguage() === 'fr' ? 'Français' : 'English'),
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
          <h1>{t('SMM')}</h1>
          <p>{t('Social Media Marketing')}</p>
        </div>
        <section className="catalog-empty">
          <img src="/modules/studio.webp" alt="" />
          <h2>{t('Choose an app to research')}</h2>
          <p>{t('Choose a project, an imported app or a demo app to explore SMM.')}</p>
          <button className="button primary" onClick={() => navigate('app_catalog')}>
            {t('Open My apps')}
          </button>
        </section>
      </>
    );
  return (
    <>
      <div className="page-heading heading-split">
        <div>
          <h1>{t('SMM')}</h1>
          <p>{t('Social Media Marketing')}</p>
        </div>
        <div className="smm-heading-actions">
          <label className="compact-label">
            {t('App ')}
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
          {canWrite && (
            <button
              type="button"
              className="button primary"
              disabled={
                !canOpenNewResearch || busy || pending || uncertain || loading || loadFailed
              }
              onClick={() => {
                setSection('research');
                setNewResearchRequest((value) => value + 1);
              }}
            >
              {t('New research')}
            </button>
          )}
        </div>
      </div>
      {project && (
        <p className="notice">
          {t(
            'Create launch-ready content from your app description. AI presents the documented features in the present tense, without inventing results or customer testimonials.',
          )}
        </p>
      )}
      <nav className="aso-tabs" aria-label={t('SMM sections')}>
        <button
          aria-current={section === 'research' ? 'page' : undefined}
          onClick={() => setSection('research')}
        >
          {t('Research')}
        </button>
        <button
          aria-current={section === 'scripts' ? 'page' : undefined}
          onClick={() => setSection('scripts')}
        >
          {t('Scripts')}
        </button>
        <button
          aria-current={section === 'scenes' ? 'page' : undefined}
          onClick={() => {
            setSection('scenes');
            if (!sceneCreativeId) setSceneCreativeId(run?.creatives[0]?.id ?? '');
          }}
        >
          {t('Scenes')}
        </button>
      </nav>
      <div hidden={section !== 'scenes'}>
        {section === 'scenes' || sceneCreativeId ? (
          <>
            {runs.some((item) => item.creatives.length) && (
              <label className="scene-script-picker">
                {t('Script ')}
                <select
                  value={sceneCreativeId}
                  onChange={(event) => openScenes(event.target.value)}
                >
                  <option value="" disabled>
                    {t('Choose a script')}
                  </option>
                  {runs
                    .filter((item) => item.creatives.length)
                    .map((item) => (
                      <optgroup
                        key={item.id}
                        label={new Date(item.created_at).toLocaleString(getLocale())}
                      >
                        {item.creatives.map((creative) => (
                          <option key={creative.id} value={creative.id}>
                            {creative.angle}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              </label>
            )}
            {sceneCreativeId ? (
              <Scenes
                key={`${workspace.id}:${appId}:${sceneCreativeId}`}
                workspace={workspace}
                selectedApp={selectedApp}
                creativeId={sceneCreativeId}
                currentScript={runs
                  .flatMap((item) => item.creatives)
                  .find((item) => item.id === sceneCreativeId)}
                active={section === 'scenes'}
                previewMode={previewMode}
                registerLeaveGuard={registerScenesGuard}
              />
            ) : (
              <section className="storyboard-empty">
                <h2>{t('No script selected')}</h2>
                <button className="button secondary" onClick={() => setSection('scripts')}>
                  {t('Open scripts')}
                </button>
              </section>
            )}
          </>
        ) : null}
      </div>
      <div hidden={section !== 'research'}>
        <SocialResearch
          key={`social:${workspace.id}:${selectedApp.id}`}
          workspace={workspace}
          app={selectedApp}
          initialBrief={briefSource === base ? brief : undefined}
          newResearchRequest={newResearchRequest}
          onNewResearchAvailabilityChange={setCanOpenNewResearch}
          onGenerated={(next) => {
            setRuns((old) => [next, ...old.filter((item) => item.id !== next.id)]);
            setRunId(next.id);
            setEngine('ai');
            setSection('scripts');
          }}
        />
        <details className="smm-legacy">
          <summary>{t('Public-page research (legacy)')}</summary>
          <p className="note">
            {t(
              'Earlier research reports remain available here. This path does not qualify social virality.',
            )}
          </p>
          <Research
            key={`${workspace.id}:${selectedApp.id}`}
            workspace={workspace}
            app={selectedApp}
            previewMode={previewMode}
            onUseInBrief={useResearch}
            briefBusy={busy || loading || loadFailed || uncertain}
          />
        </details>
      </div>
      <div hidden={section !== 'scripts'}>
        {engine === 'demo_templates' && (
          <p className="studio-disclosure">{t('Demo templates · No AI calls.')}</p>
        )}
        {uncertain && (
          <p className="notice">
            {t(
              'The start could not be confirmed. Retry the same request or reload to check saved sessions.',
            )}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        {loading ? (
          <p role="status">{t('Loading brief…')}</p>
        ) : loadFailed ? (
          <p>{t('We could not load the brief. Reopen this module to try again.')}</p>
        ) : (
          <>
            {run?.context?.mode === 'smm' ? (
              <section className="smm-script-context">
                <div className="smm-context-copy">
                  <h2>{t('App context used')}</h2>
                  {run.context.brief.audience && (
                    <p className="smm-context-audience">
                      <span className="note">{t('Target audience')}</span>
                      {run.context.brief.audience}
                    </p>
                  )}
                  {run.context.brief.product_facts && (
                    <>
                      <details className="smm-context-description" key={run.id}>
                        <summary>{t('Full app description')}</summary>
                        <div
                          className="pre-wrap"
                          tabIndex={0}
                          role="region"
                          aria-label={t('Full app description')}
                        >
                          {run.context.brief.product_facts}
                        </div>
                      </details>
                      <p className="smm-context-preview">
                        {run.context.brief.product_facts.split(/\n\s*\n/)[0]}
                      </p>
                    </>
                  )}
                </div>
                <div className="smm-context-references">
                  <h3>{t('Selected social references')}</h3>
                  <ol>
                    {run.context.sources.map((source, index) => (
                      <li key={source.page_id}>
                        <a href={source.url} target="_blank" rel="noreferrer" title={source.title}>
                          <span className="smm-reference-number" aria-hidden="true">
                            {index + 1}
                          </span>
                          <span>
                            <strong>{source.url.match(/\/(@[^/]+)\//)?.[1] || source.title}</strong>
                            <span className="note">{t('Reference for script {0}', index + 1)}</span>
                          </span>
                          <span aria-hidden="true">↗</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="smm-context-footer">
                  <p className="note">
                    {t(
                      'Each adaptation uses its corresponding reference and format. This session keeps the app facts and sources used when it was created.',
                    )}
                  </p>
                  <button className="button secondary" onClick={() => setSection('research')}>
                    {t('Back to social research')}
                  </button>
                </div>
              </section>
            ) : (
              <section className="brief-panel">
                <div className="brief-intro">
                  <h2>{t('Brief')}</h2>
                  <p>{selectedApp.metadata?.data.subtitle}</p>
                  <div className="feature-tags">
                    {selectedApp.metadata?.data.features?.map((feature) => (
                      <span key={feature}>{feature}</span>
                    ))}
                  </div>
                  <h3>{t('Research selected')}</h3>
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
                    <p className="note">
                      {t('Select observations in Research to prepare AI scripts.')}
                    </p>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSection('research')}
                  >
                    {t('Choose research')}
                  </button>
                </div>
                <div className="brief-form">
                  <label>
                    {t('Audience ')}
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
                      {t('Goal ')}
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
                      {t('Tone ')}
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
                      {t('Generation mode ')}
                      <select
                        value={engine}
                        disabled={!canWrite || busy || pending || uncertain}
                        onChange={(e) => setEngine(e.target.value)}
                      >
                        <option value="ai">{t('AI from research')}</option>
                        {!project && (
                          <option value="demo_templates">{t('Demo templates · No AI')}</option>
                        )}
                      </select>
                    </label>
                  )}
                  {engine === 'ai' && (
                    <>
                      <label>
                        {project ? t('Confirmed project scope ') : t('Product facts ')}
                        <textarea
                          rows={5}
                          maxLength={4000}
                          value={brief.product_facts || ''}
                          placeholder={t('Features and claims you can confirm about your app')}
                          disabled={!canWrite || busy || uncertain}
                          onChange={(e) => editBrief({ ...brief, product_facts: e.target.value })}
                        />
                      </label>
                      {!brief.product_facts && productDescription && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={!canWrite || busy || uncertain}
                          onClick={() =>
                            editBrief({
                              ...brief,
                              product_facts: productDescription.slice(0, 4000),
                            })
                          }
                        >
                          {project ? t('Use project description') : t('Use imported description')}
                        </button>
                      )}
                      <div className="brief-fields">
                        <label>
                          {t('Script language ')}
                          <input
                            maxLength={40}
                            value={
                              brief.language || (getLanguage() === 'fr' ? 'Français' : 'English')
                            }
                            disabled={!canWrite || busy || uncertain}
                            onChange={(e) => editBrief({ ...brief, language: e.target.value })}
                          />
                        </label>
                        <label>
                          {t('Target duration ')}
                          <select
                            value={brief.duration_seconds || 30}
                            disabled={!canWrite || busy || uncertain}
                            onChange={(e) =>
                              editBrief({ ...brief, duration_seconds: Number(e.target.value) })
                            }
                          >
                            {[15, 30, 45, 60].map((n) => (
                              <option key={n} value={n}>
                                {n}
                                {t(' seconds')}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <AIOptions
                        moduleContext="smm"
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
                        {project
                          ? t(
                              ' I checked this project scope, including which features are still planned.',
                            )
                          : t(' I checked these product facts for this app.')}
                      </label>
                      <p className="note">
                        {t(
                          'Two model calls: writing and review. Scripts need your approval before use.',
                        )}
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
                        ? t('Creating scripts…')
                        : uncertain
                          ? t('Retry same request')
                          : t('Create scripts')}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!canWrite || busy || uncertain}
                      onClick={() => submit(false)}
                    >
                      {t('Save brief')}
                    </button>
                  </div>
                  {notice && (
                    <p className="saved" role="status">
                      {t(notice)}
                    </p>
                  )}
                </div>
              </section>
            )}
            <section className="results">
              <div className="results-heading">
                <div>
                  <h2>{t('Scripts')}</h2>
                </div>
                <div className="results-tools">
                  {runs.length > 1 && (
                    <label>
                      {t('Session ')}
                      <select
                        aria-label={t('Creative session')}
                        value={run?.id}
                        onChange={(e) => setRunId(e.target.value)}
                      >
                        {runs.map((item) => (
                          <option key={item.id} value={item.id}>
                            {new Date(item.created_at).toLocaleString(getLocale(), {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              second: '2-digit',
                            })}{' '}
                            ·{' '}
                            {t(
                              item.status === 'succeeded'
                                ? t('Completed')
                                : item.status.charAt(0).toUpperCase() + item.status.slice(1),
                            )}
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
                      {t('Export scripts')}
                    </a>
                  )}
                </div>
              </div>
              {!run && (
                <div className="results-empty">
                  <p>{t('No scripts yet.')}</p>
                </div>
              )}
              {run?.context && (
                <details className="script-context">
                  <summary>
                    {run.context.ai.model} · {run.context.brief.language} ·{' '}
                    {run.context.brief.duration_seconds}
                    {t('s target')}
                  </summary>
                  <p>
                    {t('Frozen brief: ')}
                    {run.context.brief.audience} · {run.context.brief.goal} ·{' '}
                    {run.context.brief.tone}
                  </p>
                  {run.context.app_context && (
                    <>
                      <p className="note">
                        {t(
                          'Project stage when generated: {0}',
                          run.context.app_context.stage === 'idea'
                            ? t('Idea')
                            : t('In development'),
                        )}
                      </p>
                      <details>
                        <summary>{t('Saved project description')}</summary>
                        <p className="pre-wrap">{run.context.app_context.specification}</p>
                        {run.context.app_context.available_features && (
                          <p className="pre-wrap">
                            {t('Features already implemented')}:{' '}
                            {run.context.app_context.available_features}
                          </p>
                        )}
                      </details>
                    </>
                  )}
                  <h4>{t('Product facts confirmed for this generation')}</h4>
                  <p className="pre-wrap">{run.context.brief.product_facts}</p>
                  {run.context.sources.map((source) => (
                    <p key={source.page_id}>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title} ↗
                      </a>
                      {' · '}
                      {new Date(source.captured_at).toLocaleDateString(getLocale())}
                    </p>
                  ))}
                  {run.review?.calls?.map((call) => (
                    <p className="note" key={call.step}>
                      {t(call.step)} · {call.model} · {call.usage.input_tokens ?? '—'}
                      {t(' input tokens ·')} {call.usage.output_tokens ?? '—'}
                      {t(' output tokens')}
                    </p>
                  ))}
                  <p className="note">
                    {t(
                      'Reused steps retain their original usage. Timed-out calls may still be billed.',
                    )}
                  </p>
                </details>
              )}
              {run?.review?.checks && (
                <details className="script-context" open={run.review.rejected || undefined}>
                  <summary>
                    {run.review.rejected
                      ? t('Scripts withheld · Review issues')
                      : t('Automated review')}
                  </summary>
                  {run.review.checks.map((check) => (
                    <p key={check.variant}>
                      {t('Variant ')}
                      {check.variant}: {check.reason}
                    </p>
                  ))}
                  {run.review.corrections?.map((correction) => (
                    <p className="note" key={correction.at}>
                      {new Date(correction.at).toLocaleString(getLocale())} · {correction.reason}
                    </p>
                  ))}
                  <p className="note">
                    {t(
                      'The automated review describes the generated version. Edited drafts still need review against your app.',
                    )}
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
                  {t('Creating scripts…')}
                </p>
              )}
              {run?.status === 'failed' && !run.workflow_id && (
                <p className="error" role="alert">
                  {t(run.error)}
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
                      onPlan={() => openScenes(creative.id)}
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
