/* Isolated script: DOM reads, public post navigation, scrolling and carousel navigation. */
(() => {
  const text = (el) => (el?.innerText || el?.textContent || '').trim();
  const visible = (el) =>
    !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const first = (selector, root = document) => [...root.querySelectorAll(selector)].find(visible);
  const facebookReel = () =>
    location.hostname === 'www.facebook.com' && /^\/reel\/\d+\/?$/.test(location.pathname);
  function facebookReelRoot(root) {
    const selector = '[role="group"][aria-label="Video player"]';
    const players = [...root.querySelectorAll(selector)].filter((el) => {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return visible(el) && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    });
    if (players.length !== 1) return null;
    let card = players[0];
    for (
      let parent = card.parentElement;
      parent && parent !== root;
      parent = parent.parentElement
    ) {
      if (parent.querySelectorAll(selector).length !== 1) break;
      card = parent;
    }
    return card;
  }
  const instagramToolbar = (root) =>
    [...root.querySelectorAll('svg[aria-label]')]
      .filter(
        (el) =>
          visible(el) &&
          /^(Like|Unlike|J’aime|Je n’aime plus)$/i.test(el.getAttribute('aria-label')),
      )
      .map((el) => el.closest('section'))
      .find(
        (section) =>
          section &&
          root.contains(section) &&
          section.querySelector('svg[aria-label="Comment"], svg[aria-label="Commentaire"]'),
      );
  function facebookPostElement(el, caption) {
    const article = el.closest('article, [role="article"]');
    return (
      (!article || article.contains(caption)) &&
      !el.closest('ul, ol, li, [role="list"], [role="listitem"], header, h2, h3')
    );
  }
  function facebookStaticFormat(root, caption) {
    if (!caption || root === document.body) return 'unknown';
    const photoLinks = [
      ...root.querySelectorAll('a[href*="/photo/"], a[href*="/photo.php"]'),
    ].filter((el) => visible(el) && facebookPostElement(el, caption));
    const images = [...root.querySelectorAll('img')].filter(
      (el) =>
        facebookPostElement(el, caption) &&
        visible(el) &&
        el.getBoundingClientRect().width > 150 &&
        el.getBoundingClientRect().height > 150,
    );
    // A photo attachment is not a video: it must use the likes-only filter. Do
    // not count avatars, comment attachments, unloaded media or link previews.
    const photos = images.filter((el) => {
      const link = el.closest('a[href]');
      return el.complete && el.naturalWidth > 150 && (!link || photoLinks.includes(link));
    });
    if (photos.length) {
      const identities = new Set(photos.map((el) => el.currentSrc || el.src));
      return identities.size > 1 ? 'carousel' : 'image';
    }
    return images.length || photoLinks.length ? 'unknown' : 'text';
  }
  function facebookEvidenceTarget(kind) {
    if (
      location.hostname !== 'www.facebook.com' ||
      !direct(location.href) ||
      facebookReel() ||
      !['media', 'engagement'].includes(kind) ||
      blocked()
    )
      return false;
    const root = postRoot();
    const caption =
      root && first('[data-ad-preview="message"], [data-ad-comet-preview="message"]', root);
    if (!caption || root === document.body) return false;
    const photos = [...root.querySelectorAll('a[href*="/photo/"], a[href*="/photo.php"]')].filter(
      (el) => visible(el) && facebookPostElement(el, caption) && !caption.contains(el),
    );
    let target;
    if (kind === 'media') target = photos[0];
    else {
      target = [...root.querySelectorAll('button, [role="button"]')].find(
        (el) =>
          visible(el) &&
          facebookPostElement(el, caption) &&
          !caption.contains(el) &&
          /^(?:J[’']aime|Like|Laissez un commentaire|Leave a comment|Commenter|Comment|Partager|Share)(?:$|\s*[:,])/i.test(
            el.getAttribute('aria-label') || '',
          ),
      );
    }
    // Long captions can leave the reactions below the fold and not yet mounted.
    // Scroll within this post, never through the Reels feed or to a comment.
    const fallback = !target && kind === 'engagement';
    target ||= fallback ? photos.at(-1) || caption : null;
    if (!target) return false;
    target.scrollIntoView({ block: fallback ? 'end' : 'center', inline: 'nearest' });
    if (fallback) {
      for (
        let parent = target.parentElement;
        parent && root.contains(parent);
        parent = parent.parentElement
      ) {
        if (
          parent.scrollHeight > parent.clientHeight &&
          /auto|scroll/.test(getComputedStyle(parent).overflowY)
        ) {
          parent.scrollBy(0, parent.clientHeight / 2);
          break;
        }
      }
    }
    return true;
  }
  function postRoot() {
    if (location.hostname === 'www.facebook.com') {
      const dialog = first('[role="dialog"]');
      // Reels preload neighbouring videos and their counters inside the same dialog.
      // Keep only the card around the one player centred within the viewport.
      if (facebookReel()) return facebookReelRoot(dialog || first('main') || document.body);
      if (dialog) return dialog;
    }
    const root =
      first('[role="dialog"] article, [role="dialog"] [role="article"]') ||
      first('[role="dialog"]') ||
      first('article, [role="article"]') ||
      first('main') ||
      document.body;
    if (!location.hostname.endsWith('instagram.com') || root.tagName !== 'MAIN') return root;
    const toolbar = instagramToolbar(root);
    const media = [...root.querySelectorAll('video, img')].find(
      (el) =>
        visible(el) &&
        el.getBoundingClientRect().width > 150 &&
        el.getBoundingClientRect().height > 150,
    );
    // Direct-open Instagram pages use main/div instead of article. Stop at the
    // common media + actions container so recommended posts stay outside it.
    if (toolbar && media) {
      for (
        let parent = toolbar.parentElement;
        parent && root.contains(parent);
        parent = parent.parentElement
      )
        if (parent.contains(media)) return parent;
    }
    return root;
  }
  const direct = (raw) => {
    try {
      const u = new URL(raw, location.href);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'facebook.com' && u.pathname === '/permalink.php') {
        const story = u.searchParams.get('story_fbid') || '';
        const page = u.searchParams.get('id') || '';
        if (
          u.searchParams.getAll('story_fbid').length !== 1 ||
          u.searchParams.getAll('id').length !== 1 ||
          !/^(?:\d+|pfbid[A-Za-z0-9]+)$/.test(story) ||
          !/^\d+$/.test(page)
        )
          return null;
        return `https://www.facebook.com/permalink.php?story_fbid=${story}&id=${page}`;
      }
      if (host === 'instagram.com') {
        const post = u.pathname.match(/^\/(?:[\w.]+\/)?(p|reel)\/([\w-]+)\/?$/);
        return post ? `https://www.instagram.com/${post[1]}/${post[2]}` : null;
      }
      if (
        (host === 'tiktok.com' && /^\/@[\w.]+\/(video|photo)\/\d+\/?$/.test(u.pathname)) ||
        (host === 'facebook.com' &&
          /^\/(reel\/\d+|[\w.]+\/(posts|videos)\/[\w.]+)\/?$/.test(u.pathname))
      )
        return `https://www.${host}${u.pathname.replace(/\/$/, '')}`;
      if (
        host === 'facebook.com' &&
        /^\/watch\/?$/.test(u.pathname) &&
        /^\d+$/.test(u.searchParams.get('v') || '')
      )
        return `https://www.facebook.com/watch/?v=${u.searchParams.get('v')}`;
    } catch {
      /* Ignore navigation links. */
    }
    return null;
  };
  const instagramId = (raw) => {
    const url = direct(raw);
    return url?.startsWith('https://www.instagram.com/') ? url.split('/').at(-1) : null;
  };
  function instagramOwner(root, id) {
    // The dated permalink identifies the author even on layouts without a header.
    for (const link of root.querySelectorAll('a[href]')) {
      if (!visible(link) || !link.querySelector('time') || instagramId(link.href) !== id) continue;
      const owner = new URL(link.href).pathname.match(/^\/([\w.]+)\/(?:p|reel)\//)?.[1];
      if (owner) return owner;
    }
    const header = first('header a[href]', root);
    if (header) {
      const url = new URL(header.href, location.href);
      if (url.origin === location.origin && /^\/[\w.]+\/?$/.test(url.pathname))
        return url.pathname.split('/')[1];
    }
    return '';
  }
  function instagramViews(requestedUrl) {
    const result = { blocked_reason: blocked(), metric: null, source_url: location.href };
    if (
      result.blocked_reason ||
      location.hostname !== 'www.instagram.com' ||
      !/^\/[\w.]+\/reels\/?$/.test(location.pathname)
    )
      return result;
    const id = instagramId(requestedUrl);
    if (!id) return result;
    for (const link of document.querySelectorAll('main a[href]')) {
      if (instagramId(link.href) !== id) continue;
      // The same shortcode can appear as /p/ or /reel/. Match the exact post,
      // then its labelled view icon, never neighbouring cards or hover likes.
      link.scrollIntoView({ block: 'center', inline: 'nearest' });
      for (const icon of link.querySelectorAll('svg[aria-label]')) {
        const label = icon.getAttribute('aria-label') || '';
        if (
          !visible(icon) ||
          !/^(?:View Count Icon|Views?|Icône d[’']affichage des vues|Vues)$/i.test(label)
        )
          continue;
        const count =
          icon.parentElement?.querySelector('span') ||
          (icon.parentElement?.nextElementSibling?.matches('span')
            ? icon.parentElement.nextElementSibling
            : null);
        const raw = text(count);
        if (!visible(count) || !/^[0-9][0-9.,\sKMBkmb]*$/.test(raw)) continue;
        result.metric = {
          raw,
          quote: `Instagram Reel ${id} · ${label}: ${raw} · ${location.href}`,
        };
        return result;
      }
    }
    return result;
  }
  function blocked() {
    const challenge = first('iframe[src*="captcha"], [id*="captcha"], [class*="Captcha"]');
    if (challenge) return 'A verification challenge needs your attention in the browser.';
    const errorHeading = [...document.querySelectorAll('h1, h2')].some(
      (el) => visible(el) && /^(un problème est survenu|something went wrong)$/i.test(text(el)),
    );
    const retryButton = [...document.querySelectorAll('button')].some(
      (el) => visible(el) && /^(essaie à nouveau|réessayer|try again)$/i.test(text(el)),
    );
    if (errorHeading && retryButton)
      return 'The platform returned an error. Retry in the research tab, then resume.';
    const password = first('input[type="password"]');
    if (password) return 'Sign-in is required. Sign in yourself, then resume research.';
    return '';
  }
  function facebookCard(link) {
    for (let parent = link.parentElement; parent; parent = parent.parentElement) {
      if (parent.matches('main, [role="main"], [role="feed"], body')) break;
      if (parent.querySelectorAll('h3').length > 1) break;
      if (parent.querySelector('h3') && parent.querySelector('[data-ad-preview="message"]'))
        return parent;
    }
    return null;
  }
  const publicFacebookCard = (card) =>
    card &&
    [...card.querySelectorAll('[role="img"], img')].some(
      (el) =>
        visible(el) &&
        /^(Contenu partagé avec Public|Shared with Public|Public)$/i.test(
          el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('alt') || '',
        ),
    );
  function point(el) {
    if (!visible(el)) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (
      x < 0 ||
      y < 0 ||
      x >= innerWidth ||
      y >= innerHeight ||
      !el.contains(document.elementFromPoint(x, y))
    )
      return null;
    return { x, y };
  }
  function facebookTarget(excluded = []) {
    if (
      location.hostname !== 'www.facebook.com' ||
      location.pathname !== '/search/posts/' ||
      blocked()
    )
      return null;
    for (const link of document.querySelectorAll('a[href]')) {
      const url = new URL(link.href);
      if (
        url.origin !== location.origin ||
        url.pathname !== location.pathname ||
        url.searchParams.get('__tn__') !== ',O,P-R'
      )
        continue;
      const card = facebookCard(link);
      if (!publicFacebookCard(card)) continue;
      const title = text(first('h3', card));
      const caption = text(first('[data-ad-preview="message"]', card));
      const identity = title + '\n' + caption;
      if (excluded.includes(identity)) continue;
      const position = point(link);
      if (position)
        return {
          ...position,
          identity,
          title: title.slice(0, 500),
          search_quote: text(card).slice(0, 2000),
          search_url: location.href,
        };
    }
    return null;
  }
  function facebookCloseTarget() {
    if (location.hostname !== 'www.facebook.com' || !direct(location.href)) return null;
    const dialog = first('[role="dialog"]');
    if (!dialog) return null;
    const selector =
      '[role="button"][aria-label="Fermer"], [role="button"][aria-label="Close"], button[aria-label="Fermer"], button[aria-label="Close"]';
    // Facebook duplicates the Reel close control in the banner, on top of the
    // dialog's control. Only return an unobscured control in either known scope.
    const roots = facebookReel()
      ? [dialog, ...document.querySelectorAll('[role="banner"]')]
      : [dialog];
    for (const root of roots)
      for (const button of root.querySelectorAll(selector)) {
        const position = point(button);
        if (position) return position;
      }
    return null;
  }
  function discover() {
    const found = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      let raw = a.href;
      if (location.hostname === 'www.google.com') {
        try {
          const u = new URL(raw);
          if (u.pathname === '/url') raw = u.searchParams.get('q') || raw;
        } catch {}
      }
      const url = direct(raw);
      if (!url || found.has(url)) continue;
      const facebook = location.hostname === 'www.facebook.com';
      const card = facebook
        ? facebookCard(a)
        : a.closest(
            '[data-e2e="search_top-item"], [data-e2e="search-card-item"], [data-e2e="search-common-link"], article',
          );
      if (facebook && !publicFacebookCard(card)) continue;
      const views = first(
        '[data-e2e="video-views"], [data-e2e="search-card-video-views"]',
        card || a,
      );
      const viewText = text(views);
      found.set(url, {
        url,
        title: text(a).slice(0, 500),
        // TikTok reuses these selectors for likes in some search layouts.
        search_count: viewText && /^[\d., KMBkmb万亿]+$/.test(viewText) ? viewText : '',
        search_quote: text(card || a).slice(0, 2000),
        search_url: location.href,
      });
      if (found.size >= 30) break;
    }
    return {
      candidates: [...found.values()],
      blocked_reason: blocked(),
      url: location.href,
    };
  }
  function read() {
    const url = direct(location.href);
    if (!url) throw new Error('The tab is no longer on the requested social post.');
    const root = postRoot();
    const capture = {
      url,
      title: document.title.slice(0, 500),
      text: text(root).slice(0, 22000),
      caption: '',
      author: '',
      published_at: '',
      observed_at: new Date().toISOString(),
      format: 'unknown',
      metrics: {},
      ready: false,
      blocked_reason: blocked(),
      coverage:
        'Visible post text and sampled viewport frames. Audio and complete video/carousel not observed.',
    };
    if (!root) return capture;
    const appendMetric = (key, raw, quote) => {
      raw = String(raw).trim();
      quote = String(quote).trim();
      if (!/^[\d.,\sKMBkmb万亿]+$/.test(raw) || raw.length > 40 || quote.length > 240) return;
      capture.metrics[key] = { raw, quote };
      // Preserve the exact scoped counter even when the surrounding DOM text is truncated.
      if (!capture.text.includes(quote)) capture.text += '\n' + quote;
    };
    if (location.hostname.endsWith('tiktok.com')) {
      const id = location.pathname.split('/').filter(Boolean).at(-1);
      let item;
      for (const scriptId of ['__UNIVERSAL_DATA_FOR_REHYDRATION__', 'SIGI_STATE']) {
        try {
          const parsed = JSON.parse(document.getElementById(scriptId)?.textContent || '{}');
          const candidate =
            parsed.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct ||
            parsed.ItemModule?.[id];
          if (String(candidate?.id) === id) item = candidate;
        } catch {
          /* A schema change falls back to visible counters. */
        }
      }
      capture.caption = (
        item?.desc || text(first('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]'))
      ).slice(0, 10000);
      capture.author = (
        item?.author?.uniqueId || text(first('[data-e2e="browse-username"]'))
      ).slice(0, 200);
      capture.format =
        location.pathname.includes('/photo/') || item?.imagePost ? 'carousel' : 'video';
      if (item?.createTime && Number.isFinite(Number(item.createTime)))
        capture.published_at = new Date(Number(item.createTime) * 1000).toISOString();
      for (const [key, prop, selector] of [
        ['views', 'playCount', '[data-e2e="video-views"]'],
        ['likes', 'diggCount', '[data-e2e="like-count"], [data-e2e="browse-like-count"]'],
        [
          'comments',
          'commentCount',
          '[data-e2e="comment-count"], [data-e2e="browse-comment-count"]',
        ],
        ['shares', 'shareCount', '[data-e2e="share-count"]'],
      ]) {
        const el = first(selector);
        if (el) appendMetric(key, text(el), text(el));
        else if (Number.isSafeInteger(item?.stats?.[prop]) && item.stats[prop] >= 0)
          appendMetric(key, item.stats[prop], `Post ${id} page data ${prop}: ${item.stats[prop]}`);
      }
      capture.ready = !!item || !!capture.caption;
    } else {
      const description = document.querySelector('meta[property="og:description"]')?.content || '';
      const caption = first(
        'h1, [data-ad-preview="message"], [data-ad-comet-preview="message"]',
        root,
      );
      const instagram = location.hostname.endsWith('instagram.com');
      capture.caption = (text(caption) || (facebookReel() ? '' : description)).slice(0, 10000);
      capture.author = text(first(instagram ? 'header a' : 'h3 a, h2 a', root)).slice(0, 200);
      const publicationTime = [...root.querySelectorAll('a[href] time')].find(
        (time) =>
          visible(time) &&
          (instagram
            ? instagramId(time.closest('a').href) === instagramId(url)
            : direct(time.closest('a').href) === url),
      );
      capture.published_at = publicationTime?.getAttribute('datetime') || '';
      if (instagram) {
        capture.author = instagramOwner(root, instagramId(url)) || capture.author;
        if (capture.author)
          capture.instagram_profile = `https://www.instagram.com/${capture.author}/reels/`;
      }
      capture.format = first('button[aria-label="Next"], button[aria-label="Suivant"]', root)
        ? 'carousel'
        : first('video', root) || /\/(reel|videos|watch)/.test(location.pathname)
          ? 'video'
          : instagram &&
              root.tagName !== 'MAIN' &&
              [...root.querySelectorAll('img')].some(
                (el) =>
                  visible(el) &&
                  el.complete &&
                  el.naturalWidth > 150 &&
                  el.getBoundingClientRect().width > 150 &&
                  el.getBoundingClientRect().height > 150,
              )
            ? 'image'
            : !instagram && !first('[role="group"][aria-label="Video player"]', root)
              ? facebookStaticFormat(root, caption)
              : 'unknown';
      // Read counter controls, never numbers asserted in captions, metadata or comments.
      const toolbar = instagram ? instagramToolbar(root) : null;
      const counters = [...root.querySelectorAll('button, [role="button"], a[href]')].filter(
        (el) => {
          const section = el.closest('section');
          const article = el.closest('article, [role="article"]');
          return (
            visible(el) &&
            (instagram || !article || article.contains(caption)) &&
            !caption?.contains(el) &&
            (!instagram ||
              (section && root.contains(section) && !section.querySelector('a[href*="/c/"]'))) &&
            !el.closest(
              'ul, ol, li, [role="list"], [role="listitem"], [data-ad-preview="message"], h1',
            )
          );
        },
      );
      for (const key of ['likes', 'views', 'comments', 'shares']) {
        const names = {
          likes: "likes?|mentions? J[’']aime",
          views: 'views?|vues?',
          comments: 'comments?|commentaires?',
          shares: 'shares?|partages?',
        }[key];
        const regex = new RegExp(`^([0-9][0-9.,\\sKMBkmb]*?)\\s+(?:${names})$`, 'i');
        for (const el of counters) {
          const label = el.getAttribute('aria-label') || '';
          const match = label.match(regex) || text(el).match(regex);
          if (match) {
            appendMetric(key, match[1], match[0]);
            break;
          }
          // Facebook's Like action can display total reactions. Use the explicitly
          // labelled Like reaction count instead, not the aggregate action count.
          if (key === 'likes' && location.hostname.endsWith('facebook.com')) {
            const reaction = label.match(
              /^(?:J[’']aime|Like)\s*:\s*([0-9][0-9.,\sKMBkmb]*?)\s+(?:personnes?|people|person)$/i,
            );
            if (reaction) {
              appendMetric(key, reaction[1], label);
              break;
            }
          }
          const facebookCounter =
            !instagram &&
            ((key === 'comments' &&
              /^(Laissez un commentaire|Leave a comment|Commenter|Comment)$/i.test(label)) ||
              (key === 'shares' &&
                label === 'Share, send this to friends or post it on your profile.'));
          if (facebookCounter && /^[0-9][0-9.,\sKMBkmb]*$/.test(text(el))) {
            appendMetric(key, text(el), `${label}: ${text(el)}`);
            break;
          }
          if (!instagram && key === 'shares') {
            const shares = label.match(
              /^(?:Partager|Share),\s*([0-9][0-9.,\sKMBkmb]*?)\s+(?:partages?|shares?)$/i,
            );
            if (shares) {
              appendMetric(key, shares[1], label);
              break;
            }
          }
        }
      }
      if (toolbar) {
        // New Instagram layout: a separate numeric button immediately follows
        // the labelled Like/Comment icon. Never infer a counter from its position alone.
        for (const el of toolbar.querySelectorAll('[role="button"], button')) {
          const raw = text(el);
          if (!visible(el) || !/^[0-9][0-9.,\sKMBkmb]*$/.test(raw)) continue;
          const icon = el.previousElementSibling?.querySelector('svg[aria-label]');
          const label = icon?.getAttribute('aria-label') || '';
          const key = /^(Like|Unlike|J’aime|Je n’aime plus)$/i.test(label)
            ? 'likes'
            : /^(Comment|Commentaire)$/i.test(label)
              ? 'comments'
              : '';
          if (key) appendMetric(key, raw, `${label}: ${raw}`);
        }
      }
      capture.ready =
        root !== document.body &&
        (!!caption ||
          !!toolbar ||
          (facebookReel() && !!capture.author && !!first('video', root))) &&
        (!instagram || capture.format !== 'unknown');
    }
    if (capture.caption && !capture.text.includes(capture.caption))
      capture.text += '\n' + capture.caption;
    capture.text = capture.text.slice(0, 24000);
    return capture;
  }
  globalThis.pandaSmmCollector = {
    discover,
    facebookTarget,
    facebookCloseTarget,
    facebookEvidenceTarget,
    instagramViews,
    read,
    blocked,
    scroll() {
      window.scrollBy(0, innerHeight * 0.85);
    },
    nextSlide() {
      const root = postRoot();
      if (!root) return false;
      const button = first(
        'button[aria-label="Next"], button[aria-label="Suivant"], [data-e2e="arrow-right"]',
        root,
      );
      if (button && !button.disabled) {
        button.click();
        return true;
      }
      return false;
    },
  };
})();
