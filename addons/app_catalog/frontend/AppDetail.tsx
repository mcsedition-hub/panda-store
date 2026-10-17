import { useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';

export default function AppDetail({
  app,
  workspace,
  navigate,
  selectApp,
  refreshApps,
  availableModules,
}: ModuleProps & { app: MobileApp }) {
  const metadata = app.metadata?.data;
  const [locale, setLocale] = useState(metadata?.locale || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const text = metadata?.localizations?.find((item) => item.locale === locale) ?? metadata;
  async function sync() {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await api(moduleUrl(workspace.id, 'apple_store', `apps/${app.id}/sync/`), { method: 'POST' });
      await refreshApps();
      setStatus('Up to date.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="text-button detail-back" onClick={() => navigate('app_catalog')}>
        ← My apps
      </button>
      <div className="page-heading heading-split">
        <div className="app-detail-title">
          {metadata?.icon_url ? (
            <img
              className="store-app-icon"
              src={metadata.icon_url}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="app-monogram" aria-hidden="true">
              {app.name[0]}
            </div>
          )}
          <div>
            <h1>{app.name}</h1>
            <p className="catalog-bundle">{app.bundle_id}</p>
          </div>
          {app.is_demo && <span className="pill">Demo</span>}
        </div>
        <div className="action-group">
          {availableModules?.includes('aso') && (
            <button
              className="button secondary"
              onClick={() => {
                selectApp(app);
                navigate('aso');
              }}
            >
              Open ASO
            </button>
          )}
          {app.sync_provider === 'apple_store' && (
            <button
              className="button secondary"
              onClick={sync}
              disabled={
                busy ||
                workspace.role === 'viewer' ||
                availableModules?.includes('apple_store') === false
              }
              title={
                availableModules?.includes('apple_store') === false
                  ? 'Enable Connections to refresh this app.'
                  : undefined
              }
            >
              {busy ? 'Refreshing…' : 'Refresh metadata'}
            </button>
          )}
          {availableModules?.includes('studio') !== false && (
            <button
              className="button primary"
              onClick={() => {
                selectApp(app);
                navigate('studio');
              }}
            >
              Open Studio
            </button>
          )}
        </div>
      </div>
      {(error || app.last_sync_error) && (
        <p className="error" role="alert">
          {error || app.last_sync_error}
        </p>
      )}
      {status && (
        <p className="sync-status" role="status">
          {status}
        </p>
      )}
      <div className="app-facts">
        <div>
          <span>Store</span>
          <strong>{app.platform === 'ios' ? 'App Store' : 'Google Play'}</strong>
        </div>
        <div>
          <span>Category</span>
          <strong>{metadata?.category || '—'}</strong>
        </div>
        <div>
          <span>Version</span>
          <strong>{metadata?.version || '—'}</strong>
          {metadata?.version_state && (
            <small>{metadata.version_state.replaceAll('_', ' ').toLowerCase()}</small>
          )}
        </div>
        <div>
          <span>Last imported</span>
          <strong>
            {app.last_synced_at || app.metadata?.captured_at
              ? new Date(app.last_synced_at || app.metadata!.captured_at).toLocaleString()
              : '—'}
          </strong>
        </div>
      </div>
      {!app.is_demo && !app.sync_provider && (
        <p className="notice">Connect your Apple account to refresh this app.</p>
      )}
      <section className="metadata-panel">
        <div className="heading-split metadata-heading">
          <h2>Store listing</h2>
          {metadata?.localizations?.length ? (
            <label className="locale-picker">
              <span className="sr-only">Language</span>
              <select value={locale} onChange={(event) => setLocale(event.target.value)}>
                {metadata.localizations.map((item) => (
                  <option key={item.locale}>{item.locale}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="note">{metadata?.locale}</span>
          )}
        </div>
        <dl className="metadata-fields">
          <div>
            <dt>Name</dt>
            <dd>{text?.name || '—'}</dd>
          </div>
          <div>
            <dt>Subtitle</dt>
            <dd>{text?.subtitle || '—'}</dd>
          </div>
          <div>
            <dt>Description</dt>
            <dd>{text?.description || '—'}</dd>
          </div>
          <div>
            <dt>Keywords</dt>
            <dd>{text?.keywords || '—'}</dd>
          </div>
        </dl>
      </section>
      {!!metadata?.screenshots?.length && (
        <section className="metadata-panel">
          <div className="heading-split metadata-heading">
            <h2>Screenshots</h2>
            <span className="note">{metadata.screenshots_locale}</span>
          </div>
          <div className="screenshot-strip">
            {metadata.screenshots.map((shot, index) => (
              <figure key={`${shot.url}-${index}`}>
                <img
                  src={shot.url}
                  alt={shot.name || `Screenshot ${index + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <figcaption>{shot.display_type.replaceAll('_', ' ').toLowerCase()}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
