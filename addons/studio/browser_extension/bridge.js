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
  // Re-injection must replace the bridge, never duplicate a research command.
  if (globalThis.pandaSmmBridgeListener)
    window.removeEventListener('message', globalThis.pandaSmmBridgeListener);
  const receive = async (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== 'panda-smm-request' ||
      typeof event.data.id !== 'string'
    )
      return;
    const { id, command, payload } = event.data;
    try {
      if (!chrome.runtime.id) return;
      const response = await chrome.runtime.sendMessage({ command, payload });
      if (!response || typeof response !== 'object') throw new Error('Missing worker response');
      window.postMessage({ channel: 'panda-smm-response', id, ...response }, location.origin);
    } catch {
      window.postMessage(
        {
          channel: 'panda-smm-response',
          id,
          error: 'Connection to Panda SMM Browser was interrupted. Reconnecting automatically…',
        },
        location.origin,
      );
    }
  };
  globalThis.pandaSmmBridgeListener = receive;
  window.addEventListener('message', receive);
  window.postMessage({ channel: 'panda-smm-ready' }, location.origin);
})();
