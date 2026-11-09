import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bashSql } from "./db-bash";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-bash-"));
fs.writeFileSync(path.join(dir, "drop.sql"), "drop table t;\n");
fs.writeFileSync(path.join(dir, "big.sql"), "x".repeat(1_000_001));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("bashSql", () => {
  it("reads psql -c with double quotes, unescaping, and with single quotes", () => {
    expect(bashSql('psql "$DATABASE_URL" -c "delete from \\"T\\";"', dir)).toEqual({ tool: "psql", sql: 'delete from "T";' });
    expect(bashSql("psql -c 'truncate t'", dir)).toEqual({ tool: "psql", sql: "truncate t" });
    expect(bashSql('psql --command="drop table t"', dir)).toEqual({ tool: "psql", sql: "drop table t" });
  });

  it("reads a heredoc into psql", () => {
    expect(bashSql("psql $URL <<'SQL'\ndelete from t;\nupdate u set a = 1;\nSQL", dir)).toEqual({ tool: "psql", sql: "delete from t;\nupdate u set a = 1;" });
    expect(bashSql("psql <<-EOF\nselect 1;\n  EOF", dir)).toEqual({ tool: "psql", sql: "select 1;" });
  });

  it("reads psql -f and prisma db execute --file from the card's folder", () => {
    expect(bashSql("psql -f drop.sql", dir)).toEqual({ tool: "psql", sql: "drop table t;\n", name: "drop.sql" });
    expect(bashSql(`psql --file="${path.join(dir, "drop.sql")}"`, dir)).toEqual({ tool: "psql", sql: "drop table t;\n", name: "drop.sql" });
    expect(bashSql("npx prisma db execute --file 'drop.sql' --schema s", dir)).toEqual({ tool: "prisma", sql: "drop table t;\n", name: "drop.sql" });
  });

  it("leaves a missing or huge file, and non-SQL commands, unreviewed", () => {
    expect(bashSql("psql -f missing.sql", dir)).toBeUndefined();
    expect(bashSql("psql -f big.sql", dir)).toBeUndefined();
    expect(bashSql("ls -la && git status", dir)).toBeUndefined();
    expect(bashSql("echo psql", dir)).toBeUndefined();
  });
});
