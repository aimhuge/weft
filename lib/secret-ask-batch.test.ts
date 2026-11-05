import { describe, expect, it } from "vitest";
import { addedMessage, addLabel, answeredBy, isFilled } from "./secret-ask-batch";

const ask = { folder: "/dev/web", name: "R2_ACCESS_KEY_ID", environment: "development" as const };

describe("secret ask batch", () => {
  it("counts a field filled only with a value and an environment", () => {
    expect(isFilled({ ask, value: "x", environments: ["development"] })).toBe(true);
    expect(isFilled({ ask, value: "", environments: ["development"] })).toBe(false);
    expect(isFilled({ ask, value: "x", environments: [] })).toBe(false);
  });

  it("answers a repeated ask for the same key and environment", () => {
    const field = { ask, value: "", environments: [ask.environment] };
    expect(answeredBy(field, { folder: "/dev/web", name: ask.name, environments: ["development", "production"] })).toBe(true);
    expect(answeredBy(field, { folder: "/dev/web", name: ask.name, environments: ["production"] })).toBe(false);
    expect(answeredBy(field, { folder: "/dev/api", name: ask.name, environments: ["development"] })).toBe(false);
    expect(answeredBy(field, { folder: "/dev/web", name: "OTHER", environments: ["development"] })).toBe(false);
  });

  it("tells the thread every key and its environments in one line", () => {
    expect(addedMessage([{ name: "A", environments: ["preview", "production"] }])).toBe("I added A (preview, production) to the 🔐 vault.");
    expect(addedMessage([{ name: "A", environments: ["development"] }, { name: "B", environments: ["production"] }])).toBe(
      "I added A (development), B (production) to the 🔐 vault.",
    );
  });

  it("labels Add by key count, then by environments", () => {
    expect(addLabel(3, 1)).toBe("Add 3 keys to vault");
    expect(addLabel(1, 2)).toBe("Add to 2 environments");
    expect(addLabel(0, 1)).toBe("Add to vault");
  });
});
