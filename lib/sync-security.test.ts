import { afterEach, describe, expect, it, vi } from "vitest";

const shell = vi.hoisted(() => vi.fn());
vi.mock("./browser-shell", () => ({ shell }));
const { pairingStatus } = await import("./sync-security");

afterEach(() => {
  vi.unstubAllEnvs();
  shell.mockReset();
});

describe("pairingStatus", () => {
  it("is nothing paired and both switches off with no desktop shell", async () => {
    vi.stubEnv("WEFT_SHELL_URL", "");
    expect(await pairingStatus()).toEqual({ approvers: 0, seal: false, webApprovals: false });
    expect(shell).not.toHaveBeenCalled();
  });
  it("reads main's answer", async () => {
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:1");
    shell.mockResolvedValue({ approvers: 2, seal: true, webApprovals: "yes" });
    expect(await pairingStatus()).toEqual({ approvers: 2, seal: true, webApprovals: false });
    shell.mockResolvedValue({});
    expect((await pairingStatus()).approvers).toBe(0);
  });
  it("reads as paired when main doesn't answer", async () => {
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:1");
    shell.mockRejectedValue(new Error("down"));
    expect(await pairingStatus()).toEqual({ approvers: 1, seal: false, webApprovals: false });
  });
});
