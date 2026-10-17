import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, setCsrfToken } from './api';
import type { MobileApp, ModuleInfo, Session, Workspace } from './contracts';
import { moduleViews } from './modules';
import Setup from './Setup';

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
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
        feedback: { success: 'Signed in.' },
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
    <main className="auth-layout">
      <img className="brand" src="/brand/logo-light.svg" alt="Panda Store" />
      <section className="auth-panel">
        <h1>Sign in</h1>
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
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <a
          className="quiet-link"
          href="https://github.com/mcsedition-hub/panda-store"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
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
        feedback: { success: `${module.name} ${module.enabled ? 'disabled' : 'enabled'}.` },
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
        <h1>Modules</h1>
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
              <span className={`module-status ${module.enabled ? 'enabled' : ''}`}>
                {module.availability === 'planned'
                  ? 'Planned'
                  : module.enabled
                    ? 'Enabled'
                    : 'Disabled'}
              </span>
            </div>
            <h2>{module.name}</h2>
            <p>{module.description}</p>
            <button
              className="button secondary"
              disabled={
                !!busy ||
                module.required ||
                module.availability === 'planned' ||
                workspace.role !== 'owner'
              }
              onClick={() => toggle(module)}
            >
              {busy === module.id
                ? 'Updating…'
                : module.availability === 'planned'
                  ? 'Not available yet'
                  : module.required
                    ? 'Core module'
                    : module.enabled
                      ? 'Disable'
                      : 'Enable module'}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const modulesRequest = useRef(0);
  const [apps, setApps] = useState<MobileApp[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [current, setCurrent] = useState('app_catalog');
  const [detailAppId, setDetailAppId] = useState('');
  const leaveGuard = useRef<(() => Promise<boolean>) | null>(null);
  const leaving = useRef(false);
  const registerLeaveGuard = useCallback((guard: () => Promise<boolean>) => {
    leaveGuard.current = guard;
    return () => {
      if (leaveGuard.current === guard) leaveGuard.current = null;
    };
  }, []);
  async function leave(action: () => void | Promise<void>) {
    if (!leaveGuard.current) {
      await action();
      return;
    }
    if (leaving.current) return;
    leaving.current = true;
    try {
      if (!leaveGuard.current || (await leaveGuard.current())) await action();
    } finally {
      leaving.current = false;
    }
  }
  function navigate(module: string, appId = '') {
    void leave(() => {
      setCurrent(module);
      setDetailAppId(appId);
    });
  }
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const selectedApp = apps.find((a) => a.id === selectedId) ?? apps[0] ?? null;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function openWorkshop() {
      try {
        const data = await api<Session>('/api/session/', { signal: controller.signal });
        if (!active) return;
        setCsrfToken(data.csrf_token);
        setSession(data);
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    void openWorkshop();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!session?.user || session.setup_required) return;
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
  }, [session?.user?.id, session?.setup_required]);
  const refreshApps = useCallback(async () => {
    if (workspaceId) {
      const next = await api<MobileApp[]>(`/api/workspaces/${workspaceId}/app_catalog/apps/`);
      if (workspaceRef.current === workspaceId) setApps(next);
    }
  }, [workspaceId]);
  const refreshModules = useCallback(async () => {
    if (workspaceId) {
      const request = ++modulesRequest.current;
      const next = await api<ModuleInfo[]>(`/api/workspaces/${workspaceId}/modules/`);
      if (workspaceRef.current === workspaceId && modulesRequest.current === request) {
        setModules(next);
      }
    }
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId) return;
    const recheck = () => {
      if (document.visibilityState === 'visible') {
        void refreshModules().catch((err) => {
          if (workspaceRef.current === workspaceId) setError(err.message);
        });
      }
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [workspaceId, refreshModules]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setApps([]);
    setModules([]);
    setSelectedId('');
    setDetailAppId('');
    setError('');
    Promise.all([
      refreshModules(),
      api<MobileApp[]>(`/api/workspaces/${workspaceId}/app_catalog/apps/`),
    ])
      .then(([, nextApps]) => {
        if (active) {
          setApps(nextApps);
        }
      })
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [workspaceId, refreshModules]);
  async function signOut() {
    try {
      const data = await api<{ csrf_token: string }>('/api/session/logout/', {
        method: 'POST',
        feedback: { success: 'Signed out.' },
      });
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
        Loading…
      </div>
    );
  if (!session)
    return (
      <main className="boot">
        <h1>Unable to connect</h1>
        <p role="alert">{error}</p>
        <button className="button secondary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  if (session.setup_required) return <Setup onComplete={setSession} />;
  if (!session.user) return <Login onLogin={setSession} />;
  const enabled = modules.filter((m) => m.enabled && m.availability !== 'planned');
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
          <label htmlFor="workspace">Workspace</label>
          <select
            id="workspace"
            value={workspaceId}
            onChange={(e) => {
              const id = e.target.value;
              void leave(() => setWorkspaceId(id));
            }}
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
                navigate(module.id);
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
            onClick={() => navigate('modules')}
            aria-current={current === 'modules' ? 'page' : undefined}
          >
            <img src="/modules/extensions.webp" alt="" />
            <span>Modules</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="edition">Community · Alpha</span>
          <a href="https://github.com/mcsedition-hub/panda-store" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <span className="breadcrumb">
            {workspace?.name ?? 'Workspace'} <span>/</span>{' '}
            {current === 'modules' ? 'Modules' : (activeModule?.name ?? 'Loading')}
          </span>
          <div className="topbar-right">
            {session.demo_mode && (
              <span className="demo-tag">
                {session.preview_mode ? 'Visual preview' : 'Demo apps available'}
              </span>
            )}
            <span className="user-name">{session.user.username}</span>
            {!session.preview_mode && (
              <button className="text-button" onClick={() => void leave(signOut)}>
                Sign out
              </button>
            )}
          </div>
        </header>
        <main id="main" className="main-content">
          {session.preview_mode && (
            <p className="notice" role="status">
              Read-only preview · Sample data
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!workspace && (
            <div className="empty">
              <h1>No workspace access</h1>
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
                selectApp={(app) => void leave(() => setSelectedId(app.id))}
                registerLeaveGuard={registerLeaveGuard}
                navigate={navigate}
                detailAppId={detailAppId}
                availableModules={enabled.map((module) => module.id)}
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
          <span>Panda Store</span>
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
