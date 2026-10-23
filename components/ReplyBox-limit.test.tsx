// @vitest-environment jsdom
// The reply box asks the shared limit stores when a thread has to wait (lib/limit-reset.ts): the
// model's own cap and the CLI's weekly window are things the thread's own snapshot can't see.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import ReplyBox from "./ReplyBox";

const api = vi.hoisted(() => ({
  schedule: vi.fn(() => Promise.resolve()),
  unschedule: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/client", () => ({ api }));

// The shared limit stores, read off /api/limits/plans (lib/use-start-gate.ts).
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));

vi.mock("./Composer", () => import("./composer-mock"));

type Props = Parameters<typeof ReplyBox>[0];

const NOW = Date.now();
const RESET_AT = NOW + 4 * 60 * 60 * 1000;

function plans(body: unknown) {
  apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
}

function setup(props: Partial<Props> = {}) {
  const onSend = vi.fn<Props["onSend"]>(() => Promise.resolve());
  const onStop = vi.fn<Props["onStop"]>(() => Promise.resolve());
  render(<ReplyBox cardId="c1" cwd="/repo" live={false} placeholder="Reply…" onSend={onSend} onStop={onStop} {...props} />);
  return { onSend, box: screen.getByRole("textbox", { name: "Message" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  apiFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve(null) });
});

afterEach(cleanup);

describe("a model at its own limit", () => {
  const sendLater = { backend: "claude" as const, resets: {}, scheduled: [] };

  it("schedules for the model's reset instead of sending", async () => {
    plans({ plans: {}, models: [{ model: "claude-opus-5-5", at: NOW, resetsAt: RESET_AT }] });
    const { onSend, box } = setup({ backend: "claude", model: "claude-opus-5-5", sendLater });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Send at / })).toBeInTheDocument());
    await userEvent.type(box, "after the reset");
    await userEvent.click(screen.getByRole("button", { name: /^Send at / }));
    expect(api.schedule).toHaveBeenCalledWith("c1", "after the reset", RESET_AT);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("schedules for the CLI's weekly reset when the weekly window is spent", async () => {
    plans({ plans: { claude: { sevenDay: { used: 100, resetsAt: RESET_AT / 1000 }, at: NOW } } });
    const { onSend, box } = setup({ backend: "claude", model: "claude-opus-5-5", sendLater });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Send at / })).toBeInTheDocument());
    await userEvent.type(box, "after the weekly reset");
    await userEvent.click(screen.getByRole("button", { name: /^Send at / }));
    expect(api.schedule).toHaveBeenCalledWith("c1", "after the weekly reset", RESET_AT);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends normally when nothing is spent", async () => {
    plans({ plans: { claude: { fiveHour: { used: 20, resetsAt: RESET_AT / 1000 }, at: NOW } } });
    const { onSend, box } = setup({ backend: "claude", model: "claude-opus-5-5", sendLater });
    await waitFor(() => expect(screen.getByRole("button", { name: /Send/ })).toBeInTheDocument());
    await userEvent.type(box, "now");
    await userEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    expect(onSend).toHaveBeenCalled();
    expect(api.schedule).not.toHaveBeenCalled();
  });
});
