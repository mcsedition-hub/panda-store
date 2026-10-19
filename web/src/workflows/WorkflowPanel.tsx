import { money, count } from '../ai-usage/format';
import { t, getLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { WorkflowSnapshot, WorkflowStatus } from './types';
import { trackWork } from '../notifications/store';
import AIOptions, { type AIChoice } from '../ai/AIOptions';

const labels: Record<WorkflowStatus | 'skipped', string> = {
  queued: 'Queued',
  running: 'Running',
  canceling: 'Stopping…',
  succeeded: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
  skipped: 'Skipped',
};
const terminal = (status: WorkflowStatus) => ['succeeded', 'failed', 'canceled'].includes(status);
function duration(start: string | null, end: string | null, now: number) {
  if (!start) return 'Not started';
  const seconds = Math.max(0, ((end ? Date.parse(end) : now) - Date.parse(start)) / 1000);
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

export default function WorkflowPanel({
  workspaceId,
  workflowId,
  canWrite,
  onStatus,
  onRetry,
  showError = true,
  retryAI,
}: {
  workspaceId: string;
  workflowId: string;
  canWrite: boolean;
  onStatus: (status: WorkflowStatus) => void;
  onRetry: (choice?: NonNullable<AIChoice>) => Promise<void>;
  showError?: boolean;
  retryAI?: {
    choice: NonNullable<AIChoice>;
    owner: boolean;
    moduleContext: 'aso' | 'smm';
    capability?: 'text' | 'vision';
  };
}) {
  const [data, setData] = useState<WorkflowSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [connection, setConnection] = useState('Connecting…');
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [changeModel, setChangeModel] = useState(false);
  const [retryChoice, setRetryChoice] = useState<AIChoice>(null);
  const [retryLoading, setRetryLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const callback = useRef(onStatus);
  const receive = useRef<(next: WorkflowSnapshot) => void>(() => {});
  callback.current = onStatus;
  const base = `/api/workspaces/${workspaceId}/workflows/${workflowId}/`;

  useEffect(() => {
    let active = true;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let position = 0;
    let finished = false;
    let blocked = false;
    let lastStatus = '';
    let polling = false;
    const abort = new AbortController();
    setData(null);
    setSelected(null);
    setError('');
    setConnectionError('');
    setConnection('Connecting…');
    function accept(next: WorkflowSnapshot) {
      if (!active || blocked || next.cursor < position) return;
      setConnectionError('');
      position = next.cursor;
      setData((old) => ({
        ...next,
        events: [
          ...new Map(
            [...(old?.events ?? []), ...next.events].map((event) => [event.sequence, event]),
          ).values(),
        ].sort((a, b) => a.sequence - b.sequence),
      }));
      if (lastStatus !== next.status) {
        if (!lastStatus && !terminal(next.status)) trackWork(workspaceId, workflowId);
        lastStatus = next.status;
        callback.current(next.status);
      }
      finished = terminal(next.status) && !next.has_more;
      if (finished) {
        source?.close();
        clearTimeout(timer);
        setConnection('Saved');
      }
    }
    receive.current = accept;
    async function poll() {
      if (polling || !active || finished) return;
      polling = true;
      try {
        const next = await api<WorkflowSnapshot>(base + `?after=${position}`, {
          signal: abort.signal,
        });
        accept(next);
        if (active && !finished) timer = setTimeout(poll, next.has_more ? 0 : 2000);
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && [401, 403, 404].includes(err.status)) {
          blocked = true;
          finished = true;
          source?.close();
          setData(null);
          setConnectionError((err as Error).message);
          setConnection('Unavailable');
        } else {
          setConnectionError((err as Error).message);
          setConnection('Reconnecting…');
          timer = setTimeout(poll, 3000);
        }
      } finally {
        polling = false;
      }
    }
    async function connect() {
      await poll();
      if (!active || finished || typeof EventSource === 'undefined') return;
      source = new EventSource(base + `events/?after=${position}`);
      source.onopen = () => {
        if (active && !finished) {
          clearTimeout(timer);
          setConnection('Live');
        }
      };
      source.addEventListener('update', (event) => {
        try {
          accept(JSON.parse((event as MessageEvent).data));
          if (active && !finished) setConnection('Live');
        } catch {
          setConnection('Reconnecting…');
          void poll();
        }
      });
      source.addEventListener('unavailable', () => {
        source?.close();
        if (active) {
          setConnection('Checking access…');
          void poll();
        }
      });
      source.onerror = () => {
        if (active && !finished) {
          setConnection('Reconnecting · checking for updates');
          void poll();
        }
      };
    }
    void connect();
    return () => {
      active = false;
      receive.current = () => {};
      abort.abort();
      clearTimeout(timer);
      source?.close();
    };
  }, [base, reload]);

  const pending = data && !terminal(data.status);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  async function action(kind: 'cancel' | 'retry') {
    setBusy(true);
    setError('');
    try {
      if (kind === 'retry') {
        if (changeModel && (retryLoading || !retryChoice?.model)) return;
        await onRetry(changeModel ? retryChoice! : undefined);
      } else {
        const next = await api<WorkflowSnapshot>(base + 'cancel/', {
          method: 'POST',
          feedback: { success: 'Stop requested.' },
        });
        receive.current(next);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const step = data?.steps.find((item) => item.key === selected);
  const visibleEvents =
    data?.events.filter((event) => !selected || event.step_key === selected) ?? [];
  return (
    <section className="workflow-panel" aria-label={t('Workflow activity')}>
      <div className="workflow-heading">
        <div>
          <h3>{t(data?.title ?? t('Workflow'))}</h3>
          <p className="workflow-meta">
            <span role="status">
              {t(
                data
                  ? labels[data.status]
                  : connectionError
                    ? t('Activity unavailable')
                    : t('Loading activity…'),
              )}
            </span>
            {data?.started_at && (
              <span>{t(duration(data.started_at, data.completed_at, now))}</span>
            )}
            <span>{t(connection)}</span>
          </p>
        </div>
        <div className="workflow-actions">
          {canWrite && data && ['queued', 'running', 'canceling'].includes(data.status) && (
            <button
              className="button secondary"
              disabled={busy || data.status === 'canceling'}
              onClick={() => action('cancel')}
            >
              {data.status === 'canceling' ? t('Stopping…') : t('Stop')}
            </button>
          )}
          {canWrite && data && ['failed', 'canceled'].includes(data.status) && (
            <>
              {retryAI && (
                <button
                  className="text-button"
                  disabled={busy}
                  aria-expanded={changeModel}
                  onClick={() => setChangeModel((value) => !value)}
                >
                  {t(changeModel ? 'Keep original model' : 'Change provider or model')}
                </button>
              )}
              <button
                className="button secondary"
                disabled={busy || (changeModel && (retryLoading || !retryChoice?.model))}
                onClick={() => action('retry')}
              >
                {busy
                  ? t('Retrying…')
                  : t(changeModel ? 'Retry with this model' : 'Retry unfinished steps')}
              </button>
            </>
          )}
        </div>
      </div>
      {retryAI && changeModel && data && ['failed', 'canceled'].includes(data.status) && (
        <div className="workflow-retry-options" hidden={!canWrite}>
          <p className="note">
            {t(
              'Changing the provider, model or connection reruns the AI steps using the saved app context and sources. The previous attempt is kept. Your AI limits still apply.',
            )}
          </p>
          <AIOptions
            workspaceId={workspaceId}
            owner={retryAI.owner}
            disabled={busy || !canWrite}
            initialChoice={retryAI.choice}
            emptyLabel="Choose a provider"
            moduleContext={retryAI.moduleContext}
            capability={retryAI.capability}
            onChange={(choice, loading) => {
              setRetryChoice(choice);
              setRetryLoading(loading);
            }}
          />
        </div>
      )}
      {data?.ai_usage && data.ai_usage.calls > 0 && (
        <p className="workflow-usage">
          {t('AI usage')}: {count(data.ai_usage.tokens)} {t('tokens')} ·{' '}
          {money(data.ai_usage.cost_usd)} {t('estimated')}
          {data.ai_usage.pending + data.ai_usage.unknown > 0 && (
            <>
              {' '}
              · {money(data.ai_usage.reserved_usd)} {t('reserved')}
            </>
          )}
          {data.ai_usage.unpriced + data.ai_usage.unknown > 0 && <> · {t('Partial')}</>}
        </p>
      )}
      {data && (
        <ol className="workflow-steps" aria-label={t('Workflow steps')}>
          {data.steps.map((item) => (
            <li key={item.key}>
              <button
                className={`workflow-node ${item.status}`}
                aria-pressed={selected === item.key}
                onClick={() => setSelected(selected === item.key ? null : item.key)}
              >
                <span className="workflow-node-title">
                  <span className="workflow-symbol" aria-hidden="true">
                    {item.status === 'succeeded'
                      ? '✓'
                      : item.status === 'failed'
                        ? '!'
                        : item.status === 'running'
                          ? '◉'
                          : '○'}
                  </span>
                  {t(item.title)}
                </span>
                <span className="workflow-node-meta">
                  {t(labels[item.status])}
                  {item.reused_from_id
                    ? t(' · Reused')
                    : item.started_at
                      ? ` · ${duration(item.started_at, item.completed_at, now)}`
                      : ''}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      {connectionError && (
        <div>
          <p className="error" role="alert">
            {t(connectionError)}
          </p>
          <p className="note">
            {t(
              'Activity updates are unavailable. The task may still be running on the server. Reload its status before starting another task.',
            )}
          </p>
          <button className="button secondary" onClick={() => setReload((value) => value + 1)}>
            {t('Retry loading activity')}
          </button>
        </div>
      )}
      {showError && data?.error && (
        <p className="error" role="alert">
          {t(data.error)}
        </p>
      )}
      {data &&
        ['failed', 'canceled'].includes(data.status) &&
        !retryAI &&
        data.steps.some((item) => item.kind === 'ai') && (
          <p className="note">
            {t(
              'Retry keeps the original app, model and AI connection. After replacing an API key or choosing another model, start a new task in this module. Saved results remain available.',
            )}
          </p>
        )}
      {data && (
        <details
          className="workflow-journal"
          open={!!pending || !!selected || data.status === 'failed'}
        >
          <summary>
            {t(step ? step.title : t('Activity'))}{' '}
            <span>
              {visibleEvents.length}
              {t(' events')}
            </span>
          </summary>
          {step && (
            <p className="workflow-step-summary">
              {t(step.summary) ||
                (data.status === 'queued' || !step.depends_on.length
                  ? t('Waiting for a worker.')
                  : t('Waiting for previous steps.'))}
            </p>
          )}
          <ol
            className="workflow-events"
            aria-label={t('Activity events')}
            aria-live="polite"
            aria-relevant="additions"
          >
            {visibleEvents.map((event) => (
              <li key={event.sequence}>
                <time dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleTimeString(getLocale(), { hour12: false })}
                </time>
                <span>{t(event.message)}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
