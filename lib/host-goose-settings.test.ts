import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { load, settingsDir, withSettingsDir } from "./settings.harness";

// Goose's provider and endpoint on a worker: checked whole, then saved; a bad one saves nothing.
withSettingsDir();

async function loadGoose() {
  await load();
  return import("./host-goose-settings");
}

const onDisk = () => {
  const file = path.join(settingsDir.path, "settings.json");
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {};
};

describe("Goose settings on a host", () => {
  it("reads the pair, empty by default", async () => {
    const goose = await loadGoose();
    expect(goose.gooseHostSettings()).toEqual({ gooseProviderId: "", gooseBaseUrl: "" });
  });

  it("saves a known provider and an http(s) endpoint, and clears them with \"\"", async () => {
    const goose = await loadGoose();
    goose.applyGooseSettings({ gooseProviderId: "litellm", gooseBaseUrl: " http://proxy.lan:4000 " });
    expect(goose.gooseHostSettings()).toEqual({ gooseProviderId: "litellm", gooseBaseUrl: "http://proxy.lan:4000" });
    goose.applyGooseSettings({ gooseBaseUrl: "https://gw.example.com/v1" });
    expect(goose.gooseHostSettings().gooseBaseUrl).toBe("https://gw.example.com/v1");
    goose.applyGooseSettings({ gooseProviderId: "", gooseBaseUrl: "" });
    expect(goose.gooseHostSettings()).toEqual({ gooseProviderId: "", gooseBaseUrl: "" });
    goose.applyGooseSettings({});
    expect(onDisk().gooseProviderId).toBeUndefined();
  });

  it("refuses an unknown provider or a bad endpoint, and saves neither field", async () => {
    const goose = await loadGoose();
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ gooseProviderId: "nope", gooseBaseUrl: "https://x.example" }, /doesn't know that provider/],
      [{ gooseProviderId: 3 }, /doesn't know that provider/],
      [{ gooseProviderId: "openai", gooseBaseUrl: "not a url" }, /web address/],
      [{ gooseBaseUrl: 5 }, /web address/],
      [{ gooseBaseUrl: `https://x.example/${"a".repeat(600)}` }, /web address/],
      [{ gooseBaseUrl: "file:///etc/passwd" }, /https:\/\/ or http:\/\//],
      [{ gooseBaseUrl: "https://user:sk-123@x.example" }, /Leave the key out/],
    ];
    for (const [fields, why] of bad) expect(() => goose.applyGooseSettings(fields)).toThrow(why);
    expect(goose.gooseHostSettings()).toEqual({ gooseProviderId: "", gooseBaseUrl: "" });
  });
});
