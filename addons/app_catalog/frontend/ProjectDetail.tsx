import type { MobileApp, ModuleProps } from '../../../web/src/contracts';
import { getLocale, t } from '../../../web/src/i18n';

export default function ProjectDetail({
  app,
  navigate,
  selectApp,
  workspace,
  availableModules,
}: ModuleProps & { app: MobileApp }) {
  const project = app.metadata?.data.project;
  return (
    <>
      <button className="text-button detail-back" onClick={() => navigate('app_catalog')}>
        {t('← My apps')}
      </button>
      <div className="page-heading heading-split">
        <div>
          <h1>{app.name}</h1>
          <span className="pill">
            {project?.stage === 'development' ? t('In development') : t('Idea')}
          </span>
        </div>
        <div className="action-group">
          {workspace.role !== 'viewer' && (
            <button
              className="button secondary"
              onClick={() => navigate('app_catalog', app.id, 'edit-project')}
            >
              {t('Edit project')}
            </button>
          )}
          {availableModules?.includes('aso') && (
            <button
              className="button secondary"
              onClick={() => {
                selectApp(app);
                navigate('aso');
              }}
            >
              {t('Open ASO')}
            </button>
          )}
          {availableModules?.includes('studio') && (
            <button
              className="button primary"
              onClick={() => {
                selectApp(app);
                navigate('studio');
              }}
            >
              {t('Open SMM')}
            </button>
          )}
        </div>
      </div>
      <p className="notice">
        {t(
          'Unpublished project. AI uses this description as planned scope and distinguishes it from implemented features. No store data has been imported.',
        )}
      </p>
      <div className="app-facts">
        <div>
          <span>{t('Target platform')}</span>
          <strong>
            {app.platform === 'ios'
              ? 'iOS'
              : app.platform === 'android'
                ? 'Android'
                : t('Not decided yet')}
          </strong>
        </div>
        <div>
          <span>{t('Project language')}</span>
          <strong>{app.metadata?.data.locale}</strong>
        </div>
        <div>
          <span>{t('Last saved')}</span>
          <strong>
            {app.metadata ? new Date(app.metadata.captured_at).toLocaleString(getLocale()) : '—'}
          </strong>
        </div>
      </div>
      <section className="catalog-panel project-description">
        <h2>{t('Project description')}</h2>
        <p className="pre-wrap">{project?.specification}</p>
        {project?.audience && (
          <>
            <h3>{t('Target audience')}</h3>
            <p className="pre-wrap">{project.audience}</p>
          </>
        )}
        {project?.available_features && (
          <>
            <h3>{t('Features already implemented')}</h3>
            <p className="pre-wrap">{project.available_features}</p>
          </>
        )}
      </section>
    </>
  );
}
