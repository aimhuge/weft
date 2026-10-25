// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelBridge, VercelEnvStatus, VercelPushAllResult } from "@/lib/vercel-view";
import "./test-utils";

const api = vi.hoisted(() => ({
  vercelHooks: vi.fn(() => Promise.resolve({ signedIn: true, teams: [] as string[] })),
  addVercelHook: vi.fn(() => Promise.resolve({ team: "team_a" })),
  removeVercelHook: vi.fn(() => Promise.resolve({ ok: true as const })),
}));
vi.mock("@/lib/client", () => ({ api }));

const { default: VercelEnv } = await import("./VercelEnv");

beforeEach(() => {
  vi.clearAllMocks();
  api.vercelHooks.mockResolvedValue({ signedIn: true, teams: [] });
});

const STATUS: VercelEnvStatus = {
  label: "aimhuge/weft",
  project: "weft",
  rows: [
    { name: "SUPABASE_SECRET_KEY", environment: "production", inVault: true, onVercel: false },
    { name: "GITHUB_CLIENT_ID", environment: "production", inVault: true, onVercel: true },
    { name: "VERCEL_ONLY", environment: "preview", inVault: false, onVercel: true },
    { name: "TODO", environment: "development", inVault: false, onVercel: false },
  ],
};

const PULL_STATUS: VercelEnvStatus = {
  ...STATUS,
  rows: [STATUS.rows[1]!, { name: "FROM_VERCEL", environment: "preview", inVault: false, onVercel: true, pullable: true }, { name: "SENSITIVE", environment: "production", inVault: false, onVercel: true }],
};

function setup(over: Partial<VercelBridge> = {}, team: string | null = null) {
  const bridge = {
    envStatus: vi.fn(() => Promise.resolve(STATUS)),
    envPush: vi.fn(() => Promise.resolve({ pushed: true, project: "weft", label: "aimhuge/weft" })),
    ...over,
  } as unknown as VercelBridge;
  const notify = vi.fn();
  render(<VercelEnv folder="/dev/weft" team={team} bridge={bridge} notify={notify} />);
  return { bridge, notify };
}

describe("VercelEnv", () => {
  it("asks for a restart when main is older than env push", () => {
    setup({ envStatus: undefined });
    expect(screen.getByText("Restart Weft to push 🔐 secrets to Vercel")).toBeInTheDocument();
  });

  it("lists each vault name against Vercel, open when something's left to push", async () => {
    setup();
    expect(screen.getByText("Secrets: checking…")).toBeInTheDocument();
    expect(await screen.findByText("1 on Vercel not in vault · 1 missing on production: push?")).toBeInTheDocument();
    expect(screen.getByText("Vercel only")).toBeInTheDocument();
    expect(screen.getByText("no value")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /missing on production/ }));
    expect(screen.queryByText("SUPABASE_SECRET_KEY")).not.toBeInTheDocument();
  });

  it("filters a long list by name and state", async () => {
    const extra = ["NEXT_PUBLIC_POSTHOG_KEY", "CRON_SECRET"].map((name) => ({ name, environment: "development" as const, inVault: name !== "CRON_SECRET", onVercel: false }));
    setup({ envStatus: vi.fn(() => Promise.resolve({ ...STATUS, rows: [...STATUS.rows, ...extra] })) });
    const box = await screen.findByRole("textbox", { name: "Filter variables" });
    await userEvent.type(box, "posthog");
    expect(screen.getByText("NEXT_PUBLIC_POSTHOG_KEY")).toBeInTheDocument();
    expect(screen.queryByText("SUPABASE_SECRET_KEY")).not.toBeInTheDocument();
    await userEvent.type(box, "{Escape}");
    expect(box).toHaveValue("");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Show" }), "noValue");
    expect(screen.getByText("CRON_SECRET")).toBeInTheDocument();
    expect(screen.queryByText("GITHUB_CLIENT_ID")).not.toBeInTheDocument();
    await userEvent.type(box, "zzz");
    expect(screen.getByText("No variables match")).toBeInTheDocument();
  });

  it("has no filter on a short list", async () => {
    setup();
    await screen.findByText("SUPABASE_SECRET_KEY");
    expect(screen.queryByRole("textbox", { name: "Filter variables" })).not.toBeInTheDocument();
  });

  it("pushes one and reloads", async () => {
    const { bridge, notify } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Push" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Pushed SUPABASE_SECRET_KEY to weft (production). It's live from the next deploy"));
    expect(bridge.envPush).toHaveBeenCalledWith("/dev/weft", "SUPABASE_SECRET_KEY", "production");
    expect(bridge.envStatus).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "on Vercel · push again" }));
    await waitFor(() => expect(bridge.envPush).toHaveBeenCalledWith("/dev/weft", "GITHUB_CLIENT_ID", "production"));
  });

  it("toasts a failed push and shows a failed load", async () => {
    const { notify } = setup({ envPush: vi.fn(() => Promise.reject(new Error("Vercel answered 500."))) });
    await userEvent.click(await screen.findByRole("button", { name: "Push" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("Vercel answered 500.")));
  });

  it("shows why the variables couldn't be read", async () => {
    setup({ envStatus: vi.fn(() => Promise.reject(new Error("not linked"))) });
    expect(await screen.findByText("Secrets: not linked")).toBeInTheDocument();
  });

  it("starts closed when everything is on Vercel", async () => {
    setup({ envStatus: vi.fn(() => Promise.resolve({ ...STATUS, rows: [STATUS.rows[1]!] })) });
    expect(await screen.findByText("All 1 vault secret is on Vercel")).toBeInTheDocument();
    expect(screen.queryByText("GITHUB_CLIENT_ID")).not.toBeInTheDocument();
  });

  describe("push all", () => {
    const all = (result: VercelPushAllResult = { label: "aimhuge/weft", project: "weft", sent: [{ name: "A", environment: "production" }, { name: "B", environment: "preview" }], failed: [] }) => ({
      envPushAll: vi.fn(() => Promise.resolve(result)),
    });

    it("pushes every vault value behind one call, toasts and reloads", async () => {
      const over = all();
      const { bridge, notify } = setup(over);
      await userEvent.click(await screen.findByRole("button", { name: "Push all" }));
      await waitFor(() => expect(notify).toHaveBeenCalledWith("Pushed 2 secrets to weft. Live from the next deploy"));
      expect(over.envPushAll).toHaveBeenCalledWith("/dev/weft");
      expect(bridge.envStatus).toHaveBeenCalledTimes(2);
    });

    it("shows Pushing… while it works, then toasts a failure", async () => {
      let fail: (e: Error) => void = () => undefined;
      const { notify } = setup({ envPushAll: vi.fn(() => new Promise<never>((_, reject) => (fail = reject))) });
      await userEvent.click(await screen.findByRole("button", { name: "Push all" }));
      expect(screen.getByText("Pushing…", { selector: "button[title^='Send every']" })).toBeDisabled();
      fail(new Error("Vercel answered 500."));
      await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("Vercel answered 500.")));
      expect(await screen.findByRole("button", { name: "Push all" })).toBeEnabled();
    });

    it("hides with nothing in the vault", async () => {
      setup({ ...all(), envStatus: vi.fn(() => Promise.resolve({ ...STATUS, rows: [STATUS.rows[2]!] })) });
      await screen.findByText("1 on Vercel not in vault");
      expect(screen.queryByRole("button", { name: "Push all" })).not.toBeInTheDocument();
    });

    it("hides on a main that started before Push all", async () => {
      setup();
      await screen.findByText("1 on Vercel not in vault · 1 missing on production: push?");
      expect(screen.queryByRole("button", { name: "Push all" })).not.toBeInTheDocument();
    });
  });

  describe("pull", () => {
    const pullBridge = (result = { label: "aimhuge/weft", project: "weft", pulled: [{ name: "FROM_VERCEL", environment: "preview" as const }], skipped: [] as { name: string; environment: "production" }[] }) => ({
      envStatus: vi.fn(() => Promise.resolve(PULL_STATUS)),
      envPull: vi.fn(() => Promise.resolve(result)),
    });

    it("offers a pull only on a Vercel-only row Vercel will hand back, open by itself", async () => {
      setup(pullBridge());
      expect(await screen.findByRole("button", { name: "Vercel only · pull" })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Vercel only · pull" })).toHaveLength(1);
      expect(screen.getByText("Vercel only")).toBeInTheDocument();
      expect(screen.getByText("FROM_VERCEL")).toBeInTheDocument();
    });

    it("shows a plain Vercel only label when this main can't pull", async () => {
      setup({ envPull: undefined, envStatus: vi.fn(() => Promise.resolve(PULL_STATUS)) });
      await screen.findByText("FROM_VERCEL");
      expect(screen.queryByRole("button", { name: "Vercel only · pull" })).not.toBeInTheDocument();
      expect(screen.getAllByText("Vercel only")).toHaveLength(2);
    });

    it("pulls, toasts what came down, and reloads", async () => {
      const bridge = pullBridge();
      const { notify } = setup(bridge);
      await userEvent.click(await screen.findByRole("button", { name: "Vercel only · pull" }));
      await waitFor(() => expect(notify).toHaveBeenCalledWith("Pulled FROM_VERCEL into the aimhuge/weft vault"));
      expect(bridge.envPull).toHaveBeenCalledWith("/dev/weft");
      expect(bridge.envStatus).toHaveBeenCalledTimes(2);
    });

    it("toasts nothing new and the sensitive names left to add by hand", async () => {
      const { notify } = setup(pullBridge({ label: "aimhuge/weft", project: "weft", pulled: [], skipped: [{ name: "SENSITIVE", environment: "production" }] }));
      await userEvent.click(await screen.findByRole("button", { name: "Vercel only · pull" }));
      await waitFor(() => expect(notify).toHaveBeenCalledWith("Nothing new to pull from weft. Sensitive on Vercel, add by hand: SENSITIVE"));
    });

    it("shows Pulling… while it works, then toasts a failure", async () => {
      let fail: (e: Error) => void = () => undefined;
      const bridge = { ...pullBridge(), envPull: vi.fn(() => new Promise<never>((_, reject) => (fail = reject))) };
      const { notify } = setup(bridge);
      await userEvent.click(await screen.findByRole("button", { name: "Vercel only · pull" }));
      expect(await screen.findByRole("button", { name: "Pulling…" })).toBeDisabled();
      fail(new Error("Vercel answered 500."));
      await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("Vercel answered 500.")));
      expect(await screen.findByRole("button", { name: "Vercel only · pull" })).toBeEnabled();
    });
  });

  describe("live pull", () => {
    const bridge = () => ({ envStatus: vi.fn(() => Promise.resolve(PULL_STATUS)), envPull: vi.fn() });

    it("is off the list for a personal account, or a main that can't pull, without asking", async () => {
      setup(bridge(), "u_1");
      await screen.findByText("FROM_VERCEL");
      setup({ envStatus: vi.fn(() => Promise.resolve(PULL_STATUS)), envPull: undefined }, "team_a");
      await screen.findAllByText("FROM_VERCEL");
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
      expect(api.vercelHooks).not.toHaveBeenCalled();
    });

    it("is hidden when there's no Weft account to relay it, or the lookup fails", async () => {
      api.vercelHooks.mockResolvedValueOnce({ signedIn: false, teams: [] });
      setup(bridge(), "team_a");
      await screen.findByText("FROM_VERCEL");
      await waitFor(() => expect(api.vercelHooks).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    });

    it("stays hidden when the hook lookup fails", async () => {
      api.vercelHooks.mockRejectedValueOnce(new Error("down"));
      setup(bridge(), "team_a");
      await screen.findByText("FROM_VERCEL");
      await waitFor(() => expect(api.vercelHooks).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    });

    it("shows off for a team with no hook, and turns it on, then reloads", async () => {
      const b = bridge();
      const { notify } = setup(b, "team_a");
      const toggle = await screen.findByRole("switch");
      expect(screen.getByText("Live pull from Vercel")).toBeInTheDocument();
      expect(toggle).toHaveAttribute("aria-checked", "false");
      expect(toggle).toHaveTextContent("off");
      await userEvent.click(toggle);
      await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true"));
      expect(api.addVercelHook).toHaveBeenCalledWith("/dev/weft");
      expect(screen.getByRole("switch")).toHaveTextContent("on");
      expect(notify).toHaveBeenCalledWith("Live pull is on: new plain Vercel variables come into the vault as they're added");
      expect(b.envStatus).toHaveBeenCalledTimes(2);
    });

    it("shows on for a team that has a hook, and turns it off", async () => {
      api.vercelHooks.mockResolvedValue({ signedIn: true, teams: ["team_a"] });
      const { notify } = setup(bridge(), "team_a");
      const toggle = await screen.findByRole("switch");
      await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
      await userEvent.click(toggle);
      await waitFor(() => expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false"));
      expect(api.removeVercelHook).toHaveBeenCalledWith("/dev/weft");
      expect(api.addVercelHook).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith("Live pull is off: pull new Vercel variables by hand");
    });

    it("toasts a failure and leaves the switch where it was", async () => {
      api.addVercelHook.mockRejectedValueOnce(new Error("Sign in to Weft first"));
      const { notify } = setup(bridge(), "team_a");
      await userEvent.click(await screen.findByRole("switch"));
      await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("Sign in to Weft first")));
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
      expect(screen.getByRole("switch")).toBeEnabled();
    });

    it("is hidden while the list is closed", async () => {
      setup({ envStatus: vi.fn(() => Promise.resolve({ ...STATUS, rows: [STATUS.rows[1]!] })), envPull: vi.fn() }, "team_a");
      await screen.findByText("All 1 vault secret is on Vercel");
      await waitFor(() => expect(api.vercelHooks).toHaveBeenCalled());
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    });
  });
});
