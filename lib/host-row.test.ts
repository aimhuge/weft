// Type test: the row @weft/client builds for a `host` command is one the app's cloud_commands insert takes, where
// lib/worker-board.ts and lib/cloud-host-acts.ts pass hostCommand's and hostRow's results on as a NewCommand.
import { describe, expect, expectTypeOf, it } from "vitest";
import type { NewCommand } from "./cloud-commands";
import { hostCommand } from "./host-command";
import { hostRow, type HostCommandRow } from "./host-row";

const target = { orgId: "org-1", device: "worker:w-1", folder: "weft", cardId: "card-1" };

describe("HostCommandRow", () => {
  it("satisfies NewCommand where hostCommand's and hostRow's results are passed on", () => {
    expectTypeOf<HostCommandRow>().toExtend<NewCommand>();
    const row = hostCommand(target, "card.stop");
    expect(row).not.toBeNull();
    const sent: NewCommand | null = row;
    const built: NewCommand = hostRow(target, "card.stop", { id: "elsewhere" });
    expect(sent).toEqual(built);
    expect(built.payload).toEqual({ verb: "card.stop", args: { id: "card-1" } });
  });
});
