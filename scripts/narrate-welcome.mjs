#!/usr/bin/env node
// Voices the welcome tour: one Kokoro clip per caption, placed at its time into one track per composition (scripts/narrate-lib.mjs) (public/welcome/narration-intro.m4a, -loop.m4a, -beats.m4a for
// intro.html, loop.html, beats.html), plus one clip for each of the welcome's later steps (-projects.m4a, -first.m4a). The compositions carry them as HyperFrames <audio> clips, so
// `pnpm welcome:render` bakes the voice into the MP4s; in the app, components/WelcomeLoop.tsx plays the track of the
// page on screen. kokoro-js lives in ~/.cache/weft-kokoro, outside the repo (installed there on first run; the model,
// ~80 MB, downloads once to the Hugging Face cache). Each tour page's track also carries a soft backing pad made by
// ffmpeg (bedSource below). Needs ffmpeg.
//   pnpm welcome:narrate                 af_heart
//   pnpm welcome:narrate -- --voice=am_michael
//   pnpm welcome:narrate -- --only=beats   one track, so the others aren't re-encoded
import { join, resolve } from "node:path";
import { narrate } from "./narrate-lib.mjs";

// Each line starts where its caption does, or just after the line before it if that one is still talking, and should
// end by its `end` (the script warns when it runs over, so a caption and its line don't drift apart).
const NARRATION = {
  intro: {
    duration: 12,
    lines: [
      [0.3, 2.1, "Welcome to Weft."],
      [2.1, 5.3, "Weft is the future of AI engineering."],
      [5.3, 11.4, "Weft runs on top of Claude Code, Codex, and other agent see-ell-eyes like Puku AI."],
    ],
  },
  loop: {
    duration: 26.4,
    lines: [
      [0, 3.2, "Every card in Weft is an AI coding thread."],
      [3.4, 5.8, "Click a card to open its thread."],
      [6, 12, "Every Weft card has a pane, and it's always showing you something: your app, a plan, a video it made."],
      [12.2, 16.8, "When a Weft card needs a decision, it moves to the Needs you column."],
      [17.3, 20.4, "Check Weft's work in the Review column."],
      [20.6, 25.6, "Moving a card to the Done column commits, refactors and deploys."],
    ],
  },
  beats: {
    duration: 68.4,
    lines: [
      [0.5, 4.8, "Connect your tools to Weft, so your threads can use them."],
      [5.5, 10.6, "Your vault stores your credentials and lets your AI securely use them."],
      [11, 22.5, "Panes aren't just previews. They can use keys in your vault to connect to your database or APIs, so sharing a secure live dashboard, mini-app or game is just a few clicks away."],
      [22.9, 28.1, "Weft also scores your code quality, and Weft's scout keeps your code clean."],
      [28.5, 38.4, "Weft comes with BlastCP built in, so you can easily connect all your social accounts, make images, video and voice for your posts, and build in public."],
      [38.8, 43, "Share your Wefter Profile, and show the world what you ship."],
      [43.4, 50.8, "Weft is open source. If something is broken, or you want to add a feature, please feel free to make a pullrequest."],
      [51.4, 54.2, "Weft is driven by keyboard shortcuts."],
      [54.3, 58.6, "Double-click the board or hit Command N to start a new thread."],
      [58.8, 60.8, "Press Escape to close it."],
      [61, 64.8, "Hit Command K to open the search and action HUD."],
      [65, 67.9, "And hit question mark for the shortcut list."],
    ],
  },

  // weft.zip's ending (outro.html): the homepage tour swaps beats.html's keyboard shortcuts for downloading Weft.
  outro: {
    duration: 13,
    lines: [
      [0.3, 4.3, "Weft runs right on your Mac, with the AI you already use."],
      [4.6, 8.6, "Download Weft, and engineer the future with us."],
      [9, 11.6, "Weft. Engineering the future."],
    ],
  },

  // The welcome's later steps: one line each, played as the step opens (components/WelcomeDialog.tsx), not looped.
  projects: { lines: [[0, 4, "Allow Weft to see your projects."]] },
  first: { lines: [[0, 4, "Now start a new thread."]] },
};

const root = resolve(import.meta.dirname, "..");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const tracks = only ? { [only]: NARRATION[only] } : NARRATION;
if (only && !NARRATION[only]) throw new Error(`No track "${only}": ${Object.keys(NARRATION).join(", ")}`);
await narrate(tracks, (page) => join(root, "public", "welcome", `narration-${page}.m4a`));
