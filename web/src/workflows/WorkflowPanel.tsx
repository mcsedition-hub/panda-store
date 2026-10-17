import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { WorkflowSnapshot, WorkflowStatus } from './types';

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
}: {
  workspaceId: string;
  workflowId: string;
  canWrite: boolean;
  onStatus: (status: WorkflowStatus) => void;
  onRetry: () => Promise<void>;
}) {
  const [data, setData] = useState<WorkflowSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [connection, setConnection] = useState('Connecting…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
    setConnection('Connecting…');
    function accept(next: WorkflowSnapshot) {
      if (!active || blocked || next.cursor < position) return;
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
          setError((err as Error).message);
          setConnection('Unavailable');
        } else {
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
  }, [base]);

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
      if (kind === 'retry') await onRetry();
      else {
        const next = await api<WorkflowSnapshot>(base + 'cancel/', { method: 'POST' });
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
    <section className="workflow-panel" aria-label="Workflow activity">
      <div className="workflow-heading">
        <div>
          <h3>{data?.title ?? 'Workflow'}</h3>
          <p className="workflow-meta">
            <span role="status">{data ? labels[data.status] : 'Loading activity…'}</span>
            {data?.started_at && <span>{duration(data.started_at, data.completed_at, now)}</span>}
            <span>{connection}</span>
          </p>
        </div>
        <div className="workflow-actions">
          {canWrite && data && ['queued', 'running', 'canceling'].includes(data.status) && (
            <button
              className="button secondary"
              disabled={busy || data.status === 'canceling'}
              onClick={() => action('cancel')}
            >
              {data.status === 'canceling' ? 'Stopping…' : 'Stop'}
            </button>
          )}
          {canWrite && data && ['failed', 'canceled'].includes(data.status) && (
            <button className="button secondary" disabled={busy} onClick={() => action('retry')}>
              {busy ? 'Retrying…' : 'Retry unfinished steps'}
            </button>
          )}
        </div>
      </div>
      {data && (
        <ol className="workflow-steps" aria-label="Workflow steps">
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
                  {item.title}
                </span>
                <span className="workflow-node-meta">
                  {labels[item.status]}
                  {item.reused_from_id
                    ? ' · Reused'
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
          {error}
        </p>
      )}
      {data?.error && (
        <p className="error" role="alert">
          {data.error}
        </p>
      )}
      {data && (
        <details
          className="workflow-journal"
          open={!!pending || !!selected || data.status === 'failed'}
        >
          <summary>
            {step ? step.title : 'Activity'} <span>{visibleEvents.length} events</span>
          </summary>
          {step && (
            <p className="workflow-step-summary">
              {step.summary ||
                (data.status === 'queued' || !step.depends_on.length
                  ? 'Waiting for a worker.'
                  : 'Waiting for previous steps.')}
            </p>
          )}
          <ol
            className="workflow-events"
            aria-label="Activity events"
            aria-live="polite"
            aria-relevant="additions"
          >
            {visibleEvents.map((event) => (
              <li key={event.sequence}>
                <time dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleTimeString('en-US', { hour12: false })}
                </time>
                <span>{event.message}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
