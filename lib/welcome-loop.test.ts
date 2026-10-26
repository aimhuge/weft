import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BEAT_SCENES, BEAT_TITLES, BEATS, beatMessage, goMessage, keysStart, LOOP_PATH, loopSrc, pageOf, pageVoice, SCENE_SECONDS, SCENE_STARTS, stepBeat, stepVoice, voiceFor } from "./welcome-loop";

describe("loopSrc", () => {
  it("plays the tour live with no names when there are no projects", () => {
    expect(loopSrc([])).toBe(`${LOOP_PATH}?live=1&tour=1`);
  });

  it("puts the first three project names on the cards", () => {
    const url = new URL(loopSrc(["weft", "deckcp", "site", "extra"]), "http://x");
    expect(url.searchParams.get("live")).toBe("1");
    expect(url.searchParams.get("tour")).toBe("1");
    expect(url.searchParams.get("p")).toBe("weft,deckcp,site");
  });

  it("drops blanks and keeps a comma in a name from splitting it", () => {
    const url = new URL(loopSrc(["  ", "a,b", "c"]), "http://x");
    expect(url.searchParams.get("p")).toBe("a b,c");
  });
});

describe("beatMessage", () => {
  it("reads a welcome page's beat, its time and whether it jumped there", () => {
    expect(beatMessage({ weft: "welcome", beat: "profile", t: 36.2, jumped: true })).toEqual({ beat: "profile", t: 36.2, jumped: true });
    expect(beatMessage({ weft: "welcome", beat: "loop" })).toEqual({ beat: "loop", t: 0, jumped: false });
    expect(beatMessage({ weft: "welcome", beat: "loop", t: -3, jumped: "yes" })).toEqual({ beat: "loop", t: 0, jumped: false });
  });

  it("ignores anything else", () => {
    expect(beatMessage(null)).toBeNull();
    expect(beatMessage("profile")).toBeNull();
    expect(beatMessage({ weft: "other", beat: "profile" })).toBeNull();
    expect(beatMessage({ weft: "welcome", beat: "nope" })).toBeNull();
  });
});

describe("the tour's order", () => {
  it("runs build → ship → show, with a title for every beat", () => {
    expect(BEATS).toEqual(["intro", "loop", "tools", "vault", "pane", "quality", "blastcp", "profile", "opensource", "keys"]);
    expect(BEATS.every((b) => BEAT_TITLES[b].length > 0)).toBe(true);
  });

  it("steps a beat at a time, and stops at either end", () => {
    expect(stepBeat("tools", 1)).toBe("vault");
    expect(stepBeat("tools", -1)).toBe("loop");
    expect(stepBeat("intro", -1)).toBeNull();
    expect(stepBeat("keys", 1)).toBeNull();
  });

  it("knows each beat's page, its voiceover, and the message that jumps there", () => {
    expect(pageOf("intro")).toBe("intro");
    expect(pageOf("loop")).toBe("loop");
    expect(pageOf("blastcp")).toBe("beats");
    expect(pageVoice("profile")).toBe("/welcome/narration-beats.m4a");
    expect(goMessage("loop")).toEqual({ weft: "go", beat: "loop", page: "loop.html" });
    expect(goMessage("opensource")).toEqual({ weft: "go", beat: "opensource", page: "beats.html" });
  });
});

describe("voiceFor", () => {
  it("starts each page's voiceover on its first beat, and nothing mid-page", () => {
    expect(LOOP_PATH).toBe("/welcome/intro.html");
    expect(voiceFor("intro")).toBe("/welcome/narration-intro.m4a");
    expect(voiceFor("loop")).toBe("/welcome/narration-loop.m4a");
    expect(voiceFor("tools")).toBe("/welcome/narration-beats.m4a");
    expect(voiceFor("profile")).toBeNull();
    expect(voiceFor("quality")).toBeNull();
    expect(voiceFor("blastcp")).toBeNull();
    expect(voiceFor("opensource")).toBeNull();
    expect(voiceFor("keys")).toBeNull();
  });
});

describe("stepVoice", () => {
  it("has a line for the projects and first-thread steps only", () => {
    expect(stepVoice("projects")).toBe("/welcome/narration-projects.m4a");
    expect(stepVoice("first")).toBe("/welcome/narration-first.m4a");
    expect(stepVoice("ready")).toBeNull();
  });
});

describe("the beats page's scenes", () => {
  // The page (public/welcome/beats.html) draws its scenes from its own SCENES list; lib/welcome-scenes.ts is
  // the one list the tour, the narration and the render script read. This pins the two together, so a scene added
  // to one and forgotten in the other fails here rather than in the rendered video.
  const html = readFileSync(join(__dirname, "..", "public", "welcome", "beats.html"), "utf8");
  const pageScenes = [...html.slice(html.indexOf("var SCENES")).matchAll(/\["(\w+)", "(#\w+)", ([\d.]+)/g)].map((m) => ({
    beat: m[1],
    element: m[2],
    seconds: Number(m[3]),
  }));

  it("are the page's own scenes, in the same order and with the same lengths", () => {
    expect(pageScenes).toEqual(BEAT_SCENES.map((scene) => ({ beat: scene.beat, element: scene.element, seconds: scene.seconds })));
  });

  it("are the tour's beats after the two pages of their own", () => {
    expect(BEATS).toEqual(["intro", "loop", ...BEAT_SCENES.map((scene) => scene.beat)]);
  });

  it("start where the scenes before them end", () => {
    expect(SCENE_STARTS.tools).toBe(0);
    expect(SCENE_STARTS.vault).toBe(5);
    expect(SCENE_STARTS.pane).toBe(10.8);
    expect(SCENE_STARTS.keys).toBe(51);
    expect(SCENE_SECONDS).toBe(68.4);
  });

  it("put the keyboard shortcuts where the tour video cuts them", () => {
    expect(keysStart()).toBe(51);
  });
});
