import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

export type AIChoice = { provider: string; model: string } | null;
type Provider = {
  id: string;
  name: string;
  connected: boolean;
  revision: string | null;
  models: { id: string; name: string }[];
  checked_at: string | null;
};
type Catalog = { providers: Provider[]; credentials_ready: boolean };
const names = { openai: 'OpenAI', google: 'Google Gemini', anthropic: 'Anthropic Claude' };

export default function AIOptions({
  workspaceId,
  owner,
  disabled,
  onChange,
}: {
  workspaceId: string;
  owner: boolean;
  disabled: boolean;
  onChange: (choice: AIChoice, loading: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>({ providers: [], credentials_ready: false });
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState('openai');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const callback = useRef(onChange);
  callback.current = onChange;
  const endpoint = `/api/workspaces/${workspaceId}/ai/`;
  const selected = catalog.providers.find((item) => item.id === provider);
  const connection = catalog.providers.find((item) => item.id === target);

  useEffect(() => {
    let active = true;
    alive.current = true;
    callback.current(null, true);
    api<Catalog>(endpoint)
      .then((next) => {
        if (!active) return;
        setCatalog(next);
        const first = next.providers.find((item) => item.connected && item.models.length);
        if (first) {
          setProvider(first.id);
          // The user explicitly chooses a model before a paid analysis can start.
          callback.current({ provider: first.id, model: '' }, false);
        } else callback.current(null, false);
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          callback.current(null, false);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [endpoint]);

  function choose(nextProvider: string, nextModel = '') {
    setProvider(nextProvider);
    setModel(nextModel);
    callback.current(nextProvider ? { provider: nextProvider, model: nextModel } : null, false);
  }
  async function update(method: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await api<Catalog>(endpoint + target + '/', {
        method,
        body: JSON.stringify({
          revision: connection?.revision ?? null,
          ...(method === 'PUT' ? { api_key: key } : {}),
        }),
      });
      if (!alive.current) return;
      setCatalog(next);
      setKey('');
      if (
        provider === target &&
        !next.providers.find((item) => item.id === target)?.models.some((item) => item.id === model)
      )
        choose(target);
      if (!provider && method === 'PUT') choose(target);
      setNotice(
        method === 'DELETE'
          ? 'Provider disconnected.'
          : 'Connection checked. Available models updated.',
      );
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="ai-options" aria-label="AI options">
      <div className="ai-choice-row">
        <label className="compact-label">
          AI provider
          <select
            value={provider}
            disabled={disabled || loading || busy}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">Rules only · No AI</option>
            {Object.entries(names).map(([id, name]) => (
              <option
                key={id}
                value={id}
                disabled={!catalog.providers.find((item) => item.id === id)?.connected}
              >
                {name}
                {!catalog.providers.find((item) => item.id === id)?.connected
                  ? ' · Not connected'
                  : ''}
              </option>
            ))}
          </select>
        </label>
        {provider && (
          <label className="compact-label">
            Model
            <select
              value={model}
              disabled={disabled || loading || busy}
              onChange={(e) => choose(provider, e.target.value)}
            >
              <option value="">Choose a model</option>
              {selected?.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="text-button"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          AI settings
        </button>
      </div>
      {loading && (
        <p role="status" className="note">
          Loading AI providers…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <div className="ai-settings">
          <h3>Workspace AI connections</h3>
          <p className="note">
            Keys are stored encrypted on your server. Analyses use your provider account and
            billing.
          </p>
          <div className="ai-provider-status">
            {Object.entries(names).map(([id, name]) => (
              <span key={id}>
                {name}{' '}
                <strong>
                  {catalog.providers.find((item) => item.id === id)?.connected
                    ? 'Connected'
                    : 'Not connected'}
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
                Provider
                <select
                  value={target}
                  disabled={busy}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setKey('');
                    setNotice('');
                  }}
                >
                  {Object.entries(names).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                API key
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  disabled={busy || !catalog.credentials_ready}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    connection?.connected
                      ? 'Enter a new key to replace the saved one'
                      : 'Paste your API key'
                  }
                />
              </label>
              {!catalog.credentials_ready && (
                <p className="error">
                  Credential storage is unavailable. Ask the administrator to configure
                  PANDA_CREDENTIAL_KEYS.
                </p>
              )}
              <div className="action-group">
                <button
                  className="button primary"
                  disabled={busy || key.trim().length < 10 || !catalog.credentials_ready}
                >
                  {busy ? 'Checking…' : connection?.connected ? 'Replace key' : 'Connect provider'}
                </button>
                {connection?.connected && (
                  <>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void update('POST')}
                    >
                      Refresh models
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => void update('DELETE')}
                    >
                      Disconnect provider
                    </button>
                  </>
                )}
              </div>
              {notice && <p role="status">{notice}</p>}
            </form>
          ) : (
            <p>Ask the workspace owner to connect or update a provider.</p>
          )}
        </div>
      )}
    </section>
  );
}
