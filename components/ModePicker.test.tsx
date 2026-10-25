// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ModePicker from "./ModePicker";
import "./test-utils";

describe("ModePicker", () => {
  it("shows the mode on its button and explains every mode in its menu", async () => {
    render(<ModePicker value="auto" onChange={() => {}} />);
    const button = screen.getByRole("button", { name: "Permissions: Auto" });
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(button);
    const yolo = screen.getByRole("menuitemradio", { name: /YOLO/ });
    expect(yolo).toHaveTextContent("Runs every tool without asking");
    expect(screen.getByRole("menuitemradio", { name: /Auto/ })).toHaveAttribute("aria-checked", "true");
  });

  it("picks a mode and closes; the same mode again changes nothing", async () => {
    const onChange = vi.fn();
    render(<ModePicker value="auto" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Permissions: Auto" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Ask me/ }));
    expect(onChange).toHaveBeenCalledWith("default");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Permissions: Auto" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Auto/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and on a click outside", async () => {
    render(<ModePicker value="auto" onChange={() => {}} up end />);
    const button = screen.getByRole("button", { name: "Permissions: Auto" });
    await userEvent.click(button);
    expect(screen.getByRole("menu")).toHaveClass("bottom-full", "right-0");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(button);
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("hides YOLO where it isn't offered, and Codex names its own modes", async () => {
    const { unmount } = render(<ModePicker value="auto" yolo={false} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Permissions: Auto" }));
    expect(screen.queryByRole("menuitemradio", { name: /YOLO/ })).toBeNull();
    unmount();
    render(<ModePicker backend="codex" value="default" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Permissions: Read only" }));
    expect(screen.getByRole("menuitemradio", { name: /Full access/ })).toBeInTheDocument();
  });

  it("can't open while a Codex session holds its sandbox mode", () => {
    render(<ModePicker backend="codex" value="default" disabled onChange={() => {}} />);
    const button = screen.getByRole("button", { name: "Permissions: Read only" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/keeps its sandbox mode/));
  });
});
