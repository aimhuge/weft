// Electron's safeStorage wrapped so every Keychain open and seal is an audit line (electron/keychain-audit.cjs):
// calls pass through, repeats inside the window become one counted line, failures are recorded and thrown on.
import { describe, expect, it, vi } from "vitest";
import { auditedKeychain, REPEAT_MS } from "./keychain-audit.cjs";

describe("auditedKeychain", () => {
  // Electron's safeStorage, stood in for.
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`s:${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(2),
  };

  // The wrapper's shape; the .cjs module is untyped JavaScript.
  type Keychain = {
    isEncryptionAvailable: () => boolean;
    encryptString: (text: string) => Buffer;
    decryptString: (buf: Buffer) => string;
  };
  // Electron's safeStorage, as the wrapper takes it.
  type Store = {
    isEncryptionAvailable: () => boolean;
    encryptString: (text: string) => Buffer;
    decryptString: (buf: Buffer) => string;
  };
  const wrap = (store: Store, what: string, options: Record<string, unknown> = {}): Keychain => auditedKeychain(store, what, options);

  it("passes the calls through and records the open and the seal", () => {
    const record = vi.fn();
    const keychain = wrap(safeStorage, "vault key", { record });
    expect(keychain.isEncryptionAvailable()).toBe(true);
    expect(keychain.encryptString("hello").toString()).toBe("s:hello");
    expect(keychain.decryptString(Buffer.from("s:hello"))).toBe("hello");
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenNthCalledWith(1, { kind: "keychain", action: "seal", what: "vault key", by: "weft", outcome: "ok" });
    expect(record).toHaveBeenNthCalledWith(2, { kind: "keychain", action: "open", what: "vault key", by: "weft", outcome: "ok" });
  });

  it("counts a repeat inside the window and writes one line for them when it ends", () => {
    const record = vi.fn();
    const timers: (() => void)[] = [];
    let t = 1000;
    const keychain = wrap(safeStorage, "Weft sign-in", {
      record,
      now: () => t,
      setTimer: ((fn: () => void) => timers.push(fn)) as unknown as typeof setTimeout,
      repeatMs: REPEAT_MS,
    });
    keychain.decryptString(Buffer.from("s:a"));
    t += 1000;
    keychain.decryptString(Buffer.from("s:a"));
    t += 1000;
    keychain.decryptString(Buffer.from("s:a"));
    expect(record).toHaveBeenCalledTimes(1);
    t += REPEAT_MS;
    timers[0]!();
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith({ kind: "keychain", action: "open", what: "Weft sign-in", by: "weft", outcome: "ok", count: 2 });
  });

  it("writes no count line when nothing repeated", () => {
    const record = vi.fn();
    const timers: (() => void)[] = [];
    const keychain = wrap(safeStorage, "Vercel token", {
      record,
      now: () => 0,
      setTimer: ((fn: () => void) => timers.push(fn)) as unknown as typeof setTimeout,
    });
    keychain.encryptString("token");
    timers[0]!();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({ kind: "keychain", action: "seal", what: "Vercel token", by: "weft", outcome: "ok" });
  });

  it("records a failure and throws it on", () => {
    const record = vi.fn();
    const broken: Store = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from("x"),
      decryptString: (): string => {
        throw new Error("keychain locked");
      },
    };
    const keychain = wrap(broken, "vault key", { record });
    expect(() => keychain.decryptString(Buffer.from("x"))).toThrow("keychain locked");
    expect(record).toHaveBeenCalledWith({ kind: "keychain", action: "open", what: "vault key", by: "weft", outcome: "error", detail: "keychain locked" });
  });

  it("records a failure that isn't an Error as its text", () => {
    const record = vi.fn();
    const broken: Store = {
      isEncryptionAvailable: () => true,
      encryptString: (): never => {
        throw "no keychain"; // eslint-disable-line @typescript-eslint/only-throw-error
      },
      decryptString: (buf: Buffer) => buf.toString(),
    };
    const keychain = wrap(broken, "vault key", { record });
    expect(() => keychain.encryptString("x")).toThrow("no keychain");
    expect(record).toHaveBeenCalledWith({ kind: "keychain", action: "seal", what: "vault key", by: "weft", outcome: "error", detail: "no keychain" });
  });

  it("copes with a timer that has no unref to call", () => {
    const record = vi.fn();
    const keychain = wrap(safeStorage, "vault key", {
      record,
      now: () => 0,
      setTimer: (() => undefined) as unknown as typeof setTimeout,
    });
    expect(() => keychain.encryptString("x")).not.toThrow();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("keeps the newer window when an older timer fires late", () => {
    const record = vi.fn();
    const timers: (() => void)[] = [];
    let t = 0;
    const keychain = wrap(safeStorage, "vault key", {
      record,
      now: () => t,
      setTimer: ((fn: () => void) => timers.push(fn)) as unknown as typeof setTimeout,
      repeatMs: 100,
    });
    keychain.encryptString("x");
    t = 200;
    keychain.encryptString("x");
    expect(record).toHaveBeenCalledTimes(2);
    // The first window's timer fires after the second one opened: it must not delete the newer window.
    timers[0]!();
    t = 400;
    keychain.encryptString("x");
    expect(record).toHaveBeenCalledTimes(3);
    timers[2]!();
  });
});
