// @vitest-environment jsdom
// The reply box in the phone look (simple mode's full-page pane): round Send / Stop, and a spoken message sent as
// Enter would send it.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import ReplyBox from "./ReplyBox";

vi.mock("@/lib/client", () => ({ api: {} }));
const looks = vi.hoisted(() => [] as unknown[]);
vi.mock("./Composer", async () => {
  const { forwardRef } = await import("react");
  const { default: Mock } = await import("./composer-mock");
  type Props = Parameters<typeof Mock>[0] & { look?: string; onVoiceSubmit?: () => void };
  return {
    // The stand-in plus a button for what voice mode does once the words are in: onVoiceSubmit.
    default: forwardRef<unknown, Props>(function PhoneMock(props, ref) {
      looks.push(props.look);
      return (
        <>
          <Mock {...props} ref={ref as never} />
          <button type="button" onClick={props.onVoiceSubmit}>
            Spoken
          </button>
        </>
      );
    }),
  };
});

type Props = Parameters<typeof ReplyBox>[0];

function setup(props: Partial<Props> = {}) {
  const onSend = vi.fn<Props["onSend"]>(() => Promise.resolve());
  const onStop = vi.fn<Props["onStop"]>(() => Promise.resolve());
  render(<ReplyBox cardId="c1" cwd="/repo" live={false} placeholder="Reply…" onSend={onSend} onStop={onStop} look="phone" {...props} />);
  return { onSend, onStop, box: screen.getByRole("textbox", { name: "Message" }) };
}

beforeEach(() => {
  localStorage.clear();
  looks.length = 0;
});

describe("ReplyBox in the phone look", () => {
  it("hands the look to the Composer, and shows Send only once something is typed", async () => {
    const { onSend, box } = setup();
    expect(looks).toContain("phone");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await userEvent.type(box, "Ship it");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("Ship it");
  });

  it("sends a spoken message even where an empty box would Continue", () => {
    const { onSend, box } = setup({ cutOff: true });
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    // The words land in the box without a re-render, as voice mode's do, then go out at once.
    (box as HTMLTextAreaElement).value = "ship it";
    fireEvent.click(screen.getByRole("button", { name: "Spoken" }));
    expect(onSend).toHaveBeenCalledWith("ship it");
  });

  it("Stop ■ stops the running turn and shows a refusal", async () => {
    const { onStop } = setup({ live: true });
    onStop.mockRejectedValueOnce(new Error("Already stopped"));
    fireEvent.click(screen.getByRole("button", { name: "Stop the current turn" }));
    expect(await screen.findByText("Already stopped")).toBeInTheDocument();
  });
});
