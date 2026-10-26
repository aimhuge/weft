import { describe, expect, it } from "vitest";
import { formatAxTree } from "./pane-ax.cjs";
import { node, prop, type AxNode } from "./pane-ax-fakes";

describe("formatAxTree", () => {
  it("skips an unnamed leaf with no children", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3"] }),
      node({ nodeId: "2", role: { value: "article" }, name: { value: "" } }),
      node({ nodeId: "3", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 1 }),
    ];
    expect(formatAxTree(nodes).text).toBe("- button \"Go\" [ref=e1]");
  });

  it("keeps an unnamed actionable leaf", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "button" }, name: { value: "" }, backendDOMNodeId: 1 }),
    ];
    expect(formatAxTree(nodes).text).toBe("- button [ref=e1]");
  });

  it("keeps an unnamed actionable node that has children", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "button" }, name: { value: "" }, backendDOMNodeId: 1, childIds: ["3"] }),
      node({ nodeId: "3", role: { value: "StaticText" }, name: { value: "Inside" } }),
    ];
    expect(formatAxTree(nodes).text).toBe(["- button [ref=e1]", "  - text: \"Inside\""].join("\n"));
  });

  it("keeps an unnamed node that is only focusable", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "article" }, name: { value: "" }, properties: [prop("focusable", true)], backendDOMNodeId: 1 }),
    ];
    expect(formatAxTree(nodes).text).toBe("- article [ref=e1]");
  });

  it("drops lines over maxLines and says how many", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3", "4"] }),
      node({ nodeId: "2", role: { value: "button" }, name: { value: "One" }, backendDOMNodeId: 1 }),
      node({ nodeId: "3", role: { value: "button" }, name: { value: "Two" }, backendDOMNodeId: 2 }),
      node({ nodeId: "4", role: { value: "button" }, name: { value: "Three" }, backendDOMNodeId: 3 }),
    ];
    const { text, dropped } = formatAxTree(nodes, { maxLines: 2 });
    expect(dropped).toBe(1);
    expect(text.split("\n")).toHaveLength(2);
  });

  it("drops lines over maxChars and says how many", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3"] }),
      node({ nodeId: "2", role: { value: "button" }, name: { value: "One" }, backendDOMNodeId: 1 }),
      node({ nodeId: "3", role: { value: "button" }, name: { value: "Two" }, backendDOMNodeId: 2 }),
    ];
    const { text, dropped } = formatAxTree(nodes, { maxChars: 20 });
    expect(dropped).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(20);
  });

  it("uses the first node when there is no parentless root", () => {
    const nodes = [
      node({ nodeId: "2", parentId: "1", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 1 }),
      node({ nodeId: "3", parentId: "1", role: { value: "button" }, name: { value: "Stop" }, backendDOMNodeId: 2 }),
    ];
    const { text } = formatAxTree(nodes);
    expect(text).toBe("- button \"Go\" [ref=e1]");
  });

  it("survives a child id that isn't in the list", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["missing"] }),
    ];
    expect(formatAxTree(nodes).text).toBe("");
  });

  it("copes with a node that has no role and no name", () => {
    const nodes = [
      { nodeId: "1", childIds: ["2"] } as unknown as AxNode,
      { nodeId: "2", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 1 } as unknown as AxNode,
    ];
    // The roleless root isn't a wrapper, so it prints as an empty role line.
    expect(formatAxTree(nodes).text).toBe(["- ", "  - button \"Go\" [ref=e1]"].join("\n"));
  });

  it("keeps an unnamed node that has children", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "list" }, name: { value: "" }, childIds: ["3"] }),
      node({ nodeId: "3", role: { value: "StaticText" }, name: { value: "Hello" } }),
    ];
    expect(formatAxTree(nodes).text).toBe(["- list", "  - text: \"Hello\""].join("\n"));
  });

  it("squeezes whitespace and trims a name to 200 characters", () => {
    const long = `${"a".repeat(250)}   tail`;
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "button" }, name: { value: `  ${long}\n` }, backendDOMNodeId: 1 }),
    ];
    expect(formatAxTree(nodes).text).toBe(`- button "${"a".repeat(200)}" [ref=e1]`);
  });
});
