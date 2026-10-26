// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { RemoteSkillPreview, SkillScan, SkillSetRow, SkillSetView } from "@/lib/types";

const registry = vi.hoisted(() => ({
  search: vi.fn(),
  preview: vi.fn(),
  install: vi.fn(),
  review: vi.fn(),
  reviewState: vi.fn(),
  scans: vi.fn(),
}));
const startSkillThread = vi.hoisted(() => vi.fn());
vi.mock("@/lib/skill-registry-client", () => ({ skillRegistry: registry, startSkillThread }));
const openCardById = vi.hoisted(() => vi.fn());
vi.mock("@/lib/open-card", () => ({ openCardById }));
const openInPane = vi.hoisted(() => vi.fn());
vi.mock("@/lib/open-in-pane", () => ({ openInPane }));

import SkillSetList from "./SkillSetList";

const scan = (over: Partial<SkillScan> = {}): SkillScan => ({ verdict: "clean", findings: [], license: { spdx: "MIT", kind: "permissive" }, hosts: [], files: 1, bytes: 10, ...over });
const preview = (over: Partial<RemoteSkillPreview> = {}): RemoteSkillPreview => ({
  id: "acme/skills/pdf",
  source: "acme/skills",
  name: "pdf",
  description: "Read PDFs",
  hash: "a".repeat(64),
  files: [{ path: "SKILL.md", bytes: 10 }],
  scan: scan(),
  review: { status: "none" },
  installed: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  registry.scans.mockResolvedValue({ scans: {} });
  registry.search.mockResolvedValue({ skills: [] });
});

const row = (over: Partial<SkillSetRow>): SkillSetRow => ({ kind: "skill", name: "x", description: "", source: "user", inProject: true, on: true, changedHere: false, ...over });

const view: SkillSetView = {
  seeded: true,
  rows: [
    row({ name: "weft:done", source: "weft", description: "Wrap up" }),
    row({ name: "tdac", description: "Arrival card", on: false, inProject: false }),
    row({ name: "commit", on: false, inProject: true, changedHere: true }),
    row({ kind: "plugin", name: "posthog@posthog", label: "posthog", source: "plugin", skills: 173, on: false, inProject: false }),
  ],
};

describe("SkillSetList", () => {
  it("shows a loading line until the set arrives", () => {
    render(<SkillSetList view={null} forCard={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Loading skills…")).toBeInTheDocument();
  });

  it("groups rows with their on counts, a plugin with its skill count", () => {
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} />);
    expect(screen.getByText("Weft")).toBeInTheDocument();
    expect(screen.getByText("Yours · ~/.claude/skills")).toBeInTheDocument();
    expect(screen.getByText("0/2 on")).toBeInTheDocument();
    expect(screen.getByText("posthog · 173 skills")).toBeInTheDocument();
    expect(screen.queryByText("This project")).not.toBeInTheDocument();
  });

  it("switches a row", async () => {
    const onToggle = vi.fn();
    render(<SkillSetList view={view} forCard={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("switch", { name: "/tdac off" }));
    expect(onToggle).toHaveBeenCalledWith("tdac", true);
    await userEvent.click(screen.getByRole("switch", { name: "/weft:done on" }));
    expect(onToggle).toHaveBeenCalledWith("weft:done", false);
  });

  it("filters, and says when nothing matches here or on skills.sh", async () => {
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} cwd="/dev/app" />);
    await userEvent.type(screen.getByLabelText("Filter skills or search skills.sh"), "arrival");
    expect(screen.getByText("/tdac")).toBeInTheDocument();
    expect(screen.queryByText("/weft:done")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Filter skills or search skills.sh"), "zzz");
    expect(screen.getByText(/None of your skills match/)).toBeInTheDocument();
    expect(await screen.findByText(/Nothing on skills.sh for/)).toBeInTheDocument();
    expect(registry.search).toHaveBeenLastCalledWith("arrivalzzz", "/dev/app", expect.anything());
  });

  it("says when skills.sh can't be reached", async () => {
    registry.search.mockRejectedValue(new Error("skills.sh answered 503."));
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Filter skills or search skills.sh"), "pdf");
    expect(await screen.findByText(/Couldn’t reach skills.sh: skills.sh answered 503./)).toBeInTheDocument();
  });

  it("opens a skills.sh hit to its scan and installs it", async () => {
    registry.search.mockResolvedValue({ skills: [{ id: "acme/skills/pdf", source: "acme/skills", name: "pdf", installs: 21_600, installed: false }] });
    registry.preview.mockResolvedValue(preview());
    registry.install.mockResolvedValue({ name: "pdf", scan: scan() });
    const onInstalled = vi.fn();
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} onInstalled={onInstalled} />);
    await userEvent.type(screen.getByLabelText("Filter skills or search skills.sh"), "pdf");
    await userEvent.click(await screen.findByText("/pdf"));
    expect(screen.getByText("acme/skills · 22k")).toBeInTheDocument();
    expect(await screen.findByText("Read PDFs")).toBeInTheDocument();
    expect(screen.getByText("Clean")).toBeInTheDocument();
    expect(screen.getByText("MIT")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalled());
    expect(registry.install).toHaveBeenCalledWith("acme/skills/pdf", false);
    expect(screen.getByText("Installed")).toBeInTheDocument();
  });

  it("opens a skills.sh hit in a new thread in the list's folder", async () => {
    const hit = { id: "acme/skills/pdf", source: "acme/skills", name: "pdf", installs: 12, installed: false };
    registry.search.mockResolvedValue({ skills: [hit] });
    startSkillThread.mockResolvedValue("card-9");
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} cwd="/dev/app" />);
    await userEvent.type(screen.getByLabelText("Filter skills or search skills.sh"), "pdf");
    await userEvent.click(await screen.findByText("/pdf"));
    await waitFor(() => expect(openCardById).toHaveBeenCalledWith("card-9"));
    expect(startSkillThread).toHaveBeenCalledWith(hit, "/dev/app");
    expect(registry.preview).not.toHaveBeenCalled();
  });

  it("shows why a skill thread didn't start, under the hit", async () => {
    registry.search.mockResolvedValue({ skills: [{ id: "acme/skills/pdf", source: "acme/skills", name: "pdf", installs: 12, installed: false }] });
    registry.preview.mockReturnValue(new Promise(() => {}));
    startSkillThread.mockRejectedValue(new Error("No such folder."));
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} cwd="/dev/app" />);
    await userEvent.type(screen.getByLabelText("Filter skills or search skills.sh"), "pdf");
    await userEvent.click(await screen.findByText("/pdf"));
    expect(await screen.findByText("No such folder.")).toBeInTheDocument();
    expect(openCardById).not.toHaveBeenCalled();
  });

  it("scans a hit in place from its ▾", async () => {
    registry.search.mockResolvedValue({ skills: [{ id: "acme/skills/pdf", source: "acme/skills", name: "pdf", installs: 12, installed: false }] });
    registry.preview.mockResolvedValue(preview());
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} cwd="/dev/app" />);
    await userEvent.type(screen.getByLabelText("Filter skills or search skills.sh"), "pdf");
    await userEvent.click(await screen.findByRole("button", { name: "Quick scan of /pdf" }));
    expect(await screen.findByText("Read PDFs")).toBeInTheDocument();
    expect(startSkillThread).not.toHaveBeenCalled();
  });

  it("asks before installing a dangerous skill, and shows its findings", async () => {
    const danger = scan({ verdict: "danger", findings: [{ severity: "danger", category: "code", rule: "pipe-to-shell", message: "Pipes a script into a shell", file: "SKILL.md", line: 4 }] });
    registry.search.mockResolvedValue({ skills: [{ id: "acme/skills/pdf", source: "acme/skills", name: "pdf", installs: 12, installed: false }] });
    registry.preview.mockResolvedValue(preview({ scan: danger }));
    registry.install.mockResolvedValue({ name: "pdf", scan: danger });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Filter skills or search skills.sh"), "pdf");
    await userEvent.click(await screen.findByText("/pdf"));
    expect(await screen.findByText(/Pipes a script into a shell · SKILL.md:4/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Install anyway…" }));
    expect(registry.install).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Install anyway…" }));
    await waitFor(() => expect(registry.install).toHaveBeenCalledWith("acme/skills/pdf", true));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("starts an AI review of a hit and opens its page in the pane", async () => {
    registry.search.mockResolvedValue({ skills: [{ id: "acme/skills/pdf", source: "acme/skills", name: "pdf", installs: 12, installed: true }] });
    registry.preview.mockResolvedValue(preview({ installed: true }));
    registry.review.mockResolvedValue({ status: "running", page: "/Users/me/.weft/show/skill-reviews/pdf.html" });
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Filter skills or search skills.sh"), "pdf");
    await userEvent.click(await screen.findByText("/pdf"));
    await userEvent.click(await screen.findByRole("button", { name: "AI review" }));
    expect(registry.review).toHaveBeenCalledWith({ id: "acme/skills/pdf", hash: "a".repeat(64) });
    expect(openInPane).toHaveBeenCalledWith("file:///Users/me/.weft/show/skill-reviews/pdf.html");
    expect(await screen.findByText("AI reading…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("puts a ⚠ on a skill whose scan found something, which opens its review", async () => {
    const flagged = scan({ verdict: "warn", findings: [{ severity: "warn", category: "telemetry", rule: "analytics", message: "Ships an analytics SDK" }] });
    registry.scans.mockResolvedValue({ scans: { tdac: flagged, commit: scan({ verdict: "warn", findings: [{ severity: "warn", category: "license", rule: "license-none", message: "No license" }] }) } });
    registry.review.mockResolvedValue({ status: "done", page: "/tmp/r.html", review: {} });
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} cwd="/dev/app" />);
    const badge = await screen.findByRole("button", { name: /Worth a look: Ships an analytics SDK/ });
    // A license note alone isn't worth a badge.
    expect(screen.getAllByRole("button", { name: /Worth a look/ })).toHaveLength(1);
    await userEvent.click(badge);
    await waitFor(() => expect(openInPane).toHaveBeenCalledWith("file:///tmp/r.html"));
    expect(registry.review).toHaveBeenCalledWith({ cwd: "/dev/app", name: "tdac" });
  });

  it("marks a card's change from its project, only in a card's menu", () => {
    const { unmount } = render(<SkillSetList view={view} forCard onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Off for this card; on in the project")).toBeInTheDocument();
    unmount();
    render(<SkillSetList view={view} forCard={false} onToggle={vi.fn()} />);
    expect(screen.queryByLabelText("Off for this card; on in the project")).not.toBeInTheDocument();
  });

  it("says when the project's set isn't seeded yet", () => {
    render(<SkillSetList view={{ ...view, seeded: false }} forCard={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/Until then every skill is on/)).toBeInTheDocument();
  });
});
