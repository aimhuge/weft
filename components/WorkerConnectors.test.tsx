// @vitest-environment jsdom
// A paired worker's connectors on Settings → Devices (components/WorkerConnectors.tsx, lib/use-worker-connectors.ts):
// toggles on the worker's row that go through main (Touch ID there), Google's account picked from gog's on this Mac.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { DeviceView } from "@/lib/device-registry";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));

const { default: WorkerConnectors } = await import("./WorkerConnectors");
const { useWorkerConnectors, toggleOutcome, connectorsBridge } = await import("@/lib/use-worker-connectors");

const worker: DeviceView = { id: "w1", kind: "worker", name: "m1mini", platform: "darwin", orgId: "o", host: "h", hasBoxKey: true, hasSignKey: true, hasPasskey: false, approves: false, fingerprint: "fp", status: "online", lastSeenAt: null, revokedAt: null, here: false };
const gogStatus = (emails: string[]) => Promise.resolve(new Response(JSON.stringify({ installed: true, accounts: emails.map((email) => ({ email, client: "default" })) }), { status: 200 }));

type Lent = { workerId: string; connector: "gog" | "gh"; account: string; since: string };
let lent: Lent[];
let bridge: { list: ReturnType<typeof vi.fn>; enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn> };

function Harness({ device = worker }: { device?: DeviceView }) {
  const connectors = useWorkerConnectors();
  return (
    <>
      <WorkerConnectors device={device} connectors={connectors} />
      {connectors.note && <p>{connectors.note}</p>}
    </>
  );
}

beforeEach(() => {
  lent = [];
  apiFetch.mockReset();
  apiFetch.mockImplementation(() => gogStatus(["me@example.com", "work@example.com"]));
  bridge = {
    list: vi.fn(() => Promise.resolve(lent)),
    enable: vi.fn((workerId: string, connector: "gog" | "gh", account?: string) => {
      lent = [...lent, { workerId, connector, account: account ?? "octocat", since: "now" }];
      return Promise.resolve({ enabled: true, account: account ?? "octocat" });
    }),
    disable: vi.fn(() => {
      lent = [];
      return Promise.resolve({ disabled: true });
    }),
  };
  (window as unknown as { weft: unknown }).weft = { hostPairing: { connectors: bridge } };
});
afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("WorkerConnectors", () => {
  it("lends Google as the account picked, then takes it back", async () => {
    render(<Harness />);
    const pick = await screen.findByRole("combobox", { name: "Google account" });
    await userEvent.selectOptions(pick, "work@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Google" }));
    expect(bridge.enable).toHaveBeenCalledWith("w1", "gog", "work@example.com");
    expect(await screen.findByText("m1mini's cards can use Google as work@example.com.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Google" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByRole("combobox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Google" }));
    expect(bridge.disable).toHaveBeenCalledWith("w1", "gog");
    expect(await screen.findByText("Google is off for m1mini; it forgets the token.")).toBeInTheDocument();
  });

  it("lends GitHub with gh's own account, and says when main refuses", async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByRole("button", { name: "GitHub" }));
    expect(bridge.enable).toHaveBeenCalledWith("w1", "gh", undefined);
    bridge.disable.mockRejectedValueOnce(new Error("Couldn't send it to m1mini: offline"));
    await waitFor(() => expect(screen.getByRole("button", { name: "GitHub" })).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(screen.getByRole("button", { name: "GitHub" }));
    expect(await screen.findByText("Couldn't send it to m1mini: offline")).toBeInTheDocument();
    bridge.enable.mockRejectedValueOnce("plain");
    lent = [];
    bridge.list.mockResolvedValueOnce([]);
  });

  it("can't lend Google with no account signed in, and shows nothing for a token-enrolled worker or without main", async () => {
    apiFetch.mockImplementation(() => Promise.resolve(new Response("nope", { status: 500 })));
    const { unmount } = render(<Harness />);
    expect(await screen.findByRole("button", { name: "Google" })).toBeDisabled();
    unmount();
    const { container } = render(<Harness device={{ ...worker, hasSignKey: false }} />);
    expect(container.textContent).toBe("");
    delete (window as unknown as { weft?: unknown }).weft;
    expect(connectorsBridge()).toBeUndefined();
  });

  it("says a no and a note", () => {
    expect(toggleOutcome("m1mini", "gh", { denied: true })).toBe("GitHub wasn't lent to m1mini.");
    expect(toggleOutcome("m1mini", "gh", { disabled: true, note: "m1mini was revoked." })).toBe("GitHub is off for m1mini. m1mini was revoked.");
    expect(toggleOutcome("m1mini", "gh", { enabled: true })).toBe("m1mini's cards can use GitHub as you.");
  });
});
