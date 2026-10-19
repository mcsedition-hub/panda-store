import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import ModelGuide from './ModelGuide';
import {
  modelOptionLabel,
  modelVision,
  primaryModels,
  recommendedModel,
  type Model,
  type ModuleContext,
} from './modelProfiles';

export type AIChoice = { provider: string; model: string } | null;
type Capability = 'text' | 'vision' | 'web_search';
type Provider = {
  id: string;
  name: string;
  connected: boolean;
  revision: string | null;
  models: Model[];
  checked_at: string | null;
};
type Catalog = { providers: Provider[]; credentials_ready: boolean };
const names = {
  openai: 'OpenAI',
  google: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  zai: 'Z.ai (GLM)',
};
function compatible(provider: string, model: Model, capability: Capability) {
  if (provider === 'zai' && capability === 'web_search') return false;
  if (capability !== 'vision') return true;
  const vision = modelVision(provider, model);
  // Preserve access to unreviewed models on existing adapters, but honor an
  // explicit negative capability. Z.ai has a complete supported catalog.
  return vision === true || (provider !== 'zai' && vision !== false);
}

export default function AIOptions({
  workspaceId,
  owner,
  disabled,
  onChange,
  emptyLabel = 'Rules only · No AI',
  capability = 'text',
  moduleContext,
  initialChoice,
}: {
  workspaceId: string;
  owner: boolean;
  disabled: boolean;
  onChange: (choice: AIChoice, loading: boolean) => void;
  emptyLabel?: string;
  capability?: Capability;
  moduleContext?: ModuleContext;
  initialChoice?: AIChoice;
}) {
  const [catalog, setCatalog] = useState<Catalog>({ providers: [], credentials_ready: false });
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [showAllModels, setShowAllModels] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState('openai');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const callback = useRef(onChange);
  callback.current = onChange;
  const requirement = useRef(capability);
  requirement.current = capability;
  const initial = useRef(initialChoice);
  initial.current = initialChoice;
  const endpoint = `/api/workspaces/${workspaceId}/ai/`;
  const selected = catalog.providers.find((item) => item.id === provider);
  const connection = catalog.providers.find((item) => item.id === target);
  const availableModels = (selected?.models ?? []).filter((item) =>
    compatible(provider, item, capability),
  );
  const recommendation = recommendedModel(
    provider,
    availableModels,
    moduleContext,
    capability === 'vision',
  );
  const primary = primaryModels(provider, availableModels, recommendation?.model);
  const chosenOther = availableModels.find(
    (item) => item.id === model && !primary.some((entry) => entry.id === model),
  );
  // Preserve a previously chosen extra model while keeping the compact list at five.
  const visibleModels = showAllModels
    ? availableModels
    : [...primary.slice(0, chosenOther ? 4 : 5), ...(chosenOther ? [chosenOther] : [])];

  useEffect(() => {
    let active = true;
    alive.current = true;
    setLoading(true);
    setLoadError('');
    setError('');
    setProvider('');
    setModel('');
    setShowAllModels(false);
    callback.current(null, true);
    api<Catalog>(endpoint)
      .then((next) => {
        if (!active) return;
        setCatalog(next);
        const available = next.providers.filter(
          (item) =>
            item.connected &&
            item.models.some((model) => compatible(item.id, model, requirement.current)),
        );
        const first =
          available.find((item) => item.id === initial.current?.provider) ?? available[0];
        if (first) {
          setProvider(first.id);
          const restored =
            first.id === initial.current?.provider &&
            first.models.some(
              (item) =>
                item.id === initial.current?.model &&
                compatible(first.id, item, requirement.current),
            )
              ? initial.current.model
              : '';
          setModel(restored);
          // Retry may explicitly seed the saved choice; new work still requires a selection.
          callback.current({ provider: first.id, model: restored }, false);
        } else callback.current(null, false);
      })
      .catch((err) => {
        if (active) {
          setLoadError(err.message);
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
  }, [endpoint, reload]);

  useEffect(() => {
    if (model && !availableModels.some((item) => item.id === model)) {
      setModel('');
      callback.current({ provider, model: '' }, false);
    }
  }, [capability, catalog, provider, model]);

  function choose(nextProvider: string, nextModel = '') {
    if (nextProvider !== provider) setShowAllModels(false);
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
          : target === 'zai'
            ? 'Connection checked. Supported GLM models updated.'
            : 'Connection checked. Available models updated.',
      );
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="ai-options" aria-label={t('AI options')}>
      <div className="ai-choice-row">
        <label className="compact-label">
          {t('AI provider ')}
          <select
            value={provider}
            disabled={disabled || loading || busy || !!loadError}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">{t(emptyLabel)}</option>
            {Object.entries(names).map(([id, name]) => (
              <option
                key={id}
                value={id}
                disabled={
                  !catalog.providers.find((item) => item.id === id)?.connected ||
                  (id === 'zai' && capability === 'web_search')
                }
              >
                {name}
                {!catalog.providers.find((item) => item.id === id)?.connected
                  ? t(' · Not connected')
                  : id === 'zai' && capability === 'web_search'
                    ? t(' · Use browser research')
                    : ''}
              </option>
            ))}
          </select>
        </label>
        {provider && (
          <label className="compact-label ai-model-choice">
            {t('Model ')}
            <select
              value={model}
              disabled={disabled || loading || busy}
              onChange={(e) => choose(provider, e.target.value)}
            >
              <option value="">{t('Choose a model')}</option>
              {visibleModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {modelOptionLabel(provider, item)}
                  {recommendation?.model.id === item.id ? ` · ${t(recommendation.label)}` : ''}
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
          {t('AI settings')}
        </button>
      </div>
      {primary.length < availableModels.length && (
        <div className="ai-model-list-toggle">
          <span className="note">
            {t('Five main models at most. More choices are available in the full list.')}
          </span>
          <button
            className="text-button"
            disabled={disabled || loading || busy}
            aria-expanded={showAllModels}
            onClick={() => setShowAllModels(!showAllModels)}
          >
            {showAllModels
              ? t('Show main models')
              : t('See more ({0} models)', availableModels.length)}
          </button>
        </div>
      )}
      {provider === 'zai' && (
        <p className="note">
          {capability === 'vision' ? t('Only GLM models that accept images are shown. ') : ''}
          {t(
            ' Listed-free models follow Z.ai pricing; account access and rate limits still apply.',
          )}{' '}
          <a href="https://docs.z.ai/guides/overview/pricing" target="_blank" rel="noreferrer">
            {t('Check current pricing')}
          </a>
          .
        </p>
      )}
      {provider && !loading && !loadError && (
        <ModelGuide
          key={provider}
          provider={provider}
          models={visibleModels}
          selectedId={model}
          recommendation={recommendation}
          disabled={disabled || busy}
          onChoose={(id) => choose(provider, id)}
        />
      )}
      {loading && (
        <p role="status" className="note">
          {t('Loading AI providers…')}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
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
      {editing && (
        <div className="ai-settings">
          <h3>{t('Workspace AI connections')}</h3>
          <p className="note">
            {t(
              'Keys are stored encrypted on your server. Analyses use your provider account and billing.',
            )}
          </p>
          {!loading && !loadError && (
            <>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setReload((value) => value + 1)}
              >
                {t('Reload AI connections')}
              </button>
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
      )}
    </section>
  );
}
