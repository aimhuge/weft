import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { leaves, SIMULATOR_GUARD_MATCHER, SIMULATOR_GUARD_WHY, simulatorGuard, simulatorMisuse } from "./simulator-guard";

// An Expo app, a Next app, and a folder with no package.json.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "simulator-guard-"));
const project = (name: string, scripts?: Record<string, string>) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (scripts) fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts }));
  return dir;
};
const APP = project("app", { start: "expo start", ios: "expo run:ios", web: "expo start --web", build: "expo export", loop: "pnpm loop" });
const WEB = project("web", { dev: "next dev -p 4001", test: "vitest run", lint: "eslint ." });
const BARE = project("bare");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const misuse = (command: string, background = false, cwd = APP) => simulatorMisuse(command, cwd, background);

describe("simulatorMisuse", () => {
  it.each([
    "xcrun simctl boot 'iPhone 16'",
    "xcrun simctl boot 1A2B-3C4D",
    "xcrun --sdk iphonesimulator simctl boot X",
    "/usr/bin/xcrun simctl boot X && xcrun simctl bootstatus X -b",
    "open -a Simulator",
    "open -a Simulator --args -CurrentDeviceUDID X",
    "open /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app",
    "open -b com.apple.iphonesimulator",
    "emulator -avd Pixel_8",
    "$ANDROID_HOME/emulator/emulator @Pixel_8 -no-snapshot",
    "nohup emulator -avd Pixel_8 &",
    "sh -c 'xcrun simctl boot X'",
    "xcrun --log simctl boot X",
    "simctl boot X",
    "open /Applications/Simulator.app/",
  ])("refuses booting from the shell: %s", (command) => {
    expect(misuse(command, false, BARE)).toBe("boot");
  });

  it.each([
    "npx expo start",
    "npx expo start --ios",
    "npx expo start --web",
    "pnpm expo start",
    "yarn react-native start",
    "npx react-native start --port 8081",
    "npx metro serve",
    "pnpm start",
    "npm run start",
    "npm start",
    "pnpm -C . web",
    "pnpm --silent --dir app start",
    "cd app && npx expo start",
    "CI=1 npx expo start > /tmp/metro.log 2>&1",
  ])("refuses Metro from Bash, foreground or not: %s", (command) => {
    expect(misuse(command)).toBe("metro");
    expect(misuse(command, true)).toBe("metro");
  });

  it.each(["npx expo run:ios", "npx expo run:android --device Pixel", "pnpm ios", "npx react-native run-ios", "npx react-native run-android"])(
    "refuses a run that starts its own Metro: %s",
    (command) => {
      expect(misuse(command)).toBe("run");
    },
  );

  it.each(["pnpm dev", "npx next dev", "next dev -p 3000", "npx vite"])("refuses a dev server sent to the background: %s", (command) => {
    expect(misuse(command, true, WEB)).toBe("background");
  });

  it.each([
    ["npx expo run:ios --no-bundler --device 'iPhone 16'", false, APP],
    ["npx react-native run-ios --no-packager --udid X", false, APP],
    ["npx expo prebuild", false, APP],
    ["pnpm build", false, APP],
    ["npx expo start --help", false, APP],
    ["emulator -list-avds", false, BARE],
    ["xcrun simctl list devices available -j", false, BARE],
    ["xcrun simctl install booted build/App.app", false, BARE],
    ["xcrun simctl shutdown all", false, BARE],
    ["open http://localhost:8081", false, BARE],
    ["open -a Safari", false, BARE],
    ["grep -rn 'xcrun simctl boot' lib", false, BARE],
    ["echo 'npx expo start'", false, BARE],
    ["pnpm dev", false, WEB],
    ["pnpm test", true, WEB],
    ["pnpm lint", true, WEB],
    ["sleep 30", true, WEB],
    ["pnpm loop", false, APP],
    ["pnpm nosuch", false, BARE],
    ["npm run", false, APP],
    ["pnpm exec", false, BARE],
    ["pnpm -C", false, APP],
    ["npx metro", false, BARE],
    ["npx expo", false, BARE],
    ["npx react-native", false, BARE],
  ] as const)("lets %s run (background %s)", (command, background, cwd) => {
    expect(misuse(command, background, cwd)).toBeNull();
  });
});

describe("leaves", () => {
  it("reads past runners and package scripts", () => {
    expect(leaves({ name: "npx", args: ["--yes", "-p", "expo", "expo", "start"], cwd: BARE })).toEqual([{ tool: "expo", args: ["start"] }]);
    expect(leaves({ name: "pnpm", args: ["exec", "expo", "start"], cwd: BARE })).toEqual([{ tool: "expo", args: ["start"] }]);
    expect(leaves({ name: "pnpm", args: ["--dir=" + APP, "start"], cwd: BARE })).toEqual([{ tool: "expo", args: ["start"] }]);
    expect(leaves({ name: "node", args: ["--inspect", "node_modules/.bin/expo.js", "start"], cwd: BARE })).toEqual([{ tool: "expo", args: ["start"] }]);
  });
});

describe("simulatorGuard", () => {
  const call = (tool_input: unknown, tool_name = "Bash") =>
    simulatorGuard({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: APP, session_id: "s", transcript_path: "", tool_use_id: "t" } as never, "t", {
      signal: new AbortController().signal,
    });

  it("denies a shell boot and points at mcp__simulator__boot", async () => {
    const out = (await call({ command: "xcrun simctl boot X" })) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe(SIMULATOR_GUARD_WHY.boot);
    expect(SIMULATOR_GUARD_WHY.boot).toContain("mcp__simulator__boot");
  });

  it("reads run_in_background", async () => {
    const out = (await call({ command: "npx next dev", run_in_background: true })) as { hookSpecificOutput: { permissionDecisionReason: string } };
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("mcp__devservers__start");
  });

  it("lets other calls and tools through", async () => {
    expect(await call({ command: "ls" })).toEqual({});
    expect(await call({ command: 42 })).toEqual({});
    expect(await call(undefined)).toEqual({});
    expect(await call({ file_path: "x" }, "Read")).toEqual({});
  });

  it("matches Bash", () => {
    expect(SIMULATOR_GUARD_MATCHER.matcher).toBe("Bash");
    expect(SIMULATOR_GUARD_MATCHER.hooks).toEqual([simulatorGuard]);
  });
});
