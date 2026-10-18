import { useEffect, useState } from 'react';
import { t } from '../../../web/src/i18n';
import type { AuditRun } from './index';
import { fields, when, type ComparisonSelection, type DraftSeed, type Field } from './draftTypes';
import { SourceReference, type Source } from './Sources';

interface Choice extends ComparisonSelection {
  text: string;
  rationale: string;
  evidence: { field: string; quote: string }[];
  sources: Source[];
}
type Saved = { left: string; right: string; selected: Partial<Record<Field, string>> };
function restore(key: string): Saved | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (
      value &&
      typeof value.left === 'string' &&
      typeof value.right === 'string' &&
      value.selected &&
      typeof value.selected === 'object' &&
      !Array.isArray(value.selected)
    )
      return value;
  } catch {
    /* Saved results remain on the server when browser storage is unavailable. */
  }
  return null;
}
const keyOf = (choice: ComparisonSelection) => JSON.stringify([choice.audit_id, choice.check_id]);
const modelName = (run: AuditRun) => run.ai?.model || t('Rules only');
const auditLabel = (run: AuditRun) => `${modelName(run)} · ${when(run.created_at)} · ${run.locale}`;

function choices(run: AuditRun, field: Field): Choice[] {
  const proposal = run.report?.project;
  if (proposal)
    return proposal.accepted
      ? proposal.fields
          .filter((item) => item.field === field)
          .map((item) => ({
            ...item,
            field,
            audit_id: run.id,
            check_id: 'project.listing',
          }))
      : [];
  return (run.report?.checks || [])
    .filter((check) => check.field === field && typeof check.replacement === 'string')
    .map((check) => ({
      field,
      audit_id: run.id,
      check_id: check.id,
      text: check.replacement!,
      rationale: check.observation,
      evidence: check.evidence || [],
      sources: check.sources,
    }));
}

export default function CompareAudits({
  runs,
  preferredId,
  storageKey,
  loading,
  error,
  canWrite,
  onRefresh,
  onCompose,
}: {
  runs: AuditRun[];
  preferredId?: string;
  storageKey: string;
  loading: boolean;
  error: string;
  canWrite: boolean;
  onRefresh: () => void;
  onCompose: (seed: DraftSeed, locale: string) => void;
}) {
  const [saved] = useState(() => restore(storageKey));
  const [pair, setPair] = useState({
    left: saved?.left || preferredId || '',
    right: saved?.right || '',
  });
  const [selected, setSelected] = useState<Partial<Record<Field, string>>>(saved?.selected || {});
  const available = runs.filter(
    (run) =>
      run.status === 'succeeded' && run.report && run.mode !== 'screenshots' && !run.report.visual,
  );
  const left = available.find((run) => run.id === pair.left) || available[0];
  const right =
    available.find((run) => run.id === pair.right && run.id !== left?.id) ||
    available.find((run) => run.id !== left?.id);
  const sides = [left, right].filter((run): run is AuditRun => !!run);
  useEffect(() => {
    if (loading || error || !left || !right) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ left: left.id, right: right.id, selected }),
      );
    } catch {
      /* Comparison is still usable without browser storage. */
    }
  }, [storageKey, left?.id, right?.id, selected, loading, error]);
  const sameLanguage = left?.locale === right?.locale;
  const sameType = (left?.mode || 'listing') === (right?.mode || 'listing');
  const compatible = !!left && !!right && sameLanguage && sameType;
  const picked = fields.flatMap(([field]) => {
    const choice = sides
      .flatMap((run) => choices(run, field))
      .find((item) => keyOf(item) === selected[field]);
    return choice ? [choice] : [];
  });
  const complete = left?.mode === 'project' ? picked.length === fields.length : picked.length > 0;
  function change(side: 'left' | 'right', id: string) {
    const next = { left: left?.id || '', right: right?.id || '', [side]: id };
    if (next.left === next.right)
      next[side === 'left' ? 'right' : 'left'] = (side === 'left' ? left?.id : right?.id) || '';
    setPair(next);
    setSelected({});
  }
  function chooseAll(run: AuditRun) {
    setSelected(
      Object.fromEntries(
        fields.flatMap(([field]) => {
          const options = choices(run, field);
          // Multiple saved proposals require an explicit choice for this field.
          return options.length === 1 ? [[field, keyOf(options[0])]] : [];
        }),
      ),
    );
  }
  return (
    <section className="aso-comparison" aria-label={t('Compare saved analyses')}>
      <div className="heading-split">
        <h2>{t('Compare saved analyses')}</h2>
        <button className="button secondary" disabled={loading} onClick={onRefresh}>
          {t('Refresh audits')}
        </button>
      </div>
      <p className="note">
        {t('Compare saved results and choose your preferred text for each field. No new AI call.')}
      </p>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      {loading ? (
        <p role="status">{t('Loading audits…')}</p>
      ) : available.length < 2 ? (
        <p className="notice">
          {t(
            'You need two completed text analyses of this app to compare results. They can use different models or the same model.',
          )}
        </p>
      ) : (
        left &&
        right && (
          <>
            <div className="aso-compare-grid aso-compare-pickers">
              {sides.map((run, index) => (
                <div key={index}>
                  <label>
                    {t(index === 0 ? 'Analysis A' : 'Analysis B')}
                    <select
                      value={run.id}
                      onChange={(event) =>
                        change(index === 0 ? 'left' : 'right', event.target.value)
                      }
                    >
                      {available.map((item) => (
                        <option key={item.id} value={item.id}>
                          {auditLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="note">
                    {run.ai?.provider} · {t('Reference saved: {0}', when(run.captured_at))}
                  </p>
                  {run.report?.project && !run.report.project.accepted && (
                    <p className="notice">
                      {t(
                        'This analysis has no approved listing proposal. Its texts cannot be selected.',
                      )}
                    </p>
                  )}
                  {canWrite && (
                    <button
                      className="button secondary"
                      disabled={!compatible || !!error}
                      onClick={() => chooseAll(run)}
                    >
                      {t(index === 0 ? 'Choose all from A' : 'Choose all from B')}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {!sameLanguage && (
              <p className="notice" role="status">
                {t(
                  'These analyses use different languages. You can compare them, but cannot combine them in one draft.',
                )}
              </p>
            )}
            {!sameType && (
              <p className="notice" role="status">
                {t(
                  'These analyses use different review types. You can compare them, but cannot combine them in one draft.',
                )}
              </p>
            )}
            {left.snapshot_id !== right.snapshot_id && (
              <p className="notice" role="status">
                {t(
                  'These analyses use different versions of the project or imported listing. Differences may come from the source content. The composed draft uses analysis A as its reference.',
                )}
              </p>
            )}
            {(left.knowledge_version !== right.knowledge_version ||
              left.report?.project?.version !== right.report?.project?.version) && (
              <p className="notice">
                {t(
                  'The analysis instructions or reference sets differ. The results may reflect those changes as well as the model choice.',
                )}
              </p>
            )}
            {sides.some((run) => run.report?.project?.analysis) && (
              <section className="aso-compare-analysis">
                <h3>{t('Positioning')}</h3>
                <div className="aso-compare-grid">
                  {sides.map((run, index) => (
                    <article key={run.id} className="aso-compare-card">
                      <strong>
                        {t(index === 0 ? 'Analysis A' : 'Analysis B')} · {modelName(run)}
                      </strong>
                      {run.report?.project?.analysis ? (
                        <>
                          <p>{run.report.project.analysis.positioning}</p>
                          <h4>{t('Target audience')}</h4>
                          <p>{run.report.project.analysis.audience}</p>
                          <h4>{t('Search intents to explore')}</h4>
                          <ul>
                            {run.report.project.analysis.search_intents.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                          <h4>{t('Details to clarify')}</h4>
                          <ul>
                            {run.report.project.analysis.missing_information.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="note">{t('No positioning analysis saved.')}</p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
            {fields.map(([field, label, limit]) => {
              const a = choices(left, field),
                b = choices(right, field);
              const identical = a.length === 1 && b.length === 1 && a[0].text === b[0].text;
              return (
                <section
                  className="aso-compare-field"
                  key={field}
                  aria-label={t('Compare {0}', t(label))}
                >
                  <div className="heading-split">
                    <h3>{t(label)}</h3>
                    {identical && <span className="pill">{t('Identical text')}</span>}
                  </div>
                  <div className="aso-compare-grid">
                    {sides.map((run, index) => {
                      const options = index === 0 ? a : b;
                      const assessment = run.report?.editorial?.assessments?.find(
                        (item) => item.field === field,
                      );
                      return (
                        <div key={run.id} className="aso-compare-card">
                          <strong>
                            {t(index === 0 ? 'Analysis A' : 'Analysis B')} · {modelName(run)}
                          </strong>
                          {assessment && <p>{assessment.observation}</p>}
                          {!options.length && (
                            <p className="note">{t('No saved replacement for this field.')}</p>
                          )}
                          {options.map((choice) => {
                            const count =
                              field === 'keywords'
                                ? new TextEncoder().encode(choice.text).length
                                : Array.from(choice.text).length;
                            return (
                              <div key={choice.check_id} className="aso-compare-option">
                                <p className="aso-compare-copy">{choice.text || t('Empty')}</p>
                                <p className="note">
                                  {field === 'keywords'
                                    ? t('{0} / {1} bytes', count, limit)
                                    : t('{0} / {1} characters', count, limit)}
                                </p>
                                {canWrite && (
                                  <label className="aso-compare-choice">
                                    <input
                                      type="radio"
                                      name={`compare-${field}`}
                                      disabled={!compatible || !!error}
                                      checked={selected[field] === keyOf(choice)}
                                      onChange={() =>
                                        setSelected((old) => ({ ...old, [field]: keyOf(choice) }))
                                      }
                                    />
                                    {t(index === 0 ? 'Use A for {0}' : 'Use B for {0}', t(label))}
                                  </label>
                                )}
                                <details>
                                  <summary>{t('Rationale and sources')}</summary>
                                  <p>{choice.rationale}</p>
                                  {choice.evidence.map((item, i) => (
                                    <blockquote key={i}>{item.quote}</blockquote>
                                  ))}
                                  <div className="aso-sources">
                                    {choice.sources.map((source) => (
                                      <SourceReference key={source.id} source={source} />
                                    ))}
                                  </div>
                                </details>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {canWrite && (
              <div className="aso-compare-compose">
                <strong>{t('{0} of 5 fields selected', picked.length)}</strong>
                <p className="note">
                  {t(
                    left.mode === 'project'
                      ? 'Choose all five fields to compose your listing. You can edit the draft afterwards.'
                      : 'Unselected fields keep the saved listing from analysis A. Review the combined wording and keywords before using the draft.',
                  )}
                </p>
                <button
                  className="button primary"
                  disabled={!compatible || !complete || !!error}
                  onClick={() =>
                    onCompose(
                      {
                        name: t('Compared listing'),
                        comparison: {
                          base_audit_id: left.id,
                          selections: picked.map(({ field, audit_id, check_id }) => ({
                            field,
                            audit_id,
                            check_id,
                          })),
                        },
                      },
                      left.locale,
                    )
                  }
                >
                  {t('Create draft from selection')}
                </button>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
