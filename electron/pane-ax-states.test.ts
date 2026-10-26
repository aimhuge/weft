import { describe, expect, it } from "vitest";
import { formatAxTree } from "./pane-ax.cjs";
import { node, prop } from "./pane-ax-fakes";

describe("formatAxTree", () => {
  it("gives a ref to actionable roles and to focusable nodes", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3", "4"] }),
      node({ nodeId: "2", role: { value: "link" }, name: { value: "Docs" }, backendDOMNodeId: 10 }),
      node({ nodeId: "3", role: { value: "div" }, name: { value: "Card" }, properties: [prop("focusable", true)], backendDOMNodeId: 11 }),
      node({ nodeId: "4", role: { value: "div" }, name: { value: "Plain" }, backendDOMNodeId: 12 }),
    ];
    expect(formatAxTree(nodes).text).toBe(
      ["- link \"Docs\" [ref=e10]", "- div \"Card\" [ref=e11]", "- div \"Plain\""].join("\n"),
    );
  });

  it("has no ref on an actionable node with no backend id", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({ nodeId: "2", role: { value: "button" }, name: { value: "Go" } }),
    ];
    expect(formatAxTree(nodes).text).toBe("- button \"Go\"");
  });

  it("puts the heading level in the tag", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3"] }),
      node({ nodeId: "2", role: { value: "heading" }, name: { value: "One" }, properties: [prop("level", 2)], backendDOMNodeId: 1 }),
      node({ nodeId: "3", role: { value: "heading" }, name: { value: "Two" }, backendDOMNodeId: 2 }),
    ];
    expect(formatAxTree(nodes).text).toBe(["- heading \"One\" [level=2]", "- heading \"Two\""].join("\n"));
  });

  it("shows the states that are on", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3", "4", "5"] }),
      node({
        nodeId: "2",
        role: { value: "checkbox" },
        name: { value: "Mixed" },
        properties: [prop("checked", "mixed")],
        backendDOMNodeId: 1,
      }),
      node({
        nodeId: "3",
        role: { value: "textbox" },
        name: { value: "Bad" },
        properties: [prop("invalid", "spelling")],
        backendDOMNodeId: 2,
      }),
      node({
        nodeId: "4",
        role: { value: "option" },
        name: { value: "Picked" },
        properties: [prop("selected", false)],
        backendDOMNodeId: 3,
      }),
      node({
        nodeId: "5",
        role: { value: "button" },
        name: { value: "Off" },
        properties: [prop("checked", false), prop("disabled", false)],
        backendDOMNodeId: 4,
      }),
    ];
    expect(formatAxTree(nodes).text).toBe(
      [
        "- checkbox \"Mixed\" [ref=e1] (checked)",
        "- textbox \"Bad\" [ref=e2] (invalid)",
        "- option \"Picked\" [ref=e3]",
        "- button \"Off\" [ref=e4]",
      ].join("\n"),
    );
  });

  it("shows a value on a textbox and a combobox, and not on other roles", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2", "3", "4"] }),
      node({
        nodeId: "2",
        role: { value: "textbox" },
        name: { value: "Email" },
        value: { value: "me@x.com" },
        backendDOMNodeId: 1,
      }),
      node({
        nodeId: "3",
        role: { value: "combobox" },
        name: { value: "Fruit" },
        value: { value: "Apple" },
        backendDOMNodeId: 2,
      }),
      node({
        nodeId: "4",
        role: { value: "button" },
        name: { value: "Go" },
        value: { value: "ignored" },
        backendDOMNodeId: 3,
      }),
    ];
    expect(formatAxTree(nodes).text).toBe(
      ['- textbox "Email" [ref=e1]: "me@x.com"', '- combobox "Fruit" [ref=e2]: "Apple"', '- button "Go" [ref=e3]'].join("\n"),
    );
  });

  it("leaves out an empty value", () => {
    const nodes = [
      node({ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: ["2"] }),
      node({
        nodeId: "2",
        role: { value: "textbox" },
        name: { value: "Email" },
        value: { value: "" },
        backendDOMNodeId: 1,
      }),
    ];
    expect(formatAxTree(nodes).text).toBe('- textbox "Email" [ref=e1]');
  });
});
