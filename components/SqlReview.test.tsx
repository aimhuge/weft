// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PendingSql, SqlReview as Review, SqlVerdict } from "@/lib/types";
import SqlReview, { riskySql, safeForCard } from "./SqlReview";
import "./test-utils";

// The SQL behind a database prompt and the second model's review of it.
const review = (over: Partial<Review> = {}): Review => ({ verdict: "safe", summary: "Adds a column", statements: [], concerns: [], model: "haiku", ...over });
const sql = (over: Partial<PendingSql> = {}): PendingSql => ({ server: "supabase", tool: "execute_sql", sql: "select 1", flagged: [], ...over });

describe("SqlReview", () => {
  it("says the review is still being written when there is none", () => {
    render(<SqlReview sql={sql()} />);
    expect(screen.getByText(/A second model is reading the SQL/)).toBeInTheDocument();
  });

  it.each<[SqlVerdict, string]>([
    ["safe", "Safe"],
    ["access", "Changes access"],
    ["deletes", "Deletes data"],
    ["unknown", "Can't tell"],
  ])("labels the %s verdict %s, with the summary", (verdict, label) => {
    render(<SqlReview sql={sql({ review: review({ verdict }) })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Adds a column")).toBeInTheDocument();
  });

  it("shows the error instead of the summary, and no findings", () => {
    render(<SqlReview sql={sql({ review: review({ verdict: "unknown", error: "timed out", concerns: ["Hidden"], loss: "Gone" }) })} />);
    expect(screen.getByText("The review didn't finish (timed out). Read the SQL below.")).toBeInTheDocument();
    expect(screen.queryByText("Adds a column")).toBeNull();
    expect(screen.queryByText(/Hidden/)).toBeNull();
    expect(screen.queryByText("Lost:")).toBeNull();
  });

  it("lists concerns, what's lost and each statement in plain words", () => {
    render(
      <SqlReview
        sql={sql({
          review: review({
            verdict: "deletes",
            concerns: ["DELETE without WHERE"],
            loss: "Every row of users, not recoverable",
            statements: [{ sql: "DELETE FROM users", does: "removes every user" }],
          }),
        })}
      />,
    );
    expect(screen.getByText("⚠ DELETE without WHERE")).toBeInTheDocument();
    expect(screen.getByText("Lost:")).toBeInTheDocument();
    expect(screen.getByText(/Every row of users, not recoverable/)).toBeInTheDocument();
    expect(screen.getByText("DELETE FROM users")).toBeInTheDocument();
    expect(screen.getByText(/removes every user/)).toBeInTheDocument();
  });

  it("leaves out loss and statements when there are none", () => {
    const { container } = render(<SqlReview sql={sql({ review: review() })} />);
    expect(screen.queryByText("Lost:")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("sums up the SQL: name, tool, line count and how many lines are flagged", () => {
    const { container } = render(<SqlReview sql={sql({ name: "drop_old", tool: "apply_migration", sql: "begin;\ndrop table old;\ncommit;", flagged: [1] })} />);
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveTextContent("drop_old · apply_migration · 3 lines · 1 flagged");
  });

  it("says 1 line, with no name and nothing flagged", () => {
    const { container } = render(<SqlReview sql={sql()} />);
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveTextContent(/^execute_sql · 1 line$/);
    expect(summary).not.toHaveTextContent("flagged");
  });

  it("marks the flagged lines and only those", () => {
    const { container } = render(<SqlReview sql={sql({ sql: "begin;\ndrop table old;\n\ncommit;", flagged: [1] })} />);
    const rows = Array.from(container.querySelectorAll("pre > div"));
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveClass("bg-danger-soft");
    expect(rows[1]).toHaveTextContent("2drop table old;");
    expect(rows.filter((r) => r.classList.contains("bg-danger-soft"))).toHaveLength(1);
  });
});

describe("riskySql", () => {
  const base: PendingSql = { server: "supabase", tool: "execute_sql", sql: "delete from t;", flagged: [0] };
  const review = (verdict: SqlVerdict): Review => ({ verdict, summary: "", statements: [], concerns: [], model: "sonnet" });
  it("says why Decline leads when flagged and not yet reviewed, or reviewed as anything but Safe", () => {
    expect(riskySql(base)).toBe("Suggested: Decline. Wait for the review, or read the SQL.");
    expect(riskySql({ ...base, review: review("deletes") })).toBe("Suggested: Decline. It deletes data.");
    expect(riskySql({ ...base, review: review("access") })).toBe("Suggested: Decline. It changes who can read or write.");
    expect(riskySql({ ...base, review: review("unknown") })).toBe("Suggested: Decline. The review can't tell what it does.");
  });
  it("is undefined when Safe, nothing is flagged, or there's no SQL", () => {
    expect(riskySql({ ...base, review: review("safe") })).toBeUndefined();
    expect(riskySql({ ...base, flagged: [] })).toBeUndefined();
    expect(riskySql(undefined)).toBeUndefined();
  });
  it("names what it loses first, from the static scan, before or after the review", () => {
    const lossy = { ...base, loses: "deletes every row in t" };
    expect(riskySql(lossy)).toBe("Suggested: Decline. It deletes every row in t.");
    expect(riskySql({ ...lossy, review: review("deletes") })).toBe("Suggested: Decline. It deletes every row in t.");
    expect(riskySql({ ...lossy, review: review("safe") })).toBeUndefined();
  });
});

describe("safeForCard", () => {
  const safe = sql({ review: review() });
  it("offers Allow safe SQL on this card on a Safe review, when the card can take it and hasn't", () => {
    const allow = vi.fn();
    render(<>{safeForCard(safe, undefined, false, allow)}</>);
    fireEvent.click(screen.getByRole("button", { name: "Allow safe SQL on this card" }));
    expect(allow).toHaveBeenCalledTimes(1);
  });
  it("is disabled once the prompt is answered", () => {
    render(<>{safeForCard(safe, false, true, vi.fn())}</>);
    expect(screen.getByRole("button", { name: "Allow safe SQL on this card" })).toBeDisabled();
  });
  it("is absent with no way to allow it, when it's on, or when the review isn't Safe or hasn't landed", () => {
    expect(safeForCard(safe, undefined, false, undefined)).toBeUndefined();
    expect(safeForCard(safe, true, false, vi.fn())).toBeUndefined();
    expect(safeForCard(sql({ review: review({ verdict: "deletes" }) }), undefined, false, vi.fn())).toBeUndefined();
    expect(safeForCard(sql(), undefined, false, vi.fn())).toBeUndefined();
    expect(safeForCard(undefined, undefined, false, vi.fn())).toBeUndefined();
  });
});
