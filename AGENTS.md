Read SOUL.md first: it says who Weft is, what it values, and where things live.

<!-- Goose reads this file on its own, and imports other files as @./path. CLAUDE.md pulls in SOUL.md. -->
@./CLAUDE.md

<!-- BEGIN:nextjs-agent-rules -->

## Public links to your own card

When your work needs a link anyone can open (a demo video or page for a PR, an issue or a message), `open_url` it in the
pane and call `mcp__board__share_card`; don't stop to ask the user to click Share. It publishes this card only, pane only
unless you pass `show_chat: true`, and the first public share of a card asks the user once (lib/share-consent.ts). Share only
what the task needs shown: a public link can be cached or indexed the moment it exists. `public: false` takes it back.

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
