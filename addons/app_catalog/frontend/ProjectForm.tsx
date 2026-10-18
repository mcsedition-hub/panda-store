import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';
import { getLanguage, t } from '../../../web/src/i18n';

export default function ProjectForm({ app, ...props }: ModuleProps & { app?: MobileApp }) {
  const { workspace, navigate, refreshApps, selectApp, registerLeaveGuard } = props;
  const metadata = app?.metadata?.data;
  const project = metadata?.project;
  const [details, setDetails] = useState({
    name: app?.name || '',
    platform: app?.platform || 'undecided',
    stage: project?.stage || 'idea',
    locale: metadata?.locale || (getLanguage() === 'fr' ? 'fr-FR' : 'en-US'),
    specification: project?.specification || '',
    audience: project?.audience || '',
    available_features: project?.available_features || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filename, setFilename] = useState('');
  const dirty = useRef(false);
  const releaseGuard = useRef<(() => void) | undefined>(undefined);
  const mounted = useRef(true);
  const pending = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    const release = registerLeaveGuard?.(
      async () => !dirty.current || window.confirm(t('Discard unsaved project changes?')),
    );
    releaseGuard.current = release;
    return () => {
      mounted.current = false;
      release?.();
    };
  }, [registerLeaveGuard]);
  function update(change: Partial<typeof details>) {
    dirty.current = true;
    setDetails((previous) => ({ ...previous, ...change }));
    setError('');
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (!/\.(md|markdown)$/i.test(file.name) || file.size > 65536) {
      setError('Choose a Markdown file (.md or .markdown) smaller than 64 KB.');
      return;
    }
    try {
      const text = await file.text();
      if (!mounted.current) return;
      if (text.length > 20000 || text.includes('\0')) {
        setError('The project description must contain at most 20,000 characters of text.');
        return;
      }
      update({ specification: text });
      setFilename(file.name);
    } catch {
      if (mounted.current) setError('The Markdown file could not be read. Paste its text instead.');
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || workspace.role === 'viewer') return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({
      ...details,
      available_features: details.stage === 'idea' ? '' : details.available_features,
    });
    if (pending.current?.body !== body) pending.current = { body, id: crypto.randomUUID() };
    try {
      const saved = await api<MobileApp>(
        moduleUrl(workspace.id, 'app_catalog', app ? `projects/${app.id}/` : 'projects/'),
        {
          method: app ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...JSON.parse(body),
            ...(app ? { snapshot_id: app.metadata!.id } : { request_id: pending.current.id }),
          }),
          feedback: { success: app ? 'Project updated.' : 'Project created.' },
        },
      );
      dirty.current = false;
      await refreshApps();
      if (mounted.current) {
        // Selection and navigation each use the shell's leave guard. Once saved,
        // release it before both actions so the second isn't dropped as overlapping.
        releaseGuard.current?.();
        selectApp(saved);
        navigate('app_catalog', saved.id);
      }
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>{app ? t('Edit project') : t('Create an app project')}</h1>
      </div>
      <p className="note">
        {t(
          'Start with an idea or an app in development. No store account is required. AI will treat planned features as plans, not as a published product.',
        )}
      </p>
      <form className="project-form" onSubmit={submit}>
        <fieldset disabled={busy || workspace.role === 'viewer'}>
          <label>
            {t('Project name')}
            <input
              value={details.name}
              maxLength={200}
              required
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <div className="project-fields">
            <label>
              {t('Project stage')}
              <select
                value={details.stage}
                onChange={(e) => update({ stage: e.target.value as 'idea' | 'development' })}
              >
                <option value="idea">{t('Idea')}</option>
                <option value="development">{t('In development')}</option>
              </select>
            </label>
            <label>
              {t('Target platform')}
              <select
                value={details.platform}
                onChange={(e) => update({ platform: e.target.value })}
              >
                <option value="undecided">{t('Not decided yet')}</option>
                <option value="ios">iOS</option>
                <option value="android">Android</option>
              </select>
            </label>
            <label>
              {t('Project language')}
              <input
                value={details.locale}
                maxLength={35}
                required
                placeholder="fr-FR"
                onChange={(e) => update({ locale: e.target.value })}
              />
            </label>
          </div>
          <label>
            {t('Describe your app or paste Markdown')}
            <textarea
              value={details.specification}
              rows={14}
              minLength={20}
              maxLength={20000}
              required
              placeholder={t(
                'Explain the problem, audience, planned features and what makes your app useful. You can paste your full project document here.',
              )}
              onChange={(e) => update({ specification: e.target.value })}
            />
          </label>
          <label className="project-upload">
            {t('Import a Markdown file')}
            <input
              type="file"
              accept=".md,.markdown,text/markdown"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {filename && (
            <p className="note" role="status">
              {t('Text imported from {0}. You can edit it above.', filename)}
            </p>
          )}
          <p className="note">
            {t(
              'Up to 20,000 characters. Markdown is saved as text; links and files referenced in it are not opened.',
            )}
          </p>
          <label>
            {t('Target audience')}
            <textarea
              value={details.audience}
              rows={2}
              maxLength={500}
              onChange={(e) => update({ audience: e.target.value })}
            />
          </label>
          {details.stage === 'development' && (
            <label>
              {t('Features already implemented')}
              <textarea
                value={details.available_features}
                rows={4}
                maxLength={4000}
                placeholder={t(
                  'List only what already works in your development version. Planned features belong in the project description.',
                )}
                onChange={(e) => update({ available_features: e.target.value })}
              />
            </label>
          )}

          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="action-group">
            <button className="button primary">
              {busy ? t('Saving…') : app ? t('Save project') : t('Create project')}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => navigate('app_catalog', app?.id)}
            >
              {t('Cancel')}
            </button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
