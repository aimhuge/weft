import { describe, expect, it } from "vitest";
import { bare, objectKey, scanSql, splitStatements, statementKind, staticallyHarmless } from "./sql-scan";

const texts = (sql: string) => splitStatements(sql).map((p) => p.text.trim());

describe("splitStatements", () => {
  it("splits on top-level semicolons and drops empty pieces", () => {
    expect(texts("select 1; select 2;;  ;")).toEqual(["select 1", "select 2"]);
  });

  it("records where each piece starts and ends", () => {
    expect(splitStatements("a;b")).toEqual([
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 2, end: 3 },
    ]);
  });

  it("keeps semicolons inside strings with '' escapes", () => {
    expect(texts("insert into t values ('it''s; fine'); select 2")).toEqual(["insert into t values ('it''s; fine')", "select 2"]);
  });

  it("keeps semicolons inside double-quoted identifiers", () => {
    expect(texts('select "a;b" from t; select 2')).toEqual(['select "a;b" from t', "select 2"]);
  });

  it("keeps semicolons inside -- and /* */ comments", () => {
    expect(texts("select 1 -- a; b\n; select /* x; y */ 2")).toEqual(["select 1 -- a; b", "select /* x; y */ 2"]);
  });

  it("runs a -- comment with no newline to the end", () => {
    expect(texts("select 1 -- trailing; note")).toEqual(["select 1 -- trailing; note"]);
  });

  it("runs an unterminated /* comment to the end", () => {
    expect(texts("select 1; /* open; never closed")).toEqual(["select 1", "/* open; never closed"]);
  });

  it("runs an unterminated string to the end", () => {
    expect(texts("select 1; select 'open; never")).toEqual(["select 1", "select 'open; never"]);
  });

  it("keeps $$ and $tag$ bodies whole", () => {
    expect(texts("do $$ begin delete from t; end $$; create function f() returns int as $fn$ select 1; $fn$ language sql")).toEqual([
      "do $$ begin delete from t; end $$",
      "create function f() returns int as $fn$ select 1; $fn$ language sql",
    ]);
  });

  it("runs an unterminated dollar quote to the end", () => {
    expect(texts("select 1; do $$ begin; delete from t;")).toEqual(["select 1", "do $$ begin; delete from t;"]);
  });

  it("treats a $ that opens no dollar quote (a parameter) as plain text", () => {
    expect(texts("select $1; select 2")).toEqual(["select $1", "select 2"]);
  });
});

describe("bare", () => {
  it("strips comments, collapses whitespace and lowercases", () => {
    expect(bare("  DELETE  /* c */ FROM\n  T -- x\n")).toBe("delete from t");
  });
});

describe("statementKind", () => {
  it.each([
    ["truncate t", "loss"],
    ["DELETE FROM t WHERE id = 1", "loss"],
    ["update t set a = 1", "loss"],
    ["drop table t", "loss"],
    ["alter table t drop column c", "loss"],
    ["alter table t alter column c type text", "loss"],
    ["alter table t alter column c set data type text", "loss"],
    ["alter table t drop constraint t_pkey", "drop"],
    ["drop policy p on t", "drop"],
    ["drop function f()", "drop"],
    ["grant select on t to anon", "access"],
    ["revoke all on t from public", "access"],
    ["alter table t disable row level security", "access"],
    ["do $$ begin delete from t; end $$", "loss"],
    ["create table t (id int)", undefined],
    ["alter table t drop default", undefined],
  ])("%s -> %s", (sql, kind) => {
    expect(statementKind(sql)).toBe(kind);
  });
});

describe("objectKey", () => {
  it("names a dropped policy with its table", () => {
    expect(objectKey('drop policy if exists "Read own" on public.t')).toBe("policy read own on public.t");
  });

  it("names a created policy the same way", () => {
    expect(objectKey('create policy "Read own" on public.t for select using (true)')).toBe("policy read own on public.t");
  });

  it("names a policy with no table", () => {
    expect(objectKey("drop policy p")).toBe("policy p");
  });

  it("names a dropped function without its arguments", () => {
    expect(objectKey("drop function if exists public.f(int)")).toBe("function public.f");
  });

  it("names a created function and ignores ON for non-policies", () => {
    expect(objectKey("create or replace function public.f() returns int as $$ select 1 $$ language sql")).toBe("function public.f");
    expect(objectKey("create unique index concurrently if not exists i on t (a)")).toBe("index i");
  });

  it("is undefined for anything else", () => {
    expect(objectKey("select 1")).toBeUndefined();
  });
});

describe("scanSql", () => {
  it("flags a DELETE without WHERE", () => {
    expect(scanSql("delete from public.t").concerns).toEqual(["DELETE on public.t has no WHERE: it touches every row."]);
  });

  it("flags an UPDATE without WHERE, unquoting the table", () => {
    expect(scanSql('update only "T" set a = 1').concerns).toEqual(["UPDATE on t has no WHERE: it touches every row."]);
  });

  it("does not flag a DELETE or UPDATE with WHERE", () => {
    expect(scanSql("delete from t where id = 1; update t set a = 1 where id = 2").concerns).toEqual([]);
  });

  it("flags a TRUNCATE", () => {
    expect(scanSql("truncate t").concerns).toEqual(["truncate t empties the table."]);
  });

  it("flags a DROP POLICY with no matching CREATE", () => {
    expect(scanSql("drop policy p on t").concerns).toEqual(["DROP policy p on t has no matching CREATE: it stays gone."]);
  });

  it("does not flag a DROP POLICY re-created", () => {
    expect(scanSql("drop policy p on t; create policy p on t using (true)").concerns).toEqual([]);
  });

  it("does not flag an object drop it can't name", () => {
    expect(scanSql("drop publication pub").concerns).toEqual([]);
  });

  it("returns the destructive statements with their own lines, not the comments before them", () => {
    const sql = "create table a (id int);\n-- clean up\n/* old rows */\ndelete from a\n  where id = 1;\nselect 1;";
    const scan = scanSql(sql);
    expect(scan.statements).toEqual([{ kind: "loss", text: "delete from a\n  where id = 1", from: 3, to: 4 }]);
    expect(scan.flagged).toEqual([3, 4]);
  });

  it("flags each line once when statements share one", () => {
    expect(scanSql("drop policy p on t; drop policy q on t;").flagged).toEqual([0]);
  });
});

describe("staticallyHarmless", () => {
  it("is true with no loss and no concerns", () => {
    expect(staticallyHarmless(scanSql("drop policy p on t; create policy p on t using (true); grant select on t to anon"))).toBe(true);
  });

  it("is false with a loss statement", () => {
    expect(staticallyHarmless(scanSql("delete from t where id = 1"))).toBe(false);
  });

  it("is false with a concern", () => {
    expect(staticallyHarmless(scanSql("drop policy p on t"))).toBe(false);
  });
});
