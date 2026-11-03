// What this Mac last set as a worker's Goose provider and endpoint (electron/worker-goose-set.cjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGooseSetRecord } from "./worker-goose-set.cjs";

const plainStore = () => ({ encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-goose-set-"));

describe("createGooseSetRecord", () => {
  it("has nothing for a worker it never set, then merges each signed change", () => {
    const d = dir();
    const r = createGooseSetRecord({ dir: d, safeStorage: plainStore });
    expect(r.of("w1")).toBeNull();
    r.set("w1", { gooseProviderId: "anthropic" });
    expect(r.of("w1")).toEqual({ providerId: "anthropic", baseUrl: "" });
    r.set("w1", { gooseBaseUrl: "https://a", other: 5 });
    r.set("w2", { gooseProviderId: "openai", gooseBaseUrl: "" });
    expect(r.of("w1")).toEqual({ providerId: "anthropic", baseUrl: "https://a" });
    expect(r.of("w2")).toEqual({ providerId: "openai", baseUrl: "" });
    r.set("w1", null);
    r.set("w1", { gooseProviderId: 3 });
    expect(r.of("w1")).toEqual({ providerId: "anthropic", baseUrl: "https://a" });
    // Sealed at rest, owner-only, and read back by a fresh record (main's restart).
    const file = path.join(d, "vault", "worker-goose.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(createGooseSetRecord({ dir: d, safeStorage: plainStore }).of("w2")).toEqual({ providerId: "openai", baseUrl: "" });
  });

  it("reads a file that won't open, or isn't a record, as nothing set", () => {
    const d = dir();
    const r = createGooseSetRecord({ dir: d, safeStorage: plainStore });
    r.set("w1", { gooseProviderId: "anthropic" });
    const broken = { encryptString: plainStore().encryptString, decryptString: () => "not json" };
    expect(createGooseSetRecord({ dir: d, safeStorage: () => broken }).of("w1")).toBeNull();
    fs.writeFileSync(path.join(d, "vault", "worker-goose.json"), Buffer.from(JSON.stringify([1])).toString("base64"));
    expect(r.of("w1")).toBeNull();
    fs.writeFileSync(path.join(d, "vault", "worker-goose.json"), Buffer.from(JSON.stringify({ w1: "x", w2: {} })).toString("base64"));
    expect(r.of("w1")).toBeNull();
    expect(r.of("w2")).toBeNull();
  });
});
