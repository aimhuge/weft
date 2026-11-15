# New thread: one design across the three clients

The New thread screen was three different screens: the desktop's `NewCardDialog` + `Composer`, a lookalike on weft.zip
(`WebNewCardDialog`, now deleted) and the phone app's WeChat-style `NewCard`. Now there is one design, the desktop's, and
each client draws it the way it can. Design page: `~/.weft/show/new-card-parity/index.html`.

## One form, one order

`packages/weft-client/src/new-card-form.ts` holds `NewCardForm`, which every client sends, and `NEW_CARD_FIELDS`, the
order every client draws its pickers in:

`where → isolate → agent → model → effort → mode → tags`, then Backlog vs Start.

The prompt (rich text, files, voice, `@` and `/` typeaheads) comes first. `new-card-form.test.ts` pins the order. The
phone app (`~/dev/weft-mobile`, plan in its `docs/new-card-parity-plan.md`) is moving onto the same type.

## The desktop dialog takes a transport

`lib/new-card-transport.ts` is to the New thread dialog what `lib/thread-transport.ts` is to an open thread: where the
card goes, so the desktop and weft.zip draw the same component.

| | Desktop (`localNewCard`, the default) | weft.zip (`WebNewCard`) |
|---|---|---|
| Folder | `RepoPicker` over this Mac's disk | `WherePicker`: your synced projects, grouped Macs then workers; the value is `device\nfolder` (`placeKey`) |
| Settings' defaults, worktree warm-up, `api.warm` | read and run | skipped (`useNewCardDialog(…, local=false)`, `useIsolate(cwd, false)`); the Mac keeps its own |
| Isolated | `IsolateMenu` with the repo's branches | the same menu; a branch is typed (`branches={false}`), the Mac checks it |
| Agent | the menu | left out: an agent from the network needs a signed `card.create` widening (`lib/create-widen.ts`), which the sign page doesn't do yet; the Mac starts the project's default |
| Mode | `ModePicker` | the same, with no YOLO, opening on the mode the place's Mac really starts a web thread in (below); sent only once picked (the Mac refuses a named looser mode when web approvals are off but lets an unnamed one fall back, `lib/cloud-new-card-mode.ts`); **Plan first** beside the Where picker on a worker |
| ⏰ cron, status strip, plan-limit gate | shown | no cron; a note ("The Mac or worker has to be on…") in the strip's place |
| Backlog | always | disabled on a worker (its cards start when they're made) |
| Create | `onCreate` → `POST /api/cards` | `webNewCard(input, places, plan)` → `useWebBoard.startCard` → a `new_card` command |

The composer's uploads, people search and `/` skills come from the cloud `ThreadTransport` the web board already
provides for replies. A new card has no id yet, so `WebNewCard` lists skills through a card already in the chosen place
(`skillsCardFor`), whose machine answers `skills.list` for that project. Pasted files go to the workspace's blobs
(`lib/web-upload.ts`), and `sendCommand`'s `withAttachments` lists them on the `new_card` row. The Mac brings them down
before the first turn (`lib/cloud-inbox-cards.ts`). Dictation is the browser's own speech recognition
(`lib/use-dictation.ts`).

`new_card` now carries `isolated` and `branch` (`NewCardPayload`), and the Mac's `newCardBody` passes them to
`lib/new-card.ts`.

## The mode the menu opens on

A Mac publishes the mode a web thread with no mode named starts in (its default held to its web rule:
`lib/cloud-inbox-cards.ts` `webStartMode`) with each 30 s desktop-worker beat, when it changes, through
`desktop_worker_start_mode` into its `cloud_workers` row's `capabilities.startMode`
(`supabase/migrations/20261113100214_desktop_worker_start_mode.sql`, `lib/desktop-worker.ts` `publishStartMode`). The
dialog reads the workspace's desktop rows when it opens (`lib/web-start-modes.ts`) and shows that mode for the chosen
Mac until you pick one (`useNewCardDialog`'s `startMode`). A worker publishes none yet, so its menu keeps its own guess.

## Phone width on weft.zip

Below 768 px (`lib/use-phone-width.ts`), `WebNewCard` draws `components/web-board/PhoneNewCard.tsx`, the phone app's
design in the DOM, over the same `useNewCardDialog` state:

- `PhoneChips`: a sideways-scrolling chip row in `NEW_CARD_FIELDS` order (Where, Isolation, Model, Effort, Plan first on
  a worker, Mode), each a native select, so the phone opens its own picker.
- `PhoneInputBar`: the 🎙/⌨ toggle and **Hold to talk** (let go to send what was said, slide up to cancel), the typed
  field with ↑ to Start, ⊕, and ⋯ holding **Add to Backlog**.
- `PhoneTray`: Photos, Camera, File, Paste (Scan, Draw and Location need the app).

## Coming next: a teammate's "💡 Add to this board"

A teammate adding to a shared board (the onboarding card) gets this same dialog as a `suggest` variant: Backlog only,
aimed at the project owner's Mac, with the run pickers hidden because the owner picks them when they start it. It needs
a cloud_commands migration so a teammate's `new_card` can reach the owner's Mac, so it isn't built yet.

## Coming next: the Agent menu on weft.zip

The web dialog leaves Agent out: an agent is who a thread is, so a browser's `new_card` naming one needs a signed
approval, which the host already checks (`lib/create-widen.ts` `signedAgent`, called from `lib/cloud-inbox-cards.ts`).
What's missing:

- The passkey page signs only existing cards: `lib/sign-widen.ts` reads the card (`loadWidenCard`) and its
  `argsFromChange` refuses `card.create`. It needs a create ask (place, agent, first message, the run's terms via
  `createTerms`) that inserts the `new_card` (Mac) or `run` (worker) itself.
- The host's passkey rules (`lib/widen-check.ts`) must accept a webauthn approval for `card.create`.
- The Mac publishes its agents (as it does `startMode`, `lib/desktop-worker.ts`) so the dialog can list them; picking
  one routes Start through the sign page.
