import { afterEach, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { money } from './format';
afterEach(() => setLanguage('en'));
it('rounds French dollar amounts to cents so 4.1675 cannot look like thousands', () => {
  setLanguage('fr');
  expect(money('4.1675')).toMatch(/^4,17\s\$US$/);
  expect(money('0')).toMatch(/^0,00\s\$US$/);
  expect(money('0.000001')).toMatch(/^< 0,01\s\$US$/);
  expect(money(null)).toBe('Inconnu');
});
it('uses the same two-decimal policy in English', () => {
  setLanguage('en');
  expect(money('4.1675')).toBe('$4.17');
});
