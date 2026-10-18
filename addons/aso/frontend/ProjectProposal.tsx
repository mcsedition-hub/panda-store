import { t } from '../../../web/src/i18n';
import { fieldNames, SourceReference, type Source } from './Sources';
import { fields } from './draftTypes';

export interface ProjectProposalReport {
  version?: string;
  stage: 'idea' | 'development';
  analysis: {
    positioning: string;
    audience: string;
    search_intents: string[];
    missing_information: string[];
  } | null;
  fields: {
    field: string;
    text: string;
    rationale: string;
    evidence: { field: string; quote: string }[];
    sources: Source[];
  }[];
  accepted: boolean;
  reviewed_items: number;
  withheld_fields: string[];
  model: string;
  usage: { input_tokens?: number; output_tokens?: number };
  review_usage: { input_tokens?: number; output_tokens?: number };
}

export default function ProjectProposal({
  report,
  onUse,
}: {
  report: ProjectProposalReport;
  onUse?: () => void;
}) {
  return (
    <>
      <p className="note">
        {t(
          'Based on your idea. Keyword choices are hypotheses; search demand and rankings have not been measured.',
        )}
      </p>
      {report.analysis && (
        <section className="project-aso-analysis" aria-label={t('ASO positioning')}>
          <h3>{t('Positioning')}</h3>
          <p>{report.analysis.positioning}</p>
          <h3>{t('Target audience')}</h3>
          <p>{report.analysis.audience}</p>
          <h3>{t('Search intents to explore')}</h3>
          <ul>
            {report.analysis.search_intents.map((intent, index) => (
              <li key={index}>{intent}</li>
            ))}
          </ul>
          {!!report.analysis.missing_information.length && (
            <>
              <h3>{t('Details to clarify')}</h3>
              <ul>
                {report.analysis.missing_information.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {!report.accepted ? (
        <p className="notice">
          {t(
            'The proposal did not pass the project evidence review and has been withheld. Clarify your project description before starting a new analysis.',
          )}{' '}
          {report.withheld_fields
            .map((field) => t(field === 'analysis' ? 'Positioning' : fieldNames[field] || field))
            .join(', ')}
        </p>
      ) : (
        <>
          <div className="heading-split">
            <h3>{t('Suggested App Store listing')}</h3>
            {onUse && (
              <button className="button primary" onClick={onUse}>
                {t('Use this listing as a draft')}
              </button>
            )}
          </div>
          <p className="note">
            {t(
              'All five fields are ready to review and edit in ASO Drafts. Nothing has been published.',
            )}
          </p>
          {fields.map(([field, label, limit]) => {
            const item = report.fields.find((item) => item.field === field);
            if (!item) return null;
            const count =
              field === 'keywords'
                ? new TextEncoder().encode(item.text).length
                : Array.from(item.text).length;
            return (
              <section className="project-aso-field" key={field}>
                <div className="heading-split">
                  <h4>{t(label)}</h4>
                  <span className="note">
                    {field === 'keywords'
                      ? t('{0} / {1} bytes', count, limit)
                      : t('{0} / {1} characters', count, limit)}
                  </span>
                </div>
                {field === 'promotional_text' && (
                  <p className="note">
                    {t(
                      'Apple’s short marketing message, shown above the description. Up to 170 characters.',
                    )}
                  </p>
                )}
                <textarea
                  readOnly
                  aria-label={t('Suggested {0}', t(label))}
                  rows={field === 'description' ? 9 : 2}
                  value={item.text}
                />
                <p>{item.rationale}</p>
                <details>
                  <summary>{t('Grounded in your project')}</summary>
                  {item.evidence.map((evidence, index) => (
                    <blockquote key={index}>{evidence.quote}</blockquote>
                  ))}
                </details>
                <div className="aso-sources">
                  {item.sources.map((source) => (
                    <SourceReference key={source.id} source={source} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
      <p className="note">
        {report.model} · {t('{0} items checked against the project', report.reviewed_items)} ·{' '}
        {t(
          '{0} input / {1} output tokens',
          (report.usage.input_tokens || 0) + (report.review_usage.input_tokens || 0),
          (report.usage.output_tokens || 0) + (report.review_usage.output_tokens || 0),
        )}
      </p>
    </>
  );
}
