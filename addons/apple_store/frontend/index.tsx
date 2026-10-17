import { useEffect, useState, type FormEvent } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { MobileApp, ModuleProps } from '../../../web/src/contracts';

interface Connection {
  id: string;
  name: string;
  key_type: 'team' | 'individual';
  key_id: string;
  issuer_id: string;
  last_checked_at: string;
}
interface StoreApp {
  external_id: string;
  name: string;
  bundle_id: string;
  locale: string;
}
interface Catalog {
  apps: StoreApp[];
  next_cursor?: string | null;
}

function KeyForm({
  workspaceId,
  connection,
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  connection: Connection | null;
  onSaved: (connection: Connection) => void;
  onCancel: () => void;
}) {
  const [keyType, setKeyType] = useState(connection?.key_type ?? 'team');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get('private_key') as File;
    setError('');
    if (!file?.size || file.size > 16384) {
      setError('Choose an Apple .p8 key smaller than 16 KB.');
      return;
    }
    setBusy(true);
    try {
      const saved = await api<Connection>(
        moduleUrl(
          workspaceId,
          'apple_store',
          `connections/${connection ? `${connection.id}/` : ''}`,
        ),
        {
          method: connection ? 'PUT' : 'POST',
          feedback: {
            success: connection ? 'Apple connection updated.' : 'Apple account connected.',
          },
          body: JSON.stringify({
            name: data.get('name'),
            key_type: keyType,
            key_id: data.get('key_id'),
            issuer_id: keyType === 'team' ? data.get('issuer_id') : null,
            private_key: await file.text(),
          }),
        },
      );
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="connection-form-panel">
      <h2>{connection ? 'Replace API key' : 'Connect Apple'}</h2>
      <p className="connection-help">
        Use an App Store Connect API key.{' '}
        <a
          href="https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/"
          target="_blank"
          rel="noreferrer"
        >
          Get a key from Apple ↗
        </a>
      </p>
      <form onSubmit={submit} className="connection-form">
        <label>
          Connection name
          <input
            name="name"
            defaultValue={connection?.name ?? ''}
            placeholder="Company or developer name"
            maxLength={100}
            required
            autoFocus
            disabled={busy}
          />
        </label>
        <label>
          Key type
          <select
            value={keyType}
            onChange={(event) => setKeyType(event.target.value as Connection['key_type'])}
            disabled={busy}
          >
            <option value="team">Team key</option>
            <option value="individual">Individual key</option>
          </select>
        </label>
        <label>
          Key ID
          <input
            name="key_id"
            defaultValue={connection?.key_id ?? ''}
            pattern="[A-Z0-9]{10}"
            maxLength={10}
            autoComplete="off"
            spellCheck={false}
            required
            disabled={busy}
          />
        </label>
        {keyType === 'team' && (
          <label>
            Issuer ID
            <input
              name="issuer_id"
              defaultValue={connection?.issuer_id ?? ''}
              autoComplete="off"
              spellCheck={false}
              required
              disabled={busy}
            />
          </label>
        )}
        <label className="key-file">
          API key (.p8)
          <input type="file" name="private_key" accept=".p8" required disabled={busy} />
        </label>
        <p className="note">
          The key is encrypted on this installation. Panda Store only reads your Apple account.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="action-group">
          <button className="button primary" disabled={busy}>
            {busy ? 'Checking with Apple…' : connection ? 'Save new key' : 'Connect Apple'}
          </button>
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

function StoreCatalog({
  connectionId,
  demo = false,
  ...props
}: ModuleProps & { connectionId?: string; demo?: boolean }) {
  const { workspace, refreshApps, selectApp, navigate } = props;
  const [apps, setApps] = useState<StoreApp[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const suffix = demo ? 'catalog/' : `connections/${connectionId}/apps/`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<Catalog>(moduleUrl(workspace.id, 'apple_store', suffix))
      .then((data) => {
        if (active) {
          setApps(data.apps);
          setCursor(data.next_cursor ?? null);
        }
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [workspace.id, suffix, retry]);
  async function more() {
    setLoading(true);
    setError('');
    try {
      const data = await api<Catalog>(
        moduleUrl(workspace.id, 'apple_store', `${suffix}?cursor=${encodeURIComponent(cursor!)}`),
      );
      setApps((old) =>
        Array.from(new Map([...old, ...data.apps].map((app) => [app.external_id, app])).values()),
      );
      if (data.next_cursor === cursor)
        throw new Error('Apple repeated this page. Reload the app list.');
      setCursor(data.next_cursor ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function importApp(id: string) {
    setBusy(id);
    setError('');
    try {
      const imported = await api<MobileApp>(
        moduleUrl(
          workspace.id,
          'apple_store',
          demo ? 'import/' : `connections/${connectionId}/import/`,
        ),
        {
          method: 'POST',
          body: JSON.stringify({ external_id: id }),
          feedback: { success: 'App imported.' },
        },
      );
      await refreshApps();
      selectApp(imported);
      navigate('app_catalog', imported.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }
  const query = search.trim().toLowerCase();
  const visible = apps.filter((app) =>
    `${app.name} ${app.bundle_id}`.toLowerCase().includes(query),
  );
  return (
    <div className="connection-catalog">
      <div className="catalog-toolbar">
        <h2>{demo ? 'Demo apps' : 'Apps in this account'}</h2>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search available apps"
          placeholder="Search loaded apps"
        />
      </div>
      {error && (
        <div className="catalog-feedback">
          <p className="error" role="alert">
            {error}
          </p>
          <button
            className="text-button"
            disabled={loading || !!busy}
            onClick={() => setRetry((old) => old + 1)}
          >
            Reload apps
          </button>
        </div>
      )}
      {loading && (
        <p className="catalog-feedback" role="status">
          Loading apps…
        </p>
      )}
      {!loading && !error && visible.length === 0 && (
        <p className="catalog-feedback">
          {apps.length ? 'No matching apps.' : 'No apps available to this key.'}
        </p>
      )}
      {visible.map((app) => (
        <article className="import-row" key={app.external_id}>
          <div className="app-monogram" aria-hidden="true">
            {app.name[0]}
          </div>
          <div className="import-info">
            <h3>{app.name}</h3>
            <p>{app.bundle_id}</p>
            <span className="note">{app.locale}</span>
          </div>
          <button
            className="button secondary"
            disabled={!!busy || workspace.role === 'viewer'}
            onClick={() => importApp(app.external_id)}
          >
            {busy === app.external_id ? 'Importing…' : 'Import'}
          </button>
        </article>
      ))}
      {cursor && (
        <div className="catalog-feedback">
          <button className="button secondary" onClick={more} disabled={loading || !!busy}>
            Load more apps
          </button>
        </div>
      )}
    </div>
  );
}

export default function Connections(props: ModuleProps) {
  const { workspace, demoMode, refreshApps } = props;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<'new' | 'replace' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [retry, setRetry] = useState(0);
  const selected = connections.find((item) => item.id === selectedId) ?? connections[0];
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<{ connections: Connection[]; credentials_ready: boolean }>(
      moduleUrl(workspace.id, 'apple_store', 'connections/'),
    )
      .then((data) => {
        if (active) {
          setConnections(data.connections);
          setReady(data.credentials_ready);
        }
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [workspace.id, retry]);
  async function disconnect() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await api(moduleUrl(workspace.id, 'apple_store', `connections/${selected.id}/`), {
        method: 'DELETE',
        feedback: { success: 'Apple account disconnected.' },
      });
      setConnections((old) => old.filter((item) => item.id !== selected.id));
      setConfirm(false);
      await refreshApps();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Connections</h1>
      </div>
      {error && (
        <div className="catalog-feedback">
          <p className="error" role="alert">
            {error}
          </p>
          <button className="text-button" onClick={() => setRetry((old) => old + 1)}>
            Try again
          </button>
        </div>
      )}
      <section className="store-connection">
        <div className="store-connection-header">
          <div>
            <span className="store-label">Apple</span>
            <h2>App Store Connect</h2>
            <p>
              {loading
                ? 'Loading connections…'
                : connections.length
                  ? `${connections.length} ${connections.length === 1 ? 'account' : 'accounts'} connected`
                  : 'No account connected'}
            </p>
          </div>
          {workspace.role === 'owner' && !form && (
            <button
              className="button primary"
              disabled={loading || !ready}
              onClick={() => {
                setForm('new');
                setConfirm(false);
              }}
            >
              Connect Apple
            </button>
          )}
        </div>
        {!loading && !error && !ready && (
          <p className="notice">
            Credential storage needs configuration by this installation’s administrator.
          </p>
        )}
        {form && (
          <KeyForm
            key={form === 'new' ? 'new' : selected?.id}
            workspaceId={workspace.id}
            connection={form === 'replace' ? selected : null}
            onCancel={() => setForm(null)}
            onSaved={(saved) => {
              setConnections((old) => [...old.filter((item) => item.id !== saved.id), saved]);
              setSelectedId(saved.id);
              setForm(null);
            }}
          />
        )}
        {selected && !form && (
          <>
            <div className="connection-account">
              <label>
                Account
                <select
                  value={selected.id}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setConfirm(false);
                  }}
                  disabled={busy}
                >
                  {connections.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="note">
                Key {selected.key_id} · {selected.key_type}
              </span>
              {workspace.role === 'owner' && (
                <div className="action-group">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setForm('replace');
                      setConfirm(false);
                    }}
                  >
                    Replace key
                  </button>
                  <button className="text-button" disabled={busy} onClick={() => setConfirm(true)}>
                    Disconnect
                  </button>
                </div>
              )}
            </div>
            {confirm && (
              <div className="disconnect-confirm">
                <p>
                  Disconnect {selected.name}? Imported apps will stay. The key will be removed from
                  Panda Store.
                </p>
                <div className="action-group">
                  <button className="button secondary" disabled={busy} onClick={disconnect}>
                    {busy ? 'Disconnecting…' : 'Confirm disconnect'}
                  </button>
                  <button className="text-button" disabled={busy} onClick={() => setConfirm(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <StoreCatalog
              key={`${selected.id}:${selected.last_checked_at}`}
              connectionId={selected.id}
              {...props}
            />
          </>
        )}
        {!selected && !loading && !form && (
          <p className="connection-footnote">
            {workspace.role === 'owner'
              ? 'Connect an API key to choose which iOS apps to import.'
              : 'The workspace owner can connect an Apple account.'}
          </p>
        )}
      </section>
      {demoMode && (
        <section className="demo-catalog">
          <button
            className="text-button"
            aria-expanded={showDemo}
            onClick={() => setShowDemo((value) => !value)}
          >
            {showDemo ? 'Hide demo apps' : 'Try with demo apps'}
          </button>
          {showDemo && (
            <>
              <p className="note">Fictional apps included with Panda Store.</p>
              <StoreCatalog demo {...props} />
            </>
          )}
        </section>
      )}
    </>
  );
}
