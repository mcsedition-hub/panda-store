export function browserCommand<T>(
  command: string,
  payload: Record<string, unknown> = {},
  timeout = 60000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let staleBridgeError = '';
    const send = () =>
      window.postMessage({ channel: 'panda-smm-request', id, command, payload }, location.origin);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.channel === 'panda-smm-ready' && command === 'ping') {
        send();
        return;
      }
      if (event.data?.channel !== 'panda-smm-response' || event.data.id !== id) return;
      // Old, invalidated content scripts may reply before the replacement bridge.
      // Keep waiting for its answer. Never replay read/search or other commands.
      if (
        event.data.error ===
        'Browser connector was reloaded. Refresh Panda Store and resume research.'
      ) {
        staleBridgeError = event.data.error;
        return;
      }
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result as T);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          staleBridgeError ||
            (command === 'ping'
              ? 'The browser connector did not respond. If it is enabled, refresh Panda Store and check the connection again.'
              : 'The browser did not respond. Check its research tab, then resume.'),
        ),
      );
    }, timeout);
    window.addEventListener('message', receive);
    send();
  });
}
