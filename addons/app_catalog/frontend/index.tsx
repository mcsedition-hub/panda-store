import type { ModuleProps } from '../../../web/src/contracts';

export default function AppCatalog({ apps, navigate, selectApp }: ModuleProps) {
  return (
    <>
      <div className="page-heading heading-split">
        <div>
          <span className="eyebrow">VOS APPS, AU MÊME ENDROIT</span>
          <h1>Tout part de votre app.</h1>
          <p>Son univers, son public, ses prochaines histoires.</p>
        </div>
        <button className="button primary" onClick={() => navigate('apple_store')}>
          Importer une app <span aria-hidden="true">↗</span>
        </button>
      </div>
      {apps.length === 0 ? (
        <section className="welcome-panel">
          <div className="welcome-copy">
            <span className="small-index">01 / LE POINT DE DÉPART</span>
            <h2>
              Une app.
              <br />
              Des idées à faire grandir.
            </h2>
            <p>
              Importez votre première application pour retrouver ses métadonnées et préparer un
              brief dans le Studio.
            </p>
            <button className="button dark" onClick={() => navigate('apple_store')}>
              Choisir une app →
            </button>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <img src="/modules/connexions.webp" alt="" />
          </div>
        </section>
      ) : (
        <div className="app-grid">
          {apps.map((app) => (
            <article className="app-card" key={app.id}>
              <div className="app-card-top">
                <div className="app-monogram" aria-hidden="true">
                  {app.name.charAt(0)}
                </div>
                <span className="pill">
                  {app.is_demo
                    ? 'App fictive'
                    : app.platform === 'ios'
                      ? 'App Store'
                      : 'Google Play'}
                </span>
              </div>
              <h2>{app.name}</h2>
              <p className="app-subtitle">{app.metadata?.data.subtitle ?? app.bundle_id}</p>
              <p className="app-description">{app.metadata?.data.description}</p>
              <div className="app-meta">
                <span>{app.metadata?.data.category}</span>
                <span>{app.metadata?.data.locale}</span>
              </div>
              <button
                className="button secondary full"
                onClick={() => {
                  selectApp(app);
                  navigate('studio');
                }}
              >
                Ouvrir dans le Studio →
              </button>
            </article>
          ))}
        </div>
      )}
      <section className="journey">
        <span className="eyebrow">D’UNE APP À UNE IDÉE</span>
        <div className="journey-steps">
          <div>
            <span>01</span>
            <h3>Comprendre</h3>
            <p>Rassembler les informations qui rendent votre app singulière.</p>
          </div>
          <div>
            <span>02</span>
            <h3>Explorer</h3>
            <p>Définir un public, une intention et plusieurs angles.</p>
          </div>
          <div>
            <span>03</span>
            <h3>Créer</h3>
            <p>Relire, affiner et exporter les scripts que vous retenez.</p>
          </div>
        </div>
      </section>
    </>
  );
}
