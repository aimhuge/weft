# @weft/client

Weft's client core in plain TypeScript: the shapes and pure view models that the desktop board, weft.zip and the
phone app (`~/dev/weft-mobile`) all read, so the three can only disagree on looks
(docs/architecture/project-hosts.md#views, phase H9).

## What belongs here

Code that runs the same in React Native (Hermes), a browser and Node, with no I/O of its own:

- **Shapes that cross the wire**: `ThreadItem` and its parts, `EditPreview`, `SecretAsk`, `BlobRef`, `Column`,
  `Backend`, `PermissionMode`.
- **Host verbs**: `HOST_VERBS` / `HostVerb` / `isHostVerb` (lib/host-api's `HOST_API` is keyed by exactly these),
  the arg shapes and body pickers (`CardPatch`, `messageCall`, `permissionCall`, `widens`), and the `host` command's
  row builder and readers (`hostCommand`, `readHostCommand`, `remoteRefusal`, `hostResult`). The verbs on a host
  itself (`isHostLevelVerb`, `hostLevelRow`, `CardVerb` for the rest) and the settings lists that may travel to a worker
  (`ACCOUNT_SETTINGS`, `HOST_SETTINGS`, `pickSettings`, `foreignSetting`).
- **View models**: `extractStatus` (the BOARD STATUS line), `paneFromUrl` / `paneFor` / `screenPage` (the pane as
  the thread tells it), `showMinis` / `followUrl` (the show rail), `clip` / `timeAgo` / `shortToolName`.
- **Threads and boards**: thread paging (`pageThread`, `applyThreadEvent`, `mergeOlderPage`, and `pageFromItemRows` /
  `pageUpdateWith` for synced rows, given the caller's opener), find (`matchThread`, `spotAt`), the pending ask
  (`PendingPermission`, `pendingView`) and pending sends (`unsent`), and board grouping (`groupByColumn`, `SORTERS`,
  `listGroups`, `summarizeProjects`, `headerCounts`, typed over a structural `BoardCard`).
- **Cloud commands**: the `cloud_commands` row shapes, the builders a board inserts (`newCardCommand`, given the
  caller's model-to-CLI lookup, `replyCommand`, `answerCommand`, `stopCommand`) and the readers (`replyBody`,
  `answerBody`, `stopBody`, `commandText`).
- **The transport's shape**: `ThreadTransport` and `PageUpdate` (its `useLive` / `useView` are hooks in each app, plain
  function types here) and `mergePage` for a polling transport.
- **Approval messages**: `approvalMessage`, `signApproval`, `verifyApproval`, `readApprovalAuth`, given the caller's
  libsodium as a `Sodium` (libsodium-wrappers on the Mac and the web, react-native-libsodium on the phone).

- **A session line's opening**: `sealTo` / `answerKeys` (the offer sealed to a worker's X25519 key byte for byte as
  `lib/worker-seal.ts`, given the caller's libsodium and Web Crypto `subtle` as a `SealCrypto`), the `line` row and
  `lineOpener`, and `offerLine` / `openLine` over an RTCPeerConnection the caller hands in (the browser's, or
  react-native-webrtc's), with a `wait` for the clock.

## What doesn't

- No DOM, React, React DOM, Next or Node built-ins (`node:*`, `fs`, `path`, `crypto`). The package's own
  `tsconfig.json` has no `dom` lib and no Node types, and ESLint refuses those imports here. The web globals it
  reads, `URL`, `URLSearchParams` and `TextEncoder`, are declared in `src/globals.d.ts`; React Native older than 0.74 needs
  `react-native-url-polyfill` for them.
- No `console` and no timers (`setTimeout`, `setInterval`): the tsconfig's `types: []` leaves them undeclared on
  purpose, since logging and scheduling belong to the platform edge. Take a callback or a clock argument instead.
- No imports from the app (`@/`, `lib/`): move the piece in, and leave a re-export at its old `lib/` path.
- No handlers, stores, network clients or timers: a host's handlers stay in `lib/host-api`, the transports themselves
  (their fetches, Supabase reads and React hooks) in `lib/*-transport.ts`; only their shape lives here.

## Working on it

- The app imports it as `@weft/client` (a pnpm workspace link; Next compiles it through `transpilePackages`, and
  jiti, which runs the worker daemon, loads it from `node_modules/@weft/client`).
- Tests sit beside the code (`src/*.test.ts`) and run with the app's: `pnpm test packages/weft-client`. Keep every
  line covered.
- `pnpm typecheck` checks it twice: with the app, and alone against `tsconfig.json` here.
- The 300-line cap applies here like everywhere else.
