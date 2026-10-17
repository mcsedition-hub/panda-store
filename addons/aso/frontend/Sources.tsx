import { useEffect, useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';

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
}
export interface Guidance {
  id: string;
  guidance: string;
  limitations?: string;
  fields?: string[];
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
};
export function sourceKind(source: Source) {
  return (
    {
      official_guidance: 'Official guidance',
      official_reference: 'Official reference',
      practitioner_framework: 'Practitioner framework',
      vendor_methodology: 'Vendor methodology',
    }[source.kind ?? ''] ?? 'Reference'
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
          <summary>Guidance used</summary>
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
}: {
  workspaceId: string;
  saved?: Knowledge & { created_at: string };
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
    api<Knowledge>(moduleUrl(workspaceId, 'aso', 'knowledge/'))
      .then((data) => {
        if (active) setCurrent(data);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, view, attempt]);
  const data = view === 'saved' ? saved : current;
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
        Apple guidance takes precedence over practitioner and vendor methods.
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
        data.entries.map((entry) => (
          <article className="aso-library-entry" key={entry.id}>
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
                </details>
              )}
            </div>
          </article>
        ))
      )}
      <p className="aso-report-footnote">
        These notes are reviewed by maintainers. An audit uses its saved references; it does not
        search the web or retrieve vendor metrics.
      </p>
    </section>
  );
}
