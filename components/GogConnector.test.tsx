// @vitest-environment jsdom
// Settings → Connectors → Google Workspace: gog's status, its OAuth client, the accounts it holds
// and the browser sign-in.
//
// The API is a fake (api.gogStatus / api.gog) so no gog CLI is needed here; the file picker is
// driven through the hidden input the "Choose JSON…" button opens.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GogStatus } from "@/lib/gog-view";
import "./test-utils";
import GogConnector from "./GogConnector";

const api = vi.hoisted(() => ({ gogStatus: vi.fn(), gog: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

const CONSOLE_URL = "https://console.cloud.google.com/apis/credentials";
const GUIDE_URL = "https://github.com/steipete/gogcli#readme";

type Ready = Extract<GogStatus, { installed: true }>;

function ready(over: Partial<Ready> = {}): Ready {
  return { installed: true, version: "0.9.0", bundled: true, outdated: false, ownClient: false, weftClient: false, accounts: [], adding: null, lastError: null, ...over };
}

// Renders the connector with a status the first fetch resolves to.
function setup(status: GogStatus) {
  api.gogStatus.mockResolvedValue(status);
  const utils = render(<GogConnector titleClass="title" hintClass="hint" />);
  return utils;
}

// The connector's own file input is CSS-hidden, so it is found by its type, not by role.
function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  return input;
}

const openExternal = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  api.gogStatus.mockResolvedValue(ready());
  api.gog.mockResolvedValue(ready());
  window.weft = { openExternal } as unknown as typeof window.weft;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GogConnector", () => {
  it("checks gog first, then shows what it found", async () => {
    setup(ready());
    expect(screen.getByText("Checking gog")).toBeInTheDocument();
    expect(await screen.findByText(/gog 0\.9\.0/)).toBeInTheDocument();
    expect(api.gogStatus).toHaveBeenCalledTimes(1);
  });

  it("says so when the check fails", async () => {
    api.gogStatus.mockRejectedValue(new Error("no such binary"));
    render(<GogConnector titleClass="title" hintClass="hint" />);
    expect(await screen.findByText(/Couldn't check gog/)).toHaveTextContent("no such binary");
  });

  it("says gog isn't on the PATH when it isn't installed", async () => {
    setup({ installed: false });
    expect(await screen.findByText(/isn't on this app's PATH/)).toBeInTheDocument();
    expect(screen.getByText("brew install gogcli")).toBeInTheDocument();
  });

  it("says whether gog is the copy Weft ships or the user's own", async () => {
    setup(ready({ bundled: true }));
    expect(await screen.findByText(/shipped with Weft/)).toBeInTheDocument();
    setup(ready({ bundled: false }));
    expect(await screen.findByText(/your own install/)).toBeInTheDocument();
  });

  it("tells the user to upgrade an outdated gog, and hides the read-only box", async () => {
    api.gogStatus.mockResolvedValue(ready({ outdated: true, ownClient: true }));
    render(<GogConnector titleClass="title" hintClass="hint" />);
    expect(await screen.findByText("brew upgrade gogcli")).toBeInTheDocument();
    // --readonly needs a newer gog, so the box isn't offered.
    expect(screen.queryByLabelText("Read-only")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("offers the read-only box when gog is current", async () => {
    setup(ready({ ownClient: true }));
    expect(await screen.findByRole("checkbox", { name: "Read-only" })).toBeInTheDocument();
  });

  it("asks for an OAuth client when none is stored", async () => {
    setup(ready({ ownClient: false }));
    expect(await screen.findByRole("button", { name: "Choose JSON…" })).toBeInTheDocument();
    expect(screen.getByText("create one")).toBeInTheDocument();
    expect(screen.getByText("Setup guide")).toBeInTheDocument();
  });

  it("sends the chosen client JSON to gog", async () => {
    api.gog.mockResolvedValue(ready({ ownClient: true }));
    const { container } = setup(ready({ ownClient: false }));
    // The picker only exists once the status has loaded.
    const input = await waitFor(() => fileInput(container));
    const file = new File(['{"installed":{"client_id":"abc"}}'], "client_secret.json", { type: "application/json" });
    await userEvent.upload(input, file);
    await waitFor(() =>
      expect(api.gog).toHaveBeenCalledWith({ action: "credentials", json: '{"installed":{"client_id":"abc"}}' }),
    );
  });

  it("shows the sign-in form once a client is stored, and signs an account in", async () => {
    api.gog.mockResolvedValue(ready({ ownClient: true, accounts: [{ email: "me@gmail.com", client: "default" }] }));
    const { container } = setup(ready({ ownClient: true }));
    const email = await screen.findByLabelText("Google account email");
    await userEvent.type(email, "me@gmail.com");
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(api.gog).toHaveBeenCalledWith({ action: "add", email: "me@gmail.com", readonly: false }));
    // The address is gone from the box now.
    expect(screen.getByLabelText<HTMLInputElement>("Google account email").value).toBe("");
    expect(fileInput(container)).toBeInTheDocument();
  });

  it("passes the read-only choice with the sign-in", async () => {
    api.gog.mockResolvedValue(ready({ ownClient: true }));
    setup(ready({ ownClient: true }));
    await userEvent.type(await screen.findByLabelText("Google account email"), "me@gmail.com");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Read-only" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(api.gog).toHaveBeenCalledWith({ action: "add", email: "me@gmail.com", readonly: true }));
  });

  it("keeps the address when the sign-in fails", async () => {
    api.gog.mockRejectedValue(new Error("gog isn't on the PATH."));
    setup(ready({ ownClient: true }));
    const email = await screen.findByLabelText("Google account email");
    await userEvent.type(email, "me@gmail.com");
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(await screen.findByText("gog isn't on the PATH.")).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLInputElement>("Google account email").value).toBe("me@gmail.com");
  });

  it("lists the accounts gog holds, and removes one", async () => {
    api.gog.mockResolvedValue(ready({ ownClient: true, accounts: [] }));
    setup(
      ready({
        ownClient: true,
        accounts: [
          { email: "me@gmail.com", client: "default" },
          { email: "work@gmail.com", client: "work" },
        ],
      }),
    );
    expect(await screen.findByText("me@gmail.com")).toBeInTheDocument();
    // Only a non-default OAuth client is named.
    expect(screen.queryByText("default")).not.toBeInTheDocument();
    expect(screen.getByText("work")).toBeInTheDocument();
    expect(screen.getByText("work@gmail.com")).toBeInTheDocument();
    const removes = screen.getAllByRole("button", { name: "Remove" });
    await userEvent.click(removes[0]!);
    await waitFor(() => expect(api.gog).toHaveBeenCalledWith({ action: "remove", email: "me@gmail.com", client: "default" }));
  });

  it("waits for the browser sign-in, and can be cancelled", async () => {
    api.gogStatus.mockResolvedValue(ready({ ownClient: true, adding: "me@gmail.com" }));
    api.gog.mockResolvedValue(ready({ ownClient: true }));
    setup(ready({ ownClient: true, adding: "me@gmail.com" }));
    expect(await screen.findByText(/Finish signing in me@gmail\.com in your browser/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.gog).toHaveBeenCalledWith({ action: "cancel" }));
  });

  it("asks again every 2 s while the browser sign-in is under way", async () => {
    vi.useFakeTimers();
    api.gogStatus.mockResolvedValue(ready({ ownClient: true, adding: "me@gmail.com" }));
    setup(ready({ ownClient: true, adding: "me@gmail.com" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api.gogStatus).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.gogStatus).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.gogStatus).toHaveBeenCalledTimes(3);
  });

  it("shows the error of a sign-in that failed", async () => {
    setup(ready({ ownClient: true, lastError: "consent denied" }));
    expect(await screen.findByText(/Sign-in failed:/)).toHaveTextContent("consent denied");
  });

  it("checks again on Refresh", async () => {
    setup(ready());
    await screen.findByText(/gog 0\.9\.0/);
    api.gogStatus.mockResolvedValue(ready({ version: "1.2.3" }));
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText(/gog 1\.2\.3/)).toBeInTheDocument();
    expect(api.gogStatus).toHaveBeenCalledTimes(2);
  });

  it("opens Google's console and the setup guide in the browser pane", async () => {
    setup(ready({ ownClient: false }));
    await userEvent.click(await screen.findByText("create one"));
    expect(openExternal).toHaveBeenCalledWith(CONSOLE_URL);
    await userEvent.click(screen.getByText("Setup guide"));
    expect(openExternal).toHaveBeenCalledWith(GUIDE_URL);
  });

  it("signs in straight away when this build carries Weft's own client", async () => {
    setup(ready({ ownClient: false, weftClient: true }));
    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    // The user isn't asked to bring a client JSON: Weft's own client is used.
    expect(screen.queryByRole("button", { name: "Choose JSON…" })).not.toBeInTheDocument();
  });

  it("offers the user's own client as an option under Weft's client", async () => {
    const { container } = setup(ready({ ownClient: false, weftClient: true }));
    expect(await screen.findByText(/use your own OAuth client/)).toBeInTheDocument();
    expect(fileInput(container)).toBeInTheDocument();
  });

  it("still asks for a client when the build has none and the user has none", async () => {
    setup(ready({ ownClient: false, weftClient: false }));
    expect(await screen.findByRole("button", { name: "Choose JSON…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("removes an account through the client it signed in with", async () => {
    setup(ready({ ownClient: true, accounts: [{ email: "work@gmail.com", client: "work" }] }));
    expect(await screen.findByText("work@gmail.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.gog).toHaveBeenCalledWith({ action: "remove", email: "work@gmail.com", client: "work" }));
  });
});
