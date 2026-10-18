import { t } from '../../../web/src/i18n';
import { useState } from 'react';
import type { ModuleProps } from '../../../web/src/contracts';
import AppDetail from './AppDetail';
import ProjectForm from './ProjectForm';
import ProjectDetail from './ProjectDetail';

export default function AppCatalog(props: ModuleProps) {
  const { apps, navigate, selectApp, detailAppId, availableModules, workspace } = props;
  const connectionsEnabled = availableModules?.includes('apple_store') !== false;
  const [search, setSearch] = useState('');
  const detail = apps.find((app) => app.id === detailAppId);
  if (
    props.page === 'new-project' ||
    (props.page === 'edit-project' && detail?.origin === 'project')
  )
    return (
      <ProjectForm
        key={detail?.id || 'new'}
        {...props}
        app={props.page === 'edit-project' ? detail : undefined}
      />
    );
  if (detail)
    return detail.origin === 'project' ? (
      <ProjectDetail key={detail.id} {...props} app={detail} />
    ) : (
      <AppDetail key={detail.id} {...props} app={detail} />
    );
  const query = search.trim().toLowerCase();
  const visibleApps = apps.filter((app) =>
    `${app.name} ${app.bundle_id}`.toLowerCase().includes(query),
  );
  return (
    <>
      <div className="page-heading heading-split">
        <h1>{t('My apps')}</h1>
        <div className="action-group">
          {workspace.role !== 'viewer' && (
            <button
              className="button secondary"
              onClick={() => navigate('app_catalog', undefined, 'new-project')}
            >
              {t('Create a project')}
            </button>
          )}
          {apps.length > 0 && workspace.role !== 'viewer' && (
            <button
              className="button primary"
              onClick={() =>
                connectionsEnabled
                  ? navigate('apple_store', undefined, 'import')
                  : navigate('modules')
              }
            >
              {connectionsEnabled ? t('Import an app') : t('Enable Connections')}
            </button>
          )}
        </div>
      </div>
      {apps.length === 0 ? (
        <section className="catalog-empty">
          <img src="/modules/applications.webp" alt="" />
          <h2>{t('No apps yet')}</h2>
          {workspace.role !== 'viewer' && (
            <button
              className="button primary"
              onClick={() =>
                connectionsEnabled
                  ? navigate('apple_store', undefined, 'import')
                  : navigate('modules')
              }
            >
              {connectionsEnabled ? t('Import an app') : t('Enable Connections')}
            </button>
          )}
        </section>
      ) : (
        <section className="catalog-panel" aria-label={t('Apps')}>
          <div className="catalog-toolbar">
            <span className="catalog-count">
              {apps.length} {apps.length === 1 ? t('app') : t('apps')}
            </span>
            <input
              type="search"
              aria-label={t('Search apps')}
              placeholder={t('Search apps')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th scope="col">{t('App')}</th>
                  <th scope="col" className="catalog-store">
                    {t('Store')}
                  </th>
                  <th scope="col" className="catalog-category">
                    {t('Category')}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{t('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleApps.map((app) => (
                  <tr key={app.id}>
                    <td>
                      <div className="catalog-app">
                        {app.metadata?.data.icon_url ? (
                          <img
                            className="store-app-icon"
                            src={app.metadata.data.icon_url}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="app-monogram" aria-hidden="true">
                            {app.name.charAt(0)}
                          </div>
                        )}
                        <div>
                          <div className="catalog-app-name">
                            <strong>{app.name}</strong>
                            {app.origin === 'project' && (
                              <span className="pill">
                                {app.metadata?.data.project?.stage === 'development'
                                  ? t('In development')
                                  : t('Idea')}
                              </span>
                            )}
                            {app.is_demo && <span className="pill">{t('Demo')}</span>}
                          </div>
                          <span className="catalog-bundle">{app.bundle_id}</span>
                        </div>
                      </div>
                    </td>
                    <td className="catalog-store">
                      {app.origin === 'project'
                        ? t('Project')
                        : app.platform === 'ios'
                          ? t('App Store')
                          : app.platform === 'android'
                            ? t('Google Play')
                            : app.platform}
                    </td>
                    <td className="catalog-category">{t(app.metadata?.data.category || '—')}</td>
                    <td className="catalog-action">
                      <button
                        className="button secondary"
                        aria-label={t('Open {0}', app.name)}
                        onClick={() => {
                          selectApp(app);
                          navigate('app_catalog', app.id);
                        }}
                      >
                        <span className="catalog-action-full">{t('Open app')}</span>
                        <span className="catalog-action-short">{t('Open')}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleApps.length === 0 && (
            <p className="catalog-no-results" role="status">
              {t('No apps found.')}
            </p>
          )}
        </section>
      )}
    </>
  );
}
