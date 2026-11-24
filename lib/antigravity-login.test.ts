import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_INSTALL,
  antigravityAuthMode,
  antigravityBin,
  antigravityLoginCommand,
  antigravityWarning,
  parseAntigravityStatus,
} from "./antigravity-login";
import { GOOGLE_ACCOUNT_WARNING } from "./antigravity-warning";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "agy-home-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function settings(content: string) {
  const dir = path.join(home, ".gemini", "antigravity-cli");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), content);
}

describe("antigravityBin", () => {
  it("takes agy from PATH first", () => {
    expect(antigravityBin(home, () => "/opt/bin/agy")).toBe("/opt/bin/agy");
  });

  it("falls back to ~/.local/bin/agy, where Google's installer puts it", () => {
    const local = path.join(home, ".local", "bin");
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, "agy"), "");
    expect(antigravityBin(home, () => null)).toBe(path.join(local, "agy"));
  });

  it("is null when agy is in neither", () => {
    expect(antigravityBin(home, () => null)).toBeNull();
  });

  it("looks on the real PATH by default", () => {
    expect(antigravityBin(home) === null || typeof antigravityBin(home) === "string").toBe(true);
  });
});

describe("antigravityLoginCommand", () => {
  it("signs in with the agy it was given", () => {
    expect(antigravityLoginCommand("'/x/agy'")).toBe("'/x/agy' acp --login");
  });

  it("installs agy first when there's none, then runs the installer's copy", () => {
    expect(antigravityLoginCommand()).toBe(`${ANTIGRAVITY_INSTALL} && ~/.local/bin/agy acp --login`);
  });
});

describe("parseAntigravityStatus", () => {
  const usage = JSON.stringify({
    conversation_id: "",
    status: "SUCCESS",
    response: "Gemini Models\tWeekly Limit Remaining\t100%",
    command: { name: "usage", data: { groups: [{ name: "Gemini Models", buckets: [{ id: "gemini-weekly", window: "weekly", remaining_fraction: 0.995 }] }] } },
  });

  it("reads SUCCESS as signed in, past any noise around the JSON", () => {
    expect(parseAntigravityStatus(`starting…\n${usage}\n`, "")).toEqual({ loggedIn: true });
  });

  it.each([
    ["stderr", "", "Error: authentication required"],
    ["a JSON error", JSON.stringify({ status: "ERROR", error: "Authentication required: run agy" }), ""],
  ])("reads an auth error in %s as signed out", (_where, stdout, stderr) => {
    expect(parseAntigravityStatus(stdout, stderr)).toEqual({ loggedIn: false });
  });

  it.each([
    ["nothing", "", ""],
    ["broken JSON", "{status: SUCCESS}", ""],
    ["no status", "{}", ""],
    ["another error", JSON.stringify({ status: "ERROR", error: "network down" }), "timeout"],
  ])("says nothing for %s", (_name, stdout, stderr) => {
    expect(parseAntigravityStatus(stdout, stderr)).toBeNull();
  });
});

describe("antigravityAuthMode", () => {
  it("is api-key when agy's settings name the gemini provider", () => {
    settings(JSON.stringify({ modelProvider: "gemini" }));
    expect(antigravityAuthMode(home, {})).toBe("api-key");
  });

  it("is cloud when AGY_ADC_AUTH is on", () => {
    settings(JSON.stringify({ modelProvider: "google" }));
    expect(antigravityAuthMode(home, { AGY_ADC_AUTH: "true" })).toBe("cloud");
  });

  it.each([
    ["no settings file", null],
    ["unreadable JSON", "{"],
    ["a JSON null", "null"],
    ["no provider", "{}"],
  ])("is a Google account with %s", (_name, content) => {
    if (content !== null) settings(content);
    expect(antigravityAuthMode(home, { AGY_ADC_AUTH: "false" })).toBe("google-account");
  });

  it("reads the real home and env by default", () => {
    expect(["api-key", "cloud", "google-account"]).toContain(antigravityAuthMode());
  });
});

describe("antigravityWarning", () => {
  it("warns only for a Google-account sign-in", () => {
    expect(antigravityWarning("google-account")).toBe(GOOGLE_ACCOUNT_WARNING);
    expect(GOOGLE_ACCOUNT_WARNING).toContain("can get the account suspended");
    expect(antigravityWarning("api-key")).toBeUndefined();
    expect(antigravityWarning("cloud")).toBeUndefined();
  });
});
