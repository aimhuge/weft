import { describe, expect, it, vi } from "vitest";
import { importAllFrom, importedText, locateEmptyText } from "./vault-locate";
import type { ImportRow, ImportScan, VaultBridge } from "./vault-view";

const row = (name: string, over: Partial<ImportRow> = {}): ImportRow => ({ file: "../app-build/.env.local", name, environment: "development", status: "new", tail: "", public: false, ticked: true, skipped: false, ...over });
const scanOf = (rows: ImportRow[]): ImportScan => ({ id: "v", label: "App", files: [], rows });

describe("importedText", () => {
  it("counts names and names the files, at most two", () => {
    const scan = scanOf([]);
    expect(importedText(scan, [{ file: "a", name: "X" }])).toBe("Imported 1 secret from a.");
    expect(importedText(scan, [{ file: "a", name: "X" }, { file: "b", name: "Y" }, { file: "b", name: "X" }])).toBe("Imported 2 secrets from a and b.");
    expect(importedText(scan, [{ file: "a", name: "X" }, { file: "b", name: "Y" }, { file: "c", name: "Z" }, { file: "d", name: "W" }])).toBe("Imported 4 secrets from a, b and 2 more.");
  });

  it("says what's left to review, or that nothing was new", () => {
    expect(importedText(scanOf([row("A", { status: "differs" })]), [{ file: "a", name: "X" }])).toBe("Imported 1 secret from a. 1 that differ from the vault are left for Import… to review.");
    expect(importedText(scanOf([]), [])).toBe("Nothing new to import: the vault already holds these values.");
  });
});

describe("importAllFrom", () => {
  it("imports the preview's ticked rows with no preview", async () => {
    const scan = scanOf([row("A"), row("B", { ticked: false })]);
    const importer = vi.fn(() => Promise.resolve({ imported: 1 }));
    const bridge = { scan: vi.fn(() => Promise.resolve(scan)), import: importer } as unknown as VaultBridge;
    expect(await importAllFrom(bridge, "/dev/app")).toBe("Imported 1 secret from ../app-build/.env.local.");
    expect(importer).toHaveBeenCalledWith("/dev/app", [{ file: "../app-build/.env.local", name: "A" }]);
  });

  it("doesn't call import when nothing is ticked", async () => {
    const importer = vi.fn();
    const bridge = { scan: vi.fn(() => Promise.resolve(scanOf([row("A", { ticked: false })]))), import: importer } as unknown as VaultBridge;
    expect(await importAllFrom(bridge, "/dev/app")).toMatch(/^Nothing new/);
    expect(importer).not.toHaveBeenCalled();
  });
});

describe("locateEmptyText", () => {
  it("names the file it didn't keep", () => {
    expect(locateEmptyText("id_rsa")).toBe("id_rsa has no NAME=value lines, so Weft didn't keep it.");
  });
});
