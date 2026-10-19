import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import ModelGuide from './ModelGuide';
import { providerNames as names, type Catalog } from './catalog';
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
  disabled,
  onChange,
  emptyLabel = 'Rules only · No AI',
  capability = 'text',
  moduleContext,
  initialChoice,
}: {
  workspaceId: string;
  /** Kept for add-on compatibility; key management lives in sidebar settings. */
  owner?: boolean;
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
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const callback = useRef(onChange);
  callback.current = onChange;
  const requirement = useRef(capability);
  requirement.current = capability;
  const initial = useRef(initialChoice);
  initial.current = initialChoice;
  const endpoint = `/api/workspaces/${workspaceId}/ai/`;
  const selected = catalog.providers.find((item) => item.id === provider);
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
    setLoading(true);
    setLoadError('');
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
  return (
    <section className="ai-options" aria-label={t('AI options')}>
      <div className="ai-choice-row">
        <label className="compact-label">
          {t('AI provider ')}
          <select
            value={provider}
            disabled={disabled || loading || !!loadError}
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
              disabled={disabled || loading}
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
      </div>
      {primary.length < availableModels.length && (
        <div className="ai-model-list-toggle">
          <span className="note">
            {t('Five main models at most. More choices are available in the full list.')}
          </span>
          <button
            className="text-button"
            disabled={disabled || loading}
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
          disabled={disabled}
          onChoose={(id) => choose(provider, id)}
        />
      )}
      {loading && (
        <p role="status" className="note">
          {t('Loading AI providers…')}
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
      {!loading && !loadError && !catalog.providers.some((item) => item.connected) && (
        <p className="note">{t('Connect providers in Settings → AI settings in the sidebar.')}</p>
      )}
    </section>
  );
}
