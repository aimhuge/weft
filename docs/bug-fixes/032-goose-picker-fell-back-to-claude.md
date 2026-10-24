# 032 — the Goose picker fell back to Claude

**Date:** 2026-10-24 · **Severity:** High

## Symptom

The user picked **Goose** in Weft's New thread dialog, but the card that appeared was a **Claude Code**
card. The card ran on Claude Code and its CLI chip on the board said **Claude Code**. There was no
error and no toast: Goose never started, and the dialog's choice was silently discarded.

The problem was visible in the board data rather than as a failing request. `~/.weft/board.json`
contained **0 Goose cards out of 1278** (1139 Claude, 129 puku, and 10 Codex), even though Goose was
offered in the New thread dialog's CLI picker.

## Root cause

`lib/new-card.ts` validated the requested backend against its own hardcoded list of three CLIs. That
list predated Goose, so a `goose` body failed the validation and the route fell through to its
default, creating a Claude Code card:

```ts
// before — lib/new-card.ts
const BACKENDS: Backend[] = ["claude", "puku", "codex"];

const backend = BACKENDS.includes(body.backend as Backend)
  ? (body.backend as Backend)
  : "claude";
```

The same stale-list pattern existed in five other places. Each had its own copy of the selectable
CLIs or models:

- `app/api/cards/switch-backend/route.ts`
- `app/api/cards/[id]/switch-backend/route.ts`, which also built its model list from Claude, puku,
  and Codex only
- `app/api/cards/[id]/rerun-model/route.ts`, which used a hardcoded
  `(["claude","puku","codex"] as const).some(...)` check
- `app/api/settings/route.ts`
- `lib/plan-limits.ts`

There was also a second, independent defect in Goose's login handling. Goose 1.56.0 has **no
`goose auth` subcommand**. The code assumed every CLI answered `auth status --json` and ran
`goose auth login`; both assumptions fail on Goose. Goose's real commands are `goose info --check`
for status and `goose configure` for its interactive configuration wizard.

Finally, Goose was not installed on the machine. Homebrew's formula named plain `goose` is
`pressly/goose`, a database-migration tool, not the AI CLI; the real Goose CLI conflicts with it
and is installed as `block-goose-cli`.

## Why it was hard to find

The pick was dropped silently in a list that looked reasonable, in a file nobody had touched since
before the fourth CLI existed. There was no error to trace: the card simply ran on a different CLI.
The defect was visible only as a statistic (0 Goose cards out of 1278), not as a failure.

## The fix

**One list of CLIs and one set of models.** `lib/new-thread.ts` now exports the shared lists, and
every consumer validates against them:

```ts
// after — lib/new-thread.ts
export const BACKENDS: { id: Backend; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "puku", label: "puku-cli" },
  { id: "codex", label: "Codex" },
  { id: "goose", label: "Goose" },
];

export const BACKEND_IDS: Backend[] = BACKENDS.map((b) => b.id);

export const ALL_MODEL_IDS: Set<string> = new Set(
  (Object.keys(MODELS) as Backend[]).flatMap((b) => MODELS[b].map((m) => m.id)),
);
```

The new-card route now uses that shared backend list:

```ts
// after — lib/new-card.ts
import { effortFor, BACKEND_IDS } from "./new-thread";
const BACKENDS: Backend[] = BACKEND_IDS;
```

The rerun route now asks the shared model set, so a model belonging to any CLI is valid:

```ts
// after — app/api/cards/[id]/rerun-model/route.ts
import { ALL_MODEL_IDS, backendFor } from "@/lib/new-thread";
const inAnyCli = ALL_MODEL_IDS.has(model);
```

The per-card switch route also uses `ALL_MODEL_IDS` instead of constructing its own model list. The
bulk switch route, settings route, and plan-limits module now use `BACKEND_IDS` as well.

**Goose's real status command.** `lib/login-status.ts` gained `parseGooseStatus`, which reads the
output of `goose info --check`. Its **Provider Check:** block has **Provider:**, **Model:**, and
**Auth:** lines; each is either fine, **not configured**, or **FAILED <why>**. A check with no
failing part means the key is present and usable:

```ts
// after — lib/login-status.ts
function parseGooseStatus(stdout: string, stderr: string): CliStatus | null {
  const text = clean(`${stdout}\n${stderr}`).trim();
  if (!/provider check/i.test(text)) return null;
  if (/not configured|configuration value not found/i.test(text)) return { loggedIn: false };
  if (/\bFAILED\b|authentication error|unauthorized|provider check failed/i.test(text)) {
    return { loggedIn: false };
  }
  if (/\bProvider:|\bModel:|\bAuth:/i.test(text)) return { loggedIn: true };
  return null;
}
```

`authStatus()` now selects Goose's real command instead of the generic `auth status --json`:

```ts
// after — lib/login-status.ts
const args = backend === "codex"
  ? ["login", "status"]
  : backend === "goose"
    ? ["info", "--check"]
    : ["auth", "status", "--json"];
```

**Goose's real login command.** `lib/login.ts` sends Goose to `openLoginInTerminal`, like Codex,
because `goose configure` is an interactive wizard that needs a real TTY. `lib/login-terminal.ts`
runs `goose configure` in Terminal:

```ts
// after — lib/login.ts
if (backend === "codex" || backend === "goose") return openLoginInTerminal(backend, onDone);
```

```ts
// after — lib/login-terminal.ts
const command = backend === "codex"
  ? `${shellQuote(bin)} login --device-auth`
  : backend === "goose"
    ? `${shellQuote(bin)} configure`
    : `${shellQuote(bin)} auth login`;
```

**Goose reads no Claude Code settings.** In `lib/cli-defaults.ts`, `settingsFile()` returns `""` for
Goose and `defaultEffort()` returns `undefined` for it. A Goose thread therefore no longer reports
Claude Code's effort level as its own:

```ts
// after — lib/cli-defaults.ts
if (backend === "goose") return "";

export function defaultEffort(backend: Backend): Effort | undefined {
  if (backend === "goose") return undefined;
  // ...
}
```

## Key rule

One shared list of every selectable CLI and model, used by every validator, so adding an option cannot be silently dropped by a stale copy of the list.

## Files involved

- `lib/new-thread.ts` — exports the shared `BACKENDS`, `BACKEND_IDS`, and `ALL_MODEL_IDS`
- `lib/new-card.ts` — validates the requested backend with `BACKEND_IDS`
- `app/api/cards/switch-backend/route.ts` — validates the bulk switch backend with `BACKEND_IDS`
- `app/api/cards/[id]/switch-backend/route.ts` — validates backend with `BACKEND_IDS` and model with `ALL_MODEL_IDS`
- `app/api/cards/[id]/rerun-model/route.ts` — validates a rerun model with `ALL_MODEL_IDS`
- `app/api/settings/route.ts` — validates the default backend and model settings with the shared lists
- `lib/plan-limits.ts` — uses `BACKEND_IDS` for the plan order
- `lib/login-status.ts` — parses Goose's `info --check` status with `parseGooseStatus`
- `lib/login.ts` — starts Goose's interactive configuration in a Terminal
- `lib/login-terminal.ts` — runs `goose configure` in Terminal
- `lib/cli-defaults.ts` — reads no Claude Code settings or effort for Goose
