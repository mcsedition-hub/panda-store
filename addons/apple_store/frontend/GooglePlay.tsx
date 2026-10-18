import { t } from '../../../web/src/i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { ModuleProps } from '../../../web/src/contracts';

type Connection = {
  id: string;
  name: string;
  client_email: string;
  project_id: string;
  verified_package: string;
  revision: string;
  last_checked_at: string;
};

function endpoint(workspaceId: string, suffix = '') {
  return moduleUrl(workspaceId, 'apple_store', `google-play/connections/${suffix}`);
}

function KeyForm({
  workspaceId,
  connection,
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  connection?: Connection;
  onSaved: (connection: Connection) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get('service_account') as File;
    setError('');
    if (!file?.size || file.size > 32768) {
      setError('Choose a Google service account JSON key smaller than 32 KB.');
      return;
    }
    setBusy(true);
    try {
      const saved = await api<Connection>(
        endpoint(workspaceId, connection ? `${connection.id}/` : ''),
        {
          method: connection ? 'PUT' : 'POST',
          feedback: {
            success: connection ? 'Google Play connection updated.' : 'Google Play connected.',
          },
          body: JSON.stringify({
            name: data.get('name'),
            package_name: data.get('package_name'),
            service_account_json: await file.text(),
            dedicated_account: data.get('dedicated_account') === 'on',
            revision: connection?.revision ?? null,
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
      <h3>
        {connection ? t('Replace Google Play credentials') : t('Connect a Google Play account')}
      </h3>
      <p className="connection-help">
        {t(
          'Enable the Google Play Android Developer API in Google Cloud. Create a service account, invite its email in Play Console and grant access to your app and store listing.',
        )}{' '}
        <a
          href="https://developers.google.com/android-publisher/getting_started"
          target="_blank"
          rel="noreferrer"
        >
          {t('Google setup guide')}
        </a>
      </p>
      <form onSubmit={submit} className="connection-form">
        <label>
          {t('Google connection name ')}
          <input
            name="name"
            defaultValue={connection?.name ?? ''}
            maxLength={100}
            placeholder={t('Company or developer name')}
            required
            autoFocus
            disabled={busy}
          />
        </label>
        <label>
          {t('Package name to verify ')}
          <input
            name="package_name"
            defaultValue={connection?.verified_package ?? ''}
            placeholder={t('com.example.app')}
            maxLength={200}
            required
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="key-file">
          {t('Service account JSON ')}
          <input
            type="file"
            name="service_account"
            accept=".json,application/json"
            required
            disabled={busy}
          />
        </label>
        <label className="google-dedicated-account">
          <input type="checkbox" name="dedicated_account" required disabled={busy} />
          {t(' This service account is dedicated to Panda Store.')}
        </label>
        <p className="note">
          {t(
            'Google opens a temporary edit to read the listing, which can replace another edit by the same service account. Panda Store closes its edit without publishing changes. Your JSON key is stored encrypted.',
          )}
        </p>
        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="action-group">
          <button className="button primary" disabled={busy}>
            {busy
              ? t('Checking with Google Play…')
              : connection
                ? t('Save Google key')
                : t('Connect Google Play')}
          </button>
          <button className="button secondary" type="button" onClick={onCancel} disabled={busy}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function GooglePlay(props: ModuleProps) {
  const { workspace, refreshApps } = props;
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
    api<{ connections: Connection[]; credentials_ready: boolean }>(endpoint(workspace.id))
      .then((data) => {
        if (active) {
          setConnections(data.connections);
          setReady(data.credentials_ready);
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
  }, [workspace.id, retry]);
  async function disconnect() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await api(endpoint(workspace.id, `${selected.id}/`), {
        method: 'DELETE',
        feedback: { success: 'Google Play disconnected.' },
      });
      setConnections((items) => items.filter((item) => item.id !== selected.id));
      setConfirm(false);
      await refreshApps();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="store-connection" aria-label={t('Google Play connection')}>
      <div className="store-connection-header">
        <div>
          <span className="store-label">{t('Google')}</span>
          <h2>{t('Google Play Console')}</h2>
          <p>
            {loading
              ? t('Loading Google connections…')
              : connections.length
                ? connections.length === 1
                  ? t('{0} Google Play account connected', connections.length)
                  : t('{0} Google Play accounts connected', connections.length)
                : t('No Google Play account connected')}
          </p>
        </div>
        {workspace.role === 'owner' && !form && (
          <button
            className="button primary"
            disabled={loading || !ready || !!error}
            onClick={() => {
              setForm('new');
              setConfirm(false);
            }}
          >
            {t('Connect Google Play')}
          </button>
        )}
      </div>
      {error && (
        <div className="catalog-feedback">
          <p className="error" role="alert">
            {t(error)}
          </p>
          <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
            {t('Reload Google connections')}
          </button>
        </div>
      )}
      {!loading && !error && !ready && (
        <p className="connection-footnote">
          {t('Credential storage needs configuration by this installation’s administrator.')}
        </p>
      )}
      {form && (
        <KeyForm
          key={form === 'new' ? 'new' : selected?.id}
          workspaceId={workspace.id}
          connection={form === 'replace' ? selected : undefined}
          onCancel={() => setForm(null)}
          onSaved={(saved) => {
            setConnections((items) => [...items.filter((item) => item.id !== saved.id), saved]);
            setSelectedId(saved.id);
            setForm(null);
          }}
        />
      )}
      {selected && !form && (
        <>
          <div className="connection-account">
            <label>
              {t('Google Play account ')}
              <select
                value={selected.id}
                disabled={busy}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setConfirm(false);
                }}
              >
                {connections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="note google-account-email">{selected.client_email}</span>
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
                  {t('Replace Google key')}
                </button>
                <button className="text-button" disabled={busy} onClick={() => setConfirm(true)}>
                  {t('Disconnect Google Play')}
                </button>
              </div>
            )}
          </div>
          {confirm && (
            <div className="disconnect-confirm">
              <p>
                {t('Disconnect ')}
                {selected.name}
                {t('? Imported apps will stay. The Google key will be removed from Panda Store.')}
              </p>
              <div className="action-group">
                <button className="button secondary" disabled={busy} onClick={disconnect}>
                  {busy ? t('Disconnecting…') : t('Confirm Google disconnect')}
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
            ? t('Connect a dedicated service account to import Android apps.')
            : t('The workspace owner can connect a Google Play account.')}
        </p>
      )}
    </section>
  );
}
