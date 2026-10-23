import { describe, expect, it } from "vitest";
import { beatFrom, LOOP_PATH, loopSrc, stepVoice, voiceFor } from "./welcome-loop";

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

describe("beatFrom", () => {
  it("reads a welcome page's beat", () => {
    expect(beatFrom({ weft: "welcome", beat: "profile" })).toBe("profile");
    expect(beatFrom({ weft: "welcome", beat: "loop" })).toBe("loop");
  });

  it("ignores anything else", () => {
    expect(beatFrom(null)).toBeNull();
    expect(beatFrom("profile")).toBeNull();
    expect(beatFrom({ weft: "other", beat: "profile" })).toBeNull();
    expect(beatFrom({ weft: "welcome", beat: "nope" })).toBeNull();
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
    expect(voiceFor("cta")).toBeNull();
  });
});

describe("stepVoice", () => {
  it("has a line for the projects and first-thread steps only", () => {
    expect(stepVoice("projects")).toBe("/welcome/narration-projects.m4a");
    expect(stepVoice("first")).toBe("/welcome/narration-first.m4a");
    expect(stepVoice("ready")).toBeNull();
  });
});
