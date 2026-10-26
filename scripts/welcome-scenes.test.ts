import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCENES } from "../lib/welcome-scenes";

// The welcome tour's scenes (lib/welcome-scenes.ts) are the one list the tour, the narration and the render
// script read. These check the two scripts still read it: the render script cuts the tour video at the keyboard
// shortcuts, and the narration times its lines against the scenes.

const root = path.join(__dirname, "..");
const scenes = SCENES;

const sceneStart = (beat: string) => Math.round(scenes.slice(0, scenes.findIndex((s) => s.beat === beat)).reduce((n, s) => n + s.seconds, 0) * 100) / 100;
const at = (beat: string, offset: number) => Math.round((sceneStart(beat) + offset) * 100) / 100;

describe("the scenes the scripts read", () => {
  it("are the ones lib/welcome-loop.ts reads", () => {
    const source = fs.readFileSync(path.join(root, "lib", "welcome-loop.ts"), "utf8");
    // The app imports it without an extension: Turbopack resolves the plain name, and TypeScript
    // refuses an explicit ".mts" extension in an import (TS5097).
    expect(source).toContain('from "./welcome-scenes"');
    for (const script of ["render-welcome-loop.mjs", "narrate-welcome.mjs"]) {
      const code = fs.readFileSync(path.join(root, "scripts", script), "utf8");
      expect(code).toContain("welcome-scenes.ts");
      expect(code).toMatch(/import \{ SCENES \} from "\.\.\/lib\/welcome-scenes\.ts"/);
    }
  });

  it("cut the tour video at the keyboard shortcuts", () => {
    // scripts/render-welcome-loop.mjs sums the scenes before "keys": 5 + 5.8 + 11.9 + 5.6 + 10.3 + 4.6 + 7.8.
    const atKeys = sceneStart("keys");
    expect(atKeys).toBe(51);
  });
});

describe("the narration's lines against the scenes", () => {
  // The beats track's lines are written against a scene, so their times follow the scenes when one grows. These are
  // the times the shipped narration-beats.words.json holds: the same, to the hundredth.
  const shipped = JSON.parse(fs.readFileSync(path.join(root, "public", "welcome", "narration-beats.words.json"), "utf8")) as {
    duration: number;
    lines: [number, number, string][];
  };

  const lines: [string, number, number, string][] = [
    ["tools", 0.5, 4.8, "Connect your tools to Weft, so your threads can use them."],
    ["vault", 0.5, 5.6, "Your vault stores your credentials and lets your AI securely use them."],
    ["pane", 0.2, 11.7, "Panes aren't just previews. They can use keys in your vault to connect to your database or APIs, so sharing a secure live dashboard, mini-app or game is just a few clicks away."],
    ["quality", 0.2, 5.4, "Weft also scores your code quality, and Weft's scout keeps your code clean."],
    ["blastcp", 0.2, 10.1, "Weft comes with BlastCP built in, so you can easily connect all your social accounts, make images, video and voice for your posts, and build in public."],
    ["profile", 0.2, 4.4, "Share your Wefter Profile, and show the world what you ship."],
    ["opensource", 0.2, 7.6, "Weft is open source. If something is broken, or you want to add a feature, please feel free to make a pullrequest."],
    ["keys", 0.4, 3.2, "Weft is driven by keyboard shortcuts."],
    ["keys", 3.3, 7.6, "Double-click the board or hit Command N to start a new thread."],
    ["keys", 7.8, 9.8, "Press Escape to close it."],
    ["keys", 10, 13.8, "Hit Command K to open the search and action HUD."],
    ["keys", 14, 16.9, "And hit question mark for the shortcut list."],
  ];

  it("say what the shipped track says, at the same times", () => {
    expect(lines.map(([scene, cue, end, text]) => [at(scene, cue), at(scene, end), text])).toEqual(shipped.lines);
  });

  it("run for as long as the scenes together", () => {
    expect(scenes.reduce((n, s) => n + s.seconds, 0)).toBe(shipped.duration);
  });
});
