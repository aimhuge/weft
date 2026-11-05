// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
  it("sends This card and Always inside the answer on another machine, with no path", async () => {
    const answer = open(remote);
    await userEvent.click(screen.getByRole("button", { name: "This card" }));
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
    expect(screen.queryByRole("button", { name: "This card" })).toBeNull();
  });
});
