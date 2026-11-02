// @vitest-environment jsdom
// A worker's Connectors badge and menu in Settings → Devices (components/WorkerConnectors.tsx), driven with a stub of
// lib/use-worker-connectors's result: what it says in each state, and which call each control makes.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { DEFAULT_SETTINGS, type GrantSettings } from "@/lib/connector-grant";
import type { ConnectorsView, WorkerConnector } from "@/lib/connector-view";
import type { WorkerConnectors as Connectors } from "@/lib/use-worker-connectors";
import WorkerConnectors from "./WorkerConnectors";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const grant = (over: Partial<WorkerConnector> = {}): WorkerConnector => ({
  grantId: "g1",
  settings: DEFAULT_SETTINGS,
  expiresAt: null,
  lastUsedAt: null,
  lastRepo: null,
  pending: [],
  ...over,
});

function stub(view: Partial<ConnectorsView> | null, over: Partial<Connectors> = {}): Connectors {
  return {
    view: view && { signedIn: true, github: { connected: true, login: "ada" }, connectUrl: "u", workers: {}, ...view },
    error: null,
    note: null,
    canChange: true,
    reload: vi.fn(),
    connect: vi.fn(),
    set: vi.fn(() => Promise.resolve()),
    allow: vi.fn(() => Promise.resolve()),
    off: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    macs: null,
    trust: vi.fn(() => Promise.resolve()),
    forgetMac: vi.fn(() => Promise.resolve()),
    ...over,
  };
}

const show = (c: Connectors) => render(<WorkerConnectors c={c} workerId="w1" name="m1mini" now={NOW} />);
const open = () => userEvent.click(screen.getByRole("button", { name: "Connectors on m1mini" }));

describe("WorkerConnectors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows nothing until the view is in, or when you're signed out", () => {
    const { container, rerender } = show(stub(null));
    expect(container).toBeEmptyDOMElement();
    rerender(<WorkerConnectors c={stub({ signedIn: false })} workerId="w1" name="m1mini" now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says Connectors when off and GitHub ✓ when on, and opens and closes in place", async () => {
    const { rerender } = show(stub({}));
    expect(screen.getByRole("button", { name: "Connectors on m1mini" })).toHaveTextContent("Connectors");
    rerender(<WorkerConnectors c={stub({ workers: { w1: grant() } })} workerId="w1" name="m1mini" now={NOW} />);
    expect(screen.getByRole("button", { name: "Connectors on m1mini" })).toHaveTextContent("GitHub ✓");
    await open();
    expect(screen.getByRole("dialog", { name: "Connectors on m1mini" })).toBeInTheDocument();
    await open();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Connect GitHub before you've connected, with why it can't read the status", async () => {
    const c = stub({ github: { connected: false } });
    const { rerender } = show(c);
    await open();
    expect(screen.getByText("GitHub, as you with Weft")).toBeInTheDocument();
    expect(screen.getByText(/Install the Weft app on the repos you pick/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    expect(c.connect).toHaveBeenCalled();
    rerender(<WorkerConnectors c={stub({ github: { connected: false, error: "Couldn't reach weft.zip." } })} workerId="w1" name="m1mini" now={NOW} />);
    expect(screen.getByText("Couldn't reach weft.zip.")).toBeInTheDocument();
  });

  it("offers Turn on once connected, with the default settings, only from Weft's own window", async () => {
    const c = stub({});
    const { rerender } = show(c);
    await open();
    expect(screen.getByText("GitHub, as you with Weft (@ada)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(c.set).toHaveBeenCalledWith("w1", "m1mini", DEFAULT_SETTINGS);
    expect(screen.queryByText("Scope")).toBeNull();
    rerender(<WorkerConnectors c={stub({}, { canChange: false })} workerId="w1" name="m1mini" now={NOW} />);
    expect(screen.getByRole("button", { name: "Turn on" })).toBeDisabled();
  });

  it("when on: Turn off, the choices, Ask before, and when it was last used", async () => {
    const c = stub({ workers: { w1: grant({ settings: { ...DEFAULT_SETTINGS, scope: "installed" }, lastUsedAt: "2026-11-02T11:55:00Z", lastRepo: "ada/app", expiresAt: "2026-11-03T12:00:00Z" }) } }, { note: "Saved.", error: "Nope." });
    show(c);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(c.off).toHaveBeenCalledWith("w1", "m1mini");
    expect(screen.getByRole("button", { name: "All installed repos ✓" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Every repo the Weft app is installed on, as you\./)).toHaveTextContent(/Last used 5m ago on ada\/app\./);
    expect(screen.getByText(/Ends /)).toBeInTheDocument();
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    expect(screen.getByText("Nope.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Push to a protected branch" })).toBeChecked();
  });

  it("each choice sets that one setting, and the one already picked does nothing", async () => {
    const c = stub({ workers: { w1: grant() } });
    show(c);
    await open();
    const put = (patch: Partial<GrantSettings>) => expect(c.set).toHaveBeenLastCalledWith("w1", "m1mini", { ...DEFAULT_SETTINGS, ...patch });
    await userEvent.click(screen.getByRole("button", { name: "All installed repos" }));
    put({ scope: "installed" });
    await userEvent.click(screen.getByRole("button", { name: "Per card" }));
    put({ approval: "card" });
    await userEvent.click(screen.getByRole("button", { name: "8 hours" }));
    put({ lifetime: "8h" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Push to a protected branch" }));
    put({ asks: [] });
    const calls = vi.mocked(c.set).mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Until revoked ✓" }));
    expect(c.set).toHaveBeenCalledTimes(calls);
  });

  it("adds an ask back, and says a narrower scope, no last use and no end", async () => {
    const c = stub({ workers: { w1: grant({ settings: { ...DEFAULT_SETTINGS, scope: "card", asks: [] } }) } });
    show(c);
    await open();
    expect(screen.getByText(/One repo per token, still as you\./)).toHaveTextContent(/Not used yet\./);
    expect(screen.queryByText(/Ends /)).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Push to a protected branch" }));
    expect(c.set).toHaveBeenCalledWith("w1", "m1mini", { ...DEFAULT_SETTINGS, scope: "card", asks: ["protected_push"] });
  });

  it("says when it was last used without a repo", async () => {
    show(stub({ workers: { w1: grant({ lastUsedAt: "2026-11-02T11:55:00Z" }) } }));
    await open();
    expect(screen.getByText(/Last used 5m ago\./)).toBeInTheDocument();
  });

  it("lists what's waiting for an Allow, and allows it", async () => {
    const p = { kind: "card" as const, subject: "c1", label: "Fix the login" };
    const c = stub({ workers: { w1: grant({ pending: [p, { kind: "card", subject: "c2", label: "c2" }] }) } });
    show(c);
    await open();
    expect(screen.getByText("Waiting: card Fix the login")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Allow" })[0]!);
    expect(c.allow).toHaveBeenCalledWith("m1mini", "g1", p);
  });

  it("says when this Mac's key starts to count, and offers to trust or remove another waiting Mac", async () => {
    const mac = (id: string, trusted: boolean) => ({ id, key: `k${id}`, name: `Mac ${id}`, addedAt: "2026-11-02T10:00:00Z", trustedFrom: "2026-11-03T10:00:00Z", trusted });
    const waiting = stub({}, { macs: { mine: "k1", signers: [mac("1", false), mac("2", false)] } });
    const { rerender } = show(waiting);
    await open();
    expect(screen.getByText(/This Mac can approve connectors once you open the link Weft emailed you/)).toBeInTheDocument();
    expect(screen.getByText("Mac Mac 2, added 2h ago, waiting")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trust" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(waiting.forgetMac).toHaveBeenCalledWith(mac("2", false));
    const trusted = stub({}, { macs: { mine: "k1", signers: [mac("1", true), mac("2", false)] } });
    rerender(<WorkerConnectors c={trusted} workerId="w1" name="m1mini" now={NOW} />);
    expect(screen.queryByText(/This Mac can approve connectors once/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Trust" }));
    expect(trusted.trust).toHaveBeenCalledWith(mac("2", false));
    rerender(<WorkerConnectors c={stub({}, { macs: { mine: "k9", signers: [] } })} workerId="w1" name="m1mini" now={NOW} />);
    expect(screen.queryByText(/approve connectors/)).toBeNull();
  });

  it("disables every change outside Weft's own window", async () => {
    show(stub({ workers: { w1: grant({ pending: [{ kind: "project", subject: "ada/app", label: "ada/app" }] }) } }, { canChange: false }));
    await open();
    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Per card" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Push to a protected branch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeEnabled();
  });
});
