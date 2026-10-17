import { SourceReference, type Source } from './Sources';

interface VisualImage {
  image_id: string;
  position: number;
  name: string;
  display_type: string;
  status: 'reviewed' | 'withheld' | 'unavailable';
  url?: string;
  error: string;
  sha256?: string;
  width?: number;
  height?: number;
  verdict?: 'keep' | 'improve' | 'insufficient_evidence';
  observation?: string;
  visible_text?: string;
  recommendation?: string;
  sources?: Source[];
}
type Usage = { input_tokens?: number; output_tokens?: number; reasoning_tokens?: number };
export interface VisualReport {
  images: VisualImage[];
  total_imported: number;
  reviewed_images: number;
  withheld: number;
  resolved_model: string;
  usage: Usage;
  verification: { resolved_model: string; usage: Usage };
}
const labels = {
  keep: 'No change suggested',
  improve: 'Suggestion to test',
  insufficient_evidence: 'Needs evidence',
  withheld: 'Assessment withheld',
  unavailable: 'Image unavailable',
};
function deviceLabel(value: string) {
  const phone = value.match(/^APP_IPHONE_(\d)(\d)$/);
  return phone
    ? `iPhone ${phone[1]}.${phone[2]}″`
    : value.replace(/^APP_/, '').replaceAll('_', ' ');
}

export default function Screenshots({ report }: { report: VisualReport }) {
  return (
    <div className="aso-visual-report">
      <p className="notice">
        {report.resolved_model} · {report.reviewed_images} of {report.total_imported} imported
        screenshots analyzed · {report.withheld} assessments withheld by the evidence review
      </p>
      <p className="note">
        These are the saved images sent to the model. Import order is shown; live storefront order,
        original upload sizes and readability on a phone are not verified. Suggestions require
        review and testing.
      </p>
      {report.total_imported > report.images.length && (
        <p className="notice">
          This review covers the first {report.images.length} imported images. The remaining{' '}
          {report.total_imported - report.images.length} images were not analyzed.
        </p>
      )}
      {report.images.map((image) => (
        <article className="aso-visual-card" key={image.image_id}>
          <div className="aso-visual-image">
            {image.url ? (
              <a
                href={image.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${image.name}`}
              >
                <img src={image.url} alt={`Imported screenshot: ${image.name}`} loading="lazy" />
              </a>
            ) : (
              <p>Image unavailable</p>
            )}
          </div>
          <div className="aso-visual-content">
            <header>
              <h3>{image.name || `Screenshot ${image.position}`}</h3>
              <span className="pill">
                {image.status === 'reviewed'
                  ? labels[image.verdict ?? 'insufficient_evidence']
                  : labels[image.status]}
              </span>
            </header>
            <p className="note">{deviceLabel(image.display_type)}</p>
            {image.status === 'reviewed' ? (
              <>
                <p>{image.observation}</p>
                {image.visible_text && (
                  <p className="note">Visible excerpt · “{image.visible_text}”</p>
                )}
                {image.recommendation && (
                  <div className="aso-proposal">
                    <strong>Suggested change</strong>
                    <p>{image.recommendation}</p>
                  </div>
                )}
                <footer className="aso-sources">
                  {image.sources?.map((source) => (
                    <SourceReference key={source.id} source={source} />
                  ))}
                </footer>
              </>
            ) : (
              <p>
                {image.error ||
                  'The evidence review could not support the full assessment. No suggestion is shown for this image.'}
              </p>
            )}
            {image.sha256 && (
              <details className="aso-evidence">
                <summary>Saved evidence</summary>
                <p className="note">
                  Model input · {image.width} × {image.height} px · JPEG
                </p>
                <p className="aso-image-hash">SHA-256 · {image.sha256}</p>
              </details>
            )}
          </div>
        </article>
      ))}
      <p className="note">
        Analysis · {report.usage.input_tokens ?? '—'} input / {report.usage.output_tokens ?? '—'}{' '}
        output tokens. Evidence review · {report.verification.usage.input_tokens ?? '—'} input /{' '}
        {report.verification.usage.output_tokens ?? '—'} output tokens.
      </p>
      <p className="aso-report-footnote">
        No changes have been sent to Apple. The three public gallery examples are dated reference
        notes, not live competitor research. Download effects are not measured.
      </p>
    </div>
  );
}
