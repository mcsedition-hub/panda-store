import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, download, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';
import { SourceReference, type Source } from './Sources';
import { when } from './draftTypes';

const fields = [
  ['change', 'Change to test', 5],
  ['screen', 'Screen or state to capture', 3],
  ['caption', 'Caption (optional)', 2],
  ['test_plan', 'Test hypothesis (optional)', 3],
] as const;
type Content = Record<(typeof fields)[number][0], string>;
interface Summary {
  id: string;
  name: string;
  locale: string;
  status: 'draft' | 'ready';
  version: number;
  updated_at: string;
}
export interface ScreenshotBrief extends Summary {
  content: Content;
  reference_url: string | null;
  can_mark_ready: boolean;
  source: {
    audit_id: string;
    imported_at: string;
    model: string;
    finding: {
      name: string;
      observation: string;
      recommendation: string;
      visible_text: string;
      sources: Source[];
    };
    listing: Record<string, string>;
  };
}
interface Revision {
  version: number;
  name: string;
  content: Content;
  status: string;
  reason: string;
  author: string;
  created_at: string;
}
type Local = { name: string; content: Content };
const editable = (brief: ScreenshotBrief): Local => ({ name: brief.name, content: brief.content });
const equal = (a: Local, b: Local) =>
  a.name === b.name && fields.every(([key]) => a.content[key] === b.content[key]);

function Editor({
  initial,
  workspace,
  previewMode,
  registerLeaveGuard,
  onBack,
  onSaved,
  onDuplicate,
}: ModuleProps & {
  initial: ScreenshotBrief;
  onBack: () => void;
  onSaved: (brief: ScreenshotBrief) => void;
  onDuplicate: (brief: ScreenshotBrief) => Promise<void>;
}) {
  const [saved, setSaved] = useState(initial);
  const [local, setLocal] = useState(() => editable(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState<Revision[] | null>(null);
  const alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const savedRef = useRef(saved);
  const localRef = useRef(local);
  const conflictRef = useRef(false);
  const callback = useRef(onSaved);
  callback.current = onSaved;
  const inFlight = useRef<Promise<boolean> | null>(null);
  const pending = useRef<{
    request_id: string;
    version: number;
    name: string;
    content: Content;
  } | null>(null);
  const canWrite = workspace.role !== 'viewer' && !previewMode;
  const dirty = !equal(local, editable(saved));
  const endpoint = moduleUrl(workspace.id, 'aso', `screenshot-briefs/${initial.id}/`);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const accept = useCallback((next: ScreenshotBrief, replace = true) => {
    savedRef.current = next;
    if (replace) localRef.current = editable(next);
    if (alive.current) {
      setSaved(next);
      if (replace) setLocal(editable(next));
      setHistory(null);
      setConfirmed(false);
      callback.current(next);
    }
  }, []);
  const failed = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      conflictRef.current = true;
      if (alive.current) setConflict(true);
    }
    if (alive.current) setError((err as Error).message);
  }, []);
  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (conflictRef.current) return false;
    if (!pending.current && equal(localRef.current, editable(savedRef.current))) return true;
    if (!canWrite) return false;
    if (!localRef.current.name.trim()) {
      setError('Give this brief a name before saving.');
      return false;
    }
    const payload = pending.current ?? {
      request_id: crypto.randomUUID(),
      version: savedRef.current.version,
      name: localRef.current.name,
      content: { ...localRef.current.content },
    };
    pending.current = payload;
    setBusy(true);
    setError('');
    const promise = (async () => {
      try {
        const next = await api<ScreenshotBrief>(endpoint, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          feedback: { success: 'Screenshot brief saved.' },
        });
        pending.current = null;
        accept(next, equal(localRef.current, { name: payload.name, content: payload.content }));
        return true;
      } catch (err) {
        failed(err);
        return false;
      } finally {
        inFlight.current = null;
        if (alive.current) setBusy(false);
      }
    })();
    inFlight.current = promise;
    const ok = await promise;
    return ok && !equal(localRef.current, editable(savedRef.current)) ? save() : ok;
  }, [accept, canWrite, endpoint, failed]);
  useEffect(() => {
    alive.current = true;
    const release = registerLeaveGuard?.(save);
    const unload = (event: BeforeUnloadEvent) => {
      if (
        inFlight.current ||
        pending.current ||
        !equal(localRef.current, editable(savedRef.current))
      ) {
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
  function update(next: Local) {
    localRef.current = next;
    setLocal(next);
    setConfirmed(false);
    if (!conflictRef.current && !pending.current) setError('');
  }
  async function mutate(changes: Record<string, unknown>, success: string) {
    if (!(await save())) return;
    setBusy(true);
    setError('');
    try {
      accept(
        await api<ScreenshotBrief>(endpoint, {
          method: 'PATCH',
          feedback: { success },
          body: JSON.stringify({
            request_id: crypto.randomUUID(),
            version: savedRef.current.version,
            ...changes,
          }),
        }),
      );
    } catch (err) {
      failed(err);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function exportBrief() {
    if (!(await save())) return;
    setBusy(true);
    try {
      await download(
        `${endpoint}export/?version=${savedRef.current.version}`,
        `screenshot-brief-v${savedRef.current.version}.zip`,
      );
    } catch (err) {
      failed(err);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="screenshot-brief-editor" aria-label="Screenshot brief">
      <div className="heading-split">
        <button
          className="text-button"
          disabled={busy}
          onClick={async () => {
            if (await save()) onBack();
          }}
        >
          ← Screenshot briefs
        </button>
        <span className="pill">
          {dirty ? 'Unsaved changes' : saved.status === 'ready' ? 'Ready for design' : 'Draft'}
        </span>
      </div>
      <h2 ref={heading} tabIndex={-1}>
        {saved.name}
      </h2>
      <p className="note">
        {saved.locale} · Revision {saved.version} · {when(saved.updated_at)}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="notice">
          <p>Your changes are kept here. Compare the saved version before continuing.</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setHistory(await api<Revision[]>(`${endpoint}history/`));
              } catch (err) {
                failed(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Compare saved version
          </button>{' '}
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const next = await api<ScreenshotBrief>(endpoint);
                accept(next);
                pending.current = null;
                conflictRef.current = false;
                setConflict(false);
                setError('');
              } catch (err) {
                failed(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Discard local edits and reload
          </button>
        </div>
      )}
      <div className="screenshot-brief-columns">
        <aside className="screenshot-brief-reference">
          <h3>Reference</h3>
          {saved.reference_url ? (
            <a href={saved.reference_url} target="_blank" rel="noreferrer">
              <img
                src={saved.reference_url}
                alt={`Reference screenshot: ${saved.source.finding.name}`}
              />
            </a>
          ) : (
            <p className="notice">The reference image is no longer available.</p>
          )}
          <p className="note">
            {saved.source.finding.name} · Imported {when(saved.source.imported_at)}
          </p>
          <details>
            <summary>Audit observation</summary>
            <p>{saved.source.finding.observation}</p>
            <p>{saved.source.finding.recommendation}</p>
            <p className="note">
              {saved.source.model} · AI suggestion, reviewed against the saved images.
            </p>
          </details>
          <details>
            <summary>Imported listing</summary>
            {Object.entries(saved.source.listing).map(([key, value]) => (
              <div key={key}>
                <strong>{key.replaceAll('_', ' ')}</strong>
                <p>{value}</p>
              </div>
            ))}
          </details>
          <details>
            <summary>Sources</summary>
            {saved.source.finding.sources.map((source) => (
              <SourceReference key={source.id} source={source} />
            ))}
          </details>
        </aside>
        <div className="screenshot-brief-form">
          <label>
            Brief name
            <input
              value={local.name}
              maxLength={120}
              disabled={!canWrite || busy}
              onChange={(e) => update({ ...local, name: e.target.value })}
            />
          </label>
          {fields.map(([key, label, rows]) => (
            <label key={key}>
              {label}
              <textarea
                rows={rows}
                maxLength={4000}
                value={local.content[key]}
                disabled={!canWrite || busy}
                onChange={(e) =>
                  update({ ...local, content: { ...local.content, [key]: e.target.value } })
                }
              />
            </label>
          ))}
          <div className="action-group">
            <button
              className="button primary"
              disabled={!canWrite || busy || conflict || !dirty}
              onClick={() => void save()}
            >
              Save brief
            </button>
            <button
              className="button secondary"
              disabled={busy || conflict}
              onClick={() => void exportBrief()}
            >
              Export brief
            </button>
            <button
              className="text-button"
              disabled={!canWrite || busy || conflict}
              onClick={async () => {
                if (!(await save())) return;
                setBusy(true);
                try {
                  await onDuplicate(savedRef.current);
                } catch (err) {
                  failed(err);
                } finally {
                  if (alive.current) setBusy(false);
                }
              }}
            >
              Duplicate
            </button>
          </div>
          <div className="screenshot-brief-ready">
            {saved.status === 'ready' && !dirty ? (
              <>
                <p>Ready for design · Product claims were confirmed by a workspace member.</p>
                <button
                  className="text-button"
                  disabled={!canWrite || busy || conflict}
                  onClick={() => void mutate({ status: 'draft' }, 'Brief returned to draft.')}
                >
                  Return to draft
                </button>
              </>
            ) : (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={!canWrite || busy || dirty || conflict}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I checked the proposed claims against the app.
                </label>
                <button
                  className="button secondary"
                  disabled={
                    !canWrite || busy || dirty || conflict || !confirmed || !saved.can_mark_ready
                  }
                  onClick={() =>
                    void mutate(
                      { status: 'ready', claims_confirmed: true },
                      'Brief marked ready for design.',
                    )
                  }
                >
                  Mark ready for design
                </button>
                {!saved.can_mark_ready && (
                  <p className="note">Describe the change and the screen to capture, then save.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <button
        className="text-button"
        disabled={busy}
        onClick={async () => {
          if (history) {
            setHistory(null);
            return;
          }
          setBusy(true);
          try {
            setHistory(await api<Revision[]>(`${endpoint}history/`));
          } catch (err) {
            failed(err);
          } finally {
            if (alive.current) setBusy(false);
          }
        }}
      >
        {history ? 'Hide history' : 'Revision history'}
      </button>
      {history && (
        <div className="screenshot-brief-history">
          {history.map((item) => (
            <details key={item.version}>
              <summary>
                Revision {item.version} · {item.reason} · {when(item.created_at)}
              </summary>
              <p className="note">
                {item.author} · {item.status === 'ready' ? 'Ready for design' : 'Draft'}
              </p>
              <strong>{item.name}</strong>
              {fields.map(([key, label]) => (
                <div key={key}>
                  <strong>{label}</strong>
                  <p>{item.content[key] || 'Not specified.'}</p>
                </div>
              ))}
              <button
                className="button secondary"
                disabled={!canWrite || busy || conflict || item.version === saved.version}
                onClick={() =>
                  void mutate({ restore_version: item.version }, 'Revision restored as a draft.')
                }
              >
                Restore revision {item.version}
              </button>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ScreenshotBriefs(
  props: ModuleProps & { app: MobileApp; initial?: ScreenshotBrief | null },
) {
  const { app, workspace, initial } = props;
  const [items, setItems] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<ScreenshotBrief | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const duplicateRequest = useRef<{ key: string; id: string } | null>(null);
  const base = moduleUrl(workspace.id, 'aso', `apps/${app.id}/screenshot-briefs/`);
  useEffect(() => {
    alive.current = true;
    api<Summary[]>(base)
      .then((next) => {
        if (alive.current) setItems(next);
      })
      .catch((err) => {
        if (alive.current) setError(err.message);
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [base]);
  function remember(brief: ScreenshotBrief) {
    setItems((old) => [brief, ...old.filter((item) => item.id !== brief.id)]);
  }
  if (selected)
    return (
      <Editor
        key={selected.id}
        {...props}
        initial={selected}
        onSaved={remember}
        onBack={() => setSelected(null)}
        onDuplicate={async (brief) => {
          const key = `${brief.id}:${brief.version}`;
          if (duplicateRequest.current?.key !== key)
            duplicateRequest.current = { key, id: crypto.randomUUID() };
          const next = await api<ScreenshotBrief>(base, {
            method: 'POST',
            feedback: { success: 'Screenshot brief duplicated.' },
            body: JSON.stringify({
              request_id: duplicateRequest.current.id,
              duplicate_id: brief.id,
              version: brief.version,
              name: `${brief.name} — copy`.slice(0, 120),
            }),
          });
          if (alive.current) {
            duplicateRequest.current = null;
            remember(next);
            setSelected(next);
          }
        }}
      />
    );
  return (
    <section aria-label="Screenshot briefs">
      <h2>Screenshot briefs</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading briefs…</p>
      ) : !items.length ? (
        <p className="note">Create a brief from a screenshot recommendation in Audit.</p>
      ) : (
        <div className="draft-list">
          {items.map((item) => (
            <button
              className="draft-list-item"
              key={item.id}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const next = await api<ScreenshotBrief>(
                    moduleUrl(workspace.id, 'aso', `screenshot-briefs/${item.id}/`),
                  );
                  if (alive.current) setSelected(next);
                } catch (err) {
                  if (alive.current) setError((err as Error).message);
                } finally {
                  if (alive.current) setBusy(false);
                }
              }}
            >
              <strong>{item.name}</strong>
              <span>
                {item.locale} · {item.status === 'ready' ? 'Ready for design' : 'Draft'} ·{' '}
                {when(item.updated_at)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
