import { t } from '../../../web/src/i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { ModuleProps } from '../../../web/src/contracts';
import GooglePlay from './GooglePlay';
import ImportApp from './ImportApp';

interface Connection {
  id: string;
  name: string;
  key_type: 'team' | 'individual';
  key_id: string;
  issuer_id: string;
  last_checked_at: string;
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
      <h2>{connection ? t('Replace API key') : t('Connect Apple')}</h2>
      <p className="connection-help">
        {t('Use an App Store Connect API key.')}{' '}
        <a
          href="https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/"
          target="_blank"
          rel="noreferrer"
        >
          {t('Get a key from Apple ↗')}
        </a>
      </p>
      <form onSubmit={submit} className="connection-form">
        <label>
          {t('Connection name ')}
          <input
            name="name"
            defaultValue={connection?.name ?? ''}
            placeholder={t('Company or developer name')}
            maxLength={100}
            required
            autoFocus
            disabled={busy}
          />
        </label>
        <label>
          {t('Key type ')}
          <select
            value={keyType}
            onChange={(event) => setKeyType(event.target.value as Connection['key_type'])}
            disabled={busy}
          >
            <option value="team">{t('Team key')}</option>
            <option value="individual">{t('Individual key')}</option>
          </select>
        </label>
        <label>
          {t('Key ID ')}
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
            {t('Issuer ID ')}
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
          {t('API key (.p8)')}
          <input type="file" name="private_key" accept=".p8" required disabled={busy} />
        </label>
        <p className="note">
          {t(
            'The key is encrypted on this installation. Panda Store only reads your Apple account.',
          )}
        </p>
        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="action-group">
          <button className="button primary" disabled={busy}>
            {busy ? t('Checking with Apple…') : connection ? t('Save new key') : t('Connect Apple')}
          </button>
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function Connections(props: ModuleProps) {
  return props.page === 'import' ? <ImportApp {...props} /> : <ConnectionSettings {...props} />;
}

function ConnectionSettings(props: ModuleProps) {
  const { workspace, refreshApps, navigate } = props;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<'new' | 'replace' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
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
      <div className="page-heading heading-split">
        <h1>{t('Connections')}</h1>
        {workspace.role !== 'viewer' && (
          <button
            className="button primary"
            onClick={() => navigate('apple_store', undefined, 'import')}
          >
            {t('Import an app')}
          </button>
        )}
      </div>
      {error && (
        <div className="catalog-feedback">
          <p className="error" role="alert">
            {t(error)}
          </p>
          <button className="text-button" onClick={() => setRetry((old) => old + 1)}>
            {t('Try again')}
          </button>
        </div>
      )}
      <section className="store-connection">
        <div className="store-connection-header">
          <div>
            <span className="store-label">{t('Apple')}</span>
            <h2>{t('App Store Connect')}</h2>
            <p>
              {loading
                ? t('Loading connections…')
                : connections.length
                  ? connections.length === 1
                    ? t('{0} account connected', connections.length)
                    : t('{0} accounts connected', connections.length)
                  : t('No account connected')}
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
              {t('Connect Apple')}
            </button>
          )}
        </div>
        {!loading && !error && !ready && (
          <p className="notice">
            {t('Credential storage needs configuration by this installation’s administrator.')}
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
                {t('Account ')}
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
                {t('Key ')}
                {selected.key_id} · {t(selected.key_type)}
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
                    {t('Replace key')}
                  </button>
                  <button className="text-button" disabled={busy} onClick={() => setConfirm(true)}>
                    {t('Disconnect')}
                  </button>
                </div>
              )}
            </div>
            {confirm && (
              <div className="disconnect-confirm">
                <p>
                  {t('Disconnect ')}
                  {selected.name}
                  {t('? Imported apps will stay. The key will be removed from Panda Store.')}
                </p>
                <div className="action-group">
                  <button className="button secondary" disabled={busy} onClick={disconnect}>
                    {busy ? t('Disconnecting…') : t('Confirm disconnect')}
                  </button>
                  <button className="text-button" disabled={busy} onClick={() => setConfirm(false)}>
                    {t('Cancel')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {!selected && !loading && !form && (
          <p className="connection-footnote">
            {workspace.role === 'owner'
              ? t('Connect an API key to choose which iOS apps to import.')
              : t('The workspace owner can connect an Apple account.')}
          </p>
        )}
      </section>
      <GooglePlay {...props} />
    </>
  );
}
