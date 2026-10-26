// @vitest-environment jsdom
// The left rail's admin group: rendered when the signed-in Weft account is
// on the platform super-admin allowlist, hidden otherwise. Every other
// rail hook (vault, webhooks, vercel, supabase, cloudflare, blastcp, github, slack)
// is mocked to a no-op so the rail's many consumers don't drag their data
// layers into this test.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

// vi.mock is hoisted above the import, so the factory can't reference
// variables declared with `const` at module top. vi.hoisted() hoists the
// definition too, making the binding visible to the factory. The data hooks
// each return { hooks: [], ... } (or equivalent); `hooks: []` covers every
// `.filter((h) => h.folder === ...)` the rail does, and the rest of the
// shape is defaulted to safe values.
const { useSuperAdminGate, noopDataHook, push } = vi.hoisted(() => ({
  useSuperAdminGate: vi.fn(() => false),
  noopDataHook: () => ({ hooks: [], projects: [], links: [], repos: [], items: [], data: [], error: null, signedIn: false, loaded: false }),
  push: vi.fn(),
}));
vi.mock("@/lib/use-admin-gate", () => ({ useSuperAdminGate }));
// The rail's Admin icon uses next/navigation's useRouter().push — we capture
// the call so the test can assert the destination.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// The noop data hook comes from vi.hoisted above (it must be visible to the
// vi.mock factories below, which are hoisted above this file's top-level
// imports). All the data hooks use it.
vi.mock("@/lib/use-vault", () => ({ useVault: vi.fn(noopDataHook) }));
vi.mock("@/lib/use-webhooks", () => ({ useWebhooks: vi.fn(noopDataHook) }));
vi.mock("@/lib/use-vercel", () => ({ useVercel: vi.fn(noopDataHook) }));
vi.mock("@/lib/use-supabase", () => ({ useSupabase: vi.fn(noopDataHook) }));
vi.mock("@/lib/use-blastcp", () => ({ useBlastcp: vi.fn(noopDataHook) }));
vi.mock("@/lib/use-cloudflare", () => ({ useCloudflare: vi.fn(noopDataHook) }));
vi.mock("@/lib/use-github", () => ({ useGithub: vi.fn(noopDataHook) }));
vi.mock("@/lib/use-slack", () => ({ useSlack: vi.fn(noopDataHook) }));
vi.mock("@/lib/use-crons", () => ({ useCrons: () => ({ crons: [], error: null, create: vi.fn(), update: vi.fn(), remove: vi.fn(), run: vi.fn() }) }));
vi.mock("@/lib/use-services", () => ({ useServices: () => ({ services: [], loaded: true, error: null, reload: vi.fn(), kill: vi.fn(), restart: vi.fn(), refreshMs: 2000 }) }));

// Drawers' bodies are stubs — they're gated behind their own open state and
// the test only checks the rail's nav buttons.
vi.mock("./VaultDrawer", () => ({ default: () => null }));
vi.mock("./WebhooksDrawer", () => ({ default: () => null }));
vi.mock("./VercelDrawer", () => ({ default: () => null }));
vi.mock("./SupabaseDrawer", () => ({ default: () => null }));
vi.mock("./CloudflareDrawer", () => ({ default: () => null }));
vi.mock("./BlastcpDrawer", () => ({ default: () => null }));
vi.mock("./GithubDrawer", () => ({ default: () => null }));
vi.mock("./SlackDrawer", () => ({ default: () => null }));
vi.mock("./ServicesDrawer", () => ({ default: () => null }));
vi.mock("./TagsDrawer", () => ({ default: () => null }));

import SideRail from "./LibraryRail";
import type { TagCatalog } from "./use-tag-catalog";

// The default prop shape for the rail, used by the three tests. The type
// annotation makes the vi.fn() calls (typed as Mock<Procedure>) match the
// (panel: RailPanel | null) => void and other signatures SideRail expects,
// so the spread passes typecheck.
const baseProps: Parameters<typeof SideRail>[0] = {
  open: null,
  onOpen: vi.fn(),
  ctx: {
    project: null,
    folders: ["/Users/me/dev/app"],
    cards: [],
    onOpenUrl: vi.fn(),
    onOpenCard: vi.fn(),
    onStartCard: vi.fn<() => Promise<string | undefined>>(() => Promise.resolve(undefined)),
    notify: vi.fn(),
  },
  filter: {},
  onFilter: vi.fn(),
  onStarCard: vi.fn(),
  onTagCard: vi.fn(),
  catalog: { byName: new Map(), ordered: [] } as unknown as TagCatalog,
  onClosePane: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LibraryRail admin group", () => {
  it("hides the Admin icon when the gate returns false", () => {
    useSuperAdminGate.mockReturnValue(false);
    render(<SideRail {...baseProps} />);
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });

  it("shows the Admin icon when the gate returns true", () => {
    useSuperAdminGate.mockReturnValue(true);
    render(<SideRail {...baseProps} />);
    expect(screen.getByRole("button", { name: "Admin" })).toBeTruthy();
  });

  it("navigates the window to /admin/users when the Admin icon is clicked", () => {
    useSuperAdminGate.mockReturnValue(true);
    render(<SideRail {...baseProps} />);
    screen.getByRole("button", { name: "Admin" }).click();
    expect(push).toHaveBeenCalledWith("/admin/users");
  });
});
