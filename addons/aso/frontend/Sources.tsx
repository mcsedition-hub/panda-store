import { t, getLocale } from '../../../web/src/i18n';
import { useEffect, useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';

interface ObservationContext {
  storefront: string;
  language: string;
  domain: string;
  method: string;
  observed_app_version: string;
}

export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  reviewed_on: string;
  kind?: string;
  guidance?: string;
  limitations?: string;
  fields?: string[];
  observation_context?: ObservationContext;
}
export interface Guidance {
  id: string;
  guidance: string;
  limitations?: string;
  fields?: string[];
  observation_context?: ObservationContext;
  source: Source;
}
export interface Knowledge {
  version?: string | null;
  entries: Guidance[];
}
export const fieldNames: Record<string, string> = {
  name: 'App name',
  subtitle: 'Subtitle',
  short_description: 'Short description',
  description: 'Description',
  promotional_text: 'Hook (promotional text)',
  keywords: 'Keywords',
  screenshots: 'Screenshots',
};
// Display only. Keep the complete source set in saved reports and model inputs.
export function isStoreSource(source: { publisher?: string }) {
  return ['apple', 'google'].includes(source.publisher?.trim().toLowerCase() ?? '');
}

export function sourceKind(source: Source) {
  return (
    {
      official_guidance: 'Official guidance',
      official_policy: 'Official policy',
      official_reference: 'Official reference',
      practitioner_framework: 'Practitioner framework',
      vendor_methodology: 'Vendor methodology',
      public_listing_observation: 'Public listing example',
    }[source.kind ?? ''] ?? 'Reference'
  );
}

function ObservationScope({ context }: { context?: ObservationContext }) {
  if (!context) return null;
  return (
    <p className="note">
      {context.storefront} · {context.language === 'en' ? t('English') : context.language} ·{' '}
      {context.domain} · {context.method}
    </p>
  );
}

function ReferenceEntry({ entry }: { entry: Guidance }) {
  return (
    <article className="aso-library-entry">
      <div className="aso-library-meta">
        <strong>{entry.source.publisher}</strong>
        <span>{t(sourceKind(entry.source))}</span>
        <small>
          {t('Reviewed ')}
          {entry.source.reviewed_on}
        </small>
      </div>
      <div>
        <h3>
          <a href={entry.source.url} target="_blank" rel="noreferrer">
            {t(entry.source.title)} ↗
          </a>
        </h3>
        <ObservationScope context={entry.observation_context} />
        {!!entry.fields?.length && (
          <p className="note">
            {entry.fields.map((field) => t(fieldNames[field] ?? field)).join(' · ')}
          </p>
        )}
        <p>{t(entry.guidance)}</p>
        {entry.limitations && (
          <details>
            <summary>{t('Scope and limitations')}</summary>
            <p>{t(entry.limitations)}</p>
            {entry.observation_context && (
              <p>
                {t('App version observed: ')}
                {entry.observation_context.observed_app_version}.
              </p>
            )}
          </details>
        )}
      </div>
    </article>
  );
}

export function SourceReference({ source }: { source: Source }) {
  if (!isStoreSource(source)) return null;
  return (
    <div className="aso-source-reference">
      <a href={source.url} target="_blank" rel="noreferrer">
        {source.publisher} · {t(source.title)} ↗
      </a>
      <small>
        {source.kind ? `${t(sourceKind(source))} · ` : ''}
        {t(' Reviewed ')}
        {source.reviewed_on}
      </small>
      {source.guidance && (
        <details>
          <summary>
            {source.kind === 'public_listing_observation'
              ? t('Observation used')
              : t('Guidance used')}
          </summary>
          <ObservationScope context={source.observation_context} />
          <p>{t(source.guidance)}</p>
          {source.limitations && <p className="note">{t(source.limitations)}</p>}
        </details>
      )}
    </div>
  );
}

export default function Sources({
  workspaceId,
  saved,
  mode = 'listing',
  platform = 'ios',
}: {
  workspaceId: string;
  saved?: Knowledge & { created_at: string };
  mode?: 'listing' | 'screenshots';
  platform?: string;
}) {
  const [view, setView] = useState(saved ? 'saved' : 'current');
  const [current, setCurrent] = useState<Knowledge | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (view !== 'current') return;
    let active = true;
    setCurrent(null);
    setError('');
    api<Knowledge>(
      moduleUrl(
        workspaceId,
        'aso',
        `knowledge/${mode === 'screenshots' ? '?mode=screenshots' : ''}${platform === 'android' ? `${mode === 'screenshots' ? '&' : '?'}platform=android` : ''}`,
      ),
    )
      .then((data) => {
        if (active) setCurrent(data);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, view, attempt, mode, platform]);
  const data = view === 'saved' ? saved : current;
  const visibleEntries = data?.entries.filter((entry) => isStoreSource(entry.source)) ?? [];
  const examples = visibleEntries.filter(
    (entry) => entry.source.kind === 'public_listing_observation',
  );
  const guidance = visibleEntries.filter(
    (entry) => entry.source.kind !== 'public_listing_observation',
  );
  return (
    <section className="aso-library" aria-label={t('Reference library')}>
      <div className="aso-report-heading">
        <h2>{t('Reference library')}</h2>
        {saved && (
          <label className="compact-label">
            {t('Reference set ')}
            <select value={view} onChange={(event) => setView(event.target.value)}>
              <option value="saved">{t('Selected audit')}</option>
              <option value="current">{t('For new audits')}</option>
            </select>
          </label>
        )}
      </div>
      <p className="note">
        {view === 'saved' && saved
          ? t(
              'Notes saved for the audit started {0}.',
              new Date(saved.created_at).toLocaleString(getLocale()),
            )
          : t(
              platform === 'android'
                ? 'Notes supplied to new Google Play AI reviews.'
                : 'Notes supplied to new App Store AI reviews.',
            )}{' '}
        {t('Apple and Google references.')}
      </p>
      {error && view === 'current' ? (
        <div>
          <p className="error" role="alert">
            {t(error)}
          </p>
          <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
            {t('Retry loading sources')}
          </button>
        </div>
      ) : !data ? (
        <p role="status">{t('Loading sources…')}</p>
      ) : !data.entries.length ? (
        <p>{t('No guidance notes were saved for this audit.')}</p>
      ) : !visibleEntries.length ? (
        <p>{t('No Apple or Google references to display.')}</p>
      ) : (
        <>
          {guidance.map((entry) => (
            <ReferenceEntry entry={entry} key={entry.id} />
          ))}
          {!!examples.length && (
            <section aria-label={t('Public listing examples')} className="aso-listing-examples">
              <h2>{t('Public listing examples')}</h2>
              <p className="note">
                {examples.length}
                {t(
                  ' reviewed examples · Saved observations, not live research or conversion results.',
                )}
              </p>
              {examples.map((entry) => (
                <ReferenceEntry entry={entry} key={entry.id} />
              ))}
            </section>
          )}
        </>
      )}
      <p className="aso-report-footnote">
        {t(
          'These notes are reviewed by maintainers. An audit uses its saved references; it does not search the web or retrieve vendor metrics.',
        )}
      </p>
    </section>
  );
}
