import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, setCsrfToken } from './api';
import type { MobileApp, ModuleInfo, Workspace } from './contracts';
import { moduleViews } from './modules';

interface Session {
  user: { id: string; username: string } | null;
  csrf_token: string;
  demo_mode: boolean;
  preview_mode?: boolean;
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
          <span className="eyebrow">A WORKSHOP FOR YOUR APPS</span>
          <h1>
            Every app has
            <br />
            its people.
            <br />
            <em>Let’s find yours.</em>
          </h1>
          <p>
            Know your app. Find your angle.
            <br />
            Give your next idea a place to grow.
          </p>
          <div className="login-objects" aria-hidden="true">
            <img src="/modules/connexions.webp" alt="" />
            <img src="/modules/studio.webp" alt="" />
            <img src="/modules/veille.webp" alt="" />
          </div>
        </div>
        <span className="login-foot">Your workshop. Your infrastructure.</span>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <span className="eyebrow">WELCOME TO YOUR WORKSHOP</span>
          <h2>Ready when you are.</h2>
          <p>Sign in to your Panda Store workspace.</p>
          <form onSubmit={submit}>
            <label>
              Username
              <input name="username" autoComplete="username" required autoFocus />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? 'Signing in…' : 'Enter the workshop →'}
            </button>
          </form>
          {demo && (
            <div className="demo-note">
              <strong>First time here?</strong>
              <p>This is a demo installation. Use the account created during setup.</p>
            </div>
          )}
          <a
            className="quiet-link"
            href="https://github.com/mcsedition-hub/panda-store"
            target="_blank"
            rel="noreferrer"
          >
            Source code · Elastic License 2.0 ↗
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
        <span className="eyebrow">YOUR TOOLBOX</span>
        <h1>Make room for your tools.</h1>
        <p>Choose the tools this workspace needs. Required modules are enabled together.</p>
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
                ? 'Updating…'
                : module.required
                  ? 'Core module'
                  : module.enabled
                    ? 'Disable'
                    : 'Enable module'}
            </button>
          </article>
        ))}
      </div>
      <p className="note">Up next: ASO Audit, Research, Publishing and Analytics.</p>
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
        Opening your workshop…
      </div>
    );
  if (!session)
    return (
      <main className="boot">
        <h1>Your workshop is out of reach.</h1>
        <p role="alert">{error}</p>
        <button className="button secondary" onClick={() => window.location.reload()}>
          Try again
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
        Skip to content
      </a>
      <aside className="sidebar">
        <img className="brand" src="/brand/logo-dark.svg" alt="Panda Store" />
        <div className="workspace-picker">
          <label htmlFor="workspace">WORKSPACE</label>
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
            <span>Modules</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="edition">COMMUNITY · ALPHA</span>
          <p>
            A workshop that grows
            <br />
            with your ideas.
          </p>
          <a href="https://github.com/mcsedition-hub/panda-store" target="_blank" rel="noreferrer">
            Join us on GitHub ↗
          </a>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Workshop <span>/</span>{' '}
            {current === 'modules' ? 'Modules' : (activeModule?.name ?? 'Loading')}
          </span>
          <div className="topbar-right">
            {session.demo_mode && (
              <span className="demo-tag">
                {session.preview_mode ? 'Visual preview' : 'Demo mode'}
              </span>
            )}
            <span className="user-name">{session.user.username}</span>
            {!session.preview_mode && (
              <button className="text-button" onClick={signOut}>
                Sign out
              </button>
            )}
          </div>
        </header>
        <main id="main" className="main-content">
          {session.preview_mode && (
            <p className="notice" role="status">
              Visual preview · fictional apps and sample scripts. Read-only; no account or store
              connection.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!workspace && (
            <div className="empty">
              <h1>Your workspace is waiting.</h1>
              <p>You do not have access to a workspace yet. Ask your administrator to add you.</p>
            </div>
          )}
          {workspace && current === 'modules' && (
            <ModuleManager modules={modules} workspace={workspace} reload={refreshModules} />
          )}
          {workspace && current !== 'modules' && ModuleView && (
            <Suspense fallback={<p role="status">Opening module…</p>}>
              <ModuleView
                key={`${workspaceId}:${current}`}
                workspace={workspace}
                apps={apps}
                selectedApp={selectedApp}
                selectApp={(app) => setSelectedId(app.id)}
                navigate={setCurrent}
                refreshApps={refreshApps}
                demoMode={session.demo_mode}
                previewMode={session.preview_mode}
              />
            </Suspense>
          )}
          {workspace && current !== 'modules' && !ModuleView && (
            <p role="status">
              {modules.length
                ? 'This module is not enabled in this workspace.'
                : 'Loading modules…'}
            </p>
          )}
        </main>
        <footer className="app-footer">
          <span>Panda Store · your next idea starts here.</span>
          <a
            href="https://www.elastic.co/licensing/elastic-license"
            target="_blank"
            rel="noreferrer"
          >
            Source available · ELv2
          </a>
        </footer>
      </div>
    </div>
  );
}
