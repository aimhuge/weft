// @vitest-environment jsdom
// The thread header's ⏰: shown on the Mac for a thread you can put on a cron, anchored on the thread's
// last message, and left out for the copilot and on weft.zip.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "@/lib/types";
import { ThreadTransportContext, type ThreadTransport } from "@/lib/thread-transport";
import ThreadCronButton from "./ThreadCronButton";
import { makeCard } from "./test-utils";
import "./test-utils";

const crons = vi.hoisted(() => ({ create: vi.fn(() => Promise.resolve({})), later: vi.fn() }));
vi.mock("@/lib/use-crons", () => ({
  useCrons: () => ({ crons: [], error: null, create: crons.create, later: crons.later, update: vi.fn(), remove: vi.fn(), run: vi.fn() }),
}));
// The card's host: the real cardCan, and an act the test reads.
const act = vi.hoisted(() => vi.fn((_verb: string, _args: unknown, local?: () => Promise<unknown>) => (local ? local() : Promise.resolve(undefined))));
vi.mock("@/lib/project-host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-host")>()),
  hostOf: () => ({ act }),
}));

afterEach(cleanup);

const transport = (desktop: boolean) => ({ desktop }) as unknown as ThreadTransport;

// A thread that has run can be forked, so its cron forks the thread rather than starting fresh.
const forked = makeCard({ id: "c1", backend: "claude", sessionId: "s1" });

function setup(desktop: boolean, items: (ThreadItem | null | undefined)[] = [], card = forked) {
  return render(
    <ThreadTransportContext.Provider value={transport(desktop)}>
      <ThreadCronButton card={card} items={items} />
    </ThreadTransportContext.Provider>,
  );
}

describe("ThreadCronButton", () => {
  it("shows the ⏰ on the Mac", () => {
    setup(true);
    expect(screen.getByLabelText("Crons")).toBeInTheDocument();
  });

  it("leaves it out on weft.zip, where crons can't run", () => {
    setup(false);
    expect(screen.queryByLabelText("Crons")).toBeNull();
  });

  it("shows it on a worker's card, and makes the cron on that host as cron.create, then reads the list again", async () => {
    render(
      <ThreadTransportContext.Provider value={{ desktop: false, cardEdits: true } as unknown as ThreadTransport}>
        <ThreadCronButton card={makeCard({ id: "w1", cwd: "worker://w1/ling", prompt: "tidy the repo" })} items={[]} />
      </ThreadTransportContext.Provider>,
    );
    fireEventClick();
    fireEvent.click(screen.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(crons.later).toHaveBeenCalled());
    const [verb, args] = act.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(verb).toBe("cron.create");
    expect(args).toMatchObject({ id: "w1", prompt: "tidy the repo", mode: "fresh" });
    expect(Object.values(args)).not.toContain(undefined);
    // The local create is the host's to call: this Mac's host calls it, a worker's doesn't.
    expect(crons.create).toHaveBeenCalled();
  });

  it("leaves it out for the copilot", () => {
    setup(true, [], makeCard({ id: "copilot", role: "copilot" }));
    expect(screen.queryByLabelText("Crons")).toBeNull();
  });

  it("anchors the cron on the thread's last message", () => {
    const items: ThreadItem[] = [
      { kind: "user", id: "m1", text: "the first message", at: 1 },
      { kind: "assistant", text: "the reply", at: 2 },
    ];
    setup(true, items);
    fireEventClick();
    // The popover says where a fork would start from: the last message you sent.
    expect(screen.getByText(/Forks at/)).toBeInTheDocument();
  });

  it("says a fork takes the thread as it is when the thread has no message to anchor on", () => {
    setup(true, []);
    fireEventClick();
    expect(screen.getByText("Forks the thread as it is now")).toBeInTheDocument();
  });

  it("skips the empty items a thread page carries", () => {
    setup(true, [null, undefined]);
    fireEventClick();
    expect(screen.getByText("Forks the thread as it is now")).toBeInTheDocument();
  });
});

function fireEventClick() {
  fireEvent.click(screen.getByLabelText("Crons"));
}
