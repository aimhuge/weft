import { describe, expect, it } from "vitest";
import { depsOf, hiddenBy, loadRules } from "./build-log-filter.mjs";

const rules = loadRules();
const line = (message, deps) => `  • ${message}  dependencies=${JSON.stringify(deps)}`;

describe("build-log-filter", () => {
  it("reads the dependency list off a summary line", () => {
    expect(depsOf(line("x", ["a@1", "b@2"]))).toEqual(["a@1", "b@2"]);
    expect(depsOf("  • packaging platform=darwin")).toEqual([]);
    expect(depsOf("dependencies=[not json")).toEqual([]);
  });

  it("hides duplicate dependency references whatever they name", () => {
    expect(hiddenBy(line("duplicate dependency references", ["next@16.4.3"]), rules)).toBeDefined();
  });

  it("keeps the unresolved duplicates, which are a real problem", () => {
    expect(hiddenBy(line("unresolved duplicate dependency references", ["next@16.4.3"]), rules)).toBeUndefined();
  });

  it("hides missing deps only when every one is another platform's binary", () => {
    const other = ["@img/sharp-linuxmusl-arm64@0.35.5", "@esbuild/netbsd-x64@0.28.2", "@img/sharp-freebsd-wasm32@0.35.5"];
    expect(hiddenBy(line("dependency not found on disk", other), rules)).toBeDefined();
    expect(hiddenBy(line("dependency not found on disk", [...other, "@img/sharp-darwin-arm64@0.35.5"]), rules)).toBeUndefined();
    expect(hiddenBy(line("dependency not found on disk", []), rules)).toBeUndefined();
  });

  it("passes ordinary lines through", () => {
    expect(hiddenBy("  • signing file=dist/mac-arm64/Weft.app", rules)).toBeUndefined();
  });
});
