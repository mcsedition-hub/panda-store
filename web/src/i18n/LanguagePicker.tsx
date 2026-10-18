import { useState } from 'react';
import { api } from '../api';
import { setLanguage, t, useLanguage, type Language } from './index';

export default function LanguagePicker({ persist = false }: { persist?: boolean }) {
  const language = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(next: Language) {
    const previous = language;
    setError('');
    setLanguage(next);
    if (!persist) return;
    setBusy(true);
    try {
      await api('/api/session/preferences/', {
        method: 'PATCH',
        body: JSON.stringify({ language: next }),
        feedback: false,
      });
    } catch (err) {
      setLanguage(previous);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="language-picker">
      <label>
        {t('Interface language')}
        <select
          value={language}
          disabled={busy}
          onChange={(event) => void change(event.target.value as Language)}
        >
          <option value="en" lang="en">
            English
          </option>
          <option value="fr" lang="fr">
            Français
          </option>
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
