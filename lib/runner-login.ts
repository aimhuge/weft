// What the runner does when a thread's CLI hits an auth wall: park the card in needs_you, start
// the in-app login, and re-run the waiting cards once it succeeds. lib/runner.ts sets hooks.needLogin
// to needLogin here at load time; lib/runner-session.ts calls it from the failed() path.

import { cancelLogin, noteTrial, startLogin } from "./login";
import { fetchTrialToken, hasOwnPukuLogin, trialJustFetched } from "./puku-trial";
import { CLI_NAMES, errorText, loginWaiters, safeUpdate } from "./runner-state";
import { getCard, updateCard } from "./store";
import type { Backend, LoginTrial } from "./types";

// This module is imported by lib/runner.ts, so a direct import would be circular. retry() is only
// called after lib/runner.ts has finished loading, so a deferred dynamic import is fine.
async function retry(cardId: string) {
  const { retry } = await import("./runner");
  return retry(cardId);
}

// A puku thread with no Puku login runs on Weft's Puku trial when it can (lib/puku-trial.ts); otherwise Puku's
// own login opens, and its pop-up says why the trial didn't cover it.
async function pukuTrialOrLogin(cardId: string, message: string) {
  if (trialJustFetched()) {
    login(cardId, "puku", { reason: "failed", message: `Weft's Puku trial didn't work for this thread: ${message}` });
    return;
  }
  const result = await fetchTrialToken();
  if (result.ok) retryAfterLogin("puku");
  else login(cardId, "puku", { reason: result.reason, message: result.message });
}

function login(cardId: string, backend: Backend, trial?: LoginTrial) {
  try {
    startLogin(backend, () => retryAfterLogin(backend));
    if (trial) noteTrial(backend, trial);
  } catch (err) {
    safeUpdate(cardId, { error: errorText(err) });
  }
}

// Called from the failed() path (lib/runner-session.ts) when the CLI's last turn hit an auth
// error. Drops the card's sessionId so puku-cli doesn't replay the cached authentication_failed
// entry from the session transcript on retry.
export function needLogin(cardId: string, backend: Backend, message: string) {
  const card = getCard(cardId);
  if (card?.sessionId && backend !== "github-copilot") updateCard(cardId, { sessionId: undefined });
  safeUpdate(cardId, {
    column: "needs_you",
    pending: null,
    error: message,
    lastLine: `Log in to ${CLI_NAMES[backend]} to run this thread`,
  });
  const waiting = loginWaiters.get(backend) ?? new Set<string>();
  waiting.add(cardId);
  loginWaiters.set(backend, waiting);
  if (backend === "puku" && !hasOwnPukuLogin()) void pukuTrialOrLogin(cardId, message);
  else if (backend !== "github-copilot") login(cardId, backend);
}

// Runs every card that was waiting on this CLI's login. Safe to call more than once.
export function retryAfterLogin(backend: Backend) {
  const waiting = loginWaiters.get(backend);
  if (!waiting?.size) return;
  loginWaiters.delete(backend);
  for (const cardId of waiting) {
    retry(cardId).catch((err: unknown) => safeUpdate(cardId, { error: errorText(err) }));
  }
}

// Drops the cards that were waiting on this CLI's login, so a cancelled login
// doesn't drag the next card into the same loop when it hits the same auth error.
export function clearLoginWaiters(backend: Backend) {
  loginWaiters.delete(backend);
}

// You signed in to your Weft account: puku threads waiting on a login run on the trial instead.
export async function retryPukuWithTrial() {
  if (!loginWaiters.get("puku")?.size || hasOwnPukuLogin()) return;
  const result = await fetchTrialToken();
  if (!result.ok) return;
  cancelLogin("puku");
  retryAfterLogin("puku");
}
