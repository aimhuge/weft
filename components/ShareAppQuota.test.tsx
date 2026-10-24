// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "./test-utils";
import { ShareAppQuota } from "./ShareAppQuota";

const MB = 1024 * 1024;

describe("ShareAppQuota", () => {
  it("shows the room in use against the plan's cap", () => {
    render(<ShareAppQuota quota={{ plan: "free", planName: "Free", used: 12 * MB, cap: 25 * MB }} />);
    expect(screen.getByText(/Shared apps: 12 MB of 25 MB on Free/)).toBeTruthy();
  });

  it("shows why the latest edits didn't go up", () => {
    render(<ShareAppQuota quota={{ plan: "free", planName: "Free", used: 0, cap: 25 * MB, over: "This app is 31 MB." }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/This app is 31 MB\. The link still shows the last version that fit\./);
  });

  it("draws nothing when the server couldn't say", () => {
    const { container } = render(<ShareAppQuota quota={null} />);
    expect(container.textContent).toBe("");
  });
});
