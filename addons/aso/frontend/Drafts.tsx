import { useCallback, useEffect, useRef, useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';
import DraftEditor from './DraftEditor';
import { when, type Draft, type DraftSeed, type DraftSummary } from './draftTypes';

export default function Drafts(
  props: ModuleProps & { app: MobileApp; locale: string; seed: DraftSeed | null },
) {
  const { app, workspace, locale, seed, registerLeaveGuard, previewMode } = props;
  const [items, setItems] = useState<DraftSummary[]>([]);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [form, setForm] = useState(!!seed);
  const [duplicate, setDuplicate] = useState<Draft | null>(null);
  const [name, setName] = useState(seed?.name || 'Listing update');
  const [draftLocale, setDraftLocale] = useState(locale);
  const locales = app.metadata?.data.localizations?.length
    ? app.metadata.data.localizations.map((item) => item.locale)
    : app.metadata?.data.locale
      ? [app.metadata.data.locale]
      : [];
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [proposal, setProposal] = useState(seed);
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  const alive = useRef(true);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const base = moduleUrl(workspace.id, 'aso', `apps/${app.id}/drafts/`);
  const canWrite = workspace.role !== 'viewer' && !previewMode;
  const register = useCallback(
    (save: () => Promise<boolean>) => {
      guard.current = save;
      const release = registerLeaveGuard?.(save);
      return () => {
        guard.current = null;
        release?.();
      };
    },
    [registerLeaveGuard],
  );
  useEffect(() => {
    alive.current = true;
    api<DraftSummary[]>(base)
      .then((next) => {
        if (alive.current) setItems(next);
      })
      .catch((err) => {
        if (alive.current) {
          setError(err.message);
          setFailed(true);
        }
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [base]);
  function remember(draft: Draft) {
    setItems((old) => [draft, ...old.filter((item) => item.id !== draft.id)]);
    setSelected((old) => (old?.id === draft.id ? draft : old));
  }
  async function create() {
    if (!app.metadata && !duplicate && !proposal) return;
    setBusy(true);
    setError('');
    const data = {
      name,
      ...(duplicate
        ? { duplicate_id: duplicate.id, version: duplicate.version }
        : proposal
          ? { audit_id: proposal.audit_id, check_id: proposal.check_id }
          : { snapshot_id: app.metadata!.id, locale: draftLocale }),
    };
    const key = JSON.stringify(data);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    try {
      const next = await api<Draft>(base, {
        method: 'POST',
        feedback: { success: duplicate ? 'Draft duplicated.' : 'Draft created.' },
        body: JSON.stringify({ ...data, request_id: pending.current.id }),
      });
      if (!alive.current) return;
      pending.current = null;
      remember(next);
      setSelected(next);
      setForm(false);
      setDuplicate(null);
      setProposal(null);
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (selected && !form)
    return (
      <DraftEditor
        key={selected.id}
        {...props}
        initial={selected}
        registerLeaveGuard={register}
        onBack={() => setSelected(null)}
        onSaved={remember}
        onDuplicate={(draft) => {
          setDuplicate(draft);
          setName(`${draft.name} — copy`.slice(0, 120));
          setForm(true);
        }}
      />
    );
  return (
    <section className="drafts-panel" aria-label="ASO drafts">
      <div className="heading-split">
        <h2>Drafts</h2>
        <button
          className="button primary"
          disabled={!canWrite || busy || loading || failed || !app.metadata}
          onClick={() => {
            setProposal(null);
            setDuplicate(null);
            setName('Listing update');
            setForm(true);
          }}
        >
          New draft
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form
          className="draft-create"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <h3>
            {duplicate
              ? 'Duplicate draft'
              : proposal
                ? 'Draft from this proposal'
                : 'New listing draft'}
          </h3>
          <p className="note">
            {duplicate?.locale || (proposal ? locale : draftLocale)} ·{' '}
            {proposal
              ? 'Only the selected proposal will change the imported listing.'
              : 'Start from the saved text.'}
          </p>
          <label>
            Draft name
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {!duplicate && !proposal && (
            <label>
              Language
              <select
                value={draftLocale}
                disabled={busy}
                onChange={(e) => setDraftLocale(e.target.value)}
              >
                {locales.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          )}
          <div className="action-group">
            <button
              className="button primary"
              disabled={!canWrite || busy || failed || !name.trim()}
            >
              Create draft
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setForm(false);
                setProposal(null);
                setDuplicate(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <p role="status">Loading drafts…</p>
      ) : !items.length && !form ? (
        <div className="aso-empty">
          <h3>No drafts yet</h3>
          <p>Keep a version of your listing to edit and review.</p>
        </div>
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
                  const next = await api<Draft>(
                    moduleUrl(workspace.id, 'aso', `drafts/${item.id}/`),
                  );
                  if (alive.current) {
                    setSelected(next);
                    setForm(false);
                  }
                } catch (err) {
                  if (alive.current) setError((err as Error).message);
                } finally {
                  if (alive.current) setBusy(false);
                }
              }}
            >
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.locale} · {when(item.updated_at)}
                </small>
              </span>
              <span className="pill">{item.status === 'ready' ? 'Ready' : 'Draft'}</span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
