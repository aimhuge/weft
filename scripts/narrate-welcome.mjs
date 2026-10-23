#!/usr/bin/env node
// Voices the welcome tour: one Kokoro clip per caption, placed at its time into one track per composition (scripts/narrate-lib.mjs) (public/welcome/narration-intro.m4a, -loop.m4a, -beats.m4a for
// intro.html, loop.html, beats.html), plus one clip for each of the welcome's later steps (-projects.m4a, -first.m4a). The compositions carry them as HyperFrames <audio> clips, so
// `pnpm welcome:render` bakes the voice into the MP4s; in the app, components/WelcomeLoop.tsx plays the track of the
// page on screen. kokoro-js lives in ~/.cache/weft-kokoro, outside the repo (installed there on first run; the model,
// ~80 MB, downloads once to the Hugging Face cache). Each tour page's track also carries a soft backing pad made by
// ffmpeg (bedSource below). Needs ffmpeg.
//   pnpm welcome:narrate                 af_heart
//   pnpm welcome:narrate -- --voice=am_michael
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
    duration: 30,
    lines: [
      [0, 3.2, "Every card in Weft is an AI coding thread."],
      [3.2, 10, "Click a card to open its thread. Weft shows its work in the browser pane."],
      [10.2, 13.6, "When a Weft card needs a decision, it moves to the Needs you column."],
      [13.8, 20, "Your keys live in your vault. Touch ID safely lets your AI use them."],
      [21, 23.6, "Check Weft's work in the Review column."],
      [23.6, 29, "Moving a card to the Done column commits, refactors and deploys."],
    ],
  },
  beats: {
    duration: 54.5,
    lines: [
      [0.5, 7, "Connect your tools to Weft, so your threads can use them."],
      [7.5, 16.3, "Panes aren't just previews. They can use your vault, connect to your data, and be shared, so a live dashboard, mini-app or game is just a few clicks away."],
      [17, 23.5, "Weft also scores your code quality, and Weft's scout keeps your code clean."],
      [24.3, 34.2, "Weft comes with BlastCP built in, so you can easily connect all your social accounts, make images, video and voice for your posts, and build in public."],
      [35, 41.5, "Share your Wefter Profile, and show the world what you ship."],
      [42.3, 49.6, "Weft is open source. If something is broken, or you want to add a feature, please feel free to make a pullrequest."],
      [50.3, 53.5, "Now let's get started."],
    ],
  },

  // The welcome's later steps: one line each, played as the step opens (components/WelcomeDialog.tsx), not looped.
  projects: { lines: [[0, 4, "Allow Weft to see your projects."]] },
  first: { lines: [[0, 4, "Now start a new thread."]] },
};

const root = resolve(import.meta.dirname, "..");
await narrate(NARRATION, (page) => join(root, "public", "welcome", `narration-${page}.m4a`));
