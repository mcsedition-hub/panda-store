export function browserCommand<T>(
  command: string,
  payload: Record<string, unknown> = {},
  timeout = 60000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== 'panda-smm-response' ||
        event.data.id !== id
      )
        return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result as T);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          command === 'ping'
            ? 'Install the Panda SMM Browser connector, then refresh this page.'
            : 'The browser did not respond. Check its research tab, then resume.',
        ),
      );
    }, timeout);
    window.addEventListener('message', receive);
    window.postMessage({ channel: 'panda-smm-request', id, command, payload }, location.origin);
  });
}
