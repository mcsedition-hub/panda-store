import { useEffect, useRef, useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';
import type { WorkflowStatus } from '../../../web/src/workflows/types';

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
  sources: { id: string; title: string; publisher: string; url: string; reviewed_on: string }[];
}
interface AuditRun {
  id: string;
  workflow_id: string;
  status: WorkflowStatus;
  locale: string;
  created_at: string;
  snapshot_id: string;
  captured_at: string;
  source: string;
  is_demo: boolean;
  report: {
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

function Finding({ check }: { check: Check }) {
  const [copyState, setCopyState] = useState('');
  return (
    <details
      className={`aso-finding aso-${check.status}`}
      open={['issue', 'recommendation'].includes(check.status)}
    >
      <summary>
        <span className="aso-finding-title">{check.title}</span>
        <span className="pill">{labels[check.status]}</span>
      </summary>
      <div className="aso-finding-body">
        <p className="aso-observation">{check.observation}</p>
        <p>{check.action}</p>
        {typeof check.observed === 'string' && check.observed && (
          <details className="aso-evidence">
            <summary>Imported value</summary>
            <p>{check.observed}</p>
          </details>
        )}
        {check.replacement && (
          <div className="aso-proposal">
            <label>
              Proposed keywords
              <textarea rows={3} readOnly value={check.replacement} />
            </label>
            <div className="action-group">
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(check.replacement!);
                    setCopyState('Copied. Review before applying in App Store Connect.');
                  } catch {
                    setCopyState('Select the proposed text to copy it.');
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
        <footer className="aso-sources">
          <span>
            {check.basis === 'requirement'
              ? 'Official requirement'
              : check.basis === 'measurement'
                ? 'Measurement guidance'
                : 'Official recommendation'}
          </span>
          {check.sources.map((source) => (
            <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
              {source.publisher} · {source.title} ↗
            </a>
          ))}
          <small>Sources reviewed {check.sources[0]?.reviewed_on}</small>
        </footer>
      </div>
    </details>
  );
}

function AppAudit({ app, workspace, previewMode, navigate }: ModuleProps & { app: MobileApp }) {
  const metadata = app.metadata;
  const locales = metadata?.data.localizations?.length
    ? metadata.data.localizations.map((item) => item.locale)
    : metadata?.data.locale
      ? [metadata.data.locale]
      : [];
  const [locale, setLocale] = useState(
    locales.includes(metadata?.data.locale || '') ? metadata!.data.locale : locales[0] || '',
  );
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
    const key = retry ? `retry:${run.id}` : `${metadata.id}:${locale}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      const next = await api<AuditRun>(
        retry ? moduleUrl(workspace.id, 'aso', `runs/${run.id}/retry/`) : base,
        {
          method: 'POST',
          body: JSON.stringify({
            request_id: request.current.id,
            ...(!retry && { snapshot_id: metadata.id, locale }),
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
  if (app.platform !== 'ios')
    return (
      <p className="notice">
        Audits currently support App Store listings. Google Play is coming later.
      </p>
    );
  const checks = run?.report?.checks || [];
  const actionable = checks.filter((check) => ['issue', 'recommendation'].includes(check.status));
  const coverage = checks.filter((check) => ['review', 'unavailable'].includes(check.status));
  const passed = checks.filter((check) => check.status === 'passed');
  return (
    <>
      <section className="aso-toolbar" aria-label="Audit settings">
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
          disabled={!canWrite || !locale || !metadata || busy || working || loading || loadFailed}
          onClick={() => start()}
        >
          {busy ? 'Starting…' : working ? 'Audit in progress…' : run ? 'Run again' : 'Run audit'}
        </button>
      </section>
      <p className="aso-scope">App Store metadata checks · Apple sources · No AI key needed</p>
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
          <p>Check field limits and repeated keywords in the imported language.</p>
          {!metadata && (
            <button className="button secondary" onClick={() => navigate('app_catalog')}>
              Open My apps
            </button>
          )}
        </section>
      ) : (
        <>
          <div className="aso-history">
            <h2>Audit</h2>
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
                    {item.status === 'succeeded' ? 'Completed' : item.status}
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
                <h2>Findings</h2>
                <span className="note">
                  {run.locale} · Imported {date(run.captured_at)}
                </span>
              </div>
              {actionable.length ? (
                actionable.map((check) => <Finding key={`${run.id}:${check.id}`} check={check} />)
              ) : (
                <p className="aso-no-issues">No changes identified by these metadata checks.</p>
              )}
              <h3>Still to assess</h3>
              {coverage.map((check) => (
                <Finding key={`${run.id}:${check.id}`} check={check} />
              ))}
              {!!passed.length && (
                <details className="aso-passed">
                  <summary>{passed.length} checks passed</summary>
                  {passed.map((check) => (
                    <Finding key={`${run.id}:${check.id}`} check={check} />
                  ))}
                </details>
              )}
              <p className="aso-report-footnote">
                No changes have been sent to Apple. Editorial AI, competitor research and
                performance measurement are not included in this audit.
              </p>
            </section>
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
