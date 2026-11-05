// @vitest-environment jsdom
// A cron's on/off switch: the violet pill that says the cron is on, grey when it is off.

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CronSwitch from "./CronSwitch";
import "./test-utils";

describe("CronSwitch", () => {
  it("says it is on, and is called what the caller named it", () => {
    const view = render(<CronSwitch enabled label="Pause Nightly sweep" onToggle={vi.fn()} />);
    const sw = view.getByRole("switch", { name: "Pause Nightly sweep" });
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("says it is off", () => {
    const view = render(<CronSwitch enabled={false} label="Turn on" onToggle={vi.fn()} />);
    expect(view.getByRole("switch", { name: "Turn on" })).toHaveAttribute("aria-checked", "false");
  });

  it("tells its caller when it is clicked", () => {
    const onToggle = vi.fn();
    const view = render(<CronSwitch enabled label="Pause" onToggle={onToggle} />);
    fireEvent.click(view.getByRole("switch", { name: "Pause" }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("takes extra class names, for where it sits in its row", () => {
    const view = render(<CronSwitch enabled label="Pause" onToggle={vi.fn()} className="mt-0.5" />);
    expect(view.getByRole("switch", { name: "Pause" })).toHaveClass("mt-0.5");
  });
});
