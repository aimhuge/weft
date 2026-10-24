# AskUserQuestion: asking and answering

A thread's `AskUserQuestion` is asked the way Claude Code asks it: a tab per question
(plus a Submit tab when the agent asked several), numbered options moved with
↑/↓ or picked with 1-9, checkboxes for multi-select, and the reply composer
below as the single text input — your own answer when nothing is picked, or a
note on your pick when something is. Picked options' previews show in the
card's browser pane.

## Overview

When the SDK calls `AskUserQuestion`, `canUseTool` in `lib/runner-session.ts`
hands the request to `askUser` (`lib/runner-ask.ts:79`), which:

- pulls `questions` out of the tool input via `readQuestions` (`lib/turn.ts:11`)
  and stores them on a `Pending` (`session.pending`)
- writes one HTML page with the options' previews to
  `~/.weft/show/<card>-question.html` via `writeQuestionPreview`
  (`lib/question-preview.ts:54`) and attaches its `file://` URL
- finds a folder outside the card's project that any of the questions name, via
  `suggestReadScope` (`lib/read-scope.ts:102`); it lands on the `pending` as
  `readScope` and becomes a one-click "Read from <token>" button in the form
- marks the card `column: "needs_you"` and pushes a `pendingView` to the
  client, so `card.pending` carries `{ id, toolName, title, input, questions,
  readScope, previewUrl }` (`PendingPermission` in `lib/types-card.ts:158`)

`ThreadView.tsx:24` (`questionFor`) turns that into the `question` prop the
`ReplyBox` shows. The form is `components/QuestionForm.tsx`, drawn above the
reply composer; the composer is the only text input. On send, the form calls
`api.answer(card.id, true, answers, pendingId, { annotations })` — board
threads through `onAnswer` in `ThreadView.tsx:32`, the copilot directly
through `api.answer` in `components/CopilotChat.tsx:125` — and the server
resolves the SDK's `Promise<PermissionResult>` with
`{ behavior: "allow", updatedInput: { ...input, answers, annotations } }`.

The reply composer being the one input replaces the old warn panel with its
own `Something else` text box and Send/Skip row; notes go to the CLI as
`AskUserQuestion`'s `annotations` field (`{ notes, preview }` per question) the
way Claude Code sends them. The form's state is pure (`lib/question-answers.ts`)
and keyed by the request id, so the next question on the same card starts
fresh.

## Key files

- `lib/runner-ask.ts` — `askUser`, `answerPermission`, `settle`, `permissionResult`
- `lib/turn.ts:11` — `readQuestions(input)`: sanitizes the SDK's `questions`
  array into `Question[]` (`lib/types-thread.ts:6`): `{ question, header?,
  multiSelect?, options: [{ label, description?, preview? }] }`. Only `multiSelect
  === true` is kept; `preview` is a trimmed string
- `lib/question-answers.ts` — pure state and the reply builder. `AnswerState`
  carries the cursor, picks and per-question notes; `buildReply` produces
  `{ answers, annotations }` or `{ missing }`
- `lib/question-keys.ts` — what a key in an empty box does to the form
  (←/→, ↑/↓, space, 1-9); modifiers (⌘, Ctrl, Alt, Shift) leave the key to the
  box
- `lib/question-preview.ts` — the per-question-set HTML preview page; written
  to `~/.weft/show/<cardId>-question.html` and opened in the card's browser
  pane at `#<question>-<option>` as the highlight moves
- `lib/read-scope.ts` — `suggestReadScope`: picks a directory outside the
  project that a question names, so the form can offer a "Read from <path>"
  grant
- `components/QuestionForm.tsx` — the form (tabs, options, Submit review),
  drives the composer's text per tab, sends on Enter or pick
- `components/QuestionParts.tsx` — the pieces (`QuestionTabs`, `Options`,
  `Review`)
- `components/ReplyBox.tsx` — mounts the form above the composer when
  `question` is set, routes empty-box keys to it (`form.current?.key(...)`)
  and Enter to it (`form.current?.enter()`), and runs the composer's text as
  the answer when nothing is picked
- `components/ThreadView.tsx:24` (`questionFor`) — builds the `question` prop
  from `card.pending`
- `app/api/cards/[id]/permission/route.ts` — validates the request body and
  calls `answerPermission`

## Data flow

```
SDK canUseTool (AskUserQuestion)
   │
   ▼
askUser (lib/runner-ask.ts)
   ├─ readQuestions(input)        → Question[]   (lib/turn.ts)
   ├─ writeQuestionPreview(cardId, questions)  → file://…  (lib/question-preview.ts)
   ├─ suggestReadScope(question, cwd)          → OutsidePath? (lib/read-scope.ts)
   └─ pending = { id, questions, readScope, previewUrl, … }
       │
       ▼
safeUpdate(cardId, { column: "needs_you", pending: pendingView(p) })
       │
       ▼  (board event)
ThreadView.questionFor(card)             (components/ThreadView.tsx:24)
   └─ { key, questions, readScope, previewUrl, onAnswer, onReadScope }
       │
       ▼
ReplyBox question={…}                    (components/ReplyBox.tsx:54, 248)
   └─ <QuestionForm cardId composer … />
       │
       ▼  on send
buildReply(state, questions)              (lib/question-answers.ts:81)
   → { answers: Record<question, "label, label">, annotations?: { [q]: { notes?, preview? } } }
       │
       ▼
ThreadView onAnswer(true, answers, reply)  ──►  api.answer(cardId, …)        (lib/client-api.ts:147)
                                                       │
                                                       ▼
                POST /api/cards/[id]/permission      (app/api/cards/[id]/permission/route.ts)
                  body: { allow, answers, pendingId, annotations?, chat? }
                  readQuestionReply(body) — narrows annotations to { notes, preview } per question
                                                       │
                                                       ▼
                            answerPermission(cardId, allow, answers, pendingId, reply)
                            (lib/runner-ask.ts:16)
                                                       │
                                                       ▼
                            settle() → permissionResult()
                            { behavior: "allow", updatedInput: { ...p.input, answers, annotations } }
                            { behavior: "deny",  message: "…" }     // when chat is set
                            (lib/runner-ask.ts:58)
                                                       │
                                                       ▼
                            SDK Promise<PermissionResult> resolves; turn continues
```

`annotations` is set only when the user picks a single option (a preview
annotation) and/or types a note beside a pick (a notes annotation). The
permission route's `readQuestionReply` drops empty `notes`/blank `preview` and the
whole `annotations` field if it ends up empty, so `updatedInput` carries
nothing extra when the user just picked an option without a preview or note
(`lib/runner-ask.ts:60-62`).

The route also accepts a `chat` field on the body and produces a denial
message from it (`lib/runner-ask.ts` `permissionResult`). The form's hint row
ends in **Chat about this** (the box's text goes as `chat`; an empty box asks
for text first) and **Skip** (a denial with no `chat`: "The user skipped the
question."), both through `onDecline`, which `ThreadView` turns into
`onAnswer(false, undefined, { chat })`. Text typed on the Submit tab is still
sent with the answers as a note on all of them (`lib/question-answers.ts`
`buildReply`'s `general`), never as `chat`.

### The hold and the retry

A send, a number key or a tick, or a click on an option in the first
`ARM_MS` (800 ms) after the form mounts is held: nothing is sent, the box
keeps its text and a warn line says why. The form is keyed by the request,
so mount is the moment the question appeared; this stops Enter on a message
you were finishing from answering a question you haven't read. Arrows still
move the highlight. `onAnswer` and `onDecline` may return a promise; if it
rejects, the form re-enables, restores the box's text and its picks, and
shows the error. The desktop board and the copilot return `api.answer`'s
promise (and pass the `reply`, which they used to drop) for that.

## The form's state

`QuestionForm` keeps an `AnswerState` (`lib/question-answers.ts:8`):

```
{ tab, cursor[], picked[][], notes[] }
```

`tab` is the question shown, or the Submit tab (`questions.length` — only
present when there are several). `cursor[i]` is the highlighted option on
question `i`; `picked[i]` the picked labels; `notes[i]` the composer's text
written while question `i` is shown, kept across tab switches so each
question's text travels with it. `goTo`, `setNotes`, `setCursor`, `moveCursor`,
`pick`, `advance` and `isAnswered` keep it pure; the form holds the state and
reads/writes the composer (`ComposerHandle.read/readText/write/clear/focus`).

`buildReply` is the only place that decides what goes to the CLI:

- For each question: if there are picks, the answer is the joined labels
  (`"A, B"`) and `annotations[q]` is `{ notes? , preview? }` when a note was
  typed or the single pick had a `preview`; otherwise the answer is the
  composer's trimmed text and `annotations[q]` is empty. A question left with
  neither returns `{ missing: i }` and the form bounces to that tab with an
  error.
- The Submit tab's text (a note on all the answers) is appended to the first
  question's notes after its own note, prefixed with `"On all answers: "`.

A empty annotations object is dropped by `lib/question-ask.ts:60-62` and by
the form's `onAnswer` wrapper in `ThreadView.tsx:32-34`, so `updatedInput` only
gains `annotations` when something meaningful was added.

## Keys

`useReplyKeys` (`lib/use-reply-keys.ts:96`) routes every keydown through the
form first when a question is open, but only when the box is empty
(`form.current?.key(e, composer.current?.isEmpty() ?? true)`). A non-empty
box gets the key.

`keyAction` (`lib/question-keys.ts:20`) returns a `KeyAction | undefined`:

- `← / →` → `{ tab: -1 | +1 }` (only when there are several questions, so the
  single-question case leaves them to the box)
- `↑ / ↓` → `{ move: -1 | +1 }` (wraps the option list)
- `Space` → `{ tick: true }` (multi-select only; on a single-select question
  it's left to the box)
- `1`-`9` (no Shift) → `{ pick: 0-8 }` (in range; out of range leaves the
  key alone)
- Any `metaKey` / `ctrlKey` / `altKey` returns `undefined` so the key falls
  through to the composer

The form's imperative handle (`QuestionFormHandle`):

- `key(e, boxEmpty)` returns `true` when the form used the key, so the
  capture handler can `preventDefault` and `stopPropagation`
- `enter()` answers the shown question, or sends on the Submit tab

Enter in the reply box: if the question is unanswered and the box is empty,
it picks the highlighted option (multi-select ticks, single-select
advances); if the box has text, the text is taken as the answer (or the
note) before the move; if the question is already answered it advances
to the next unanswered one. On a single question, an answered question
sends right away. On the Submit tab, Enter sends.

A trailing hint under the form spells out the keys for the shown question
(`QuestionForm.tsx:210`).

## Previews

`readQuestions` keeps an option's `preview` when it's a non-empty trimmed
string. When at least one option has a preview,
`writeQuestionPreview(cardId, questions)` writes one HTML page to
`~/.weft/show/<cardId>-question.html` with one `<section id="<q>-<o>">` per
option. The page's hash listener (`lib/question-preview.ts:42-49`) shows the
section matching `location.hash`; sections for options without a preview
say "No preview for this option." instead.

`QuestionForm` watches its highlight: as the cursor moves, it opens
`${previewUrl}#<tab>-<cursor>` in the card's browser pane via
`window.weft.browser.open(url, cardId)` (the bridge that the
desktop shell provides). The URL is built with `previewHash`
(`lib/question-answers.ts:120`). When the form has no bridge (a plain
browser tab, no card pane), the highlighted option's `preview` is shown
inline under the options instead (`QuestionForm.test.tsx:216-228`).

A page that can't be written (no previews, or `writeQuestionPreview` throws)
just leaves the `previewUrl` out of `pending` and the form opens nothing
(`lib/runner-ask.ts:128`).

## "Read from <path>"

When `suggestReadScope` returns a directory that one of the questions names
and that lives outside the card's `cwd`, the form draws a single
`Read from <token>` button under the options. Clicking it:

- persists the directory on the card through `api.setReadScope`, where the
  live session's folder guard (`lib/folder-guard.ts`) reads it
- answers the question itself: the answer for every question is the
  user's picks plus the typed text (if any) plus the line
  `"You can read from <directory> — try again"`, so the agent can retry
  the read on its next turn

`readScope` is server-side: the client receives it on `pending` but doesn't
compute it (`QuestionForm.tsx:35`, `lib/types-card.ts:165-167`).

## The request body (permission route)

`POST /api/cards/[id]/permission` accepts:

```ts
{
  allow: boolean,
  answers?: Record<string, string>,        // "label, label" per question
  pendingId?: string,                      // ties the answer to the request
  annotations?: {                          // per question, narrowed by readQuestionReply
    [question: string]: { notes?: string; preview?: string }
  },
  chat?: string,                           // declines with a message
}
```

`readQuestionReply` (`lib/question-reply.ts`) drops anything
that isn't an object, drops empty/blank `notes` and `preview`, and drops
the whole `annotations` object if it ends up empty. It also drops
`chat` if blank. The body is untrusted; the route goes through
`guard(req)` first.

`answerPermission` then `settle`s the request: the thread's `permission`
item is replaced with `{ kind: "permission", decision: "allow" | "deny",
answer, at }`, the card moves back to `running` (or the next `pending`
becomes the new `pendingView`), and the SDK's promise resolves through
`permissionResult` (`lib/runner-ask.ts:58`):

- `allow && answers` → `{ behavior: "allow", updatedInput: { ...p.input,
  answers, ...(annotations ? { annotations } : {}) } }`
- otherwise → `{ behavior: "deny", message: chat ? "The user didn't pick
  an answer and wants to talk it over instead. They wrote: <chat>" :
  "The user skipped the question." }`

The denial form is what `api.answer(..., allow=false, ...)` would produce;
the form never does. The protocol is open so other clients (a future
mobile, a CLI) can still decline a question with their own message.

## Read-scope and `previewUrl` on the wire

Both fields are set on the server (`lib/runner-ask.ts:96-99`) and shipped
to the client as part of `card.pending`. The form is the only place that
reads them:

- `previewUrl` opens in the card's browser pane through the desktop
  bridge; the form falls back to an inline `<pre>` block under the
  options when the bridge isn't there
- `readScope` draws the one-click "Read from <path>" grant; the form
  calls `onReadScope(path)` which `api.setReadScope` persists on the card,
  where the open session's folder guard reads it

Neither field is required, and `askUser` swallows a `writeQuestionPreview`
failure (a read-only disk) so the question still reaches the user
(`lib/runner-ask.ts:128-134`).

## Plan preview (`ExitPlanMode`)

The same `previewUrl` plumbing carries a thread's plan to the pane when the
SDK calls `ExitPlanMode` (Claude Code and puku): `askUser` (`lib/runner-ask.ts`)
detects the tool via `isPlanTool` (`lib/plan-preview.ts`), writes a self-
contained HTML page of the plan to `~/.weft/show/<cardId>-plan.html` via
`writePlanPreview` (a small Markdown→HTML renderer for headings, lists, code
fences and inline emphasis — `lib/plan-preview.ts`), and attaches the `file://`
URL to `pending.previewUrl`. The thread item is titled "Plan ready for review"
by `pendingLabel` (`lib/runner-ask.ts`), and `components/PermissionInput.tsx`
shows a one-line "Plan opened in the pane — read it there, then Allow or Deny
below." with a "Show in pane" link and a Raw toggle for the JSON view. The
pane opens the URL through `bridge.browser.open(previewUrl, cardId)` on
mount. `lib/plan-preview.ts` mirrors `lib/question-preview.ts`; both share
`DATA_DIR` and the `~/.weft/show/` location.
