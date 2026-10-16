import { useEffect, useState } from "react";
import { api, moduleUrl } from "../../../web/src/api";
import type {
  Brief,
  Creative,
  ModuleProps,
  Run,
} from "../../../web/src/contracts";

function CreativeEditor({
  creative,
  canWrite,
  workspaceId,
  onSave,
}: {
  creative: Creative;
  canWrite: boolean;
  workspaceId: string;
  onSave: (creative: Creative) => void;
}) {
  const [draft, setDraft] = useState(creative);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const dirty =
    draft.hook !== creative.hook ||
    draft.script !== creative.script ||
    draft.cta !== creative.cta;
  function update(key: "hook" | "script" | "cta", value: string) {
    setDraft((old) => ({ ...old, [key]: value, approved: false }));
    setSaved("");
  }
  async function save(approve = false) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const next = await api<Creative>(
        moduleUrl(workspaceId, "studio", `creatives/${creative.id}/`),
        {
          method: "PATCH",
          body: JSON.stringify(
            approve
              ? { approved: true }
              : { hook: draft.hook, script: draft.script, cta: draft.cta },
          ),
        },
      );
      setDraft(next);
      onSave(next);
      setSaved(approve ? "Script validé." : "Modifications enregistrées.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="creative-card">
      <div className="creative-top">
        <span className="creative-number">0{creative.variant}</span>
        <span className={`pill ${draft.approved ? "approved" : ""}`}>
          {draft.approved
            ? "Validé"
            : dirty
              ? "Modifications en cours"
              : "À relire"}
        </span>
      </div>
      <h3>{creative.angle}</h3>
      <label>
        Accroche
        <textarea
          aria-label={`Accroche — ${creative.angle}`}
          className="hook-input"
          rows={3}
          maxLength={500}
          value={draft.hook}
          onChange={(e) => update("hook", e.target.value)}
          disabled={!canWrite}
        />
      </label>
      <label>
        Déroulé
        <textarea
          aria-label={`Déroulé — ${creative.angle}`}
          rows={12}
          maxLength={6000}
          value={draft.script}
          onChange={(e) => update("script", e.target.value)}
          disabled={!canWrite}
        />
      </label>
      <label>
        Appel à l’action
        <textarea
          aria-label={`Appel à l’action — ${creative.angle}`}
          rows={2}
          maxLength={300}
          value={draft.cta}
          onChange={(e) => update("cta", e.target.value)}
          disabled={!canWrite}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="saved" role="status">
          {saved}
        </p>
      )}
      <div className="creative-actions">
        <button
          className="button secondary"
          onClick={() => save()}
          disabled={!canWrite || busy || !dirty}
        >
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          className="text-button"
          onClick={() => save(true)}
          disabled={!canWrite || busy || dirty || draft.approved}
        >
          Valider ce script
        </button>
      </div>
    </article>
  );
}

export default function Studio({
  workspace,
  apps,
  selectedApp,
  selectApp,
  navigate,
  demoMode,
}: ModuleProps) {
  const [brief, setBrief] = useState<Brief>({
    audience: "",
    goal: "",
    tone: "",
  });
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canWrite = workspace.role !== "viewer";
  const appId = selectedApp?.id;
  const base = moduleUrl(workspace.id, "studio", `apps/${appId}/`);
  const run = runs.find((item) => item.id === runId) ?? runs[0];
  const pending = run?.status === "queued" || run?.status === "running";

  useEffect(() => {
    setError("");
    setNotice("");
    setRuns([]);
    setRunId("");
    setLoadFailed(false);
    setBrief({ audience: "", goal: "", tone: "" });
    if (!appId) return;
    let active = true;
    setLoading(true);
    Promise.all([api<Brief>(base + "brief/"), api<Run[]>(base + "runs/")])
      .then(([nextBrief, nextRuns]) => {
        if (active) {
          setBrief(nextBrief);
          setRuns(nextRuns);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoadFailed(true);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [appId, base]);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await api<Run[]>(base + "runs/");
        if (active) {
          setRuns(data);
          timer = setTimeout(poll, 1500);
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pending, base]);
  async function saveBrief() {
    return api<Brief>(base + "brief/", {
      method: "PUT",
      body: JSON.stringify(brief),
    });
  }
  async function submit(generate: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await saveBrief();
      if (generate) {
        const next = await api<Run>(base + "runs/", {
          method: "POST",
          body: JSON.stringify({ request_id: crypto.randomUUID() }),
        });
        setRuns((old) => [next, ...old]);
        setRunId(next.id);
        setNotice("Le brief est enregistré.");
      } else setNotice("Brief enregistré.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!selectedApp)
    return (
      <section className="empty">
        <img src="/modules/studio.webp" alt="" />
        <span className="eyebrow">STUDIO</span>
        <h1>Une bonne idée a besoin d’un point de départ.</h1>
        <p>Importez une app pour préparer votre premier brief.</p>
        <button
          className="button primary"
          onClick={() => navigate("apple_store")}
        >
          Choisir une app →
        </button>
      </section>
    );
  return (
    <>
      <div className="page-heading heading-split">
        <div>
          <span className="eyebrow">
            STUDIO / {selectedApp.name.toUpperCase()}
          </span>
          <h1>
            Une app. Trois façons
            <br className="desktop-break" /> de raconter son histoire.
          </h1>
          <p>Posez l’intention, puis travaillez chaque angle à votre façon.</p>
        </div>
        <label className="compact-label">
          Application
          <select
            value={selectedApp.id}
            disabled={busy || pending}
            onChange={(e) => {
              const app = apps.find((a) => a.id === e.target.value);
              if (app) selectApp(app);
            }}
          >
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="studio-disclosure">
        <span className="signal-dot" />
        <p>
          <strong>Atelier de démonstration.</strong> Les scripts viennent de
          modèles de rédaction, sans appel IA ni recherche concurrentielle. Ils
          restent à adapter et à vérifier.
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Préparation du Studio…</p>
      ) : loadFailed ? (
        <p>
          Le brief n’a pas pu être chargé. Rouvrez le module pour réessayer.
        </p>
      ) : (
        <>
          <section className="brief-panel">
            <div className="brief-intro">
              <span className="small-index">01 / LE BRIEF</span>
              <h2>À qui parle-t-on ?</h2>
              <p>{selectedApp.metadata?.data.subtitle}</p>
              <div className="feature-tags">
                {selectedApp.metadata?.data.features.map((feature) => (
                  <span key={feature}>{feature}</span>
                ))}
              </div>
            </div>
            <form
              className="brief-form"
              onSubmit={(event) => {
                event.preventDefault();
                submit(true);
              }}
            >
              <label>
                Le public
                <textarea
                  name="audience"
                  rows={2}
                  maxLength={500}
                  value={brief.audience}
                  onChange={(e) =>
                    setBrief({ ...brief, audience: e.target.value })
                  }
                  disabled={!canWrite || busy}
                />
              </label>
              <div className="brief-fields">
                <label>
                  L’intention
                  <input
                    name="goal"
                    required
                    maxLength={500}
                    value={brief.goal}
                    onChange={(e) =>
                      setBrief({ ...brief, goal: e.target.value })
                    }
                    disabled={!canWrite || busy}
                  />
                </label>
                <label>
                  Le ton
                  <input
                    name="tone"
                    required
                    maxLength={80}
                    value={brief.tone}
                    onChange={(e) =>
                      setBrief({ ...brief, tone: e.target.value })
                    }
                    disabled={!canWrite || busy}
                  />
                </label>
              </div>
              <div className="brief-actions">
                <button
                  type="submit"
                  className="button primary"
                  disabled={!canWrite || busy || pending || !demoMode}
                >
                  {busy || pending
                    ? "Préparation en cours…"
                    : "Préparer trois pistes →"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={!canWrite || busy}
                  onClick={() => submit(false)}
                >
                  Enregistrer le brief
                </button>
              </div>
              {notice && (
                <p className="saved" role="status">
                  {notice}
                </p>
              )}
            </form>
          </section>
          <section className="results">
            <div className="results-heading">
              <div>
                <span className="small-index">02 / LES PISTES</span>
                <h2>{run ? "De quoi commencer." : "La suite s’écrit ici."}</h2>
              </div>
              <div className="results-tools">
                {runs.length > 1 && (
                  <label>
                    Session
                    <select
                      aria-label="Session de création"
                      value={run?.id}
                      onChange={(e) => setRunId(e.target.value)}
                    >
                      {runs.map((item, index) => (
                        <option key={item.id} value={item.id}>
                          Session {runs.length - index} ·{" "}
                          {new Date(item.created_at).toLocaleDateString(
                            "fr-FR",
                          )}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {run?.status === "succeeded" && (
                  <a
                    className="button secondary"
                    href={moduleUrl(
                      workspace.id,
                      "studio",
                      `runs/${run.id}/export/`,
                    )}
                  >
                    Exporter les scripts ↓
                  </a>
                )}
              </div>
            </div>
            {!run && (
              <div className="results-empty">
                <p>
                  Votre brief donnera naissance à trois angles : le déclic, la
                  démonstration et le point de vue du créateur.
                </p>
              </div>
            )}
            {pending && (
              <p className="notice" role="status">
                Les trois pistes sont en préparation. Vous pourrez les retrouver
                dans cet espace.
              </p>
            )}
            {run?.status === "failed" && (
              <p className="error" role="alert">
                {run.error}
              </p>
            )}
            {run?.status === "succeeded" && (
              <div className="creative-grid">
                {run.creatives.map((creative) => (
                  <CreativeEditor
                    key={creative.id}
                    creative={creative}
                    canWrite={canWrite}
                    workspaceId={workspace.id}
                    onSave={(next) =>
                      setRuns((old) =>
                        old.map((item) =>
                          item.id === run.id
                            ? {
                                ...item,
                                creatives: item.creatives.map((c) =>
                                  c.id === next.id ? next : c,
                                ),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
