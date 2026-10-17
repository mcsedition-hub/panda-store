import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, download, moduleUrl } from '../../../web/src/api';
import type { Creative, ModuleProps } from '../../../web/src/contracts';

export interface Scene {
  id: string;
  title: string;
  visual: string;
  voiceover: string;
  caption: string;
  duration: number;
  asset_id: string | null;
}
export interface Storyboard {
  id: string;
  creative_id: string;
  version: number;
  source: { angle: string; hook: string; script: string; cta: string };
  script_changed: boolean;
  scenes: Scene[];
  updated_at: string;
}
interface Asset {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  locale: string;
}
interface Candidate {
  snapshot_id: string;
  position: number;
  name: string;
  preview_url: string;
  asset_id: string | null;
}
interface Library {
  assets: Asset[];
  candidates: Candidate[];
}
type Props = Pick<
  ModuleProps,
  'workspace' | 'selectedApp' | 'registerLeaveGuard' | 'previewMode'
> & {
  creativeId: string;
  currentScript?: Creative;
  active: boolean;
};
const equal = (a: Scene[], b: Scene[]) => JSON.stringify(a) === JSON.stringify(b);
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function Editor({
  initial,
  workspace,
  selectedApp,
  registerLeaveGuard,
  previewMode,
  active,
  currentScript,
}: Props & { initial: Storyboard }) {
  const [saved, setSaved] = useState(initial);
  const [scenes, setScenes] = useState(initial.scenes);
  const [selected, setSelected] = useState(initial.scenes[0].id);
  const [library, setLibrary] = useState<Library>({ assets: [], candidates: [] });
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState('');
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [exportVersion, setExportVersion] = useState(initial.version);
  const alive = useRef(true);
  const savedRef = useRef(saved);
  const localRef = useRef(scenes);
  const conflictRef = useRef(false);
  const importingRef = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const pending = useRef<{ request_id: string; version: number; scenes: Scene[] } | null>(null);
  const canWrite = workspace.role !== 'viewer' && !previewMode;
  const frozen = !canWrite || busy || uncertain || conflict || importing;
  const dirty = !equal(scenes, saved.scenes);
  const scriptChanged = currentScript
    ? (['angle', 'hook', 'script', 'cta'] as const).some(
        (field) => currentScript[field] !== saved.source[field],
      )
    : saved.script_changed;
  const endpoint = moduleUrl(workspace.id, 'studio', `storyboards/${initial.id}/`);
  const assetEndpoint = moduleUrl(workspace.id, 'studio', `apps/${selectedApp!.id}/scene-assets/`);
  const total = scenes.reduce((sum, row) => sum + row.duration, 0);
  const current = scenes.find((row) => row.id === selected) ?? scenes[0];
  let boundary = 0;
  const preview =
    scenes.find((row) => {
      boundary += row.duration;
      return elapsed < boundary;
    }) ?? scenes[scenes.length - 1];
  const asset = library.assets.find((item) => item.id === preview.asset_id);
  useEffect(() => {
    setSelected(preview.id);
  }, [preview.id]);

  const accept = useCallback((next: Storyboard) => {
    savedRef.current = next;
    localRef.current = next.scenes;
    if (alive.current) {
      setSaved(next);
      setScenes(next.scenes);
      setExportVersion(next.version);
      setUncertain(false);
      setConflict(false);
      conflictRef.current = false;
    }
  }, []);
  const save = useCallback(async (): Promise<boolean> => {
    if (importingRef.current) {
      setError('Wait for the screenshot import to finish before leaving.');
      return false;
    }
    if (inFlight.current) return inFlight.current;
    if (conflictRef.current) return false;
    if (!pending.current && equal(localRef.current, savedRef.current.scenes)) return true;
    if (!canWrite) return false;
    const payload = pending.current ?? {
      request_id: crypto.randomUUID(),
      version: savedRef.current.version,
      scenes: localRef.current,
    };
    pending.current = payload;
    setBusy(true);
    setError('');
    const promise = (async () => {
      try {
        const next = await api<Storyboard>(endpoint, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          feedback: { success: 'Storyboard saved.' },
        });
        pending.current = null;
        accept(next);
        return true;
      } catch (err) {
        const unknown = err instanceof ApiError && (err.status === 0 || err.status >= 500);
        if (!unknown) pending.current = null;
        if (err instanceof ApiError && err.status === 409) conflictRef.current = true;
        if (alive.current) {
          setError((err as Error).message);
          setUncertain(unknown);
          setConflict(conflictRef.current);
        }
        return false;
      } finally {
        inFlight.current = null;
        if (alive.current) setBusy(false);
      }
    })();
    inFlight.current = promise;
    return promise;
  }, [accept, canWrite, endpoint]);
  useEffect(() => {
    alive.current = true;
    const release = registerLeaveGuard?.(save);
    const unload = (event: BeforeUnloadEvent) => {
      if (pending.current || !equal(localRef.current, savedRef.current.scenes)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      alive.current = false;
      release?.();
      window.removeEventListener('beforeunload', unload);
    };
  }, [registerLeaveGuard, save]);
  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError('');
    try {
      const next = await api<Library>(assetEndpoint);
      if (alive.current) setLibrary(next);
    } catch (err) {
      if (alive.current) setLibraryError((err as Error).message);
    } finally {
      if (alive.current) setLibraryLoading(false);
    }
  }, [assetEndpoint]);
  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  useEffect(() => {
    if (!playing || !active) return;
    const start = performance.now() - elapsed * 1000;
    const timer = setInterval(() => {
      const next = Math.min(total, (performance.now() - start) / 1000);
      setElapsed(next);
      if (next >= total) setPlaying(false);
    }, 100);
    return () => clearInterval(timer);
    // elapsed is captured when playback starts; updating it must not restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, active, total]);
  function update(next: Scene[]) {
    localRef.current = next;
    setScenes(next);
    setPlaying(false);
    setElapsed(Math.min(elapsed, Math.max(0, next.reduce((n, row) => n + row.duration, 0) - 0.01)));
  }
  function edit(patch: Partial<Scene>) {
    update(scenes.map((row) => (row.id === current.id ? { ...row, ...patch } : row)));
  }
  function choose(id: string) {
    setSelected(id);
    setPlaying(false);
    const index = scenes.findIndex((row) => row.id === id);
    setElapsed(scenes.slice(0, index).reduce((sum, row) => sum + row.duration, 0));
  }
  function move(offset: number) {
    const next = [...scenes];
    const index = next.findIndex((row) => row.id === current.id);
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update(next);
    setElapsed(next.slice(0, index + offset).reduce((n, row) => n + row.duration, 0));
  }
  async function importAsset(candidate: Candidate) {
    if (candidate.asset_id) {
      edit({ asset_id: candidate.asset_id });
      return;
    }
    const sceneId = current.id;
    importingRef.current = true;
    setImporting(true);
    setLibraryError('');
    try {
      const next = await api<Asset>(assetEndpoint, {
        method: 'POST',
        body: JSON.stringify({ snapshot_id: candidate.snapshot_id, position: candidate.position }),
        feedback: { success: 'App screenshot added.' },
      });
      if (!alive.current) return;
      setLibrary((old) => ({
        assets: [...old.assets.filter((item) => item.id !== next.id), next],
        candidates: old.candidates.map((item) =>
          item.snapshot_id === candidate.snapshot_id && item.position === candidate.position
            ? { ...item, asset_id: next.id }
            : item,
        ),
      }));
      update(
        localRef.current.map((row) => (row.id === sceneId ? { ...row, asset_id: next.id } : row)),
      );
    } catch (err) {
      if (alive.current) setLibraryError((err as Error).message);
    } finally {
      importingRef.current = false;
      if (alive.current) setImporting(false);
    }
  }
  async function reload() {
    setBusy(true);
    try {
      accept(await api<Storyboard>(endpoint));
      pending.current = null;
      setError('');
      setElapsed(0);
      setPlaying(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportBoard() {
    if (exportVersion === saved.version && !(await save())) return;
    const version = exportVersion === saved.version ? savedRef.current.version : exportVersion;
    try {
      await download(`${endpoint}export/?version=${version}`, `storyboard-v${version}.zip`);
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    }
  }
  return (
    <section className="storyboard">
      <div className="storyboard-toolbar">
        <div>
          <h2>{saved.source.angle}</h2>
          <p className="note">
            {scenes.length} shots · {total}s ·{' '}
            {dirty ? 'Unsaved changes' : `Saved · v${saved.version}`}
          </p>
        </div>
        <button
          className="button primary"
          disabled={!canWrite || busy || importing || conflict || (!dirty && !uncertain)}
          onClick={() => save()}
        >
          {busy ? 'Saving…' : uncertain ? 'Retry save' : 'Save storyboard'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <button className="text-button" disabled={busy} onClick={reload}>
          Discard local edits and reload saved version
        </button>
      )}
      {uncertain && (
        <p className="notice">The save could not be confirmed. Retry the same save to check it.</p>
      )}
      {scriptChanged && (
        <p className="notice">
          The script has changed since this storyboard was created. Your scenes are preserved;
          review the updated script in Scripts before changing them.
        </p>
      )}
      <div className="scene-strip" aria-label="Storyboard shots">
        {scenes.map((row, index) => {
          const image = library.assets.find((item) => item.id === row.asset_id);
          const start = scenes.slice(0, index).reduce((n, item) => n + item.duration, 0);
          return (
            <button
              key={row.id}
              className={current.id === row.id ? 'selected' : ''}
              aria-pressed={current.id === row.id}
              onClick={() => choose(row.id)}
            >
              <span className="scene-thumb">
                {image ? <img src={image.url} alt="" /> : <span>{row.title}</span>}
              </span>
              <strong>{row.title}</strong>
              <span>
                {clock(start)} · {row.duration}s
              </span>
            </button>
          );
        })}
        {canWrite && (
          <button
            className="scene-add"
            disabled={frozen || scenes.length >= 20}
            onClick={() => {
              const next: Scene = {
                id: crypto.randomUUID(),
                title: 'New shot',
                visual: '',
                voiceover: '',
                caption: '',
                duration: 5,
                asset_id: null,
              };
              update([...scenes, next]);
              setSelected(next.id);
              setElapsed(total);
            }}
          >
            + Add shot
          </button>
        )}
      </div>
      <div className="scene-workbench">
        <div className="scene-fields">
          <fieldset disabled={frozen}>
            <div className="scene-field-pair">
              <label>
                Shot name
                <input
                  maxLength={80}
                  value={current.title}
                  onChange={(event) => edit({ title: event.target.value })}
                />
              </label>
              <label>
                Duration (seconds)
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={current.duration}
                  onChange={(event) =>
                    edit({
                      duration: Math.max(
                        1,
                        Math.min(120, Math.round(Number(event.target.value) || 1)),
                      ),
                    })
                  }
                />
              </label>
            </div>
            <label>
              Visual direction
              <textarea
                rows={3}
                maxLength={1500}
                value={current.visual}
                onChange={(event) => edit({ visual: event.target.value })}
              />
            </label>
            <label>
              Voiceover
              <textarea
                rows={3}
                maxLength={6000}
                value={current.voiceover}
                onChange={(event) => edit({ voiceover: event.target.value })}
              />
            </label>
            <label>
              On-screen text
              <textarea
                rows={2}
                maxLength={500}
                value={current.caption}
                onChange={(event) => edit({ caption: event.target.value })}
              />
            </label>
            <div className="scene-order">
              <button
                className="text-button"
                disabled={frozen || scenes[0].id === current.id}
                onClick={() => move(-1)}
              >
                Move earlier
              </button>
              <button
                className="text-button"
                disabled={frozen || scenes[scenes.length - 1].id === current.id}
                onClick={() => move(1)}
              >
                Move later
              </button>
              <button
                className="text-button"
                disabled={frozen || scenes.length === 1}
                onClick={() => {
                  const next = scenes.filter((row) => row.id !== current.id);
                  update(next);
                  setSelected(next[0].id);
                  setElapsed(0);
                }}
              >
                Remove shot
              </button>
            </div>
          </fieldset>
          <section className="scene-library" aria-label="App visuals">
            <div className="storyboard-toolbar">
              <h3>App visuals</h3>
              {current.asset_id && (
                <button
                  className="text-button"
                  disabled={frozen}
                  onClick={() => edit({ asset_id: null })}
                >
                  Remove visual
                </button>
              )}
            </div>
            <p className="note">
              Store screenshots. Select a reference for this shot; record the app separately when
              movement is needed.
            </p>
            {libraryLoading && <p role="status">Loading app visuals…</p>}
            {importing && <p role="status">Importing screenshot…</p>}
            {libraryError && (
              <p className="error" role="alert">
                {libraryError}
              </p>
            )}
            {libraryError && (
              <button className="text-button" onClick={loadLibrary}>
                Reload visuals
              </button>
            )}
            {!libraryLoading &&
              !libraryError &&
              !library.candidates.length &&
              !library.assets.length && (
                <p className="note">
                  No supported store screenshots imported. Refresh the app connection or keep this
                  shot as a recording to prepare.
                </p>
              )}
            <div className="scene-assets">
              {library.candidates.map((item) => {
                const local = library.assets.find((a) => a.id === item.asset_id);
                return (
                  <button
                    key={`${item.snapshot_id}:${item.position}`}
                    disabled={frozen}
                    aria-label={`Use ${item.name}`}
                    aria-pressed={!!item.asset_id && current.asset_id === item.asset_id}
                    onClick={() => importAsset(item)}
                  >
                    <img
                      src={local?.url ?? item.preview_url}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      alt={item.name}
                    />
                    <span>{item.name}</span>
                  </button>
                );
              })}
              {library.assets
                .filter(
                  (item) => !library.candidates.some((candidate) => candidate.asset_id === item.id),
                )
                .map((item) => (
                  <button
                    key={item.id}
                    disabled={frozen}
                    aria-label={`Use ${item.name}`}
                    aria-pressed={current.asset_id === item.id}
                    onClick={() => edit({ asset_id: item.id })}
                  >
                    <img src={item.url} alt={item.name} />
                    <span>{item.name}</span>
                  </button>
                ))}
            </div>
          </section>
        </div>
        <aside className="scene-preview" aria-label="Storyboard preview">
          <div className="scene-preview-heading">
            <h3>Preview</h3>
            <span>9:16 · Stills</span>
          </div>
          <div className="scene-stage">
            {asset ? (
              <img src={asset.url} alt={asset.name} />
            ) : (
              <div className="scene-placeholder">
                <span>Visual to prepare</span>
                <p>{preview.visual || preview.title}</p>
              </div>
            )}
            {preview.caption && <p className="scene-caption">{preview.caption}</p>}
          </div>
          <div className="scene-playback">
            <button
              className="button secondary"
              onClick={() => {
                if (elapsed >= total) setElapsed(0);
                setPlaying(!playing);
              }}
            >
              {playing ? 'Pause' : 'Play preview'}
            </button>
            <span>
              {clock(elapsed)} / {clock(total)}
            </span>
          </div>
          <input
            aria-label="Preview position"
            type="range"
            min={0}
            max={total}
            step={0.1}
            value={elapsed}
            onChange={(event) => {
              setPlaying(false);
              setElapsed(Number(event.target.value));
            }}
          />
          <p className="scene-voiceover">{preview.voiceover}</p>
          <p className="note">
            Silent preview. Durations are starting estimates; check them with the recorded
            voiceover.
          </p>
        </aside>
      </div>
      <footer className="scene-export">
        <div>
          <h3>Editing package</h3>
          <p className="note">
            Shot list, timings, script and selected images. ZIP · no video or audio yet.
          </p>
        </div>
        <label>
          Saved version
          <select
            value={exportVersion}
            onChange={(event) => setExportVersion(Number(event.target.value))}
          >
            {Array.from({ length: Math.min(saved.version, 100) }, (_, i) => saved.version - i).map(
              (version) => (
                <option key={version} value={version}>
                  v{version}
                </option>
              ),
            )}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={busy || importing || uncertain || conflict || (dirty && !canWrite)}
          onClick={exportBoard}
        >
          {dirty && exportVersion === saved.version ? 'Save & export' : 'Export package'}
        </button>
      </footer>
      <details className="script-context">
        <summary>Source script</summary>
        <p>{saved.source.hook}</p>
        <pre>{saved.source.script}</pre>
        <p>{saved.source.cta}</p>
      </details>
    </section>
  );
}

export default function Scenes(props: Props) {
  const [board, setBoard] = useState<Storyboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const endpoint = moduleUrl(
    props.workspace.id,
    'studio',
    `creatives/${props.creativeId}/storyboard/`,
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await api<{ storyboard: Storyboard | null }>(endpoint);
      if (alive.current) setBoard(next.storyboard);
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [endpoint]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  async function create() {
    setBusy(true);
    setError('');
    try {
      const next = await api<Storyboard>(endpoint, {
        method: 'POST',
        body: '{}',
        feedback: { success: 'Storyboard ready to edit.' },
      });
      if (alive.current) setBoard(next);
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (loading) return <p role="status">Loading storyboard…</p>;
  if (board) return <Editor {...props} initial={board} />;
  return (
    <section className="storyboard-empty">
      <h2>Plan the shots</h2>
      <p>Start from the saved script, then choose visuals and adjust the timing.</p>
      {error && (
        <>
          <p className="error" role="alert">
            {error}
          </p>
          <button className="text-button" onClick={load}>
            Reload storyboard
          </button>
        </>
      )}
      <button
        className="button primary"
        disabled={props.workspace.role === 'viewer' || props.previewMode || busy}
        onClick={create}
      >
        {busy ? 'Preparing…' : 'Create storyboard'}
      </button>
      <p className="note">
        No AI call. Existing scene labels are preserved; other scripts start as one editable shot,
        with an opening and closing.
      </p>
    </section>
  );
}
