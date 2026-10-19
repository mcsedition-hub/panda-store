import { t } from './i18n';
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, setCsrfToken } from './api';
import type { MobileApp, ModuleInfo, Session, Workspace } from './contracts';
import { moduleViews } from './modules';
import Setup from './Setup';
import UsageDashboard from './ai-usage/UsageDashboard';
import LanguagePicker from './i18n/LanguagePicker';
import { setLanguage, useLanguage } from './i18n';

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
      <img className="brand" src="/brand/logo-light.svg" alt={t('Panda Store')} />
      <section className="auth-panel">
        <LanguagePicker />
        <h1>{t('Sign in')}</h1>
        <form onSubmit={submit}>
          <label>
            {t('Username ')}
            <input name="username" autoComplete="username" required autoFocus />
          </label>
          <label>
            {t('Password ')}
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? t('Signing in…') : t('Sign in')}
          </button>
        </form>
        <a
          className="quiet-link"
          href="https://github.com/mcsedition-hub/panda-store"
          target="_blank"
          rel="noreferrer"
        >
          {t('GitHub')}
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
        <h1>{t('Manage modules')}</h1>
      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      <div className="module-grid">
        {modules
          .filter((module) => module.id !== 'example')
          .map((module) => (
            <article className={`module-card ${module.family}`} key={module.id}>
              <div className="module-card-top">
                <img src={`/modules/${module.icon}.webp`} alt="" />
                <span className={`module-status ${module.enabled ? 'enabled' : ''}`}>
                  {module.availability === 'planned'
                    ? t('Planned')
                    : module.enabled
                      ? t('Enabled')
                      : t('Disabled')}
                </span>
              </div>
              <h2>{t(module.name)}</h2>
              <p>{t(module.description)}</p>
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
                  ? t('Updating…')
                  : module.availability === 'planned'
                    ? t('Not available yet')
                    : module.required
                      ? t('Core module')
                      : module.enabled
                        ? t('Disable')
                        : t('Enable module')}
              </button>
            </article>
          ))}
      </div>
    </>
  );
}

export default function App() {
  useLanguage();
  const [session, setSession] = useState<Session | null>(null);
  const acceptSession = useCallback((next: Session) => {
    if (next.language) setLanguage(next.language);
    setSession(next);
  }, []);
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
  const [modulePage, setModulePage] = useState('');
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
  function navigate(module: string, appId = '', page = '') {
    void leave(() => {
      setCurrent(module);
      setDetailAppId(appId);
      setModulePage(page);
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
        acceptSession(data);
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
    setModulePage('');
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
        {t('Loading…')}
      </div>
    );
  if (!session)
    return (
      <main className="boot">
        <h1>{t('Unable to connect')}</h1>
        <p role="alert">{t(error)}</p>
        <button className="button secondary" onClick={() => window.location.reload()}>
          {t('Try again')}
        </button>
      </main>
    );
  if (session.setup_required) return <Setup onComplete={acceptSession} />;
  if (!session.user) return <Login onLogin={acceptSession} />;
  const enabled = modules.filter((m) => m.enabled && m.availability !== 'planned');
  const navigationModules = enabled.filter((module) => module.id !== 'example');
  const navigationGroups = [
    {
      id: 'apps',
      label: 'Apps',
      items: navigationModules.filter((module) => module.id === 'app_catalog'),
    },
    {
      id: 'modules',
      label: 'Modules',
      items: navigationModules.filter((module) => module.id !== 'app_catalog'),
    },
    {
      id: 'settings',
      label: 'Settings',
      items: [],
    },
  ];
  const activeModule = enabled.find((m) => m.id === current);
  const ModuleView = activeModule ? moduleViews[current] : null;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('Skip to content')}
      </a>
      <aside className="sidebar">
        <img className="brand" src="/brand/logo-dark.svg" alt={t('Panda Store')} />
        <div className="workspace-picker">
          <label htmlFor="workspace">{t('Workspace')}</label>
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
        <nav aria-label={t('Main navigation')}>
          {navigationGroups
            .filter((group) => group.items.length || group.id === 'settings')
            .map((group) => (
              <div key={group.id} className="nav-section" role="group" aria-label={t(group.label)}>
                <p className="nav-section-label" aria-hidden="true">
                  {t(group.label)}
                </p>
                <div className="nav-section-items">
                  {group.items.map((module) => (
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
                      <span>{t(module.name)}</span>
                    </button>
                  ))}
                  {group.id === 'settings' && (
                    <>
                      <button
                        className={`nav-item ${current === 'modules' ? 'active' : ''}`}
                        onClick={() => navigate('modules')}
                        aria-current={current === 'modules' ? 'page' : undefined}
                      >
                        <img src="/modules/extensions.webp" alt="" />
                        <span>{t('Manage modules')}</span>
                      </button>
                      <button
                        className={`nav-item ${current === 'ai-usage' ? 'active' : ''}`}
                        onClick={() => navigate('ai-usage')}
                        aria-current={current === 'ai-usage' ? 'page' : undefined}
                      >
                        <svg
                          width="30"
                          height="30"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          aria-hidden="true"
                        >
                          <path d="M4 19h16M6 15V9m6 6V4m6 11v-4" strokeLinecap="round" />
                        </svg>
                        <span>{t('AI usage')}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="edition">{t('Community · Alpha')}</span>
          <a href="https://github.com/mcsedition-hub/panda-store" target="_blank" rel="noreferrer">
            {t('GitHub')}
          </a>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <span className="breadcrumb">
            {workspace?.name ?? t('Workspace')} <span>/</span>{' '}
            {t(
              current === 'ai-usage'
                ? 'AI usage'
                : current === 'modules'
                  ? 'Manage modules'
                  : (activeModule?.name ?? 'Loading'),
            )}
          </span>
          <div className="topbar-right">
            <span className="user-name">{session.user.username}</span>
            {!session.preview_mode && (
              <button className="text-button" onClick={() => void leave(signOut)}>
                {t('Sign out')}
              </button>
            )}
          </div>
        </header>
        <main id="main" className="main-content">
          {session.preview_mode && (
            <p className="notice" role="status">
              {t('Read-only preview · Sample data')}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          {!workspace && (
            <div className="empty">
              <h1>{t('No workspace access')}</h1>
              <p>
                {t('You do not have access to a workspace yet. Ask your administrator to add you.')}
              </p>
            </div>
          )}
          {workspace && current === 'ai-usage' && (
            <UsageDashboard key={workspace.id} workspace={workspace} />
          )}
          {workspace && current === 'modules' && (
            <ModuleManager modules={modules} workspace={workspace} reload={refreshModules} />
          )}
          {workspace && current !== 'modules' && ModuleView && (
            <Suspense fallback={<p role="status">{t('Opening module…')}</p>}>
              <ModuleView
                key={`${workspaceId}:${current}`}
                workspace={workspace}
                apps={apps}
                selectedApp={selectedApp}
                selectApp={(app) => void leave(() => setSelectedId(app.id))}
                registerLeaveGuard={registerLeaveGuard}
                navigate={navigate}
                detailAppId={detailAppId}
                page={modulePage}
                availableModules={enabled.map((module) => module.id)}
                refreshApps={refreshApps}
                demoMode={session.demo_mode}
                previewMode={session.preview_mode}
              />
            </Suspense>
          )}
          {workspace && current !== 'modules' && current !== 'ai-usage' && !ModuleView && (
            <p role="status">
              {modules.length
                ? t('This module is not enabled in this workspace.')
                : t('Loading modules…')}
            </p>
          )}
        </main>
        <footer className="app-footer">
          <span>{t('Panda Store')}</span>
          <a href="https://www.gnu.org/licenses/lgpl-3.0.html" target="_blank" rel="noreferrer">
            {t('Open source · LGPLv3')}
          </a>
        </footer>
      </div>
    </div>
  );
}
