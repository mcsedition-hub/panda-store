import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setCsrfToken } from './api';

afterEach(() => vi.unstubAllGlobals());
describe('session API client', () => {
  it('keeps requests same-origin and sends the current CSRF token', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ saved: true })));
    vi.stubGlobal('fetch', fetcher);
    setCsrfToken('test-csrf');
    await expect(api('/api/example/', { method: 'POST' })).resolves.toEqual({ saved: true });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/example/',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-CSRFToken': 'test-csrf' }),
      }),
    );
    await expect(api('https://other.example/api/')).rejects.toThrow('Chemin API invalide');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('shows field validation errors and tolerates non-JSON outages', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { goal: ['Le but est requis.'] } }), { status: 400 }),
      )
      .mockResolvedValueOnce(new Response('<html>Offline</html>', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/api/example/')).rejects.toThrow('Le but est requis.');
    await expect(api('/api/example/')).rejects.toThrow('503');
  });
  it('accepts successful responses with no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api('/api/example/', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
