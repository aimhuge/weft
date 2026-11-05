"use client";

// "Sign in to GitHub" on a worker of yours in Settings → Sync → Workers (docs/architecture/weft-worker.md#cloning-onto-a-worker).
// A worker has no browser and no one at its keyboard, so you make a fine-grained token on GitHub (the link fills in
// everything but the repos) and paste it here. The server seals it to the worker's own key before it leaves this Mac;
// the worker checks it with GitHub, and this waits for that real answer.

import { useState } from "react";
import type { CommandResult } from "@/lib/worker-command-wait";
import type { WorkerView } from "@/lib/workers-account";
import { Spinner } from "./Icon";

const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
const INPUT = "w-full rounded-md border border-line-strong bg-sunken px-2 py-1 text-[12.5px] text-ink";
const TOKEN = /^(github_pat_|gh[op]_)\w{20,}$/;
// Contents read and write is the least that lets a card clone and push. Metadata read comes with it.
const tokenUrl = (name: string) =>
  `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
    name: `Weft Worker ${name}`.slice(0, 40),
    description: "Lets cards on this Weft Worker clone and push.",
    expires_in: "90",
    contents: "write",
  }).toString()}`;

// The line under a worker's name, or null before it has said (an older worker).
export function githubLine(w: Pick<WorkerView, "githubAccount" | "githubState">): { text: string; warn: boolean } | null {
  if (w.githubState === "signed_in") return { text: `GitHub: ${w.githubAccount ?? "signed in"}`, warn: false };
  if (w.githubState === "expired") return { text: `GitHub sign-in expired${w.githubAccount ? ` (${w.githubAccount})` : ""}`, warn: true };
  if (w.githubState === "none") return { text: "Not signed in to GitHub", warn: false };
  return null;
}

export default function WorkerGithubSignIn({
  name,
  state,
  send,
}: {
  name: string;
  state: WorkerView["githubState"];
  send: (token: string) => Promise<CommandResult>;
}) {
  const [step, setStep] = useState<"idle" | "paste" | "sending" | "queued">("idle");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ok = TOKEN.test(token.trim());

  async function onSend() {
    setError(null);
    setStep("sending");
    try {
      const result = await send(token.trim());
      setToken("");
      setStep(result.status === "done" ? "idle" : "queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("paste");
    }
  }

  if (step === "sending") {
    return (
      <span className={`flex items-center gap-1.5 ${SUBTLE}`}>
        <Spinner size={11} /> Sending to {name}
      </span>
    );
  }
  if (step === "queued") return <span className={SUBTLE}>Queued. {name} signs in when it&apos;s back online.</span>;
  if (step === "idle") {
    return (
      <button type="button" onClick={() => setStep("paste")} className={BUTTON}>
        {state === "expired" ? "Sign in to GitHub again" : state === "signed_in" ? "Change GitHub" : "Sign in to GitHub"}
      </button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <p className={SUBTLE}>
        <a href={tokenUrl(name)} target="_blank" rel="noreferrer" className="text-accent underline">
          Make a token on GitHub
        </a>
        , pick the repos it may reach, and paste it here. Contents read and write is already set. It&apos;s sealed to {name}&apos;s own key, and every card on {name} can use it.
      </p>
      <div className="flex gap-2">
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok && void onSend()} placeholder="github_pat_…" aria-label={`GitHub token for ${name}`} className={INPUT} />
        <button type="button" onClick={() => void onSend()} disabled={!ok} className={`shrink-0 ${BUTTON}`}>
          Send
        </button>
        <button type="button" onClick={() => setStep("idle")} className={`shrink-0 ${BUTTON}`}>
          Cancel
        </button>
      </div>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}
