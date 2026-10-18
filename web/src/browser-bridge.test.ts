import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserCommand } from '../../addons/studio/frontend/browserBridge';

const staleError = 'Browser connector was reloaded. Refresh Panda Store and resume research.';
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function message(data: unknown, origin = location.origin, source: Window | null = window) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

it('accepts a fresh bridge response after an invalidated bridge replied first', async () => {
  const send = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  const pending = browserCommand('ping', {}, 5000);
  const { id } = send.mock.calls[0][0];
  message({ channel: 'panda-smm-response', id, error: staleError });
  message({ channel: 'panda-smm-ready' });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].id).toBe(id);
  message({ channel: 'panda-smm-response', id, result: { version: '0.1.8', protocol: 1 } });
  await expect(pending).resolves.toEqual({ version: '0.1.8', protocol: 1 });
  message({ channel: 'panda-smm-ready' });
  expect(send).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['read', 'search', 'open'])(
  'does not replay %s when the bridge reconnects',
  async (command) => {
    const send = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const pending = browserCommand(command, { session: 'existing' }, 5000);
    const { id } = send.mock.calls[0][0];
    message({ channel: 'panda-smm-response', id, error: staleError });
    message({ channel: 'panda-smm-ready' });
    expect(send).toHaveBeenCalledTimes(1);
    const rejection = expect(pending).rejects.toThrow(staleError);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('ignores foreign readiness signals and mismatched responses', async () => {
  const send = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  const pending = browserCommand('ping', {}, 5000);
  const { id } = send.mock.calls[0][0];
  message({ channel: 'panda-smm-ready' }, 'https://foreign.test');
  message({ channel: 'panda-smm-ready' }, location.origin, null);
  message({ channel: 'panda-smm-response', id: 'another', result: {} });
  expect(send).toHaveBeenCalledTimes(1);
  const rejection = expect(pending).rejects.toThrow('The browser connector did not respond.');
  await vi.advanceTimersByTimeAsync(5000);
  await rejection;
  expect(vi.getTimerCount()).toBe(0);
});
