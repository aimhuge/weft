import { describe, expect, it } from "vitest";
import { claudeBinary, toolchainWrappers } from "./toolchain-wrappers.mjs";

// The toolchain's bin/ wrappers per OS (scripts/bundle-toolchain.mjs writes them into the packaged app).

const NAMES = ["node", "npm", "npx", "pnpm", "pnpx", "puku-cli", "claude", "gog"];

describe("toolchainWrappers", () => {
  it("writes sh wrappers on a Mac that run on Weft Helper", () => {
    const files = toolchainWrappers("darwin", "arm64");
    expect(Object.keys(files).sort()).toEqual([...NAMES].sort());
    expect(files.pnpm).toMatch(/^#!\/bin\/sh\n/);
    expect(files.pnpm).toContain('NODE="$CONTENTS/Frameworks/Weft Helper.app/Contents/MacOS/Weft Helper"');
    expect(files.pnpm).toContain('ELECTRON_RUN_AS_NODE=1 exec "$NODE" "$TOOLCHAIN/pnpm/bin/pnpm.cjs" "$@"');
    expect(files.pnpx).toContain('"$TOOLCHAIN/pnpm/bin/pnpm.cjs" dlx "$@"');
    expect(files.node).toContain('exec "$NODE" "$@"');
    expect(files.claude).toContain('exec "$CONTENTS/Resources/server/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude" "$@"');
    expect(files.gog).toContain('exec "$TOOLCHAIN/gog/gog" "$@"');
  });

  it("finds the weft binary and resources/ on Linux", () => {
    const files = toolchainWrappers("linux", "x64");
    expect(files.npm).toContain('NODE="$CONTENTS/weft"');
    expect(files.claude).toContain("$CONTENTS/resources/server/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude");
  });

  it("writes .cmd wrappers on Windows that run Weft.exe as Node", () => {
    const files: Record<string, string> = toolchainWrappers("win32", "x64");
    expect(Object.keys(files).sort()).toEqual(NAMES.map((n) => `${n}.cmd`).sort());
    expect(files["pnpm.cmd"]).toMatch(/^@echo off\r\n/);
    expect(files["pnpm.cmd"]).toContain('set "APPDIR=%~dp0..\\..\\.."');
    expect(files["pnpm.cmd"]).toContain('set ELECTRON_RUN_AS_NODE=1\r\n"%APPDIR%\\Weft.exe" "%TOOLCHAIN%\\pnpm\\bin\\pnpm.cjs" %*');
    expect(files["pnpx.cmd"]).toContain('pnpm.cjs" dlx %*');
    expect(files["node.cmd"]).toContain('"%APPDIR%\\Weft.exe" %*');
    expect(files["claude.cmd"]).toContain('"%APPDIR%\\resources\\server\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe" %*');
    expect(files["gog.cmd"]).toContain('"%TOOLCHAIN%\\gog\\gog.exe" %*');
    expect(files["claude.cmd"]).not.toContain("ELECTRON_RUN_AS_NODE");
  });
});

describe("claudeBinary", () => {
  it("is claude.exe on Windows only", () => {
    expect(claudeBinary("win32", "arm64")).toBe("server/node_modules/@anthropic-ai/claude-agent-sdk-win32-arm64/claude.exe");
    expect(claudeBinary("darwin", "x64")).toBe("server/node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/claude");
  });
});
