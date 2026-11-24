import { describe, expect, it } from "vitest";
import { SENDS_HOME } from "./home-sends-home";
import { ONBOARDING_EVENTS } from "./telemetry-events";

// lib/home-sends-home.ts: the home page's promise about analytics. These pin it to the code that keeps it.
describe("SENDS_HOME", () => {
  it("names the desktop's daily ping and first-card/first-Done counts, which the allow-list really sends", () => {
    const counts = SENDS_HOME.items.find((i) => i.what.startsWith("A few anonymous counts"));
    expect(counts?.detail).toMatch(/first card.*first Done.*one ping a day/);
    expect(Object.keys(ONBOARDING_EVENTS)).toEqual(
      expect.arrayContaining(["activation_first_card", "activation_first_done", "desktop_active_day"]),
    );
  });

  it("never lets the allow-list carry a prompt, path, project name or email", () => {
    const props = Object.values(ONBOARDING_EVENTS).flat() as string[];
    for (const banned of ["prompt", "path", "project", "project_name", "email", "cwd"]) expect(props).not.toContain(banned);
  });

  it("says where to switch the counts off and links the privacy policy", () => {
    expect(SENDS_HOME.items.some((i) => i.detail.includes("Settings → Security"))).toBe(true);
    expect(SENDS_HOME.privacy.href).toBe("/privacy");
  });
});
