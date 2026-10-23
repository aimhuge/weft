import { describe, expect, it, vi } from "vitest";
import type { ChangelogEntry } from "./changelog";

vi.mock("./store", () => ({ DATA_DIR: "/tmp/unused" }));
const { HEADER, bulletOf, releaseFile, renderFile, renderSection, unreleasedLines } = await import("./changelog-render");

const entry = (kind: ChangelogEntry["kind"], text: string): ChangelogEntry => ({ id: text, project: "/r", kind, text, at: 1 });

const FILE = `# Changelog

Intro.

## [Unreleased]

### Added

- **Old way.** A line typed by hand,
  wrapped onto two.
- Weft wrote this before.

### Deprecated

- Old API.

### Mystery

- Odd heading.

## [0.3.0] - 2026-10-01

### Fixed

- Things.

[0.3.0]: https://example.com
`;

const known = new Set([bulletOf("Weft wrote this before.")]);

describe("changelog render", () => {
  it("reads the typed Unreleased bullets by kind, continuation lines included, leaving out Weft's own", () => {
    const { out } = unreleasedLines(FILE, known);
    expect(out.added).toEqual(["- **Old way.** A line typed by hand,\n  wrapped onto two."]);
    expect(out.changed).toEqual(["- Old API.", "- Odd heading."]);
    expect(unreleasedLines(FILE).out.added).toHaveLength(2);
    expect(unreleasedLines("# nothing").start).toBe(-1);
  });

  it("files bullets with no heading under Changed and ignores stray text", () => {
    const { out } = unreleasedLines("## [Unreleased]\n\nstray\n* bare bullet\n");
    expect(out.changed).toEqual(["- bare bullet"]);
  });

  it("makes one bullet line of an entry", () => {
    expect(bulletOf("  Two\n  lines ")).toBe("- Two lines");
  });

  it("renders a section in Keep a Changelog order, entries after typed lines", () => {
    const section = renderSection("1.0.0", "2026-10-23", [entry("fixed", "Bug\nsquashed"), entry("added", "New")], {
      added: ["- Typed"], changed: [], fixed: [], removed: [], security: [],
    });
    expect(section).toBe("## [1.0.0] - 2026-10-23\n\n### Added\n\n- Typed\n- New\n\n### Fixed\n\n- Bug squashed");
    expect(renderSection("1.0.1", "d", [])).toBe("## [1.0.1] - d\n\nNo changes recorded.");
  });

  it("rewrites Unreleased with the entries, keeping typed lines, history and link refs, and is stable", () => {
    const out = renderFile(FILE, [entry("added", "Weft wrote this before."), entry("security", "Patched")], { known });
    expect(out).toContain("## [Unreleased]\n\n### Added\n\n- **Old way.** A line typed by hand,\n  wrapped onto two.\n- Weft wrote this before.\n\n### Changed");
    expect(out).toContain("### Security\n\n- Patched\n\n## [0.3.0] - 2026-10-01");
    expect(out).toContain("[0.3.0]: https://example.com\n");
    expect(out.match(/Weft wrote this before/g)).toHaveLength(1);
    expect(renderFile(out, [entry("added", "Weft wrote this before."), entry("security", "Patched")], { known: new Set([...known, bulletOf("Patched")]) })).toBe(out);
  });

  it("moves Unreleased under a version on release", () => {
    const out = releaseFile(FILE, "0.4.0", "2026-10-23", [entry("security", "Patched")], known);
    expect(out).toContain("## [Unreleased]\n\n## [0.4.0] - 2026-10-23\n\n### Added\n\n- **Old way.**");
    expect(out).not.toContain("Weft wrote this before");
    expect(out).toContain("### Security\n\n- Patched\n\n## [0.3.0] - 2026-10-01");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("starts a file that doesn't exist or has no Unreleased heading", () => {
    expect(renderFile(null, [entry("added", "First")])).toBe(`${HEADER}\n### Added\n\n- First\n`);
    expect(releaseFile(null, "1.0.0", "d", [entry("added", "First")])).toBe(`${HEADER}\n## [1.0.0] - d\n\n### Added\n\n- First\n`);
    const old = releaseFile("# Changelog\n\n## [0.1.0]\n\n- old\n", "0.2.0", "d", [entry("added", "New")]);
    expect(old).toContain("## [Unreleased]\n\n## [0.2.0] - d\n\n### Added\n\n- New\n\n## [0.1.0]\n\n- old\n");
    expect(renderFile(HEADER, [])).toBe(HEADER);
  });
});
