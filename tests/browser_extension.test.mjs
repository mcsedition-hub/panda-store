import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from '../web/node_modules/jsdom/lib/api.js';
import {
  canonicalPost,
  dashboardOrigins,
  searchUrl,
} from '../addons/studio/browser_extension/urls.js';

const code = await readFile(
  new URL('../addons/studio/browser_extension/collector.js', import.meta.url),
  'utf8',
);
function page(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.Element.prototype.getBoundingClientRect = () => ({
    width: 50,
    height: 50,
  });
  dom.window.eval(code);
  return dom;
}
test('commands restrict destinations to supported direct posts and encoded search terms', () => {
  assert.equal(
    canonicalPost('https://www.tiktok.com/@a/video/123?track=x'),
    'https://www.tiktok.com/@a/video/123',
  );
  for (const url of [
    'https://evil.test/@a/video/1',
    'https://tiktok.com.evil.test/@a/video/1',
    'javascript:alert(1)',
    'https://www.tiktok.com/login',
    'https://x@www.tiktok.com/@a/video/1',
  ])
    assert.equal(canonicalPost(url), null);
  assert.equal(
    searchUrl('tiktok', 'photos & clean'),
    'https://www.tiktok.com/search?q=photos%20%26%20clean',
  );
  assert.throws(() => searchUrl('unknown', 'query'));
});

test('dashboard bridge accepts local development and Compose origins only', async () => {
  const bridge = await readFile(
    new URL('../addons/studio/browser_extension/bridge.js', import.meta.url),
    'utf8',
  );
  for (const origin of [
    ...dashboardOrigins,
    'http://127.0.0.1:8081',
    'https://localhost:8080',
    'http://localhost.evil.test:8080',
    'https://www.facebook.com',
  ]) {
    const dom = new JSDOM('', { url: origin, runScripts: 'outside-only' });
    let calls = 0;
    const response = new Promise((resolve) => {
      dom.window.postMessage = (message) => {
        if (message.channel === 'panda-smm-response') resolve(message);
      };
    });
    dom.window.chrome = {
      runtime: {
        id: 'panda-test',
        sendMessage: async () => {
          calls++;
          return {};
        },
      },
    };
    dom.window.eval(bridge);
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        source: dom.window,
        origin,
        data: { channel: 'panda-smm-request', id: 'ping-check', command: 'ping' },
      }),
    );
    assert.equal(calls, dashboardOrigins.has(origin) ? 1 : 0, origin);
    if (dashboardOrigins.has(origin)) await response;
    dom.window.close();
  }
});
test('reinjecting the dashboard bridge signals readiness without duplicating commands', async () => {
  const bridge = await readFile(
    new URL('../addons/studio/browser_extension/bridge.js', import.meta.url),
    'utf8',
  );
  const dom = new JSDOM('<input value="My unsaved topic">', {
    url: 'http://localhost:5173',
    runScripts: 'outside-only',
  });
  let calls = 0;
  const replies = [];
  dom.window.chrome = {
    runtime: {
      id: 'panda-test',
      sendMessage: async () => {
        calls++;
        return { result: {} };
      },
    },
  };
  dom.window.postMessage = (reply) => replies.push(reply);
  dom.window.eval(bridge);
  dom.window.eval(bridge);
  assert.equal(replies.filter((r) => r.channel === 'panda-smm-ready').length, 2);
  const request = () =>
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        source: dom.window,
        origin: dom.window.location.origin,
        data: { channel: 'panda-smm-request', id: 'one-search', command: 'search' },
      }),
    );
  request();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(replies.filter((r) => r.channel === 'panda-smm-response').length, 1);
  assert.equal(dom.window.document.querySelector('input').value, 'My unsaved topic');
  delete dom.window.chrome.runtime.id;
  request();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(replies.length, 3, 'invalidated bridges must not compete with the replacement');
  dom.window.close();
});

test('installation and browser startup reconnect only supported dashboard tabs without reloading', async () => {
  const events = {};
  const injected = [];
  const allowed = [...dashboardOrigins].map((url, index) => ({ id: index + 1, url: `${url}/` }));
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      onInstalled: {
        addListener: (fn) => {
          events.install = fn;
        },
      },
      onStartup: {
        addListener: (fn) => {
          events.startup = fn;
        },
      },
      onMessage: { addListener() {} },
    },
    tabs: {
      onRemoved: { addListener() {} },
      query: async () => [
        ...allowed,
        { id: 30, url: 'http://localhost:8081/' },
        { id: 31, url: 'https://www.instagram.com/' },
        { id: 32, url: 'http://localhost.evil.test:5173/' },
      ],
      reload: () => assert.fail('reconnection must preserve the dashboard form'),
    },
    scripting: {
      executeScript: async (args) => {
        injected.push(args);
        if (args.target.tabId === 1) throw new Error('Tab closed');
      },
    },
  };
  try {
    await import('../addons/studio/browser_extension/background.js?reconnect-test');
    for (const event of Object.values(events)) {
      injected.length = 0;
      event();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(
        injected.map((item) => item.target.tabId),
        allowed.map((tab) => tab.id),
      );
      for (const item of injected) {
        assert.deepEqual(item.target.frameIds, [0]);
        assert.deepEqual(item.files, ['bridge.js']);
      }
    }
    assert.equal(Object.keys(events).length, 2);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
test('Facebook page permalinks retain both identifiers and discard tracking consistently', () => {
  const raw =
    'https://www.facebook.com/permalink.php?id=61593971734574&story_fbid=pfbid034GTbF4uCW6JTb&tracking=x';
  const canonical =
    'https://www.facebook.com/permalink.php?story_fbid=pfbid034GTbF4uCW6JTb&id=61593971734574';
  assert.equal(canonicalPost(raw), canonical);
  const dom = page(
    '<div role="dialog"><h3><a>Storage app</a></h3><div data-ad-preview="message">Swipe photos</div></div>',
    raw,
  );
  assert.equal(dom.window.pandaSmmCollector.read().url, canonical);
  for (const query of [
    'id=123',
    'story_fbid=pfbid123',
    'story_fbid=bad&id=123',
    'story_fbid=123&id=abc',
    'story_fbid=123&id=1&id=2',
    'story_fbid=123&story_fbid=456&id=1',
  ]) {
    const invalid = `https://www.facebook.com/permalink.php?${query}`;
    assert.equal(canonicalPost(invalid), null);
    dom.window.history.replaceState({}, '', invalid);
    assert.throws(() => dom.window.pandaSmmCollector.read(), /no longer/);
  }
  dom.window.close();
});
test('TikTok extraction ties page-data counters to the current post id', () => {
  const data = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        itemInfo: {
          itemStruct: {
            id: '123',
            desc: 'Plan a short run',
            author: { uniqueId: 'runner' },
            stats: { playCount: 45000, diggCount: 1700, shareCount: 42 },
            createTime: 1700000000,
          },
        },
      },
    },
  };
  const dom = page(
    `<body><p>Plan a short run</p><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></body>`,
    'https://www.tiktok.com/@runner/video/123',
  );
  const result = dom.window.pandaSmmCollector.read();
  assert.equal(result.metrics.views.raw, '45000');
  assert.equal(result.metrics.likes.raw, '1700');
  assert.ok(result.text.includes(result.metrics.likes.quote));
  assert.equal(result.format, 'video');
  data.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct.id = '999';
  dom.window.document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__').textContent =
    JSON.stringify(data);
  assert.deepEqual(Object.keys(dom.window.pandaSmmCollector.read().metrics), []);
  dom.window.close();
});
test('missing counters stay absent and a sign-in gate is reported', () => {
  const dom = page(
    '<body><input type="password"><p>Sign in</p></body>',
    'https://www.tiktok.com/@runner/video/123',
  );
  const result = dom.window.pandaSmmCollector.read();
  assert.deepEqual(Object.keys(result.metrics), []);
  assert.match(result.blocked_reason, /Sign-in/);
  dom.window.close();
});
test('discovery deduplicates posts and keeps ambiguous card counters separate from views', () => {
  const dom = page(
    `<body><div data-e2e="search_top-item"><a href="/@a/video/1">One</a><span data-e2e="video-views">25K</span></div>
    <a href="/@a/video/1?share=true">Duplicate</a><a href="https://evil.test/@a/video/2">Bad</a>
    <a href="/@b/photo/2">Two</a></body>`,
    'https://www.tiktok.com/search?q=running',
  );
  const result = dom.window.pandaSmmCollector.discover();
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].search_count, '25K');
  assert.equal(result.candidates[1].search_count, '');
  assert.equal(result.candidates[0].search_views, undefined);
  dom.window.close();
});
test('background rejects commands from social sites and owns only tabs it creates', async () => {
  let listener;
  let calls = 0;
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener: (fn) => {
          listener = fn;
        },
      },
    },
    tabs: {
      onRemoved: { addListener() {} },
      create: async () => {
        calls++;
        return { id: 9 };
      },
    },
    storage: { session: { get: async () => ({}), set: async () => {} } },
  };
  await import('../addons/studio/browser_extension/background.js');
  const send = (message, sender) => new Promise((resolve) => listener(message, sender, resolve));
  const request = {
    command: 'open',
    payload: { session: '11111111-1111-1111-1111-111111111111' },
  };
  const denied = await send(request, {
    url: 'https://www.tiktok.com',
    frameId: 0,
    tab: { id: 1 },
  });
  assert.match(denied.error, /Only the local/);
  assert.equal(calls, 0);
  for (const host of ['127.0.0.1', 'localhost']) {
    const ping = await send(
      { command: 'ping' },
      {
        url: `http://${host}:8080/`,
        frameId: 0,
        tab: { id: 1 },
      },
    );
    const manifest = JSON.parse(
      await readFile(
        new URL('../addons/studio/browser_extension/manifest.json', import.meta.url),
        'utf8',
      ),
    );
    assert.equal(ping.result.version, manifest.version);
  }
  for (const sender of [
    { url: 'http://127.0.0.1:8081/', frameId: 0 },
    { url: 'http://localhost.evil.test:8080/', frameId: 0 },
    { url: 'http://localhost:8080/', frameId: 1 },
  ]) {
    assert.match((await send(request, { ...sender, tab: { id: 1 } })).error, /Only the local/);
  }
  assert.ok(
    (
      await send(request, {
        url: 'http://127.0.0.1:5173/',
        frameId: 0,
        tab: { id: 1 },
      })
    ).result.opened,
  );
  assert.equal(calls, 1);
  const noOwnership = await send(
    {
      command: 'read',
      payload: { ...request.payload, url: 'https://www.tiktok.com/@a/video/1' },
    },
    { url: 'http://127.0.0.1:5173/', frameId: 0, tab: { id: 2 } },
  );
  assert.match(noOwnership.error, /Open a research tab/);
  delete globalThis.chrome;
});

test('a platform server error is surfaced while ordinary post wording is not treated as a block', () => {
  const dom = page(
    '<body><h2>Un problème est survenu</h2><p>Sorry, something wrong with the server, please try again.</p><button>Essaie à nouveau</button></body>',
    'https://www.tiktok.com/search?q=photo',
  );
  assert.match(
    dom.window.pandaSmmCollector.discover().blocked_reason,
    /platform returned an error/,
  );
  dom.window.document.body.innerHTML = '<article>My computer said something went wrong.</article>';
  assert.equal(dom.window.pandaSmmCollector.discover().blocked_reason, '');
  dom.window.close();
});

test('Instagram counters come from the open post, not captions, comments or background posts', () => {
  const dom = page(
    `<meta property="og:description" content="999K likes">
    <article><button>888K likes</button></article>
    <div role="dialog"><article><h1>Our first 100K likes</h1>
      <ul><li><button>5000 mentions J’aime</button></li></ul>
      <section><div role="button">10,9&nbsp;k mentions J’aime</div></section>
      <button aria-label="Suivant"></button></article></div>`,
    'https://www.instagram.com/p/photo123',
  );
  const capture = dom.window.pandaSmmCollector.read();
  assert.equal(capture.metrics.likes.raw, '10,9\u00a0k');
  assert.equal(capture.metrics.views, undefined);
  assert.equal(capture.ready, true);
  assert.equal(capture.format, 'carousel');
  dom.window.document.querySelector('section').remove();
  assert.deepEqual(Object.keys(dom.window.pandaSmmCollector.read().metrics), []);
  dom.window.close();
});
test('Facebook uses the labelled Like reaction count and ignores aggregate reactions', () => {
  const dom = page(
    `<div role="dialog"><div data-ad-preview="message">Try our photo app. 50K likes!</div>
    <div role="button" aria-label="J’aime">348</div>
    <div role="toolbar"><div role="button" aria-label="J’aime&nbsp;: 332 personnes"></div>
      <div role="button" aria-label="J’adore : 16 personnes"></div></div></div>`,
    'https://www.facebook.com/photoclarity/posts/pfbid123',
  );
  const capture = dom.window.pandaSmmCollector.read();
  assert.equal(capture.metrics.likes.raw, '332');
  assert.ok(capture.text.includes(capture.metrics.likes.quote));
  assert.equal(capture.caption, 'Try our photo app. 50K likes!');
  assert.equal(capture.ready, true);
  dom.window.close();
});

test('Facebook exposes only visible public timestamp targets, never reactions or private posts', () => {
  const card = (id, audience) => `<div><h3>Creator ${id}</h3>
    <a id="${id}" href="?__tn__=%2CO%2CP-R#date">13 août</a>
    <svg role="img" title="${audience}"></svg>
    <div data-ad-preview="message">Camera roll cleanup ${id}</div>
    <button id="like">J’aime</button></div>`;
  const dom = page(
    `<main><div role="feed">${card('private', 'Friends')}
    <a href="?__tn__=%2CO%2CP-R#outside">Unscoped date</a>
    ${card('public', 'Contenu partagé avec Public')}
    ${card('second', 'Shared with Public')}</div></main>`,
    'https://www.facebook.com/search/posts/?q=photo',
  );
  const doc = dom.window.document;
  let pointed;
  dom.window.Element.prototype.scrollIntoView = function () {
    pointed = this;
  };
  dom.window.Element.prototype.getBoundingClientRect = () => ({
    left: 10,
    top: 20,
    width: 50,
    height: 20,
  });
  doc.elementFromPoint = () => pointed;
  let clicks = 0;
  doc.addEventListener('click', () => clicks++);
  const first = dom.window.pandaSmmCollector.facebookTarget([]);
  assert.equal(first.identity, 'Creator public\nCamera roll cleanup public');
  assert.equal(first.x, 35);
  assert.equal(first.y, 30);
  const second = dom.window.pandaSmmCollector.facebookTarget([first.identity]);
  assert.equal(second.identity, 'Creator second\nCamera roll cleanup second');
  assert.equal(
    dom.window.pandaSmmCollector.facebookTarget([first.identity, second.identity]),
    null,
  );
  doc.elementFromPoint = () => doc.getElementById('like');
  assert.equal(dom.window.pandaSmmCollector.facebookTarget([]), null);
  assert.equal(clicks, 0);
  dom.window.close();
});

test('Facebook text excludes comment reactions and small decorative images from format detection', () => {
  const dom = page(
    `<div role="dialog"><h3><a>Photo organizer</a></h3>
    <div data-ad-preview="message">Sort your photos deliberately <img alt="📱"></div>
    <div role="article"><button aria-label="J’aime : 9000 personnes"></button></div>
    <button aria-label="J’aime : 600 personnes"></button>
    <button aria-label="Laissez un commentaire">12</button>
    <button aria-label="Share, send this to friends or post it on your profile.">30</button>
    </div>`,
    'https://www.facebook.com/creator/posts/123',
  );
  const capture = dom.window.pandaSmmCollector.read();
  assert.equal(capture.author, 'Photo organizer');
  assert.equal(capture.format, 'text');
  assert.equal(capture.metrics.likes.raw, '600');
  assert.equal(capture.metrics.comments.raw, '12');
  assert.equal(capture.metrics.shares.raw, '30');
  assert.ok(capture.text.includes(capture.metrics.shares.quote));
  dom.window.close();
});

test('Facebook Reel closing skips obscured duplicates and uses only a scoped close control', () => {
  const dom = page(
    `<button id="unscoped" aria-label="Fermer"></button>
    <div role="banner"><button id="banner" aria-label="Fermer"></button></div>
    <div role="dialog"><button id="covered" aria-label="Fermer"></button>
    <button id="other" aria-label="Commenter"></button></div>`,
    'https://www.facebook.com/reel/123',
  );
  const doc = dom.window.document;
  dom.window.Element.prototype.scrollIntoView = () => {};
  dom.window.Element.prototype.getBoundingClientRect = () => ({
    left: 16,
    top: 8,
    width: 40,
    height: 40,
  });
  doc.elementFromPoint = () => doc.getElementById('banner');
  const target = dom.window.pandaSmmCollector.facebookCloseTarget();
  assert.equal(target.x, 36);
  assert.equal(target.y, 28);
  for (const id of ['unscoped', 'other']) {
    doc.elementFromPoint = () => doc.getElementById(id);
    assert.equal(dom.window.pandaSmmCollector.facebookCloseTarget(), null);
  }
  doc.elementFromPoint = () => doc.getElementById('banner');
  dom.window.history.replaceState({}, '', '/creator/posts/123');
  assert.equal(dom.window.pandaSmmCollector.facebookCloseTarget(), null);
  doc
    .getElementById('covered')
    .insertAdjacentHTML('afterend', '<button id="usable" aria-label="Close"></button>');
  doc.elementFromPoint = () => doc.getElementById('usable');
  assert.ok(dom.window.pandaSmmCollector.facebookCloseTarget());
  dom.window.history.replaceState({}, '', '/search/posts/?q=photo');
  assert.equal(dom.window.pandaSmmCollector.facebookCloseTarget(), null);
  dom.window.close();
});

test('Facebook Reel evidence excludes preloaded neighbouring videos and counters', () => {
  const dom = page(
    `<meta property="og:description" content="Unscoped description">
    <div role="dialog"><div class="feed">
      <div class="card" id="current"><video></video><div role="group" aria-label="Video player">
        <h2><a>Photo sorter</a></h2><p>Keep the photos that matter.</p></div>
        <button aria-label="J’aime : 23 personnes"></button></div>
      <div class="card" id="next"><video></video><div role="group" aria-label="Video player">
        <h2><a>Unrelated creator</a></h2><h1>Next video's caption</h1></div>
        <button>999K views</button><button aria-label="J’aime : 98000 personnes"></button>
        <button>445 comments</button></div>
    </div></div>`,
    'https://www.facebook.com/reel/123',
  );
  dom.window.Element.prototype.getBoundingClientRect = function () {
    return { left: 100, top: this.closest('#next') ? 800 : 20, width: 300, height: 600 };
  };
  const capture = dom.window.pandaSmmCollector.read();
  assert.equal(capture.ready, true);
  assert.equal(capture.format, 'video');
  assert.equal(capture.author, 'Photo sorter');
  assert.equal(capture.caption, '');
  assert.equal(capture.metrics.likes.raw, '23');
  assert.equal(capture.metrics.views, undefined);
  assert.equal(capture.metrics.comments, undefined);
  assert.match(capture.text, /Keep the photos/);
  assert.doesNotMatch(capture.text, /Unrelated|999K|98000|Next video|Unscoped/);
  // A transition with two visible players must not merge their evidence.
  dom.window.Element.prototype.getBoundingClientRect = () => ({
    left: 100,
    top: 20,
    width: 300,
    height: 600,
  });
  const ambiguous = dom.window.pandaSmmCollector.read();
  assert.equal(ambiguous.ready, false);
  assert.equal(ambiguous.text, '');
  assert.deepEqual(Object.keys(ambiguous.metrics), []);
  assert.equal(dom.window.pandaSmmCollector.nextSlide(), false);
  dom.window.close();
});

async function connectorHarness(
  run,
  {
    navigation,
    discovery,
    reading,
    instagramReading,
    screenshotError,
    facebookTargets,
    initialUrl = 'about:blank',
  } = {},
) {
  let listener;
  let currentUrl = initialUrl;
  let polls = 0;
  let injected = 0;
  let discoveries = 0;
  const inputs = [];
  const navigations = [];
  let facebookPosts = 0;
  let profileReads = 0;
  let screenshots = 0;
  let search;
  const sender = { url: 'http://127.0.0.1:5173/', frameId: 0, tab: { id: 1 } };
  const session = '11111111-1111-1111-1111-111111111111';
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => originalTimeout(callback, 0);
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener: (fn) => {
          listener = fn;
        },
      },
    },
    tabs: {
      onRemoved: { addListener() {} },
      update: async (_, { url }) => {
        if (url) {
          navigations.push(url);
          currentUrl = url;
          search = url;
        }
      },
      get: async () =>
        navigation?.(currentUrl, ++polls) || {
          url: currentUrl,
          status: 'loading',
        },
    },
    storage: {
      session: { get: async () => ({ 'panda-smm-1': { session, tabId: 9 } }) },
    },
    debugger: {
      attach: async (target) => assert.equal(target.tabId, 9),
      detach: async (target) => assert.equal(target.tabId, 9),
      sendCommand: async (target, command, input) => {
        assert.equal(target.tabId, 9);
        if (command === 'Page.getLayoutMetrics') {
          if (screenshotError) throw new Error('Screenshot unavailable');
          return {
            cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1000, clientHeight: 700 },
          };
        }
        if (command === 'Page.captureScreenshot') return { data: `frame-${++screenshots}` };
        assert.equal(command, 'Input.dispatchMouseEvent');
        inputs.push(input);
        if (input.type === 'mouseReleased') {
          if (input.x === 10) {
            facebookPosts++;
            currentUrl =
              facebookPosts === 1
                ? 'https://www.facebook.com/permalink.php?id=123&story_fbid=pfbid001&tracking=x'
                : `https://www.facebook.com/creator/posts/${facebookPosts}`;
          } else currentUrl = search;
        }
      },
    },
    scripting: {
      executeScript: async ({ files, args }) => {
        if (files) {
          injected++;
          return [];
        }
        if (!args) return [{ result: { url: currentUrl, ready: true } }];
        if (args[0] === 'discover') {
          discoveries++;
          return [
            {
              result: discovery?.(discoveries) || {
                candidates: [],
                blocked_reason: '',
              },
            },
          ];
        }
        if (args[0] === 'read') return [{ result: reading() }];
        if (args[0] === 'instagramViews') {
          profileReads++;
          return [
            {
              result: instagramReading?.(profileReads, args[1], currentUrl) || {
                blocked_reason: '',
                metric: null,
              },
            },
          ];
        }
        if (args[0] === 'facebookTarget') return [{ result: facebookTargets?.(args[1]) || null }];
        if (args[0] === 'facebookCloseTarget') return [{ result: { x: 30, y: 40 } }];
        return [{ result: undefined }];
      },
    },
  };
  try {
    await import(`../addons/studio/browser_extension/background.js?test=${Math.random()}`);
    const send = (command, payload) =>
      new Promise((resolve) =>
        listener({ command, payload: { session, ...payload } }, sender, resolve),
      );
    await run(send, () => ({
      injected,
      discoveries,
      inputs,
      currentUrl,
      navigations,
      profileReads,
      screenshots,
    }));
  } finally {
    globalThis.setTimeout = originalTimeout;
    delete globalThis.chrome;
  }
}

const platformError = 'The platform returned an error. Retry in the research tab, then resume.';
test('resuming preserves the exact already open search instead of reloading recovered results', async () => {
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('search', { platform: 'tiktok', query: 'fridge recipes' });
      assert.equal(reply.error, undefined);
      assert.equal(reply.result.candidates.length, 1);
      assert.equal(reply.result.blocked_reason, '');
      assert.deepEqual(stats().navigations, []);
      assert.equal(stats().injected, 1);
    },
    {
      initialUrl: searchUrl('tiktok', 'fridge recipes'),
      discovery: () => ({
        candidates: [{ url: 'https://www.tiktok.com/@cook/video/1' }],
        blocked_reason: '',
      }),
    },
  );
});
test('a different query still navigates and never reuses unrelated results', async () => {
  await connectorHarness(
    async (send, stats) => {
      await send('search', { platform: 'tiktok', query: 'fridge recipes' });
      assert.deepEqual(stats().navigations, [searchUrl('tiktok', 'fridge recipes')]);
    },
    { initialUrl: searchUrl('tiktok', 'photo cleanup') },
  );
});
test('a transient search error can recover within the existing wait budget', async () => {
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('search', { platform: 'tiktok', query: 'fridge recipes' });
      assert.equal(reply.error, undefined);
      assert.equal(reply.result.blocked_reason, '');
      assert.deepEqual(
        reply.result.candidates.map((item) => item.url),
        ['https://www.tiktok.com/@cook/video/1'],
      );
      assert.equal(stats().discoveries, 6);
      assert.equal(stats().navigations.length, 1);
    },
    {
      discovery: (count) => ({
        candidates: [
          {
            url:
              count < 4
                ? 'https://www.tiktok.com/@stale/video/2'
                : 'https://www.tiktok.com/@cook/video/1',
          },
        ],
        blocked_reason: count < 4 ? platformError : '',
      }),
    },
  );
});
test('persistent server errors stop after the bounded wait without accepting stale results', async () => {
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('search', { platform: 'tiktok', query: 'fridge recipes' });
      assert.equal(reply.result.blocked_reason, platformError);
      assert.deepEqual(reply.result.candidates, []);
      assert.equal(stats().discoveries, 13);
    },
    {
      discovery: () => ({
        candidates: [{ url: 'https://www.tiktok.com/@stale/video/2' }],
        blocked_reason: platformError,
      }),
    },
  );
});
for (const block of [
  'A verification challenge needs your attention in the browser.',
  'Sign-in is required. Sign in yourself, then resume research.',
]) {
  test(`search stops immediately for ${block}`, async () => {
    await connectorHarness(
      async (send, stats) => {
        const reply = await send('search', { platform: 'tiktok', query: 'fridge recipes' });
        assert.equal(reply.result.blocked_reason, block);
        assert.equal(stats().discoveries, 1);
      },
      { discovery: () => ({ candidates: [], blocked_reason: block }) },
    );
  });
}
test('a post error can recover without reloading an already open post', async () => {
  let reads = 0;
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('read', { url: 'https://www.tiktok.com/@cook/video/1' });
      assert.equal(reply.error, undefined);
      assert.equal(reply.result.blocked_reason, '');
      assert.equal(reads, 3);
      assert.deepEqual(stats().navigations, []);
    },
    {
      initialUrl: 'https://www.tiktok.com/@cook/video/1?tracking=ignored',
      reading: () => ({
        ready: true,
        blocked_reason: ++reads < 3 ? platformError : '',
        format: 'text',
        coverage: 'Visible post.',
      }),
    },
  );
});
test('waits for committed destination and delayed results even while resources are loading', async () => {
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('search', {
        platform: 'instagram',
        query: 'camera roll',
      });
      assert.equal(reply.error, undefined);
      assert.equal(reply.result.candidates.length, 1);
      assert.equal(stats().injected, 1);
      assert.equal(stats().discoveries, 6);
    },
    {
      navigation: (url, poll) =>
        poll < 3
          ? {
              url: 'https://www.instagram.com/explore/search/keyword/?q=old',
              pendingUrl: url,
              status: 'complete',
            }
          : { url, status: 'loading' },
      discovery: (count) => ({
        candidates: count < 4 ? [] : [{ url: 'https://www.instagram.com/p/abc' }],
        blocked_reason: '',
      }),
    },
  );
});
test('Facebook discovery uses owned-tab browser clicks and closes each post before the next search sample', async () => {
  const exclusions = [];
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('search', { platform: 'facebook', query: 'photo cleanup' });
      assert.equal(reply.error, undefined);
      assert.deepEqual(
        reply.result.candidates.map((c) => c.url),
        [
          'https://www.facebook.com/permalink.php?story_fbid=pfbid001&id=123',
          ...[2, 3].map((id) => `https://www.facebook.com/creator/posts/${id}`),
        ],
      );
      assert.equal(stats().currentUrl, searchUrl('facebook', 'photo cleanup'));
      assert.deepEqual(exclusions, [[], ['post0'], ['post0', 'post1']]);
      assert.equal(stats().inputs.length, 18);
      assert.deepEqual(
        stats()
          .inputs.filter((i) => i.type === 'mouseReleased')
          .map((i) => i.x),
        [10, 30, 10, 30, 10, 30],
      );
    },
    {
      facebookTargets: (seen) => {
        exclusions.push([...seen]);
        return {
          x: 10,
          y: 20,
          identity: `post${seen.length}`,
          title: 'Creator',
          search_quote: 'Clean photos',
          search_url: searchUrl('facebook', 'photo cleanup'),
        };
      },
    },
  );
});
test('different Facebook story identifiers are never accepted as the requested post', async () => {
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('read', {
        url: 'https://www.facebook.com/permalink.php?story_fbid=pfbid001&id=123',
      });
      assert.match(reply.result.blocked_reason, /did not become ready/);
      assert.equal(stats().injected, 0);
    },
    {
      navigation: () => ({
        url: 'https://www.facebook.com/permalink.php?story_fbid=pfbid002&id=123',
      }),
    },
  );
});
test('does not collect the old page when a new navigation never commits', async () => {
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('search', {
        platform: 'google',
        query: 'photo app',
      });
      assert.match(reply.result.blocked_reason, /did not become ready/);
      assert.equal(stats().injected, 0);
      assert.equal(stats().discoveries, 0);
    },
    {
      navigation: () => ({
        url: 'https://www.google.com/search?q=previous',
        status: 'complete',
      }),
    },
  );
});
test('post capture waits for content and reports a verification challenge without screenshots', async () => {
  let reads = 0;
  await connectorHarness(
    async (send) => {
      const reply = await send('read', {
        url: 'https://www.instagram.com/p/abc',
      });
      assert.equal(reply.error, undefined);
      assert.equal(reads, 3);
      assert.match(reply.result.blocked_reason, /verification/);
      assert.deepEqual(reply.result.frames, []);
    },
    {
      reading: () => ({
        ready: false,
        blocked_reason: ++reads === 3 ? 'A verification challenge needs your attention.' : '',
      }),
    },
  );
});

test('direct Instagram layout pairs numeric controls with their icons and excludes comments and recommendations', () => {
  const dom = page(
    `<meta property="og:description" content="Apps to sort a camera roll">
    <section><main><div id="post"><img id="media"><video></video><div><p>Apps to sort a camera roll</p>
      <div><a href="/p/abc/c/comment1">12 weeks</a><button>5K likes</button></div>
      <section><div><span><div role="button"><svg aria-label="J’aime"></svg></div></span>
        <span role="button">10,9&nbsp;k</span><span><div role="button"><svg aria-label="Commentaire"></svg></div></span>
        <span role="button">46</span><span role="button">999K</span></div></section>
      </div><button aria-label="Suivant"></button></div>
      <div>More posts <button>900K likes</button></div></main></section>`,
    'https://www.instagram.com/p/abc',
  );
  dom.window.document.getElementById('media').getBoundingClientRect = () => ({
    width: 480,
    height: 600,
  });
  const capture = dom.window.pandaSmmCollector.read();
  assert.equal(capture.ready, true);
  assert.equal(capture.metrics.likes.raw, '10,9\u00a0k');
  assert.equal(capture.metrics.comments.raw, '46');
  assert.equal(capture.metrics.views, undefined);
  assert.equal(capture.format, 'carousel');
  assert.equal(capture.caption, 'Apps to sort a camera roll');
  assert.equal(capture.text.includes('More posts'), false);
  dom.window.close();
});

test('recovers an empty script result after the page replaces its document', async () => {
  let reads = 0;
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('read', { url: 'https://www.instagram.com/p/abc' });
      assert.equal(reply.error, undefined);
      assert.equal(reads, 3);
      assert.equal(stats().injected, 3);
      assert.match(reply.result.blocked_reason, /Sign-in/);
    },
    { reading: () => (++reads < 3 ? null : { ready: false, blocked_reason: 'Sign-in required' }) },
  );
});
test('persistent empty readings report a useful error without saving a capture', async () => {
  await connectorHarness(
    async (send) => {
      const reply = await send('read', { url: 'https://www.instagram.com/p/abc' });
      assert.match(reply.error, /page changed while being read/);
      assert.equal(reply.result, undefined);
    },
    { reading: () => null },
  );
});

test('Instagram publication dates exclude comment timestamps and normalize profile-prefixed permalinks', () => {
  const dom = page(
    `<article><h1>Photo sorting apps</h1>
    <a href="/p/abc/c/123"><time datetime="2026-07-22T12:00:00Z">12 weeks</time></a>
    <a href="/creator/p/abc/"><time datetime="2026-07-02T17:34:43Z">July 2</time></a>
    <a href="https://user@www.instagram.com/creator/p/other/">Invalid</a></article>`,
    'https://www.instagram.com/p/abc',
  );
  assert.equal(dom.window.pandaSmmCollector.read().published_at, '2026-07-02T17:34:43Z');
  const candidates = dom.window.pandaSmmCollector.discover().candidates;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://www.instagram.com/p/abc');
  dom.window.document.querySelector('a[href="/creator/p/abc/"]').remove();
  assert.equal(dom.window.pandaSmmCollector.read().published_at, '');
  dom.window.close();
});

test('Instagram matches author and publication date across p/reel aliases, excluding comments', () => {
  const dom = page(
    `<article><video></video><h1>Dinner ideas</h1>
    <a href="/p/abc/c/999"><time datetime="2026-10-18">Today</time></a>
    <a href="/creator/reel/abc/"><time datetime="2026-09-30">September 30</time></a>
    <a href="/other/reel/wrong/"><time datetime="2026-01-01">Other post</time></a>
    </article>`,
    'https://www.instagram.com/p/abc',
  );
  const capture = dom.window.pandaSmmCollector.read();
  assert.equal(capture.author, 'creator');
  assert.equal(capture.published_at, '2026-09-30');
  assert.equal(capture.instagram_profile, 'https://www.instagram.com/creator/reels/');
  dom.window.close();
});

test('Instagram waits for static media to load and distinguishes one image from a carousel', () => {
  const dom = page(
    `<main><div><img id="media"><div><h1>One infographic</h1>
    <section><svg aria-label="J’aime"></svg><svg aria-label="Commentaire"></svg>
      <button>135 mentions J’aime</button></section></div></div>
    <div><img id="recommendation"><button>100K likes</button></div></main>`,
    'https://www.instagram.com/p/abc',
  );
  const media = dom.window.document.getElementById('media');
  media.getBoundingClientRect = () => ({ width: 500, height: 600 });
  Object.defineProperty(media, 'naturalWidth', { get: () => 0, configurable: true });
  assert.equal(dom.window.pandaSmmCollector.read().ready, false);
  Object.defineProperty(media, 'naturalWidth', { get: () => 500 });
  const capture = dom.window.pandaSmmCollector.read();
  assert.equal(capture.format, 'image');
  assert.equal(capture.ready, true);
  assert.equal(capture.metrics.views, undefined);
  assert.equal(capture.metrics.likes.raw, '135');
  media.insertAdjacentHTML('afterend', '<button aria-label="Suivant"></button>');
  assert.equal(dom.window.pandaSmmCollector.read().format, 'carousel');
  dom.window.close();
});

for (const label of ['Icône d’affichage des vues', 'View Count Icon']) {
  test(`Instagram accepts only the requested Reel's labelled views: ${label}`, () => {
    const dom = page(
      `<main>
      <a href="/creator/reel/other/"><div><svg aria-label="${label}"></svg></div><span>999K</span></a>
      <a id="target" href="/creator/reel/abc/"><ul><li>50K likes</li><li>500 comments</li></ul>
        <div><div><svg aria-label="${label}"></svg></div><span><span>1,2 M</span></span></div></a>
      </main>`,
      'https://www.instagram.com/creator/reels/',
    );
    dom.window.Element.prototype.scrollIntoView = () => {};
    const result = dom.window.pandaSmmCollector.instagramViews('https://www.instagram.com/p/abc');
    assert.equal(result.metric.raw, '1,2 M');
    assert.match(result.metric.quote, /Reel abc/);
    assert.match(result.metric.quote, /creator\/reels\//);
    assert.equal(
      dom.window.pandaSmmCollector.instagramViews('https://www.instagram.com/p/missing').metric,
      null,
    );
    dom.window.document.querySelector('#target svg').setAttribute('aria-label', 'Likes');
    assert.equal(
      dom.window.pandaSmmCollector.instagramViews('https://www.instagram.com/p/abc').metric,
      null,
    );
    dom.window.close();
  });
}

const instagramVideo = () => ({
  ready: true,
  blocked_reason: '',
  url: 'https://www.instagram.com/p/abc',
  format: 'video',
  text: 'Dinner ideas. 1000 likes',
  coverage: 'Three video samples.',
  metrics: { likes: { raw: '1000', quote: '1000 likes' } },
  instagram_profile: 'https://www.instagram.com/creator/reels/',
});
const reelView = {
  raw: '1,2 M',
  quote: 'Instagram Reel abc · View Count Icon: 1,2 M · https://www.instagram.com/creator/reels/',
};

test('Instagram view fallback preserves post evidence, saves a counter frame and returns to the post', async () => {
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('read', { url: 'https://www.instagram.com/p/abc' });
      assert.equal(reply.error, undefined);
      assert.equal(reply.result.metrics.views.raw, '1,2 M');
      assert.equal(reply.result.metrics.likes.raw, '1000');
      assert.ok(reply.result.text.includes(reelView.quote));
      assert.deepEqual(reply.result.frames, ['frame-1', 'frame-2', 'frame-4']);
      assert.match(reply.result.coverage, /last frame shows the matching Reel/);
      assert.equal(reply.result.instagram_profile, undefined);
      assert.deepEqual(stats().navigations, [
        'https://www.instagram.com/p/abc',
        'https://www.instagram.com/creator/reels/',
        'https://www.instagram.com/p/abc',
      ]);
    },
    {
      reading: instagramVideo,
      instagramReading: (n, requested, current) => {
        assert.equal(requested, 'https://www.instagram.com/p/abc');
        assert.equal(current, 'https://www.instagram.com/creator/reels/');
        return { blocked_reason: '', metric: n === 3 ? reelView : null };
      },
    },
  );
});

test('an Instagram profile without the requested counter stays unknown after a bounded lookup', async () => {
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('read', { url: 'https://www.instagram.com/p/abc' });
      assert.equal(reply.error, undefined);
      assert.equal(reply.result.metrics.views, undefined);
      assert.equal(stats().profileReads, 12);
      assert.equal(stats().currentUrl, 'https://www.instagram.com/p/abc');
      assert.deepEqual(reply.result.frames, ['frame-1', 'frame-2', 'frame-3']);
      assert.match(reply.result.coverage, /could not be verified/);
    },
    { reading: instagramVideo },
  );
});

test('Instagram does not accept a profile counter when its evidence screenshot failed', async () => {
  await connectorHarness(
    async (send) => {
      const reply = await send('read', { url: 'https://www.instagram.com/p/abc' });
      assert.equal(reply.error, undefined);
      assert.equal(reply.result.metrics.views, undefined);
      assert.equal(reply.result.text.includes(reelView.quote), false);
    },
    {
      reading: instagramVideo,
      screenshotError: true,
      instagramReading: () => ({ blocked_reason: '', metric: reelView }),
    },
  );
});

for (const reason of ['Sign-in is required.', 'A verification challenge needs your attention.']) {
  test(`Instagram profile lookup stops immediately on ${reason}`, async () => {
    await connectorHarness(
      async (send, stats) => {
        const reply = await send('read', { url: 'https://www.instagram.com/p/abc' });
        assert.equal(reply.error, undefined);
        assert.equal(reply.result.blocked_reason, reason);
        assert.equal(reply.result.metrics.views, undefined);
        assert.equal(stats().profileReads, 1);
        assert.equal(stats().currentUrl, 'https://www.instagram.com/creator/reels/');
      },
      {
        reading: instagramVideo,
        instagramReading: () => ({ blocked_reason: reason, metric: reelView }),
      },
    );
  });
}

test('single Instagram images need one frame and never look for video views', async () => {
  await connectorHarness(
    async (send, stats) => {
      const reply = await send('read', { url: 'https://www.instagram.com/p/abc' });
      assert.equal(reply.error, undefined);
      assert.deepEqual(reply.result.frames, ['frame-1']);
      assert.equal(stats().profileReads, 0);
    },
    { reading: () => ({ ...instagramVideo(), format: 'image' }) },
  );
});

for (const profile of [
  'https://evil.test/creator/reels/',
  'https://www.instagram.com@evil.test/creator/reels/',
  'https://www.instagram.com/accounts/login/',
  'https://www.instagram.com/creator/reels/?token=secret',
]) {
  test(`Instagram refuses unexpected profile destination ${profile}`, async () => {
    await connectorHarness(
      async (send, stats) => {
        const reply = await send('read', { url: 'https://www.instagram.com/p/abc' });
        assert.equal(reply.error, undefined);
        assert.deepEqual(stats().navigations, ['https://www.instagram.com/p/abc']);
      },
      { reading: () => ({ ...instagramVideo(), instagram_profile: profile }) },
    );
  });
}
