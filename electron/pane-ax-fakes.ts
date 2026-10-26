// The shapes Chrome's accessibility tree arrives in, and the small builders the pane-ax tests use.
// Shared by the pane-ax test files (pane-ax-refs, pane-ax-tree, pane-ax-states, pane-ax-limits).

// A node as Chrome's Accessibility.getFullAXTree hands it over: everything optional, everything wrapped
// in { value }.
export type AxNode = {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: unknown };
  properties?: { name: string; value?: { value?: unknown } }[];
  ignored?: boolean;
  backendDOMNodeId?: number;
};

// A node with the defaults the tests lean on: a role, a name, and whatever the test adds.
export function node(partial: Partial<AxNode> & { nodeId: string }): AxNode {
  return {
    role: { value: partial.role?.value ?? "generic" },
    name: { value: partial.name?.value ?? "" },
    ...partial,
  };
}

// A node property, wrapped the way the tree wraps them.
export function prop(name: string, value: unknown) {
  return { name, value: { value } };
}
