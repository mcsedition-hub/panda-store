import { useEffect, useState } from 'react';
import { api, moduleUrl } from '../../../web/src/api';
import type { ModuleProps } from '../../../web/src/contracts';

export default function Example({ workspace }: ModuleProps) {
  const [message, setMessage] = useState('Connexion au module…');
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
        <h1>Une place pour vos idées.</h1>
        <p>
          Ce module utilise le même registre, les mêmes permissions et la même interface que les
          modules officiels.
        </p>
      </div>
      <div className="notice lichen">
        <img className="example-icon" src="/modules/extensions.webp" alt="" />
        <h2>Le premier module d’exemple.</h2>
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
          Explorer son code ↗
        </a>
      </div>
    </>
  );
}
