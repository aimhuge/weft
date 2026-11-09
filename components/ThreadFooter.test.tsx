// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { localTransport, ThreadTransportContext, type ThreadTransport } from "@/lib/thread-transport";
import type { Card } from "@/lib/types";
import { PermissionRequest } from "./ThreadFooter";
import "./test-utils";

// The grant buttons per transport: a local card writes the grant itself, a card on another machine sends it in the answer.
const card = {
  id: "c1",
  title: "Fix it",
  pending: { id: "p1", toolName: "Read", title: "Outside the project: read ~/data", input: {}, readScope: { directory: "/home/w/data", token: "~/data" } },
} as unknown as Card;

function open(transport: ThreadTransport) {
  const answer = vi.fn();
  render(
    <ThreadTransportContext.Provider value={transport}>
      <PermissionRequest card={card} readOnly={false} answered={false} answer={answer} />
    </ThreadTransportContext.Provider>,
  );
  return answer;
}

const remote: ThreadTransport = { ...localTransport, grantFolder: undefined, grantInAnswer: true, desktop: false };

describe("PermissionRequest", () => {
  it("sends Grant this card and Always inside the answer on another machine, with no path", async () => {
    const answer = open(remote);
    await userEvent.click(screen.getByRole("button", { name: "Grant this card" }));
    expect(answer).toHaveBeenLastCalledWith(true, undefined, "card");
    await userEvent.click(screen.getByRole("button", { name: "Always" }));
    expect(answer).toHaveBeenLastCalledWith(true, undefined, "always");
  });

  it("says Always reaches the machine running the card", () => {
    open(remote);
    expect(screen.getByRole("button", { name: "Always" }).title).toBe("Let every card on the machine running this one use ~/data from now on");
  });

  it("grants through the transport on this Mac, then answers plainly", async () => {
    const grantFolder = vi.fn(() => Promise.resolve());
    const answer = open({ ...localTransport, grantFolder });
    await userEvent.click(screen.getByRole("button", { name: "Always" }));
    expect(grantFolder).toHaveBeenCalledWith("c1", "/home/w/data", "always");
    expect(answer).toHaveBeenCalledWith(true);
  });

  it("offers only Allow and Deny where neither way to grant exists", () => {
    open({ ...localTransport, grantFolder: undefined });
    expect(screen.queryByRole("button", { name: "Grant this card" })).toBeNull();
  });
});

// A database call's prompt: the SQL review above the buttons, and the query left out of the raw input it repeats.
describe("PermissionRequest with SQL", () => {
  const sqlCard = {
    id: "c2",
    title: "Migrate",
    pending: {
      id: "p2",
      toolName: "mcp__supabase__execute_sql",
      title: "Run SQL on supabase",
      input: { project_id: "proj-xyz", query: "DROP TABLE secret_rows;" },
      sql: { server: "supabase", tool: "execute_sql", sql: "DROP TABLE secret_rows;", flagged: [0] },
    },
  } as unknown as Card;

  it("shows the review block and keeps the query out of the raw input", () => {
    const { container } = render(
      <ThreadTransportContext.Provider value={localTransport}>
        <PermissionRequest card={sqlCard} readOnly={false} answered={false} answer={vi.fn()} />
      </ThreadTransportContext.Provider>,
    );
    const review = container.querySelector("[data-sql-review]");
    expect(review).not.toBeNull();
    expect(screen.getByText(/A second model is reading the SQL/)).toBeInTheDocument();
    expect(container.textContent).toContain("proj-xyz");
    // The SQL appears once, inside the review, not again in the raw input.
    const outside = container.textContent.replace(review!.textContent, "");
    expect(outside).not.toContain("DROP TABLE secret_rows");
    expect(review!.textContent).toContain("DROP TABLE secret_rows;");
  });

  it("keeps the query in the input when there's no SQL review", () => {
    const plain = { ...sqlCard, pending: { ...sqlCard.pending!, sql: undefined } } as unknown as Card;
    const { container } = render(
      <ThreadTransportContext.Provider value={localTransport}>
        <PermissionRequest card={plain} readOnly={false} answered={false} answer={vi.fn()} />
      </ThreadTransportContext.Provider>,
    );
    expect(container.querySelector("[data-sql-review]")).toBeNull();
    expect(container.textContent).toContain("DROP TABLE secret_rows");
  });
});

// "Allow safe SQL on this card": on a prompt the review calls Safe, where the transport can set the card's switch.
describe("PermissionRequest's Allow safe SQL on this card", () => {
  const review = { verdict: "safe" as const, summary: "Adds a policy", statements: [], concerns: [], model: "sonnet" };
  const safeCard = (over: Partial<Card> = {}, pendingOver: object = {}) =>
    ({
      id: "c3",
      title: "Policies",
      pending: {
        id: "p3",
        toolName: "mcp__supabase__execute_sql",
        title: "Run SQL on supabase",
        input: { query: "grant select on t to anon" },
        sql: { server: "supabase", tool: "execute_sql", sql: "grant select on t to anon", flagged: [0], review },
        ...pendingOver,
      },
      ...over,
    }) as unknown as Card;
  const show = (c: Card, transport: ThreadTransport) => {
    const answer = vi.fn();
    render(
      <ThreadTransportContext.Provider value={transport}>
        <PermissionRequest card={c} readOnly={false} answered={false} answer={answer} />
      </ThreadTransportContext.Provider>,
    );
    return answer;
  };
  const name = "Allow safe SQL on this card";

  it("turns the card's switch on and allows this prompt", async () => {
    const allowSafeSql = vi.fn(() => Promise.resolve());
    const answer = show(safeCard(), { ...localTransport, allowSafeSql });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Allow", name, "Deny"]);
    await userEvent.click(screen.getByRole("button", { name }));
    expect(allowSafeSql).toHaveBeenCalledWith("c3");
    expect(answer).toHaveBeenCalledWith(true);
  });

  it("still answers when setting the switch fails", async () => {
    const allowSafeSql = vi.fn(() => Promise.reject(new Error("offline")));
    const answer = show(safeCard(), { ...localTransport, allowSafeSql });
    await userEvent.click(screen.getByRole("button", { name }));
    expect(answer).toHaveBeenCalledWith(true);
  });

  it("shows beside Accept on an MCP server's confirmation too", async () => {
    const allowSafeSql = vi.fn(() => Promise.resolve());
    const answer = show(safeCard({}, { elicitation: { server: "supabase", message: "Run it?", fields: [] } }), { ...localTransport, allowSafeSql });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Accept", name, "Decline"]);
    await userEvent.click(screen.getByRole("button", { name }));
    expect(answer).toHaveBeenCalledWith(true);
  });

  it("is hidden when the card already allows it, or the transport can't set it", () => {
    show(safeCard({ safeSql: true }), { ...localTransport, allowSafeSql: vi.fn() });
    expect(screen.queryByRole("button", { name })).toBeNull();
    cleanup();
    show(safeCard(), { ...localTransport, allowSafeSql: undefined });
    expect(screen.queryByRole("button", { name })).toBeNull();
  });
});
