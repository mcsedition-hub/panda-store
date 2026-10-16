import { useState } from 'react';
import type { ModuleProps } from '../../../web/src/contracts';
import AppDetail from './AppDetail';

export default function AppCatalog(props: ModuleProps) {
  const { apps, navigate, selectApp, detailAppId, availableModules } = props;
  const connectionsEnabled = availableModules?.includes('apple_store') !== false;
  const [search, setSearch] = useState('');
  const detail = apps.find((app) => app.id === detailAppId);
  if (detail) return <AppDetail key={detail.id} {...props} app={detail} />;
  const query = search.trim().toLowerCase();
  const visibleApps = apps.filter((app) =>
    `${app.name} ${app.bundle_id}`.toLowerCase().includes(query),
  );
  return (
    <>
      <div className="page-heading heading-split">
        <h1>My apps</h1>
        {apps.length > 0 && (
          <button
            className="button primary"
            onClick={() => navigate(connectionsEnabled ? 'apple_store' : 'modules')}
          >
            {connectionsEnabled ? 'Import an app' : 'Enable Connections'}
          </button>
        )}
      </div>
      {apps.length === 0 ? (
        <section className="catalog-empty">
          <img src="/modules/applications.webp" alt="" />
          <h2>No apps yet</h2>
          <button
            className="button primary"
            onClick={() => navigate(connectionsEnabled ? 'apple_store' : 'modules')}
          >
            {connectionsEnabled ? 'Import an app' : 'Enable Connections'}
          </button>
        </section>
      ) : (
        <section className="catalog-panel" aria-label="Apps">
          <div className="catalog-toolbar">
            <span className="catalog-count">
              {apps.length} {apps.length === 1 ? 'app' : 'apps'}
            </span>
            <input
              type="search"
              aria-label="Search apps"
              placeholder="Search apps"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th scope="col">App</th>
                  <th scope="col" className="catalog-store">
                    Store
                  </th>
                  <th scope="col" className="catalog-category">
                    Category
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleApps.map((app) => (
                  <tr key={app.id}>
                    <td>
                      <div className="catalog-app">
                        <div className="app-monogram" aria-hidden="true">
                          {app.name.charAt(0)}
                        </div>
                        <div>
                          <div className="catalog-app-name">
                            <strong>{app.name}</strong>
                            {app.is_demo && <span className="pill">Demo</span>}
                          </div>
                          <span className="catalog-bundle">{app.bundle_id}</span>
                        </div>
                      </div>
                    </td>
                    <td className="catalog-store">
                      {app.platform === 'ios'
                        ? 'App Store'
                        : app.platform === 'android'
                          ? 'Google Play'
                          : app.platform}
                    </td>
                    <td className="catalog-category">{app.metadata?.data.category || '—'}</td>
                    <td className="catalog-action">
                      <button
                        className="button secondary"
                        aria-label={`Open ${app.name}`}
                        onClick={() => {
                          selectApp(app);
                          navigate('app_catalog', app.id);
                        }}
                      >
                        <span className="catalog-action-full">Open app</span>
                        <span className="catalog-action-short">Open</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleApps.length === 0 && (
            <p className="catalog-no-results" role="status">
              No apps found.
            </p>
          )}
        </section>
      )}
    </>
  );
}
