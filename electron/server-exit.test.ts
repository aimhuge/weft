import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exitFile, noteExit } from "./server-exit.cjs";

describe("server-exit", () => {
  const file = path.join(os.tmpdir(), `weft-exit-note-${process.pid}.json`);

  it("notes an exit Weft didn't ask for", () => {
    expect(noteExit({ code: 143, signal: null, asked: false, file, now: 5 })).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ at: 5, code: 143, signal: null });
    fs.rmSync(file);
  });

  it("leaves a stop or restart Weft asked for alone, and never throws", () => {
    expect(noteExit({ code: 0, signal: null, asked: true, file })).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(noteExit({ code: 1, signal: null, asked: false, file: "/no/such/dir/x.json" })).toBe(false);
  });

  it("lives in Weft's data folder", () => {
    expect(exitFile({ WEFT_DATA: "/d" } as unknown as NodeJS.ProcessEnv)).toBe("/d/server-exit.json");
    expect(exitFile({} as NodeJS.ProcessEnv)).toBe(path.join(os.homedir(), ".weft", "server-exit.json"));
  });
});
