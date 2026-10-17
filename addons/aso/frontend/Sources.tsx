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
  description: 'Description',
  promotional_text: 'Promotional text',
  keywords: 'Keywords',
  screenshots: 'Screenshots',
};
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
      {context.storefront} · {context.language === 'en' ? 'English' : context.language} ·{' '}
      {context.domain} · {context.method}
    </p>
  );
}

function ReferenceEntry({ entry }: { entry: Guidance }) {
  return (
    <article className="aso-library-entry">
      <div className="aso-library-meta">
        <strong>{entry.source.publisher}</strong>
        <span>{sourceKind(entry.source)}</span>
        <small>Reviewed {entry.source.reviewed_on}</small>
      </div>
      <div>
        <h3>
          <a href={entry.source.url} target="_blank" rel="noreferrer">
            {entry.source.title} ↗
          </a>
        </h3>
        <ObservationScope context={entry.observation_context} />
        {!!entry.fields?.length && (
          <p className="note">
            {entry.fields.map((field) => fieldNames[field] ?? field).join(' · ')}
          </p>
        )}
        <p>{entry.guidance}</p>
        {entry.limitations && (
          <details>
            <summary>Scope and limitations</summary>
            <p>{entry.limitations}</p>
            {entry.observation_context && (
              <p>App version observed: {entry.observation_context.observed_app_version}.</p>
            )}
          </details>
        )}
      </div>
    </article>
  );
}

export function SourceReference({ source }: { source: Source }) {
  return (
    <div className="aso-source-reference">
      <a href={source.url} target="_blank" rel="noreferrer">
        {source.publisher} · {source.title} ↗
      </a>
      <small>
        {source.kind ? `${sourceKind(source)} · ` : ''}Reviewed {source.reviewed_on}
      </small>
      {source.guidance && (
        <details>
          <summary>
            {source.kind === 'public_listing_observation' ? 'Observation used' : 'Guidance used'}
          </summary>
          <ObservationScope context={source.observation_context} />
          <p>{source.guidance}</p>
          {source.limitations && <p className="note">{source.limitations}</p>}
        </details>
      )}
    </div>
  );
}

export default function Sources({
  workspaceId,
  saved,
  mode = 'listing',
}: {
  workspaceId: string;
  saved?: Knowledge & { created_at: string };
  mode?: 'listing' | 'screenshots';
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
        `knowledge/${mode === 'screenshots' ? '?mode=screenshots' : ''}`,
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
  }, [workspaceId, view, attempt, mode]);
  const data = view === 'saved' ? saved : current;
  const examples =
    data?.entries.filter((entry) => entry.source.kind === 'public_listing_observation') ?? [];
  const guidance =
    data?.entries.filter((entry) => entry.source.kind !== 'public_listing_observation') ?? [];
  return (
    <section className="aso-library" aria-label="Reference library">
      <div className="aso-report-heading">
        <h2>Reference library</h2>
        {saved && (
          <label className="compact-label">
            Reference set
            <select value={view} onChange={(event) => setView(event.target.value)}>
              <option value="saved">Selected audit</option>
              <option value="current">For new audits</option>
            </select>
          </label>
        )}
      </div>
      <p className="note">
        {view === 'saved' && saved
          ? `Notes saved for the audit started ${new Date(saved.created_at).toLocaleString('en-US')}.`
          : 'Notes supplied to new App Store AI reviews.'}{' '}
        Apple guidance takes precedence over methods and public listing examples.
      </p>
      {error && view === 'current' ? (
        <div>
          <p className="error" role="alert">
            {error}
          </p>
          <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
            Retry loading sources
          </button>
        </div>
      ) : !data ? (
        <p role="status">Loading sources…</p>
      ) : !data.entries.length ? (
        <p>No guidance notes were saved for this audit.</p>
      ) : (
        <>
          {guidance.map((entry) => (
            <ReferenceEntry entry={entry} key={entry.id} />
          ))}
          {!!examples.length && (
            <section aria-label="Public listing examples" className="aso-listing-examples">
              <h2>Public listing examples</h2>
              <p className="note">
                {examples.length} reviewed examples · Saved observations, not live research or
                conversion results.
              </p>
              {examples.map((entry) => (
                <ReferenceEntry entry={entry} key={entry.id} />
              ))}
            </section>
          )}
        </>
      )}
      <p className="aso-report-footnote">
        These notes are reviewed by maintainers. An audit uses its saved references; it does not
        search the web or retrieve vendor metrics.
      </p>
    </section>
  );
}
