export const connectorUnavailableMessage =
  'Connection to Panda SMM Browser was interrupted. Reconnecting automatically…';
export const connectorMissingMessage =
  'Panda SMM Browser is not responding. Check that it is enabled in this Chrome profile and allowed on this site. Panda Store will retry automatically.';
export function isBrowserConnectionError(message: string) {
  return [
    connectorUnavailableMessage,
    connectorMissingMessage,
    'Browser connector was reloaded. Refresh Panda Store and resume research.',
    'The browser connector did not respond. If it is enabled, refresh Panda Store and check the connection again.',
  ].includes(message);
}

export function browserCommand<T>(
  command: string,
  payload: Record<string, unknown> = {},
  timeout = 60000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let staleBridgeError = '';
    let retry: ReturnType<typeof setInterval> | undefined;
    const send = () =>
      window.postMessage({ channel: 'panda-smm-request', id, command, payload }, location.origin);
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(retry);
      window.removeEventListener('message', receive);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      if (event.data?.channel === 'panda-smm-ready' && command === 'ping') {
        send();
        return;
      }
      if (event.data?.channel !== 'panda-smm-response' || event.data.id !== id) return;
      if (isBrowserConnectionError(event.data.error)) {
        // Only ping is safe to replay after a transport failure. Report other
        // failed commands immediately instead of leaving the user waiting a minute.
        staleBridgeError = connectorUnavailableMessage;
        if (command === 'ping') return;
        cleanup();
        reject(new Error(staleBridgeError));
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
              ? connectorMissingMessage
              : 'The browser did not respond. Check its research tab, then resume.'),
        ),
      );
    }, timeout);
    window.addEventListener('message', receive);
    // A failed message port or a worker waking up must not require a manual reload.
    if (command === 'ping') retry = setInterval(send, 1000);
    send();
  });
}
