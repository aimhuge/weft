// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsPage } from "./settings-nav";
import { JUMP_WAIT_MS, useSettingsSections } from "./use-settings-sections";

// Settings' section nav hook (lib/use-settings-sections.ts): the open page's drawn sections, the one in view, and jumps.

type Api = ReturnType<typeof useSettingsSections>;
let latest: Api;
const keep = (api: Api) => {
  latest = api;
};

// Plain ref objects, made outside React, so the page and nav elements can be handed to the hook as props.
type Refs = { scroller: { current: HTMLDivElement | null }; nav: { current: HTMLElement | null } };
const newRefs = (): Refs => ({ scroller: { current: null }, nav: { current: null } });
let refs = newRefs();

function Harness({ page, children, nav = true, mount = true, r = refs, onApi = keep }: { page: SettingsPage; children?: ReactNode; nav?: boolean; mount?: boolean; r?: Refs; onApi?: (api: Api) => void }) {
  const api = useSettingsSections(r.scroller, r.nav, page);
  useEffect(() => onApi(api));
  if (!mount) return null;
  return createElement("div", { ref: r.scroller, "data-testid": "scroller" }, nav ? createElement("nav", { ref: r.nav }) : null, children);
}

const h3 = (title: string) => createElement("div", { key: title, "data-settings-card": "" }, createElement("h3", null, title));

// jsdom lays nothing out: put an element's top where a test wants it.
function place(el: Element, top: number) {
  (el as HTMLElement).getBoundingClientRect = () => ({ top, bottom: top + 40 }) as DOMRect;
}

function scroller() {
  return screen.getByTestId("scroller");
}

afterEach(() => {
  cleanup();
  refs = newRefs();
});

describe("useSettingsSections", () => {
  it("lists the page's drawn sections and follows ones drawn late", async () => {
    const { rerender } = render(createElement(Harness, { page: "threads" }, [h3("Thread instructions")]));
    expect(latest.sections.map((s) => s.title)).toEqual(["Thread instructions"]);
    rerender(createElement(Harness, { page: "threads" }, [h3("Threads running at once"), h3("Thread instructions")]));
    await waitFor(() => expect(latest.sections.map((s) => s.title)).toEqual(["Threads running at once", "Thread instructions"]));
  });

  it("keeps the same list when the page redraws without changing its sections", async () => {
    const { rerender } = render(createElement(Harness, { page: "threads" }, [h3("Thread instructions")]));
    const first = latest.sections;
    rerender(createElement(Harness, { page: "threads" }, [h3("Thread instructions"), createElement("p", { key: "x" }, "more")]));
    await act(async () => {});
    expect(latest.sections).toBe(first);
  });

  it("jumps to a drawn section: scrolls its card under the nav and marks it", () => {
    render(createElement(Harness, { page: "threads" }, [h3("Threads running at once"), h3("Thread instructions")]));
    const root = scroller();
    place(root.querySelector("nav")!, 0);
    place(screen.getByText("Thread instructions").parentElement!, 300);
    act(() => latest.jump("Thread instructions"));
    // 300 (the card) - 40 (the nav's bottom) - 8 (breathing room)
    expect(root.scrollTop).toBe(252);
    expect(latest.active).toBe("Thread instructions");
  });

  it("measures from the page's own top when there's no nav", () => {
    render(createElement(Harness, { page: "threads", nav: false }, [h3("Thread instructions")]));
    const root = scroller();
    place(root, 100);
    place(screen.getByText("Thread instructions").parentElement!, 300);
    act(() => latest.jump("Thread instructions"));
    expect(root.scrollTop).toBe(192);
  });

  it("lands a jump once its section draws, after the page changes", async () => {
    const { rerender } = render(createElement(Harness, { page: "general" }, [h3("Sounds")]));
    act(() => latest.jump("Trusted folders"));
    rerender(createElement(Harness, { page: "security" }));
    expect(latest.active).not.toBe("Trusted folders");
    rerender(createElement(Harness, { page: "security" }, [h3("Trusted folders")]));
    await waitFor(() => expect(latest.active).toBe("Trusted folders"));
  });

  it("gives up on a jump whose section never draws", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const { rerender } = render(createElement(Harness, { page: "security" }));
    act(() => latest.jump("Trusted folders"));
    now.mockReturnValue(1000 + JUMP_WAIT_MS + 1);
    rerender(createElement(Harness, { page: "security" }, [h3("Site notes")]));
    await act(async () => {});
    rerender(createElement(Harness, { page: "security" }, [h3("Site notes"), h3("Trusted folders")]));
    await act(async () => {});
    expect(latest.active).not.toBe("Trusted folders");
    now.mockRestore();
  });

  it("lights the section the scroll has reached, and the last one at the bottom", () => {
    render(createElement(Harness, { page: "threads" }, [h3("Threads running at once"), h3("Keep conversations open"), h3("Thread instructions")]));
    const root = scroller();
    place(root.querySelector("nav")!, 0);
    place(screen.getByText("Threads running at once"), -100);
    place(screen.getByText("Keep conversations open"), 30);
    place(screen.getByText("Thread instructions"), 500);
    Object.defineProperties(root, { scrollHeight: { value: 2000, configurable: true }, clientHeight: { value: 600, configurable: true } });
    root.scrollTop = 200;
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });
    expect(latest.active).toBe("Keep conversations open");
    root.scrollTop = 1400;
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });
    expect(latest.active).toBe("Thread instructions");
  });

  it("does nothing without its page on screen", () => {
    render(createElement(Harness, { page: "threads", mount: false }));
    act(() => latest.jump("Thread instructions"));
    expect(latest.sections).toEqual([]);
  });
});
