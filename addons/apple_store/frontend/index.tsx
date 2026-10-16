import { useEffect, useState } from "react";
import { api, moduleUrl } from "../../../web/src/api";
import type {
  AppMetadata,
  MobileApp,
  ModuleProps,
} from "../../../web/src/contracts";

export default function AppleStore({
  workspace,
  refreshApps,
  selectApp,
  navigate,
  demoMode,
}: ModuleProps) {
  const [apps, setApps] = useState<AppMetadata[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!demoMode) {
      setLoading(false);
      return;
    }
    let active = true;
    api<{ apps: AppMetadata[] }>(
      moduleUrl(workspace.id, "apple_store", "catalog/"),
    )
      .then((data) => active && setApps(data.apps))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [workspace.id, demoMode]);
  async function importApp(id: string) {
    setBusy(id);
    setError("");
    try {
      const imported = await api<MobileApp>(
        moduleUrl(workspace.id, "apple_store", "import/"),
        { method: "POST", body: JSON.stringify({ external_id: id }) },
      );
      await refreshApps();
      selectApp(imported);
      navigate("studio");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">CONNEXIONS</span>
        <h1>Faisons les présentations.</h1>
        <p>Une fiche claire est le premier matériau d’une bonne création.</p>
      </div>
      <div className="notice">
        <strong>Le parcours App Store, en démonstration.</strong>
        <p>
          Les applications ci-dessous sont fictives. Leur import est enregistré
          dans votre espace. La connexion à votre compte Apple sera ajoutée dans
          une prochaine version.
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Chargement du catalogue…</p>}
      {!demoMode && (
        <p>Le mode démonstration est désactivé sur cette installation.</p>
      )}
      <div className="import-list">
        {apps.map((app) => (
          <article className="import-row" key={app.external_id}>
            <div className="app-monogram" aria-hidden="true">
              {app.name[0]}
            </div>
            <div className="import-info">
              <h2>{app.name}</h2>
              <p>{app.subtitle}</p>
              <span className="note">
                {app.category} · {app.locale}
              </span>
            </div>
            <button
              className="button secondary"
              disabled={!!busy || workspace.role === "viewer"}
              onClick={() => importApp(app.external_id)}
            >
              {busy === app.external_id ? "Import en cours…" : "Importer →"}
            </button>
          </article>
        ))}
      </div>
      <p className="note">
        Réimporter la même app met sa fiche à jour sans créer de doublon.
      </p>
    </>
  );
}
