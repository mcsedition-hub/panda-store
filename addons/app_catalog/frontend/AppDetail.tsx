import { t, getLocale } from '../../../web/src/i18n';
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
      const path = `${app.sync_provider === 'google_play' ? 'google-play/' : ''}apps/${app.id}/sync/`;
      await api(moduleUrl(workspace.id, 'apple_store', path), {
        method: 'POST',
        feedback: { success: 'App metadata refreshed.' },
      });
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
        {t('← My apps')}
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
          {app.is_demo && <span className="pill">{t('Demo')}</span>}
        </div>
        <div className="action-group">
          {['ios', 'android'].includes(app.platform) && availableModules?.includes('aso') && (
            <button
              className="button secondary"
              onClick={() => {
                selectApp(app);
                navigate('aso');
              }}
            >
              {t('Open ASO')}
            </button>
          )}
          {['apple_store', 'google_play'].includes(app.sync_provider ?? '') && (
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
                  ? t('Enable Connections to refresh this app.')
                  : undefined
              }
            >
              {busy ? t('Refreshing…') : t('Refresh metadata')}
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
              {t('Open SMM')}
            </button>
          )}
        </div>
      </div>
      {(error || app.last_sync_error) && (
        <p className="error" role="alert">
          {t(error || app.last_sync_error)}
        </p>
      )}
      {status && (
        <p className="sync-status" role="status">
          {t(status)}
        </p>
      )}
      <div className="app-facts">
        <div>
          <span>{t('Store')}</span>
          <strong>{app.platform === 'ios' ? t('App Store') : t('Google Play')}</strong>
        </div>
        <div>
          <span>{t('Category')}</span>
          <strong>{t(metadata?.category || '—')}</strong>
        </div>
        <div>
          <span>{t('Version')}</span>
          <strong>{metadata?.version || '—'}</strong>
          {metadata?.version_state && (
            <small>{t(metadata.version_state.replaceAll('_', ' ').toLowerCase())}</small>
          )}
        </div>
        <div>
          <span>{t('Last imported')}</span>
          <strong>
            {app.last_synced_at || app.metadata?.captured_at
              ? new Date(app.last_synced_at || app.metadata!.captured_at).toLocaleString(
                  getLocale(),
                )
              : '—'}
          </strong>
        </div>
      </div>
      {!app.is_demo && !app.sync_provider && (
        <p className="notice">
          {t('Connect your ')}
          {app.platform === 'android' ? t('Google Play') : t('Apple')}
          {t(' account to refresh this app.')}
        </p>
      )}
      {app.platform === 'android' && (
        <p className="notice">{t('This Google Play listing can be used in ASO and SMM.')}</p>
      )}
      <section className="metadata-panel">
        <div className="heading-split metadata-heading">
          <h2>{t('Store listing')}</h2>
          {metadata?.localizations?.length ? (
            <label className="locale-picker">
              <span className="sr-only">{t('Language')}</span>
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
            <dt>{t('Name')}</dt>
            <dd>{text?.name || '—'}</dd>
          </div>
          <div>
            <dt>{app.platform === 'android' ? t('Short description') : t('Subtitle')}</dt>
            <dd>
              {(app.platform === 'android' ? text?.short_description : text?.subtitle) || '—'}
            </dd>
          </div>
          <div>
            <dt>{t('Description')}</dt>
            <dd>{text?.description || '—'}</dd>
          </div>
          {app.platform === 'ios' && (
            <div>
              <dt>{t('Keywords')}</dt>
              <dd>{text?.keywords || '—'}</dd>
            </div>
          )}
        </dl>
      </section>
      {metadata?.feature_graphic_url && (
        <section className="metadata-panel">
          <div className="metadata-heading">
            <h2>{t('Feature graphic')}</h2>
          </div>
          <div className="screenshot-strip">
            <img
              src={metadata.feature_graphic_url}
              alt={t('Google Play feature graphic')}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        </section>
      )}
      {!!metadata?.screenshots?.length && (
        <section className="metadata-panel">
          <div className="heading-split metadata-heading">
            <h2>{t('Screenshots')}</h2>
            <span className="note">{metadata.screenshots_locale}</span>
          </div>
          <div className="screenshot-strip">
            {metadata.screenshots.map((shot, index) => (
              <figure key={`${shot.url}-${index}`}>
                <img
                  src={shot.url}
                  alt={shot.name || t('Screenshot {0}', index + 1)}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <figcaption>{t(shot.display_type.replaceAll('_', ' ').toLowerCase())}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
