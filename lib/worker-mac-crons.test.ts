import { describe, expect, it } from "vitest";
import { isMacCronId, MAC_CRONS_NOTE, macCronLine, macCronsSection, macCronsText } from "./worker-mac-crons";

const at = new Date(2026, 10, 3, 9, 0).getTime();

describe("the Mac's crons on a worker", () => {
  it("draws one as list_crons does, read-only and on its Mac, with a short prompt when sent", () => {
    expect(macCronLine({ id: "k1", name: "Daily", expr: "0 9 * * *", mode: "fresh", enabled: true, folder: "app", nextAt: at, prompt: "check it" }, "mbp")).toBe(
      "mac:k1 | Daily | every day at 9:00 (0 9 * * *) | fresh | on | next Tue 3 Nov, 09:00 | app on mbp | “check it”",
    );
    expect(macCronLine({ id: 9 as never, enabled: false }, "mbp")).toBe("mac: |  | cron  () |  | off | no next run |  on mbp");
  });

  it("lists every Mac's, skips what isn't a cron, and says when there are none", () => {
    const text = macCronsText([
      { device: "d1", label: "", crons: [{ id: "a", expr: "0 9 * * *" }, null, "x"], updated_at: "t" },
      { device: "d2", label: "mini", crons: [{ id: "b", expr: "0 9 * * *" }], updated_at: "t" },
    ]);
    expect(text.split("\n")).toEqual([MAC_CRONS_NOTE, expect.stringMatching(/^mac:a .* on a Mac$/), expect.stringMatching(/^mac:b .* on mini$/)]);
    expect(macCronsText([])).toBe("No crons on the user's Mac.");
  });

  it("tells a Mac's cron id from the worker's own", () => {
    expect([isMacCronId("mac:k1"), isMacCronId("k1"), isMacCronId(undefined)]).toEqual([true, false, false]);
  });

  it("never throws: an old wiring or a failed read is said instead", async () => {
    expect(await macCronsSection({})).toMatch(/can't read the Mac's crons yet/);
    expect(await macCronsSection({ macCrons: () => Promise.reject(new Error("no function")) })).toBe("Couldn't read the Mac's crons: no function");
    expect(await macCronsSection({ macCrons: () => Promise.resolve([]) })).toBe("No crons on the user's Mac.");
  });
});
