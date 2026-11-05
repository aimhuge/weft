import { afterEach, describe, expect, it } from "vitest";
import { forgetTrail, labelFor, noteSnapshot, noteUrl, recordServed, recordStep, takeTrail, wasServed } from "./site-notes-trail";

// The trail is per-card and in memory: every test uses its own card id so no trail leaks into another.
let nextCard = 0;
const card = () => `trail-card-${++nextCard}`;

const after: string[] = [];
const useCard = () => {
  const id = card();
  after.push(id);
  return id;
};

afterEach(() => {
  for (const id of after.splice(0)) forgetTrail(id);
});

const SNAPSHOT = [
  "URL: https://example.com/login",
  "- textbox \"Email\" [ref=e14]: \"me@x.com\"",
  "- button \"Sign in\" [ref=e15]",
  "- link \"Home\" [ref=e16]",
].join("\n");

describe("noteUrl", () => {
  it("keeps the page the card is on", () => {
    const id = useCard();
    noteUrl(id, "https://example.com/login");
    noteUrl(id, "https://example.com/settings");
    expect(takeTrail(id).steps).toEqual([]);
    recordStep(id, "snapshot", {}, true);
    expect(takeTrail(id).steps[0]?.url).toBe("https://example.com/settings");
  });

  it("ignores a missing card id or an empty url", () => {
    expect(() => noteUrl(undefined, "https://example.com")).not.toThrow();
    expect(() => noteUrl("", "https://example.com")).not.toThrow();
    const id = useCard();
    noteUrl(id, "");
    recordStep(id, "snapshot", {}, true);
    expect(takeTrail(id).steps[0]?.url).toBeUndefined();
  });
});

describe("noteSnapshot", () => {
  it("takes the url out of the snapshot and stores the snapshot", () => {
    const id = useCard();
    noteSnapshot(id, SNAPSHOT);
    recordStep(id, "click", { ref: "e15" }, true);
    const taken = takeTrail(id);
    expect(taken.steps[0]?.url).toBe("https://example.com/login");
    expect(taken.steps[0]?.target).toBe('button "Sign in"');
  });

  it("leaves the url alone when the snapshot has none", () => {
    const id = useCard();
    noteUrl(id, "https://example.com/kept");
    noteSnapshot(id, "- textbox \"Email\" [ref=e14]");
    recordStep(id, "snapshot", {}, true);
    expect(takeTrail(id).steps[0]?.url).toBe("https://example.com/kept");
  });

  it("ignores a missing card id", () => {
    expect(() => noteSnapshot(undefined, SNAPSHOT)).not.toThrow();
  });
});

describe("labelFor", () => {
  it("is the role and label of the element, without its value", () => {
    expect(labelFor(SNAPSHOT, "e14")).toBe('textbox "Email"');
    expect(labelFor(SNAPSHOT, "e15")).toBe('button "Sign in"');
    expect(labelFor(SNAPSHOT, "e16")).toBe('link "Home"');
  });

  it("is undefined without a snapshot, or without the ref in it", () => {
    expect(labelFor(undefined, "e14")).toBeUndefined();
    expect(labelFor("", "e14")).toBeUndefined();
    expect(labelFor(SNAPSHOT, "e99")).toBeUndefined();
  });

  it("cuts a label longer than 100 characters to 99 plus an ellipsis", () => {
    const long = `textbox "${"L".repeat(200)}" [ref=e30]`;
    const label = labelFor(long, "e30");
    expect(label?.endsWith("…")).toBe(true);
    expect(label?.length).toBe(100);
  });

  it("is undefined when the line before the ref has nothing on it", () => {
    expect(labelFor("[ref=e40]", "e40")).toBeUndefined();
  });
});

describe("recordStep", () => {
  it("names the target by its ref's label, then by selector, then by the ref itself", () => {
    const id = useCard();
    noteSnapshot(id, SNAPSHOT);
    recordStep(id, "click", { ref: "e15" }, true);
    recordStep(id, "click", { ref: "e15", selector: "#sign-in" }, true);
    recordStep(id, "click", { selector: "#sign-in" }, true);
    recordStep(id, "click", { ref: "e99" }, true);
    recordStep(id, "click", {}, true);
    const steps = takeTrail(id).steps;
    expect(steps[0]?.target).toBe('button "Sign in"');
    expect(steps[1]?.target).toBe('button "Sign in"');
    expect(steps[2]?.target).toBe("#sign-in");
    expect(steps[3]?.target).toBe("e99");
    expect(steps[4]?.target).toBeUndefined();
  });

  it("describes what each tool did, without the value typed", () => {
    const id = useCard();
    recordStep(id, "type_text", { text: "me@example.com" }, true);
    recordStep(id, "type_text", { text: "me@example.com", submit: true }, true);
    recordStep(id, "type_text", {}, true);
    recordStep(id, "press_key", { keys: "Enter" }, true);
    recordStep(id, "press_key", {}, true);
    recordStep(id, "select_option", { values: ["a", "b"] }, true);
    recordStep(id, "select_option", {}, true);
    recordStep(id, "fill_field", { selector: "#secret" }, true);
    recordStep(id, "scroll", { direction: "down" }, true);
    recordStep(id, "screenshot", {}, true);
    const steps = takeTrail(id).steps;
    expect(steps[0]?.detail).toBe("typed 14 characters");
    expect(steps[1]?.detail).toBe("typed 14 characters and pressed Enter");
    expect(steps[2]?.detail).toBe("typed 0 characters");
    expect(steps[3]?.detail).toBe("Enter");
    expect(steps[4]?.detail).toBeUndefined();
    expect(steps[5]?.detail).toBe("chose 2 option(s)");
    expect(steps[6]?.detail).toBe("chose 0 option(s)");
    expect(steps[7]?.detail).toBe("filled from the vault");
    expect(steps[8]?.detail).toBe("down");
    expect(steps[9]?.detail).toBeUndefined();
  });

  it("keeps the error, cut to 200 characters", () => {
    const id = useCard();
    recordStep(id, "click", { ref: "e15" }, false, "E".repeat(300));
    const step = takeTrail(id).steps[0];
    expect(step?.ok).toBe(false);
    expect(step?.error?.length).toBe(200);
  });

  it("ignores a missing card id", () => {
    expect(() => recordStep(undefined, "click", { ref: "e15" }, true)).not.toThrow();
  });

  it("keeps only the last 80 steps", () => {
    const id = useCard();
    for (let i = 0; i < 90; i++) recordStep(id, "click", { ref: `e${i}` }, true);
    const steps = takeTrail(id).steps;
    expect(steps).toHaveLength(80);
    expect(steps[0]?.target).toBe("e10");
    expect(steps[79]?.target).toBe("e89");
  });
});

describe("recordServed / wasServed", () => {
  it("remembers what a card was served, once per host, path and source", () => {
    const id = useCard();
    recordServed(id, { host: "example.com", path: "/login", source: "local" });
    recordServed(id, { host: "example.com", path: "/login", source: "local" });
    recordServed(id, { host: "example.com", path: "/login", source: "team" });
    recordServed(id, { host: "example.com", path: "/other", source: "local" });
    expect(takeTrail(id).served).toEqual([
      { host: "example.com", path: "/login", source: "local" },
      { host: "example.com", path: "/login", source: "team" },
      { host: "example.com", path: "/other", source: "local" },
    ]);
  });

  it("says whether a host and path were served", () => {
    const id = useCard();
    recordServed(id, { host: "example.com", path: "/login", source: "local" });
    expect(wasServed(id, "example.com", "/login")).toBe(true);
    expect(wasServed(id, "example.com", "/other")).toBe(false);
    expect(wasServed(id, "other.com", "/login")).toBe(false);
  });

  it("says no for a missing card id or a card with no trail", () => {
    expect(wasServed(undefined, "example.com", "/login")).toBe(false);
    expect(wasServed("trail-card-never-used", "example.com", "/login")).toBe(false);
    expect(() => recordServed(undefined, { host: "example.com", path: "/login", source: "local" })).not.toThrow();
  });
});

describe("takeTrail", () => {
  it("hands over the turn's steps and served pages, and clears them", () => {
    const id = useCard();
    noteUrl(id, "https://example.com/login");
    noteSnapshot(id, SNAPSHOT);
    recordStep(id, "click", { ref: "e15" }, true);
    recordServed(id, { host: "example.com", path: "/login", source: "local" });

    const taken = takeTrail(id);
    expect(taken.steps).toHaveLength(1);
    expect(taken.served).toHaveLength(1);

    const after = takeTrail(id);
    expect(after.steps).toEqual([]);
    expect(after.served).toEqual([]);
  });

  it("carries the page and the snapshot into the next turn", () => {
    const id = useCard();
    noteUrl(id, "https://example.com/login");
    noteSnapshot(id, SNAPSHOT);
    takeTrail(id);

    recordStep(id, "click", { ref: "e15" }, true);
    const steps = takeTrail(id).steps;
    expect(steps[0]?.url).toBe("https://example.com/login");
    expect(steps[0]?.target).toBe('button "Sign in"');
  });

  it("is empty for a card with no trail", () => {
    expect(takeTrail("trail-card-never-used")).toEqual({ steps: [], served: [] });
  });
});

describe("forgetTrail", () => {
  it("drops the card's trail", () => {
    const id = useCard();
    recordStep(id, "click", { ref: "e15" }, true);
    forgetTrail(id);
    expect(takeTrail(id)).toEqual({ steps: [], served: [] });
  });
});
