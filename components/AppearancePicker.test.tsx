// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCustomTheme } from "@/lib/custom-theme";
import AppearancePicker from "./AppearancePicker";
import "./test-utils";

const api = vi.hoisted(() => ({ themes: vi.fn(), createTheme: vi.fn(), themeFromPicture: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));
const theme = vi.hoisted(() => ({ setTheme: vi.fn(), setCustomTheme: vi.fn() }));
vi.mock("@/lib/theme", async (orig) => ({ ...(await orig<typeof import("@/lib/theme")>()), ...theme, savedTheme: () => "dark" }));

const neon = parseCustomTheme("neon", { label: "Neon Rain", prompt: "neon rain", colors: { canvas: "#000", ink: "#fff", accent: "#f0f" } }, ["picture.png"])!;
const swatch = parseCustomTheme("plain", { label: "Plain", colors: { canvas: "#111", ink: "#fff", accent: "#0ff" } })!;

const revoke = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:beach");
  URL.revokeObjectURL = revoke;
  api.themes.mockResolvedValue({ themes: [neon, swatch] });
});

describe("AppearancePicker", () => {
  it("lists prompted themes beside the scenes and picks one", async () => {
    render(<AppearancePicker />);
    fireEvent.click(await screen.findByRole("radio", { name: "Neon Rain" }));
    expect(theme.setCustomTheme).toHaveBeenCalledWith(neon);
    expect(screen.getByRole("radio", { name: "Neon Rain" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Plain" }).style.backgroundImage).toContain("linear-gradient");
  });

  it("starts a theme thread from a description and shows it painting", async () => {
    api.createTheme.mockResolvedValue({ id: "tokyo", card: { id: "c1" } });
    render(<AppearancePicker />);
    fireEvent.click(screen.getByRole("button", { name: /your own/i }));
    const box = screen.getByPlaceholderText(/rainy tokyo/i);
    fireEvent.change(box, { target: { value: "tokyo at night" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(api.createTheme).toHaveBeenCalledWith("tokyo at night"));
    expect(await screen.findByText("Painting…")).toBeInTheDocument();
  });

  it("shows a failure in place and closes on Escape", async () => {
    api.createTheme.mockRejectedValue(new Error("No folder"));
    render(<AppearancePicker />);
    fireEvent.click(screen.getByRole("button", { name: /your own/i }));
    const box = screen.getByPlaceholderText(/rainy tokyo/i);
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Paint it" }));
    expect(await screen.findByText("No folder")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/rainy tokyo/i)).toBeNull();
  });

  const beach = () => new File(["x"], "beach.jpg", { type: "image/jpeg" });
  const drop = (el: Element, files: File[]) => fireEvent.drop(el, { dataTransfer: { files, types: ["Files"] } });

  it("builds a theme around a picture you pick, words optional", async () => {
    api.themeFromPicture.mockResolvedValue({ id: "beach", card: { id: "c2" } });
    render(<AppearancePicker />);
    fireEvent.click(screen.getByRole("button", { name: /your own/i }));
    fireEvent.change(screen.getByLabelText("Theme picture"), { target: { files: [beach()] } });
    expect(screen.getByTitle(/beach\.jpg/).style.backgroundImage).toContain("blob:beach");
    expect(screen.getByPlaceholderText(/optional/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Theme it" }));
    await waitFor(() => expect(api.themeFromPicture).toHaveBeenCalledWith("", expect.objectContaining({ name: "beach.jpg" })));
    expect(api.createTheme).not.toHaveBeenCalled();
    expect(await screen.findByText("Painting…")).toBeInTheDocument();
  });

  it("opens with a picture dropped on the tile, and × takes it away", () => {
    render(<AppearancePicker />);
    const tile = screen.getByRole("button", { name: /your own/i });
    const over = fireEvent.dragOver(tile, { dataTransfer: { files: [], types: ["Files"] } });
    expect(over).toBe(false);
    drop(tile, [new File(["t"], "notes.txt", { type: "text/plain" })]);
    expect(screen.queryByLabelText("Theme picture")).toBeNull();
    drop(tile, [beach()]);
    expect(screen.getByRole("button", { name: "Theme it" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove the picture" }));
    expect(screen.getByRole("button", { name: "Paint it" })).toBeDisabled();
    expect(revoke).toHaveBeenCalledWith("blob:beach");
    expect(fireEvent.dragOver(screen.getByRole("button", { name: "Paint it" }).closest("form")!, { dataTransfer: { files: [], types: ["text/plain"] } })).toBe(true);
    drop(screen.getByRole("button", { name: "Paint it" }).closest("form")!, [beach()]);
    expect(screen.getByRole("button", { name: "Theme it" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Theme picture"), { target: { files: [] } });
    expect(screen.getByRole("button", { name: "Theme it" })).toBeInTheDocument();
  });
});
