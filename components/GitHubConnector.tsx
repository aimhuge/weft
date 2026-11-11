"use client";

// Settings → Connectors → GitHub on your workers (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built):
// connect GitHub once on weft.zip, in the browser pane, and every worker you add after that gets it for its cards' repos,
// under pairing's own Touch ID (docs/architecture/weft-worker.md#defaults-at-pairing). No per-worker settings to learn:
// the defaults are lib/connector-grant.ts DEFAULT_SETTINGS, and Forget on a worker ends its tokens.
import { useWorkerConnectors } from "@/lib/use-worker-connectors";

const BUTTON =
  "flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

export default function GitHubConnector({ titleClass, hintClass }: { titleClass: string; hintClass: string }) {
  const c = useWorkerConnectors();
  const github = c.view?.github;
  // Signed out (or still loading): workers and their GitHub are an account's, so there's nothing to show yet.
  if (!c.view?.signedIn) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className={titleClass}>GitHub on your workers</h3>
      <p className={hintClass}>
        Cards on a Weft Worker push and use gh as you, with Weft, through short tokens for their own repo. Your GitHub sign-in stays on weft.zip.
        Each worker you add gets it when you pair it.
      </p>
      <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${github?.connected ? "bg-ok" : "bg-warn"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
          {github?.connected ? `Connected${github.login ? ` as @${github.login}` : ""}` : (github?.error ?? "Not connected")}
        </span>
        {github?.connected ? (
          <button type="button" className={BUTTON} onClick={() => void c.disconnect()}>
            Disconnect
          </button>
        ) : (
          <button type="button" className={BUTTON} onClick={c.connect}>
            Connect GitHub
          </button>
        )}
      </div>
      {c.note && <p className="text-[12px] text-ink">{c.note}</p>}
      {c.error && <p className="text-[12px] text-danger">{c.error}</p>}
    </section>
  );
}
