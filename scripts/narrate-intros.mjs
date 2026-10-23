#!/usr/bin/env node
// Voices the feature intros (public/intros/<id>.html, lib/feature-intros.ts): each page's own
// <script type="application/json" id="narration"> lines, placed at their cues with the welcome tour's pad under them
// (scripts/narrate-lib.mjs), into public/intros/<id>.m4a, which components/FeatureIntro.tsx plays as the page starts.
// Captions live in the page's HTML and the voice in its #narration block, so change both together.
//   pnpm intros:narrate                     every intro
//   pnpm intros:narrate -- vault github     just these
//   pnpm intros:narrate -- --voice=am_michael
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { narrate } from "./narrate-lib.mjs";

const dir = resolve(import.meta.dirname, "..", "public", "intros");
const picked = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const NARRATION = /<script type="application\/json" id="narration">([\s\S]*?)<\/script>/;
const tracks = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const id = file.slice(0, -".html".length);
  if (picked.length && !picked.includes(id)) continue;
  const found = NARRATION.exec(readFileSync(join(dir, file), "utf8"));
  if (!found) {
    console.warn(`! ${file} has no #narration block`);
    continue;
  }
  tracks[id] = JSON.parse(found[1]);
}

await narrate(tracks, (id) => join(dir, `${id}.m4a`));
