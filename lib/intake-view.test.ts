import { describe, expect, it } from "vitest";
import { intakeHasWork, intakePrompt } from "./intake-view";
import type { IntakeResult } from "./project-intake";

// lib/intake-view.ts: whether the intake screen has work for the user, and the prompt its thread starts with.

const NONE: IntakeResult = { imported: 0, importedFrom: [], blanks: 0, hooks: 0, tracked: [] };
const details = (over: Partial<NonNullable<IntakeResult["details"]>> = {}) => ({ imported: [], blanks: [], hooks: [], ...over });

describe("intakeHasWork", () => {
  it("is work when there are blanks, webhooks or files to rotate, not when values just moved", () => {
    expect(intakeHasWork({ ...NONE, imported: 2, details: details({ imported: [{ name: "A", file: ".env.local" }] }) })).toBe(false);
    expect(intakeHasWork({ ...NONE, details: details({ blanks: [{ name: "A", source: "x.ts" }] }) })).toBe(true);
    expect(intakeHasWork({ ...NONE, details: details({ hooks: [{ name: "stripe", target: "/api/stripe/webhook" }] }) })).toBe(true);
    expect(intakeHasWork({ ...NONE, tracked: [".env"] })).toBe(true);
    expect(intakeHasWork(NONE)).toBe(false);
  });
});

describe("intakePrompt", () => {
  it("lists every blank, webhook and committed file by name, with what to do about each", () => {
    const prompt = intakePrompt("/dev/shop", {
      ...NONE,
      tracked: [".env", ".env.production"],
      details: details({
        blanks: [
          { name: "STRIPE_SECRET_KEY", source: "your code", hint: "Stripe → API keys: https://dashboard.stripe.com/apikeys (read in lib/pay.ts)" },
          { name: "CRON_SECRET", source: ".env.example" },
        ],
        hooks: [
          { name: "stripe", target: "/api/stripe/webhook", provider: "stripe", events: ["checkout.session.completed"] },
          { name: "shopify", target: "/api/webhooks/shopify" },
        ],
      }),
    });
    expect(prompt).toContain("Weft just took in shop (/dev/shop)");
    expect(prompt).toContain("- STRIPE_SECRET_KEY (from your code): Stripe → API keys: https://dashboard.stripe.com/apikeys (read in lib/pay.ts)");
    expect(prompt).toContain("- CRON_SECRET (from .env.example)\n");
    expect(prompt).toContain("mcp__secrets__set_value");
    expect(prompt).toContain("- stripe: /api/stripe/webhook (signed by stripe), events checkout.session.completed");
    expect(prompt).toContain("- shopify: /api/webhooks/shopify\n");
    expect(prompt).toContain("mcp__webhooks__relay");
    expect(prompt).toContain(".env, .env.production are committed to git");
  });

  it("leaves out the sections with nothing in them", () => {
    const prompt = intakePrompt("/dev/shop", { ...NONE, tracked: [".env"] });
    expect(prompt).toContain(".env is committed to git");
    expect(prompt).not.toContain("🔐 vault, waiting");
    expect(prompt).not.toContain("🪝");
    expect(prompt.endsWith("tell me what's still open at the end.")).toBe(true);
    expect(intakePrompt("/dev/shop", { ...NONE, details: details({ blanks: [{ name: "A_KEY", source: "your code" }] }) })).not.toContain("committed to git");
  });
});
