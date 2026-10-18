import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, download, moduleUrl } from '../../../web/src/api';
import VideoExports from './VideoExports';
import type { Creative, ModuleProps } from '../../../web/src/contracts';

export interface Scene {
  id: string;
  title: string;
  visual: string;
  voiceover: string;
  caption: string;
  duration: number;
  asset_id: string | null;
  audio_asset_id?: string | null;
  video_start?: number;
  audio_start?: number;
  original_audio?: boolean;
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
  kind?: string;
  duration?: number;
  has_audio?: boolean;
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

function VideoFrame({
  asset,
  elapsed,
  start,
  playing,
}: {
  asset: Asset;
  elapsed: number;
  start: number;
  playing: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const target = start + elapsed;
    if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.3)
      video.currentTime = target;
    if (playing) void video.play().catch(() => {});
    else video.pause();
  }, [elapsed, start, playing, asset.id]);
  return (
    <video
      ref={ref}
      src={asset.url}
      muted
      playsInline
      preload="metadata"
      aria-label={asset.name}
      onLoadedMetadata={() => {
        if (ref.current) ref.current.currentTime = start + elapsed;
      }}
    />
  );
}

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
  const audioPreview = useRef<HTMLAudioElement>(null);
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
  const selectedVisual = library.assets.find((item) => item.id === current.asset_id);
  const selectedAudio = library.assets.find((item) => item.id === current.audio_asset_id);
  const audioAssets = library.assets.filter((item) => item.kind === 'audio');
  const previewStart = scenes
    .slice(
      0,
      scenes.findIndex((item) => item.id === preview.id),
    )
    .reduce((sum, item) => sum + item.duration, 0);
  useEffect(() => {
    if (!active) audioPreview.current?.pause();
  }, [active]);
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
      if (alive.current)
        setLibrary((old) => ({
          ...next,
          // An upload can finish while the initial library request is in flight.
          // Keep newly returned assets and their assignments when that older read arrives.
          assets: [
            ...new Map([...next.assets, ...old.assets].map((item) => [item.id, item])).values(),
          ],
        }));
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
  async function upload(file: File) {
    if (file.size > 25_000_000) {
      setLibraryError('Choose a file of at most 25 MB.');
      return;
    }
    importingRef.current = true;
    setImporting(true);
    setLibraryError('');
    const sceneId = current.id;
    const form = new FormData();
    form.append('file', file);
    try {
      const next = await api<Asset>(
        moduleUrl(workspace.id, 'studio', `apps/${selectedApp!.id}/media/`),
        { method: 'POST', body: form, feedback: { success: 'Media imported.' } },
      );
      if (!alive.current) return;
      setLibrary((old) => ({
        ...old,
        assets: [...old.assets.filter((item) => item.id !== next.id), next],
      }));
      update(
        localRef.current.map((row) =>
          row.id === sceneId
            ? {
                ...row,
                ...(next.kind === 'audio'
                  ? { audio_asset_id: next.id, audio_start: 0 }
                  : { asset_id: next.id, video_start: 0, original_audio: false }),
              }
            : row,
        ),
      );
    } catch (err) {
      if (alive.current) setLibraryError((err as Error).message);
    } finally {
      importingRef.current = false;
      if (alive.current) setImporting(false);
    }
  }
  async function removeAsset(item: Asset) {
    setImporting(true);
    importingRef.current = true;
    try {
      await api(moduleUrl(workspace.id, 'studio', `scene-assets/${item.id}/file/`), {
        method: 'DELETE',
        feedback: { success: 'Unused media removed.' },
      });
      if (!alive.current) return;
      setLibrary((old) => ({
        assets: old.assets.filter((asset) => asset.id !== item.id),
        candidates: old.candidates.map((candidate) =>
          candidate.asset_id === item.id ? { ...candidate, asset_id: null } : candidate,
        ),
      }));
      update(
        localRef.current.map((row) => ({
          ...row,
          asset_id: row.asset_id === item.id ? null : row.asset_id,
          audio_asset_id: row.audio_asset_id === item.id ? null : row.audio_asset_id,
        })),
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
                {image?.kind === 'video' ? (
                  <span>Recording</span>
                ) : image ? (
                  <img src={image.url} alt="" />
                ) : (
                  <span>{row.title}</span>
                )}
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
            {selectedVisual?.kind === 'video' && (
              <>
                <label>
                  Recording starts at (seconds)
                  <input
                    type="number"
                    min={0}
                    max={selectedVisual.duration}
                    step={0.1}
                    value={current.video_start ?? 0}
                    onChange={(event) =>
                      edit({ video_start: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                </label>
                <p className="note">
                  Recording: {selectedVisual.duration?.toFixed(1)}s. The shot must end within the
                  recording.
                </p>
                <label className="scene-audio-toggle">
                  <input
                    type="checkbox"
                    checked={current.original_audio ?? false}
                    disabled={frozen || !!current.audio_asset_id || !selectedVisual.has_audio}
                    onChange={(event) => edit({ original_audio: event.target.checked })}
                  />
                  Keep recording audio
                </label>
              </>
            )}
            <label>
              Voiceover recording
              <select
                value={current.audio_asset_id ?? ''}
                onChange={(event) =>
                  edit({ audio_asset_id: event.target.value || null, audio_start: 0 })
                }
              >
                <option value="">No voiceover file</option>
                {audioAssets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.duration?.toFixed(1)}s
                  </option>
                ))}
              </select>
            </label>
            {selectedAudio && (
              <>
                <label>
                  Voiceover starts at (seconds)
                  <input
                    type="number"
                    min={0}
                    max={selectedAudio.duration}
                    step={0.1}
                    value={current.audio_start ?? 0}
                    onChange={(event) =>
                      edit({ audio_start: Math.max(0, Number(event.target.value) || 0) })
                    }
                  />
                </label>
                <audio ref={audioPreview} src={selectedAudio.url} controls preload="metadata" />
                <p className="note">
                  Voiceover replaces recording audio. Audio is trimmed to the shot; shorter files
                  end in silence. Written voiceover is not synthesized.
                </p>
              </>
            )}
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
            <p className="note">Choose an image or screen recording for this shot.</p>
            <label className="media-upload">
              Upload media
              <input
                type="file"
                accept=".mp4,.mp3,.m4a,.wav,.png,.jpg,.jpeg,.webp"
                disabled={frozen}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void upload(file);
                }}
              />
              <span className="note">
                Up to 25 MB · H.264 MP4, MP3, M4A, WAV or images · Recordings up to 120s
              </span>
            </label>
            {libraryLoading && <p role="status">Loading app visuals…</p>}
            {importing && <p role="status">Importing media…</p>}
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
                  Upload a recording or image, or refresh the app connection to import store
                  screenshots.
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
                  (item) =>
                    item.kind !== 'audio' &&
                    !library.candidates.some((candidate) => candidate.asset_id === item.id),
                )
                .map((item) => (
                  <button
                    key={item.id}
                    disabled={frozen}
                    aria-label={`Use ${item.name}`}
                    aria-pressed={current.asset_id === item.id}
                    onClick={() =>
                      edit({ asset_id: item.id, video_start: 0, original_audio: false })
                    }
                  >
                    {item.kind === 'video' ? (
                      <span className="media-file-tile">
                        MP4
                        <br />
                        {item.duration?.toFixed(1)}s
                      </span>
                    ) : (
                      <img src={item.url} alt={item.name} />
                    )}
                    <span>{item.name}</span>
                  </button>
                ))}
            </div>
            {canWrite && library.assets.length > 0 && (
              <details className="media-library-manage">
                <summary>Manage library files</summary>
                <p className="note">
                  Only files unused by saved storyboard versions can be deleted.
                </p>
                {library.assets.map((item) => (
                  <div key={item.id}>
                    <span>{item.name}</span>
                    <button
                      className="text-button"
                      disabled={frozen}
                      onClick={() => removeAsset(item)}
                    >
                      Delete {item.name}
                    </button>
                  </div>
                ))}
              </details>
            )}
          </section>
        </div>
        <aside className="scene-preview" aria-label="Storyboard preview">
          <div className="scene-preview-heading">
            <h3>Preview</h3>
            <span>9:16 · Muted</span>
          </div>
          <div className="scene-stage">
            {asset?.kind === 'video' ? (
              <VideoFrame
                key={asset.id}
                asset={asset}
                start={preview.video_start ?? 0}
                elapsed={Math.max(0, elapsed - previewStart)}
                playing={playing && active}
              />
            ) : asset ? (
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
            Muted timeline preview. Check the rendered MP4 for the final sound and timing.
          </p>
        </aside>
      </div>
      <footer className="scene-export">
        <div>
          <h3>Editing package</h3>
          <p className="note">
            Shot list, timings, script and selected media. ZIP for external editing.
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
      {!previewMode && (
        <VideoExports
          workspaceId={workspace.id}
          boardId={saved.id}
          version={saved.version}
          dirty={dirty || busy || importing || uncertain || conflict}
          canWrite={canWrite}
        />
      )}
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
