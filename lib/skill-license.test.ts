import { describe, expect, it } from "vitest";
import { licenseFinding, readLicense } from "./skill-license";
import type { SkillFile } from "./types";

// Which terms a skill comes under (lib/skill-license.ts): its LICENSE file, else SKILL.md's frontmatter.

const file = (path: string, contents: string): SkillFile => ({ path, contents });
const skillMd = (front: string) => file("SKILL.md", `---\nname: x\n${front}\n---\n\n# x\n`);

describe("readLicense", () => {
  it.each([
    ["GNU AFFERO GENERAL PUBLIC LICENSE Version 3", "AGPL-3.0", "copyleft"],
    ["GNU LESSER GENERAL PUBLIC LICENSE Version 2.1", "LGPL", "copyleft"],
    ["GNU GENERAL PUBLIC LICENSE Version 3", "GPL", "copyleft"],
    ["Mozilla Public License Version 2.0", "MPL-2.0", "copyleft"],
    ["Creative Commons Attribution-NonCommercial 4.0", "CC-BY-NC", "noncommercial"],
    ["CC0 1.0 Universal", "CC0-1.0", "permissive"],
    ["Apache License\nVersion 2.0, January 2004", "Apache-2.0", "permissive"],
    ["Permission is hereby granted, free of charge, to any person", "MIT", "permissive"],
    ["ISC License\n\nCopyright (c) 2026", "ISC", "permissive"],
    ["Redistribution and use in source and binary forms, with or without", "BSD", "permissive"],
    ["This is free and unencumbered software released into the public domain.", "Unlicense", "permissive"],
    ["Creative Commons Attribution 4.0 International", "CC-BY", "permissive"],
    ["Copyright Acme. All rights reserved.", "Proprietary", "proprietary"],
  ])("reads %j as %s", (text, spdx, kind) => {
    expect(readLicense([file("LICENSE", text)])).toEqual({ spdx, kind, file: "LICENSE" });
  });

  it("calls text it doesn't know unknown", () => {
    expect(readLicense([file("COPYING", "Do what you like, mostly.")])).toEqual({ spdx: null, kind: "unknown", file: "COPYING" });
  });

  it("takes the license file nearest the skill's root, by any of its names", () => {
    const files = [file("vendor/lib/LICENSE.txt", "GNU GENERAL PUBLIC LICENSE"), file("LICENCE.md", "MIT License"), file("README.md", "GPL")];
    expect(readLicense(files)).toEqual({ spdx: "MIT", kind: "permissive", file: "LICENCE.md" });
  });

  it("falls back to SKILL.md's license: field, quoted or not", () => {
    expect(readLicense([skillMd("license: Apache-2.0")])).toEqual({ spdx: "Apache-2.0", kind: "permissive", file: "SKILL.md" });
    expect(readLicense([skillMd('license: "MIT"')])).toEqual({ spdx: "MIT", kind: "permissive", file: "SKILL.md" });
  });

  it("says none when there's no file and no field", () => {
    expect(readLicense([skillMd("description: y")])).toEqual({ spdx: null, kind: "none" });
    expect(readLicense([file("SKILL.md", "no frontmatter at all")])).toEqual({ spdx: null, kind: "none" });
    expect(readLicense([])).toEqual({ spdx: null, kind: "none" });
  });
});

describe("licenseFinding", () => {
  it("is a note for a permissive license, with its SPDX id", () => {
    expect(licenseFinding({ spdx: "MIT", kind: "permissive", file: "LICENSE" })).toEqual({
      severity: "info",
      category: "license",
      rule: "license-permissive",
      message: "Permissive license: free to use, keep the notice (MIT)",
      file: "LICENSE",
    });
  });

  it.each(["copyleft", "noncommercial", "proprietary", "unknown", "none"] as const)("warns for %s", (kind) => {
    const finding = licenseFinding({ spdx: null, kind });
    expect(finding.severity).toBe("warn");
    expect(finding.rule).toBe(`license-${kind}`);
    expect(finding.message).not.toMatch(/\)$/);
  });
});
