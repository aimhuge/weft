# Contributing to Weft

Thanks for helping. Weft is a desktop kanban board where each card is a Claude Code or puku-cli
thread. Read [SOUL.md](SOUL.md) first: it says what Weft values and where things live.

## What the license means for you

Weft is [FSL-1.1-ALv2](LICENSE). In short:

- **Your contribution stays yours.** You keep the copyright; there's no CLA to sign.
- **You can use Weft for anything but a competing product.** Fork it, run it at work, build on it,
  do client work with it.
- **Your code becomes Apache-2.0 two years after the release it ships in,** like the rest of Weft.
  Nobody can lock it up for good, us included.
- **The one rule is aimed at big companies, not you:** nobody gets to take Weft and sell it as their
  own board.

## Where to start

- Issues labeled [`good first issue`](https://github.com/aimhuge/weft/labels/good%20first%20issue)
  or [`help wanted`](https://github.com/aimhuge/weft/labels/help%20wanted).
- The **Known gaps** in [README.md](README.md#known-gaps) and [SOUL.md](SOUL.md).
- Tests for `components/` and `electron/`, which are mostly untested.
- Use Weft on Weft: open this folder as a project and let a card do the work. It's how most of Weft
  gets built.

Anything you ship gets a changelog entry. In Weft, a thread records it with `mcp__board__changelog_add` and it lands in
CHANGELOG.md in a commit Weft makes right after yours; without Weft, add the line under **Unreleased** in CHANGELOG.md by hand, with your name.

## Setup

```bash
git clone https://github.com/aimhuge/weft.git
cd weft
pnpm install
pnpm desktop        # Electron app: board + side browser
pnpm dev            # board only, at http://127.0.0.1:1024
```

You need Node 20+ and a logged-in `claude` CLI (or `puku-cli`). Weft is macOS-first today.

## Before you open a PR

```bash
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm install` sets up a pre-commit hook that type-checks exactly what you staged, so a commit can't
import a file you forgot to `git add`.

Tests are Vitest and sit beside the code as `lib/*.test.ts`. Add a test with any risky change,
especially to `lib/`. The runner, store and UI are still untested, so tests there are welcome.

## Guidelines

- **Keep PRs small and focused.** Refactor in separate, behavior-preserving steps, with tests first.
- **Speed matters.** Don't add work to the start-a-card path without measuring it.
- **Screen space is precious.** Fold new UI into existing controls (menus, counts, badges) rather
  than adding rows or chips.
- **This Next.js differs from older versions.** Read `node_modules/next/dist/docs/` before changing
  routing or data fetching. Leave the managed block in `AGENTS.md` alone.
- **Update docs with the feature.** Change README.md and docs/ROADMAP.md in the same PR.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- If you change the BOARD STATUS line format, update `lib/status.ts` and its tests too.

## Reporting bugs and ideas

Open an issue using the templates. For security problems, see [SECURITY.md](SECURITY.md) instead.

By contributing you agree your work is released under Weft's license, [FSL-1.1-ALv2](LICENSE),
which turns into Apache-2.0 two years after each release. Sign off your commits (`git commit -s`)
to say you wrote the change or have the right to submit it ([DCO](https://developercertificate.org/)).
