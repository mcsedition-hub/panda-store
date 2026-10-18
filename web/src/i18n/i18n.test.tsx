import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import LanguagePicker from './LanguagePicker';
import french from './fr.json';
import { getLanguage, getLocale, setLanguage, t } from './index';

vi.mock('../api', () => ({ api: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLanguage('en');
});

it('translates interface templates, server messages and spacing without changing values', () => {
  setLanguage('fr');
  expect(t('Sign in')).toBe('Se connecter');
  expect(t('{0} accounts connected', 2)).toBe('2 comptes connectés');
  expect(t('2 accounts connected')).toBe('2 comptes connectés');
  expect(t(' App name ')).toBe(' Nom de l’application ');
  expect(t('Screenshot {0}', 'Run Club')).toBe('Capture d’écran Run Club');
  expect(t('constructor')).toBe('constructor');
  expect(t('__proto__')).toBe('__proto__');
  expect(t('Screenshot from an imported listing')).toBe('Screenshot from an imported listing');
  expect(t('A user-written headline about running')).toBe('A user-written headline about running');
  expect(t('This field is required.')).toBe('Ce champ est obligatoire.');
  expect(getLocale()).toBe('fr-FR');
  setLanguage('en');
  expect(t('{0} accounts connected', 2)).toBe('2 accounts connected');
  expect(getLocale()).toBe('en-US');
});

it('preserves all interpolation slots in the French catalog', () => {
  const slots = (value: string) => [...new Set(value.match(/\{\d+\}/g) ?? [])].sort();
  for (const [key, value] of Object.entries(french)) expect(slots(value), key).toEqual(slots(key));
});

it('explains project validation failures in French with the exact measured limits', () => {
  setLanguage('fr');
  expect(
    t('The proposed subtitle contains 31 characters; the limit is 30. Retry the unfinished step.'),
  ).toBe(
    'Le champ « Sous-titre » proposé contient 31 caractères ; la limite est de 30. Réessayez l’étape inachevée.',
  );
  expect(
    t(
      'The proposed keywords contains 102 UTF-8 bytes; the limit is 100. Retry the unfinished step.',
    ),
  ).toBe(
    'Le champ « Mots-clés » proposé contient 102 octets UTF-8 ; la limite est de 100. Réessayez l’étape inachevée.',
  );
  expect(
    t(
      'A quote supporting description does not match the saved project or exceeds 2000 characters. Retry the unfinished step.',
    ),
  ).toContain('ne correspond pas exactement au projet enregistré');
  expect(
    t(
      'The sources for subtitle are invalid for this field or lack an official Apple reference. Retry the unfinished step.',
    ),
  ).toContain('ne s’appliquent pas à ce champ');
});

it('updates the document and browser preference, including changes from another tab', () => {
  render(<LanguagePicker />);
  fireEvent.change(screen.getByLabelText('Interface language'), { target: { value: 'fr' } });
  expect(document.documentElement.lang).toBe('fr');
  expect(localStorage.getItem('panda.language')).toBe('fr');
  expect(screen.getByLabelText('Langue de l’interface')).toBeTruthy();
  act(() =>
    window.dispatchEvent(new StorageEvent('storage', { key: 'panda.language', newValue: 'en' })),
  );
  expect(screen.getByLabelText('Interface language')).toBeTruthy();
  expect(document.documentElement.lang).toBe('en');
});

it('persists account preferences and restores the previous choice if saving fails', async () => {
  vi.mocked(api).mockResolvedValueOnce({ language: 'fr' });
  render(<LanguagePicker persist />);
  fireEvent.change(screen.getByLabelText('Interface language'), { target: { value: 'fr' } });
  await waitFor(() =>
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false),
  );
  expect(api).toHaveBeenCalledWith(
    '/api/session/preferences/',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ language: 'fr' }),
    }),
  );
  vi.mocked(api).mockRejectedValueOnce(new Error('This field is required.'));
  fireEvent.change(screen.getByLabelText('Langue de l’interface'), { target: { value: 'en' } });
  expect((await screen.findByRole('alert')).textContent).toBe('Ce champ est obligatoire.');
  expect(getLanguage()).toBe('fr');
});

it('keeps the language usable when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  setLanguage('fr');
  expect(t('Sign in')).toBe('Se connecter');
  expect(document.documentElement.lang).toBe('fr');
});
