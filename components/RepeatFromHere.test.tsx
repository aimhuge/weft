// @vitest-environment jsdom
// The ⏰ beside one of your messages: it puts the thread on a cron from that message, and only on the Mac,
// and only for a message its session can be forked at.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CRON_FROM_EVENT } from "@/lib/cron-events";
import { ThreadTransportContext, type ThreadTransport } from "@/lib/thread-transport";
import RepeatFromHere from "./RepeatFromHere";
import "./test-utils";

afterEach(cleanup);

const transport = (desktop: boolean) => ({ desktop }) as unknown as ThreadTransport;

function setup(desktop: boolean, over: Partial<React.ComponentProps<typeof RepeatFromHere>> = {}) {
  const props: React.ComponentProps<typeof RepeatFromHere> = { cardId: "c1", id: "m1", text: "the message", ...over };
  return {
    props,
    view: render(
      <ThreadTransportContext.Provider value={transport(desktop)}>
        <RepeatFromHere {...props} />
      </ThreadTransportContext.Provider>,
    ),
  };
}

describe("RepeatFromHere", () => {
  it("asks the thread to repeat from the message you clicked", () => {
    const seen: unknown[] = [];
    window.addEventListener(CRON_FROM_EVENT, (e) => seen.push((e as CustomEvent).detail));
    const { view } = setup(true);
    fireEvent.click(view.getByLabelText("Repeat from here on a cron"));
    expect(seen).toEqual([{ cardId: "c1", anchor: { id: "m1", text: "the message" } }]);
  });

  it("leaves it out on weft.zip, where crons can't run", () => {
    const { view } = setup(false);
    expect(view.queryByLabelText("Repeat from here on a cron")).toBeNull();
  });

  it("leaves it out for a message the session can't be forked at", () => {
    const { view } = setup(true, { id: undefined });
    expect(view.queryByLabelText("Repeat from here on a cron")).toBeNull();
  });
});
