import { canonicalPost, dashboardOrigins, searchUrl } from './urls.js';
const running = new Map();
const transientPlatformError =
  'The platform returned an error. Retry in the research tab, then resume.';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sessionKey = (sender) => `panda-smm-${sender.tab.id}`;
const reconnecting = new Map();
async function reconnectDashboard(tabId) {
  if (reconnecting.has(tabId)) return reconnecting.get(tabId);
  const reconnect = (async () => {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !dashboardOrigins.has(new URL(tab.url).origin)) return;
    const target = { tabId, frameIds: [0] };
    const probe = await chrome.scripting.executeScript({
      target,
      func: () => Boolean(chrome.runtime.id && globalThis.pandaSmmBridgeListener),
    });
    // A healthy bridge may have a research command in flight. Leave it intact.
    if (probe[0]?.result === true) return;
    await chrome.scripting.executeScript({ target, files: ['bridge.js'], injectImmediately: true });
  })().finally(() => reconnecting.delete(tabId));
  reconnecting.set(tabId, reconnect);
  return reconnect;
}
async function reconnectDashboards() {
  const tabs = await chrome.tabs.query({ url: ['http://127.0.0.1/*', 'http://localhost/*'] });
  await Promise.allSettled(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url || !dashboardOrigins.has(new URL(tab.url).origin)) return;
      await reconnectDashboard(tab.id);
    }),
  );
}
// Chrome treats reloading an unpacked extension as an update. Reattach without
// reloading the dashboard: its form, selected model and saved sessions stay intact.
chrome.runtime.onInstalled.addListener(() => void reconnectDashboards().catch(() => {}));
chrome.runtime.onStartup.addListener(() => void reconnectDashboards().catch(() => {}));
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void reconnectDashboard(tabId).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') void reconnectDashboard(tabId).catch(() => {});
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) void reconnectDashboards().catch(() => {});
});
// onStartup is a browser-profile event, not a service-worker wake event. Repair
// missing bridges on each worker start as well, including re-enabling the extension.
void reconnectDashboards().catch(() => {});
function authorized(sender) {
  try {
    return sender.frameId === 0 && dashboardOrigins.has(new URL(sender.url).origin);
  } catch {
    return false;
  }
}
async function owned(sender, session) {
  const key = sessionKey(sender);
  const state = (await chrome.storage.session.get(key))[key];
  if (!state || state.session !== session) throw new Error('Open a research tab first.');
  return state;
}
async function validTab(state, expected) {
  const tab = await chrome.tabs.get(state.tabId);
  const url = tab.url || '';
  if (expected && !sameDestination(url, expected))
    throw new Error('The research tab redirected or needs sign-in. Open the post and resume.');
  if (
    !['www.tiktok.com', 'www.instagram.com', 'www.facebook.com', 'www.google.com'].includes(
      new URL(url).hostname,
    )
  )
    throw new Error(
      'Research left the supported sites. Resolve sign-in in the browser and resume.',
    );
  if (tab.pendingUrl)
    throw new Error('The research tab is navigating. Wait for the page, then resume.');
}
function sameDestination(actual, expected) {
  if (canonicalPost(expected)) return canonicalPost(actual) === canonicalPost(expected);
  try {
    const a = new URL(actual);
    const b = new URL(expected);
    return (
      a.origin === b.origin &&
      a.pathname === b.pathname &&
      a.searchParams.get('q') === b.searchParams.get('q')
    );
  } catch {
    return false;
  }
}
async function navigate(state, url, check, attempts = 50) {
  check();
  const current = await chrome.tabs.get(state.tabId);
  check();
  // Keep a page the user has just recovered (retry, sign-in or challenge).
  // Reloading would discard its results and can trigger the failure again.
  await chrome.tabs.update(
    state.tabId,
    !current.pendingUrl && sameDestination(current.url || '', url)
      ? { active: true }
      : { url, active: true },
  );
  for (let i = 0; i < attempts; i++) {
    await wait(400);
    check();
    const tab = await chrome.tabs.get(state.tabId);
    if (tab.pendingUrl || !sameDestination(tab.url || '', url)) continue;
    const result = await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      injectImmediately: true,
      func: () => ({
        url: location.href,
        ready: document.readyState !== 'loading',
      }),
    });
    if (!result[0]?.result?.ready || !sameDestination(result[0].result.url, url)) continue;
    await validTab(state, url);
    await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      files: ['collector.js'],
      injectImmediately: true,
    });
    return true;
  }
  return false;
}
async function collect(state, action, check, argument) {
  for (let attempt = 0; attempt < 3; attempt++) {
    check();
    await validTab(state, state.destination);
    const result = await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      injectImmediately: true,
      func: (name, argument) => globalThis.pandaSmmCollector?.[name]?.(argument),
      args: [action, argument ?? null],
    });
    const value = result[0]?.result;
    if (value != null || ['scroll', 'facebookTarget', 'facebookCloseTarget'].includes(action))
      return value;
    // A client-side page replacement can discard the isolated world after
    // navigation. Reinstall only in the same requested destination and retry.
    await wait(400);
    check();
    await validTab(state, state.destination);
    await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      files: ['collector.js'],
      injectImmediately: true,
    });
  }
  throw new Error('The page changed while being read. Wait for the post, then resume research.');
}
async function clickFacebookTarget(state, target, check) {
  if (
    !target ||
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y) ||
    target.x < 0 ||
    target.y < 0 ||
    new URL(state.destination).hostname !== 'www.facebook.com'
  )
    throw new Error('The Facebook post control is not visible. Resume research.');
  check();
  await validTab(state, state.destination);
  await chrome.debugger.attach({ tabId: state.tabId }, '1.3');
  try {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      check();
      await validTab(state, state.destination);
      await chrome.debugger.sendCommand({ tabId: state.tabId }, 'Input.dispatchMouseEvent', {
        type,
        x: target.x,
        y: target.y,
        button: type === 'mouseMoved' ? 'none' : 'left',
        clickCount: type === 'mouseMoved' ? 0 : 1,
      });
    }
  } finally {
    await chrome.debugger.detach({ tabId: state.tabId }).catch(() => {});
  }
}
async function resolveFacebookPost(state, target, check) {
  const search = state.destination;
  await clickFacebookTarget(state, target, check);
  let permalink;
  for (let i = 0; i < 30; i++) {
    check();
    const tab = await chrome.tabs.get(state.tabId);
    permalink = canonicalPost(tab.url || '');
    if (!tab.pendingUrl && permalink && new URL(permalink).hostname === 'www.facebook.com') break;
    permalink = null;
    await wait(100);
  }
  if (!permalink) {
    await validTab(state, search);
    return null;
  }
  state.destination = permalink;
  let close;
  for (let i = 0; i < 30; i++) {
    close = await collect(state, 'facebookCloseTarget', check);
    if (close) break;
    await wait(100);
  }
  await clickFacebookTarget(state, close, check);
  for (let i = 0; i < 30; i++) {
    check();
    const tab = await chrome.tabs.get(state.tabId);
    if (!tab.pendingUrl && sameDestination(tab.url || '', search)) {
      state.destination = search;
      return {
        url: permalink,
        title: target.title,
        search_count: '',
        search_quote: target.search_quote,
        search_url: target.search_url,
      };
    }
    await wait(100);
  }
  throw new Error('Facebook did not return to the search. Resume research from Panda Store.');
}
async function screenshot(state) {
  await chrome.debugger.attach({ tabId: state.tabId }, '1.3');
  try {
    const layout = await chrome.debugger.sendCommand(
      { tabId: state.tabId },
      'Page.getLayoutMetrics',
    );
    const viewport = layout.cssVisualViewport;
    const result = await chrome.debugger.sendCommand(
      { tabId: state.tabId },
      'Page.captureScreenshot',
      {
        format: 'jpeg',
        quality: 40,
        captureBeyondViewport: false,
        clip: {
          x: viewport.pageX,
          y: viewport.pageY,
          width: viewport.clientWidth,
          height: viewport.clientHeight,
          scale: Math.min(1, 1200 / viewport.clientWidth, 1600 / viewport.clientHeight),
        },
      },
    );
    return result.data.length <= 275000 ? result.data : null;
  } finally {
    await chrome.debugger.detach({ tabId: state.tabId }).catch(() => {});
  }
}
async function instagramViewEvidence(state, capture, profile, check) {
  const postUrl = state.destination;
  if (!(await navigate(state, profile, check, 12))) {
    capture.coverage += '\nThe Instagram Reels view counter could not be verified.';
  } else {
    state.destination = profile;
    // Bounded profile lookup, using only the exact shortcode's labelled views.
    for (let i = 0; i < 12; i++) {
      check();
      const result = await collect(state, 'instagramViews', check, postUrl);
      if (result.blocked_reason) {
        capture.blocked_reason = result.blocked_reason;
        return false;
      }
      if (result.metric) {
        await validTab(state, profile);
        try {
          const frame = await screenshot(state);
          if (frame) {
            capture.metrics.views = result.metric;
            capture.text = capture.text.slice(0, 23750) + '\n' + result.metric.quote;
            capture.frames = [...capture.frames.slice(0, 2), frame];
            capture.coverage +=
              '\nThe last frame shows the matching Reel’s view counter on the creator profile, not the video content.';
          }
        } catch {
          capture.coverage += '\nThe Instagram Reels view counter could not be verified.';
        }
        break;
      }
      if (i < 11) {
        await collect(state, 'scroll', check);
        await wait(600);
      }
    }
  }
  if (
    !capture.metrics.views &&
    !capture.coverage.includes('The Instagram Reels view counter could not be verified.')
  )
    capture.coverage += '\nThe Instagram Reels view counter could not be verified.';
  check();
  if (!(await navigate(state, postUrl, check)))
    throw new Error('The requested page did not become ready. Check the research tab and resume.');
  state.destination = postUrl;
  return true;
}
async function facebookPostEvidence(state, capture, check) {
  // Preserve the initial content frame, then observe media and reactions in the
  // same post. Facebook can mount those controls after the caption has loaded.
  for (const area of ['media', 'engagement']) {
    if (!(await collect(state, 'facebookEvidenceTarget', check, area))) continue;
    let observed;
    for (let attempt = 0; attempt < 3; attempt++) {
      await wait(800);
      check();
      observed = await collect(state, 'read', check);
      if (observed.blocked_reason && observed.blocked_reason !== transientPlatformError) {
        capture.blocked_reason = observed.blocked_reason;
        return false;
      }
      if (canonicalPost(observed.url) !== canonicalPost(capture.url))
        throw new Error('The tab is no longer on the requested social post.');
      if (observed.ready && !observed.blocked_reason && observed.metrics?.likes) break;
    }
    if (!observed.ready || observed.blocked_reason) continue;
    await validTab(state, state.destination);
    try {
      const frame = await screenshot(state);
      if (!frame) continue;
      capture.frames = [...capture.frames.slice(0, area === 'media' ? 1 : 2), frame];
      const metrics = { ...capture.metrics, ...observed.metrics };
      const quotes = Object.values(metrics)
        .map((metric) => metric.quote)
        .join('\n');
      capture.text = capture.text.slice(0, 23999 - quotes.length) + '\n' + quotes;
      capture.metrics = metrics;
      if (['image', 'carousel', 'text'].includes(observed.format)) capture.format = observed.format;
      capture.coverage +=
        area === 'media'
          ? '\nAn additional frame shows the post media after scrolling within the same post.'
          : '\nThe last frame shows the post engagement area after scrolling, not another media sample. Only explicitly labelled counters were recorded.';
    } catch {
      capture.coverage += '\nAdditional Facebook evidence screenshot unavailable.';
    }
  }
  return true;
}
async function command(message, sender) {
  if (!authorized(sender))
    throw new Error('Only the local Panda Store dashboard can use this connector.');
  const { command, payload = {} } = message;
  if (command === 'ping') return { version: '0.1.11', protocol: 1 };
  const key = sessionKey(sender);
  if (command === 'stop') {
    running.get(key)?.abort();
    return { stopped: true };
  }
  if (typeof payload.session !== 'string' || !/^[\da-f-]{36}$/.test(payload.session))
    throw new Error('Invalid research session.');
  if (command === 'open') {
    running.get(key)?.abort();
    let state = (await chrome.storage.session.get(key))[key];
    if (state?.session === payload.session) {
      try {
        await chrome.tabs.get(state.tabId);
        return { opened: true };
      } catch {}
    }
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    state = { session: payload.session, tabId: tab.id };
    await chrome.storage.session.set({ [key]: state });
    return { opened: true };
  }
  if (!['search', 'read'].includes(command)) throw new Error('Unknown browser command.');
  if (running.has(key)) throw new Error('A browser action is already running.');
  const controller = new AbortController();
  running.set(key, controller);
  const check = () => {
    if (controller.signal.aborted) throw new Error('Browser research stopped.');
  };
  try {
    const state = await owned(sender, payload.session);
    const url =
      command === 'search'
        ? searchUrl(payload.platform, payload.query)
        : canonicalPost(payload.url);
    if (!url) throw new Error('Invalid social post URL.');
    if (!(await navigate(state, url, check)))
      return {
        candidates: [],
        blocked_reason:
          'The requested page did not become ready. Check the research tab and resume.',
      };
    state.destination = url;
    if (command === 'search') {
      const candidates = new Map();
      let blocked = '';
      let scrolls = 0;
      const facebookSeen = [];
      // Meta search results arrive after the page shell. Wait for actual post links.
      for (let i = 0; i < 13; i++) {
        check();
        await validTab(state, url);
        const result = await collect(state, 'discover', check);
        blocked = result.blocked_reason;
        // Server-error panels can disappear while the page finishes loading.
        // Wait within the existing budget; login and captcha still stop at once.
        if (blocked && blocked !== transientPlatformError) break;
        if (blocked) {
          if (i < 12) await wait(1000);
          continue;
        }
        for (const candidate of result.candidates) candidates.set(candidate.url, candidate);
        if (payload.platform === 'facebook' && facebookSeen.length < 3) {
          const target = await collect(state, 'facebookTarget', check, facebookSeen);
          if (target) {
            facebookSeen.push(target.identity);
            const candidate = await resolveFacebookPost(state, target, check);
            if (candidate) candidates.set(candidate.url, candidate);
          }
        }
        if (candidates.size) {
          if (scrolls++ >= 2) break;
          await collect(state, 'scroll', check);
        }
        if (i < 12) await wait(1000);
      }
      return {
        candidates: [...candidates.values()].slice(0, 30),
        blocked_reason: blocked,
      };
    }
    let capture;
    for (let i = 0; i < 13; i++) {
      check();
      await validTab(state, url);
      capture = await collect(state, 'read', check);
      if (capture.blocked_reason && capture.blocked_reason !== transientPlatformError) break;
      if (!capture.blocked_reason && capture.ready) break;
      if (i < 12) await wait(1000);
    }
    if (!capture.ready && !capture.blocked_reason)
      capture.blocked_reason =
        'The post content did not become ready. Open it in the browser and resume.';
    delete capture.ready;
    const instagramProfile = capture.instagram_profile;
    delete capture.instagram_profile;
    capture.frames = [];
    if (!capture.blocked_reason) {
      for (let i = 0; i < 3; i++) {
        check();
        await validTab(state, url);
        try {
          const frame = await screenshot(state);
          if (frame) capture.frames.push(frame);
        } catch {
          capture.coverage += ' Screenshot capture unavailable.';
          break;
        }
        if (capture.format === 'carousel') {
          if (!(await collect(state, 'nextSlide', check))) break;
        } else if (['text', 'image'].includes(capture.format)) break;
        await wait(1800);
      }
      if (
        ['image', 'carousel', 'text', 'unknown'].includes(capture.format) &&
        new URL(url).hostname === 'www.facebook.com'
      ) {
        if (!(await facebookPostEvidence(state, capture, check))) return capture;
      }
      if (
        capture.format === 'video' &&
        !capture.metrics?.views &&
        new URL(url).hostname === 'www.instagram.com' &&
        /^https:\/\/www\.instagram\.com\/[\w.]{1,30}\/reels\/$/.test(instagramProfile || '')
      ) {
        if (!(await instagramViewEvidence(state, capture, instagramProfile, check))) return capture;
      }
    }
    check();
    await validTab(state, url);
    return capture;
  } finally {
    if (running.get(key) === controller) running.delete(key);
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  command(message, sender)
    .then((result) => reply({ result }))
    .catch((error) => reply({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = `panda-smm-${tabId}`;
  running.get(key)?.abort();
  await chrome.storage.session.remove(key);
});
