// The fake Supabase client lib/team-agents.test.ts runs against: every call recorded in state.calls, and each query's
// last step resolving to that operation's state.res. Its own file so the test stays about behaviour.

export type Result = { data?: unknown; error: { code?: string; message: string } | null };

export interface TeamAgentsState {
  dir: string;
  // Who the session is: a user id, null when signed out, or "reject" when getSession itself fails.
  me: string | null;
  accountThrows: boolean;
  // Every query throws, the way a broken connection or a bug would reach the timers' catch-alls.
  fromThrows: boolean;
  // "update" is the update-then-select a share tries first (data: the rows it changed); "insert" runs when it changed none.
  res: Record<"memberships" | "agents" | "update" | "insert" | "delete", Result>;
  calls: unknown[][];
}

export function teamAgentsState(): TeamAgentsState {
  return { dir: "", me: null, accountThrows: false, fromThrows: false, res: {} as TeamAgentsState["res"], calls: [] };
}

// A Supabase client whose every call is recorded in h.calls; each chain's last step resolves to that operation's h.res.
export function fakeClient(h: TeamAgentsState) {
  const step =
    <T>(name: string, next: () => T, ...head: unknown[]) =>
    (...args: unknown[]) => {
      h.calls.push([name, ...head, ...args]);
      return next();
    };
  const result = (key: keyof typeof h.res) => () => Promise.resolve(h.res[key]);
  const getSession = () =>
    h.me === "reject" ? Promise.reject(new Error("offline")) : Promise.resolve({ data: { session: h.me ? { user: { id: h.me } } : null } });
  const filtered = () => ({ eq: step("eq", result("delete")), in: step("in", result("delete")) });
  const updated = (table: string) => () => ({ eq: step("eq", () => ({ eq: step("eq", () => ({ select: step("select", result("update"), table) })) })) });
  return {
    auth: { getSession },
    from: (table: string) => {
      if (h.fromThrows) throw new Error("network down");
      h.calls.push(["from", table]);
      return {
        select: step("select", () => (table === "org_memberships" ? { eq: step("eq", result("memberships")) } : result("agents")()), table),
        update: step("update", updated(table), table),
        insert: step("insert", result("insert"), table),
        delete: step("delete", () => ({ eq: step("eq", filtered) }), table),
      };
    },
  };
}


// The "./account" mock: accountClient is the fake, or throws as a build without accounts does.
export function accountMock(h: TeamAgentsState) {
  return {
    accountClient: () => {
      if (h.accountThrows) throw new Error("Accounts aren't set up.");
      return fakeClient(h);
    },
  };
}
