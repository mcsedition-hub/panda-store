import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Workspace } from '../contracts';
import { getLocale, t } from '../i18n';
import { count, money, providerNames } from './format';
import type { Budget, UsageCall, UsageDashboardData, UsageTotals } from './types';

const fields = [
  ['monthly_usd', 'Monthly budget (USD)'],
  ['operation_usd', 'Budget per operation (USD)'],
  ['monthly_tokens', 'Monthly token limit'],
  ['operation_tokens', 'Token limit per operation'],
] as const;
const date = (value: string) =>
  new Date(value).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });

function BudgetForm({
  budget,
  base,
  onSaved,
}: {
  budget: Budget;
  base: string;
  onSaved: () => void;
}) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map(([key]) => [key, String(budget[key] ?? '')])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(base + 'limits/', {
        method: 'PUT',
        body: JSON.stringify({
          revision: budget.revision,
          ...Object.fromEntries(
            fields.map(([key]) => [
              key,
              values[key] === ''
                ? null
                : key.endsWith('tokens')
                  ? Number(values[key])
                  : values[key],
            ]),
          ),
        }),
        feedback: { success: 'AI limits saved.' },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="usage-budget-form">
      <p className="note">
        {t('Only the limits you set are enforced. Each field marked No limit stays unrestricted.')}
      </p>
      <p className="note">
        {t(
          'Leave a field empty to disable its limit. Zero blocks new paid calls or tokens. Limits apply to the whole workspace; retries share the original operation budget.',
        )}
      </p>
      <div className="usage-filters">
        {fields.map(([key, label]) => (
          <label key={key}>
            {t(label)}
            <input
              type="number"
              min="0"
              max={key.endsWith('tokens') ? '1000000000000' : '99999999'}
              step={key.endsWith('tokens') ? '1' : '0.000001'}
              placeholder={t('No limit')}
              value={values[key]}
              onChange={(event) => setValues({ ...values, [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <p className="note">
        {t(
          'Before every call, Panda reserves an allowance for the input and maximum output. New calls stop if that allowance exceeds a limit. Calls already sent may still be billed; these estimates do not replace provider billing controls.',
        )}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {t(busy ? 'Saving…' : 'Save AI limits')}
      </button>
    </form>
  );
}

function ReconcileForm({
  call,
  base,
  onSaved,
}: {
  call: UsageCall;
  base: string;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api(base + call.id + '/reconcile/', {
        method: 'POST',
        body: JSON.stringify({
          cost_usd: form.get('cost'),
          input_tokens: Number(form.get('input')),
          output_tokens: Number(form.get('output')),
          confirmed: form.has('confirmed'),
        }),
        feedback: { success: 'Provider amounts recorded.' },
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="usage-reconcile">
      <summary>{t('Reconcile with provider billing')}</summary>
      <form onSubmit={submit}>
        <p className="note">
          {t(
            'Check this specific request in your provider account. Enter its final cost and tokens, including zero if the provider confirms no charge. This releases the reservation and keeps a record of your adjustment.',
          )}
        </p>
        <div className="usage-filters">
          <label>
            {t('Confirmed cost (USD)')}
            <input name="cost" type="number" min="0" step="0.00000001" required />
          </label>
          <label>
            {t('Input tokens')}
            <input
              name="input"
              type="number"
              min="0"
              step="1"
              required
              defaultValue={call.input_tokens ?? ''}
              readOnly={call.input_tokens !== null}
            />
          </label>
          <label>
            {t('Output tokens')}
            <input
              name="output"
              type="number"
              min="0"
              step="1"
              required
              defaultValue={call.output_tokens ?? ''}
              readOnly={call.output_tokens !== null}
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input type="checkbox" name="confirmed" required />
          {t('I checked these amounts with the provider.')}
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button secondary" disabled={busy}>
          {t('Record confirmed amounts')}
        </button>
      </form>
    </details>
  );
}

function Cost({ value }: { value: UsageTotals }) {
  return (
    <>
      {money(value.cost_usd)}
      {(value.unpriced > 0 || value.unknown > 0) && (
        <small className="usage-partial">{t('Partial')}</small>
      )}
    </>
  );
}

export default function UsageDashboard({ workspace }: { workspace: Workspace }) {
  const base = `/api/workspaces/${workspace.id}/ai-usage/`;
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [provider, setProvider] = useState('');
  const [app, setApp] = useState('');
  const [module, setModule] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<UsageDashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [poll, setPoll] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const request = ++sequence.current;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ month, offset: String(offset) });
    if (provider) query.set('provider', provider);
    if (app) query.set('app', app);
    if (module) query.set('module', module);
    api<UsageDashboardData>(base + '?' + query, { signal: controller.signal, feedback: false })
      .then((next) => {
        if (request === sequence.current) setData(next);
      })
      .catch((err) => {
        if (!controller.signal.aborted && request === sequence.current)
          setError((err as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted && request === sequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [base, month, provider, app, module, offset, revision, poll]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setPoll((value) => value + 1);
    }, 15000);
    return () => clearInterval(timer);
  }, []);
  const change = (setter: (value: string) => void, value: string) => {
    setter(value);
    setOffset(0);
    setShowAll(false);
    setData(null);
  };
  return (
    <div className="usage-page">
      <div className="usage-heading">
        <div>
          <p className="eyebrow">{t('Workspace')}</p>
          <h1>{t('AI usage')}</h1>
          <p>{t('Follow ASO and SMM tokens, estimated costs and spending limits.')}</p>
        </div>
        <button className="button secondary" onClick={refresh} disabled={loading}>
          {t('Refresh usage')}
        </button>
      </div>
      <div className="usage-filters">
        <label>
          {t('Month (UTC)')}
          <select value={month} onChange={(event) => change(setMonth, event.target.value)}>
            {[
              ...new Set([
                month,
                ...(data?.months ?? []),
                ...Array.from({ length: 12 }, (_, index) => {
                  const now = new Date();
                  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1))
                    .toISOString()
                    .slice(0, 7);
                }),
              ]),
            ]
              .sort()
              .reverse()
              .map((value) => (
                <option key={value} value={value}>
                  {new Date(value + '-01T00:00:00Z').toLocaleDateString(getLocale(), {
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t('Application')}
          <select value={app} onChange={(event) => change(setApp, event.target.value)}>
            <option value="">{t('All applications')}</option>
            {data?.apps.map((item) => (
              <option key={item.id + item.name} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('AI provider')}
          <select value={provider} onChange={(event) => change(setProvider, event.target.value)}>
            <option value="">{t('All providers')}</option>
            {Object.entries(providerNames).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Module')}
          <select value={module} onChange={(event) => change(setModule, event.target.value)}>
            <option value="">{t('All modules')}</option>
            <option value="aso">ASO</option>
            <option value="studio">SMM</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && !data && <p role="status">{t('Loading usage…')}</p>}
      {data && (
        <>
          <div className="usage-stats">
            <article>
              <span>{t('Estimated cost (USD)')}</span>
              <strong>
                <Cost value={data.summary} />
              </strong>
              <small>{t('Selected month and filters')}</small>
            </article>
            <article>
              <span>{t('Tokens used')}</span>
              <strong>{count(data.summary.tokens)}</strong>
              <small>
                {count(data.summary.input_tokens)} {t('input')} ·{' '}
                {count(data.summary.output_tokens)} {t('output')}
              </small>
            </article>
            <article>
              <span>{t('Reserved allowance')}</span>
              <strong>{money(data.summary.reserved_usd)}</strong>
              <small>
                {count(data.summary.reserved_tokens)} {t('tokens reserved')}
              </small>
            </article>
            <article>
              <span>{t('AI calls')}</span>
              <strong>{count(data.summary.calls)}</strong>
              <small>
                {count(data.summary.pending)} {t('in progress')} ·{' '}
                {t('{0} costs unknown', data.summary.unpriced)}
                {data.summary.unknown > 0 && (
                  <> · {t('{0} usages unconfirmed', data.summary.unknown)}</>
                )}
              </small>
            </article>
          </div>
          <p className="note usage-estimate-note">
            {t('Estimated spending in Panda, not an invoice or your remaining provider credit.')}
          </p>
          <details className="usage-explanation">
            <summary>
              {t('How these amounts are calculated')}
              {data.summary.historical > 0 && <> · {t('Partial history')}</>}
            </summary>
            <p className="note">
              {t(
                'Costs use published paid API prices in USD. Free tiers, discounts, taxes and spending outside Panda are not included. This is not your provider account balance.',
              )}
            </p>
            {data.summary.historical > 0 && (
              <p className="usage-notice">
                {t(
                  'Partial history: saved token counters were recovered from earlier tasks. Missing or failed calls and cache details cannot all be reconstructed. Historical costs are estimates using the reviewed price list.',
                )}
              </p>
            )}
            {(data.summary.unknown > 0 || data.summary.unpriced > 0) && (
              <p className="usage-notice">
                {t(
                  'Some costs or token counts are unknown. They are not treated as free. Open Call details to review reservations and reconcile missing amounts.',
                )}
              </p>
            )}
          </details>
          <section className="usage-section" aria-labelledby="usage-limits-title">
            <h2 id="usage-limits-title">{t('Budgets and limits')}</h2>
            <p className="note">
              {t(
                'Current calendar month (UTC), all applications and providers. Pending reservations from earlier months remain included.',
              )}
            </p>
            <div className="usage-budget-status">
              <span>
                {t('Monthly budget')}:{' '}
                <strong>
                  {data.budget.monthly_usd === null
                    ? t('No limit')
                    : money(data.budget.monthly_usd)}
                </strong>
              </span>
              <span>
                {t('Spent and reserved')}:{' '}
                <strong>
                  {money(
                    Number(data.current_month.cost_usd) + Number(data.current_month.reserved_usd),
                  )}
                </strong>
              </span>
              {data.budget.monthly_usd !== null && (
                <span>
                  {t('Remaining Panda budget')}:{' '}
                  <strong>
                    {data.current_month.unpriced > (data.current_month.historical_unpriced ?? 0)
                      ? t('Unknown')
                      : money(
                          Math.max(
                            0,
                            Number(data.budget.monthly_usd) -
                              Number(data.current_month.cost_usd) -
                              Number(data.current_month.reserved_usd),
                          ),
                        )}
                  </strong>
                  {data.current_month.historical_unpriced > 0 && (
                    <small className="usage-partial">{t('Partial estimate')}</small>
                  )}
                </span>
              )}
              <span>
                {t('Per operation')}:{' '}
                <strong>
                  {data.budget.operation_usd === null
                    ? t('No limit')
                    : money(data.budget.operation_usd)}
                </strong>
              </span>
            </div>
            {data.current_month.historical_unpriced > 0 && (
              <p className="usage-notice" role="status">
                {t(
                  '{0} earlier calls have an unknown cost. They remain in your history without blocking new calls. Budget checks use known estimated costs and reservations; these missing historical charges are not included.',
                  data.current_month.historical_unpriced,
                )}
              </p>
            )}
            {data.alerts.length > 0 && (
              <p className="usage-notice" role="status">
                {t(
                  'At least 80% of a monthly limit is used or reserved. Review your remaining budget before starting another task.',
                )}
              </p>
            )}
            {workspace.role === 'owner' ? (
              <details>
                <summary>{t('Configure AI limits')}</summary>
                <BudgetForm
                  key={data.budget.revision}
                  budget={data.budget}
                  base={base}
                  onSaved={refresh}
                />
              </details>
            ) : (
              <p className="note">{t('Only the workspace owner can change AI limits.')}</p>
            )}
          </section>
          <div className="usage-breakdowns">
            {[
              {
                title: 'By provider',
                rows: data.by_provider.map((row) => ({
                  ...row,
                  name: providerNames[row.provider] || row.provider,
                  key: row.provider,
                })),
              },
              {
                title: 'By application',
                rows: data.by_app.map((row) => ({
                  ...row,
                  name: row.app_name || t('Connections'),
                  key: row.app_id,
                })),
              },
            ].map((group) => (
              <section className="usage-section" key={group.title}>
                <h2>{t(group.title)}</h2>
                {group.rows.length ? (
                  <ul className="usage-breakdown">
                    {group.rows.map((row) => (
                      <li key={row.key}>
                        <span>
                          {row.name}
                          <small>
                            {count(row.tokens)} {t('tokens')} · {count(row.calls)} {t('calls')}
                          </small>
                        </span>
                        <strong>
                          <Cost value={row} />
                        </strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="note">{t('No AI calls recorded for this period.')}</p>
                )}
              </section>
            ))}
          </div>
          <section className="usage-section">
            <h2>{t('By operation')}</h2>
            <p className="note">
              {t(
                'Each audit, research session or script generation includes its reviews and retries. Amounts below follow the selected month and filters.',
              )}
            </p>
            <div className="usage-table-wrap">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>{t('Operation')}</th>
                    <th>{t('Application')}</th>
                    <th>{t('AI calls')}</th>
                    <th>{t('Tokens used')}</th>
                    <th>{t('Estimated cost (USD)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.operations.slice(0, showAll ? 100 : 8).map((row) => (
                    <tr key={row.key}>
                      <td>
                        <strong>{t(row.label)}</strong>
                        <small>
                          {date(row.last_at)} · {row.key.split(':').at(-1)?.slice(0, 8)}
                        </small>
                      </td>
                      <td>{row.app_name || '—'}</td>
                      <td>{row.calls}</td>
                      <td>{count(row.tokens)}</td>
                      <td>
                        <Cost value={row} />
                        {row.pending + row.unknown > 0 && (
                          <small>
                            {money(row.reserved_usd)} {t('reserved')}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.operations.length === 0 && (
              <p className="note">{t('No AI calls recorded for this period.')}</p>
            )}
            {data.operations.length > 8 && (
              <button className="text-button" onClick={() => setShowAll(!showAll)}>
                {t(showAll ? 'Show fewer operations' : 'Show more operations')}
              </button>
            )}
            {data.operation_count > 100 && (
              <p className="note">
                {t('Showing the 100 most recent operations. Narrow the filters to see more.')}
              </p>
            )}
          </section>
          <section className="usage-section">
            <details>
              <summary>
                {t('Call details')} · {data.summary.calls}
              </summary>
              <div className="usage-calls">
                {data.calls.map((call) => (
                  <article key={call.id} className="usage-call">
                    <div className="usage-call-title">
                      <div>
                        <strong>
                          {providerNames[call.provider] || call.provider} · {call.model}
                        </strong>
                        <small>
                          {t(call.label)} · {call.app_name} · {date(call.created_at)}
                        </small>
                        <small>
                          {t('Call ID')}: {call.id}
                        </small>
                      </div>
                      <strong>{money(call.cost_usd)}</strong>
                    </div>
                    <p>
                      {t(
                        call.status === 'pending'
                          ? 'Request in progress'
                          : call.status === 'unknown'
                            ? 'Usage not confirmed by provider'
                            : call.status === 'reconciled'
                              ? 'Manually reconciled'
                              : 'Provider usage recorded',
                      )}
                      {call.historical ? ` · ${t('Partial history')}` : ''}
                    </p>
                    <dl className="usage-token-detail">
                      {[
                        ['Input tokens', call.input_tokens],
                        ['Output tokens', call.output_tokens],
                        ['Cached input', call.cached_tokens],
                        ['Cache writes', call.cache_write_tokens],
                        ['Reasoning included in output', call.reasoning_tokens],
                      ].map(([label, value]) => (
                        <div key={label as string}>
                          <dt>{t(label as string)}</dt>
                          <dd>{count(value as number | null)}</dd>
                        </div>
                      ))}
                    </dl>
                    {['pending', 'unknown'].includes(call.status) && (
                      <p className="note">
                        {t('Reserved allowance')}: {money(call.reserved_usd)} ·{' '}
                        {count(call.reserved_tokens)} {t('tokens')}
                      </p>
                    )}
                    {call.price.source && (
                      <a href={call.price.source} target="_blank" rel="noreferrer">
                        {t('Official price source')} · {call.price.verified_at}
                      </a>
                    )}
                    {call.can_reconcile && workspace.role === 'owner' && (
                      <ReconcileForm call={call} base={base} onSaved={refresh} />
                    )}
                  </article>
                ))}
              </div>
              <div className="usage-pagination">
                <button
                  className="button secondary"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  {t('Previous calls')}
                </button>
                <span>
                  {data.calls.length ? offset + 1 : 0}–{offset + data.calls.length} /{' '}
                  {data.summary.calls}
                </span>
                <button
                  className="button secondary"
                  disabled={data.next_offset === null || loading}
                  onClick={() => setOffset(data.next_offset ?? 0)}
                >
                  {t('Next calls')}
                </button>
              </div>
            </details>
          </section>
          <section className="usage-section">
            <h2>{t('Provider billing')}</h2>
            <p className="note">
              {t(
                'Check the real account balance and invoices in each provider console. Panda does not receive your remaining prepaid credit through the connected model APIs.',
              )}
            </p>
            <div className="usage-provider-links">
              {Object.entries({
                openai: 'https://platform.openai.com',
                google: 'https://aistudio.google.com',
                anthropic: 'https://platform.claude.com',
                zai: 'https://z.ai/manage-apikey/apikey-list',
              }).map(([key, url]) => (
                <a
                  className="button secondary"
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {providerNames[key]} ↗
                </a>
              ))}
            </div>
            <details>
              <summary>{t('Price sources and scope')}</summary>
              <p className="note">
                {t('Prices verified on')} {data.prices_verified_at}.{' '}
                {t(
                  'Unlisted models have an unknown cost and cannot be used with a monetary limit. Historical data is partial. Provider web search is unavailable while limits are enabled because its tool fees cannot be reserved reliably; SMM browser research remains available.',
                )}
              </p>
              <div className="usage-provider-links">
                {Object.entries(data.sources).map(([key, url]) => (
                  <a key={key} href={url} target="_blank" rel="noreferrer">
                    {providerNames[key]}
                  </a>
                ))}
              </div>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
