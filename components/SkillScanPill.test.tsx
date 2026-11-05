// @vitest-environment jsdom
// The scan's verdict pills, the findings worth reading, and the ⚠ beside a skill you have.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillScan } from "@/lib/types";
import { ScanBadge, ScanPills, topFindings } from "./SkillScanPill";
import "./test-utils";

afterEach(cleanup);

const scan = (over: Partial<SkillScan> = {}): SkillScan => ({
  verdict: "clean",
  findings: [],
  license: { spdx: "MIT", kind: "permissive" },
  hosts: [],
  files: 1,
  bytes: 10,
  ...over,
});

const finding = (over: Partial<SkillScan["findings"][number]> = {}) => ({
  severity: "warn" as const,
  category: "code" as const,
  rule: "r",
  message: "Ships an analytics SDK",
  ...over,
});

describe("ScanPills", () => {
  it("says the static scan's verdict", () => {
    render(<ScanPills scan={scan({ verdict: "danger" })} review={{ status: "none" }} />);
    expect(screen.getByText("Danger")).toBeInTheDocument();
  });

  it("says Worth a look for a warning, and Clean for a clean scan", () => {
    const { unmount } = render(<ScanPills scan={scan({ verdict: "warn" })} review={{ status: "none" }} />);
    expect(screen.getByText("Worth a look")).toBeInTheDocument();
    unmount();
    render(<ScanPills scan={scan()} review={{ status: "none" }} />);
    expect(screen.getByText("Clean")).toBeInTheDocument();
  });

  it("says the AI review's verdict when it's done", () => {
    render(
      <ScanPills
        scan={scan()}
        review={{ status: "done", page: "/p.html", review: { verdict: "unsafe", summary: "", whatItDoes: "", concerns: [], falsePositives: [], dataFlow: "", license: "", recommendation: "", model: "", reviewedAt: "" } }}
      />,
    );
    expect(screen.getByText("AI: Unsafe")).toBeInTheDocument();
  });

  it("says the review is reading while it runs", () => {
    render(<ScanPills scan={scan()} review={{ status: "running", page: "/p.html" }} />);
    expect(screen.getByText("AI reading…")).toBeInTheDocument();
  });

  it("says nothing about the AI when there's no review yet", () => {
    render(<ScanPills scan={scan()} review={{ status: "none" }} />);
    expect(screen.queryByText(/AI:/)).toBeNull();
    expect(screen.queryByText("AI reading…")).toBeNull();
  });

  it("names the licence, and where it came from", () => {
    render(<ScanPills scan={scan({ license: { spdx: "MIT", kind: "permissive", file: "LICENSE" } })} review={{ status: "none" }} />);
    expect(screen.getByText("MIT")).toHaveAttribute("title", "From LICENSE");
  });

  it("says there's no licence, when there isn't one", () => {
    render(<ScanPills scan={scan({ license: { spdx: null, kind: "none" } })} review={{ status: "none" }} />);
    expect(screen.getByText("No license")).toBeInTheDocument();
  });

  it("asks about a licence it didn't recognise", () => {
    render(<ScanPills scan={scan({ license: { spdx: null, kind: "unknown" } })} review={{ status: "none" }} />);
    expect(screen.getByText("License?")).toBeInTheDocument();
  });
});

describe("topFindings", () => {
  it("leaves out the notes and the licence, and takes the first few", () => {
    const s = scan({
      findings: [
        finding({ severity: "info", message: "just a note" }),
        finding({ severity: "warn", category: "license", message: "no licence" }),
        finding({ severity: "warn", message: "first" }),
        finding({ severity: "danger", message: "second" }),
        finding({ severity: "warn", message: "third" }),
        finding({ severity: "warn", message: "fourth" }),
      ],
    });
    expect(topFindings(s).map((f) => f.message)).toEqual(["first", "second", "third"]);
    expect(topFindings(s, 1).map((f) => f.message)).toEqual(["first"]);
  });

  it("says there is nothing worth reading when there's nothing", () => {
    expect(topFindings(scan())).toEqual([]);
  });
});

describe("ScanBadge", () => {
  it("shows nothing when there's no scan", () => {
    const { container } = render(<ScanBadge scan={undefined} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows nothing when the scan found only notes", () => {
    const { container } = render(<ScanBadge scan={scan({ findings: [finding({ severity: "info" })] })} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows nothing when the scan found only a licence note", () => {
    const { container } = render(<ScanBadge scan={scan({ findings: [finding({ category: "license" })] })} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("says it's worth a look, and lists the findings", () => {
    render(<ScanBadge scan={scan({ verdict: "warn", findings: [finding({ message: "Ships an analytics SDK" })] })} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Worth a look: Ships an analytics SDK/ })).toBeInTheDocument();
  });

  it("says it's dangerous when the scan says so", () => {
    render(<ScanBadge scan={scan({ verdict: "danger", findings: [finding({ severity: "danger", message: "Pipes into a shell" })] })} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Danger: Pipes into a shell/ })).toBeInTheDocument();
  });

  it("opens the review, and doesn't let the click reach the row under it", () => {
    const onOpen = vi.fn();
    render(<ScanBadge scan={scan({ findings: [finding()] })} onOpen={onOpen} />);
    const badge = screen.getByRole("button", { name: /Worth a look/ });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    badge.dispatchEvent(click);
    expect(onOpen).toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
  });

  it("lists up to four findings", () => {
    const findings = Array.from({ length: 6 }, (_, i) => finding({ message: `finding ${i}` }));
    render(<ScanBadge scan={scan({ findings })} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /finding 0/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /finding 3/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finding 4/ })).toBeNull();
  });
});
