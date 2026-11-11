import { describe, expect, it } from "vitest";
import { make } from "./vercel-env.harness";

// The drawer's Pull (electron/vercel-env.cjs pull with confirm): one Touch ID before any value is fetched, and a shared
// vault keeping out the names its server won't hold.

describe("vercel-env pull from the drawer", () => {
  it("asks one Touch ID naming the count before fetching any value, when the drawer pulls", async () => {
    const { env, vault, vercel } = make(
      [
        { id: "e1", key: "NEW_PLAIN", targets: ["development", "production"], type: "plain" },
        { id: "e2", key: "SENS", targets: ["production"], type: "sensitive" },
      ],
      { e1: "one" },
    );
    expect(await env.pull("/dev/weft", { confirm: true })).toMatchObject({ pulled: [{ name: "NEW_PLAIN", environment: "development" }, { name: "NEW_PLAIN", environment: "production" }], skipped: [{ name: "SENS", environment: "production" }] });
    expect(vault.confirm).toHaveBeenCalledWith("pull 2 variables from Vercel project weft into the aimhuge/weft vault");
    // A no fetches nothing and writes nothing, and still names the sensitive ones.
    vault.confirm.mockResolvedValueOnce(false);
    vault.setValue.mockClear();
    vercel.envValue.mockClear();
    expect(await env.pull("/dev/weft", { confirm: true })).toEqual({ label: "aimhuge/weft", project: "weft", denied: true, pulled: [], skipped: [{ name: "SENS", environment: "production" }], local: [] });
    expect(vercel.envValue).not.toHaveBeenCalled();
    expect(vault.setValue).not.toHaveBeenCalled();
  });

  it("doesn't ask when there's nothing to pull, or when the webhook pulls", async () => {
    const { env, vault } = make([{ id: "e2", key: "SENS", targets: ["production"], type: "sensitive" }]);
    await env.pull("/dev/weft", { confirm: true });
    const one = make([{ id: "e1", key: "NEW", targets: ["development"], type: "plain" }], { e1: "v" });
    await one.env.pull("/dev/weft");
    expect(vault.confirm).not.toHaveBeenCalled();
    expect(one.vault.confirm).not.toHaveBeenCalled();
  });

  it("keeps lower-case names out of a shared vault, as sharing does", async () => {
    const { env, vault, vercel } = make(
      [
        { id: "e1", key: "next_public_x", targets: ["development"], type: "plain" },
        { id: "e2", key: "UPPER", targets: ["development"], type: "plain" },
      ],
      { e1: "a", e2: "b" },
    );
    vault.names.mockResolvedValueOnce({ label: "aimhuge/weft", secrets: [], shared: true } as never);
    expect(await env.pull("/dev/weft")).toEqual({ label: "aimhuge/weft", project: "weft", pulled: [{ name: "UPPER", environment: "development" }], skipped: [], local: [{ name: "next_public_x", environment: "development" }] });
    expect(vercel.envValue).toHaveBeenCalledTimes(1);
    expect(vault.setValue.mock.calls).toEqual([["/dev/weft", "UPPER", "development", "b", { source: "Vercel" }]]);
    // A vault of your own takes them.
    expect((await env.pull("/dev/weft")).pulled).toEqual([
      { name: "next_public_x", environment: "development" },
      { name: "UPPER", environment: "development" },
    ]);
  });

});
