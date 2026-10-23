import { describe, expect, it } from "vitest";
import { filterProjects, folderName, plural, shortPath, statusLabel } from "./project-bar";
import type { ProjectSummary } from "./board-view";

describe("folderName", () => {
  it("returns the last path segment", () => {
    expect(folderName("/Users/me/dev/app")).toBe("app");
  });

  it("ignores trailing slashes", () => {
    expect(folderName("/Users/me/dev/app/")).toBe("app");
    expect(folderName("/Users/me/dev/app///")).toBe("app");
  });

  it("returns the input unchanged when there is no slash", () => {
    expect(folderName("app")).toBe("app");
    expect(folderName("")).toBe("");
  });
});

describe("shortPath", () => {
  it("replaces the home prefix with ~", () => {
    expect(shortPath("/Users/me/dev/app", "/Users/me")).toBe("~/dev/app");
  });

  it("leaves the path alone when the home doesn't match", () => {
    expect(shortPath("/other/dev/app", "/Users/me")).toBe("/other/dev/app");
  });

  it("leaves an empty home out", () => {
    expect(shortPath("/Users/me/dev/app", "")).toBe("/Users/me/dev/app");
  });

  it("matches the home exactly, not just by prefix", () => {
    expect(shortPath("/Users/meadow/app", "/Users/me")).toBe("/Users/meadow/app");
  });
});

describe("plural", () => {
  it("uses the singular form for one", () => {
    expect(plural(1, "card", "cards")).toBe("1 card");
  });
  it("uses the plural form otherwise", () => {
    expect(plural(0, "card", "cards")).toBe("0 cards");
    expect(plural(5, "card", "cards")).toBe("5 cards");
  });
});

describe("statusLabel", () => {
  it("names what needs the user and what's running", () => {
    const project: ProjectSummary = { path: "/x", lastActivity: 0, cards: 0, running: 2, needsYou: 1 };
    expect(statusLabel(project)).toBe(", 1 needs you, 2 running");
  });

  it("agrees in number for one need", () => {
    const project: ProjectSummary = { path: "/x", lastActivity: 0, cards: 0, running: 0, needsYou: 1 };
    expect(statusLabel(project)).toBe(", 1 needs you");
  });

  it("is empty when nothing is happening", () => {
    const project: ProjectSummary = { path: "/x", lastActivity: 0, cards: 0, running: 0, needsYou: 0 };
    expect(statusLabel(project)).toBe("");
  });
});

describe("filterProjects", () => {
  const at = (path: string): ProjectSummary => ({ path, lastActivity: 0, cards: 0, running: 0, needsYou: 0 });
  const projects = [at("/Users/me/dev/weft"), at("/Users/me/dev/deckcp"), at("/Users/me"), at("/opt/other")];

  it("matches the folder name and the ~ path, not the home prefix", () => {
    expect(filterProjects(projects, "deck", "/Users/me").map((p) => p.path)).toEqual(["/Users/me/dev/deckcp"]);
    expect(filterProjects(projects, "me", "/Users/me").map((p) => p.path)).toEqual(["/Users/me"]);
    expect(filterProjects(projects, "dev", "/Users/me")).toHaveLength(2);
    expect(filterProjects(projects, "opt", "/Users/me").map((p) => p.path)).toEqual(["/opt/other"]);
  });

  it("keeps every project for a blank query", () => {
    expect(filterProjects(projects, "", "/Users/me")).toBe(projects);
  });
});
