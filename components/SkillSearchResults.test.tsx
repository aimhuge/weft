// @vitest-environment jsdom
// The ✦ filter's reach past your own library: what skills.sh has for the same words — a row's name opens a
// thread on the skill, its ▾ opens Weft's static scan here, with Review and Install. The scan and the install
// have their own file (components/SkillSearchResults.scan.test.tsx); this one is the search and the thread.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SkillSearchResults from "./SkillSearchResults";
import { hit, preview } from "./skills.harness";
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

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  registry.search.mockResolvedValue({ skills: [] });
});

function setup(query = "pdf", cwd = "/dev/app", onInstalled = vi.fn()) {
  return { onInstalled, view: render(<SkillSearchResults query={query} cwd={cwd} onInstalled={onInstalled} />) };
}

describe("SkillSearchResults", () => {
  it("says nothing for a query too short to search", () => {
    const { view } = setup("p");
    expect(view.queryByLabelText("From skills.sh")).toBeNull();
    expect(registry.search).not.toHaveBeenCalled();
  });

  it("says nothing for a query of only spaces", () => {
    const { view } = setup("   ");
    expect(view.queryByLabelText("From skills.sh")).toBeNull();
  });

  it("searches skills.sh for the words you typed", async () => {
    registry.search.mockResolvedValue({ skills: [hit] });
    const { view } = setup("pdf");
    expect(await view.findByText("/pdf")).toBeInTheDocument();
    expect(registry.search).toHaveBeenCalledWith("pdf", "/dev/app", expect.anything());
  });

  it("says it's searching while it waits", () => {
    registry.search.mockReturnValue(new Promise(() => {}));
    const { view } = setup("pdf");
    expect(view.getByText("Searching…")).toBeInTheDocument();
  });

  it("says when skills.sh can't be reached", async () => {
    registry.search.mockRejectedValue(new Error("skills.sh answered 503."));
    const { view } = setup("pdf");
    expect(await view.findByText(/Couldn’t reach skills.sh: skills.sh answered 503./)).toBeInTheDocument();
  });

  it("says when skills.sh has nothing for the words", async () => {
    const { view } = setup("pdf");
    expect(await view.findByText(/Nothing on skills.sh for “pdf” either./)).toBeInTheDocument();
  });

  it("shows how many installs a hit has, in thousands", async () => {
    registry.search.mockResolvedValue({ skills: [hit] });
    const { view } = setup("pdf");
    expect(await view.findByText("acme/skills · 22k")).toBeInTheDocument();
  });

  it("shows a hit's installs as they are below a thousand", async () => {
    registry.search.mockResolvedValue({ skills: [{ ...hit, installs: 999 }] });
    const { view } = setup("pdf");
    expect(await view.findByText("acme/skills · 999")).toBeInTheDocument();
  });

  it("shows a hit's installs with a decimal under ten thousand", async () => {
    registry.search.mockResolvedValue({ skills: [{ ...hit, installs: 1500 }] });
    const { view } = setup("pdf");
    expect(await view.findByText("acme/skills · 1.5k")).toBeInTheDocument();
  });

  it("says a hit is already installed", async () => {
    registry.search.mockResolvedValue({ skills: [{ ...hit, installed: true }] });
    const { view } = setup("pdf");
    expect(await view.findByText("Installed")).toBeInTheDocument();
  });

  it("opens a hit in a new thread, and opens that thread's card", async () => {
    registry.search.mockResolvedValue({ skills: [hit] });
    startSkillThread.mockResolvedValue("card-9");
    const { view } = setup("pdf");
    fireEvent.click(await view.findByText("/pdf"));
    await waitFor(() => expect(openCardById).toHaveBeenCalledWith("card-9"));
    expect(startSkillThread).toHaveBeenCalledWith(hit, "/dev/app");
  });

  it("shows that a thread is starting", async () => {
    registry.search.mockResolvedValue({ skills: [hit] });
    startSkillThread.mockReturnValue(new Promise(() => {}));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByText("/pdf"));
    expect(await view.findByText("Starting a thread…")).toBeInTheDocument();
  });

  it("says why a thread didn't start, under the hit", async () => {
    registry.search.mockResolvedValue({ skills: [hit] });
    startSkillThread.mockRejectedValue(new Error("No such folder."));
    const { view } = setup("pdf");
    fireEvent.click(await view.findByText("/pdf"));
    expect(await view.findByText("No such folder.")).toBeInTheDocument();
    expect(openCardById).not.toHaveBeenCalled();
  });

  it("scans a hit in place when there is no folder to start a thread in", async () => {
    registry.search.mockResolvedValue({ skills: [hit] });
    registry.preview.mockResolvedValue(preview());
    const view = render(<SkillSearchResults query="pdf" onInstalled={vi.fn()} />);
    fireEvent.click(await view.findByText("/pdf"));
    expect(await view.findByText("Read PDFs")).toBeInTheDocument();
    expect(startSkillThread).not.toHaveBeenCalled();
  });
});
