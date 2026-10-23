import { describe, expect, it } from "vitest";
import { welcomeNote } from "./WelcomeFooter";

describe("welcomeNote", () => {
  it("names where to replay or log in on the first screen", () => {
    expect(welcomeNote("ready", true, "")).toBe("Replay this any time from your avatar's menu or the command palette.");
    expect(welcomeNote("ready", false, "")).toBe("You can log in later from Settings → Accounts.");
  });

  it("explains Start empty on the projects screen", () => {
    expect(welcomeNote("projects", null, "")).toMatch(/^Start empty/);
  });

  it("promises the column tips once a folder is picked on the first thread", () => {
    expect(welcomeNote("first", true, "/dev/app")).toBe("The board explains each column the first time a card reaches it.");
    expect(welcomeNote("first", true, "")).toBe("Pick the folder in the next dialog.");
  });
});
