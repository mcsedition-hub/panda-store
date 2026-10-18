import { t } from '../../../web/src/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, download, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';
import { fields, when, type Content, type Draft, type Revision } from './draftTypes';
import { notify } from '../../../web/src/notifications/store';

type Props = ModuleProps & {
  app: MobileApp;
  initial: Draft;
  onBack: () => void;
  onSaved: (draft: Draft) => void;
  onDuplicate: (draft: Draft) => void;
};
type Local = { name: string; content: Content };
const editable = (draft: Draft): Local => ({
  name: draft.name,
  content: draft.content,
});
const equal = (a: Local, b: Local) =>
  a.name === b.name && fields.every(([field]) => a.content[field] === b.content[field]);

export default function DraftEditor({
  initial,
  app,
  workspace,
  onBack,
  onSaved,
  onDuplicate,
  registerLeaveGuard,
  availableModules,
  refreshApps,
  previewMode,
}: Props) {
  const [saved, setSaved] = useState(initial);
  const savedRef = useRef(initial);
  const [local, setLocal] = useState<Local>(() => editable(initial));
  const localRef = useRef(local);
  const alive = useRef(true);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const pendingWrite = useRef<{
    request_id: string;
    version: number;
    name: string;
    content: Content;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<Revision[] | null>(null);
  const [compare, setCompare] = useState<'latest' | 'baseline'>('baseline');
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const canWrite = workspace.role !== 'viewer' && !previewMode;
  const isProject = app.origin === 'project';
  const endpoint = moduleUrl(workspace.id, 'aso', `drafts/${initial.id}/`);
  const dirty = !equal(local, editable(saved));

  const accept = useCallback((next: Draft) => {
    savedRef.current = next;
    if (alive.current) {
      setSaved(next);
      setHistory(null);
      onSavedRef.current(next);
    }
  }, []);
  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) {
      const ok = await inFlight.current;
      return ok ? save() : false;
    }
    if (conflictRef.current) return false;
    if (!pendingWrite.current && equal(localRef.current, editable(savedRef.current))) return true;
    if (!canWrite) return false;
    if (!localRef.current.name.trim()) {
      if (alive.current) setError('Give this draft a name before leaving.');
      return false;
    }
    const payload = pendingWrite.current ?? {
      request_id: crypto.randomUUID(),
      version: savedRef.current.version,
      name: localRef.current.name,
      content: { ...localRef.current.content },
    };
    pendingWrite.current = payload;
    if (alive.current) {
      setSaving(true);
      setError('');
    }
    const promise = (async () => {
      try {
        const next = await api<Draft>(endpoint, {
          method: 'PATCH',
          body: JSON.stringify(payload),
          feedback: { success: '' },
        });
        pendingWrite.current = null;
        // Keep any typing made while this request was in flight.
        if (
          equal(localRef.current, {
            name: payload.name,
            content: payload.content,
          })
        ) {
          localRef.current = editable(next);
          if (alive.current) setLocal(editable(next));
        }
        accept(next);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          conflictRef.current = true;
          if (alive.current) setConflict(true);
        }
        if (alive.current) setError((err as Error).message);
        return false;
      } finally {
        inFlight.current = null;
        if (alive.current) setSaving(false);
      }
    })();
    inFlight.current = promise;
    const ok = await promise;
    return ok && !equal(localRef.current, editable(savedRef.current)) ? save() : ok;
  }, [accept, canWrite, endpoint]);

  useEffect(() => {
    alive.current = true;
    const release = registerLeaveGuard?.(save);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        inFlight.current ||
        pendingWrite.current ||
        !equal(localRef.current, editable(savedRef.current))
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      alive.current = false;
      release?.();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [registerLeaveGuard, save]);
  useEffect(() => {
    if (!dirty || saving || error || actionBusy) return;
    const timer = setTimeout(() => void save(), 650);
    return () => clearTimeout(timer);
  }, [dirty, local, saving, error, actionBusy, save]);
  function edit(next: Local) {
    localRef.current = next;
    setLocal(next);
    setNotice('');
    if (!conflictRef.current && !pendingWrite.current) setError('');
  }
  async function action(callback: () => Promise<void>) {
    setActionBusy(true);
    setNotice('');
    try {
      if (await save()) await callback();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        conflictRef.current = true;
        setConflict(true);
      }
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setActionBusy(false);
    }
  }
  async function mutate(body: Record<string, unknown>) {
    const next = await api<Draft>(endpoint, {
      method: 'PATCH',
      feedback: {
        success: body.restore_version
          ? 'Revision restored.'
          : body.status === 'ready'
            ? 'Draft marked ready.'
            : 'Draft updated.',
      },
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        version: savedRef.current.version,
        ...body,
      }),
    });
    accept(next);
    localRef.current = editable(next);
    if (alive.current) setLocal(editable(next));
  }
  async function reload() {
    setActionBusy(true);
    try {
      const next = await api<Draft>(endpoint, {
        feedback: { success: 'Saved draft reloaded.' },
      });
      pendingWrite.current = null;
      conflictRef.current = false;
      setConflict(false);
      accept(next);
      localRef.current = editable(next);
      setLocal(editable(next));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function copyChanges(unsaved = false) {
    const text = fields
      .filter(([field]) => localRef.current.content[field] !== savedRef.current.baseline[field])
      .map(([field, label]) => `${t(label)}\n${localRef.current.content[field] ?? ''}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setNotice(unsaved ? 'Your local changes are copied.' : 'Changes copied.');
      notify('success', 'Changes copied.');
    } catch {
      setError('Clipboard unavailable. Select the text or export the saved revision.');
      notify('error', 'Clipboard unavailable. Select the text or export the saved revision.');
    }
  }
  const current = compare === 'baseline' ? saved.baseline : saved.latest.content;
  const changed = fields.filter(([field]) => local.content[field] !== saved.baseline[field]);
  const busy = actionBusy || saving;
  return (
    <section className="draft-editor" aria-label={t('Listing draft')}>
      <button className="text-button" onClick={() => void action(async () => onBack())}>
        {t('← Drafts')}
      </button>
      <div className="draft-title-row">
        <label>
          {t('Draft name ')}
          <input
            value={local.name}
            maxLength={120}
            disabled={!canWrite || actionBusy}
            onChange={(e) => edit({ ...local, name: e.target.value })}
          />
        </label>
        <span className="pill">{!dirty && saved.status === 'ready' ? t('Ready') : t('Draft')}</span>
        <span className="note" role="status">
          {saving
            ? t('Saving…')
            : error
              ? t('Not saved')
              : dirty
                ? t('Unsaved changes')
                : t('Saved')}
        </span>
      </div>
      <div className="draft-actions">
        <button
          className="button primary"
          disabled={
            !canWrite ||
            busy ||
            conflict ||
            (saved.status !== 'ready' && (!saved.validation.can_mark_ready || dirty))
          }
          onClick={() =>
            void action(() =>
              mutate({
                status: savedRef.current.status === 'ready' ? 'draft' : 'ready',
              }),
            )
          }
        >
          {saved.status === 'ready' && !dirty ? t('Return to draft') : t('Mark ready')}
        </button>
        <button
          className="button secondary"
          disabled={!canWrite || busy}
          onClick={() => void action(async () => onDuplicate(savedRef.current))}
        >
          {t('Duplicate')}
        </button>
        <button
          className="button secondary"
          disabled={busy || !changed.length}
          onClick={() => void action(() => copyChanges())}
        >
          {t('Copy changes')}
        </button>
        <a
          className={`button secondary ${dirty || busy ? 'disabled' : ''}`}
          aria-disabled={dirty || busy}
          href={`${endpoint}export/?version=${saved.version}`}
          onClick={(e) => {
            e.preventDefault();
            if (!dirty && !busy)
              void action(() =>
                download(
                  `${endpoint}export/?version=${saved.version}`,
                  `panda-draft-${saved.id}-v${saved.version}.txt`,
                ),
              );
          }}
        >
          {t('Export changes')}
        </a>
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              setHistory(
                await api<Revision[]>(endpoint + 'history/', {
                  feedback: { success: 'Revision history loaded.' },
                }),
              );
            })
          }
        >
          {t('Revision history')}
        </button>
      </div>
      <p className="draft-status-note">
        {saved.locale}
        {t(' · Ready means reviewed for manual application. Nothing is sent to Apple.')}
      </p>
      {saved.is_demo && <p className="notice">{t('Fictional demo listing.')}</p>}
      {error && (
        <div className="draft-error" role="alert">
          <p>{t(error)}</p>
          <div className="action-group">
            {conflict ? (
              <>
                <button className="button secondary" onClick={() => void copyChanges(true)}>
                  {t('Copy my unsaved changes')}
                </button>
                <button className="text-button" disabled={busy} onClick={() => void reload()}>
                  {t('Discard local edits and reload')}
                </button>
              </>
            ) : (
              <button className="button secondary" disabled={busy} onClick={() => void save()}>
                {t('Retry save')}
              </button>
            )}
          </div>
        </div>
      )}
      {notice && (
        <p className="saved" role="status">
          {t(notice)}
        </p>
      )}
      <div className="draft-comparison-bar">
        <label>
          {t('Compare with ')}
          <select
            value={compare}
            onChange={(e) => setCompare(e.target.value as 'latest' | 'baseline')}
          >
            <option value="baseline">
              {isProject ? t('Reference project version · ') : t('Reference import · ')}
              {when(saved.captured_at)}
            </option>
            <option value="latest">
              {isProject ? t('Latest project version ') : t('Latest import ')}
              {saved.latest.captured_at ? ` · ${when(saved.latest.captured_at)}` : ''}
            </option>
          </select>
        </label>
        <button
          className="text-button"
          disabled={busy || !canWrite}
          onClick={() =>
            void action(async () => {
              if (
                app.sync_provider === 'apple_store' &&
                availableModules?.includes('apple_store')
              ) {
                await api(moduleUrl(workspace.id, 'apple_store', `apps/${app.id}/sync/`), {
                  method: 'POST',
                  feedback: { success: 'App metadata refreshed.' },
                });
                await refreshApps();
              }
              const latest = await api<Draft>(endpoint);
              if (latest.version !== savedRef.current.version) {
                throw new ApiError(
                  'This draft changed in another session. Reload the saved version before continuing.',
                  409,
                );
              }
              accept(latest);
              setCompare('latest');
              const message = isProject
                ? 'Compared with the latest project version. Your draft is unchanged.'
                : 'Compared with the latest saved import. Your draft is unchanged.';
              setNotice(message);
              notify('success', message);
            })
          }
        >
          {app.sync_provider === 'apple_store' && availableModules?.includes('apple_store')
            ? t('Refresh and compare')
            : isProject
              ? t('Compare latest project version')
              : t('Compare latest import')}
        </button>
      </div>
      {!!saved.latest.changed_since_baseline.length && (
        <p className="notice">
          {t(
            isProject
              ? 'The project listing changed since this draft was created. Review its latest texts.'
              : 'The imported listing changed since this draft was created. Review the latest values before applying your text.',
          )}
        </p>
      )}
      {!dirty && saved.latest.all_changes_match && (
        <p className="saved">
          {t(
            isProject
              ? 'All modified fields match the latest project listing. The app is still unpublished.'
              : 'All modified fields match the latest import. Store availability and download impact are not verified.',
          )}
        </p>
      )}
      <div className="draft-compare-heading">
        <span>
          {compare === 'baseline'
            ? t('Reference listing')
            : isProject
              ? t('Latest project listing')
              : t('Latest imported listing')}
        </span>
        <span>{t('Your draft')}</span>
      </div>
      {fields.map(([field, label, limit]) => {
        const value = local.content[field] ?? '';
        const count = Array.from(value).length;
        const bytes = new TextEncoder().encode(value).length;
        const problem = count > limit || (field === 'keywords' && bytes > 100);
        const change = local.content[field] !== saved.baseline[field];
        const checks = saved.validation.checks.filter(
          (check) => check.field === field && saved.validation.blocking.includes(check.id),
        );
        return (
          <section className="draft-field" key={field} aria-label={t('{0} comparison', t(label))}>
            <div className="draft-field-heading">
              <h3>{t(label)}</h3>
              {change && <span className="pill">{t('Changed')}</span>}
              {saved.latest.matching_fields.includes(field) && !dirty && (
                <span className="note">
                  {isProject ? t('Matches latest project listing') : t('Matches latest import')}
                </span>
              )}
            </div>
            {field === 'promotional_text' && (
              <p className="note">
                {t(
                  'Apple’s short marketing message, shown above the description. Up to 170 characters.',
                )}
              </p>
            )}
            <div className="draft-field-columns">
              <div className="draft-original">
                {current?.[field] ?? (
                  <span className="note">{t('Not imported for this language')}</span>
                )}
                {current?.[field] === '' && <span className="note">{t('Empty')}</span>}
              </div>
              <div>
                <textarea
                  aria-label={t('Draft {0}', t(label))}
                  rows={
                    field === 'description'
                      ? 12
                      : field === 'keywords' || field === 'promotional_text'
                        ? 3
                        : 2
                  }
                  maxLength={20000}
                  value={value}
                  disabled={!canWrite || actionBusy || conflict}
                  onChange={(e) =>
                    edit({
                      ...local,
                      content: { ...local.content, [field]: e.target.value },
                    })
                  }
                />
                <div className={`draft-counter ${problem ? 'error' : ''}`}>
                  {count} / {limit}
                  {t(' characters ')}
                  {field === 'keywords' ? t(' · {0} / 100 UTF-8 bytes', bytes) : ''}
                </div>
                {!dirty &&
                  checks.map((check) => (
                    <p className="draft-field-error" key={check.id}>
                      {t(check.observation)} {t(check.action)}
                    </p>
                  ))}
              </div>
            </div>
          </section>
        );
      })}
      <details className="draft-preview">
        <summary>{t('Text preview')}</summary>
        <div>
          {app.metadata?.data.icon_url && (
            <img src={app.metadata.data.icon_url} alt="" referrerPolicy="no-referrer" />
          )}
          <h2>{local.content.name || t('App name')}</h2>
          <p>{local.content.subtitle}</p>
          <p>{local.content.promotional_text}</p>
          <p className="draft-preview-description">{local.content.description}</p>
        </div>
      </details>
      {!!saved.provenance.length && (
        <details className="draft-provenance">
          <summary>{t('Source proposals')}</summary>
          {saved.provenance.map((item, index) => (
            <div key={index}>
              <h3>{t(item.check.title)}</h3>
              {item.model && (
                <p className="note">
                  {item.provider} · {item.model}
                  {item.created_at ? ` · ${when(item.created_at)}` : ''}
                </p>
              )}
              <p>{t(item.check.observation)}</p>
              {item.check.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                  {source.title} ↗
                </a>
              ))}
            </div>
          ))}
        </details>
      )}
      {history && (
        <section className="draft-history" aria-label={t('Revision history')}>
          <h2>{t('Revision history')}</h2>
          {history.map((item) => (
            <details key={item.version}>
              <summary>
                {when(item.created_at)} · {t(item.reason)} · {item.author}
              </summary>
              <p className="note">
                {t('Revision ')}
                {item.version} · {t(item.status)} · {item.name}
              </p>
              {fields.map(
                ([field, label]) =>
                  field in item.content && (
                    <div key={field}>
                      <strong>{t(label)}</strong>
                      <p>{item.content[field] || t('(empty)')}</p>
                    </div>
                  ),
              )}
              <button
                className="button secondary"
                disabled={!canWrite || busy || item.version === saved.version}
                onClick={() => void action(() => mutate({ restore_version: item.version }))}
              >
                {t('Restore this revision')}
              </button>
            </details>
          ))}
        </section>
      )}
    </section>
  );
}
