import type { Backend, CliStatus } from "./types";

// The welcome's agent list with Weft's Puku trial folded in (components/WelcomeIntro.tsx; docs/architecture/puku-trial.md).
// puku-cli ships inside Weft, and with no login of its own it runs on the trial once you're signed in to Weft. The welcome
// doesn't chase the sign-up for it: a new user is asked to log in to an agent they already use, and the trial surfaces
// later, where a thread actually needs it (components/LoginDialog.tsx).

export type CliStatuses = Partial<Record<Backend, CliStatus>>;

// A CLI that isn't on this Mac at all, rather than one that's logged out.
export const cliMissing = (status: CliStatus | undefined) => Boolean(status?.error && /not (found|installed)|ENOENT/i.test(status.error));

// "none": the trial isn't the story (puku-cli has its own login, isn't there, or you're signed out). "on": you're signed
// in, so puku-cli runs on the trial.
export type TrialState = "none" | "on";

// `signedIn` is null while your Weft account is still loading (or couldn't be read): nothing is offered on a guess.
export function trialState(status: CliStatuses | null, signedIn: boolean | null): TrialState {
  const puku = status?.puku;
  if (!status || signedIn === null || !puku || puku.loggedIn || cliMissing(puku)) return "none";
  return signedIn ? "on" : "none";
}

// Whether a first thread can run: an agent is logged in, or the trial covers puku-cli. Null until the logins are read.
export const agentReady = (status: CliStatuses | null, trial: TrialState): boolean | null =>
  status === null ? null : trial === "on" || Object.values(status).some((s) => s.loggedIn);
