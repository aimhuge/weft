"use client";

import { appFor, appNameFrom, blobPageSha, cleanAppUrl } from "@/lib/mini-apps";
import { appActions, useMiniApps } from "@/lib/use-mini-apps";

// The browser pane's Save as app: the page it shows joins the left rail below Services (components/AppsRail.tsx),
// named after its title. Lit when the page already is an app; clicking it then takes it out again. A worker card's page
// (a blob, components/WorkerPane.tsx) saves too: the server brings it home first (lib/mini-app-worker.ts).
export default function SaveAppButton({ url, title, notify }: { url: string; title: string; notify?: (err: unknown) => void }) {
  const apps = useMiniApps();
  const app = appFor(apps, url);
  const savable = Boolean(cleanAppUrl(url) ?? blobPageSha(url));
  const onError = notify ?? ((err: unknown) => console.error(err));
  return (
    <button
      disabled={!savable}
      onClick={() => void (app ? appActions.remove(app.id) : appActions.save(url, appNameFrom(title, url))).catch(onError)}
      title={app ? `In your apps as “${app.name}” · click to remove it` : "Save this page as an app on the left rail"}
      aria-label={app ? "Remove from apps" : "Save as app"}
      aria-pressed={Boolean(app)}
      className={`rounded-md p-1.5 disabled:opacity-30 disabled:hover:bg-transparent ${app ? "text-accent hover:bg-accent-soft" : "text-muted hover:bg-sunken hover:text-ink"}`}
    >
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="7" height="7" rx="1.5" fill={app ? "currentColor" : "none"} />
        <rect x="14" y="3" width="7" height="7" rx="1.5" fill={app ? "currentColor" : "none"} />
        <rect x="3" y="14" width="7" height="7" rx="1.5" fill={app ? "currentColor" : "none"} />
        {app ? <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" /> : <path d="M17.5 14v7M14 17.5h7" />}
      </svg>
    </button>
  );
}
