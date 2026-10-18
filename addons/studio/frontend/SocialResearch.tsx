import { useEffect, useRef, useState } from 'react';
import { api, ApiError, download, moduleUrl } from '../../../web/src/api';
import AIOptions, { type AIChoice } from '../../../web/src/ai/AIOptions';
import type { Brief, MobileApp, Run, Workspace } from '../../../web/src/contracts';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';
import { browserCommand } from './browserBridge';

type Post = {
  id: string;
  research_id?: string;
  research_topic?: string;
  url: string;
  captured_at: string;
  frame_count: number;
  evidence: {
    platform?: string;
    title: string;
    caption: string;
    format: string;
    coverage: string;
    published_at: string;
    author: string;
  };
  metrics: Record<string, { value: number; raw: string; approximate: boolean }>;
  qualification: {
    status: string;
    reasons: string[];
    like_rate: number | null;
  };
  analysis: {
    format?: string;
    observation?: string;
    structure?: string;
    idea_to_test?: string;
    limitations?: string[];
  };
};
export type SocialSession = {
  id: string;
  status: string;
  error: string;
  topic: string;
  created_at: string;
  workflow_id: string;
  inputs: { min_views: number; min_likes: number; brief?: Brief };
  plan: {
    strategy?: string;
    queries?: { platform: string; query: string; reason: string }[];
  };
  posts?: Post[];
  events: { at: string; message: string; url: string }[];
};
type Candidate = {
  url: string;
  title: string;
  search_count?: string;
  search_views?: string; // Older connectors used this name for an ambiguous card counter.
};
const platforms = ['tiktok', 'instagram', 'facebook', 'google'];
const connectorVersions = new Set(['0.1.5']);
const names: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  google: 'Google',
};

export default function SocialResearch({
  workspace,
  app,
  onGenerated,
  initialBrief,
}: {
  workspace: Workspace;
  app: MobileApp;
  onGenerated: (run: Run) => void;
  initialBrief?: Brief;
}) {
  const base = moduleUrl(workspace.id, 'studio');
  const endpoint = base + `apps/${app.id}/social-research/`;
  const [sessions, setSessions] = useState<SocialSession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [historyReload, setHistoryReload] = useState(0);
  const [session, setSession] = useState<SocialSession | null>(null);
  const [topic, setTopic] = useState(`${app.name} — similar apps and niche content`);
  const [market, setMarket] = useState(app.metadata?.data.locale || 'en-US');
  const [selectedPlatforms, setPlatforms] = useState(['tiktok']);
  const [views, setViews] = useState(10000);
  const [likes, setLikes] = useState(500);
  const [audience, setAudience] = useState(app.metadata?.data.audience || '');
  const [facts, setFacts] = useState((app.metadata?.data.features || []).join('\n'));
  const [language, setLanguage] = useState('English');
  const [confirmed, setConfirmed] = useState(false);
  const [choice, setChoice] = useState<AIChoice>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [connector, setConnector] = useState(false);
  const [connectorVersion, setConnectorVersion] = useState('');
  const [checkingConnector, setCheckingConnector] = useState(false);
  const outdatedConnector = !!connectorVersion && !connectorVersions.has(connectorVersion);
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [library, setLibrary] = useState<{
    sessionId: string;
    posts: Post[];
    loading: boolean;
    error: string;
  }>({ sessionId: '', posts: [], loading: false, error: '' });
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const alive = useRef(true);
  const stop = useRef(false);
  const pendingStart = useRef<string | null>(null);
  const pendingAdapt = useRef<{ id: string; body: string } | null>(null);
  const currentSession = useRef('');
  const autoBrowse = useRef('');
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || !initialBrief) return;
    if (initialBrief.product_facts) setFacts(initialBrief.product_facts);
    if (initialBrief.audience) setAudience(initialBrief.audience);
    if (initialBrief.language) setLanguage(initialBrief.language);
  }, [initialBrief?.product_facts, initialBrief?.audience, initialBrief?.language]);
  useEffect(() => {
    if (session?.status === 'ready' && autoBrowse.current === session.id) {
      autoBrowse.current = '';
      void browse();
    }
  }, [session?.id, session?.status]);
  const canWrite = workspace.role !== 'viewer';
  const working =
    busy ||
    browsing ||
    checkingConnector ||
    ['planning', 'analyzing'].includes(session?.status || '');
  useEffect(() => {
    alive.current = true;
    let active = true;
    setLoadingHistory(true);
    setHistoryError('');
    void browserCommand<{ version?: string }>('ping', {}, 1500)
      .then((info) => {
        if (active) {
          setConnectorVersion(info.version || '');
          setConnector(connectorVersions.has(info.version || ''));
        }
      })
      .catch(() => {});
    void api<SocialSession[]>(endpoint)
      .then((list) => {
        if (!active) return;
        setSessions(list);
        if (list[0]) void load(list[0].id);
      })
      .catch((e) => {
        if (active) setHistoryError(e.message);
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => {
      active = false;
      alive.current = false;
      stop.current = true;
      void browserCommand('stop', {}, 1500).catch(() => {});
    };
  }, [endpoint, historyReload]);
  useEffect(() => {
    if (!session || !['planning', 'analyzing'].includes(session.status)) return;
    let active = true;
    const timer = setInterval(() => {
      void api<SocialSession>(base + `social-research/${session.id}/`)
        .then((next) => {
          if (active && alive.current) setSession(next);
        })
        .catch((e) => {
          if (active && alive.current) setError(e.message);
        });
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session?.id, session?.status, base]);
  useEffect(() => {
    if (!session || session.status !== 'completed') return;
    let active = true;
    const sessionId = session.id;
    setLibrary({ sessionId, posts: [], loading: true, error: '' });
    void api<{ posts: Post[] }>(base + `social-research/${sessionId}/references/`)
      .then(({ posts }) => {
        if (active && alive.current) setLibrary({ sessionId, posts, loading: false, error: '' });
      })
      .catch((e) => {
        if (active && alive.current)
          setLibrary({ sessionId, posts: [], loading: false, error: e.message });
      });
    return () => {
      active = false;
    };
  }, [session?.id, session?.status, base, libraryRefresh]);
  async function load(id: string) {
    currentSession.current = id;
    try {
      const next = await api<SocialSession>(base + `social-research/${id}/`);
      if (alive.current && currentSession.current === id) {
        setSession(next);
        setSelected([]);
        setError('');
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  async function action(id: string, actionName: string, extra = {}) {
    const next = await api<SocialSession>(base + `social-research/${id}/`, {
      method: 'POST',
      feedback: false,
      body: JSON.stringify({ action: actionName, ...extra }),
    });
    if (alive.current && currentSession.current === id) setSession(next);
    return next;
  }
  async function start() {
    setBusy(true);
    setError('');
    try {
      await checkConnection();
      if (!alive.current) return;
      if (!pendingStart.current)
        pendingStart.current = JSON.stringify({
          request_id: crypto.randomUUID(),
          snapshot_id: app.metadata?.id,
          topic,
          market,
          platforms: selectedPlatforms,
          min_views: views,
          min_likes: likes,
          provider: choice?.provider,
          model: choice?.model,
          facts_confirmed: confirmed,
          brief: {
            audience,
            product_facts: facts,
            language,
            goal: 'Encourage the right audience to try the app.',
            tone: 'Clear and natural',
            duration_seconds: 30,
          },
        });
      const next = await api<SocialSession>(endpoint, {
        method: 'POST',
        body: pendingStart.current,
      });
      pendingStart.current = null;
      if (!alive.current) return;
      currentSession.current = next.id;
      autoBrowse.current = next.id;
      setSession(next);
      setSelected([]);
      setSessions((old) => [next, ...old.filter((s) => s.id !== next.id)]);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) pendingStart.current = null;
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function checkConnection() {
    setCheckingConnector(true);
    try {
      const info = await browserCommand<{ version?: string }>('ping', {}, 2000);
      if (!alive.current) return;
      setConnectorVersion(info.version || '');
      const compatible = connectorVersions.has(info.version || '');
      setConnector(compatible);
      if (!compatible)
        throw new Error('Update Panda SMM Browser to 0.1.5, then refresh Panda Store.');
    } catch (e) {
      if (alive.current) setConnector(false);
      throw e;
    } finally {
      if (alive.current) setCheckingConnector(false);
    }
  }
  async function browse() {
    if (!session?.plan.queries) return;
    const id = session.id;
    const check = () => {
      if (stop.current || !alive.current || currentSession.current !== id)
        throw new Error('Browser collection stopped.');
    };
    stop.current = false;
    setBrowsing(true);
    setError('');
    let began = false;
    try {
      await checkConnection();
      check();
      const current = await action(id, 'browse');
      began = true;
      check();
      await browserCommand('open', { session: id });
      check();
      const candidates = new Map<string, Candidate>();
      const blockedPlatforms = new Map<string, string>();
      for (const query of session.plan.queries) {
        check();
        if (blockedPlatforms.has(query.platform)) continue;
        const message = `Searching ${names[query.platform]}: ${query.query}`;
        setActivity(message);
        await action(id, 'event', { message });
        const result = await browserCommand<{
          candidates: Candidate[];
          blocked_reason: string;
        }>('search', { session: id, ...query }, query.platform === 'facebook' ? 90000 : 60000);
        check();
        if (result.blocked_reason) {
          blockedPlatforms.set(query.platform, result.blocked_reason);
          await action(id, 'event', {
            message: `${names[query.platform]}: ${result.blocked_reason}`,
          });
          continue;
        }
        for (const candidate of result.candidates) candidates.set(candidate.url, candidate);
        await action(id, 'event', {
          message: `${names[query.platform]}: ${result.candidates.length} direct post links found.`,
        });
      }
      const captured = new Set((current.posts || []).map((p) => p.url));
      // Card counts only order candidates; their metric type must be checked on the post.
      const reach = (candidate: Candidate) => {
        const match = (candidate.search_count || candidate.search_views)
          ?.trim()
          .match(/^(\d+(?:[.,]\d+)?)\s*([KMB])?$/i);
        if (!match) return 0;
        return (
          Number(match[1].replace(',', '.')) *
          ({ K: 1000, M: 1000000, B: 1000000000 }[match[2]?.toUpperCase()] || 1)
        );
      };
      const byNetwork = new Map<string, Candidate[]>();
      for (const candidate of [...candidates.values()].sort((a, b) => reach(b) - reach(a))) {
        const network = new URL(candidate.url).hostname;
        const queue = byNetwork.get(network) || [];
        queue.push(candidate);
        byNetwork.set(network, queue);
      }
      // Share the capture budget across networks instead of letting the first
      // search consume all twelve slots. Card counts rank only within a network.
      const ordered: Candidate[] = [];
      while (byNetwork.size) {
        for (const [network, queue] of byNetwork) {
          ordered.push(queue.shift()!);
          if (!queue.length) byNetwork.delete(network);
        }
      }
      for (const candidate of ordered) {
        if (captured.has(candidate.url)) continue;
        const platform = platforms.find(
          (name) => new URL(candidate.url).hostname === `www.${name}.com`,
        );
        if (platform && blockedPlatforms.has(platform)) continue;
        if (captured.size >= 12) break;
        check();
        setActivity(`Reading ${candidate.url}`);
        await action(id, 'event', { message: `Opening ${candidate.url}` });
        const observation = await browserCommand<Record<string, unknown>>('read', {
          session: id,
          url: candidate.url,
        });
        check();
        if (observation.blocked_reason) {
          if (platform) blockedPlatforms.set(platform, String(observation.blocked_reason));
          await action(id, 'event', {
            message: `${names[platform || ''] || 'Post'}: ${observation.blocked_reason}`,
          });
          continue;
        }
        const next = await api<SocialSession>(base + `social-research/${id}/captures/`, {
          method: 'POST',
          feedback: false,
          body: JSON.stringify(observation),
        });
        check();
        setSession(next);
        captured.add(candidate.url);
      }
      if (blockedPlatforms.size)
        throw new Error(
          [...blockedPlatforms]
            .map(([platform, reason]) => `${names[platform]}: ${reason}`)
            .join(' '),
        );
      if (!captured.size)
        throw new Error(
          'No direct social posts were collected. Check the search tab, refine the topic or try another platform.',
        );
      check();
      await action(id, 'finish');
      setActivity('Collected posts saved. Checking performance and relevance.');
    } catch (e) {
      if (alive.current && !stop.current && currentSession.current === id) {
        setError((e as Error).message);
        if (began) {
          await action(id, 'event', { message: (e as Error).message }).catch(() => {});
          await action(id, 'stop').catch(() => {});
        }
      }
    } finally {
      if (alive.current) setBrowsing(false);
    }
  }
  async function stopResearch() {
    stop.current = true;
    autoBrowse.current = '';
    void browserCommand('stop', {}, 2000).catch(() => {});
    if (session) await action(session.id, 'stop').catch((e) => setError(e.message));
  }
  async function analyzeCollected() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      await action(session.id, 'finish');
      setActivity('Collected posts saved. Checking performance and relevance.');
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function generate() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      if (!pendingAdapt.current)
        pendingAdapt.current = {
          id: session.id,
          body: JSON.stringify({
            request_id: crypto.randomUUID(),
            post_ids: selected,
          }),
        };
      const pending = pendingAdapt.current;
      const run = await api<Run>(base + `social-research/${pending.id}/adapt/`, {
        method: 'POST',
        body: pending.body,
      });
      pendingAdapt.current = null;
      if (alive.current) onGenerated(run);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) pendingAdapt.current = null;
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const posts = session?.posts || [];
  const qualified = posts.filter((p) => p.qualification.status === 'qualified');
  const reusable = library.sessionId === session?.id ? library.posts : [];
  const available = qualified.length + reusable.length;
  return (
    <section className="smm-research" aria-label="Social research">
      <div className="smm-intro">
        <div>
          <h2>Find content worth adapting</h2>
          <p>
            Research similar apps and your niche. Compare observed performance, then adapt three
            different references to your app.
          </p>
        </div>
        <span className={`pill ${connector ? 'approved' : ''}`}>
          {connector
            ? 'Browser connected'
            : outdatedConnector
              ? 'Browser connector update needed'
              : 'Browser connector needed'}
        </span>
        <button
          className="text-button"
          disabled={working}
          onClick={() =>
            void checkConnection()
              .then(() => setError(''))
              .catch((e) => setError(e.message))
          }
        >
          {checkingConnector ? 'Checking connection…' : 'Check connection'}
        </button>
      </div>
      {!connector && (
        <details className="smm-setup" open>
          <summary>
            {outdatedConnector
              ? 'Update Panda SMM Browser to 0.1.5'
              : 'Connect your Chrome browser'}
          </summary>
          {outdatedConnector && (
            <p>
              This version fixes Facebook Reel navigation and keeps each video’s evidence separate.
              Replace the installed connector files with the new download, click Reload in
              chrome://extensions, then refresh Panda Store. If you loaded the project folder
              directly, just reload the extension.
            </p>
          )}
          <p>
            Install Panda SMM Browser once. Research opens in a visible tab using your social
            sign-ins.
          </p>
          <p className="note">
            Local dashboards: localhost or 127.0.0.1, ports 5173, 8000 or 8080. Docker Compose and
            development dashboards require connector 0.1.5.
          </p>
          <ol>
            <li>
              <button
                className="text-button"
                onClick={() => void download(base + 'social/extension/', 'panda-smm-browser.zip')}
              >
                Download browser connector
              </button>{' '}
              and extract the ZIP.
            </li>
            <li>
              Open <code>chrome://extensions</code>, enable Developer mode and choose{' '}
              <strong>Load unpacked</strong>. Select the extracted <code>panda-smm</code> folder.
            </li>
            <li>Refresh this page. Keep Panda Store open while collecting.</li>
          </ol>
          <p className="note">
            Chrome requests access to the supported social sites and debugging for viewport captures
            and public Facebook post navigation in the research tab. No passwords or cookies are
            copied.
          </p>
        </details>
      )}
      {historyError && (
        <div>
          <p className="error" role="alert">
            Saved research could not be loaded. {historyError}
          </p>
          <button
            className="button secondary"
            disabled={working || loadingHistory}
            onClick={() => setHistoryReload((value) => value + 1)}
          >
            Retry loading research
          </button>
        </div>
      )}
      {canWrite && (
        <details className="smm-brief" open={!session}>
          <summary>App context and new research</summary>
          <div className="smm-fields">
            <label>
              Research topic
              <input
                value={topic}
                maxLength={500}
                disabled={working}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
            <label>
              Market
              <input
                value={market}
                maxLength={100}
                disabled={working}
                onChange={(e) => setMarket(e.target.value)}
              />
            </label>
            <label>
              Target audience
              <input
                value={audience}
                maxLength={500}
                disabled={working}
                onChange={(e) => {
                  touched.current = true;
                  setAudience(e.target.value);
                }}
              />
            </label>
            <label>
              Content language
              <input
                value={language}
                maxLength={40}
                disabled={working}
                onChange={(e) => {
                  touched.current = true;
                  setLanguage(e.target.value);
                }}
              />
            </label>
            <label className="smm-wide">
              Confirmed app features
              <textarea
                value={facts}
                maxLength={4000}
                rows={4}
                disabled={working}
                onChange={(e) => {
                  touched.current = true;
                  setFacts(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={working}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I checked these features for this app.
          </label>
          <fieldset disabled={working}>
            <legend>Where to search</legend>
            <div className="smm-platforms">
              {platforms.map((p) => (
                <label key={p}>
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.includes(p)}
                    onChange={(e) =>
                      setPlatforms((old) =>
                        e.target.checked ? [...old, p] : old.filter((v) => v !== p),
                      )
                    }
                  />
                  {names[p]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="smm-fields">
            <label>
              Minimum video views
              <input
                type="number"
                min={100}
                max={1000000000}
                value={views}
                disabled={working}
                onChange={(e) => setViews(Number(e.target.value))}
              />
            </label>
            <label>
              Minimum likes
              <input
                type="number"
                min={10}
                max={100000000}
                value={likes}
                disabled={working}
                onChange={(e) => setLikes(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="note">
            These are adjustable research filters, not universal definitions of virality. Video
            requires both counters; carousel and text require likes. Missing counters cannot pass.
            Google discovers social posts.
          </p>
          <AIOptions
            workspaceId={workspace.id}
            owner={workspace.role === 'owner'}
            disabled={working}
            emptyLabel="Choose a connected AI provider"
            onChange={(next, loading) => {
              setChoice(next);
              setAiLoading(loading);
            }}
          />
          <p className="note">
            Up to 12 posts. One AI planning call, up to two analysis calls per eligible post, then
            two calls for adaptations. Your provider bills usage. Captured text and viewport samples
            are shared with the selected provider; complete video and audio are not analyzed.
          </p>
          <button
            className="button primary"
            disabled={
              working ||
              loadingHistory ||
              !!historyError ||
              !connector ||
              !app.metadata ||
              !confirmed ||
              facts.trim().length < 10 ||
              !audience.trim() ||
              !choice?.model ||
              aiLoading ||
              !selectedPlatforms.length
            }
            onClick={() => void start()}
          >
            {pendingStart.current ? 'Retry research start' : 'Start social research'}
          </button>
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!!sessions.length && (
        <label className="compact-label">
          Research session
          <select
            disabled={working}
            value={session?.id || ''}
            onChange={(e) => void load(e.target.value)}
          >
            {sessions.map((s) => (
              <option value={s.id} key={s.id}>
                {new Date(s.created_at).toLocaleString()} · {s.topic}
              </option>
            ))}
          </select>
        </label>
      )}
      {session && (
        <>
          <div className="smm-session-heading">
            <h3>{session.topic}</h3>
            <span className="pill">{session.status}</span>
          </div>
          {session.error && (
            <p className="error" role="alert">
              {session.error}
            </p>
          )}
          {session.plan.strategy && <p>{session.plan.strategy}</p>}
          {session.status === 'stopped' && !!session.plan.queries?.length && (
            <p className="notice" role="status">
              Collection paused. Saved posts and captures are kept. Resolve any sign-in or
              verification request in the research tab, then resume browser research.
              {posts.length > 0 && ' You can also analyze the posts already collected.'}
            </p>
          )}
          {!!session.plan.queries?.length && (
            <details>
              <summary>Search plan · {session.plan.queries.length} queries</summary>
              <ul>
                {session.plan.queries.map((q, i) => (
                  <li key={i}>
                    <strong>
                      {names[q.platform]}: {q.query}
                    </strong>
                    <p className="note">{q.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="action-group">
            {canWrite &&
              ['ready', 'collecting', 'stopped'].includes(session.status) &&
              !!session.plan.queries?.length && (
                <button
                  className="button primary"
                  disabled={working || !connector}
                  onClick={() => void browse()}
                >
                  {posts.length || session.status === 'stopped'
                    ? 'Resume browser research'
                    : 'Search in my browser'}
                </button>
              )}
            {canWrite && ['collecting', 'stopped'].includes(session.status) && posts.length > 0 && (
              <button
                className="button secondary"
                disabled={working}
                onClick={() => void analyzeCollected()}
              >
                Analyze collected posts
              </button>
            )}
            {canWrite && (working || session.status === 'collecting') && (
              <button className="button secondary" onClick={() => void stopResearch()}>
                Stop research
              </button>
            )}
            {canWrite &&
              (['failed', 'canceled'].includes(session.status) ||
                (session.status === 'stopped' && !session.plan.queries?.length)) && (
                <button
                  className="button secondary"
                  disabled={working}
                  onClick={() => void action(session.id, 'retry').catch((e) => setError(e.message))}
                >
                  Retry unfinished research
                </button>
              )}
          </div>
          {activity && ['collecting', 'analyzing'].includes(session.status) && (
            <p role="status" className="note">
              {activity}
            </p>
          )}
          {['planning', 'analyzing', 'failed', 'canceled'].includes(session.status) &&
            session.workflow_id && (
              <WorkflowPanel
                workspaceId={workspace.id}
                workflowId={session.workflow_id}
                canWrite={false}
                showError={!session.error}
                onStatus={() => {}}
                onRetry={async () => {
                  await action(session.id, 'retry');
                }}
              />
            )}
          {(posts.length > 0 || session.status === 'completed') && (
            <div className="smm-results">
              <div className="smm-session-heading">
                <h3>
                  References · {qualified.length} qualified / {posts.length} collected
                </h3>
                <span className="note">
                  Filters: {session.inputs.min_views.toLocaleString()} views ·{' '}
                  {session.inputs.min_likes.toLocaleString()} likes
                </span>
              </div>
              {session.status === 'completed' && (
                <div className="smm-library">
                  <h4>References from other research</h4>
                  <p className="note">
                    Reuse qualified posts for this app with the same confirmed features, audience,
                    market and app import. These references also pass this session's performance
                    filters. Counts remain those observed on the capture date.
                  </p>
                  {library.sessionId === session.id && library.loading && (
                    <p role="status">Loading saved references…</p>
                  )}
                  {library.sessionId === session.id && library.error && (
                    <p role="alert">
                      Could not load saved references. {library.error}{' '}
                      <button onClick={() => setLibraryRefresh((value) => value + 1)}>
                        Retry saved references
                      </button>
                    </p>
                  )}
                  {!library.loading && !library.error && (
                    <p>
                      {reusable.length} additional qualified reference(s) · {available} available
                      for three adaptations.
                    </p>
                  )}
                  {session.inputs.brief && (
                    <details>
                      <summary>Confirmed app context for these adaptations</summary>
                      <p>{session.inputs.brief.product_facts}</p>
                      <p className="note">
                        Audience: {session.inputs.brief.audience} · Language:{' '}
                        {session.inputs.brief.language}
                      </p>
                    </details>
                  )}
                </div>
              )}
              {session.status === 'completed' && !library.loading && available < 3 && (
                <p className="notice">
                  {3 - available} more qualified reference(s) needed. Refine the topic or search
                  another platform in a new session. No generic references will fill the gap.
                </p>
              )}
              <div className="smm-post-grid">
                {[...posts, ...reusable].map((p) => (
                  <article className="smm-post" key={p.id}>
                    <div className="smm-session-heading">
                      <span
                        className={`pill ${p.qualification.status === 'qualified' ? 'approved' : ''}`}
                      >
                        {p.qualification.status.replaceAll('_', ' ')}
                      </span>
                      <span className="note">
                        {p.evidence.platform && `${names[p.evidence.platform]} · `}
                        {(p.analysis.format || p.evidence.format).replaceAll('_', ' ')}
                      </span>
                    </div>
                    <h4>
                      <a href={p.url} target="_blank" rel="noreferrer">
                        {p.evidence.title || p.url} ↗
                      </a>
                    </h4>
                    <p className="note">
                      {p.evidence.author} · Observed {new Date(p.captured_at).toLocaleString()}
                      {p.evidence.published_at && ` · Published ${p.evidence.published_at}`}
                    </p>
                    {p.research_topic && <p className="note">From research: {p.research_topic}</p>}
                    <div className="smm-counters">
                      {['views', 'likes', 'comments', 'shares'].map((k) => (
                        <span key={k}>
                          <strong>
                            {p.metrics[k]
                              ? `${p.metrics[k].approximate ? '≈ ' : ''}${p.metrics[k].value.toLocaleString()}`
                              : 'Not observed'}
                          </strong>
                          {k}
                        </span>
                      ))}
                    </div>
                    {p.qualification.reasons.map((reason, i) => (
                      <p className="note" key={i}>
                        {reason}
                      </p>
                    ))}
                    {p.analysis.observation && <p>{p.analysis.observation}</p>}
                    {p.analysis.structure && (
                      <p>
                        <strong>Structure:</strong> {p.analysis.structure}
                      </p>
                    )}
                    {p.analysis.idea_to_test && (
                      <p>
                        <strong>Adaptation idea:</strong> {p.analysis.idea_to_test}
                      </p>
                    )}
                    <details>
                      <summary>Evidence and coverage · {p.frame_count} frames</summary>
                      <p>{p.evidence.caption}</p>
                      <div className="smm-evidence-frames">
                        {Array.from({ length: p.frame_count }, (_, i) => (
                          <a
                            key={i}
                            href={base + `social-posts/${p.id}/frames/${i}/`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={base + `social-posts/${p.id}/frames/${i}/`}
                              alt={`Observed viewport ${i + 1}`}
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                      <p className="note">{p.evidence.coverage}</p>
                      {p.analysis.limitations?.map((line, i) => (
                        <p className="note" key={i}>
                          {line}
                        </p>
                      ))}
                    </details>
                    {p.qualification.status === 'qualified' && (
                      <label className="check-label">
                        <input
                          type="checkbox"
                          disabled={
                            !canWrite ||
                            working ||
                            !!pendingAdapt.current ||
                            (!selected.includes(p.id) && selected.length === 3)
                          }
                          checked={selected.includes(p.id)}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked ? [...old, p.id] : old.filter((id) => id !== p.id),
                            )
                          }
                        />
                        Use this reference
                      </label>
                    )}
                  </article>
                ))}
              </div>
              {canWrite && session.status === 'completed' && (
                <button
                  className="button primary"
                  disabled={working || selected.length !== 3}
                  onClick={() => void generate()}
                >
                  {pendingAdapt.current
                    ? 'Retry adaptation start'
                    : `Create three adaptations · ${selected.length}/3 selected`}
                </button>
              )}
            </div>
          )}
          <details className="smm-journal">
            <summary>Browser activity · {session.events.length} events</summary>
            <ol>
              {session.events.map((e, i) => (
                <li key={i}>
                  <time>{new Date(e.at).toLocaleTimeString()}</time> {e.message}
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {' '}
                      Source ↗
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
