/* Only the local dashboard can invoke the fixed research commands. No cookies or keys cross. */
(() => {
  if (
    ![
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://127.0.0.1:8000',
      'http://localhost:8000',
      'http://127.0.0.1:8080',
      'http://localhost:8080',
    ].includes(location.origin) ||
    window !== window.top
  )
    return;
  window.addEventListener('message', async (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== 'panda-smm-request' ||
      typeof event.data.id !== 'string'
    )
      return;
    const { id, command, payload } = event.data;
    try {
      const response = await chrome.runtime.sendMessage({ command, payload });
      window.postMessage({ channel: 'panda-smm-response', id, ...response }, location.origin);
    } catch {
      window.postMessage(
        {
          channel: 'panda-smm-response',
          id,
          error: 'Browser connector was reloaded. Refresh Panda Store and resume research.',
        },
        location.origin,
      );
    }
  });
})();
