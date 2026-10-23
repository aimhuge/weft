import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { anonymousId, setTelemetryOn, telemetryOn } from "./telemetry";

const dirs: string[] = [];
const tempFile = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-telemetry-"));
  dirs.push(dir);
  return path.join(dir, "telemetry.json");
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("telemetryOn / setTelemetryOn", () => {
  it("is on until switched off, and remembers the switch", () => {
    const file = tempFile();
    expect(telemetryOn(file)).toBe(true);
    setTelemetryOn(false, file);
    expect(telemetryOn(file)).toBe(false);
    setTelemetryOn(true, file);
    expect(telemetryOn(file)).toBe(true);
  });

  it("treats an unreadable file as on", () => {
    const file = tempFile();
    fs.writeFileSync(file, "not json");
    expect(telemetryOn(file)).toBe(true);
  });
});

describe("anonymousId", () => {
  it("is a stable one-way hash of the device ID, never the ID itself", () => {
    const device = "b".repeat(64);
    const id = anonymousId(device);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(anonymousId(device)).toBe(id);
    expect(device).not.toContain(id);
    expect(anonymousId("c".repeat(64))).not.toBe(id);
  });
});
