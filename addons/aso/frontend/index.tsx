import { t, getLocale } from '../../../web/src/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';
import type { WorkflowStatus } from '../../../web/src/workflows/types';
import AIOptions, { type AIChoice } from '../../../web/src/ai/AIOptions';
import Drafts from './Drafts';
import CompareAudits from './CompareAudits';
import ProjectProposal, { type ProjectProposalReport } from './ProjectProposal';
import type { DraftSeed } from './draftTypes';
import { readAuditView, saveAuditView } from './auditView';
import { notify } from '../../../web/src/notifications/store';
import Sources, {
  fieldNames,
  isStoreSource,
  SourceReference,
  type Guidance,
  type Source,
} from './Sources';
import Screenshots, { type VisualReport, type VisualImage } from './Screenshots';
import ScreenshotBriefs, { type ScreenshotBrief } from './ScreenshotBriefs';

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
export interface AuditRun {
  platform?: 'ios' | 'android';
  id: string;
  mode?: 'listing' | 'screenshots' | 'project';
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
    project?: ProjectProposalReport;
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
  new Date(value).toLocaleString(getLocale(), {
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
  ).filter(isStoreSource);
  return (
    <details
      className={`aso-finding aso-${check.status}`}
      open={!!assessment || ['issue', 'recommendation'].includes(check.status)}
    >
      <summary>
        <span className="aso-finding-title">
          {t(assessment ? fieldNames[assessment.field] : check.title)}
        </span>
        <span className="pill">
          {t(
            assessment
              ? verdictLabels[assessment.verdict]
              : isAI
                ? t('AI proposal · Review')
                : check.basis === 'requirement' && check.status === 'passed'
                  ? t('Within limit')
                  : labels[check.status],
          )}
        </span>
      </summary>
      <div className="aso-finding-body">
        <p className="aso-observation">{t(assessment?.observation ?? check.observation)}</p>
        {assessment && check.replacement && check.observation !== assessment.observation && (
          <p>{t(check.observation)}</p>
        )}
        {!assessment && <p>{t(check.action)}</p>}
        {assessment?.verdict === 'improve' && !check.replacement && (
          <p className="note">
            {t(
              'No additional replacement retained. Review this observation alongside the store checks below.',
            )}
          </p>
        )}
        {typeof check.observed === 'string' && check.observed && (
          <details className="aso-evidence">
            <summary>{t('Imported value')}</summary>
            <p>{check.observed}</p>
          </details>
        )}
        {check.replacement && (
          <div className="aso-proposal">
            <label>
              {check.field === 'keywords' ? t('Proposed keywords') : t('Proposed text')}
              <textarea rows={3} readOnly value={check.replacement} />
            </label>
            <div className="action-group">
              {onAdd && (
                <button className="button primary" onClick={onAdd}>
                  {t('Add to draft')}
                </button>
              )}
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(check.replacement!);
                    setCopyState('Copied. Review before applying in your store console.');
                    notify('success', 'Proposal copied.');
                  } catch {
                    setCopyState('Select the proposed text to copy it.');
                    notify('error', 'Clipboard unavailable. Select the proposed text to copy it.');
                  }
                }}
              >
                {t('Copy proposal')}
              </button>
              {copyState && (
                <span className="note" role="status">
                  {t(copyState)}
                </span>
              )}
            </div>
          </div>
        )}
        {!!evidence.length && (
          <details className="aso-evidence">
            <summary>{t('Evidence from your listing')}</summary>
            {evidence.map((item, i) => (
              <blockquote key={i}>
                <small>{t(fieldNames[item.field] || item.field)}</small>
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
                  ? t('AI content review')
                  : t('Editorial hypothesis')
                : check.basis === 'requirement'
                  ? t('Official requirement')
                  : check.basis === 'measurement'
                    ? t('Measurement guidance')
                    : t('Official recommendation')}
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
  const [tab, setTab] = useState<'overview' | 'compare' | 'drafts' | 'sources'>('overview');
  const [draftSeed, setDraftSeed] = useState<DraftSeed | null>(null);
  const [draftKind, setDraftKind] = useState<'listing' | 'screenshots'>('listing');
  const [screenshotBrief, setScreenshotBrief] = useState<ScreenshotBrief | null>(null);
  const briefRequest = useRef<{ key: string; id: string } | null>(null);
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
  async function switchTab(next: 'overview' | 'compare' | 'drafts' | 'sources') {
    if (draftGuard.current && !(await draftGuard.current())) return;
    setDraftSeed(null);
    setScreenshotBrief(null);
    setTab(next);
  }
  const storageKey = `panda.aso.view:${workspace.id}:${app.id}`;
  const [savedView] = useState(() => readAuditView(storageKey));
  const restored = useRef(false);
  const metadata = app.metadata;
  const project = metadata?.data.project;
  const isGoogle = app.platform === 'android';
  const locales = metadata?.data.localizations?.length
    ? metadata.data.localizations.map((item) => item.locale)
    : metadata?.data.locale
      ? [metadata.data.locale]
      : [];
  const [locale, setLocale] = useState(
    savedView?.locale ||
      (locales.includes(metadata?.data.locale || '') ? metadata!.data.locale : locales[0] || ''),
  );
  const [ai, setAI] = useState<AIChoice>(null);
  const [aiLoading, setAILoading] = useState(true);
  const [mode, setMode] = useState<'listing' | 'screenshots' | 'project'>(
    project ? 'project' : savedView?.mode || 'listing',
  );
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [runId, setRunId] = useState(savedView?.runId || '');
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
  const activeRun = runs.find((item) => pending(item.status));
  const working = !!activeRun;
  const historyLocales = Array.from(new Set([...locales, ...runs.map((item) => item.locale)]));
  const screenshotCount =
    metadata?.data.screenshots_locale === locale ? (metadata.data.screenshots?.length ?? 0) : 0;

  function openAudit(item: AuditRun) {
    setLocale(item.locale);
    setMode(project ? 'project' : item.mode || 'listing');
    setRunId(item.id);
    setTab('overview');
  }
  function receiveHistory(next: AuditRun[]) {
    setRuns(next);
    if (!restored.current) {
      const selected =
        next.find((item) => pending(item.status)) ??
        next.find((item) => item.id === savedView?.runId) ??
        next[0];
      if (selected) openAudit(selected);
      restored.current = true;
    }
  }
  useEffect(() => {
    if (!loading && !loadFailed) {
      saveAuditView(storageKey, { locale, mode, runId: run?.id || '' });
    }
  }, [storageKey, locale, mode, run?.id, loading, loadFailed]);

  useEffect(() => {
    alive.current = true;
    let active = true;
    api<AuditRun[]>(base)
      .then((next) => {
        if (active) receiveHistory(next);
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

  async function refresh(reloading = false) {
    if (reloading) setLoading(true);
    try {
      const next = await api<AuditRun[]>(base);
      if (alive.current) {
        receiveHistory(next);
        setError('');
        setLoadFailed(false);
      }
    } catch (err) {
      if (alive.current) {
        setError((err as Error).message);
        setLoadFailed(true);
      }
    } finally {
      if (alive.current && reloading) setLoading(false);
    }
  }
  async function start(retry = false, retryChoice?: NonNullable<AIChoice>) {
    if (!metadata || busy || loading || loadFailed || (retry ? !run : working)) return;
    setBusy(true);
    setError('');
    const key = retry
      ? `retry:${run.id}:${retryChoice?.provider || ''}:${retryChoice?.model || ''}`
      : `${metadata.id}:${locale}:${mode}:${ai?.provider || 'rules'}:${ai?.model || ''}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    saveAuditView(storageKey, { locale, mode, runId: '' });
    try {
      const next = await api<AuditRun>(
        retry ? moduleUrl(workspace.id, 'aso', `runs/${run.id}/retry/`) : base,
        {
          method: 'POST',
          feedback: { success: retry ? 'Audit retry started.' : 'Audit started.' },
          body: JSON.stringify({
            request_id: request.current.id,
            ...(retry && retryChoice),
            ...(!retry && {
              snapshot_id: metadata.id,
              locale,
              ...(mode !== 'listing' ? { mode } : {}),
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
    setDraftKind('listing');
    setTab('drafts');
  }
  async function createScreenshotBrief(image: VisualImage) {
    if (!run || !canWrite || busy) return;
    const key = `${run.id}:${image.image_id}`;
    if (briefRequest.current?.key !== key) briefRequest.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const next = await api<ScreenshotBrief>(
        moduleUrl(workspace.id, 'aso', `apps/${app.id}/screenshot-briefs/`),
        {
          method: 'POST',
          feedback: { success: 'Screenshot brief created.' },
          body: JSON.stringify({
            request_id: briefRequest.current.id,
            audit_id: run.id,
            image_id: image.image_id,
            name: `${app.name} — ${image.name || 'Screenshot update'}`.slice(0, 120),
          }),
        },
      );
      if (alive.current) {
        briefRequest.current = null;
        setScreenshotBrief(next);
        setDraftKind('screenshots');
        setTab('drafts');
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (!['ios', 'android'].includes(app.platform) && !(project && app.platform === 'undecided'))
    return <p className="notice">{t('Choose App Store or Google Play.')}</p>;
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
      {project && (
        <p className="notice">
          {t(
            isGoogle
              ? 'Start with your idea. ASO suggests a Google Play listing: app name, short description and full description.'
              : 'Start with your idea. ASO analyzes its positioning and suggests a first App Store listing: name, subtitle, description, keywords and promotional text. You do not need to write these first.',
          )}
        </p>
      )}
      <nav className="aso-tabs" aria-label={t('ASO views')}>
        <button
          aria-current={tab === 'overview' ? 'page' : undefined}
          onClick={() => void switchTab('overview')}
        >
          {t('Audit')}
        </button>
        <button
          aria-current={tab === 'compare' ? 'page' : undefined}
          onClick={() => void switchTab('compare')}
        >
          {t('Compare')}
        </button>
        <button
          aria-current={tab === 'drafts' ? 'page' : undefined}
          onClick={() => void switchTab('drafts')}
        >
          {t('Drafts')}
        </button>
        <button
          aria-current={tab === 'sources' ? 'page' : undefined}
          onClick={() => void switchTab('sources')}
        >
          {t('Sources')}
        </button>
      </nav>
      {tab === 'drafts' ? (
        <>
          <label className="compact-label aso-draft-kind">
            {t('Draft type ')}
            <select
              value={draftKind}
              onChange={async (event) => {
                const next = event.target.value as 'listing' | 'screenshots';
                if (draftGuard.current && !(await draftGuard.current())) return;
                setDraftSeed(null);
                setScreenshotBrief(null);
                setDraftKind(next);
              }}
            >
              <option value="listing">{t('Listing text')}</option>
              <option value="screenshots">{t('Screenshot briefs')}</option>
            </select>
          </label>
          {draftKind === 'screenshots' ? (
            <ScreenshotBriefs
              {...props}
              app={app}
              initial={screenshotBrief}
              registerLeaveGuard={registerDraftGuard}
            />
          ) : (
            <Drafts
              {...props}
              app={app}
              locale={locale}
              seed={draftSeed}
              registerLeaveGuard={registerDraftGuard}
            />
          )}
        </>
      ) : tab === 'compare' ? (
        <CompareAudits
          key={storageKey}
          runs={runs}
          preferredId={run?.id}
          storageKey={`${storageKey}:comparison`}
          loading={loading}
          error={loadFailed ? error : ''}
          canWrite={canWrite}
          onRefresh={() => void refresh(true)}
          onCompose={(seed, selectedLocale) => {
            setDraftSeed(seed);
            setLocale(selectedLocale);
            setDraftKind('listing');
            setTab('drafts');
          }}
        />
      ) : tab === 'sources' ? (
        <Sources
          key={run?.id || 'current'}
          workspaceId={workspace.id}
          platform={run?.platform || app.platform}
          mode={(run?.mode ?? mode) === 'screenshots' ? 'screenshots' : 'listing'}
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
            moduleContext="aso"
            emptyLabel={project ? 'Choose an AI provider' : 'Rules only · No AI'}
            capability={mode === 'screenshots' ? 'vision' : 'text'}
            workspaceId={workspace.id}
            owner={workspace.role === 'owner' && !previewMode}
            disabled={!canWrite || busy || working}
            onChange={(choice, loading) => {
              setAI(choice);
              setAILoading(loading);
            }}
          />
          <section className="aso-toolbar" aria-label={t('Audit settings')}>
            <label className="compact-label">
              {t('Review ')}
              <select
                value={mode}
                disabled={busy || working}
                onChange={(event) =>
                  setMode(event.target.value as 'listing' | 'screenshots' | 'project')
                }
              >
                {project ? (
                  <option value="project">{t('Idea and first listing')}</option>
                ) : (
                  <option value="listing">{t('Listing text')}</option>
                )}
                <option value="screenshots" disabled={!!project}>
                  {t('Screenshots')}
                </option>
              </select>
            </label>
            <label className="compact-label">
              {t('Language ')}
              <select
                value={locale}
                disabled={busy || loading || !historyLocales.length}
                onChange={(event) => {
                  setLocale(event.target.value);
                  setRunId('');
                }}
              >
                {historyLocales.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <div className="aso-import-date">
              <span>{project ? t('Project description') : t('Imported listing')}</span>
              <strong>{metadata ? date(metadata.captured_at) : t('No metadata yet')}</strong>
            </div>
            <button
              className="button primary"
              disabled={
                !canWrite ||
                !locale ||
                !locales.includes(locale) ||
                (!!project && !ai) ||
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
                ? t('Starting…')
                : working
                  ? t('Audit in progress…')
                  : mode === 'screenshots'
                    ? t('Review screenshots')
                    : project
                      ? t('Analyze idea and suggest listing')
                      : t('Run audit')}
            </button>
          </section>
          <p className="aso-scope">
            {project
              ? t(
                  'Your project description is sent to the selected AI provider for analysis, writing and evidence review. Up to 2 model calls, billed by your provider. No existing listing is required.',
                )
              : mode === 'screenshots'
                ? screenshotCount
                  ? t(
                      '{0} screenshots imported for {1} · Choose an AI model. Up to 10 images and listing text are sent twice to your provider; usage is billed there.',
                      screenshotCount,
                      locale,
                    )
                  : t(
                      'No screenshots imported for {0}. {1}',
                      locale,
                      metadata?.data.screenshots_locale
                        ? t('Images are available for {0}.', metadata.data.screenshots_locale)
                        : t('Refresh the app import in My apps.'),
                    )
                : ai
                  ? t(
                      isGoogle
                        ? 'Google Play checks + AI copy and evidence review · Up to 2 model calls. Listing text is sent to your provider; usage is billed there.'
                        : 'Apple checks + AI copy and evidence review · Up to 2 model calls. Listing text is sent to your provider; usage is billed there.',
                    )
                  : t(
                      isGoogle
                        ? 'Google Play metadata checks · No AI call'
                        : 'Apple metadata checks · No AI call',
                    )}
          </p>
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          {!loading && runs.length > 0 && (
            <>
              <div className="aso-history">
                <h2>{t('Audit activity')}</h2>
                <label className="compact-label">
                  {t('History ')}
                  <select
                    value={run?.id || ''}
                    disabled={busy}
                    onChange={(event) => {
                      const selected = runs.find((item) => item.id === event.target.value);
                      if (selected) openAudit(selected);
                    }}
                  >
                    {!run && <option value="">{t('Choose a saved audit')}</option>}
                    {runs.map((item) => (
                      <option key={item.id} value={item.id}>
                        {date(item.created_at)} · {item.locale} ·{' '}
                        {item.mode === 'project'
                          ? t('Idea and first listing')
                          : item.mode === 'screenshots'
                            ? t('Screenshots')
                            : t('Listing text')}{' '}
                        · {t(item.status === 'succeeded' ? 'Completed' : item.status)} ·{' '}
                        {item.ai?.model || t('Rules only')}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void refresh(true)}
                >
                  {t('Refresh audits')}
                </button>
              </div>
              <p className="note">
                {t(
                  'Audits are saved automatically. You can leave this page and return to your history without starting another audit.',
                )}
              </p>
            </>
          )}
          {activeRun && activeRun.id !== run?.id && (
            <p className="notice" role="status">
              {t('An audit is in progress for {0}.', activeRun.locale)}{' '}
              <button className="text-button" onClick={() => openAudit(activeRun)}>
                {t('View current audit')}
              </button>
            </p>
          )}
          {loading ? (
            <p role="status">{t('Loading audits…')}</p>
          ) : loadFailed && !run ? (
            <div>
              <p>
                {t(
                  'Audit history could not be loaded. Check the saved audits before starting another one.',
                )}
              </p>
              <button className="button secondary" onClick={() => void refresh(true)}>
                {t('Retry loading audits')}
              </button>
            </div>
          ) : !run ? (
            <section className="aso-empty">
              <img src="/modules/audit-aso.webp" alt="" />
              <h2>
                {project
                  ? t('Your first listing starts with your idea')
                  : t('Review your store listing')}
              </h2>
              <p>
                {t(
                  project
                    ? 'Choose an AI model to analyze your project and propose its first listing. Your saved idea is enough to start.'
                    : isGoogle
                      ? 'Choose a model for editorial recommendations, or run Google Play metadata checks without AI.'
                      : 'Choose a model for editorial recommendations, or run Apple metadata checks without AI.',
                )}
              </p>
              {!metadata && (
                <button className="button secondary" onClick={() => navigate('app_catalog')}>
                  {t('Open My apps')}
                </button>
              )}
            </section>
          ) : (
            <>
              {run.snapshot_id !== metadata?.id && (
                <p className="notice">
                  {run.source === 'project.manual'
                    ? t(
                        'This audit uses an earlier project version. Its saved results remain available.',
                      )
                    : t(
                        'This audit uses an earlier import. Run again to check the latest listing.',
                      )}
                </p>
              )}
              {run.is_demo && (
                <p className="notice">{t('This audit uses fictional demo metadata.')}</p>
              )}
              <WorkflowPanel
                key={run.workflow_id}
                workspaceId={workspace.id}
                workflowId={run.workflow_id}
                canWrite={canWrite && !busy}
                onRetry={(choice) => start(true, choice)}
                retryAI={
                  run.ai
                    ? {
                        choice: run.ai,
                        owner: workspace.role === 'owner',
                        moduleContext: 'aso',
                        capability: run.mode === 'screenshots' ? 'vision' : 'text',
                      }
                    : undefined
                }
                onStatus={(status) => {
                  setRuns((old) =>
                    old.map((item) => (item.id === run.id ? { ...item, status } : item)),
                  );
                  if (!pending(status)) void refresh();
                }}
              />
              {run.report && (
                <section className="aso-report" aria-label={t('Audit findings')}>
                  <div className="aso-report-heading">
                    <h2>
                      {run.report.project
                        ? t('Your ASO proposal')
                        : run.report.visual
                          ? t('Screenshot review')
                          : t('Recommendations')}
                    </h2>
                    <span className="note">
                      {run.locale}
                      {run.source === 'project.manual' ? t(' · Draft saved ') : t(' · Imported ')}
                      {date(run.captured_at)}
                    </span>
                  </div>
                  {run.report.project ? (
                    <ProjectProposal
                      report={run.report.project}
                      onUse={
                        canWrite && !busy
                          ? () => {
                              setDraftSeed({
                                audit_id: run.id,
                                check_id: 'project.listing',
                                name: t(
                                  isGoogle
                                    ? 'First Google Play listing'
                                    : 'First App Store listing',
                                ),
                              });
                              setDraftKind('listing');
                              setTab('drafts');
                            }
                          : undefined
                      }
                    />
                  ) : run.report.visual ? (
                    <Screenshots
                      report={run.report.visual}
                      onCreateBrief={canWrite && !busy ? createScreenshotBrief : undefined}
                    />
                  ) : (
                    <>
                      {run.report.editorial && (
                        <p className="notice">
                          {run.report.editorial.resolved_model} ·{' '}
                          {run.report.editorial.accepted_proposals}
                          {t(' AI proposals ·')} {run.report.editorial.usage.input_tokens ?? '—'}
                          {t(' input /')} {run.report.editorial.usage.output_tokens ?? '—'}
                          {t(' output tokens ')}
                          {!!run.report.editorial.usage.reasoning_tokens &&
                            t(
                              ' + {0} reasoning tokens',
                              run.report.editorial.usage.reasoning_tokens,
                            )}
                          {run.report.editorial.rejected_proposals > 0 &&
                            t(
                              ' · {0} proposals excluded by validation.',
                              run.report.editorial.rejected_proposals,
                            )}
                        </p>
                      )}
                      {run.report.editorial?.grounding ? (
                        <p className="note">
                          {t('Evidence review · ')}
                          {run.report.editorial.grounding.reviewed_items}
                          {t(' items checked')}
                          {' · '}
                          {run.report.editorial.grounding.withheld_observations}{' '}
                          {run.report.editorial.grounding.withheld_observations === 1
                            ? t('observation')
                            : t('observations')}{' '}
                          {t('and ')}
                          {run.report.editorial.grounding.withheld_proposals}{' '}
                          {run.report.editorial.grounding.withheld_proposals === 1
                            ? t('proposal')
                            : t('proposals')}{' '}
                          {t('withheld')}
                          {' · '}
                          {run.report.editorial.grounding.usage.input_tokens ?? '—'}
                          {t(' input /')}{' '}
                          {run.report.editorial.grounding.usage.output_tokens ?? '—'}
                          {t(' output tokens ')}
                          {!!run.report.editorial.grounding.usage.reasoning_tokens &&
                            t(
                              ' + {0} reasoning tokens',
                              run.report.editorial.grounding.usage.reasoning_tokens,
                            )}
                        </p>
                      ) : run.report.editorial ? (
                        <p className="notice">
                          {t(
                            'This earlier audit did not include the separate evidence review. Run a new AI audit to check its claims.',
                          )}
                        </p>
                      ) : null}
                      <h3>{t('Content review')}</h3>
                      {assessments ? (
                        <>
                          <p className="note">
                            {run.report.editorial?.reviewed_fields}
                            {t(' of ')}
                            {assessments.length}
                            {t(' fields reviewed · AI assessment')}
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
                            ? t(
                                'This earlier audit did not record a review for each field. Run a new AI audit to see them.',
                              )
                            : t(
                                'Content was not reviewed by AI. Choose a provider and model to review each field.',
                              )}
                        </p>
                      )}
                      <h3>
                        {assessments || !run.ai
                          ? t(isGoogle ? 'Google Play checks' : 'Apple checks')
                          : t('Saved recommendations')}
                      </h3>
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
                          {t('No changes identified by these metadata checks.')}
                        </p>
                      )}
                      <h3>{t('Still to assess')}</h3>
                      {coverage.map((check) => (
                        <Finding key={`${run.id}:${check.id}`} check={check} />
                      ))}
                      {!!passed.length && (
                        <details className="aso-passed-group">
                          <summary>
                            {passed.length}
                            {t(isGoogle ? ' Google Play checks passed' : ' Apple checks passed')}
                          </summary>
                          {passed.map((check) => (
                            <Finding key={`${run.id}:${check.id}`} check={check} />
                          ))}
                        </details>
                      )}
                      <p className="aso-report-footnote">
                        {t(
                          isGoogle
                            ? 'No changes have been sent to Google Play.'
                            : 'No changes have been sent to Apple.',
                        )}{' '}
                        {run.ai
                          ? t('AI proposals require review. ')
                          : t('Editorial AI was not used. ')}
                        {t(
                          ' Competitor research, screenshot analysis and download measurement are not included.',
                        )}
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
        <h1>{t('ASO')}</h1>
        {!!apps.length && (
          <label className="compact-label">
            {t('App ')}
            <select
              value={selectedApp?.id || ''}
              onChange={(event) => {
                const app = apps.find((item) => item.id === event.target.value);
                if (app) selectApp(app);
              }}
            >
              {!selectedApp && <option value="">{t('Choose an app')}</option>}
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
          <h2>{t('Choose an app to audit')}</h2>
          <button className="button primary" onClick={() => navigate('app_catalog')}>
            {t('Open My apps')}
          </button>
        </section>
      )}
    </>
  );
}
