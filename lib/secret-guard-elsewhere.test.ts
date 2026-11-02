// A Read of an attachment that was pasted on another machine (lib/secret-guard-pasted.ts pastedElsewhere): the guard
// says the file stayed where it was pasted, instead of calling it a secret.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pastedElsewhere } from "./secret-guard-pasted";
import { toolVerdict } from "./secret-guard-tool";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "elsewhere-"));
const dataDir = path.join(tmp, "data");
fs.mkdirSync(path.join(dataDir, "attachments"), { recursive: true });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("pastedElsewhere", () => {
  it("names a missing attachment as pasted on another machine", () => {
    const why = pastedElsewhere("/Users/someone/.weft/attachments/shot-1a2b.webp");
    expect(why).toMatch(/^shot-1a2b.webp was pasted on another machine and didn't reach this one/);
    expect(pastedElsewhere(`"~/elsewhere/attachments/doc-1.pdf"`)).toMatch(/doc-1.pdf was pasted/);
  });

  it("says nothing for a file that's here, a path that isn't an attachment, or no path", () => {
    const here = path.join(dataDir, "attachments", "here-1.png");
    fs.writeFileSync(here, "x");
    expect(pastedElsewhere(here)).toBeNull();
    expect(pastedElsewhere("/Users/someone/.weft/board.json")).toBeNull();
    expect(pastedElsewhere("/Users/someone/notes/Shot 1.png")).toBeNull();
    expect(pastedElsewhere("")).toBeNull();
  });
});

describe("toolVerdict on an attachment from another machine", () => {
  it("explains the Read instead of the secret-values refusal", () => {
    const why = toolVerdict("Read", { file_path: path.join(dataDir, "attachments", "gone-1.png") }, dataDir, "card-1");
    expect(why).toMatch(/was pasted on another machine/);
    expect(why).not.toMatch(/secret values/);
  });

  it("leaves an edit to the secret guard", () => {
    expect(toolVerdict("Write", { file_path: path.join(dataDir, "attachments", "gone-1.png") }, dataDir, "card-1")).toMatch(/secret values/);
  });
});
