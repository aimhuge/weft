// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_EVENT, CONSENT_KEY, readConsent, whenConsented, writeConsent } from "./consent";

beforeEach(() => localStorage.clear());

describe("readConsent", () => {
  it("is null until the visitor chooses, and ignores anything else stored", () => {
    expect(readConsent()).toBeNull();
    localStorage.setItem(CONSENT_KEY, "maybe");
    expect(readConsent()).toBeNull();
  });

  it("reads a stored yes or no", () => {
    localStorage.setItem(CONSENT_KEY, "granted");
    expect(readConsent()).toBe("granted");
    localStorage.setItem(CONSENT_KEY, "denied");
    expect(readConsent()).toBe("denied");
  });

  it("treats storage that throws, or none at all (the server), as no choice", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); } };
    expect(readConsent(throwing)).toBeNull();
    expect(readConsent(undefined as unknown as Storage)).toBeNull();
  });
});

describe("writeConsent", () => {
  it("stores the choice and announces it", () => {
    const heard = vi.fn();
    window.addEventListener(CONSENT_EVENT, heard);
    writeConsent("granted");
    expect(localStorage.getItem(CONSENT_KEY)).toBe("granted");
    expect((heard.mock.calls[0]?.[0] as CustomEvent).detail).toBe("granted");
    window.removeEventListener(CONSENT_EVENT, heard);
  });

  it("still announces the choice when storage refuses it", () => {
    const target = new EventTarget();
    const heard = vi.fn();
    target.addEventListener(CONSENT_EVENT, heard);
    writeConsent("denied", { setItem: () => { throw new Error("full"); } }, target);
    expect(heard).toHaveBeenCalledOnce();
  });
});

describe("whenConsented", () => {
  it("starts at once for a visitor who already accepted", () => {
    localStorage.setItem(CONSENT_KEY, "granted");
    const start = vi.fn();
    whenConsented(start)();
    expect(start).toHaveBeenCalledOnce();
  });

  it("waits for a yes, ignores a no, and starts only once", () => {
    const start = vi.fn();
    whenConsented(start);
    writeConsent("denied");
    expect(start).not.toHaveBeenCalled();
    writeConsent("granted");
    writeConsent("granted");
    expect(start).toHaveBeenCalledOnce();
  });

  it("stops waiting when unsubscribed", () => {
    const start = vi.fn();
    const stop = whenConsented(start);
    stop();
    writeConsent("granted");
    expect(start).not.toHaveBeenCalled();
  });
});
