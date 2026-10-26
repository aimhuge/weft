import { describe, expect, it, vi } from "vitest";
import { createPaneSecrets } from "./pane-secrets.cjs";

type Got = { value?: string; label?: string; denied?: boolean; missing?: boolean };

function make({ url = "https://supabase.com/dashboard", got = { value: "s3cret-value", label: "Owner/Repo" }, found = true }: { url?: string; got?: Got; found?: boolean } = {}) {
  const wc = { getURL: () => url, executeJavaScript: vi.fn(() => Promise.resolve()) };
  const vault = { useFor: vi.fn(() => Promise.resolve(got)), names: vi.fn(() => Promise.resolve({ label: "Owner/Repo", secrets: [] })) };
  const typeText = vi.fn(() => Promise.resolve({ found }));
  const ps = createPaneSecrets({ secrets: () => vault, requirePage: () => wc, typeText });
  return { ps, wc, vault, typeText };
}

const ask = { key: "c1", folder: "/proj", name: "GITHUB_CLIENT_SECRET", selector: "#secret" };

describe("createPaneSecrets", () => {
  it("types the value in after the vault says yes, masks the field, and redacts it from read_page", async () => {
    const { ps, wc, vault, typeText } = make();
    expect(await ps.fill(ask)).toEqual({ found: true, label: "Owner/Repo" });
    expect(vault.useFor).toHaveBeenCalledWith("/proj", "GITHUB_CLIENT_SECRET", "development", { card: "c1", site: "supabase.com" });
    expect(typeText).toHaveBeenCalledWith(wc, "#secret", "s3cret-value");
    expect(wc.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining("webkitTextSecurity"));
    expect(ps.redact("c1", "id: s3cret-value, again s3cret-value")).toBe("id: ‹GITHUB_CLIENT_SECRET›, again ‹GITHUB_CLIENT_SECRET›");
    expect(ps.redact("c2", "s3cret-value")).toBe("s3cret-value");
  });

  it("passes the thread's title through to the vault", async () => {
    const { ps, vault } = make();
    await ps.fill({ ...ask, thread: "Build card" });
    expect(vault.useFor).toHaveBeenCalledWith("/proj", "GITHUB_CLIENT_SECRET", "development", { card: "c1", site: "supabase.com", thread: "Build card" });
  });

  it("refuses pages that aren't https before asking for Touch ID", async () => {
    for (const url of ["http://localhost:3000/", "file:///tmp/x.html"]) {
      const { ps, vault } = make({ url });
      await expect(ps.fill(ask)).rejects.toThrow(/only go into https pages/);
      expect(vault.useFor).not.toHaveBeenCalled();
    }
  });

  it("passes on a no or a missing value without typing, and says when the field isn't there", async () => {
    for (const got of [{ denied: true, label: "x" }, { missing: true, label: "x" }] as Got[]) {
      const { ps, typeText } = make({ got });
      expect(await ps.fill({ ...ask, environment: "production" })).toEqual(got);
      expect(typeText).not.toHaveBeenCalled();
    }
    const { ps, wc } = make({ found: false });
    expect(await ps.fill(ask)).toEqual({ found: false, label: "Owner/Repo" });
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
    expect(ps.redact("c1", "s3cret-value")).toBe("s3cret-value");
  });

  it("lists names through the vault, and says when the vault isn't up yet", async () => {
    const { ps, vault } = make();
    expect(await ps.list("/proj")).toEqual({ label: "Owner/Repo", secrets: [] });
    expect(vault.names).toHaveBeenCalledWith("/proj");
    const early = createPaneSecrets({ secrets: () => undefined, requirePage: vi.fn(), typeText: vi.fn() });
    expect(() => {
      void early.list("/proj");
    }).toThrow(/isn't ready/);
    await expect(early.fill(ask)).rejects.toThrow(/isn't ready/);
  });
});
