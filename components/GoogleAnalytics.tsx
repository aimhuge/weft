// Google Analytics 4 for every weft.zip page. Rendered server-side so the snippet is in the HTML
// before the page paints; gtag.js sends page_view on load and on client-side navigations (GA4's
// enhanced measurement), and lib/analytics.ts track() sends named events through window.gtag.
// app/layout.tsx mounts it only when isDeployed(), so local board sessions never call home.
const GA_ID = "G-L9YCWJ4LZ2";

const SNIPPET = `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', ${JSON.stringify(GA_ID)});
`;

export default function GoogleAnalytics() {
  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`}
      />
      <script dangerouslySetInnerHTML={{ __html: SNIPPET }} />
    </>
  );
}
