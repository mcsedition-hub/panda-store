import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, setCsrfToken } from './api';
import type { MobileApp, ModuleInfo, Workspace } from './contracts';
import { moduleViews } from './modules';

interface Session {
  user: { id: string; username: string } | null;
  csrf_token: string;
  demo_mode: boolean;
}

function Login({ onLogin, demo }: { onLogin: (session: Session) => void; demo: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const session = await api<Session>('/api/session/login/', {
        method: 'POST',
        body: JSON.stringify({ username: data.get('username'), password: data.get('password') }),
      });
      setCsrfToken(session.csrf_token);
      onLogin(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <img className="brand" src="/brand/logo-dark.svg" alt="Panda Store" />
        <div className="login-editorial">
          <span className="eyebrow">L’ATELIER DE VOS APPS</span>
          <h1>
            Chaque app a<br />
            son public.
            <br />
            <em>Allons le chercher.</em>
          </h1>
          <p>
            Comprendre votre app. Trouver un angle.
            <br />
            Donner forme à la prochaine idée.
          </p>
          <div className="login-objects" aria-hidden="true">
            <img src="/modules/connexions.webp" alt="" />
            <img src="/modules/studio.webp" alt="" />
            <img src="/modules/veille.webp" alt="" />
          </div>
        </div>
        <span className="login-foot">Votre atelier, sur votre infrastructure.</span>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <span className="eyebrow">BIENVENUE DANS L’ATELIER</span>
          <h2>On s’y remet ?</h2>
          <p>Connectez-vous à votre espace Panda Store.</p>
          <form onSubmit={submit}>
            <label>
              Identifiant
              <input name="username" autoComplete="username" required autoFocus />
            </label>
            <label>
              Mot de passe
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? 'Connexion…' : 'Entrer dans l’atelier →'}
            </button>
          </form>
          {demo && (
            <div className="demo-note">
              <strong>Une première visite ?</strong>
              <p>
                Cette installation est en mode démonstration. Utilisez le compte créé lors de son
                installation.
              </p>
            </div>
          )}
          <a
            className="quiet-link"
            href="https://github.com/mcsedition-hub/panda-store"
            target="_blank"
            rel="noreferrer"
          >
            Code source · Elastic License 2.0 ↗
          </a>
        </div>
      </section>
    </main>
  );
}

function ModuleManager({
  modules,
  workspace,
  reload,
}: {
  modules: ModuleInfo[];
  workspace: Workspace;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function toggle(module: ModuleInfo) {
    setBusy(module.id);
    setError('');
    try {
      await api(`/api/workspaces/${workspace.id}/modules/${module.id}/`, {
        method: module.enabled ? 'DELETE' : 'POST',
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">VOTRE BOÎTE À OUTILS</span>
        <h1>À chacun ses modules.</h1>
        <p>Activez les outils utiles à cet espace. Les dépendances sont activées ensemble.</p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="module-grid">
        {modules.map((module) => (
          <article className={`module-card ${module.family}`} key={module.id}>
            <div className="module-card-top">
              <img src={`/modules/${module.icon}.webp`} alt="" />
              <span className="version">v{module.version}</span>
            </div>
            <h2>{module.name}</h2>
            <p>{module.description}</p>
            <button
              className="button secondary"
              disabled={!!busy || module.required || workspace.role !== 'owner'}
              onClick={() => toggle(module)}
            >
              {busy === module.id
                ? 'Modification…'
                : module.required
                  ? 'Module essentiel'
                  : module.enabled
                    ? 'Désactiver'
                    : 'Activer le module'}
            </button>
          </article>
        ))}
      </div>
      <p className="note">
        Les prochaines extensions — Audit ASO, Veille, Publication et Mesure — sont en préparation.
      </p>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [apps, setApps] = useState<MobileApp[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [current, setCurrent] = useState('app_catalog');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const selectedApp = apps.find((a) => a.id === selectedId) ?? apps[0] ?? null;

  useEffect(() => {
    api<Session>('/api/session/')
      .then((data) => {
        setCsrfToken(data.csrf_token);
        setSession(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!session?.user) return;
    let active = true;
    api<Workspace[]>('/api/workspaces/')
      .then((data) => {
        if (!active) return;
        setWorkspaces(data);
        setWorkspaceId(data[0]?.id ?? '');
      })
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [session?.user?.id]);
  const refreshApps = useCallback(async () => {
    if (workspaceId)
      setApps(await api<MobileApp[]>(`/api/workspaces/${workspaceId}/app_catalog/apps/`));
  }, [workspaceId]);
  const refreshModules = useCallback(async () => {
    if (workspaceId) setModules(await api<ModuleInfo[]>(`/api/workspaces/${workspaceId}/modules/`));
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setApps([]);
    setModules([]);
    setSelectedId('');
    setError('');
    Promise.all([
      api<ModuleInfo[]>(`/api/workspaces/${workspaceId}/modules/`),
      api<MobileApp[]>(`/api/workspaces/${workspaceId}/app_catalog/apps/`),
    ])
      .then(([nextModules, nextApps]) => {
        if (active) {
          setModules(nextModules);
          setApps(nextApps);
        }
      })
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [workspaceId]);
  async function signOut() {
    try {
      const data = await api<{ csrf_token: string }>('/api/session/logout/', { method: 'POST' });
      setCsrfToken(data.csrf_token);
      setSession((old) => (old ? { ...old, user: null } : null));
      setWorkspaces([]);
      setWorkspaceId('');
      setApps([]);
      setModules([]);
      setCurrent('app_catalog');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  if (loading)
    return (
      <div className="boot" role="status">
        Ouverture de l’atelier…
      </div>
    );
  if (!session)
    return (
      <main className="boot">
        <h1>Connexion à l’atelier impossible.</h1>
        <p role="alert">{error}</p>
        <button className="button secondary" onClick={() => window.location.reload()}>
          Réessayer
        </button>
      </main>
    );
  if (!session.user) return <Login onLogin={setSession} demo={session.demo_mode} />;
  const enabled = modules.filter((m) => m.enabled);
  const activeModule = enabled.find((m) => m.id === current);
  const ModuleView = activeModule ? moduleViews[current] : null;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <aside className="sidebar">
        <img className="brand" src="/brand/logo-dark.svg" alt="Panda Store" />
        <div className="workspace-picker">
          <label htmlFor="workspace">ESPACE DE TRAVAIL</label>
          <select
            id="workspace"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Modules">
          {enabled.map((module) => (
            <button
              key={module.id}
              className={`nav-item ${current === module.id ? 'active' : ''}`}
              onClick={() => {
                setCurrent(module.id);
                setError('');
              }}
              aria-current={current === module.id ? 'page' : undefined}
            >
              <img src={`/modules/${module.icon}.webp`} alt="" />
              <span>{module.name}</span>
            </button>
          ))}
          <button
            className={`nav-item ${current === 'modules' ? 'active' : ''}`}
            onClick={() => setCurrent('modules')}
            aria-current={current === 'modules' ? 'page' : undefined}
          >
            <img src="/modules/extensions.webp" alt="" />
            <span>Les modules</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="edition">COMMUNITY · ALPHA</span>
          <p>
            Un atelier qui grandit
            <br />
            avec vos idées.
          </p>
          <a href="https://github.com/mcsedition-hub/panda-store" target="_blank" rel="noreferrer">
            Contribuer sur GitHub ↗
          </a>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <span className="breadcrumb">
            L’atelier <span>/</span>{' '}
            {current === 'modules' ? 'Modules' : (activeModule?.name ?? 'Chargement')}
          </span>
          <div className="topbar-right">
            {session.demo_mode && <span className="demo-tag">Mode démo</span>}
            <span className="user-name">{session.user.username}</span>
            <button className="text-button" onClick={signOut}>
              Déconnexion
            </button>
          </div>
        </header>
        <main id="main" className="main-content">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!workspace && (
            <div className="empty">
              <h1>Votre espace vous attend.</h1>
              <p>
                Aucun espace accessible. Demandez à l’administrateur de vous ajouter à un espace de
                travail.
              </p>
            </div>
          )}
          {workspace && current === 'modules' && (
            <ModuleManager modules={modules} workspace={workspace} reload={refreshModules} />
          )}
          {workspace && current !== 'modules' && ModuleView && (
            <Suspense fallback={<p role="status">Ouverture du module…</p>}>
              <ModuleView
                key={`${workspaceId}:${current}`}
                workspace={workspace}
                apps={apps}
                selectedApp={selectedApp}
                selectApp={(app) => setSelectedId(app.id)}
                navigate={setCurrent}
                refreshApps={refreshApps}
                demoMode={session.demo_mode}
              />
            </Suspense>
          )}
          {workspace && current !== 'modules' && !ModuleView && (
            <p role="status">
              {modules.length
                ? 'Ce module n’est pas actif dans cet espace.'
                : 'Chargement des modules…'}
            </p>
          )}
        </main>
        <footer className="app-footer">
          <span>Panda Store · votre prochaine idée commence ici.</span>
          <a
            href="https://www.elastic.co/licensing/elastic-license"
            target="_blank"
            rel="noreferrer"
          >
            Code source accessible · ELv2
          </a>
        </footer>
      </div>
    </div>
  );
}
