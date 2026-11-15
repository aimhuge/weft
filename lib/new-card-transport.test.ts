// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { canBacklog, firstPlace, startModeFor, isWorkerDevice, localNewCard, NewCardTransportContext, useNewCardTransport, placeKey, placeOf, skillsCardFor, webNewCard } from "./new-card-transport";
import type { NewCardInput } from "./client-api";

const mac = { device: "mac-1", folder: "/dev/app", label: "app" };
const worker = { device: "worker:w1", folder: "site", label: "site" };
const places = [mac, worker];
const input = (over: Partial<NewCardInput> = {}): NewCardInput => ({ prompt: "Go", cwd: placeKey(mac), backend: "claude", start: true, ...over });

describe("the new-card transports", () => {
  it("defaults to this machine's own server", () => {
    expect(localNewCard).toEqual({ local: true });
    expect(renderHook(() => useNewCardTransport()).result.current).toBe(localNewCard);
    const web = { local: false, places: [] };
    const wrapper = ({ children }: { children: ReactNode }) => createElement(NewCardTransportContext.Provider, { value: web }, children);
    expect(renderHook(() => useNewCardTransport(), { wrapper }).result.current).toBe(web);
  });

  it("names a place by its machine and folder", () => {
    expect(placeKey(mac)).toBe("mac-1\n/dev/app");
    expect(placeOf(places, placeKey(worker))).toBe(worker);
    expect(isWorkerDevice("worker:w1")).toBe(true);
    expect(isWorkerDevice("mac-1")).toBe(false);
  });

  it("holds a card in Backlog on a Mac, never on a worker", () => {
    expect(canBacklog(placeKey(mac))).toBe(true);
    expect(canBacklog(placeKey(worker))).toBe(false);
  });

  it("opens on the board's project, else the most recent place, else nowhere", () => {
    expect(firstPlace(places, "site")).toBe(placeKey(worker));
    expect(firstPlace(places, null)).toBe(placeKey(mac));
    expect(firstPlace([], "x")).toBeUndefined();
  });

  it("reads a place's Mac's published start mode", () => {
    const of = startModeFor({ "mac-1": "default" });
    expect(of(placeKey(mac))).toBe("default");
    expect(of(placeKey(worker))).toBeUndefined();
  });

  it("finds a live card in the place to list its skills", () => {
    const rows = [
      { card_id: "gone", owner_device: "mac-1", folder: "/dev/app", deleted: true },
      { card_id: "c2", owner_device: "mac-1", folder: "/dev/app", deleted: false },
    ];
    expect(skillsCardFor(rows, placeKey(mac))).toBe("c2");
    expect(skillsCardFor(rows, placeKey(worker))).toBeUndefined();
  });
});

describe("webNewCard", () => {
  it("is the form for the place, with only what was picked", () => {
    expect(webNewCard(input(), places)).toEqual({ target: mac, form: { prompt: "Go", backend: "claude" } });
  });

  it("carries the model, effort, mode, tags, Backlog and a worktree", () => {
    const made = webNewCard(input({ model: "claude-opus-5-5", effort: "high", permissionMode: "acceptEdits", tags: ["ui"], start: false, isolated: true, branch: "feat/x" }), places);
    expect(made).toEqual({
      target: mac,
      form: { prompt: "Go", backend: "claude", model: "claude-opus-5-5", effort: "high", permissionMode: "acceptEdits", tags: ["ui"], backlog: true, isolated: true, branch: "feat/x" },
    });
    expect(webNewCard(input({ isolated: true }), places)).toMatchObject({ form: { isolated: true } });
  });

  it("leaves out skip-permissions and the agent", () => {
    const made = webNewCard(input({ permissionMode: "bypassPermissions", agent: "copywriter" }), places);
    expect(made).toEqual({ target: mac, form: { prompt: "Go", backend: "claude" } });
  });

  it("starts in plan mode with Plan first, on a worker only", () => {
    expect(webNewCard(input({ cwd: placeKey(worker), permissionMode: "auto" }), places, true)).toMatchObject({ form: { permissionMode: "plan" } });
    expect(webNewCard(input({ permissionMode: "auto" }), places, true)).toMatchObject({ form: { permissionMode: "auto" } });
  });

  it("says why it can't go: nowhere picked, or Backlog on a worker", () => {
    expect(webNewCard(input({ cwd: "nowhere" }), places)).toBe("Pick where it runs first.");
    expect(webNewCard(input({ cwd: placeKey(worker), start: false }), places)).toMatch(/no Backlog/);
    expect(webNewCard(input({ cwd: placeKey(worker) }), places)).toMatchObject({ target: worker });
  });
});
