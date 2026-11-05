// What the pane's address bar (and a thread's open_url) loads: a URL as it is, localhost over http, a host
// over https, and anything else (a word, a phrase) as a web search, the way Chrome's address bar does.
const SEARCH_URL = "https://www.google.com/search?q=";

function normalizeUrl(raw) {
  const url = String(raw || "").trim();
  if (/^(https?|file|about):/i.test(url)) return url;
  if (/^(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url)) return `http://${url}`;
  // A host and port ("devbox:8080") reads like a scheme; the digits say it isn't one.
  if (/^[\w.-]+:\d+([/?#]|$)/.test(url)) return `https://${url}`;
  // Any other scheme (javascript:, chrome:, mailto:) stays out of the pane; words with a colon are a search.
  if (/^[a-z][a-z0-9+.-]*:\S*$/i.test(url)) throw new Error(`Can't open ${url} in the browser pane`);
  if (looksLikeHost(url)) return `https://${url}`;
  return `${SEARCH_URL}${encodeURIComponent(url)}`;
}

// "example.com" or "docs.foo.dev/guide" is an address; "nextjs", "react hooks" and "what is next.js" aren't.
function looksLikeHost(text) {
  if (!text || /\s/.test(text)) return false;
  const host = text.split(/[/?#]/)[0];
  return /^[\w-]+(\.[\w-]+)+\.?$/.test(host);
}

module.exports = { normalizeUrl, SEARCH_URL };
