import { t } from '../../../web/src/i18n';
import { isStoreSource, SourceReference, type Source } from './Sources';

export interface VisualImage {
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
  platform?: 'ios' | 'android';
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
  const googleDevices: Record<string, string> = {
    phoneScreenshots: 'Phone screenshots',
    sevenInchScreenshots: '7-inch tablet screenshots',
    tenInchScreenshots: '10-inch tablet screenshots',
    tvScreenshots: 'TV screenshots',
    wearScreenshots: 'Watch screenshots',
  };
  if (googleDevices[value]) return t(googleDevices[value]);
  const phone = value.match(/^APP_IPHONE_(\d)(\d)$/);
  return phone
    ? `iPhone ${phone[1]}.${phone[2]}″`
    : value.replace(/^APP_/, '').replaceAll('_', ' ');
}

export default function Screenshots({
  report,
  onCreateBrief,
}: {
  report: VisualReport;
  onCreateBrief?: (image: VisualImage) => void;
}) {
  const readable = (text?: string) =>
    text?.replace(
      /\bshot-\d+\b/g,
      (id) => report.images.find((item) => item.image_id === id)?.name || id,
    );
  return (
    <div className="aso-visual-report">
      <p className="notice">
        {report.resolved_model} · {report.reviewed_images}
        {t(' of ')}
        {report.total_imported}
        {t(' imported screenshots analyzed · ')}
        {report.withheld}
        {t(' assessments withheld by the evidence review')}
      </p>
      <p className="note">
        {t(
          'These are the saved images sent to the model. Import order is shown; live storefront order, original upload sizes and readability on a phone are not verified. Suggestions require review and testing.',
        )}
      </p>
      {report.total_imported > report.images.length && (
        <p className="notice">
          {t('This review covers the first ')}
          {report.images.length}
          {t(' imported images. The remaining')} {report.total_imported - report.images.length}
          {t(' images were not analyzed.')}
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
                aria-label={t('Open {0}', image.name)}
              >
                <img
                  src={image.url}
                  alt={t('Imported screenshot: {0}', image.name)}
                  loading="lazy"
                />
              </a>
            ) : (
              <p>{t('Image unavailable')}</p>
            )}
          </div>
          <div className="aso-visual-content">
            <header>
              <h3>{image.name || t('Screenshot {0}', image.position)}</h3>
              <span className="pill">
                {t(
                  image.status === 'reviewed'
                    ? labels[image.verdict ?? 'insufficient_evidence']
                    : labels[image.status],
                )}
              </span>
            </header>
            <p className="note">{t(deviceLabel(image.display_type))}</p>
            {image.status === 'reviewed' ? (
              <>
                <p>{readable(image.observation)}</p>
                {image.visible_text && (
                  <p className="note">{t('Visible excerpt · “{0}”', image.visible_text)}</p>
                )}
                {image.recommendation && (
                  <div className="aso-proposal">
                    <strong>{t('Suggested change')}</strong>
                    <p>{readable(image.recommendation)}</p>
                    {onCreateBrief && image.verdict === 'improve' && (
                      <button className="button secondary" onClick={() => onCreateBrief(image)}>
                        {t('Create brief')}
                      </button>
                    )}
                  </div>
                )}
                {image.sources?.some(isStoreSource) && (
                  <footer className="aso-sources">
                    {image.sources?.map((source) => (
                      <SourceReference key={source.id} source={source} />
                    ))}
                  </footer>
                )}
              </>
            ) : (
              <p>
                {t(
                  image.error ||
                    t(
                      'The evidence review could not support the full assessment. No suggestion is shown for this image.',
                    ),
                )}
              </p>
            )}
            {image.sha256 && (
              <details className="aso-evidence">
                <summary>{t('Saved evidence')}</summary>
                <p className="note">
                  {t('Model input · ')}
                  {image.width} × {image.height}
                  {t(' px · JPEG')}
                </p>
                <p className="aso-image-hash">
                  {t('SHA-256 · ')}
                  {image.sha256}
                </p>
              </details>
            )}
          </div>
        </article>
      ))}
      <p className="note">
        {t('Analysis · ')}
        {report.usage.input_tokens ?? '—'}
        {t(' input / ')}
        {report.usage.output_tokens ?? '—'} {t('output tokens. Evidence review · ')}
        {report.verification.usage.input_tokens ?? '—'}
        {t(' input /')} {report.verification.usage.output_tokens ?? '—'}
        {t(' output tokens.')}
      </p>
      <p className="aso-report-footnote">
        {t(
          report.platform === 'android'
            ? 'No changes have been sent to Google Play. Download effects are not measured.'
            : 'No changes have been sent to Apple. Download effects are not measured.',
        )}
      </p>
    </div>
  );
}
