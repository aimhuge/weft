// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { NEW_THREAD_EVENT, onNewThreadRequest, requestNewThread } from "./new-thread-request";

describe("new thread requests", () => {
  it("hands each request to the listener until it unsubscribes", () => {
    const handle = vi.fn();
    const off = onNewThreadRequest(handle);
    requestNewThread({ folder: "/f", draft: "hi" });
    expect(handle).toHaveBeenCalledWith({ folder: "/f", draft: "hi" });
    off();
    requestNewThread({ folder: "/g" });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("ignores an event with no detail", () => {
    const handle = vi.fn();
    const off = onNewThreadRequest(handle);
    window.dispatchEvent(new CustomEvent(NEW_THREAD_EVENT));
    expect(handle).not.toHaveBeenCalled();
    off();
  });
});
