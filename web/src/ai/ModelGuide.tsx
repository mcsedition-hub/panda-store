import { useState } from 'react';
import { getLocale, t } from '../i18n';
import {
  REVIEWED_ON,
  modelDescription,
  modelProfile,
  modelReasoning,
  modelUses,
  modelVision,
  thinkingHere,
  uses,
  type Model,
  type Recommendation,
  type Use,
} from './modelProfiles';

const supported = (value: boolean | undefined) =>
  value === true ? t('Supported') : value === false ? t('Not supported') : t('Not verified');

export default function ModelGuide({
  provider,
  models,
  selectedId,
  recommendation,
  disabled,
  onChoose,
}: {
  provider: string;
  models: Model[];
  selectedId: string;
  recommendation?: Recommendation;
  disabled: boolean;
  onChoose: (id: string) => void;
}) {
  const [focus, setFocus] = useState<Use | ''>('');
  const [search, setSearch] = useState('');
  const selected = models.find((item) => item.id === selectedId);
  const profile = selected && modelProfile(provider, selected);
  const matches = models.filter(
    (item) =>
      (!focus || modelUses(provider, item).includes(focus)) &&
      `${item.id} ${item.name}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="ai-model-guide">
      {recommendation && (
        <div className="ai-model-recommendation">
          <span className="ai-recommended-badge">{t(recommendation.label)}</span>
          <strong>{recommendation.model.id}</strong>
          <span>{t(recommendation.reason)}</span>
        </div>
      )}
      {selected ? (
        <section className="ai-model-profile" aria-label={t('Selected model profile')}>
          <div className="ai-model-profile-heading">
            <strong>{selected.id}</strong>
            {profile && <span>{t(profile.label)}</span>}
          </div>
          <p>
            {profile
              ? modelDescription(profile)
              : t(
                  'This model has no reviewed usage profile yet. Check its provider documentation.',
                )}
          </p>
          <dl className="ai-model-facts">
            <div>
              <dt>{t('Response speed')}</dt>
              <dd>{profile ? t(profile.speed) : t('Not verified')}</dd>
            </div>
            <div>
              <dt>{t('Reasoning capability')}</dt>
              <dd>{supported(modelReasoning(provider, selected))}</dd>
            </div>
            <div>
              <dt>{t('Thinking in this app')}</dt>
              <dd>{thinkingHere(provider, selected)}</dd>
            </div>
            <div>
              <dt>{t('Image analysis')}</dt>
              <dd>{supported(modelVision(provider, selected))}</dd>
            </div>
          </dl>
          {profile?.note && <p className="note">{t(profile.note)}</p>}
          {profile && (
            <p className="note ai-model-source">
              <a href={profile.source} target="_blank" rel="noreferrer">
                {t('Official model documentation')}
              </a>
              <span>
                {t(
                  'Reviewed {0}',
                  new Date(REVIEWED_ON + 'T12:00:00Z').toLocaleDateString(getLocale()),
                )}
              </span>
            </p>
          )}
        </section>
      ) : (
        <p className="note">
          {t('Choose a model to see its strengths, speed, and image capabilities.')}
        </p>
      )}
      <details className="ai-model-comparison">
        <summary>{t('Compare models by use')}</summary>
        <p className="note">
          {t(
            'Usage suggestions are our interpretation of provider documentation, not a quality ranking. A model can serve several purposes.',
          )}
        </p>
        <div className="ai-model-filters">
          <label className="compact-label">
            {t('Explore by use')}
            <select value={focus} onChange={(e) => setFocus(e.target.value as Use | '')}>
              <option value="">{t('All uses')}</option>
              {Object.entries(uses).map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-label">
            {t('Find a model')}
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {matches.length ? (
          <div
            className="ai-model-table"
            role="region"
            aria-label={t('Model comparison')}
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('Model')}</th>
                  <th scope="col">{t('Useful for')}</th>
                  <th scope="col">{t('Response speed')}</th>
                  <th scope="col">{t('Thinking in this app')}</th>
                  <th scope="col">{t('Image analysis')}</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((item) => {
                  const entry = modelProfile(provider, item);
                  return (
                    <tr key={item.id} aria-selected={item.id === selectedId}>
                      <th scope="row">
                        <button
                          className="text-button"
                          disabled={disabled}
                          onClick={() => onChoose(item.id)}
                          aria-label={t('Choose {0}', item.id)}
                          aria-pressed={item.id === selectedId}
                        >
                          {item.id}
                        </button>
                        {recommendation?.model.id === item.id && (
                          <span className="ai-recommended-badge">{t(recommendation.label)}</span>
                        )}
                      </th>
                      <td>{entry ? modelDescription(entry) : t('Profile not reviewed')}</td>
                      <td>{entry ? t(entry.speed) : t('Not verified')}</td>
                      <td>{thinkingHere(provider, item)}</td>
                      <td>{supported(modelVision(provider, item))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="note" role="status">
            {t('No reviewed models match this use or search in your catalog.')}
          </p>
        )}
      </details>
      <p className="note ai-model-explanation">
        {t(
          'Speed is relative within each provider. Longer inputs, longer answers, and more thinking can increase the wait.',
        )}{' '}
        {t(
          'Image analysis reads existing visuals. Image creation is not enabled in this selector.',
        )}
      </p>
    </div>
  );
}
