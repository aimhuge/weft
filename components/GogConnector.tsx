"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { api } from "@/lib/client";
import type { GogAccount, GogStatus } from "@/lib/gog-view";
import { useConnectorStatus } from "@/lib/use-connector-status";
import Icon, { Spinner } from "./Icon";

const CONSOLE_URL = "https://console.cloud.google.com/apis/credentials";
const GUIDE_URL = "https://github.com/steipete/gogcli#readme";
// How often the card checks back while a browser sign-in is under way.
const POLL_MS = 2_000;

type Ready = Extract<GogStatus, { installed: true }>;

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        window.weft?.openExternal(href);
      }}
      className="text-accent hover:underline"
    >
      {children}
    </a>
  );
}

const BUTTON =
  "flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

// One signed-in Google account, with the OAuth client it signed in through (named when it isn't the default).
function GogAccountRow({
  account,
  busy,
  onRemove,
}: {
  account: GogAccount;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{account.email}</span>
      {account.client !== "default" && account.client !== "weft" && (
        <span className="shrink-0 text-[12px] text-faint">{account.client}</span>
      )}
      <button onClick={onRemove} disabled={busy} className={BUTTON}>
        Remove
      </button>
    </div>
  );
}

// The signed-in state: the accounts gog holds, and either the browser sign-in under way or the form
// that starts one. Kept apart from the rest of the connector so each piece stays readable.
function GogAccounts({
  status,
  busy,
  email,
  readonly,
  onEmail,
  onReadonly,
  onSignIn,
  onCancel,
  onRemove,
}: {
  status: Ready;
  busy: boolean;
  email: string;
  readonly: boolean;
  onEmail: (value: string) => void;
  onReadonly: (value: boolean) => void;
  onSignIn: () => void;
  onCancel: () => void;
  onRemove: (account: GogAccount) => void;
}) {
  return (
    <>
      {status.accounts.map((a) => (
        <GogAccountRow key={`${a.client}:${a.email}`} account={a} busy={busy} onRemove={() => onRemove(a)} />
      ))}

      {status.adding ? (
        <div className="flex items-center gap-3 rounded-md border border-accent/50 px-3 py-2.5 text-[12.5px] text-muted">
          <Spinner size={12} />
          <span className="flex-1">Finish signing in {status.adding} in your browser.</span>
          <button onClick={onCancel} className={BUTTON}>
            Cancel
          </button>
        </div>
      ) : (
        (status.ownClient || status.weftClient) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSignIn();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => onEmail(e.target.value)}
              placeholder="you@gmail.com"
              aria-label="Google account email"
              className="min-w-[180px] flex-1 rounded-md border border-line-strong bg-sunken px-2.5 py-1 text-[12.5px] text-ink"
            />
            {!status.outdated && (
              <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                <input type="checkbox" checked={readonly} onChange={(e) => onReadonly(e.target.checked)} />
                Read-only
              </label>
            )}
            <button type="submit" disabled={busy || !email.trim()} className={BUTTON}>
              {busy && <Spinner size={11} />}
              {status.accounts.length ? "Add account" : "Sign in with Google"}
            </button>
          </form>
        )
      )}
    </>
  );
}

// Settings → Connectors → Google Workspace: gog's OAuth client, the Google accounts it holds, and a browser sign-in.
export default function GogConnector({ titleClass, hintClass }: { titleClass: string; hintClass: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [readonly, setReadonly] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const { load, refresh, accept } = useConnectorStatus<GogStatus>({
    load: () => api.gogStatus(),
    pollMs: POLL_MS,
    // While a browser sign-in is under way, the status says so; keep asking until it doesn't.
    pollWhile: (status) => (status && status.installed ? status.adding : null),
  });

  async function act(body: Parameters<typeof api.gog>[0]) {
    setBusy(true);
    setError(null);
    try {
      accept(await api.gog(body));
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function pickClient(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (picked) await act({ action: "credentials", json: await picked.text() });
  }

  async function signIn() {
    if (await act({ action: "add", email: email.trim(), readonly })) setEmail("");
  }

  function body(s: Ready) {
    return (
      <>
        <p className={hintClass}>
          gog {s.version} · {s.bundled ? "shipped with Weft" : "your own install"}
          {s.outdated && (
            <>
              {" "}
              · Weft ships a newer gog: <code className="text-ink">brew upgrade gogcli</code>
            </>
          )}
        </p>

        <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void pickClient(e)} />
        {/* With Weft's own Google app in this build, the user's own client is an option under the form, not a step. */}
        {(s.ownClient || !s.weftClient) && (
          <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${s.ownClient ? "bg-ok" : "bg-warn"}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 text-[12.5px] text-muted">
              {s.ownClient ? (
                "Your own OAuth client"
              ) : (
                <>
                  First, a Google Cloud OAuth client (Desktop app): <Link href={CONSOLE_URL}>create one</Link>, download its
                  JSON, then choose it here. <Link href={GUIDE_URL}>Setup guide</Link>
                </>
              )}
            </span>
            <button onClick={() => file.current?.click()} disabled={busy} className={BUTTON}>
              {s.ownClient ? "Replace…" : "Choose JSON…"}
            </button>
          </div>
        )}

        <GogAccounts
          status={s}
          busy={busy}
          email={email}
          readonly={readonly}
          onEmail={setEmail}
          onReadonly={setReadonly}
          onSignIn={() => void signIn()}
          onCancel={() => void act({ action: "cancel" })}
          onRemove={(a) => void act({ action: "remove", email: a.email, client: a.client })}
        />

        {s.weftClient && !s.ownClient && (
          <button onClick={() => file.current?.click()} disabled={busy} className="self-start text-[12px] text-faint hover:text-accent">
            Signs in through Weft&apos;s Google app · use your own OAuth client…
          </button>
        )}
        {s.lastError && <p className="break-words text-[12.5px] text-danger">Sign-in failed: {s.lastError}</p>}
      </>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <h3 className={titleClass}>Google Workspace</h3>
        <button
          onClick={refresh}
          disabled={load.kind === "loading"}
          className="flex items-center gap-1 text-[12.5px] text-accent hover:underline disabled:text-faint disabled:no-underline"
        >
          <Icon name="reload" size={12} />
          Refresh
        </button>
      </div>
      <p className={hintClass}>Gmail, Calendar, Drive, Docs and Sheets for your threads, through the gog CLI.</p>
      {load.kind === "loading" ? (
        <div className="flex items-center gap-2 py-2 text-[12.5px] text-muted">
          <Spinner size={12} /> Checking gog
        </div>
      ) : load.kind === "error" ? (
        <p className="break-words text-[12.5px] text-danger">Couldn&apos;t check gog: {load.error}</p>
      ) : load.status.installed ? (
        body(load.status)
      ) : (
        <p className={hintClass}>
          gog isn&apos;t on this app&apos;s PATH. Weft.app ships it; running from source, <code className="text-ink">brew install gogcli</code>.
        </p>
      )}
      {error && <p className="break-words text-[12.5px] text-danger">{error}</p>}
    </section>
  );
}
