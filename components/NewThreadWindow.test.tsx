// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserState } from "@/lib/client";
import type { Card } from "@/lib/types";

vi.mock("./NewCardDialog", () => ({ default: () => <div>New thread form</div> }));
vi.mock("./BrowserPane", () => ({ default: ({ expanded }: { expanded: boolean }) => <div data-expanded={String(expanded)}>Browser pane</div> }));

import NewThreadWindow from "./NewThreadWindow";

afterEach(cleanup);

const state: BrowserState = {
  visible: true,
  url: "file:///new-thread.html",
  title: "New thread",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 100,
};

const form = {
  cards: [] as Card[],
  home: "/home",
  onCreate: vi.fn().mockResolvedValue(undefined),
};

describe("NewThreadWindow", () => {
  it("shows the browser pane beside the form on desktop", async () => {
    render(<NewThreadWindow form={form} browser={{ desktop: true, state, obscured: false, width: 560, onWidth: vi.fn() }} onClose={vi.fn()} />);
    expect(await screen.findByText("New thread form")).toBeTruthy();
    expect(await screen.findByText("Browser pane")).toBeTruthy();
  });

  it("lets the pane fill the window beside the form instead of keeping the open card's width", async () => {
    render(<NewThreadWindow form={form} browser={{ desktop: true, state, obscured: false, width: 560, onWidth: vi.fn() }} onClose={vi.fn()} />);
    expect((await screen.findByText("Browser pane")).getAttribute("data-expanded")).toBe("true");
  });

  it("keeps the web New thread dialog free of the native browser pane", async () => {
    render(<NewThreadWindow form={form} browser={{ desktop: false, state, obscured: false, width: 560, onWidth: vi.fn() }} onClose={vi.fn()} />);
    expect(await screen.findByText("New thread form")).toBeTruthy();
    expect(screen.queryByText("Browser pane")).toBeNull();
  });
});
