// The shape of a craft habit, in a file of types only.
//
// It lives here, not in lib/craft.ts, because the board's palette counts the habits a card showed
// (components/board-palette.ts -> lib/achievement-replay.ts -> lib/game-badges.ts) — and a type-only
// import of a server module still makes Turbopack resolve that module, which reads ~/.weft/craft.json
// with node:fs. A browser chunk can't hold that, so the whole board failed to compile.

export type Habit = "wrap" | "commit" | "review" | "docs" | "refactor";
