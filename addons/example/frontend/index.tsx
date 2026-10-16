import { useEffect, useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { ModuleProps } from '../../../web/src/contracts';

export default function Example({ workspace }: ModuleProps) {
  const [message, setMessage] = useState('Connecting to module…');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<{ message: string }>(moduleUrl(workspace.id, 'example', 'hello/'))
      .then((data) => active && setMessage(data.message))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [workspace.id]);
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">EXTENSIONS</span>
        <h1>A place for your ideas.</h1>
        <p>
          This module uses the same registry, permissions and interface as the built-in modules.
        </p>
      </div>
      <div className="notice lichen">
        <img className="example-icon" src="/modules/extensions.webp" alt="" />
        <h2>Your first example module.</h2>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status">{message}</p>
        )}
        <a
          href="https://github.com/mcsedition-hub/panda-store/tree/main/addons/example"
          target="_blank"
          rel="noreferrer"
        >
          Explore the code ↗
        </a>
      </div>
    </>
  );
}
