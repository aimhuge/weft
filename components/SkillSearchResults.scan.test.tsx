// @vitest-environment jsdom
// The ✦ filter's static scan of a skill from skills.sh: what it found, the AI review of it in the pane, and
// installing it — with a dangerous one asking first.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SkillSearchResults from "./SkillSearchResults";
import { hit, preview, scan } from "./skills.harness";
import "./test-utils";

const registry = vi.hoisted(() => ({
  search: vi.fn(),
  preview: vi.fn(),
  install: vi.fn(),
  review: vi.fn(),
  reviewState: vi.fn(),
}));
const startSkillThread = vi.hoisted(() => vi.fn());
vi.mock("@/lib/skill-registry-client", () => ({ skillRegistry: registry, startSkillThread }));
const openCardById = vi.hoisted(() => vi.fn());
vi.mock("@/lib/open-card", () => ({ openCardById }));
const openInPane = vi.hoisted(() => vi.fn());
vi.mock("@/lib/open-in-pane", () => ({ openInPane }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  registry.search.mockResolvedValue({ skills: [hit] });
});

function setup(query = "pdf", cwd = "/dev/app", onInstalled = vi.fn()) {
  return { onInstalled, view: render(<SkillSearchResults query={query} cwd={cwd} onInstalled={onInstalled} />) };
}

// The scan's own findings, at the shape the registry hands them over.
const danger = (over: Partial<ReturnType<typeof scan>> = {}) =>
  scan({ verdict: "danger", findings: [{ severity: "danger", category: "code", rule: "pipe", message: "Pipes into a shell" }], ...over });

describe("SkillSearchResults' scan", () => {
  it("scans a hit in place from its ▾", async () => {
    registry.preview.mockResolvedValue(preview());
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    expect(await view.findByText("Read PDFs")).toBeInTheDocument();
    expect(startSkillThread).not.toHaveBeenCalled();
  });

  it("says it's fetching the scan", async () => {
    registry.preview.mockReturnValue(new Promise(() => {}));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    expect(await view.findByText("Fetching and scanning…")).toBeInTheDocument();
  });

  it("says why the scan failed", async () => {
    registry.preview.mockRejectedValue(new Error("skills.sh answered 503."));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    expect(await view.findByText("skills.sh answered 503.")).toBeInTheDocument();
  });

  it("says why the scan failed, when it didn't fail with an error", async () => {
    registry.preview.mockRejectedValue("just a string");
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    expect(await view.findByText("just a string")).toBeInTheDocument();
  });

  it("folds the scan back away", async () => {
    registry.preview.mockResolvedValue(preview());
    const { view } = setup("pdf");
    const fold = await view.findByRole("button", { name: "Quick scan of /pdf" });
    fireEvent.click(fold);
    await view.findByText("Read PDFs");
    fireEvent.click(view.getByRole("button", { name: "Quick scan of /pdf" }));
    expect(view.queryByText("Read PDFs")).toBeNull();
  });

  it("says a skill is one Weft kept, when skills.sh is unreachable", async () => {
    registry.preview.mockResolvedValue(preview({ offline: true }));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    expect(await view.findByText(/skills.sh is unreachable/)).toBeInTheDocument();
  });

  it("shows the findings worth reading, with where they are", async () => {
    registry.preview.mockResolvedValue(preview({ scan: danger({ findings: [{ severity: "danger", category: "code", rule: "pipe", message: "Pipes into a shell", file: "SKILL.md", line: 4 }] }) }));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    expect(await view.findByText(/⛔ Pipes into a shell · SKILL.md:4/)).toBeInTheDocument();
  });

  it("shows a finding with no line in it", async () => {
    registry.preview.mockResolvedValue(preview({ scan: danger({ findings: [{ severity: "warn", category: "code", rule: "pipe", message: "Pipes into a shell", file: "SKILL.md" }] }) }));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    expect(await view.findByText(/⚠ Pipes into a shell · SKILL.md/)).toBeInTheDocument();
  });
});

describe("SkillSearchResults' install", () => {
  it("installs a hit once you've looked at it", async () => {
    registry.preview.mockResolvedValue(preview());
    registry.install.mockResolvedValue({ name: "pdf", scan: scan() });
    const onInstalled = vi.fn();
    const view = render(<SkillSearchResults query="pdf" cwd="/dev/app" onInstalled={onInstalled} />);
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    await view.findByText("Read PDFs");
    fireEvent.click(view.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalled());
    expect(registry.install).toHaveBeenCalledWith("acme/skills/pdf", false);
    expect(view.getByText("Installed")).toBeInTheDocument();
  });

  it("asks before installing a dangerous skill", async () => {
    registry.preview.mockResolvedValue(preview({ scan: danger() }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    await view.findByText("Read PDFs");
    fireEvent.click(view.getByRole("button", { name: "Install anyway…" }));
    expect(registry.install).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("asks before installing a skill the review called unsafe", async () => {
    const unsafe = {
      status: "done" as const,
      page: "/tmp/r.html",
      review: { verdict: "unsafe" as const, summary: "It runs shell commands.", whatItDoes: "", concerns: [], falsePositives: [], dataFlow: "", license: "", recommendation: "", model: "", reviewedAt: "" },
    };
    registry.preview.mockResolvedValue(preview({ review: unsafe }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    await view.findByText("Read PDFs");
    fireEvent.click(view.getByRole("button", { name: "Install anyway…" }));
    expect(registry.install).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("says why the install failed", async () => {
    registry.preview.mockResolvedValue(preview());
    registry.install.mockRejectedValue(new Error("the folder is read-only"));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    await view.findByText("Read PDFs");
    fireEvent.click(view.getByRole("button", { name: "Install" }));
    expect(await view.findByText("the folder is read-only")).toBeInTheDocument();
  });

  it("says why the install failed, when it didn't fail with an error", async () => {
    registry.preview.mockResolvedValue(preview());
    registry.install.mockRejectedValue("just a string");
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    await view.findByText("Read PDFs");
    fireEvent.click(view.getByRole("button", { name: "Install" }));
    expect(await view.findByText("just a string")).toBeInTheDocument();
  });

  it("doesn't offer to install a skill you already have", async () => {
    registry.preview.mockResolvedValue(preview({ installed: true }));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    await view.findByText("Read PDFs");
    expect(view.queryByRole("button", { name: "Install" })).toBeNull();
  });
});

describe("SkillSearchResults' AI review", () => {
  it("starts an AI review and opens its page in the pane", async () => {
    registry.preview.mockResolvedValue(preview());
    registry.review.mockResolvedValue({ status: "running", page: "/tmp/r.html" });
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    await view.findByText("Read PDFs");
    fireEvent.click(view.getByRole("button", { name: "AI review" }));
    expect(registry.review).toHaveBeenCalledWith({ id: "acme/skills/pdf", hash: "a".repeat(64) });
    await waitFor(() => expect(openInPane).toHaveBeenCalledWith("file:///tmp/r.html"));
    expect(await view.findByText("AI reading…")).toBeInTheDocument();
  });

  it("says the review failed, and offers to try again", async () => {
    registry.preview.mockResolvedValue(preview());
    registry.review.mockResolvedValue({ status: "failed", page: "/tmp/r.html", error: "the model was busy" });
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    await view.findByText("Read PDFs");
    fireEvent.click(view.getByRole("button", { name: "AI review" }));
    expect(await view.findByRole("button", { name: "Retry review" })).toBeInTheDocument();
  });

  it("says why the review didn't open", async () => {
    registry.preview.mockResolvedValue(preview());
    registry.review.mockRejectedValue(new Error("no review for you"));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    await view.findByText("Read PDFs");
    fireEvent.click(view.getByRole("button", { name: "AI review" }));
    expect(await view.findByText("Error: no review for you")).toBeInTheDocument();
  });

  it("shows the review's summary once it's done", async () => {
    const done = {
      status: "done" as const,
      page: "/tmp/r.html",
      review: { verdict: "safe" as const, summary: "It only reads PDFs.", whatItDoes: "", concerns: [], falsePositives: [], dataFlow: "", license: "", recommendation: "", model: "", reviewedAt: "" },
    };
    registry.preview.mockResolvedValue(preview({ review: done }));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByRole("button", { name: "Quick scan of /pdf" }));
    expect(await view.findByText("It only reads PDFs.")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Open review" })).toBeInTheDocument();
  });
});
