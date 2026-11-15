import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installPageKit, KIT_SRC } from "./page-kit";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));

describe("installPageKit", () => {
  it("copies the kit and writes its rules, skips a missing file and rewrites only what changed", () => {
    const src = tmp();
    const dest = path.join(tmp(), "_kit");
    fs.writeFileSync(path.join(src, "research.css"), "a{}");
    fs.writeFileSync(path.join(src, "research.js"), "1");
    installPageKit(src, dest);
    expect(fs.readFileSync(path.join(dest, "research.css"), "utf8")).toBe("a{}");
    expect(fs.readFileSync(path.join(dest, "README.md"), "utf8")).toContain("Living pages");
    const js = path.join(dest, "research.js");
    fs.utimesSync(js, 0, 0);
    installPageKit(src, dest);
    expect(fs.statSync(js).mtimeMs).toBe(0);
    fs.writeFileSync(path.join(src, "research.js"), "2");
    installPageKit(src, dest);
    expect(fs.readFileSync(js, "utf8")).toBe("2");
  });

  it("ships the kit's two files in the plugin", () => {
    for (const name of ["research.css", "research.js"]) expect(fs.existsSync(path.join(KIT_SRC, name))).toBe(true);
  });

  it("never throws when it can't write", () => {
    const file = path.join(tmp(), "a-file");
    fs.writeFileSync(file, "");
    expect(() => installPageKit(KIT_SRC, path.join(file, "_kit"))).not.toThrow();
  });
});
