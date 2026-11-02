import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isMobileApp } from "./mobile-app";

const dirs: string[] = [];
const folder = (pkg?: unknown) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-mobile-"));
  dirs.push(dir);
  if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), typeof pkg === "string" ? pkg : JSON.stringify(pkg));
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("isMobileApp", () => {
  it("says yes to an Expo or React Native app", () => {
    expect(isMobileApp(folder({ dependencies: { expo: "54" } }))).toBe(true);
    expect(isMobileApp(folder({ devDependencies: { "react-native": "0.81" } }))).toBe(true);
  });

  it("says no to a web app, no package.json, or a broken one", () => {
    expect(isMobileApp(folder({ dependencies: { next: "16" } }))).toBe(false);
    expect(isMobileApp(folder())).toBe(false);
    expect(isMobileApp(folder("{"))).toBe(false);
  });
});
