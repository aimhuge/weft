import { describe, expect, it } from "vitest";
import { agentReady, cliMissing, trialState, type CliStatuses } from "./welcome-trial";

const OUT = { loggedIn: false };
const IN = { loggedIn: true };
const nobody: CliStatuses = { claude: OUT, puku: OUT, codex: OUT };

describe("cliMissing", () => {
  it("tells a CLI that isn't there from one that's logged out", () => {
    expect(cliMissing({ loggedIn: false, error: "spawn puku-cli ENOENT" })).toBe(true);
    expect(cliMissing({ loggedIn: false, error: "command not found" })).toBe(true);
    expect(cliMissing({ loggedIn: false, error: "token expired" })).toBe(false);
    expect(cliMissing(OUT)).toBe(false);
    expect(cliMissing(undefined)).toBe(false);
  });
});

describe("trialState", () => {
  it("stays quiet when you're signed out, so a new user isn't pushed to sign up", () => {
    expect(trialState(nobody, false)).toBe("none");
  });

  it("runs puku on the trial once you're signed in, whatever else is ready", () => {
    expect(trialState(nobody, true)).toBe("on");
    expect(trialState({ ...nobody, claude: IN }, true)).toBe("on");
  });

  it("stays out of the way when another agent is ready and you're signed out", () => {
    expect(trialState({ ...nobody, codex: IN }, false)).toBe("none");
  });

  it("is never the story when puku-cli has its own login or isn't there", () => {
    expect(trialState({ ...nobody, puku: IN }, false)).toBe("none");
    expect(trialState({ ...nobody, puku: { loggedIn: false, error: "ENOENT" } }, false)).toBe("none");
    expect(trialState({ claude: OUT }, false)).toBe("none");
  });

  it("guesses nothing while the logins or the account are still loading", () => {
    expect(trialState(null, false)).toBe("none");
    expect(trialState(nobody, null)).toBe("none");
  });
});

describe("agentReady", () => {
  it("is ready with a logged-in agent or the trial on, and null until the logins are read", () => {
    expect(agentReady(null, "none")).toBeNull();
    expect(agentReady(nobody, "none")).toBe(false);
    expect(agentReady(nobody, "on")).toBe(true);
    expect(agentReady({ ...nobody, claude: IN }, "none")).toBe(true);
  });
});
