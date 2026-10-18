export const dashboardOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:8000',
  'http://localhost:8000',
  'http://127.0.0.1:8080',
  'http://localhost:8080',
]);
export function canonicalPost(raw) {
  try {
    const u = new URL(raw);
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
    const patterns = {
      'tiktok.com': /^\/@[\w.]+\/(video|photo)\/\d+\/?$/,
      'instagram.com': /^\/(p|reel)\/[\w-]+\/?$/,
      'facebook.com': /^\/(?:reel\/\d+|[\w.]+\/(?:posts|videos)\/[\w.]+)\/?$/,
    };
    if (
      host === 'facebook.com' &&
      u.pathname.replace(/\/$/, '') === '/watch' &&
      /^\d+$/.test(u.searchParams.get('v') || '')
    )
      return `https://www.facebook.com/watch/?v=${u.searchParams.get('v')}`;
    if (!patterns[host]?.test(u.pathname)) return null;
    return `https://www.${host}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}
export function searchUrl(platform, query) {
  if (typeof query !== 'string' || query.length < 3 || query.length > 160)
    throw new Error('Invalid search query.');
  const roots = {
    tiktok: 'https://www.tiktok.com/search?q=',
    instagram: 'https://www.instagram.com/explore/search/keyword/?q=',
    facebook: 'https://www.facebook.com/search/posts/?q=',
    google: 'https://www.google.com/search?q=',
  };
  if (!roots[platform]) throw new Error('Unsupported search platform.');
  return roots[platform] + encodeURIComponent(query);
}
