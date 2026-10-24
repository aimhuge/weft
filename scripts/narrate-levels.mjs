#!/usr/bin/env node
// Voices the level-up lore (lib/level-lore.ts): one Kokoro clip per line into public/brand/levels/voice/<rank>-<n>.m4a,
// which components/AchievementPopup.tsx plays as a level-up opens. Uses the welcome tour's voice pipeline
// (scripts/narrate-lib.mjs) with no backing pad; the word timings it writes beside each clip aren't used here, so
// they're removed. Change a line in lib/level-lore.ts, then run this again.
//   pnpm levels:narrate                      bm_george, the narrator
//   pnpm levels:narrate -- loom-5 strand-1   just these clips
//   pnpm levels:narrate -- --voice=am_michael
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { loreLines } from "../lib/level-lore.ts";
import { narrate } from "./narrate-lib.mjs";

const dir = resolve(import.meta.dirname, "..", "public", "brand", "levels", "voice");
const picked = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const voice = process.argv.find((a) => a.startsWith("--voice="))?.slice("--voice=".length) ?? "bm_george";

const tracks = {};
for (const { clip, line } of loreLines()) if (!picked.length || picked.includes(clip)) tracks[clip] = { lines: [[0, 20, line]] };

mkdirSync(dir, { recursive: true });
await narrate(tracks, (clip) => join(dir, `${clip}.m4a`), voice);
for (const clip of Object.keys(tracks)) rmSync(join(dir, `${clip}.words.json`), { force: true });
