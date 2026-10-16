import type { ModuleProps } from '../../../web/src/contracts';

export default function AppCatalog({ apps, navigate, selectApp }: ModuleProps) {
  return (
    <>
      <div className="page-heading heading-split">
        <div>
          <span className="eyebrow">YOUR APPS, ALL TOGETHER</span>
          <h1>It starts with your app.</h1>
          <p>Its world. Its people. Its next stories.</p>
        </div>
        <button className="button primary" onClick={() => navigate('apple_store')}>
          Import an app <span aria-hidden="true">↗</span>
        </button>
      </div>
      {apps.length === 0 ? (
        <section className="welcome-panel">
          <div className="welcome-copy">
            <span className="small-index">01 / A PLACE TO START</span>
            <h2>
              One app.
              <br />A world of possibilities.
            </h2>
            <p>
              Import your first app to bring its details together and shape a brief in the Studio.
            </p>
            <button className="button dark" onClick={() => navigate('apple_store')}>
              Choose an app →
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
                  {app.is_demo ? 'Demo app' : app.platform === 'ios' ? 'App Store' : 'Google Play'}
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
                Open in Studio →
              </button>
            </article>
          ))}
        </div>
      )}
      <section className="journey">
        <span className="eyebrow">FROM APP TO IDEA</span>
        <div className="journey-steps">
          <div>
            <span>01</span>
            <h3>Understand</h3>
            <p>Gather the details that make your app yours.</p>
          </div>
          <div>
            <span>02</span>
            <h3>Explore</h3>
            <p>Choose an audience, a goal and a few fresh angles.</p>
          </div>
          <div>
            <span>03</span>
            <h3>Create</h3>
            <p>Review, refine and export the scripts you want to use.</p>
          </div>
        </div>
      </section>
    </>
  );
}
