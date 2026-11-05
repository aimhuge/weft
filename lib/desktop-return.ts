// The page weft.zip/auth/desktop renders after the desktop app's Weft account sign-in: it hands the
// OAuth query (code, or error and error_description) on to weft://account-callback, where Electron
// main posts it to the board's /api/auth/weft-callback. It opens the link at once and keeps an
// "Open Weft" button for the browsers that only launch an external app on a click
// (lib/account-callback.ts desktopReturnUrl says why the redirect doesn't go to weft:// directly).
import { weftCallbackUrl } from "./account-callback";

// Supabase's own params only, so the page can't be used to send arbitrary query strings into Weft.
const FORWARDED = ["code", "error", "error_code", "error_description", "next"];

export function desktopReturnLink(requestUrl: string): string {
  const from = new URL(requestUrl).searchParams;
  const link = new URL(weftCallbackUrl());
  for (const key of FORWARDED) {
    const value = from.get(key);
    if (value) link.searchParams.set(key, value);
  }
  return link.toString();
}

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function desktopReturnPage(requestUrl: string): Response {
  const link = desktopReturnLink(requestUrl);
  // JSON.stringify plus escaped "<" keeps the link from closing the <script> tag.
  const script = JSON.stringify(link).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Back to Weft</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,system-ui,sans-serif;background:#f4f3ef;color:#1d1d1b}
@media (prefers-color-scheme:dark){body{background:#131312;color:#e9e7e2}}main{max-width:420px;padding:24px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{opacity:.75;margin:0 0 18px}
a.open{display:inline-block;padding:12px 22px;border-radius:10px;background:#1d1d1b;color:#f4f3ef;text-decoration:none;font-weight:600}
@media (prefers-color-scheme:dark){a.open{background:#e9e7e2;color:#131312}}small{display:block;margin-top:18px;opacity:.6}</style></head>
<body><main><h1>Back to Weft</h1><p>Your browser is handing the sign-in back to Weft. If nothing happens, click Open Weft.</p>
<a class="open" href="${escape(link)}">Open Weft</a>
<small>If your browser asks, allow it to open Weft. You can close this tab afterwards.</small></main>
<script>location.href=${script};</script></body></html>`;
  return new Response(html, {
    status: 200,
    // The page carries a one-time sign-in code: keep it out of caches and referrers.
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
