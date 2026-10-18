import { t } from './i18n';
import { useState, type FormEvent } from 'react';
import { api, setCsrfToken } from './api';
import type { Session } from './contracts';
import LanguagePicker from './i18n/LanguagePicker';
import { useLanguage } from './i18n';

export default function Setup({ onComplete }: { onComplete: (session: Session) => void }) {
  const language = useLanguage();
  const [step, setStep] = useState(1);
  const [details, setDetails] = useState({
    organization_name: '',
    username: '',
    email: '',
    password: '',
    password_confirmation: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field: keyof typeof details, value: string) {
    setDetails((old) => ({ ...old, [field]: value }));
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (step === 1) {
      if (!details.organization_name.trim()) {
        setError('Enter an organization name.');
        return;
      }
      setStep(2);
      return;
    }
    if (details.password !== details.password_confirmation) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const session = await api<Session>('/api/setup/', {
        method: 'POST',
        feedback: { success: 'Workspace created.' },
        body: JSON.stringify({ ...details, language }),
      });
      setCsrfToken(session.csrf_token);
      onComplete(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <img className="brand" src="/brand/logo-light.svg" alt={t('Panda Store')} />
      <section className="auth-panel setup-panel">
        <LanguagePicker />
        <ol className="setup-progress" aria-label={t('Setup progress')}>
          <li aria-current={step === 1 ? 'step' : undefined} className={step > 1 ? 'done' : ''}>
            {t('Organization')}
          </li>
          <li aria-current={step === 2 ? 'step' : undefined}>{t('Your account')}</li>
        </ol>
        <h1>{step === 1 ? t('Set up Panda Store') : t('Create your account')}</h1>
        <form key={step} onSubmit={submit} aria-busy={busy}>
          {step === 1 ? (
            <label>
              {t('Organization name ')}
              <input
                name="organization_name"
                autoComplete="organization"
                value={details.organization_name}
                onChange={(event) => update('organization_name', event.target.value)}
                maxLength={100}
                required
                autoFocus
              />
            </label>
          ) : (
            <>
              <label>
                {t('Username ')}
                <input
                  name="username"
                  autoComplete="username"
                  value={details.username}
                  onChange={(event) => update('username', event.target.value)}
                  maxLength={150}
                  required
                  autoFocus
                  disabled={busy}
                />
              </label>
              <label>
                {t('Email ')}
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={details.email}
                  onChange={(event) => update('email', event.target.value)}
                  maxLength={254}
                  required
                  disabled={busy}
                />
              </label>
              <div className="setup-passwords">
                <label>
                  {t('Password ')}
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    value={details.password}
                    onChange={(event) => update('password', event.target.value)}
                    minLength={8}
                    maxLength={1024}
                    aria-describedby="password-hint"
                    required
                    disabled={busy}
                  />
                </label>
                <label>
                  {t('Confirm password ')}
                  <input
                    name="password_confirmation"
                    type="password"
                    autoComplete="new-password"
                    value={details.password_confirmation}
                    onChange={(event) => update('password_confirmation', event.target.value)}
                    minLength={8}
                    maxLength={1024}
                    required
                    disabled={busy}
                  />
                </label>
              </div>
              <p className="field-hint" id="password-hint">
                {t('At least 8 characters.')}
              </p>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? t('Creating account…') : step === 1 ? t('Continue') : t('Create account')}
          </button>
          {step === 2 && (
            <button
              className="text-button setup-back"
              type="button"
              disabled={busy}
              onClick={() => {
                setError('');
                setStep(1);
              }}
            >
              {t('Back')}
            </button>
          )}
        </form>
        <p className="setup-footnote">{t('Account data is stored on this server.')}</p>
      </section>
    </main>
  );
}
