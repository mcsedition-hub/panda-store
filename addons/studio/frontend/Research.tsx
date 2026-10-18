import { t, getLocale } from '../../../web/src/i18n';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, moduleUrl } from '../../../web/src/api';
import AIOptions, { type AIChoice } from '../../../web/src/ai/AIOptions';
import type { MobileApp, Workspace } from '../../../web/src/contracts';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';
import type { WorkflowStatus } from '../../../web/src/workflows/types';

type Source = { url: string; title: string; kind: string; domain: string };
type Page = {
  id: string;
  source: Source;
  title: string;
  final_url: string;
  status: string;
  reason: string;
  text: string;
  captured_at: string;
  images: Record<string, string>;
  trace: { action: string; at: string; y?: number; frame?: string }[];
};
type Finding = {
  page_id: string;
  content_type: string;
  observation: string;
  hook_quote: string;
  structure: string;
  idea_to_test: string;
  evidence_quotes: string[];
  metrics: { label: string; quote: string }[];
};
type Discovery = {
  queries: string[];
  sources: Source[];
  warnings: string[];
  search_widget: string;
};
export type ResearchRun = {
  id: string;
  workflow_id: string;
  status: WorkflowStatus;
  error: string;
  topic: string;
  market: string;
  snapshot_id: string;
  created_at: string;
  ai: { provider: string; model: string };
  pages?: Page[];
  discovery?: Discovery | null;
  report?: {
    findings: Finding[];
    withheld: { page_id: string; reason: string }[];
    coverage: {
      observed: number;
      attempted: number;
      references_observed: number;
      references_expected: number;
    };
    calls: { step: string; resolved_model: string | null; usage: Record<string, number | null> }[];
  } | null;
};
const activeStatus = (status: string) => ['queued', 'running', 'canceling'].includes(status);
const stamp = (date: string) =>
  new Date(date).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });

function SourceCard({
  page,
  finding,
  withheld,
  selection,
}: {
  page: Page;
  finding?: Finding;
  withheld?: string;
  selection?: { checked: boolean; disabled: boolean; toggle: () => void };
}) {
  const [frame, setFrame] = useState('top');
  return (
    <article className="research-source">
      <div className="research-source-heading">
        <div>
          <span className="note">
            {page.source.kind === 'reference'
              ? t('Cross-domain reference · {0}', page.source.domain)
              : t('Discovered source')}
          </span>
          <h3>
            <a href={page.final_url || page.source.url} target="_blank" rel="noreferrer">
              {page.title || page.source.title} ↗
            </a>
          </h3>
          <span className="note">{stamp(page.captured_at)}</span>
        </div>
        <span className="status-pill">
          {page.status === 'observed' ? t('Page captured') : t('Unavailable')}
        </span>
      </div>
      <div className="research-source-body">
        {page.images.top && (
          <div className="research-still">
            <a href={page.images[frame]} target="_blank" rel="noreferrer">
              <img
                loading="lazy"
                src={page.images[frame]}
                alt={t(
                  '{0} · {1}',
                  page.source.title,
                  frame === 'top' ? t('First view') : t('After scrolling'),
                )}
              />
            </a>
            <div className="research-frame-controls">
              <button
                className="text-button"
                aria-pressed={frame === 'top'}
                onClick={() => setFrame('top')}
              >
                {t('First view')}
              </button>
              {page.images.scroll && (
                <button
                  className="text-button"
                  aria-pressed={frame === 'scroll'}
                  onClick={() => setFrame('scroll')}
                >
                  {t('After scrolling')}
                </button>
              )}
            </div>
          </div>
        )}
        <div>
          {finding ? (
            <>
              {selection && (
                <label className="research-select">
                  <input
                    type="checkbox"
                    checked={selection.checked}
                    disabled={selection.disabled}
                    onChange={selection.toggle}
                  />
                  {t(' Select for brief')}
                </label>
              )}
              <span className="note">
                {t(finding.content_type.replaceAll('_', ' '))}
                {t(' · AI observation · Review before use')}
              </span>
              <p>{finding.observation}</p>
              {finding.hook_quote && (
                <>
                  <h4>{t('Visible opening')}</h4>
                  <blockquote>{finding.hook_quote}</blockquote>
                </>
              )}
              <h4>{t('Structure')}</h4>
              <p>{finding.structure}</p>
              <h4>{t('Idea to test')}</h4>
              <p>{finding.idea_to_test}</p>
              {finding.metrics.length ? (
                <>
                  <h4>{t('Visible metrics')}</h4>
                  <ul>
                    {finding.metrics.map((metric, i) => (
                      <li key={i}>
                        {metric.label}: “{metric.quote}”
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="note">{t('No performance metrics retained.')}</p>
              )}
              <details>
                <summary>{t('Quoted evidence')}</summary>
                {finding.evidence_quotes.map((quote, i) => (
                  <blockquote key={i}>{quote}</blockquote>
                ))}
              </details>
            </>
          ) : (
            <p>
              {withheld
                ? t('Observation withheld: {0}', t(withheld))
                : page.status === 'observed'
                  ? t('No observation retained.')
                  : t(page.reason)}
            </p>
          )}
          <details>
            <summary>{t('Visit details')}</summary>
            <p className="note">{t(page.reason)}</p>
            <a href={page.source.url} target="_blank" rel="noreferrer">
              {t('Original source ↗')}
            </a>
            <ul>
              {page.trace.map((event, i) => (
                <li key={i}>
                  {t(event.action)}
                  {event.frame ? ` · ${event.frame}` : ''}
                  {event.y !== undefined ? t(' · {0}px', event.y) : ''} · {stamp(event.at)}
                </li>
              ))}
            </ul>
            <details>
              <summary>{t('Saved page text')}</summary>
              <p className="research-page-text">{page.text || t('No readable text saved.')}</p>
            </details>
          </details>
        </div>
      </div>
    </article>
  );
}

export default function Research({
  workspace,
  app,
  previewMode,
  onUseInBrief,
  briefBusy,
}: {
  workspace: Workspace;
  app: MobileApp;
  previewMode?: boolean;
  onUseInBrief?: (researchId: string, pageIds: string[]) => Promise<void>;
  briefBusy?: boolean;
}) {
  const [topic, setTopic] = useState('');
  const [market, setMarket] = useState(app.metadata?.data.locale || 'en-US');
  const [choice, setChoice] = useState<AIChoice>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ResearchRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [selection, setSelection] = useState<{ runId: string; pages: string[] }>({
    runId: '',
    pages: [],
  });
  const [usingBrief, setUsingBrief] = useState(false);
  const alive = useRef(true);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const base = moduleUrl(workspace.id, 'studio');
  const listUrl = `${base}apps/${app.id}/research/`;
  const selected = runs.find((r) => r.id === selectedId) || runs[0];
  const run = detail?.id === selected?.id ? detail : selected;
  const pending = runs.some((r) => activeStatus(r.status));
  const canWrite = workspace.role !== 'viewer' && !previewMode;
  const selectedPages = selection.runId === run?.id ? selection.pages : [];

  async function useInBrief() {
    if (!run || !onUseInBrief) return;
    setUsingBrief(true);
    setError('');
    try {
      await onUseInBrief(run.id, selectedPages);
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setUsingBrief(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    Promise.all([
      api<ResearchRun[]>(listUrl, { signal: abort.signal }),
      api<{ browser_installed: boolean }>(base + 'research-capabilities/', {
        signal: abort.signal,
      }),
    ])
      .then(([next, caps]) => {
        if (alive.current) {
          setRuns(next);
          setInstalled(caps.browser_installed);
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, [listUrl, base]);

  useEffect(() => {
    if (!pending) return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      api<ResearchRun[]>(listUrl, { signal: abort.signal })
        .then((next) => {
          if (!abort.signal.aborted) setRuns(next);
        })
        .catch(() => {});
    }, 3000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [pending, listUrl]);

  useEffect(() => {
    if (!selected?.id) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await api<ResearchRun>(`${base}research/${selected!.id}/`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        setDetail(next);
        setRuns((old) => old.map((r) => (r.id === next.id ? { ...r, status: next.status } : r)));
        if (activeStatus(next.status)) timer = setTimeout(refresh, 2500);
      } catch (err) {
        if (abort.signal.aborted) return;
        setError((err as Error).message);
        if (!(err instanceof ApiError && [401, 403, 404].includes(err.status)))
          timer = setTimeout(refresh, 5000);
        else setDetail(null);
      }
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [selected?.id, base]);

  async function start() {
    if (!canWrite || busy || !choice?.model || !app.metadata) return;
    const values =
      uncertain && request.current
        ? JSON.parse(request.current.signature)
        : { snapshot_id: app.metadata.id, topic, market, ...choice };
    const signature = JSON.stringify(values);
    if (request.current?.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const next = await api<ResearchRun>(listUrl, {
        method: 'POST',
        feedback: { success: 'Research started.' },
        body: JSON.stringify({ ...values, request_id: request.current.id }),
      });
      if (!alive.current) return;
      request.current = null;
      setUncertain(false);
      setRuns((old) => [next, ...old.filter((r) => r.id !== next.id)]);
      setSelectedId(next.id);
      setDetail(null);
    } catch (err) {
      if (alive.current) {
        setError((err as Error).message);
        setUncertain(!(err instanceof ApiError) || err.status === 0 || err.status >= 500);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function retry() {
    if (!run || busy) return;
    setBusy(true);
    try {
      const next = await api<ResearchRun>(`${base}research/${run.id}/retry/`, {
        method: 'POST',
        feedback: { success: 'Research retry started.' },
        body: JSON.stringify({ request_id: crypto.randomUUID() }),
      });
      if (!alive.current) return;
      setRuns((old) => [next, ...old.filter((r) => r.id !== next.id)]);
      setSelectedId(next.id);
      setDetail(null);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <section className="research-workspace" aria-label={t('Creative research')}>
      <div className="research-setup">
        <h2>{t('Find examples before creating')}</h2>
        <div className="research-inputs">
          <label>
            {t('Research topic ')}
            <textarea
              rows={2}
              maxLength={500}
              value={topic}
              disabled={!canWrite || busy || uncertain}
              placeholder={t('Competitors, audience, or a use case to explore')}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
          <label>
            {t('Language and market ')}
            <input
              maxLength={100}
              value={market}
              disabled={!canWrite || busy || uncertain}
              onChange={(e) => setMarket(e.target.value)}
            />
          </label>
        </div>
        {!previewMode && (
          <AIOptions
            moduleContext="smm"
            capability="web_search"
            workspaceId={workspace.id}
            owner={workspace.role === 'owner'}
            disabled={!canWrite || busy || pending || uncertain}
            emptyLabel="Choose a provider"
            onChange={(next, isLoading) => {
              setChoice(next);
              setAiLoading(isLoading);
            }}
          />
        )}
        <div className="research-start">
          <button
            className="button primary"
            disabled={
              !canWrite ||
              loading ||
              busy ||
              pending ||
              !installed ||
              aiLoading ||
              !choice?.model ||
              topic.trim().length < 5 ||
              !market.trim() ||
              !app.metadata
            }
            onClick={() => void start()}
          >
            {busy ? t('Starting…') : t('Start research')}
          </button>
          <span className="note">
            {t(
              'Up to 6 discovered pages + 3 cross-domain references. Up to 3 model calls, plus provider search fees.',
            )}
          </span>
        </div>
        <p className="note">
          {t(
            'Public pages and stills. Video and audio are not reviewed. Views do not establish downloads.',
          )}
        </p>
        {uncertain && (
          <p className="notice">
            {t(
              'The start could not be confirmed. Retry with the same settings to recover this request, or reload to check saved sessions.',
            )}
          </p>
        )}
        {!loading && !installed && !previewMode && (
          <p className="notice">
            {t('The research browser is not installed on this server. See the')}{' '}
            <a
              href="https://github.com/mcsedition-hub/panda-store#creative-research"
              target="_blank"
              rel="noreferrer"
            >
              {t('setup instructions ↗')}
            </a>
            .
          </p>
        )}
        {previewMode && (
          <p className="note">{t('Live research is unavailable in the visual preview.')}</p>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      {loading && <p role="status">{t('Loading research…')}</p>}
      {selected && (
        <>
          <div className="results-heading">
            <h2>{t('Research')}</h2>
            <label className="compact-label">
              {t('Session ')}
              <select
                value={selected.id}
                disabled={busy}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setDetail(null);
                }}
              >
                {runs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {stamp(item.created_at)} · {t(item.status)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>
            {run?.topic}{' '}
            <span className="note">
              · {run?.market} · {run?.ai.model}
            </span>
          </p>
          <WorkflowPanel
            key={selected.workflow_id}
            workspaceId={workspace.id}
            workflowId={selected.workflow_id}
            canWrite={canWrite}
            onRetry={retry}
            onStatus={() => {}}
          />
          {run?.discovery && (
            <details className="research-discovery">
              <summary>{t('Search trail')}</summary>
              <ul>
                {run.discovery.queries.map((query, i) => (
                  <li key={i}>{query}</li>
                ))}
              </ul>
              <p className="note">
                {t('Discovered links are candidates. Findings below use saved browser evidence.')}
              </p>
              <ul>
                {run.discovery.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title} ↗
                    </a>
                  </li>
                ))}
              </ul>
              {run.discovery.warnings.map((warning, i) => (
                <p className="note" key={i}>
                  {t(warning)}
                </p>
              ))}
              {run.discovery.search_widget && (
                <iframe
                  title={t('Google Search suggestions')}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'">${run.discovery.search_widget}`}
                />
              )}
            </details>
          )}
          {run?.report && (
            <div className="research-coverage">
              <strong>
                {run.report.coverage.observed} / {run.report.coverage.attempted}
                {t(' pages captured')}
              </strong>
              <span>
                {run.report.coverage.references_observed}
                {t(' / 3 cross-domain references')}
              </span>
              <span>
                {run.report.findings.length}
                {t(' findings retained')}
              </span>
              {!!run.report.withheld.length && (
                <span>
                  {run.report.withheld.length}
                  {t(' withheld')}
                </span>
              )}
              {run.status === 'succeeded' &&
                run.report.coverage.observed < run.report.coverage.attempted &&
                canWrite && (
                  <button
                    className="button secondary"
                    disabled={busy || pending}
                    onClick={() => void retry().catch((err) => setError(err.message))}
                  >
                    {t('Retry unavailable sources')}
                  </button>
                )}
            </div>
          )}
          {!!run?.pages?.length && (
            <>
              {canWrite &&
                onUseInBrief &&
                run.status === 'succeeded' &&
                !!run.report?.findings.length && (
                  <div className="research-start">
                    <button
                      className="button primary"
                      disabled={!selectedPages.length || usingBrief || briefBusy}
                      onClick={() => void useInBrief()}
                    >
                      {usingBrief
                        ? t('Saving selection…')
                        : t(
                            'Use {0} {1} in brief',
                            selectedPages.length || '',
                            selectedPages.length === 1 ? t('observation') : t('observations'),
                          )}
                    </button>
                    <span className="note">{t('Select up to three observations below.')}</span>
                  </div>
                )}
              <p className="note">
                {t(
                  "Source claims are not independently verified. Confirm your app's features before using an idea.",
                )}
              </p>
              <label className="compact-label research-filter">
                {t('Sources ')}
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="all">{t('All sources')}</option>
                  <option value="discovered">{t('Niche research')}</option>
                  <option value="reference">{t('Cross-domain references')}</option>
                </select>
              </label>
              <div className="research-sources">
                {run.pages
                  .filter((page) => filter === 'all' || page.source.kind === filter)
                  .map((page) => (
                    <SourceCard
                      key={page.id}
                      page={page}
                      finding={run.report?.findings.find((f) => f.page_id === page.id)}
                      withheld={run.report?.withheld.find((f) => f.page_id === page.id)?.reason}
                      selection={
                        canWrite && onUseInBrief && run.status === 'succeeded'
                          ? {
                              checked: selectedPages.includes(page.id),
                              disabled:
                                usingBrief ||
                                !!briefBusy ||
                                (!selectedPages.includes(page.id) && selectedPages.length >= 3),
                              toggle: () =>
                                setSelection((old) => {
                                  const pages = old.runId === run.id ? old.pages : [];
                                  return {
                                    runId: run.id,
                                    pages: pages.includes(page.id)
                                      ? pages.filter((id) => id !== page.id)
                                      : [...pages, page.id],
                                  };
                                }),
                            }
                          : undefined
                      }
                    />
                  ))}
              </div>
            </>
          )}
          {run?.report && (
            <details className="research-discovery">
              <summary>{t('Model usage')}</summary>
              {run.report.calls.map((call) => (
                <p key={call.step}>
                  {t(call.step)} · {call.resolved_model || t('No model call')} ·{' '}
                  {call.usage?.input_tokens ?? '—'}
                  {t(' input tokens ·')} {call.usage?.output_tokens ?? '—'}
                  {t(' output tokens')}
                </p>
              ))}
              <p className="note">
                {t(
                  'Provider search fees are separate. Retried or timed-out requests may also be billed.',
                )}
              </p>
            </details>
          )}
        </>
      )}
      {!loading && !selected && <p className="results-empty">{t('No research yet.')}</p>}
    </section>
  );
}
