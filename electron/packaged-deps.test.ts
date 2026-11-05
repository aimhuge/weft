import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filePatterns, runtimeClosure } from "../scripts/electron-runtime-deps.mjs";

// The packaged app only ships the packages electron-builder's `build.files` allow-list names
// (everything else is dropped by the "!node_modules${/*}" rule). Electron main runs inside app.asar,
// so a bare require() of a package that isn't on that list crashes the main process on launch with
// "Cannot find module" — the app dies before a window opens, and only the shipped build shows it.
//
// 2026-10-28: `feat(vault): shared team vault` added electron/account-client.cjs, which requires
// "@supabase/supabase-js". The package was in package.json's dependencies (and in the Next server's
// standalone bundle), but never in the allow-list, so every packaged build died on launch.
//
// The list is derived, not hand-kept: scripts/electron-runtime-deps.mjs computes the closure of
// packages Electron main needs at runtime, and writes it into build.files. This test is the guard:
// it checks that the list in package.json is exactly what the script computes, so a new require()
// can never ship without its package.

const ROOT = path.resolve(__dirname, "..");

/**
 * The packages electron-builder copies into app.asar, read from the one source of truth.
 *
 * A package can be listed by several patterns (node-pty has four: package.json, lib, prebuilds,
 * build/Release), so the names are unique here.
 */
function allowList(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    build: { files: string[] };
  };
  const out = new Set<string>();
  for (const pattern of pkg.build.files) {
    const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(pattern);
    if (match?.[1]) out.add(match[1]);
  }
  return [...out];
}

describe("what the packaged app can require", () => {
  it("ships every package Electron main needs, and nothing it doesn't", () => {
    // The closure the script computes, against the list in package.json.
    expect([...allowList()].sort()).toEqual([...runtimeClosure()].sort());
  });

  it("keeps build.files in step with the closure the script computes", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      build: { files: string[] };
    };
    const expected = filePatterns(runtimeClosure());
    expect(pkg.build.files.filter((f) => f.startsWith("node_modules/"))).toEqual(expected);
  });

  it("names every package it lists, so a renamed dependency doesn't slip through", () => {
    const missing = allowList().filter((name) => !fs.existsSync(path.join(ROOT, "node_modules", name, "package.json")));
    expect(missing).toEqual([]);
  });

  it("ships the Supabase client the account client requires", () => {
    // Named explicitly so its removal is loud: this is the package the launch crash was about.
    expect(allowList()).toContain("@supabase/supabase-js");
  });
});
