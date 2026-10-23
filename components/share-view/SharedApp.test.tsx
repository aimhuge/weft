// @vitest-environment jsdom
// components/share-view/SharedApp.tsx: a hosted mini app's weft.requestSecret opens the secret form, which
// SharedApp keeps in its own state. It used to be a function prop from the server page, which can't cross into
// a client component and crashed every /@<user>/apps/<slug> page (2026-10-23).
import "@/components/test-utils";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_TAG } from "@/lib/app-bridge";
import { SharedApp } from "./SharedApp";

function askFromFrame(name: string) {
  const frame = document.querySelector("iframe");
  if (!frame?.contentWindow) throw new Error("no frame");
  const event = new MessageEvent("message", { data: { tag: BRIDGE_TAG, id: 1, op: "requestSecret", name } });
  Object.defineProperty(event, "source", { value: frame.contentWindow });
  act(() => {
    window.dispatchEvent(event);
  });
}

beforeEach(() => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ set: false }), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

afterEach(cleanup);

describe("SharedApp", () => {
  it("opens the secret form when the app asks for a secret, and closes it on Cancel", async () => {
    render(
      <SharedApp
        name="Growth"
        src="/api/a/share-1/f/index.html"
        site={false}
        shareId="share-1"
        manifest={{ secrets: { STRIPE_KEY: { hosts: ["api.stripe.com"], from: "viewer" } } } as never}
      />,
    );
    expect(screen.queryByText(/Provide STRIPE_KEY/)).toBeNull();
    askFromFrame("STRIPE_KEY");
    expect(await screen.findByText(/Provide STRIPE_KEY/)).toBeInTheDocument();
    expect(screen.getByText("api.stripe.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Provide STRIPE_KEY/)).toBeNull();
  });

  it("frames a public site with an Open link out of the sandbox", () => {
    render(<SharedApp name="Docs" src="https://example.com" site />);
    expect(screen.getByTitle("Docs")).toHaveAttribute("src", "https://example.com");
    expect(screen.getAllByRole("link", { name: /Open/ })[0]).toHaveAttribute("href", "https://example.com");
  });
});
