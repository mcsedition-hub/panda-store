import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { providerNames as names, type Catalog } from './catalog';

// A workspace or permission change must discard any unsaved key and pending UI state.
export default function AISettings(props: { workspaceId: string; owner: boolean }) {
  return <WorkspaceAISettings key={`${props.workspaceId}:${props.owner}`} {...props} />;
}

function WorkspaceAISettings({ workspaceId, owner }: { workspaceId: string; owner: boolean }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [target, setTarget] = useState('openai');
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const endpoint = `/api/workspaces/${workspaceId}/ai/`;
  const connection = catalog?.providers.find((item) => item.id === target);

  useEffect(() => {
    const request = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setCatalog(null);
    setLoadError('');
    setError('');
    setNotice('');
    setKey('');
    api<Catalog>(endpoint, { signal: controller.signal })
      .then((next) => {
        if (generation.current === request) setCatalog(next);
      })
      .catch((err) => {
        if (generation.current === request) setLoadError(err.message);
      })
      .finally(() => {
        if (generation.current === request) setLoading(false);
      });
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [endpoint, reload]);

  async function update(method: 'PUT' | 'POST' | 'DELETE') {
    if (!owner || busy || loading || !catalog) return;
    const request = generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await api<Catalog>(endpoint + target + '/', {
        method,
        feedback: {
          success:
            method === 'DELETE'
              ? 'AI provider disconnected.'
              : 'AI connection checked. Models updated.',
        },
        body: JSON.stringify({
          revision: connection?.revision ?? null,
          ...(method === 'PUT' ? { api_key: key } : {}),
        }),
      });
      if (generation.current !== request) return;
      setCatalog(next);
      setKey('');
      setNotice(
        method === 'DELETE'
          ? 'Provider disconnected.'
          : target === 'zai'
            ? 'Connection checked. Supported GLM models updated.'
            : 'Connection checked. Available models updated.',
      );
    } catch (err) {
      if (generation.current === request) setError((err as Error).message);
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }

  return (
    <section className="ai-settings-page" aria-labelledby="ai-settings-title">
      <div className="ai-settings-heading">
        <div>
          <p className="eyebrow">{t('Workspace')}</p>
          <h1 id="ai-settings-title">{t('AI settings')}</h1>
          <p className="note">
            {t('Connect your AI providers here, then choose a model in ASO or SMM.')}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={loading || busy}
          onClick={() => setReload((value) => value + 1)}
        >
          {t('Reload AI connections')}
        </button>
      </div>
      <div className="ai-settings">
        <h2>{t('Workspace AI connections')}</h2>
        <p className="note">
          {t(
            'Keys are stored encrypted on your server. Analyses use your provider account and billing.',
          )}
        </p>
        <p className="note">
          {t('Saving a key makes the provider available immediately. No server restart is needed.')}
        </p>
        {loading && <p role="status">{t('Loading AI providers…')}</p>}
        {loadError && (
          <div>
            <p className="error" role="alert">
              {t('AI connections could not be loaded. ')}
              {t(loadError)}
            </p>
            <button className="button secondary" onClick={() => setReload((value) => value + 1)}>
              {t('Retry loading AI connections')}
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        {!loading && !loadError && catalog && (
          <>
            <div className="ai-provider-status">
              {Object.entries(names).map(([id, name]) => (
                <span key={id}>
                  {name}{' '}
                  <strong>
                    {catalog.providers.find((item) => item.id === id)?.connected
                      ? t('Connected')
                      : t('Not connected')}
                  </strong>
                </span>
              ))}
            </div>
            {owner ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void update('PUT');
                }}
              >
                <label>
                  {t('Provider ')}
                  <select
                    value={target}
                    disabled={busy}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      setKey('');
                      setNotice('');
                      setError('');
                    }}
                  >
                    {Object.entries(names).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                {target === 'zai' && (
                  <p className="note">
                    {t('Create a Standard API Key in')}{' '}
                    <a
                      href="https://z.ai/manage-apikey/apikey-list"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('Z.ai')}
                    </a>
                    {t(
                      '. Connecting or refreshing sends a short check to GLM-4.7-Flash, listed as free by Z.ai, without app data. The supported model list is maintained by Panda Store; access to other models is checked when used.',
                    )}
                  </p>
                )}
                <label>
                  {t('API key ')}
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    disabled={busy || !catalog.credentials_ready}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={
                      connection?.connected
                        ? t('Enter a new key to replace the saved one')
                        : t('Paste your API key')
                    }
                  />
                </label>
                {!catalog.credentials_ready && (
                  <p className="error">
                    {t(
                      'Credential storage is unavailable. Ask the administrator to configure PANDA_CREDENTIAL_KEYS.',
                    )}
                  </p>
                )}
                <div className="action-group">
                  <button
                    className="button primary"
                    disabled={busy || key.trim().length < 10 || !catalog.credentials_ready}
                  >
                    {busy
                      ? t('Checking…')
                      : connection?.connected
                        ? t('Replace key')
                        : t('Connect provider')}
                  </button>
                  {connection?.connected && (
                    <>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void update('POST')}
                      >
                        {t('Refresh models')}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => void update('DELETE')}
                      >
                        {t('Disconnect provider')}
                      </button>
                    </>
                  )}
                </div>
                {notice && <p role="status">{t(notice)}</p>}
              </form>
            ) : (
              <p>{t('Ask the workspace owner to connect or update a provider.')}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
