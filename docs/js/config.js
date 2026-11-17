// Where is the multiplayer server?
//  1. ?server=wss://... in the page URL (handy for testing)
//  2. Same origin, when the page is served by the Node server itself (local dev: http://localhost:8080)
//  3. PRODUCTION_SERVER below — set this to your Render URL before deploying to GitHub Pages.

export const PRODUCTION_SERVER = 'wss://blind-sync.onrender.com';

export function serverURL() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  const { protocol, host, hostname } = location;
  const isPages = hostname.endsWith('github.io');
  if (!isPages && (protocol === 'http:' || protocol === 'https:') && host) {
    return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}`;
  }
  return PRODUCTION_SERVER;
}
