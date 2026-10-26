import { describe, expect, it } from "vitest";
import { formatAxTree } from "./pane-ax.cjs";
import { node, prop } from "./pane-ax-fakes";

describe("formatAxTree", () => {
  it("prints the outline, one element per line, indented by depth", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3"] }),
      node({ nodeId: "2", role: { value: "heading" }, name: { value: "Sign in" }, properties: [prop("level", 1)], backendDOMNodeId: 14, childIds: ["4"] }),
      node({ nodeId: "3", role: { value: "button" }, name: { value: "Continue" }, backendDOMNodeId: 19 }),
      node({ nodeId: "4", role: { value: "StaticText" }, name: { value: "Sign in" } }),
    ];
    const { text, dropped } = formatAxTree(nodes);
    expect(dropped).toBe(0);
    // A heading isn't an actionable role, so it has no ref; only the level.
    expect(text).toBe(["- heading \"Sign in\" [level=1]", "- button \"Continue\" [ref=e19]"].join("\n"));
  });

  it("indents a child under its parent", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "list" }, name: { value: "Items" }, childIds: ["3"] }),
      node({ nodeId: "3", role: { value: "button" }, name: { value: "Continue" }, backendDOMNodeId: 19 }),
    ];
    expect(formatAxTree(nodes).text).toBe(["- list \"Items\"", "  - button \"Continue\" [ref=e19]"].join("\n"));
  });

  it("flattens ignored nodes, wrappers and the root, keeping their children", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3"] }),
      node({ nodeId: "2", role: { value: "generic" }, ignored: true, childIds: ["4"] }),
      node({ nodeId: "3", role: { value: "generic" }, name: { value: "" }, childIds: ["5"] }),
      node({ nodeId: "4", role: { value: "button" }, name: { value: "One" }, backendDOMNodeId: 1 }),
      node({ nodeId: "5", role: { value: "button" }, name: { value: "Two" }, backendDOMNodeId: 2 }),
    ];
    expect(formatAxTree(nodes).text).toBe(["- button \"One\" [ref=e1]", "- button \"Two\" [ref=e2]"].join("\n"));
  });

  it("keeps a wrapper that has a name of its own", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "group" }, name: { value: "Form" }, childIds: ["3"] }),
      node({ nodeId: "3", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 3 }),
    ];
    expect(formatAxTree(nodes).text).toBe(["- group \"Form\"", "  - button \"Go\" [ref=e3]"].join("\n"));
  });

  it("skips a StaticText that repeats its parent's name", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "button" }, name: { value: "Save" }, backendDOMNodeId: 4, childIds: ["3"] }),
      node({ nodeId: "3", role: { value: "StaticText" }, name: { value: "Save" } }),
    ];
    expect(formatAxTree(nodes).text).toBe("- button \"Save\" [ref=e4]");
  });

  it("skips a StaticText inside a field, where the text is the value", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({
        nodeId: "2",
        role: { value: "textbox" },
        name: { value: "Email" },
        value: { value: "me@x.com" },
        backendDOMNodeId: 8,
        childIds: ["3"],
      }),
      node({ nodeId: "3", role: { value: "StaticText" }, name: { value: "me@x.com" } }),
    ];
    expect(formatAxTree(nodes).text).toBe('- textbox "Email" [ref=e8]: "me@x.com"');
  });

  it("prints a StaticText that isn't a repeat", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "paragraph" }, name: { value: "A paragraph" }, childIds: ["3"] }),
      node({ nodeId: "3", role: { value: "StaticText" }, name: { value: "Hello there" } }),
    ];
    expect(formatAxTree(nodes).text).toBe(["- paragraph \"A paragraph\"", "  - text: \"Hello there\""].join("\n"));
  });

  it("flattens an unnamed paragraph, so its text moves up a level", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "paragraph" }, name: { value: "" }, childIds: ["3"] }),
      node({ nodeId: "3", role: { value: "StaticText" }, name: { value: "Hello there" } }),
    ];
    expect(formatAxTree(nodes).text).toBe('- text: "Hello there"');
  });

  it("skips InlineTextBox, LineBreak and ListMarker", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3", "4", "5"] }),
      node({ nodeId: "2", role: { value: "InlineTextBox" }, name: { value: "x" }, backendDOMNodeId: 1 }),
      node({ nodeId: "3", role: { value: "LineBreak" }, name: { value: "x" }, backendDOMNodeId: 2 }),
      node({ nodeId: "4", role: { value: "ListMarker" }, name: { value: "x" }, backendDOMNodeId: 3 }),
      node({ nodeId: "5", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 4 }),
    ];
    expect(formatAxTree(nodes).text).toBe("- button \"Go\" [ref=e4]");
  });
});
