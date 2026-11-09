// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

const call = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/client-api", () => ({ call: (...args: unknown[]) => call(...args) }));

import { SqlAutoAcceptSwitch } from "./SqlAutoAcceptSwitch";

// Settings → Security → Accept harmless SQL: loads its state from /api/sql-review and PUTs each toggle.
const box = () => screen.getByRole<HTMLInputElement>("checkbox");

beforeEach(() => call.mockReset());

describe("SqlAutoAcceptSwitch", () => {
  it("is disabled until the state loads, then shows it", async () => {
    let resolve!: (v: { autoAccept: boolean }) => void;
    call.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<SqlAutoAcceptSwitch />);
    expect(box()).toBeDisabled();
    expect(call).toHaveBeenCalledWith("GET", "/api/sql-review");
    resolve({ autoAccept: true });
    await waitFor(() => expect(box()).toBeEnabled());
    expect(box()).toBeChecked();
  });

  it("reads off and stays usable when the GET fails", async () => {
    call.mockRejectedValueOnce(new Error("offline"));
    render(<SqlAutoAcceptSwitch />);
    await waitFor(() => expect(box()).toBeEnabled());
    expect(box()).not.toBeChecked();
  });

  it("PUTs autoAccept true when turned on", async () => {
    call.mockResolvedValueOnce({ autoAccept: false }).mockResolvedValueOnce({});
    render(<SqlAutoAcceptSwitch />);
    await waitFor(() => expect(box()).toBeEnabled());
    await userEvent.click(box());
    expect(call).toHaveBeenLastCalledWith("PUT", "/api/sql-review", { autoAccept: true });
    expect(box()).toBeChecked();
  });

  it("goes back when the PUT fails", async () => {
    call.mockResolvedValueOnce({ autoAccept: false }).mockRejectedValueOnce(new Error("500"));
    render(<SqlAutoAcceptSwitch />);
    await waitFor(() => expect(box()).toBeEnabled());
    await userEvent.click(box());
    await waitFor(() => expect(box()).not.toBeChecked());
    expect(call).toHaveBeenCalledTimes(2);
  });
});
