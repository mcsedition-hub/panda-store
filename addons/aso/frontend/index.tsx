import { useCallback, useEffect, useRef, useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';
import type { WorkflowStatus } from '../../../web/src/workflows/types';
import AIOptions, { type AIChoice } from '../../../web/src/ai/AIOptions';
import Drafts from './Drafts';
import type { DraftSeed } from './draftTypes';
import { modelSuggestions } from './modelSuggestions';
import { notify } from '../../../web/src/notifications/store';
import Sources, { fieldNames, SourceReference, type Guidance, type Source } from './Sources';
import Screenshots, { type VisualReport } from './Screenshots';

type CheckStatus = 'issue' | 'recommendation' | 'review' | 'unavailable' | 'passed';
interface Check {
  id: string;
  field: string;
  title: string;
  status: CheckStatus;
  basis: string;
  observation: string;
  action: string;
  observed?: string | null;
  replacement?: string | null;
  evidence?: { field: string; quote: string }[];
  sources: Source[];
}
interface Assessment {
  field: string;
  verdict: 'keep' | 'improve' | 'insufficient_evidence' | 'not_imported' | 'unvalidated';
  observation: string;
  observed: string | null;
  evidence: NonNullable<Check['evidence']>;
  sources: Check['sources'];
}
const verdictLabels = {
  keep: 'No change suggested',
  improve: 'Needs improvement',
  insufficient_evidence: 'Needs evidence',
  not_imported: 'Not imported',
  unvalidated: 'Review unavailable',
};
interface AuditRun {
  id: string;
  mode?: 'listing' | 'screenshots';
  workflow_id: string;
  status: WorkflowStatus;
  locale: string;
  created_at: string;
  snapshot_id: string;
  captured_at: string;
  source: string;
  is_demo: boolean;
  knowledge?: Guidance[];
  knowledge_version?: string | null;
  ai?: { provider: string; model: string } | null;
  report: {
    visual?: VisualReport;
    editorial?: {
      provider: string;
      model: string;
      resolved_model: string;
      usage: { input_tokens?: number; output_tokens?: number; reasoning_tokens?: number };
      accepted_proposals: number;
      rejected_proposals: number;
      assessments?: Assessment[];
      reviewed_fields?: number;
      grounding?: {
        reviewed_items: number;
        withheld_observations: number;
        withheld_proposals: number;
        resolved_model: string | null;
        usage: { input_tokens?: number; output_tokens?: number; reasoning_tokens?: number };
      };
    };
    ruleset: string;
    reviewed_on: string;
    checks: Check[];
    counts: Record<CheckStatus, number>;
  } | null;
}
const pending = (status: string) => ['queued', 'running', 'canceling'].includes(status);
const labels: Record<CheckStatus, string> = {
  issue: 'To fix',
  recommendation: 'Suggested change',
  review: 'Needs review',
  unavailable: 'Not assessed',
  passed: 'Checked',
};
const date = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

function Finding({
  check,
  onAdd,
  assessment,
}: {
  check: Check;
  onAdd?: () => void;
  assessment?: Assessment;
}) {
  const [copyState, setCopyState] = useState('');
  const isAI = check.basis === 'editorial_hypothesis' || !!assessment;
  const evidence = Array.from(
    new Map(
      [...(assessment?.evidence ?? []), ...(check.evidence ?? [])].map((item) => [
        JSON.stringify([item.field, item.quote]),
        item,
      ]),
    ).values(),
  );
  const sources = Array.from(
    new Map(
      [...(assessment?.sources ?? []), ...check.sources].map((item) => [item.id, item]),
    ).values(),
  );
  return (
    <details
      className={`aso-finding aso-${check.status}`}
      open={!!assessment || ['issue', 'recommendation'].includes(check.status)}
    >
      <summary>
        <span className="aso-finding-title">
          {assessment ? fieldNames[assessment.field] : check.title}
        </span>
        <span className="pill">
          {assessment
            ? verdictLabels[assessment.verdict]
            : isAI
              ? 'AI proposal · Review'
              : check.basis === 'requirement' && check.status === 'passed'
                ? 'Within limit'
                : labels[check.status]}
        </span>
      </summary>
      <div className="aso-finding-body">
        <p className="aso-observation">{assessment?.observation ?? check.observation}</p>
        {assessment && check.replacement && check.observation !== assessment.observation && (
          <p>{check.observation}</p>
        )}
        {!assessment && <p>{check.action}</p>}
        {assessment?.verdict === 'improve' && !check.replacement && (
          <p className="note">
            No additional replacement retained. Review this observation alongside the Apple checks
            below.
          </p>
        )}
        {typeof check.observed === 'string' && check.observed && (
          <details className="aso-evidence">
            <summary>Imported value</summary>
            <p>{check.observed}</p>
          </details>
        )}
        {check.replacement && (
          <div className="aso-proposal">
            <label>
              {check.field === 'keywords' ? 'Proposed keywords' : 'Proposed text'}
              <textarea rows={3} readOnly value={check.replacement} />
            </label>
            <div className="action-group">
              {onAdd && (
                <button className="button primary" onClick={onAdd}>
                  Add to draft
                </button>
              )}
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(check.replacement!);
                    setCopyState('Copied. Review before applying in App Store Connect.');
                    notify('success', 'Proposal copied.');
                  } catch {
                    setCopyState('Select the proposed text to copy it.');
                    notify('error', 'Clipboard unavailable. Select the proposed text to copy it.');
                  }
                }}
              >
                Copy proposal
              </button>
              {copyState && (
                <span className="note" role="status">
                  {copyState}
                </span>
              )}
            </div>
          </div>
        )}
        {!!evidence.length && (
          <details className="aso-evidence">
            <summary>Evidence from your listing</summary>
            {evidence.map((item, i) => (
              <blockquote key={i}>
                <small>{fieldNames[item.field] || item.field}</small>
                <p>{item.quote}</p>
              </blockquote>
            ))}
          </details>
        )}
        {!!sources.length && (
          <footer className="aso-sources">
            <span>
              {isAI
                ? assessment
                  ? 'AI content review'
                  : 'Editorial hypothesis'
                : check.basis === 'requirement'
                  ? 'Official requirement'
                  : check.basis === 'measurement'
                    ? 'Measurement guidance'
                    : 'Official recommendation'}
            </span>
            {sources.map((source) => (
              <SourceReference key={source.id} source={source} />
            ))}
          </footer>
        )}
      </div>
    </details>
  );
}

function AppAudit(props: ModuleProps & { app: MobileApp }) {
  const { app, workspace, previewMode, navigate, registerLeaveGuard } = props;
  const [tab, setTab] = useState<'overview' | 'drafts' | 'sources'>('overview');
  const [draftSeed, setDraftSeed] = useState<DraftSeed | null>(null);
  const draftGuard = useRef<(() => Promise<boolean>) | null>(null);
  const registerDraftGuard = useCallback(
    (guard: () => Promise<boolean>) => {
      draftGuard.current = guard;
      const release = registerLeaveGuard?.(guard);
      return () => {
        draftGuard.current = null;
        release?.();
      };
    },
    [registerLeaveGuard],
  );
  async function switchTab(next: 'overview' | 'drafts' | 'sources') {
    if (draftGuard.current && !(await draftGuard.current())) return;
    setDraftSeed(null);
    setTab(next);
  }
  const metadata = app.metadata;
  const locales = metadata?.data.localizations?.length
    ? metadata.data.localizations.map((item) => item.locale)
    : metadata?.data.locale
      ? [metadata.data.locale]
      : [];
  const [locale, setLocale] = useState(
    locales.includes(metadata?.data.locale || '') ? metadata!.data.locale : locales[0] || '',
  );
  const [ai, setAI] = useState<AIChoice>(null);
  const [aiLoading, setAILoading] = useState(true);
  const [mode, setMode] = useState<'listing' | 'screenshots'>('listing');
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [runId, setRunId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const alive = useRef(true);
  const request = useRef<{ key: string; id: string } | null>(null);
  const base = moduleUrl(workspace.id, 'aso', `apps/${app.id}/runs/`);
  const canWrite = workspace.role !== 'viewer' && !previewMode;
  const history = runs.filter((item) => item.locale === locale);
  const run = history.find((item) => item.id === runId) ?? history[0];
  const working = history.some((item) => pending(item.status));
  const screenshotCount =
    metadata?.data.screenshots_locale === locale ? (metadata.data.screenshots?.length ?? 0) : 0;

  useEffect(() => {
    alive.current = true;
    let active = true;
    api<AuditRun[]>(base)
      .then((next) => {
        if (active) setRuns(next);
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [base]);

  async function refresh() {
    try {
      const next = await api<AuditRun[]>(base);
      if (alive.current) {
        setRuns(next);
        setError('');
      }
    } catch (err) {
      if (alive.current) {
        setError((err as Error).message);
        setRuns([]);
        setLoadFailed(true);
      }
    }
  }
  async function start(retry = false) {
    if (!metadata || (retry && !run)) return;
    setBusy(true);
    setError('');
    const key = retry
      ? `retry:${run.id}`
      : `${metadata.id}:${locale}:${mode}:${ai?.provider || 'rules'}:${ai?.model || ''}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      const next = await api<AuditRun>(
        retry ? moduleUrl(workspace.id, 'aso', `runs/${run.id}/retry/`) : base,
        {
          method: 'POST',
          feedback: { success: retry ? 'Audit retry started.' : 'Audit started.' },
          body: JSON.stringify({
            request_id: request.current.id,
            ...(!retry && {
              snapshot_id: metadata.id,
              locale,
              ...(mode === 'screenshots' ? { mode } : {}),
              ...(ai || {}),
            }),
          }),
        },
      );
      if (!alive.current) return;
      request.current = null;
      setRuns((old) => [next, ...old.filter((item) => item.id !== next.id)]);
      setRunId(next.id);
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function addToDraft(check: Check) {
    if (!run) return;
    setDraftSeed({
      audit_id: run.id,
      check_id: check.id,
      name: check.basis === 'editorial_hypothesis' ? check.title : 'Keyword cleanup',
    });
    setTab('drafts');
  }
  if (app.platform !== 'ios')
    return (
      <p className="notice">
        Audits currently support App Store listings. Google Play is coming later.
      </p>
    );
  const checks = run?.report?.checks || [];
  const assessments = run?.report?.editorial?.assessments;
  const actionable = checks.filter(
    (check) =>
      ['issue', 'recommendation'].includes(check.status) &&
      !(assessments && check.basis === 'editorial_hypothesis'),
  );
  const coverage = checks.filter((check) => ['review', 'unavailable'].includes(check.status));
  const passed = checks.filter((check) => check.status === 'passed');
  return (
    <>
      <nav className="aso-tabs" aria-label="ASO views">
        <button
          aria-current={tab === 'overview' ? 'page' : undefined}
          onClick={() => void switchTab('overview')}
        >
          Audit
        </button>
        <button
          aria-current={tab === 'drafts' ? 'page' : undefined}
          onClick={() => void switchTab('drafts')}
        >
          Drafts
        </button>
        <button
          aria-current={tab === 'sources' ? 'page' : undefined}
          onClick={() => void switchTab('sources')}
        >
          Sources
        </button>
      </nav>
      {tab === 'drafts' ? (
        <Drafts
          {...props}
          app={app}
          locale={locale}
          seed={draftSeed}
          registerLeaveGuard={registerDraftGuard}
        />
      ) : tab === 'sources' ? (
        <Sources
          key={run?.id || 'current'}
          workspaceId={workspace.id}
          mode={run?.mode ?? mode}
          saved={
            run?.ai
              ? {
                  entries: run.knowledge ?? [],
                  version: run.knowledge_version,
                  created_at: run.created_at,
                }
              : undefined
          }
        />
      ) : (
        <>
          <AIOptions
            suggestions={modelSuggestions}
            workspaceId={workspace.id}
            owner={workspace.role === 'owner' && !previewMode}
            disabled={!canWrite || busy || working}
            onChange={(choice, loading) => {
              setAI(choice);
              setAILoading(loading);
            }}
          />
          <section className="aso-toolbar" aria-label="Audit settings">
            <label className="compact-label">
              Review
              <select
                value={mode}
                disabled={busy || working}
                onChange={(event) => setMode(event.target.value as 'listing' | 'screenshots')}
              >
                <option value="listing">Listing text</option>
                <option value="screenshots">Screenshots</option>
              </select>
            </label>
            <label className="compact-label">
              Language
              <select
                value={locale}
                disabled={busy || !locales.length}
                onChange={(event) => {
                  setLocale(event.target.value);
                  setRunId('');
                }}
              >
                {locales.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <div className="aso-import-date">
              <span>Imported listing</span>
              <strong>{metadata ? date(metadata.captured_at) : 'No metadata yet'}</strong>
            </div>
            <button
              className="button primary"
              disabled={
                !canWrite ||
                !locale ||
                !metadata ||
                busy ||
                working ||
                loading ||
                loadFailed ||
                aiLoading ||
                (mode === 'screenshots' && (!ai || !screenshotCount)) ||
                (!!ai && !ai.model)
              }
              onClick={() => start()}
            >
              {busy
                ? 'Starting…'
                : working
                  ? 'Audit in progress…'
                  : mode === 'screenshots'
                    ? 'Review screenshots'
                    : 'Run audit'}
            </button>
          </section>
          <p className="aso-scope">
            {mode === 'screenshots'
              ? screenshotCount
                ? `${screenshotCount} screenshots imported for ${locale} · Choose an AI model. Up to 10 images and listing text are sent twice to your provider; usage is billed there.`
                : `No screenshots imported for ${locale}. ${metadata?.data.screenshots_locale ? `Images are available for ${metadata.data.screenshots_locale}.` : 'Refresh the app import in My apps.'}`
              : ai
                ? 'Apple checks + AI copy and evidence review · Up to 2 model calls. Listing text is sent to your provider; usage is billed there.'
                : 'Apple metadata checks · No AI call'}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {loading ? (
            <p role="status">Loading audits…</p>
          ) : loadFailed ? (
            <p>Reopen ASO to load your audits again.</p>
          ) : !run ? (
            <section className="aso-empty">
              <img src="/modules/audit-aso.webp" alt="" />
              <h2>Review your store listing</h2>
              <p>
                Choose a model for editorial recommendations, or run Apple metadata checks without
                AI.
              </p>
              {!metadata && (
                <button className="button secondary" onClick={() => navigate('app_catalog')}>
                  Open My apps
                </button>
              )}
            </section>
          ) : (
            <>
              <div className="aso-history">
                <h2>Audit activity</h2>
                <label className="compact-label">
                  History
                  <select
                    value={run.id}
                    disabled={busy}
                    onChange={(event) => setRunId(event.target.value)}
                  >
                    {history.map((item) => (
                      <option key={item.id} value={item.id}>
                        {date(item.created_at)} ·{' '}
                        {item.mode === 'screenshots' ? 'Screenshots · ' : ''}
                        {item.status === 'succeeded' ? 'Completed' : item.status} ·{' '}
                        {item.ai?.model || 'Rules only'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {run.snapshot_id !== metadata?.id && (
                <p className="notice">
                  This audit uses an earlier import. Run again to check the latest listing.
                </p>
              )}
              {run.is_demo && <p className="notice">This audit uses fictional demo metadata.</p>}
              <WorkflowPanel
                key={run.workflow_id}
                workspaceId={workspace.id}
                workflowId={run.workflow_id}
                canWrite={canWrite && !busy}
                onRetry={() => start(true)}
                onStatus={(status) => {
                  setRuns((old) =>
                    old.map((item) => (item.id === run.id ? { ...item, status } : item)),
                  );
                  if (!pending(status)) void refresh();
                }}
              />
              {run.report && (
                <section className="aso-report" aria-label="Audit findings">
                  <div className="aso-report-heading">
                    <h2>{run.report.visual ? 'Screenshot review' : 'Recommendations'}</h2>
                    <span className="note">
                      {run.locale} · Imported {date(run.captured_at)}
                    </span>
                  </div>
                  {run.report.visual ? (
                    <Screenshots report={run.report.visual} />
                  ) : (
                    <>
                      {run.report.editorial && (
                        <p className="notice">
                          {run.report.editorial.resolved_model} ·{' '}
                          {run.report.editorial.accepted_proposals} AI proposals ·{' '}
                          {run.report.editorial.usage.input_tokens ?? '—'} input /{' '}
                          {run.report.editorial.usage.output_tokens ?? '—'} output tokens
                          {!!run.report.editorial.usage.reasoning_tokens &&
                            ` + ${run.report.editorial.usage.reasoning_tokens} reasoning tokens`}
                          {run.report.editorial.rejected_proposals > 0 &&
                            ` · ${run.report.editorial.rejected_proposals} proposals excluded by validation.`}
                        </p>
                      )}
                      {run.report.editorial?.grounding ? (
                        <p className="note">
                          Evidence review · {run.report.editorial.grounding.reviewed_items} items
                          checked
                          {' · '}
                          {run.report.editorial.grounding.withheld_observations}{' '}
                          {run.report.editorial.grounding.withheld_observations === 1
                            ? 'observation'
                            : 'observations'}{' '}
                          and {run.report.editorial.grounding.withheld_proposals}{' '}
                          {run.report.editorial.grounding.withheld_proposals === 1
                            ? 'proposal'
                            : 'proposals'}{' '}
                          withheld
                          {' · '}
                          {run.report.editorial.grounding.usage.input_tokens ?? '—'} input /{' '}
                          {run.report.editorial.grounding.usage.output_tokens ?? '—'} output tokens
                          {!!run.report.editorial.grounding.usage.reasoning_tokens &&
                            ` + ${run.report.editorial.grounding.usage.reasoning_tokens} reasoning tokens`}
                        </p>
                      ) : run.report.editorial ? (
                        <p className="notice">
                          This earlier audit did not include the separate evidence review. Run a new
                          AI audit to check its claims.
                        </p>
                      ) : null}
                      <h3>Content review</h3>
                      {assessments ? (
                        <>
                          <p className="note">
                            {run.report.editorial?.reviewed_fields} of {assessments.length} fields
                            reviewed · AI assessment
                          </p>
                          {assessments.map((assessment) => {
                            const proposal = checks.find(
                              (check) =>
                                check.field === assessment.field &&
                                check.basis === 'editorial_hypothesis',
                            );
                            const finding: Check = proposal ?? {
                              id: `assessment.${assessment.field}`,
                              field: assessment.field,
                              title: fieldNames[assessment.field],
                              status: assessment.verdict === 'keep' ? 'passed' : 'review',
                              basis: 'editorial_assessment',
                              observation: assessment.observation,
                              action: '',
                              observed: assessment.observed,
                              sources: [],
                            };
                            return (
                              <Finding
                                key={`${run.id}:assessment:${assessment.field}`}
                                check={finding}
                                assessment={assessment}
                                onAdd={
                                  canWrite && proposal?.replacement
                                    ? () => addToDraft(proposal)
                                    : undefined
                                }
                              />
                            );
                          })}
                        </>
                      ) : (
                        <p className="note">
                          {run.ai
                            ? 'This earlier audit did not record a review for each field. Run a new AI audit to see them.'
                            : 'Content was not reviewed by AI. Choose a provider and model to review each field.'}
                        </p>
                      )}
                      <h3>{assessments || !run.ai ? 'Apple checks' : 'Saved recommendations'}</h3>
                      {actionable.length ? (
                        actionable.map((check) => (
                          <Finding
                            key={`${run.id}:${check.id}`}
                            check={check}
                            onAdd={
                              canWrite && check.replacement ? () => addToDraft(check) : undefined
                            }
                          />
                        ))
                      ) : (
                        <p className="aso-no-issues">
                          No changes identified by these metadata checks.
                        </p>
                      )}
                      <h3>Still to assess</h3>
                      {coverage.map((check) => (
                        <Finding key={`${run.id}:${check.id}`} check={check} />
                      ))}
                      {!!passed.length && (
                        <details className="aso-passed-group">
                          <summary>{passed.length} Apple checks passed</summary>
                          {passed.map((check) => (
                            <Finding key={`${run.id}:${check.id}`} check={check} />
                          ))}
                        </details>
                      )}
                      <p className="aso-report-footnote">
                        No changes have been sent to Apple.{' '}
                        {run.ai ? 'AI proposals require review. ' : 'Editorial AI was not used. '}
                        Competitor research, screenshot analysis and download measurement are not
                        included.
                      </p>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

export default function ASO(props: ModuleProps) {
  const { selectedApp, apps, selectApp, navigate, workspace } = props;
  return (
    <>
      <div className="page-heading heading-split">
        <h1>ASO</h1>
        {!!apps.length && (
          <label className="compact-label">
            App
            <select
              value={selectedApp?.id || ''}
              onChange={(event) => {
                const app = apps.find((item) => item.id === event.target.value);
                if (app) selectApp(app);
              }}
            >
              {!selectedApp && <option value="">Choose an app</option>}
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {selectedApp ? (
        <AppAudit key={`${workspace.id}:${selectedApp.id}`} {...props} app={selectedApp} />
      ) : (
        <section className="catalog-empty">
          <img src="/modules/audit-aso.webp" alt="" />
          <h2>Choose an app to audit</h2>
          <button className="button primary" onClick={() => navigate('app_catalog')}>
            Open My apps
          </button>
        </section>
      )}
    </>
  );
}
