// Google Analytics 4 for every weft.zip page, once the visitor accepts in the consent banner (lib/consent.ts).
// Rendered server-side so the gtag queue is in the HTML before the page paints, but gtag.js itself (the part that
// sets cookies and sends anything) is only fetched after a "granted": straight away for a visitor who accepted
// before, or on the banner's event. GA4's enhanced measurement then sends page_view on load and on client-side
// navigations, and lib/analytics.ts track() sends named events through window.gtag.
// app/layout.tsx mounts it only when isDeployed(), so local board sessions never call home.
import { CONSENT_EVENT, CONSENT_KEY } from "@/lib/consent";

export const GA_ID = "G-L9YCWJ4LZ2";
const GA_SRC = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;

export const GA_SNIPPET = `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', ${JSON.stringify(GA_ID)});
  (function () {
    var loaded = false;
    function load() {
      if (loaded) return;
      loaded = true;
      var s = document.createElement('script');
      s.async = true;
      s.src = ${JSON.stringify(GA_SRC)};
      document.head.appendChild(s);
    }
    var choice = null;
    try { choice = localStorage.getItem(${JSON.stringify(CONSENT_KEY)}); } catch (e) {}
    if (choice === 'granted') load();
    else window.addEventListener(${JSON.stringify(CONSENT_EVENT)}, function (e) { if (e.detail === 'granted') load(); });
  })();
`;

export default function GoogleAnalytics() {
  return <script dangerouslySetInnerHTML={{ __html: GA_SNIPPET }} />;
}
