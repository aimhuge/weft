// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { PushDevicesView } from "@/lib/push-devices";

const usePushDevices = vi.hoisted(() => vi.fn());
vi.mock("@/lib/use-push-devices", () => ({ usePushDevices }));
vi.mock("@/lib/use-now", () => ({ useNow: () => Date.parse("2026-10-29T12:00:00Z") }));

const { default: PhoneSettings } = await import("./PhoneSettings");

const remove = vi.fn<(id: string) => Promise<void>>();
function mount(view: PushDevicesView | null, error: string | null = null) {
  usePushDevices.mockReturnValue({ view, error, remove });
  return render(<PhoneSettings />);
}

const IPHONE = { id: "d1", platform: "ios" as const, deviceName: "Alex's iPhone", createdAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-29T11:00:00Z" };
const ANDROID = { id: "d2", platform: "android" as const, deviceName: null, createdAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-29T11:59:00Z" };

beforeEach(() => vi.clearAllMocks());

describe("PhoneSettings", () => {
  it("shows Loading before the first answer", () => {
    mount(null);
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("asks to sign in when signed out", () => {
    mount({ signedIn: false, devices: [] });
    expect(screen.getByText(/Sign in to Weft to see the phones/)).toBeInTheDocument();
  });

  it("explains pairing when there are no phones", () => {
    mount({ signedIn: true, devices: [] });
    expect(screen.getByText(/Sign in on the Weft phone app/)).toBeInTheDocument();
  });

  it("lists phones with a name, a platform and when they were seen", () => {
    mount({ signedIn: true, devices: [IPHONE, ANDROID] });
    expect(screen.getByText("Alex's iPhone")).toBeInTheDocument();
    expect(screen.getByText("Android phone")).toBeInTheDocument();
    expect(screen.getByText(/^iOS · seen/)).toBeInTheDocument();
    expect(screen.getByText(/^Android · seen/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("names an unnamed iPhone", () => {
    mount({ signedIn: true, devices: [{ ...IPHONE, deviceName: null }] });
    expect(screen.getByText("iPhone")).toBeInTheDocument();
  });

  it("removes a phone", async () => {
    remove.mockResolvedValue(undefined);
    mount({ signedIn: true, devices: [IPHONE] });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledWith("d1");
  });

  it("shows a failed remove", async () => {
    remove.mockRejectedValueOnce(new Error("Couldn't remove that phone: nope")).mockRejectedValueOnce("plain");
    mount({ signedIn: true, devices: [IPHONE] });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Couldn't remove that phone: nope")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("plain")).toBeInTheDocument();
  });

  it("shows a read error", () => {
    mount(null, "down");
    expect(screen.getByText("Couldn't read your phones: down")).toBeInTheDocument();
  });
});
