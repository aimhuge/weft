// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_EVENT, CONSENT_KEY } from "@/lib/consent";
import ConsentBanner from "./ConsentBanner";
import ConsentChoice from "./ConsentChoice";
import { GA_ID, GA_SNIPPET } from "./GoogleAnalytics";
import "./test-utils";

beforeEach(() => localStorage.clear());

describe("ConsentBanner", () => {
  it("asks a weft.zip visitor who hasn't chosen, and links the privacy policy", () => {
    render(<ConsentBanner hostname="weft.zip" />);
    expect(screen.getByRole("dialog", { name: "Analytics cookies" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy#cookies");
  });

  it("never shows on a local board", () => {
    render(<ConsentBanner hostname="localhost" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays away once the visitor has answered", () => {
    localStorage.setItem(CONSENT_KEY, "denied");
    render(<ConsentBanner hostname="weft.zip" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["Accept", "granted"],
    ["Decline", "denied"],
  ])("%s stores the answer, announces it and closes", (button, value) => {
    const heard = vi.fn();
    window.addEventListener(CONSENT_EVENT, heard);
    render(<ConsentBanner hostname="weft.zip" />);
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(localStorage.getItem(CONSENT_KEY)).toBe(value);
    expect((heard.mock.calls[0]?.[0] as CustomEvent).detail).toBe(value);
    expect(screen.queryByRole("dialog")).toBeNull();
    window.removeEventListener(CONSENT_EVENT, heard);
  });

  it("reads the page's own host by default", () => {
    render(<ConsentBanner />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ConsentChoice", () => {
  it("turns analytics on for a visitor who hasn't chosen", () => {
    render(<ConsentChoice />);
    expect(screen.getByText(/haven't chosen yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn them on" }));
    expect(localStorage.getItem(CONSENT_KEY)).toBe("granted");
    expect(screen.getByText("on")).toBeInTheDocument();
  });

  it("turns them off and reloads, so gtag.js is gone", () => {
    localStorage.setItem(CONSENT_KEY, "granted");
    const reload = vi.fn();
    render(<ConsentChoice reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn them off" }));
    expect(localStorage.getItem(CONSENT_KEY)).toBe("denied");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("doesn't reload when turning on from off", () => {
    localStorage.setItem(CONSENT_KEY, "denied");
    const reload = vi.fn();
    render(<ConsentChoice reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn them on" }));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the GA snippet", () => {
  const gaScripts = () => [...document.head.querySelectorAll("script")].filter((s) => s.src.includes("googletagmanager"));
  // Runs the snippet the page ships, as the browser would.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the snippet is our own constant
  const run = () => (new Function(GA_SNIPPET) as () => void)();

  beforeEach(() => {
    document.head.innerHTML = "";
    delete (window as { dataLayer?: unknown }).dataLayer;
  });

  it("queues gtag config but loads nothing before consent, then loads gtag.js once on a yes", () => {
    run();
    expect((window as unknown as { dataLayer: unknown[] }).dataLayer.length).toBe(2);
    expect(gaScripts()).toHaveLength(0);
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: "denied" }));
    expect(gaScripts()).toHaveLength(0);
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: "granted" }));
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: "granted" }));
    expect(gaScripts()).toHaveLength(1);
    expect(gaScripts()[0]?.src).toContain(GA_ID);
  });

  it("loads gtag.js straight away for a visitor who accepted before", () => {
    localStorage.setItem(CONSENT_KEY, "granted");
    run();
    expect(gaScripts()).toHaveLength(1);
  });
});
