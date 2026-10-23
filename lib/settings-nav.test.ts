import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES, pageInfo, rememberPage, rememberedPage, settingsScene, unsavedPages } from "./settings-nav";

const none = { prompt: false, keepAlive: false, mode: false, backend: false, rules: false };

describe("settings nav", () => {
  it("lists each page once", () => {
    const ids = SETTINGS_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pageInfo("models").label).toBe("Models");
    expect(pageInfo("team").label).toBe("Teams");
  });

  it("marks the pages with unsaved edits", () => {
    expect(unsavedPages(none).size).toBe(0);
    expect([...unsavedPages({ ...none, backend: true })]).toEqual(["models"]);
    expect([...unsavedPages({ ...none, mode: true })]).toEqual(["security"]);
    expect([...unsavedPages({ ...none, keepAlive: true })]).toEqual(["threads"]);
    expect([...unsavedPages({ ...none, prompt: true, rules: true })]).toEqual(["threads", "automations"]);
  });

  it("puts your scene behind Settings, else one that suits the palette", () => {
    expect(settingsScene("canyon", "dark").id).toBe("canyon");
    expect(settingsScene("", "dark").id).toBe("twin-suns");
    expect(settingsScene("", "light").id).toBe("salt-flats");
  });

  it("remembers the last page", () => {
    expect(rememberedPage()).toBe("general");
    rememberPage("models");
    expect(rememberedPage()).toBe("models");
  });
});
