# Subagents

Every board thread is told when to hand work to a subagent, and Settings → **Use for subagents** picks the model they
run on. The point is context: a subagent's file reads and long outputs stay out of the thread, and independent ones run
at once. The copilot is left out (it runs the board, not code).

## Key files

| File | Role |
| --- | --- |
| `lib/subagents.ts` | The setting's values, the prompt text, and the env a CLI starts with |
| `lib/settings.ts` | `subagentModel()` / `setSubagentModel()`; stored in `~/.weft/settings.json`, absent means "choose" |
| `app/api/settings/route.ts` | `PATCH { subagentModel }`, validated with `isSubagentModel()` |
| `components/SubagentPicker.tsx` | The Settings row; saves on change, reverts and says why if the save fails |
| `components/ModelSelect.tsx` | The model menu it shares with Run /weft:done on (`DonePicker`): leading choices, then Claude and Puku headings from `MODELS`; `useSavedPick()` is the save-or-revert hook both rows use |
| `lib/runner-session.ts` | Appends `subagentPrompt()` to a thread's system prompt, merges `subagentEnv()` into its env, and counts the setting in a session's build so idle sessions restart when it changes |

## The setting

`SubagentModel` is `"choose"`, `"inherit"`, or a model id from `MODELS` in `lib/new-thread.ts` (Claude: Fable 5.1,
Opus 5.5, Sonnet 5.5, Haiku 5.5; Puku: Opus 4.8, Puku AI 2.8, Puku AI 2.7). The picker groups the ids under Claude and
Puku, so a new model added to `MODELS` shows up here without another edit. `subagentBackend(id)` says which CLI serves it.

| Pick | Prompt | Env |
| --- | --- | --- |
| Let the model choose (default) | delegate + a Haiku / Sonnet / Opus guide (Claude threads only) | none; the thread sets `model` per Agent call |
| Same model as the thread | delegate + "leave the model input out" | Claude: `CLAUDE_CODE_SUBAGENT_MODEL=inherit` + `_FORCE=1`; puku: none |
| A model the thread's own CLI serves | delegate + "Subagents run on X, leave the model input out" | Claude: `CLAUDE_CODE_SUBAGENT_MODEL=<id>` + `_FORCE=1`; puku: `PUKU_CLI_SUBAGENT_MODEL=<id>` |
| A model only the other CLI serves | delegate + how to run that CLI headless with Bash | none |

`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` makes the Claude Code CLI drop the Agent tool's `model` input and ignore models set in
agent definitions, so the pick can't be overridden per call. `PUKU_CLI_SUBAGENT_MODEL` always wins in puku-cli. Both were
read from the bundled binaries' source, not from docs.

puku-cli also refuses (`[pinnedModels] Refusing to persist non-pinned model`) any `PUKU_CLI_SUBAGENT_MODEL` outside its
pinned `puku-ai-2.7`, `puku-ai-2.8`, `opus`, so `pukuSubagentModel()` in `lib/subagents.ts` passes the first two through and
sends `opus` for anything else (`opus-4.8` is the Opus tier). The `/weft:done` skill names `"puku-ai-2.8"` for its Agent-tool
fallback on puku-cli, `"haiku"` on Claude Code.

## Models from the other CLI

The Agent tool can only start subagents on the model family its own CLI serves. For the other CLI's models the prompt
tells the thread to run one headless through Bash:

```
puku-cli -p "<self-contained task>" --model opus-4.8 --allowedTools "Read Grep Glob" --permission-mode dontAsk
claude   -p "<self-contained task>" --model claude-haiku-5-5 --allowedTools "Read Grep Glob" --permission-mode dontAsk
```

stdout is the report. Read-only by default; the thread adds `Edit Write` to `--allowedTools` for a subagent that changes
files. Several Bash calls in one message run in parallel, and `run_in_background` covers long ones. A single read-only run
took about 13s on puku-cli and 17s on claude. If the other CLI isn't installed or logged in, the thread is told to say so
and use the Agent tool.

## Patterns

- The prompt and env are computed per session start. `currentBuild()` in `lib/runner-session.ts` hashes the thread
  prompt and the subagent model into a session's build, so a change in Settings replaces idle sessions (a busy turn keeps
  its CLI) and spares.
- Ids are validated against `MODELS`, never free text, so a typo can't reach `--model` or the env.

## Tracking

The CLI reports every subagent and background command as task events; `lib/runner-turn.ts` hands each `system`
message to `recordTask()` (`lib/task-ledger.ts`), which folds it into `card.tasks` with the pure reducer in `lib/tasks.ts`.

| Event | Effect on the ledger |
| --- | --- |
| `task_started` | Adds a running task (kind from `task_type`, agent type, background flag); ambient and `skip_transcript` ones stay out |
| `task_progress` | Tokens, tool uses, last tool, the progress summary; makes the task if its start was missed |
| `task_updated` | Status (`killed` → stopped), end time, error, moved to the background |
| `task_notification` | Final status, summary, output file, usage; `reason: worker_restart` → lost |
| `background_tasks_changed` | The live set (replace semantics): a running background task missing from it becomes `ended` (outcome unknown), an unknown one is added |

The CLI registers every foreground Bash call as a task too; those already show as tool rows, so `tracked()` keeps only
agents and background tasks in the strip, the badge and the note, and a trim drops the foreground ones once they end.
Running tasks are always kept, plus the newest 20 tracked ones that ended. A notification for a task whose start the
ledger never saw (a foreground command from before it listened) is left out.

- **The CLI ending** (`wrapUp` in `lib/runner-session.ts`, or `loadState` in `lib/store.ts` after a Weft restart) marks
  running tasks `lost`: they ran in the CLI's process group, so they died with it.
- **The next message** gets `taskNote()` ahead of it (`sendMessage` in `lib/runner.ts`): a `[Weft: …]` block naming
  each lost task once, so a resumed CLI, which has no record of them, doesn't wait for reports that will never come.
- **Orphans on resume**: a resumed CLI also sends a `task_notification` of status `stopped` for tasks the old process left
  behind. Its structured `reason` (`worker_restart`) is often missing, so `isOrphaned` in `lib/tasks.ts` also matches the
  summary "Orphaned by a previous … process exit" and keeps them `lost`, not `stopped`. A task Weft already marked lost and
  told keeps its `told` mark and cut-off time; a new one gets `told: false`. While one is untold, the strip's hint
  (`CUT_OFF_HINT`) says a message tells the thread, which can run it again.
- **Idle closing** (`closeWhenIdle`, `trimIdle` in `lib/runner-state.ts`) skips a CLI with a live background task
  (`hasLiveTasks`) and checks again after another keep-alive period. A task silent for 6 hours (`STALE_MS`) stops
  counting, so a missed final event can't hold a CLI open forever.
- **The UI**: `components/TaskStrip.tsx` (above the reply box, from `taskStripView` in `lib/tasks-view.ts`) shows running
  tasks and those that ended in the last 15 minutes; `components/CardMarks.tsx` shows `⑂N` for running ones.

Codex sends no task events, so its cards have no ledger.
