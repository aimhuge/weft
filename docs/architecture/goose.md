# Goose

Goose ([github.com/aaif-goose/goose](https://github.com/aaif-goose/goose)) is the Rust CLI agent from Block, now
under the Linux Foundation's Agentic AI Foundation. It is Weft's fourth backend, after Claude Code, puku-cli and
Codex, and it is the first one whose *model* you bring yourself.

Claude Code and puku-cli serve a fixed set of models, Codex serves OpenAI's, and Weft's own key pays for them.
Goose is the opposite: Goose is a harness that talks to whichever provider you point it at, and Weft does not
carry a key for any of them. You paste one, Weft keeps it in your Keychain, and a Goose thread runs on it.

That makes Goose the backend for someone who already has an OpenRouter key, an Azure deployment, a LiteLLM proxy
or a local Ollama and doesn't want to route it through Anthropic.

## Key files

| File | Role |
| --- | --- |
| `lib/types-card.ts` | `Backend` is `"claude" \| "puku" \| "codex" \| "goose"`; `BACKEND_LABELS` names it |
| `lib/new-thread.ts` | `BACKENDS` lists it; `MODELS.goose` holds one row, its configured-model row; `GOOSE_DEFAULT_MODEL` is that row's sentinel; `EFFORT_BY_BACKEND.goose` is empty |
| `lib/cli-path.ts` | `executableFor("goose")` resolves the `goose` binary on the app's PATH |
| `lib/goose-recipe.ts` | The pure turn plan: `gooseSystemText`, `goosePrompt`, `gooseArgs`, `gooseRecipeYaml` |
| `lib/goose-recipe-store.ts` | The recipe on disk, under the card's own Goose state root |
| `lib/goose-progress-paths.ts` | The file paths a progress note mentions |
| `lib/goose-state.ts` | Where a card's Goose state lives: `~/.weft/goose/<card id>` |
| `lib/goose-runner.ts` | One Goose process per turn; `gooseEnv()`; the events turned into thread rows |
| `lib/goose-runner-events.ts` | Parses Goose's `stream-json` output into five kinds of event |
| `lib/goose-mcp.ts` | Weft's own tools (browser, board, secrets…) for a turn: a bridge token in the card's Goose config |
| `lib/goose-reply.ts` | Gathers the slices Goose streams one reply in, and files each reply whole |
| `lib/goose-launch.ts` | The grant-based key injection: asks main for a one-time grant over the control server |
| `lib/goose-provider.ts` | The board's copy of the provider catalog; `gooseEnvFor`, `gooseModelFor`, `needsBaseUrl`, `gooseModelsFor` (the chosen provider's own model ids) |
| `lib/use-goose.ts` | The board-side hook: list providers, save a key, forget one |
| `lib/use-goose-selection.ts` | The board-side hook: the chosen provider, model and endpoint, saved as they change |
| `components/GooseProviderKey.tsx` | Settings → Models → **Bring your own key** |
| `components/GooseKeyRow.tsx` | One provider's row: the key input, Save, Forget, the endpoint and the model |
| `components/GooseSavedKeys.tsx` | The providers that already have a key saved, with a **Use** for each |
| `components/GooseNamedModels.tsx` | Settings → Models → **Bring your own key** → **Model names**: a name for a model id, so every menu shows the name instead of the raw id |
| `components/SettingsModelsPage.tsx` | Where the BYO-key form is mounted |
| `lib/settings.ts` | `gooseProviderId()`, `gooseModelId()`, `gooseBaseUrl()` — the persisted selection |
| `app/api/settings/route.ts` | `PATCH` for the three, validated against the catalog |
| `electron/goose-provider.cjs` | Electron main's copy of the catalog, and the env each provider reads |
| `electron/goose-token.cjs` | The keys, one per provider, sealed by `safeStorage` in `~/.weft/goose-tokens.json` |
| `electron/goose-env.cjs` | The helper that claims a grant and starts Goose with the key in its env |
| `electron/goose-ipc.cjs` | The board's IPC (list, save, forget) and the control server's two routes (grant, claim) |
| `lib/login-status.ts` | Reads `goose info --check` for Goose's status; Goose has no `goose auth` |
| `lib/login-terminal.ts` | Runs `goose configure` in a Terminal window and polls the status |

## The one list of CLIs

Every place that takes a CLI checks it against `BACKEND_IDS` in `lib/new-thread.ts`, and every place that takes
a model id checks it against `ALL_MODEL_IDS` in the same file. Both are built from `BACKENDS` and `MODELS`, so
they cannot drift from what the New thread dialog offers.

This is not a style preference. The lists were once spelled out in each place, and Goose — the fourth CLI —
was missing from the ones that mattered: picking Goose in the New thread dialog created a **Claude Code** card
with no error and nothing to say so. The card ran on Claude, Goose never started, and the board said "Claude
Code" in the card's chip. `lib/new-card.ts` is where the pick was dropped.

The same shared list now covers the two switch-backend routes, the rerun-model route, the settings route and the
plan-limits strip. A CLI added to `BACKENDS` works everywhere at once.

One place still keeps its own copy: the board's `create_card` tool spells its `cli` enum out in
`lib/board-tools.ts` (`z.enum(["claude", "puku", "codex", "goose"])`), because a Zod enum needs its values at
schema-build time. It happens to name all four today, but it is a fourth list, not the shared one — a fifth
CLI would need adding there by hand.

Two things follow from a CLI being in the list but not being Claude Code:

- **Its own command line.** A Goose subagent runs `goose run --text "…" --model …`, not
  `claude -p "…" --allowedTools "…" --permission-mode dontAsk` — Goose takes none of Claude Code's flags
  (`lib/subagents.ts` `crossCli`).
- **No Claude Code's knobs.** Goose has no subagent-model env var (it has no Agent tool) and no effort setting
  at all, so `lib/subagents.ts` `subagentEnv` sets nothing for it and `lib/cli-defaults.ts` `defaultEffort`
  returns undefined rather than reading `~/.claude/settings.json` — that file is Claude Code's, and reading it
  for a Goose thread reported Claude's effort as the Goose thread's.

## The three input shapes

`goose run` takes exactly one input: `--text`, `--instructions` or `--recipe`. They are mutually exclusive (clap's
`conflicts_with`), and `--system` is exclusive with `--recipe` too. A Weft turn needs both a prompt and Weft's
own instructions, so there is only one shape it can use:

```
goose run --output-format stream-json --max-turns 40 --system <weft's instructions> --text <the prompt>
```

`--system` is the one that survives the exclusivity, because it is not one of the three inputs — it is the system
prompt beside them. `gooseArgs()` in `lib/goose-recipe.ts` builds exactly that, and the working directory is not
among the arguments: Goose takes the session's folder from the process it runs in, so the runner spawns it with
the card's folder as its cwd. A `--cwd` that isn't there means Goose works in the wrong place, and the cwd is
the one thing in a turn that can't be passed as a flag.

`--max-turns 40` (`GOOSE_MAX_TURNS`) is the other flag on the line, and it is the one guard a Weft thread has
that a hand-run Goose doesn't: it caps how many model turns Goose may take before it has to stop and ask. The
instructions themselves go in `--system`, and they are Weft's own prompt for the card (`weftSystemPrompt()`)
plus the skill index — and plus the project's `CLAUDE.md` only when Goose cannot read it itself.

### Who reads the project's instructions

Goose loads `AGENTS.md` from the folder it runs in, and resolves that file's `@./path` imports, so a project
that puts its instructions behind `AGENTS.md` needs nothing from us. Goose reads no `CLAUDE.md` and no
`SOUL.md` by itself, so a project that keeps them elsewhere is still Weft's to inject. `gooseSystemText()`
asks `gooseReadsProjectInstructions()` which of the two it is, and sends the `CLAUDE.md` only when the folder
has no `AGENTS.md` for Goose to load.

Sending both is not harmless duplication: the same instructions in the prompt twice is twice the tokens, and
the model reads the copy in `--system` as authoritative. Weft's own repo keeps `AGENTS.md` importing
`@./CLAUDE.md`, which imports `SOUL.md`, so a Goose turn there gets the soul once, from Goose.

The recipe is the third input shape, and Weft does not use it to run: `--recipe` excludes both `--text` and
`--system`, so a recipe-driven turn would lose Weft's instructions. But the same plan is rendered as a Goose
recipe anyway (`gooseRecipeYaml()`), in Goose's own YAML file format, so a turn can be repeated by hand
(`goose run --recipe turn.yaml`) or read to see exactly what the thread was told. That file is a prompt, not a
policy: see "The policy boundary" below.

### Where the recipe goes

`lib/goose-recipe-store.ts` writes it, once per turn, **before Goose is started**, from the same plan and the
same prompt the argv is built from — so the file on disk is exactly what the run used. The write is atomic (a
temp file then a rename) and it never fails a turn: a recipe nobody can re-run by hand is a nuisance, not a
reason to drop the user's work.

It goes under the card's own Goose state root:

```
~/.weft/goose/<card id>/recipes/turn.yaml
```

**Not in the card's project folder.** That folder is the user's working tree, and Weft does not litter it with
files the user did not ask for. The per-card root is already Weft's own space for this card (it is where
Goose's config and session rows live), so the recipe sits beside them.

The name is `turn.yaml` and it is **one file per card, overwritten each turn**, on purpose: the recipe is what
the card is running *now*. A stack of them would be a history, and the thing worth keeping is the current one.
It is also the file the harness optimizer reads back (lib/harness-optimizer.ts's `currentHarness` parses it with
lib/harness-recipe.ts's `parseRecipe`), so the file on disk is always the harness in force.

One detail about the recipe's shape, because Goose rejects the obvious one: it has no `response` block. Goose's
`validate_recipe.rs` rejects an empty JSON schema and `builder.rs` exits the process on an invalid one, so a
recipe without a `response` block is the valid shape, not an oversight.

## The event stream

`goose run --output-format stream-json` writes one JSON object per line on stdout. stderr stays separate —
merging the two corrupts the stream — and a turn that ends without a `complete` event fails with the tail of
stderr as its error.

`lib/goose-runner-events.ts` turns each line into one of four kinds:

| Kind | What it is | What the thread shows |
| --- | --- | --- |
| `message` | The assistant's text | An assistant row |
| `notification` | Progress: what Goose is doing | A tool row named "Goose" |
| `error` | The turn failed | The turn's error |
| `complete` | The turn is over | The turn's result |

The subtlety is `notification`. Goose's `NotificationData` has no tag of its own, so a notification cannot be
told apart from another payload by its fields alone — it is told apart by the `progress` key it always carries.
A payload with a `progress` key is a notification; one without isn't. The kind is also spelled several ways
across Goose's versions (`type`, `kind`, `event`), and older stream shapes nest the payload under `data`, so
the parser looks in all of them.

A notification is progress, not speech, so it becomes a tool row rather than an assistant message, and the tool
is named "Goose" — the notification says what Goose is doing, not which of Claude's tool names it used. The
event's `progress` string is the row's id, so a repeated progress note doesn't draw twice.

A line that isn't a JSON object, or that names a kind Weft doesn't act on, is skipped: Goose prints the odd line
of noise on stdout, and a turn shouldn't die on it.

### The files a Goose turn touched

`notification` is where the file changes live — and it is the only place. Goose's `NotificationData` carries no
structured payload: a notification is a human-readable progress string, so the only way to learn what a turn
touched is to read that string. `lib/goose-progress-paths.ts` is that reading, and it is a pure function of the
text.

The shapes come from Goose's own developer extension, which reports a file it wrote as `Wrote src/foo.ts
(42 lines)`, a file it created as `Created src/foo.ts (3 lines)` and a file it edited as `Edited src/foo.ts
(10 lines -> 12 lines)`. The rule is the general one, so other extensions' wording works too:

- A **run of path characters** (`[A-Za-z0-9._~-]`) that opens on a word boundary is a candidate.
- It is a path when it has a **separator or an extension** — `src/foo.ts`, `notes.md`. A bare word (`Running`,
  `tests`) names no file and is not one.
- It is **not** a path when it is a **flag** (`--verbose`, `-f`) or a **URL**. A URL is matched and thrown away
  whole, before the paths are read, because a URL's tail (`example.com/docs/readme.md`) looks exactly like a path.
- A **trailing period** a sentence leaves on it (`Wrote src/foo.ts.`) is not part of the path.

The paths come back as the note wrote them — relative or absolute. Turning them into absolute paths and keeping
the ones that sit inside the card's own folder is `noteFileChanges()`'s job, in `lib/goose-runner.ts`.

### The boundary

**Only files inside the card's own folder are noted.** A card works in its folder, so a path that resolves
outside it is not the card's to touch and not the card's to claim. The check is on the *resolved* path, so a
relative path with `..` in it that climbs out (`../elsewhere/a.ts`) is dropped too, and an absolute path
elsewhere (`/etc/hosts`) is dropped for the same reason.

This is a safety boundary, not a nicety: `card.touchedFiles` is what the busy-folder and overlap warnings read
(lib/overlap.ts), so a path that got in wrongly would put a warning on a card that never touched the file.

## Bring your own key

The catalog is fourteen providers, in `electron/goose-provider.cjs` (the copy Electron main uses) and
`lib/goose-provider.ts` (the board's copy, which can't import a `.ts` module and only `electron/**` ships in the
packaged app): OpenRouter, Anthropic, OpenAI, Google Gemini, Groq, Mistral, DeepSeek, xAI, Azure OpenAI, LiteLLM,
Perplexity, Cerebras, Ollama (local) and a custom OpenAI-compatible endpoint.

A provider in the catalog is a name, the env var Goose reads its key from, and the models it serves:

| Provider | Env var | Extra |
| --- | --- | --- |
| OpenRouter | `OPENROUTER_API_KEY` | — |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_HOST` (the host, with no trailing `/v1`) |
| OpenAI | `OPENAI_API_KEY` | — |
| Google Gemini | `GOOGLE_API_KEY` | — |
| Groq | `GROQ_API_KEY` | — |
| Mistral | `MISTRAL_API_KEY` | — |
| DeepSeek | `DEEPSEEK_API_KEY` | — |
| xAI | `XAI_API_KEY` | — |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | `AZURE_OPENAI_ENDPOINT` (the resource's address) |
| LiteLLM | `LITELLM_API_KEY` | `LITELLM_HOST` (the proxy's address) |
| Perplexity | `PERPLEXITY_API_KEY` | — |
| Cerebras | `CEREBRAS_API_KEY` | — |
| Ollama (local) | `OLLAMA_HOST` | no key — the host of your own Ollama |
| Custom (OpenAI-compatible) | `GOOSE_PROVIDER__API_KEY` | `GOOSE_PROVIDER__HOST` (the endpoint) |

Goose reads a provider's key from the environment, uppercased, before it looks in its own keyring. The generic
override is `GOOSE_PROVIDER__API_KEY` with `GOOSE_PROVIDER__HOST` for the base URL, which is how any
OpenAI-compatible endpoint is configured.

A provider that needs an endpoint beside its key says so in the catalog, as `extraEnv`: the variable's name with
`__baseUrl__` standing for the base URL. Anthropic's provider reads its host from `ANTHROPIC_HOST`, so a gateway
that speaks the Anthropic API is reached by giving a base URL there; Azure and LiteLLM name theirs the same way.
The custom provider is the exception: its host is always `GOOSE_PROVIDER__HOST`, so it is set directly rather
than through `extraEnv`. The host is the host: Goose appends
`v1/messages` itself, so a host with `/v1` on the end would ask for `/v1/v1/messages` and 404.

The model list is a short curated set where the ids are known for certain (OpenRouter's `vendor/model` ids).
Where they aren't, the list is empty and you type the model id — a wrong id is worse than none, so the drawer
shows a text box instead of a guess. A provider marked `freeModel` sits in between: the field is a text box with
the known ids as suggestions, because a gateway behind that provider's API serves model ids of its own. Anthropic
is one: it serves the Claude ids, and a gateway behind it serves ids like `puku-ai-2.8`.

### The Puku preset

Puku's gateway is reached through the Anthropic provider — it serves the Anthropic Messages shape at
`POST /v1/messages`, and the key travels as `x-api-key`. (Its OpenAI route is broken on the gateway, so the
"Custom (OpenAI-compatible)" row is not the way in.) The three values that make it work are one choice, and the
drawer makes it one: the **Puku** button beside the Provider picker sets the provider to `anthropic`, the base URL
to `https://api-cli.puku.sh` and the model to `puku-ai-2.8` in a single save
(`lib/use-goose-selection.ts` `setAll`, so half a preset never shows). The values live in `PUKU_GOOSE`
(`lib/goose-provider.ts`).

### The key's path

**The plaintext key never reaches the board, and never crosses the control server.** The path is two hops and
nothing more:

```
main's Keychain  ──▶ electron/goose-env.cjs's env  ──▶ Goose's env
```

Two doors, two disciplines:

- **The board** (`electron/preload.cjs` → `electron/goose-ipc.cjs`) may list the providers, save a key and forget
  one. It never receives a plaintext key: `listProviders` answers with `hasKey` and the non-secret metadata
  beside it (the base URL, the model, when it was saved). The key input in `components/GooseKeyRow.tsx` is
  cleared after a save, so the value can't be read back out of the component either.
- **The server** runs the Goose subprocess, so it needs the key in the subprocess's env — but it doesn't get
  the plaintext either. It asks Electron main for a **one-time grant** over the pane's control server
  (`POST /goose/env-grant`, `lib/goose-launch.ts`), and `electron/goose-env.cjs` claims that grant
  (`POST /goose/env-claim`) and starts Goose with the key in its env. The grant is spent on use and expires
  after a minute (`GRANT_MS`).

The grant and the control server's token travel on the helper's **stdin**, not in its environment, so they don't
sit in a process's env either — and the prompt itself is on the command line (`--text`), which is why stdin is
free to carry the grant.

The keys live in `~/.weft/goose-tokens.json` (0600, in a 0700 directory): a map of provider → record, because a
user may configure several. The token is base64 of `safeStorage`'s encrypted bytes; the base URL and the model
are not secrets, so they sit in the clear beside it. The shape is a map, not the one-record-per-file shape
`electron/provider-token.cjs` keeps, so `electron/goose-token.cjs` borrows that module's `requireKeychain` — the
refusal before anything is written when the Keychain can't encrypt — and does the rest itself.

The helper redacts its own output: every value it puts in Goose's env is registered with the redactor from
`electron/secret-redact.cjs`, so a key that Goose echoes back in an error line comes out as `‹NAME›`.

### Choosing a provider

The chosen provider is a board setting (`gooseProviderId`), and a new Goose thread inherits it
(`lib/runner-state.ts` `specFor()`). The card's own model is what runs it:

- The card's model, when it isn't the `GOOSE_DEFAULT_MODEL` sentinel, becomes `--model`.
- `GOOSE_DEFAULT_MODEL` ("Your BYOK model") means no `--model` at all: Goose's own provider picks.
- The chosen provider becomes `--provider`; with no provider picked, no `--provider` either, and Goose uses the
  one it was configured with.

So the model id maps to Goose's provider the way the model id maps to Weft's CLI: by which list names it. A
model id no list names belongs to Claude Code, and a Goose card never runs a Claude model — `modelOn()` drops
it and the CLI's own default runs.

### The models a menu lists

**Goose's models are not a list Weft holds.** Every provider serves ids of its own — OpenRouter's
`anthropic/claude-opus-4.1` is not Anthropic's `claude-opus-4-1`, and neither is what a local Ollama runs — so
a fixed list was wrong for all but one of them. `MODELS.goose` held five OpenRouter ids as a "starter set", and
every provider's menu showed them, which is exactly the question the card asked: *why do we have those other
models in goose?*

The list a menu shows is now the **chosen provider's** own ids (`gooseModelsFor()` in `lib/goose-provider.ts`):
the catalog's curated set for that provider, plus the model it is actually configured to run when that id
isn't one of them (a gateway behind the Anthropic API serves its own ids, e.g. `puku-ai-2.8`). The
curated set is a suggestion for a provider marked `freeModel`, whose gateway may serve anything.

Two things make that work:

- **A Goose id is recognised by the catalog, not by a list.** `backendFor()` in `lib/new-thread.ts` asks
  `GOOSE_PROVIDERS` whether any provider serves the id, so a bare `anthropic/claude-opus-4.1` still resolves
  to Goose — which is what keeps subagents and the rerun-on-model path routing to the right CLI now that
  `MODELS.goose` is empty.
- **A picker value carries a prefix.** A provider's id can be another CLI's id too (`puku-ai-2.8` through a
  Puku key), so a Goose row's value is `goose:<id>` (`gooseValue()`), and `bareModel()` takes the prefix off
  before the id reaches Goose.

### Naming the models

A model id is what a provider serves; a name is what a person reads. `components/GooseNamedModels.tsx`
(Settings → Models → Bring your own key → **Model names**) is a row per model with an id field and a name
field, saved as one setting (`gooseNamedModels`, validated in `app/api/settings/route.ts`). Every model menu
in Weft then shows "Big Opus" instead of the raw id, with the id beside the name so the row stays honest about
what will run. The names are read by the board through `lib/use-named-models.ts`, which reads
`/api/settings` rather than importing `lib/goose-models.ts` — that module reads the settings file off disk
with `node:fs`, which a browser chunk can't hold. `lib/goose-models.ts` owns the setting and its validator;
`lib/settings.ts` `gooseNamedModels()` is how the rest of the server reads it, and a save re-reads the names
so the menus don't keep showing the old ones until the board reloads.

**A name says "this runs on Goose."** The names are a *Goose* list — the only place one can be given is the
Goose section of Settings — so a name outranks a shared list that names the same id. "puku-ai-2.8" is
puku-cli's own id, but a user who named it in the Goose section is serving it through Goose, and the row has
to say so: filed under puku-cli it would hand back a bare id, and the thread would start on puku-cli instead
of Goose. So every named model is a Goose row, and its picker value carries the `goose:` prefix
(`gooseRowValue()` in `lib/model-options.ts`).

Two rows sit with it. The model the provider is configured to run is always one, named or not
(`gooseNamed()` in `lib/model-options.ts`), whether or not a provider is set up — it is the model the user
chose, so it is a row whether the menu can name its provider or not. And the provider's own served ids come
along, listed by their id, because each provider serves ids of its own.

The model and the endpoint are saved twice, in two places with two jobs. The board setting (`gooseModelId`,
`gooseBaseUrl`) is what the Settings UI shows and edits. The copy in Electron main's key store is what the
grant hands out. The board setting is the one the runner reads, and it wins: the endpoint the user picked
explicitly is the endpoint the grant uses (`lib/goose-launch.ts` `gooseEnvGrant` sends it, and
`electron/goose-ipc.cjs` `grantEnv` prefers it over the copy kept beside the key). The model is the other way round:
**the card's own model wins**, as it does on Claude Code and puku-cli, because it is what the New thread dialog or a
mid-thread switch picked (`lib/runner-state.ts` `specFor`). The model the user picked for the provider in Settings
only fills in a card left on "Your BYOK model"; with neither, Goose's provider picks. It once ran the other way, and a
model picked on the New thread dialog was silently replaced by the Settings one.

## Subagents

Goose has no Agent tool, so the DELEGATE prompt Claude Code and puku-cli get ("use subagents (the Agent tool)")
would send a Goose thread to a tool it doesn't have. `subagentPrompt(model, "goose")` in `lib/subagents.ts` gives it
`GOOSE_DELEGATE` instead, and the same `crossCli` text the other CLIs use for a headless run, in Goose's shape:

- "Let the model choose" and "Same model as the thread": a bare `goose run --text "<task>"`. It runs on the thread's
  own provider and model because `gooseEnv()` puts them in `GOOSE_PROVIDER` and `GOOSE_MODEL`, Goose's own config
  vars, and a Bash child inherits them, along with the provider key and `ANTHROPIC_HOST` the launch helper put in
  Goose's env. The key never appears in the prompt.
- A Goose model picked in Settings: the same line with `--model`.
- Another CLI's model: that CLI's headless line (`claude -p …`), falling back to doing the work itself, not to the
  Agent tool.

The prompt reaches Goose as part of `--system` (`gooseSystemText` → `weftSystemPrompt`), which is Goose's first
message.

## Signed commits

Claude Code threads sign their commits and PRs through the CLI's `attribution` setting (`lib/attribution.ts`
`signAsWeft`); puku-cli has its own. Goose has no such setting, so the lines go in its system text instead
(`gooseAttributionPrompt`, worded like the reminder Claude Code gives its own threads), and `/weft:done` and
`/weft:commit` follow it like any other instruction:

```
Co-Authored-By: Goose (<model>) on Weft <noreply@weft.zip>
🤖 Generated with [Goose](https://github.com/aaif-goose/goose) on Weft
```

The model is whatever the provider serves, often not Claude's, so the trailer names Goose and the model id as
given, at Weft's own address rather than Anthropic's. The copilot doesn't commit and gets no lines.

## Isolation

Goose keeps its own state — config, data, sessions — under `GOOSE_PATH_ROOT`. Weft points that at
`~/.weft/goose/<card id>`, one folder per card, so two cards never share one Goose database.

`--no-session` doesn't skip that: Goose still writes a hidden session row. The per-card root is what keeps the
rows apart. The card's recipe lives under the same root, in `recipes/turn.yaml` — see "Where the recipe goes".

Two other things in the env:

- `GOOSE_MODE=auto` — no interactive prompts, which is the same as Weft's "auto" permission mode.
- `GOOSE_DISABLE_KEYRING=1` — Goose must not reach for the macOS Keychain, because Weft keeps the provider key
  itself.

And the working directory, which is the card's folder and not a flag: Goose takes the session's folder from the
process it runs in.

## Login status and login

**Goose has no `goose auth`.** The other three CLIs answer `auth status --json`; Goose does not have that command at
all, and asking it for one fails. Goose's own commands are:

| What | Command | Shape |
| --- | --- | --- |
| Is it set up? | `goose info --check` | text |
| Set it up | `goose configure` | an interactive wizard |

`goose info --check` reports a **provider check**, not a login: a "Provider Check:" block whose lines name the parts
— "Provider:", "Model:", "Auth:" — each of which is either fine, "not configured", or "FAILED <why>". A check with no
failing part means the key is there and good. `lib/login-status.ts` `parseGooseStatus` reads exactly that shape: a
part that isn't set, or a failing one, is logged out; every part named and none failing is logged in. The check talks
to the provider, so it costs a request — it is the only status Goose offers.

`goose configure` is a wizard, and a wizard needs a real TTY. So, like Codex, a Goose login opens in a Terminal
window: `lib/login.ts` sends goose to `openLoginInTerminal`, and `lib/login-terminal.ts` runs `goose configure` there
and polls `goose info --check` until it reports the key is good (or the user cancels, or the deadline passes).

## The policy boundary

**The policy boundary is Goose's own extension allowlist, not the recipe.**

A recipe is a prompt: YAML with a title, a prompt, some instructions and a couple of settings. It says what the
thread was told. It grants nothing, and the file Weft renders beside the turn has no more authority than the
text of a message.

What decides what a Goose thread can actually do is the set of extensions Goose has enabled — its own
allowlist of what the agent is permitted to reach for. Weft does not write that list, and the recipe is not the
place to put one: a recipe that says "don't touch that" is a request, not a restriction, and Goose's extension
set is the restriction.

The consequence is worth being plain about: a Goose thread is a plain CLI process, like a Codex thread. The
per-tool hooks Weft has for Claude Code and puku-cli — the folder gate that asks before a read outside the
project, the `.env` guard, the git guard, the restart guard, the check guard, the symbol claims — are Agent SDK
hooks, and a plain CLI has none of them. A Goose thread runs in its card's folder, with the same filesystem
access any process you start there has.

## What a Goose thread does not have

- **No effort.** Goose has no effort flag, so `EFFORT_BY_BACKEND.goose` is empty and `effortFor()` drops every
  effort for it: the effort is never put on Goose's command line, and the header's chip names the model without
  one.
- **No warm session.** One process per turn, like Codex. `ensureSpare()` skips Goose, so a Goose card
  starts cold on every turn — there is no warm spare to answer in two seconds. The conversation still carries on:
  once the card has a session database (`gooseHasSession()` in `lib/goose-state.ts`), `gooseArgs()` adds
  `--resume`, which picks up the latest session under the card's own root. Without it every turn was a new
  session and Goose forgot the thread.
- **Puku's gateway drops the system prompt.** `api-cli.puku.sh` replaces a client's system block with its own
  Puku CLI identity (a Goose turn through it reports fewer input tokens than Goose's own prompt), so SOUL, the
  BOARD STATUS rules and the project instructions never reached the model. `replacesSystemPrompt()` in
  `lib/goose-provider.ts` spots that endpoint (its host, or a `puku-` model id); `gooseArgs()` then opens a new
  session's first message with the instructions in `<weft-instructions>`, and `--resume` keeps them for the
  turns after. A card whose session started before this keeps its old session, so it never gets them.
- **Weft's tools over HTTP.** Goose can't take Weft's MCP servers in-process, so like Codex it reaches them through
  `app/api/mcp/[server]` with a per-turn bridge token (`lib/mcp-bridge.ts`). `--with-streamable-http-extension`
  takes no header, and a token on the command line shows in `ps`, so `openGooseMcp()` writes the extensions with
  the token in an `Authorization` header into the card's own `<root>/config/config.yaml` (mode 0600) before the turn
  and removes it after. Each is named `mcp__<server>`, so Goose calls `mcp__browser__open_url`, the name Weft's
  instructions give. Without them Goose opened links with `open`, in the system browser.
- **Replies arrive in slices.** Goose 1.x streams a reply as many `message` lines sharing one id, each
  `{ role, content: [{ type: "text", text }] }`, and ends with a `complete` that carries only token counts.
  `lib/goose-runner-events.ts` reads the assistant's text parts (skipping the user-role tool echoes);
  `lib/goose-reply.ts` gathers each reply and `lib/goose-runner.ts` files it as one row, and the turn's result is the last reply.
- **No cost.** The result row reports zero tokens and zero dollars: Weft can't know what a provider charges
  for a Goose turn, and a made-up number would be worse than none.
- **No skills as slash commands.** Goose has no slash commands, so a `/name` in the prompt is turned into the
  skill's own instructions text (`skillInvocation()` in `lib/skills.ts`) and the skill index goes into the
  system prompt.
- **No task events.** Goose sends no task ledger, so a Goose card has no subagent or background-command strip.

## Known gaps

- The files a Goose turn touched are read out of the progress text, because that is all Goose sends (see "The
  files a Goose turn touched"). An extension that reports its files in another shape may be missed: a path has
  to look like a path (a separator or an extension) and resolve inside the card's own folder.
  `gooseToolResult()`, `eventText()` and `promptFor()` are in the same state: exported for the build fingerprint
  and the tests, but not on a live path.
- Goose isn't bundled. It has to be on the app's PATH (`executableFor()` in `lib/cli-path.ts`). On Homebrew the
  right formula is `block-goose-cli`; the plain `goose` formula is a different tool (a database migration tool),
  and it conflicts with it.
- The provider catalog is a short curated list. A provider Weft doesn't know can't be picked.
- Weft doesn't hold a model list for Goose. A menu lists the **chosen provider's** own ids
  (`gooseModelsFor()` in `lib/goose-provider.ts`), so a card on, say, a local Ollama model gets that provider's
  ids — the one it is configured to run included — rather than another provider's list. A provider whose
  gateway serves ids Weft can't know (a free-model provider, a local Ollama) has to have its id typed, and
  can be given a name for it in Settings → Models → Bring your own key. A Goose card keeps whatever
  id it is given: its providers are gateways that serve their own ids, so no list can name them all
  (`modelOn()` in `lib/new-thread.ts`).
- A Goose card's model is the card's own, as on every other CLI: `lib/runner-state.ts` `specFor` gives it
  priority and the Settings model only fills in a card left on "Your BYOK model".
- A Goose thread's subagents are headless `goose run --text` calls from Bash, because Goose has no Agent
  tool: `lib/subagents.ts` `crossCli` has the Goose branch and `goosePrompt` builds the prompt around it.
- A Goose thread's commits are unsigned; the Done flow signs commits for Claude Code and puku-cli threads.
