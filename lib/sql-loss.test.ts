import { describe, expect, it } from "vitest";
import { lossClause, whatItLoses } from "./sql-loss";
import { scanSql } from "./sql-scan";

const loses = (sql: string) => whatItLoses(scanSql(sql).statements);

describe("whatItLoses", () => {
  it("names what each lossy statement loses, once each", () => {
    expect(
      loses(`delete from public.team_members;
delete from "Cards" where id = 1;
truncate table only logs;
update public.profiles p set github_login = null where true;
drop table if exists old_cards;
drop schema legacy;
alter table public.t drop column if exists c;
alter table t drop "Note";
alter table t alter column n type int;
alter table t alter column m set data type text;
do $$ begin delete from x; end $$;
delete from public.team_members;
drop policy p on t;
select 1;`),
    ).toEqual([
      "deletes every row in team_members",
      "deletes rows in Cards",
      "deletes every row in logs",
      "overwrites profiles.github_login",
      "drops table old_cards",
      "drops schema legacy",
      "drops column t.c",
      "drops column t.Note",
      "changes the type of t.n",
      "changes the type of t.m",
      "runs a block that deletes data",
    ]);
  });

  it("is empty when nothing loses data", () => {
    expect(loses("drop policy p on t; create policy p on t using (true);")).toEqual([]);
  });
});

describe("lossClause", () => {
  it("joins one, two, three, or the first three and how many more", () => {
    expect(lossClause([])).toBe("");
    expect(lossClause(["a"])).toBe("a");
    expect(lossClause(["a", "b"])).toBe("a and b");
    expect(lossClause(["a", "b", "c"])).toBe("a, b and c");
    expect(lossClause(["a", "b", "c", "d", "e"])).toBe("a, b, c and 2 more");
  });
});
