import { describe, expect, it } from "vitest";
import { ACCOUNT_SETTINGS, foreignSetting, HOST_SETTINGS, pickSettings } from "./host-settings";

// What may travel to a worker: two lists that never overlap, and never a folder, a mode or a guard.
const NEVER = ["allowedFolders", "defaultPermissionMode", "syncFolders", "workerFolders", "issueFolders", "issueLandings", "gooseBaseUrl", "gooseProviderId", "projects"];

describe("the settings lists", () => {
  it("keep account and host settings apart, and leave out everything that widens a card", () => {
    const account: readonly string[] = ACCOUNT_SETTINGS;
    const host: readonly string[] = HOST_SETTINGS;
    expect(account.filter((f) => host.includes(f))).toEqual([]);
    for (const field of NEVER) {
      expect(account).not.toContain(field);
      expect(host).not.toContain(field);
    }
  });
});

describe("pickSettings", () => {
  it("keeps only the fields a list names, and reads anything else as empty", () => {
    expect(pickSettings({ pushOnDone: false, allowedFolders: ["/"], doneModel: undefined }, ACCOUNT_SETTINGS)).toEqual({ pushOnDone: false });
    expect(pickSettings(null, ACCOUNT_SETTINGS)).toEqual({});
    expect(pickSettings([1], HOST_SETTINGS)).toEqual({});
    expect(pickSettings(Object.create({ maxThreads: 3 }), HOST_SETTINGS)).toEqual({});
  });
});

describe("foreignSetting", () => {
  it("names the first field that isn't a host setting", () => {
    expect(foreignSetting({ maxThreads: 2, keepAliveMinutes: 0 })).toBeNull();
    expect(foreignSetting({ maxThreads: 2, allowedFolders: ["/"] })).toBe("allowedFolders");
    expect(foreignSetting(undefined)).toBeNull();
    expect(foreignSetting("x")).toBeNull();
  });
});
