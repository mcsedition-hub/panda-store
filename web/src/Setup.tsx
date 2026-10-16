import { useState, type FormEvent } from 'react';
import { api, setCsrfToken } from './api';
import type { Session } from './contracts';

export default function Setup({ onComplete }: { onComplete: (session: Session) => void }) {
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
        setError('Give your organization a name.');
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
        body: JSON.stringify(details),
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
    <main className="login-layout setup-layout">
      <section className="login-story setup-story">
        <img className="brand" src="/brand/logo-dark.svg" alt="Panda Store" />
        <div className="login-editorial">
          <span className="eyebrow">A SPACE TO MAKE YOUR OWN</span>
          <h1>
            Your apps.
            <br />
            Your workshop.
            <br />
            <em>Your next move.</em>
          </h1>
          <p>Give your ideas a home. We’ll make room for what comes next.</p>
          <div className="setup-art" aria-hidden="true">
            <img src="/modules/applications.webp" alt="" />
            <img src="/modules/studio.webp" alt="" />
          </div>
        </div>
        <span className="login-foot">COMMUNITY EDITION · Your workshop. Your infrastructure.</span>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap setup-form-wrap">
          <ol className="setup-progress" aria-label="Setup progress">
            <li aria-current={step === 1 ? 'step' : undefined} className={step > 1 ? 'done' : ''}>
              <span>01</span> Organization
            </li>
            <li aria-current={step === 2 ? 'step' : undefined}>
              <span>02</span> Your account
            </li>
          </ol>
          <span className="eyebrow">{step === 1 ? 'FIRST, YOUR SPACE' : 'NEXT, YOUR KEY'}</span>
          <h2>{step === 1 ? 'Name your workshop.' : 'Make yourself at home.'}</h2>
          <p>
            {step === 1
              ? 'Your organization brings your apps, briefs and scripts together.'
              : `You’ll be the owner of ${details.organization_name.trim()}.`}
          </p>
          <form key={step} onSubmit={submit} aria-busy={busy}>
            {step === 1 ? (
              <label>
                Organization name
                <input
                  name="organization_name"
                  autoComplete="organization"
                  placeholder="e.g. Northstar Studio"
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
                  Username
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
                  Email
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
                    Password
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
                    Confirm password
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
                  At least 8 characters. Choose a password you don’t use elsewhere.
                </p>
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy
                ? 'Creating your workshop…'
                : step === 1
                  ? 'Continue →'
                  : 'Create my workshop →'}
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
                ← Organization
              </button>
            )}
          </form>
          <p className="setup-footnote">
            Your account and organization stay in this installation.
            <br />
            No Panda Store cloud account needed.
          </p>
        </div>
      </section>
    </main>
  );
}
