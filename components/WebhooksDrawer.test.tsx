// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Webhook } from "@/lib/webhooks";
import "./test-utils";

vi.mock("@/lib/client", () => ({ api: {} }));

const { addWebhookAsk } = await import("@/lib/use-webhooks");
const { default: WebhooksDrawer } = await import("./WebhooksDrawer");

const NOW = Date.now();
const hook = (over: Partial<Webhook> = {}): Webhook => ({ id: "w1", folder: "/dev/app", name: "stripe", target: "http://localhost:3000/api/stripe/webhook", createdAt: 0, updatedAt: 0, ...over });

function setup(hooks: Webhook[], over: { signedIn?: boolean; loaded?: boolean; error?: string | null; project?: string | null; folders?: string[] } = {}) {
  const calls = {
    reload: vi.fn(() => Promise.resolve()),
    add: vi.fn<(input: { name: string }) => Promise<{ hook: Webhook; existed: boolean }>>((input) => Promise.resolve({ hook: hook({ id: "new", name: input.name }), existed: false })),
    update: vi.fn<(id: string, patch: object) => Promise<void>>(() => Promise.resolve()),
    remove: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
    relay: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
    unrelay: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
    notify: vi.fn(),
  };
  const props = { hooks, signedIn: true, loaded: true, error: null, project: "/dev/app", folders: ["/dev/app"], ...over, ...calls };
  const view = render(<WebhooksDrawer {...props} />);
  return { ...calls, view, rerender: (next: Partial<typeof props>) => view.rerender(<WebhooksDrawer {...props} {...next} />) };
}

const scroll = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = scroll;
});
afterEach(() => vi.useRealTimers());

describe("WebhooksDrawer", () => {
  it("says it is loading", () => {
    setup([], { loaded: false });
    expect(screen.getByText("Loading webhooks…")).toBeInTheDocument();
  });

  it("shows a load error before anything loaded, and above the list after", () => {
    setup([], { loaded: false, error: "Server down" });
    expect(screen.getByText("Server down")).toBeInTheDocument();
  });

  it("keeps the list when a later load fails", () => {
    setup([hook()], { error: "Server down" });
    expect(screen.getByText("Server down")).toBeInTheDocument();
    expect(screen.getByText("stripe")).toBeInTheDocument();
  });

  it("asks for a project when the board has none", () => {
    setup([], { folders: [] });
    expect(screen.getByText(/Add a project to the board/)).toBeInTheDocument();
  });

  it("explains what a webhook is when there are none", () => {
    setup([]);
    expect(screen.getByText(/Threads add the webhooks your code receives/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "app" })).toBeInTheDocument();
  });

  it("lists a row with its short target, event count and blank pill", () => {
    setup([hook({ events: ["a", "b"] }), hook({ id: "w2", name: "resend", target: "http://localhost:4000/r", registered: true, deliveries: [{ at: NOW, method: "POST", status: 500, ms: 3 }] })]);
    expect(screen.getByText("/api/stripe/webhook")).toBeInTheDocument();
    expect(screen.getByText(/2 events/)).toBeInTheDocument();
    expect(screen.getAllByText("blank")).toHaveLength(1);
    expect(screen.getByText("failing")).toBeInTheDocument();
  });

  it("opens a row to copy the public URL, with its hint, secret and deliveries", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { notify } = setup([
      hook({
        url: "https://weft.zip/hook/abc",
        hint: "Stripe dashboard → Developers → Webhooks",
        secret: "STRIPE_WEBHOOK_SECRET",
        deliveries: [
          { at: NOW - 120_000, method: "POST", status: 200, ms: 5 },
          { at: NOW - 240_000, method: "POST", status: 0, ms: 1, error: "ECONNREFUSED" },
        ],
      }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: /^stripe/ }));
    expect(screen.getByText("https://weft.zip/hook/abc")).toBeInTheDocument();
    expect(screen.getByText("Stripe dashboard → Developers → Webhooks")).toBeInTheDocument();
    expect(screen.getByText("STRIPE_WEBHOOK_SECRET")).toBeInTheDocument();
    expect(screen.getByText("200 · 2m ago")).toBeInTheDocument();
    expect(screen.getByText("unreachable · 4m ago")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("https://weft.zip/hook/abc");
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Copied the public URL"));
    writeText.mockRejectedValueOnce(new Error("denied"));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.any(Error)));
    await userEvent.click(screen.getByRole("button", { name: /^stripe/ }));
    expect(screen.queryByText("https://weft.zip/hook/abc")).not.toBeInTheDocument();
  });

  it("says when no delivery has come yet", async () => {
    setup([hook({ url: "https://weft.zip/hook/abc" })]);
    await userEvent.click(screen.getByRole("button", { name: /^stripe/ }));
    expect(screen.getByText("None yet.")).toBeInTheDocument();
  });

  it("gets a public URL, and stops the relay", async () => {
    const { relay, unrelay, rerender } = setup([hook()]);
    await userEvent.click(screen.getByRole("button", { name: /^stripe/ }));
    await userEvent.click(screen.getByRole("button", { name: "Get a public URL" }));
    expect(relay).toHaveBeenCalledWith("w1");
    rerender({ hooks: [hook({ url: "https://weft.zip/hook/abc" })] });
    await userEvent.click(screen.getByRole("button", { name: "Stop relay" }));
    expect(unrelay).toHaveBeenCalledWith("w1");
  });

  it("asks to sign in when there's no Weft account", async () => {
    setup([hook()], { signedIn: false });
    await userEvent.click(screen.getByRole("button", { name: /^stripe/ }));
    expect(screen.getByRole("button", { name: "Get a public URL" })).toBeDisabled();
    expect(screen.getByText(/Sign in to your Weft account/)).toBeInTheDocument();
  });

  it("toggles registered", async () => {
    const { update, rerender } = setup([hook()]);
    await userEvent.click(screen.getByRole("button", { name: /^stripe/ }));
    await userEvent.click(screen.getByRole("button", { name: "Mark registered" }));
    expect(update).toHaveBeenCalledWith("w1", { registered: true });
    rerender({ hooks: [hook({ registered: true })] });
    await userEvent.click(screen.getByRole("button", { name: "Not registered" }));
    expect(update).toHaveBeenLastCalledWith("w1", { registered: false });
  });

  it("toasts a call that fails", async () => {
    const { update, notify } = setup([hook()]);
    update.mockRejectedValueOnce(new Error("Not found"));
    await userEvent.click(screen.getByRole("button", { name: /^stripe/ }));
    await userEvent.click(screen.getByRole("button", { name: "Mark registered" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: "Not found" })));
  });

  it("removes after the countdown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { remove, notify } = setup([hook()]);
    await userEvent.click(screen.getByRole("button", { name: /^stripe/ }));
    await userEvent.click(screen.getByRole("button", { name: "Remove stripe" }));
    const confirm = screen.getByRole("button", { name: "Confirm removing stripe" });
    await userEvent.click(confirm);
    expect(remove).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(3200));
    await userEvent.click(screen.getByRole("button", { name: "Confirm removing stripe" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("w1"));
    expect(notify).toHaveBeenCalledWith("Removed stripe");
  });

  it("adds a webhook by hand and opens its row", async () => {
    const { add, notify } = setup([]);
    await userEvent.click(screen.getByRole("button", { name: /Add$/ }));
    const submit = screen.getByRole("button", { name: "Add webhook" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "stripe");
    await userEvent.type(screen.getByLabelText("Local route"), "/api/stripe/webhook");
    await userEvent.type(screen.getByLabelText("Events"), "a, b");
    await userEvent.type(screen.getByLabelText("Signing secret's name"), "9x");
    expect(screen.getByText(/not starting with a digit/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Signing secret's name"));
    await userEvent.type(screen.getByLabelText("Where to register it"), "Stripe dashboard");
    await userEvent.type(screen.getByLabelText("Signing secret's name"), "STRIPE_WEBHOOK_SECRET{Enter}");
    expect(add).toHaveBeenCalledWith({ folder: "/dev/app", name: "stripe", target: "/api/stripe/webhook", events: ["a", "b"], hint: "Stripe dashboard", secret: "STRIPE_WEBHOOK_SECRET" });
    await waitFor(() => expect(screen.queryByLabelText("Name")).not.toBeInTheDocument());
    expect(notify).not.toHaveBeenCalled();
  });

  it("says when the webhook was already there, and can cancel the form", async () => {
    const { add, notify } = setup([]);
    add.mockResolvedValueOnce({ hook: hook(), existed: true });
    await userEvent.click(screen.getByRole("button", { name: /Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Add$/ }));
    await userEvent.type(screen.getByLabelText("Name"), "stripe");
    await userEvent.type(screen.getByLabelText("Local route"), "/x");
    await userEvent.click(screen.getByRole("button", { name: "Add webhook" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("stripe was already here; opened it"));
  });

  it("filters by project, following the top bar until you pick", async () => {
    const hooks = [hook(), hook({ id: "w2", folder: "/dev/api", name: "resend" })];
    const { rerender } = setup(hooks, { folders: ["/dev/app", "/dev/api"] });
    expect(screen.queryByText("resend")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Filter by project"), "");
    expect(screen.getByText("resend")).toBeInTheDocument();
    expect(screen.getByText("stripe")).toBeInTheDocument();
    rerender({ project: "/dev/api" });
    expect(screen.queryByText("stripe")).not.toBeInTheDocument();
    rerender({ project: null });
    expect(screen.getByText("stripe")).toBeInTheDocument();
  });

  it("opens the webhook a thread asked about, in its project, ringed", async () => {
    const hooks = [hook(), hook({ id: "w2", folder: "/dev/api", name: "resend", url: "https://weft.zip/hook/r" })];
    setup(hooks, { folders: ["/dev/app", "/dev/api"] });
    act(() => addWebhookAsk(vi.fn(), { folder: "/dev/api", id: "w2" }));
    expect(await screen.findByText("https://weft.zip/hook/r")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^resend/ }).parentElement).toHaveClass("ring-accent");
    expect(scroll).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^resend/ }));
    expect(screen.getByRole("button", { name: /^resend/ }).parentElement).not.toHaveClass("ring-accent");
  });

  it("asks for a fresh list when the asked webhook isn't in it yet, and opens it once it is", async () => {
    const { reload, rerender } = setup([]);
    act(() => addWebhookAsk(vi.fn(), { folder: "/dev/app", id: "w1" }));
    expect(reload).toHaveBeenCalled();
    rerender({ hooks: [hook({ url: "https://weft.zip/hook/abc" })] });
    expect(await screen.findByText("https://weft.zip/hook/abc")).toBeInTheDocument();
  });

  it("just opens when the ask names no webhook, and waits for the load", () => {
    const { rerender } = setup([hook()], { loaded: false });
    act(() => addWebhookAsk(vi.fn()));
    rerender({ loaded: true });
    expect(screen.getByText("stripe")).toBeInTheDocument();
  });

  it("shows a worker project's own webhooks to mark registered or remove, but no relay, tunnel or Add of this Mac's", async () => {
    const folder = "worker://w1/app";
    const { update } = setup([hook({ id: "worker:w1:h1", folder, worker: "mini" }), hook({ id: "worker:w1:h2", folder, name: "resend", worker: "mini", url: "https://weft.zip/hook/r" })], { project: folder, folders: [folder] });
    expect(screen.queryByRole("button", { name: /Add$/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^stripe/ }));
    expect(screen.queryByRole("button", { name: "Get a public URL" })).not.toBeInTheDocument();
    expect(screen.getByText("A thread on its worker gets it a public URL.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark registered" }));
    expect(update).toHaveBeenCalledWith("worker:w1:h1", { registered: true });
    await userEvent.click(screen.getByRole("button", { name: /^resend/ }));
    expect(screen.getByText("https://weft.zip/hook/r")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop relay" })).not.toBeInTheDocument();
  });

  it("serves an ask that names no webhook once loaded", () => {
    setup([hook()]);
    act(() => addWebhookAsk(vi.fn()));
    expect(screen.queryByText("Get a public URL")).not.toBeInTheDocument();
  });
});
