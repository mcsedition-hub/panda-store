import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, download, moduleUrl } from '../../../web/src/api';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';
import type { WorkflowStatus } from '../../../web/src/workflows/types';

interface Render {
  id: string;
  version: number;
  workflow_id: string;
  status: WorkflowStatus;
  error: string;
  created_at: string;
  url: string | null;
  can_delete: boolean;
}
const terminal = (status: string) => ['succeeded', 'failed', 'canceled'].includes(status);
export default function VideoExports({
  workspaceId,
  boardId,
  version,
  dirty,
  canWrite,
}: {
  workspaceId: string;
  boardId: string;
  version: number;
  dirty: boolean;
  canWrite: boolean;
}) {
  const [renders, setRenders] = useState<Render[]>([]);
  const [selected, setSelected] = useState('');
  const [available, setAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ endpoint: string; body: string } | null>(null);
  const alive = useRef(true);
  const endpoint = moduleUrl(workspaceId, 'studio', `storyboards/${boardId}/renders/`);
  const current = renders.find((item) => item.id === selected) ?? renders[0];
  const running = renders.some((item) => !terminal(item.status));
  const load = useCallback(async () => {
    try {
      const [next, capabilities] = await Promise.all([
        api<Render[]>(endpoint),
        api<{ available: boolean }>(moduleUrl(workspaceId, 'studio', 'media-capabilities/')),
      ]);
      if (alive.current) {
        setRenders(next);
        setError('');
        setAvailable(capabilities.available);
        setLoaded(true);
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    }
  }, [endpoint, workspaceId]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  useEffect(() => {
    // The activity panel only follows the selected render. Keep any other active
    // render current while an older, completed export is being viewed.
    if (!running || !current || !terminal(current.status)) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [running, current?.status, load]);
  async function start(retry?: Render) {
    const payload = pending.current ?? {
      endpoint: retry ? moduleUrl(workspaceId, 'studio', `renders/${retry.id}/retry/`) : endpoint,
      body: JSON.stringify({ request_id: crypto.randomUUID(), version: retry?.version ?? version }),
    };
    pending.current = payload;
    setBusy(true);
    setError('');
    try {
      const next = await api<Render>(payload.endpoint, {
        method: 'POST',
        body: payload.body,
        feedback: { success: 'Video render queued.' },
      });
      if (!alive.current) return;
      pending.current = null;
      setUncertain(false);
      setSelected(next.id);
      setRenders((old) => [next, ...old.filter((item) => item.id !== next.id)]);
    } catch (err) {
      if (!alive.current) return;
      const unknown = err instanceof ApiError && (err.status === 0 || err.status >= 500);
      if (!unknown) pending.current = null;
      setUncertain(unknown);
      setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function remove() {
    if (!current) return;
    setBusy(true);
    try {
      await api(moduleUrl(workspaceId, 'studio', `renders/${current.id}/`), {
        method: 'DELETE',
        feedback: { success: 'Render files deleted.' },
      });
      if (alive.current) {
        setSelected('');
        await load();
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="video-exports" aria-label="Video exports">
      <div className="storyboard-toolbar">
        <div>
          <h3>Video</h3>
          <p className="note">MP4 · 1080 × 1920 · Up to 120 seconds</p>
        </div>
        <button
          className="button primary"
          disabled={
            !canWrite || busy || !loaded || (!uncertain && (!available || dirty || running))
          }
          onClick={() => start()}
        >
          {busy ? 'Starting…' : uncertain ? 'Check render request' : `Render MP4 · v${version}`}
        </button>
      </div>
      {dirty && <p className="note">Save storyboard changes before starting a new render.</p>}
      {loaded && !available && (
        <p className="notice">
          Install FFmpeg and ffprobe on the API and worker to enable video rendering. Docker
          includes them.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loaded && error && (
        <button className="text-button" onClick={load}>
          Reload renders
        </button>
      )}
      {uncertain && (
        <p className="notice">
          The start could not be confirmed. Check the same request before starting another render.
        </p>
      )}
      {renders.length > 0 && (
        <label className="scene-script-picker">
          Render
          <select value={current?.id ?? ''} onChange={(event) => setSelected(event.target.value)}>
            {renders.map((item) => (
              <option value={item.id} key={item.id}>
                v{item.version} · {new Date(item.created_at).toLocaleString()} · {item.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && (
        <>
          {current.version !== version && (
            <p className="note">
              This video uses saved version {current.version}. The editor is on version {version}.
            </p>
          )}
          <WorkflowPanel
            key={current.workflow_id}
            workspaceId={workspaceId}
            workflowId={current.workflow_id}
            canWrite={canWrite && !uncertain}
            onRetry={() => start(current)}
            onStatus={(status) => {
              setRenders((old) =>
                old.map((item) => (item.id === current.id ? { ...item, status } : item)),
              );
              if (terminal(status)) void load();
            }}
          />
          {current.url && (
            <>
              <video
                className="rendered-video"
                src={current.url}
                controls
                preload="metadata"
                playsInline
              />
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await download(
                      `${current.url}?download=1`,
                      `storyboard-v${current.version}.mp4`,
                    );
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                Download MP4
              </button>
            </>
          )}
          {current.can_delete && canWrite && (
            <details className="render-delete">
              <summary>Manage this render</summary>
              <p>
                Delete this export, its activity and saved shots. The storyboard and original media
                stay in your library.
              </p>
              <button className="text-button" disabled={busy || uncertain} onClick={remove}>
                Delete render files
              </button>
            </details>
          )}
        </>
      )}
    </section>
  );
}
