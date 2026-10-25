"use client";

import { useState } from "react";
import { manifestUrl } from "@/lib/slack-view";

// The setup form (components/SlackConnect.tsx): the three steps that turn a Slack workspace into Weft's.
// The tokens live only here, in local state, and are cleared once the connect succeeds — Electron main
// keeps them in the Keychain from then on.

export interface SlackConnectProps {
  busy: boolean;
  error: string | null;
  // Shows a page in the board's browser pane.
  onOpenUrl: (url: string) => void;
  // Hands the two tokens to the hook's connect().
  onConnect: (bot: string, app: string) => Promise<void>;
}

export default function SlackConnect({ busy, error, onOpenUrl, onConnect }: SlackConnectProps) {
  const [bot, setBot] = useState("");
  const [app, setApp] = useState("");

  async function submit() {
    if (!bot.trim() || !app.trim()) return;
    await onConnect(bot.trim(), app.trim());
    setBot("");
    setApp("");
  }

  return (
    <form
      className="flex flex-col gap-2.5 px-3 py-3 text-[12.5px] leading-snug text-muted"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-danger">{error}</p>}
      <p className="text-[13.5px] font-medium text-ink">Connect Slack</p>
      <ol className="flex flex-col gap-2.5">
        <li className="flex gap-2">
          <Step n={1} />
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <span>
              Create the Weft app from the manifest, then <b className="text-ink">Install to Workspace</b>.
            </span>
            <button
              type="button"
              onClick={() => onOpenUrl(manifestUrl())}
              className="rounded-md border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-sunken"
            >
              Create the Weft app
            </button>
          </div>
        </li>
        <li className="flex gap-2">
          <Step n={2} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span>
              Paste the <b className="text-ink">Bot User OAuth Token</b> from OAuth &amp; Permissions.
            </span>
            <input
              type="password"
              value={bot}
              onChange={(e) => setBot(e.target.value)}
              placeholder="xoxb-…"
              aria-label="Bot User OAuth Token"
              autoComplete="off"
              className="w-full rounded-lg border border-line-strong bg-card px-3 py-2 font-mono text-[13px] text-ink"
            />
          </div>
        </li>
        <li className="flex gap-2">
          <Step n={3} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span>
              Basic Information → App-Level Tokens → <b className="text-ink">Generate</b> with the scope{" "}
              <b className="text-ink">connections:write</b>, then paste it.
            </span>
            <input
              type="password"
              value={app}
              onChange={(e) => setApp(e.target.value)}
              placeholder="xapp-…"
              aria-label="App-Level Token"
              autoComplete="off"
              className="w-full rounded-lg border border-line-strong bg-card px-3 py-2 font-mono text-[13px] text-ink"
            />
          </div>
        </li>
      </ol>
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={busy || !bot.trim() || !app.trim()}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-on-accent disabled:opacity-40"
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
      <p className="text-[11.5px] text-faint">Weft keeps both tokens in your Keychain; threads never see them.</p>
    </form>
  );
}

function Step({ n }: { n: number }) {
  return <span className="mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-sunken text-[11px] font-medium text-ink">{n}</span>;
}
