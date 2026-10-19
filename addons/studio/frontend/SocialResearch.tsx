import { t, getLocale, getLanguage } from '../../../web/src/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError, download, moduleUrl } from '../../../web/src/api';
import AIOptions, { type AIChoice } from '../../../web/src/ai/AIOptions';
import type { Brief, MobileApp, Run, Workspace } from '../../../web/src/contracts';
import WorkflowPanel from '../../../web/src/workflows/WorkflowPanel';
import { browserCommand, isBrowserConnectionError } from './browserBridge';

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
  inputs: {
    min_views: number;
    min_likes: number;
    brief?: Brief;
    context_origin?: { audience: string; product_facts: string };
    ai?: NonNullable<AIChoice>;
  };
  plan: {
    strategy?: string;
    app_understanding?: { audience: string; features: string[] };
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
const referenceOrder: Record<string, number> = { qualified: 0, metrics_pass: 1, unqualified: 2 };
const initialQualifiedLimit = 4;
type ConnectorInfo = { version?: string; protocol?: number };
const compatibleConnector = (info: ConnectorInfo) =>
  info.protocol === 1 || (info.protocol == null && info.version === '0.1.7');
const connectorUpdateMessage = 'Update Panda SMM Browser to 0.1.11, then check the connection.';
const unavailablePostReasons = new Set([
  'The post content did not become ready. Open it in the browser and resume.',
  'The requested page did not become ready. Check the research tab and resume.',
  'The platform returned an error. Retry in the research tab, then resume.',
]);
const skippedPostMessage = 'Skipped a post whose content could not be loaded.';
const names: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  google: 'Google',
};

function browserMessage(message: string) {
  if (!/^(TikTok|Instagram|Facebook|Google|Post): /.test(message)) return t(message);
  return message
    .split(/(?=(?:TikTok|Instagram|Facebook|Google|Post): )/)
    .map((part) => {
      const translated = t(part.trim());
      if (translated !== part.trim()) return translated;
      const match = part.trim().match(/^(TikTok|Instagram|Facebook|Google|Post): ([\s\S]*)$/);
      return match ? `${t(match[1])}: ${t(match[2])}` : t(part.trim());
    })
    .join('\n');
}

export default function SocialResearch({
  workspace,
  app,
  onGenerated,
  initialBrief,
  newResearchRequest = 0,
  onNewResearchAvailabilityChange,
}: {
  workspace: Workspace;
  app: MobileApp;
  onGenerated: (run: Run) => void;
  initialBrief?: Brief;
  newResearchRequest?: number;
  onNewResearchAvailabilityChange?: (available: boolean) => void;
}) {
  const base = moduleUrl(workspace.id, 'studio');
  const endpoint = base + `apps/${app.id}/social-research/`;
  const [sessions, setSessions] = useState<SocialSession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [historyReload, setHistoryReload] = useState(0);
  const [session, setSession] = useState<SocialSession | null>(null);
  const [topic, setTopic] = useState(t('{0} — similar apps and niche content', app.name));
  const [market, setMarket] = useState(app.metadata?.data.locale || 'en-US');
  const [selectedPlatforms, setPlatforms] = useState(['tiktok']);
  const [views, setViews] = useState(10000);
  const [likes, setLikes] = useState(500);
  const project = app.metadata?.data.project;
  const appDescription = project
    ? project.specification
    : [
        app.metadata?.data.subtitle,
        app.metadata?.data.short_description,
        app.metadata?.data.description,
        app.metadata?.data.promotional_text,
        ...(app.metadata?.data.features || []),
      ]
        .filter(Boolean)
        .join('\n\n');
  const [audience, setAudience] = useState('');
  const [facts, setFacts] = useState('');
  const [language, setLanguage] = useState(getLanguage() === 'fr' ? 'Français' : 'English');
  const [choice, setChoice] = useState<AIChoice>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [connector, setConnector] = useState(false);
  const [connectorVersion, setConnectorVersion] = useState('');
  const [connectorError, setConnectorError] = useState('');
  const [checkingConnector, setCheckingConnector] = useState(true);
  const connectionCheck = useRef<Promise<void> | null>(null);
  const outdatedConnector = !!connectorVersion && !connector;
  const connectorUpdateAvailable =
    connector &&
    /^0\.1\.\d+$/.test(connectorVersion) &&
    Number(connectorVersion.split('.')[2]) < 11;
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [referencePlatform, setReferencePlatform] = useState('all');
  const [showAllQualified, setShowAllQualified] = useState(false);
  const [showOtherReferences, setShowOtherReferences] = useState(false);
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
  const requirementsId = useId();
  const referenceListId = useId();
  const setupTitleId = useId();
  const setupDialog = useRef<HTMLDialogElement>(null);
  const researchForm = useRef<HTMLDetailsElement>(null);
  const topicInput = useRef<HTMLInputElement>(null);
  const handledNewResearch = useRef(newResearchRequest);
  const focusNewResearch = useRef(false);
  const languageTouched = useRef(false);
  useEffect(() => {
    setReferencePlatform('all');
    setShowAllQualified(false);
    setShowOtherReferences(false);
  }, [session?.id]);
  useEffect(() => {
    if (!languageTouched.current && initialBrief?.language) setLanguage(initialBrief.language);
  }, [initialBrief?.language]);
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
  const canOpenNewResearch =
    canWrite &&
    !working &&
    session?.status !== 'collecting' &&
    !loadingHistory &&
    !historyError &&
    !pendingStart.current &&
    !pendingAdapt.current;
  useEffect(() => {
    onNewResearchAvailabilityChange?.(canOpenNewResearch);
    return () => onNewResearchAvailabilityChange?.(false);
  }, [canOpenNewResearch, onNewResearchAvailabilityChange]);
  useEffect(() => {
    if (handledNewResearch.current === newResearchRequest) return;
    handledNewResearch.current = newResearchRequest;
    if (!canOpenNewResearch) return;
    // Keep saved sessions and optional context edits, without inheriting a late
    // history response or adaptation into a new search.
    currentSession.current = '';
    autoBrowse.current = '';
    setSession(null);
    setSelected([]);
    setLibrary({ sessionId: '', posts: [], loading: false, error: '' });
    setError('');
    setActivity('');
    focusNewResearch.current = true;
  }, [newResearchRequest, canOpenNewResearch]);
  useEffect(() => {
    if (session || !focusNewResearch.current) return;
    focusNewResearch.current = false;
    topicInput.current?.focus({ preventScroll: true });
    researchForm.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [session, newResearchRequest]);
  const requirements: string[] = [];
  const connectionRequirement = connectorError
    ? t(connectorError)
    : t('Connect Panda SMM Browser to search in your browser.');
  if (loadingHistory) requirements.push(t('Loading saved research…'));
  if (historyError) requirements.push(t('Reload saved research using the retry button above.'));
  if (!connector) requirements.push(connectionRequirement);
  if (!app.metadata)
    requirements.push(t('Add a project description or import app details in My apps.'));
  if (topic.trim().length < 5)
    requirements.push(t('Enter a research topic of at least 5 characters.'));
  if (!market.trim()) requirements.push(t('Enter the market to research.'));
  if (!language.trim()) requirements.push(t('Choose the content language.'));
  if (facts.trim() && (facts.trim().length < 10 || facts.trim().length > 4000))
    requirements.push(
      project
        ? t('Describe the project scope in 10 to 4,000 characters.')
        : t('Describe the app features in 10 to 4,000 characters.'),
    );
  if (app.metadata && !facts.trim() && appDescription.trim().length < 10)
    requirements.push(t('Add an app description in My apps before starting research.'));
  if (!selectedPlatforms.length) requirements.push(t('Select at least one platform to search.'));
  if (!Number.isInteger(views) || views < 100 || views > 1000000000)
    requirements.push(
      t('Set minimum video views to a whole number between 100 and 1,000,000,000.'),
    );
  if (!Number.isInteger(likes) || likes < 10 || likes > 100000000)
    requirements.push(t('Set minimum likes to a whole number between 10 and 100,000,000.'));
  if (aiLoading || !choice?.model)
    requirements.push(t('Select a connected AI provider and a model that can analyze images.'));
  useEffect(() => {
    alive.current = true;
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    setLoadingHistory(true);
    setHistoryError('');
    const schedule = (delay: number) => {
      clearTimeout(reconnectTimer);
      if (active) reconnectTimer = setTimeout(visible, delay);
    };
    const reconnect = (quiet = true) => {
      if (!active) return;
      clearTimeout(reconnectTimer);
      void checkConnection(quiet)
        .then(() => {
          if (active)
            setError((old) =>
              isBrowserConnectionError(old) || old === connectorUpdateMessage ? '' : old,
            );
          schedule(45000);
        })
        .catch(() => schedule(10000));
    };
    const ready = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.origin === location.origin &&
        event.data?.channel === 'panda-smm-ready'
      )
        reconnect();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') reconnect();
      else schedule(45000);
    };
    window.addEventListener('message', ready);
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    reconnect(false);
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
      clearTimeout(reconnectTimer);
      window.removeEventListener('message', ready);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
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
      if (alive.current && currentSession.current === id) setError((e as Error).message);
    }
  }
  async function action(id: string, actionName: string, extra = {}) {
    const next = await api<SocialSession>(base + `social-research/${id}/`, {
      method: 'POST',
      feedback: false,
      body: JSON.stringify({ action: actionName, ...extra }),
    });
    if (alive.current && currentSession.current === id) {
      currentSession.current = next.id;
      setSession(next);
      setSessions((old) => [next, ...old.filter((item) => item.id !== next.id)]);
      if (next.id !== id) setSelected([]);
    }
    return next;
  }
  async function start() {
    if (!canWrite || working || requirements.length) return;
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
          context_mode: 'app',
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
  function checkConnection(quiet = false): Promise<void> {
    if (connectionCheck.current) return connectionCheck.current;
    if (!quiet) setCheckingConnector(true);
    const request = Promise.resolve()
      .then(async () => {
        try {
          const info = await browserCommand<ConnectorInfo>('ping', {}, 5000);
          if (!alive.current) return;
          setConnectorVersion(info.version || '');
          if (!compatibleConnector(info)) throw new Error(connectorUpdateMessage);
          setConnector(true);
          setConnectorError('');
        } catch (e) {
          if (alive.current) {
            setConnector(false);
            setConnectorError((e as Error).message);
            if ((e as Error).message !== connectorUpdateMessage) setConnectorVersion('');
          }
          throw e;
        }
      })
      .finally(() => {
        connectionCheck.current = null;
        if (alive.current) setCheckingConnector(false);
      });
    connectionCheck.current = request;
    return request;
  }
  async function browse() {
    if (!session?.plan.queries) return;
    const id = session.id;
    const check = () => {
      if (stop.current || !alive.current || currentSession.current !== id)
        throw new Error('Browser collection stopped.');
    };
    async function browserRead<T>(
      command: string,
      payload: Record<string, unknown>,
      timeout = 60000,
    ): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        check();
        try {
          return await browserCommand<T>(command, payload, timeout);
        } catch (error) {
          if (
            attempt >= 2 ||
            !(error instanceof Error) ||
            error.message !== 'The research tab is navigating. Wait for the page, then resume.'
          )
            throw error;
          // TikTok can commit another navigation after the page first becomes
          // readable. Retry only this explicit transient failure, never an
          // uncertain timeout, login gate or verification challenge.
          setActivity('Waiting for the social page to finish loading…');
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
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
        const result = await browserRead<{
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
      let attempted = 0;
      for (const candidate of ordered) {
        if (captured.has(candidate.url)) continue;
        const platform = platforms.find(
          (name) => new URL(candidate.url).hostname === `www.${name}.com`,
        );
        if (platform && blockedPlatforms.has(platform)) continue;
        if (captured.size >= 12) break;
        check();
        // Bound work even when many individual posts are unavailable. Only a
        // completed connector response can be skipped; uncertain commands,
        // sign-in and verification failures retain the existing pause behavior.
        if (attempted >= 24) {
          await action(id, 'event', { message: 'Collection stopped after checking 24 posts.' });
          break;
        }
        attempted++;
        setActivity(`Reading ${candidate.url}`);
        await action(id, 'event', { message: `Opening ${candidate.url}` });
        const observation = await browserRead<Record<string, unknown>>(
          'read',
          {
            session: id,
            url: candidate.url,
          },
          platform === 'instagram' ? 90000 : 60000,
        );
        check();
        if (observation.blocked_reason) {
          if (unavailablePostReasons.has(String(observation.blocked_reason))) {
            setActivity('Skipping an unavailable post. Checking the next result…');
            await action(id, 'event', { message: skippedPostMessage, url: candidate.url });
            continue;
          }
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
            .join('\n'),
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
        // A timed-out command can still be running in Chrome. Cancel it and
        // refresh the connection status before offering to resume saved research.
        void browserCommand('stop', {}, 1500).catch(() => {});
        void checkConnection(true).catch(() => {});
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
  const pending = posts.filter((p) => p.qualification.status === 'metrics_pass');
  const excluded = posts.filter((p) => p.qualification.status === 'unqualified');
  const exclusionSummary = [
    {
      label: '{0} post(s) below the performance thresholds.',
      matches: (reason: string) =>
        /^(Views|Likes) [\d,]+ is below the [\d,]+ filter\.$/.test(reason),
    },
    {
      label: '{0} post(s) with missing view or like counts.',
      matches: (reason: string) => /^(Views|Likes) were not observed\.$/.test(reason),
    },
    {
      label: '{0} post(s) whose content format could not be identified.',
      matches: (reason: string) => reason === 'Content format is not established.',
    },
  ].map((group) => ({
    ...group,
    count: excluded.filter((post) => post.qualification.reasons.some(group.matches)).length,
  }));
  const otherExclusions = excluded.filter((post) =>
    post.qualification.reasons.some(
      (reason) => !exclusionSummary.some((group) => group.matches(reason)),
    ),
  ).length;
  const hasSkippedPosts = session?.events.some((event) => event.message === skippedPostMessage);
  const reusable = library.sessionId === session?.id ? library.posts : [];
  const available = qualified.length + reusable.length;
  const allReferences = [...posts, ...reusable];
  const referencePlatforms = platforms.filter((platform) =>
    allReferences.some((post) => post.evidence.platform === platform),
  );
  const platformReferences = allReferences
    .filter((post) => referencePlatform === 'all' || post.evidence.platform === referencePlatform)
    .sort(
      (a, b) =>
        (referenceOrder[a.qualification.status] ?? 3) -
        (referenceOrder[b.qualification.status] ?? 3),
    );
  const qualifiedReferences = platformReferences.filter(
    (post) => post.qualification.status === 'qualified',
  );
  const otherReferences = platformReferences.filter(
    (post) => post.qualification.status !== 'qualified',
  );
  const otherReferenceCount = otherReferences.length;
  const visibleReferences = [
    ...(showAllQualified
      ? qualifiedReferences
      : qualifiedReferences.slice(0, initialQualifiedLimit)),
    ...(showOtherReferences ? otherReferences : []),
  ];
  const hiddenSelected = selected.filter(
    (id) => !platformReferences.some((post) => post.id === id),
  ).length;
  const collapsedSelected = selected.filter(
    (id) =>
      platformReferences.some((post) => post.id === id) &&
      !visibleReferences.some((post) => post.id === id),
  ).length;
  return (
    <section className="smm-research" aria-label={t('Social research')}>
      <div className="smm-intro">
        <div>
          <h2>{t('Find content worth adapting')}</h2>
          <p>
            {t(
              'Research similar apps and your niche. Compare observed performance, then adapt one to three references to your app.',
            )}
          </p>
        </div>
        <div className="smm-connection-actions">
          <span className={`pill ${connector ? 'approved' : ''}`} role="status">
            {checkingConnector
              ? t('Checking connection…')
              : connector
                ? t('Browser connected')
                : outdatedConnector
                  ? t('Browser connector update needed')
                  : t('Browser disconnected · automatic retry')}
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
            {checkingConnector ? t('Checking connection…') : t('Check connection')}
          </button>
          <button
            className="button secondary"
            aria-haspopup="dialog"
            onClick={() => setupDialog.current?.showModal()}
          >
            {t('Connection instructions')}
          </button>
        </div>
      </div>
      {connector && connectorVersion && (
        <p className="note">
          {t('Connected extension: {0}.', connectorVersion)}{' '}
          {connectorUpdateAvailable && (
            <button
              className="text-button"
              aria-haspopup="dialog"
              onClick={() => setupDialog.current?.showModal()}
            >
              {t('An update improves automatic reconnection. See how to install it.')}
            </button>
          )}
        </p>
      )}
      {!connector && !checkingConnector && !outdatedConnector && (
        <p className="note">
          {t('Panda Store retries the connection automatically. Your saved research is kept.')}
        </p>
      )}
      <dialog
        ref={setupDialog}
        className="smm-setup smm-setup-dialog"
        aria-labelledby={setupTitleId}
      >
        <div className="smm-setup-heading">
          <h2 id={setupTitleId}>
            {outdatedConnector || connectorUpdateAvailable
              ? t('Update Panda SMM Browser to 0.1.11')
              : t('Connect your Chrome browser')}
          </h2>
          <button
            type="button"
            className="text-button"
            autoFocus
            onClick={() => setupDialog.current?.close()}
          >
            {t('Close instructions')}
          </button>
        </div>
        {connectorError && <p className="notice">{t(connectorError)}</p>}
        {(outdatedConnector || connectorUpdateAvailable) && (
          <p>
            {t(
              'Version 0.1.11 repairs the connection when you return to Panda Store. Replace the installed extension files with this download, then click Reload once in chrome://extensions. If you loaded the project folder directly, just reload the extension. Your form and saved research are kept.',
            )}
          </p>
        )}
        <p>
          {t(
            'Install Panda SMM Browser once. Research opens in a visible tab using your social sign-ins.',
          )}
        </p>
        <p className="note">
          {t(
            'Local dashboards: localhost or 127.0.0.1, ports 5173, 8000 or 8080. Older compatible extensions still work; version 0.1.11 improves automatic reconnection.',
          )}
        </p>
        <ol>
          <li>
            <button
              className="text-button"
              onClick={() => void download(base + 'social/extension/', 'panda-smm-browser.zip')}
            >
              {t('Download browser connector')}
            </button>{' '}
            {t('and extract the ZIP.')}
          </li>
          <li>
            {t('Open ')}
            <code>{t('chrome://extensions')}</code>
            {t(', enable Developer mode and choose')} <strong>{t('Load unpacked')}</strong>
            {t('. Select the extracted ')}
            <code>{t('panda-smm')}</code>
            {t(' folder.')}
          </li>
          <li>
            {t(
              'Return to Panda Store; the connection is detected automatically. Keep Panda Store open while collecting.',
            )}
          </li>
        </ol>
        <p className="note">
          {t(
            'Chrome requests access to the supported social sites and debugging for viewport captures and public Facebook post navigation in the research tab. No passwords or cookies are copied.',
          )}
        </p>
      </dialog>
      {historyError && (
        <div>
          <p className="error" role="alert">
            {t('Saved research could not be loaded. ')}
            {t(historyError)}
          </p>
          <button
            className="button secondary"
            disabled={working || loadingHistory}
            onClick={() => setHistoryReload((value) => value + 1)}
          >
            {t('Retry loading research')}
          </button>
        </div>
      )}
      {canWrite && (
        <details ref={researchForm} className="smm-brief" open={!session}>
          <summary>{t('App context and new research')}</summary>
          {!session && sessions.length > 0 && (
            <p className="note">
              {t('Prepare a new search below. Your previous research and scripts stay in history.')}
            </p>
          )}
          <div className="smm-fields">
            <label className="smm-wide">
              {t('Research topic ')}
              <input
                ref={topicInput}
                value={topic}
                maxLength={500}
                disabled={working}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
            <label>
              {t('Market ')}
              <input
                value={market}
                maxLength={100}
                disabled={working}
                onChange={(e) => setMarket(e.target.value)}
              />
            </label>
            <label>
              {t('Content language ')}
              <input
                value={language}
                maxLength={40}
                disabled={working}
                onChange={(e) => {
                  languageTouched.current = true;
                  setLanguage(e.target.value);
                }}
              />
            </label>
          </div>
          <div className="smm-auto-context">
            <strong>
              {project ? t('Context from your app idea') : t('Context from your store listing')}
            </strong>
            <p>
              {t(
                'The AI identifies your audience and features from the saved description while preparing the search. You do not need to enter them again.',
              )}
            </p>
            {appDescription && (
              <details>
                <summary>{t('View the saved description')}</summary>
                <p className="smm-source-description">{appDescription}</p>
              </details>
            )}
            <details>
              <summary>{t('Adjust the context (optional)')}</summary>
              <div className="smm-fields">
                <label className="smm-wide">
                  {t('Target audience (optional)')}
                  <input
                    value={audience}
                    maxLength={500}
                    disabled={working}
                    placeholder={t('Identified by AI from your description')}
                    onChange={(e) => setAudience(e.target.value)}
                  />
                </label>
                <label className="smm-wide">
                  {t('Feature scope for this search (optional)')}
                  <textarea
                    value={facts}
                    maxLength={4000}
                    rows={4}
                    disabled={working}
                    placeholder={t('Use the saved description automatically')}
                    onChange={(e) => setFacts(e.target.value)}
                  />
                </label>
              </div>
              <p className="note">
                {t(
                  'Leave these fields empty to use the app context. A custom feature scope replaces the description as the basis for product claims in this search.',
                )}
              </p>
              {(audience || facts) && (
                <button
                  className="text-button"
                  type="button"
                  disabled={working}
                  onClick={() => {
                    setAudience('');
                    setFacts('');
                  }}
                >
                  {t('Use automatic context')}
                </button>
              )}
            </details>
          </div>
          <fieldset disabled={working}>
            <legend>{t('Where to search')}</legend>
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
              {t('Minimum video views ')}
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
              {t('Minimum likes ')}
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
            {t(
              'These are adjustable research filters, not universal definitions of virality. Video requires both counters; carousel, image and text require likes. Missing counters cannot pass. Google discovers social posts.',
            )}
          </p>
          <AIOptions
            moduleContext="smm"
            capability="vision"
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
            {t(
              'Up to 12 posts. One AI planning call, up to two analysis calls per eligible post, then two calls for adaptations. Your provider bills usage. Captured text and viewport samples are shared with the selected provider; complete video and audio are not analyzed.',
            )}
          </p>
          <div className="smm-launch">
            {!working && requirements.length > 0 && (
              <div className="notice" id={requirementsId} aria-live="polite">
                <strong>{t('Before starting research')}</strong>
                <ul>
                  {requirements.map((requirement) => (
                    <li key={requirement}>
                      {requirement}
                      {!connector && requirement === connectionRequirement && (
                        <div className="smm-reconnect-actions">
                          <button
                            type="button"
                            className="text-button"
                            disabled={checkingConnector}
                            onClick={() =>
                              void checkConnection()
                                .then(() => setError(''))
                                .catch(() => {})
                            }
                          >
                            {t('Retry browser connection')}
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            aria-haspopup="dialog"
                            onClick={() => setupDialog.current?.showModal()}
                          >
                            {t('Show connection instructions')}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              className="button primary"
              disabled={working || requirements.length > 0}
              aria-describedby={!working && requirements.length ? requirementsId : undefined}
              onClick={() => void start()}
            >
              {pendingStart.current ? t('Retry research start') : t('Start social research')}
            </button>
          </div>
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {browserMessage(error)}
        </p>
      )}
      {!!sessions.length && (
        <label className="compact-label">
          {t('Research session ')}
          <select
            disabled={working}
            value={session?.id || ''}
            onChange={(e) => void load(e.target.value)}
          >
            {!session && (
              <option value="" disabled>
                {t('New research')}
              </option>
            )}
            {sessions.map((s) => (
              <option value={s.id} key={s.id}>
                {new Date(s.created_at).toLocaleString(getLocale())} · {s.topic}
              </option>
            ))}
          </select>
        </label>
      )}
      {session && (
        <>
          <div className="smm-session-heading">
            <h3>{session.topic}</h3>
            <span className="pill">{t(session.status)}</span>
          </div>
          {session.error && (
            <p className="error" role="alert">
              {browserMessage(session.error)}
            </p>
          )}
          {session.plan.strategy && <p>{session.plan.strategy}</p>}
          {session.plan.app_understanding && (
            <details className="smm-auto-context">
              <summary>{t('App context identified for this search')}</summary>
              <strong>{t('Target audience')}</strong>
              <p>{session.plan.app_understanding.audience}</p>
              {session.inputs.context_origin?.audience === 'ai' && (
                <p className="note">
                  {t('Targeting suggested from the description, not evidence of existing users.')}
                </p>
              )}
              {!!session.plan.app_understanding.features.length && (
                <>
                  <strong>{t('Features found in the description')}</strong>
                  <ul>
                    {session.plan.app_understanding.features.map((feature, i) => (
                      <li key={i}>{feature}</li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          )}
          {session.status === 'stopped' && !!session.plan.queries?.length && (
            <p className="notice" role="status">
              {t('Collection paused. Saved posts and captures are kept.')}
              {posts.length > 0 &&
                t(' You can analyze the saved posts now, without resuming browser collection.')}
            </p>
          )}
          {!!session.plan.queries?.length && (
            <details>
              <summary>
                {t('Search plan · ')}
                {session.plan.queries.length}
                {t(' queries')}
              </summary>
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
                  className={`button ${posts.length ? 'secondary' : 'primary'}`}
                  disabled={working || !connector}
                  onClick={() => void browse()}
                >
                  {posts.length || session.status === 'stopped'
                    ? t('Resume browser research')
                    : t('Search in my browser')}
                </button>
              )}
            {canWrite && ['collecting', 'stopped'].includes(session.status) && posts.length > 0 && (
              <button
                className="button primary"
                disabled={working}
                onClick={() => void analyzeCollected()}
              >
                {t('Analyze collected posts')}
              </button>
            )}
            {canWrite && (working || session.status === 'collecting') && (
              <button className="button secondary" onClick={() => void stopResearch()}>
                {t('Stop research')}
              </button>
            )}
            {canWrite &&
              (!session.workflow_id || !session.inputs.ai) &&
              (['failed', 'canceled'].includes(session.status) ||
                (session.status === 'stopped' && !session.plan.queries?.length)) && (
                <button
                  className="button secondary"
                  disabled={working}
                  onClick={() => void action(session.id, 'retry').catch((e) => setError(e.message))}
                >
                  {t('Retry unfinished research')}
                </button>
              )}
          </div>
          {activity && ['collecting', 'analyzing'].includes(session.status) && (
            <p role="status" className="note">
              {t(activity)}
            </p>
          )}
          {(['planning', 'analyzing', 'failed', 'canceled'].includes(session.status) ||
            (session.status === 'stopped' && !session.plan.queries?.length)) &&
            session.workflow_id && (
              <WorkflowPanel
                key={session.workflow_id}
                workspaceId={workspace.id}
                workflowId={session.workflow_id}
                canWrite={canWrite && !working && !!session.inputs.ai}
                showError={!session.error}
                onStatus={() => {}}
                retryAI={
                  session.inputs.ai
                    ? {
                        choice: session.inputs.ai,
                        owner: workspace.role === 'owner',
                        moduleContext: 'smm',
                        capability: 'vision',
                      }
                    : undefined
                }
                onRetry={async (choice) => {
                  await action(
                    session.id,
                    'retry',
                    choice ? { request_id: crypto.randomUUID(), ...choice } : {},
                  );
                }}
              />
            )}
          {(posts.length > 0 || session.status === 'completed') && (
            <div className="smm-results">
              <div className="smm-session-heading">
                <h3>
                  {t('References · ')}
                  {!pending.length && (
                    <>
                      {qualified.length}
                      {t(' qualified / ')}
                    </>
                  )}
                  {posts.length}
                  {t(' collected')}
                </h3>
                <span className="note">
                  {t('Filters: ')}
                  {session.inputs.min_views.toLocaleString(getLocale())}
                  {t(' views ·')} {session.inputs.min_likes.toLocaleString(getLocale())}
                  {t(' likes')}
                </span>
              </div>
              {pending.length > 0 && (
                <div className="notice" role="status">
                  <p>
                    {t(
                      '{0} awaiting AI review · {1} qualified · {2} excluded',
                      pending.length,
                      qualified.length,
                      excluded.length,
                    )}
                  </p>
                  <p className="note">
                    {session.status === 'analyzing'
                      ? t(
                          'AI analysis is in progress. Relevance to your app and the captured evidence are being checked.',
                        )
                      : t(
                          'Meeting the thresholds is the first step. AI still needs to check relevance to your app and verify the captured evidence.',
                        )}
                  </p>
                </div>
              )}
              {session.status === 'completed' && excluded.length > 0 && qualified.length === 0 && (
                <div className="notice" role="status">
                  <strong>{t('Search completed without qualified references.')}</strong>
                  <p>{t('The collected posts were saved. Here is why they were not qualified:')}</p>
                  <ul>
                    {exclusionSummary
                      .filter((group) => group.count > 0)
                      .map((group) => (
                        <li key={group.label}>{t(group.label, group.count)}</li>
                      ))}
                    {otherExclusions > 0 && (
                      <li>
                        {t('{0} post(s) with insufficient relevance or evidence.', otherExclusions)}
                      </li>
                    )}
                  </ul>
                  <p className="note">
                    {t(
                      'A post can have several reasons. Missing counts do not mean zero views or likes.',
                    )}
                  </p>
                  <button
                    type="button"
                    className="button secondary"
                    aria-expanded={showOtherReferences && referencePlatform === 'all'}
                    aria-controls={referenceListId}
                    onClick={() => {
                      setReferencePlatform('all');
                      setShowOtherReferences(true);
                      requestAnimationFrame(() =>
                        document
                          .getElementById(referenceListId)
                          ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }),
                      );
                    }}
                  >
                    {t('View collected posts and reasons ({0})', posts.length)}
                  </button>
                </div>
              )}
              {hasSkippedPosts && (
                <p className="note">
                  {t('Unavailable posts were skipped. Their links are saved in Browser activity.')}
                </p>
              )}
              {allReferences.length > 0 && (
                <div className="smm-reference-filters">
                  <div role="group" aria-label={t('Filter references by platform')}>
                    {['all', ...referencePlatforms].map((platform) => (
                      <button
                        key={platform}
                        type="button"
                        aria-pressed={referencePlatform === platform}
                        onClick={() => {
                          setReferencePlatform(platform);
                          setShowAllQualified(false);
                          setShowOtherReferences(false);
                        }}
                      >
                        {platform === 'all' ? t('All platforms') : names[platform]}
                        <span>
                          {platform === 'all'
                            ? allReferences.length
                            : allReferences.filter((post) => post.evidence.platform === platform)
                                .length}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="note" role="status">
                    {t(
                      '{0} of {1} references shown',
                      visibleReferences.length,
                      platformReferences.length,
                    )}
                    {referencePlatform !== 'all' && ` · ${names[referencePlatform]}`}
                    {hiddenSelected > 0 && (
                      <>
                        {' · '}
                        {t('{0} selected outside this filter', hiddenSelected)}
                      </>
                    )}
                    {collapsedSelected > 0 && (
                      <>
                        {' · '}
                        {t('{0} selected in hidden results', collapsedSelected)}
                      </>
                    )}
                  </p>
                  {canWrite && session.status === 'completed' && (
                    <p className="note">
                      {t(
                        'Select one to three qualified references. Each selected reference creates one adaptation.',
                      )}
                    </p>
                  )}
                </div>
              )}
              {session.status === 'completed' && (
                <div className="smm-library">
                  <h4>{t('References from other research')}</h4>
                  <p className="note">
                    {t(
                      "Reuse qualified posts for this app with the same confirmed features, audience, market and app import. These references also pass this session's performance filters. Counts remain those observed on the capture date.",
                    )}
                  </p>
                  {library.sessionId === session.id && library.loading && (
                    <p role="status">{t('Loading saved references…')}</p>
                  )}
                  {library.sessionId === session.id && library.error && (
                    <p role="alert">
                      {t('Could not load saved references. ')}
                      {t(library.error)}{' '}
                      <button onClick={() => setLibraryRefresh((value) => value + 1)}>
                        {t('Retry saved references')}
                      </button>
                    </p>
                  )}
                  {!library.loading && !library.error && (
                    <>
                      <p>
                        {t(
                          'This research: {0} qualified · Previous research: {1} qualified.',
                          qualified.length,
                          reusable.length,
                        )}
                      </p>
                      {reusable.length > 0 && (
                        <>
                          <p className="note">
                            {t(
                              'Saved references on: {0}.',
                              platforms
                                .filter((platform) =>
                                  reusable.some((post) => post.evidence.platform === platform),
                                )
                                .map((platform) => names[platform])
                                .join(', '),
                            )}
                          </p>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => {
                              setReferencePlatform('all');
                              setShowOtherReferences(false);
                              setShowAllQualified(false);
                            }}
                          >
                            {t('Show qualified references ({0})', available)}
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {session.inputs.brief && (
                    <details>
                      <summary>{t('App context used')}</summary>
                      <p>{session.inputs.brief.product_facts}</p>
                      <p className="note">
                        {t('Audience: ')}
                        {session.inputs.brief.audience}
                        {t(' · Language:')} {session.inputs.brief.language}
                      </p>
                    </details>
                  )}
                </div>
              )}
              {session.status === 'completed' && !library.loading && available === 0 && (
                <p className="notice">
                  {t(
                    'No qualified references yet. Refine the topic or search another platform in a new session.',
                  )}
                </p>
              )}
              {referencePlatform !== 'all' &&
                !visibleReferences.length &&
                otherReferenceCount > 0 && (
                  <p className="note">{t('No qualified references on this platform.')}</p>
                )}
              <div className="smm-post-grid" id={referenceListId}>
                {visibleReferences.map((p) => (
                  <article className="smm-post" key={p.id}>
                    <div className="smm-session-heading">
                      <span
                        className={`pill ${p.qualification.status === 'qualified' ? 'approved' : ''}`}
                      >
                        {p.qualification.status === 'metrics_pass'
                          ? t('Thresholds met · awaiting AI review')
                          : t(p.qualification.status.replaceAll('_', ' '))}
                      </span>
                      <span className="note">
                        {p.evidence.platform && `${names[p.evidence.platform]} · `}
                        {t(
                          (p.analysis.format || p.evidence.format) === 'unknown'
                            ? 'Unknown format'
                            : (p.analysis.format || p.evidence.format).replaceAll('_', ' '),
                        )}
                      </span>
                    </div>
                    <h4>
                      <a href={p.url} target="_blank" rel="noreferrer">
                        {p.evidence.title || p.url} ↗
                      </a>
                    </h4>
                    <p className="note">
                      {p.evidence.author}
                      {t(' · Observed ')}
                      {new Date(p.captured_at).toLocaleString(getLocale())}
                      {p.evidence.published_at && t(' · Published {0}', p.evidence.published_at)}
                    </p>
                    {p.research_topic && (
                      <p className="note">
                        {t('From research: ')}
                        {p.research_topic}
                      </p>
                    )}
                    <div className="smm-counters">
                      {['views', 'likes', 'comments', 'shares']
                        .filter(
                          (k) =>
                            k !== 'views' ||
                            p.metrics.views ||
                            !['image', 'carousel', 'text'].includes(
                              p.analysis.format || p.evidence.format,
                            ),
                        )
                        .map((k) => (
                          <span key={k}>
                            <strong>
                              {p.metrics[k]
                                ? `${p.metrics[k].approximate ? '≈ ' : ''}${p.metrics[k].value.toLocaleString(getLocale())}`
                                : t('Not observed')}
                            </strong>
                            {t(k)}
                          </span>
                        ))}
                    </div>
                    {p.qualification.reasons.map((reason, i) => (
                      <p className="note" key={i}>
                        {t(reason)}
                      </p>
                    ))}
                    {p.analysis.observation && <p>{p.analysis.observation}</p>}
                    {p.analysis.structure && (
                      <p>
                        <strong>{t('Structure:')}</strong> {p.analysis.structure}
                      </p>
                    )}
                    {p.analysis.idea_to_test && (
                      <p>
                        <strong>{t('Adaptation idea:')}</strong> {p.analysis.idea_to_test}
                      </p>
                    )}
                    <details>
                      <summary>
                        {t('Evidence and coverage · ')}
                        {p.frame_count}
                        {t(' frames')}
                      </summary>
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
                              alt={t('Observed viewport {0}', i + 1)}
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                      <p className="note">
                        {p.evidence.coverage
                          .split('\n')
                          .map((line) => t(line))
                          .join('\n')}
                      </p>
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
                            (!selected.includes(p.id) && selected.length >= 3)
                          }
                          checked={selected.includes(p.id)}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked ? [...old, p.id] : old.filter((id) => id !== p.id),
                            )
                          }
                        />
                        {t(' Use this reference')}
                      </label>
                    )}
                  </article>
                ))}
              </div>
              {(qualifiedReferences.length > initialQualifiedLimit || otherReferenceCount > 0) && (
                <div className="action-group">
                  {qualifiedReferences.length > initialQualifiedLimit && (
                    <button
                      type="button"
                      className="button secondary"
                      aria-expanded={showAllQualified}
                      aria-controls={referenceListId}
                      onClick={() => setShowAllQualified((shown) => !shown)}
                    >
                      {showAllQualified
                        ? t('Show less')
                        : t('Show more ({0})', qualifiedReferences.length - initialQualifiedLimit)}
                    </button>
                  )}
                  {otherReferenceCount > 0 && (
                    <button
                      type="button"
                      className="button secondary"
                      aria-expanded={showOtherReferences}
                      aria-controls={referenceListId}
                      onClick={() => setShowOtherReferences((shown) => !shown)}
                    >
                      {showOtherReferences
                        ? t('Hide other references')
                        : t('Show other references ({0})', otherReferenceCount)}
                    </button>
                  )}
                </div>
              )}
              {canWrite && session.status === 'completed' && (
                <button
                  className="button primary"
                  disabled={working || selected.length < 1 || selected.length > 3}
                  onClick={() => void generate()}
                >
                  {pendingAdapt.current
                    ? t('Retry adaptation start')
                    : selected.length === 0
                      ? t('Create adaptations')
                      : selected.length === 1
                        ? t('Create 1 adaptation')
                        : t('Create {0} adaptations', selected.length)}
                </button>
              )}
            </div>
          )}
          <details className="smm-journal">
            <summary>
              {t('Browser activity · ')}
              {session.events.length}
              {t(' events')}
            </summary>
            <ol>
              {session.events.map((e, i) => (
                <li key={i}>
                  <time>{new Date(e.at).toLocaleTimeString(getLocale())}</time>{' '}
                  {browserMessage(e.message)}
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {' '}
                      {t('Source ↗')}
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
