import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { memberLogins } from "./team-member-logins";

function service(getUserById: (id: string) => unknown) {
  return { auth: { admin: { getUserById: vi.fn(getUserById) } } } as unknown as SupabaseClient;
}

describe("memberLogins", () => {
  it("reads each member's GitHub login, null when missing, failed or thrown", async () => {
    const svc = service((id) => {
      if (id === "boom") throw new Error("down");
      if (id === "err") return Promise.resolve({ data: null, error: { message: "no" } });
      const user_name = id === "gh" ? " Zulker-Nien " : id === "blank" ? "  " : undefined;
      return Promise.resolve({ data: { user: { user_metadata: { user_name } } }, error: null });
    });
    const out = await memberLogins(svc, ["gh", "mail", "blank", "err", "boom"]);
    expect(Object.fromEntries(out)).toEqual({ gh: "Zulker-Nien", mail: null, blank: null, err: null, boom: null });
  });
});
