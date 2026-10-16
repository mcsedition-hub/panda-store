import { useEffect, useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { AppMetadata, MobileApp, ModuleProps } from '../../../web/src/contracts';

export default function AppleStore({
  workspace,
  refreshApps,
  selectApp,
  navigate,
  demoMode,
}: ModuleProps) {
  const [apps, setApps] = useState<AppMetadata[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!demoMode) {
      setLoading(false);
      return;
    }
    let active = true;
    api<{ apps: AppMetadata[] }>(moduleUrl(workspace.id, 'apple_store', 'catalog/'))
      .then((data) => active && setApps(data.apps))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [workspace.id, demoMode]);
  async function importApp(id: string) {
    setBusy(id);
    setError('');
    try {
      const imported = await api<MobileApp>(moduleUrl(workspace.id, 'apple_store', 'import/'), {
        method: 'POST',
        body: JSON.stringify({ external_id: id }),
      });
      await refreshApps();
      selectApp(imported);
      navigate('studio');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">CONNECTIONS</span>
        <h1>Let’s meet your app.</h1>
        <p>Good creative work starts with a clear picture.</p>
      </div>
      <div className="notice">
        <strong>Try the App Store import flow.</strong>
        <p>
          These apps are fictional. Importing one saves it to your workspace. Connecting your own
          Apple account is coming in a future version.
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading catalog…</p>}
      {!demoMode && <p>Demo mode is disabled for this installation.</p>}
      <div className="import-list">
        {apps.map((app) => (
          <article className="import-row" key={app.external_id}>
            <div className="app-monogram" aria-hidden="true">
              {app.name[0]}
            </div>
            <div className="import-info">
              <h2>{app.name}</h2>
              <p>{app.subtitle}</p>
              <span className="note">
                {app.category} · {app.locale}
              </span>
            </div>
            <button
              className="button secondary"
              disabled={!!busy || workspace.role === 'viewer'}
              onClick={() => importApp(app.external_id)}
            >
              {busy === app.external_id ? 'Importing…' : 'Import →'}
            </button>
          </article>
        ))}
      </div>
      <p className="note">
        Importing the same app again updates its details without creating a duplicate.
      </p>
    </>
  );
}
