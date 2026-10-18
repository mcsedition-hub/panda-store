import { t } from '../../../web/src/i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';

type Store = 'apple' | 'google' | 'demo';
type Account = { id: string; name: string; verified_package?: string };
type StoreApp = { external_id: string; name: string; bundle_id: string };
type Catalog = { apps: StoreApp[]; next_cursor?: string | null };
type ImportProps = ModuleProps & {
  store: Store;
  busy: boolean;
  onBusy: (busy: boolean) => void;
};

function AppChoice({ account, ...props }: ImportProps & { account?: Account }) {
  const { workspace, apps, store, busy, onBusy, refreshApps, selectApp, navigate } = props;
  const prefix = store === 'google' ? 'google-play/' : '';
  const accountPath = store === 'demo' ? '' : `${prefix}connections/${account!.id}/`;
  const [catalog, setCatalog] = useState<StoreApp[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(store !== 'google');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [choice, setChoice] = useState(() => {
    const verified = account?.verified_package ?? '';
    return store === 'google' &&
      !apps.some((app) => app.platform === 'android' && app.external_id === verified)
      ? verified
      : '';
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const catalogPath = store === 'demo' ? 'catalog/' : `${accountPath}apps/`;
  useEffect(() => {
    if (store === 'google') return;
    let active = true;
    setLoading(true);
    setError('');
    setChoice('');
    setCatalog([]);
    setCursor(null);
    api<Catalog>(moduleUrl(workspace.id, 'apple_store', catalogPath))
      .then((data) => {
        if (active) {
          setCatalog(data.apps);
          setCursor(data.next_cursor ?? null);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace.id, store, catalogPath, retry]);

  async function more() {
    setLoading(true);
    setError('');
    try {
      const data = await api<Catalog>(
        moduleUrl(
          workspace.id,
          'apple_store',
          `${catalogPath}?cursor=${encodeURIComponent(cursor!)}`,
        ),
      );
      if (!mounted.current) return;
      if (data.next_cursor === cursor)
        throw new Error('Apple repeated this page. Reload the app list.');
      setCatalog((old) =>
        Array.from(new Map([...old, ...data.apps].map((app) => [app.external_id, app])).values()),
      );
      setCursor(data.next_cursor ?? null);
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  const platform = store === 'google' ? 'android' : 'ios';
  const existing = apps.find(
    (app) => app.platform === platform && app.external_id === choice.trim(),
  );
  const canOpen =
    existing &&
    (store === 'demo' ||
      existing.sync_provider === (store === 'google' ? 'google_play' : 'apple_store'));
  const query = search.trim().toLowerCase();
  const visible = catalog.filter((app) =>
    `${app.name} ${app.bundle_id}`.toLowerCase().includes(query),
  );
  const validChoice =
    store === 'google' ? !!choice.trim() : catalog.some((app) => app.external_id === choice);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || !validChoice || workspace.role === 'viewer') return;
    if (existing && canOpen) {
      selectApp(existing);
      navigate('app_catalog', existing.id);
      return;
    }
    onBusy(true);
    setError('');
    try {
      const imported = await api<MobileApp>(
        moduleUrl(workspace.id, 'apple_store', `${accountPath}import/`),
        {
          method: 'POST',
          body: JSON.stringify(
            store === 'google' ? { package_name: choice.trim() } : { external_id: choice },
          ),
          feedback: { success: 'App imported.' },
        },
      );
      await refreshApps();
      if (mounted.current) {
        selectApp(imported);
        navigate('app_catalog', imported.id);
      }
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    } finally {
      if (mounted.current) onBusy(false);
    }
  }

  return (
    <form className="app-import-form" onSubmit={submit}>
      {store === 'google' ? (
        <>
          <label>
            {t('Package name ')}
            <input
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              placeholder={t('com.example.app')}
              maxLength={200}
              required
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <p className="note">
            {t(
              'Enter the package name shown in Play Console. Your connected account needs access to this app.',
            )}
          </p>
        </>
      ) : (
        <>
          <label>
            {t('Search apps ')}
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setChoice('');
              }}
              placeholder={t('App name or bundle ID')}
              disabled={busy}
            />
          </label>
          <label>
            {t('Application ')}
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              required
              disabled={busy || loading || !visible.length}
            >
              <option value="">{t('Choose one app')}</option>
              {visible.map((app) => (
                <option key={app.external_id} value={app.external_id}>
                  {app.name} · {app.bundle_id}
                  {apps.some(
                    (saved) => saved.platform === 'ios' && saved.external_id === app.external_id,
                  )
                    ? t(' (already imported)')
                    : ''}
                </option>
              ))}
            </select>
          </label>
          {loading && (
            <p className="note" role="status">
              {t('Loading apps…')}
            </p>
          )}
          {!loading && !error && !visible.length && (
            <p className="note">
              {catalog.length ? t('No matching apps.') : t('No apps available to this key.')}
            </p>
          )}
          {cursor && (
            <button className="text-button" type="button" disabled={loading || busy} onClick={more}>
              {t('Load more apps')}
            </button>
          )}
        </>
      )}
      {existing && (
        <p className="note">
          {canOpen
            ? t('This app is already in My apps.')
            : t('Import this app to reconnect it to this account.')}
        </p>
      )}
      {error && (
        <div>
          <p className="error" role="alert">
            {t(error)}
          </p>
          {store !== 'google' && (
            <button
              className="text-button"
              type="button"
              disabled={loading || busy}
              onClick={() => setRetry((value) => value + 1)}
            >
              {t('Reload apps')}
            </button>
          )}
        </div>
      )}
      <div className="action-group">
        <button className="button primary" disabled={busy || loading || !validChoice}>
          {busy ? t('Importing…') : canOpen ? t('Open app') : t('Import selected app')}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => navigate('app_catalog')}
        >
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}

function AccountChoice(props: ImportProps) {
  const { workspace, store, busy, navigate } = props;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<{ connections: Account[] }>(
      moduleUrl(
        workspace.id,
        'apple_store',
        `${store === 'google' ? 'google-play/' : ''}connections/`,
      ),
    )
      .then((data) => {
        if (active) setAccounts(data.connections);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace.id, store, retry]);
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0];
  if (loading)
    return (
      <p className="note" role="status">
        {t('Loading accounts…')}
      </p>
    );
  if (error)
    return (
      <div>
        <p className="error" role="alert">
          {t(error)}
        </p>
        <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
          {t('Try again')}
        </button>
      </div>
    );
  if (!selected)
    return (
      <div className="app-import-empty">
        <p>
          {workspace.role === 'owner'
            ? t('Connect an account before importing an app from this store.')
            : t('Ask the workspace owner to connect an account for this store.')}
        </p>
        <button className="button secondary" onClick={() => navigate('apple_store')}>
          {t('Manage connections')}
        </button>
      </div>
    );
  return (
    <>
      <label>
        {t('Account ')}
        <select
          value={selected.id}
          disabled={busy}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <AppChoice key={selected.id} {...props} account={selected} />
    </>
  );
}

export default function ImportApp(props: ModuleProps) {
  const { workspace, navigate, demoMode } = props;
  const [store, setStore] = useState<Store>('apple');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="text-button detail-back"
        disabled={busy}
        onClick={() => navigate('app_catalog')}
      >
        {t('← My apps')}
      </button>
      <div className="page-heading">
        <h1>{t('Import an app')}</h1>
      </div>
      {workspace.role === 'viewer' ? (
        <p className="notice">{t('Only workspace owners and editors can import apps.')}</p>
      ) : (
        <section className="app-import-panel" aria-label={t('Choose an app to import')}>
          <p className="connection-help">
            {t('Choose one app to add to My apps. You can add more later.')}
          </p>
          <label>
            {t('Store ')}
            <select
              value={store}
              disabled={busy}
              onChange={(event) => setStore(event.target.value as Store)}
            >
              <option value="apple">{t('App Store')}</option>
              <option value="google">{t('Google Play')}</option>
              {demoMode && <option value="demo">{t('Demo apps')}</option>}
            </select>
          </label>
          {store === 'demo' ? (
            <AppChoice key="demo" {...props} store={store} busy={busy} onBusy={setBusy} />
          ) : (
            <AccountChoice key={store} {...props} store={store} busy={busy} onBusy={setBusy} />
          )}
        </section>
      )}
    </>
  );
}
