// mcp__browser__snapshot: Chrome's accessibility tree (Accessibility.getFullAXTree) as a compact outline, one
// element per line, with a ref on everything an agent can act on. A ref is "e" + the node's backendDOMNodeId,
// which stays the same while the element is in the page, so click/type/hover take it straight back to the
// element (DOM.resolveNode) with no selector guessing. Password fields come out of Chrome already masked.
//
//   - heading "Sign in" [level=1]
//   - textbox "Email" [ref=e14]: "me@x.com"
//   - button "Continue" [ref=e19] (disabled)

const MAX_LINES = 800;
const MAX_CHARS = 30_000;

// Roles that only wrap other things: with no name of their own, their children move up a level.
const WRAPPERS = new Set(["generic", "none", "presentation", "paragraph", "group", "Section", "LayoutTable", "LayoutTableRow", "LayoutTableCell", "div", "MenuListPopup", "LabelText", "Ruby", "time", "abbr", "mark", "emphasis", "strong", "subscript", "superscript", "code", "deletion", "insertion"]);
const SKIP = new Set(["InlineTextBox", "LineBreak", "ListMarker"]);
// What an agent can act on gets a ref, focusable or not (a div with a click handler often isn't).
const ACTIONABLE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider", "spinbutton", "listbox", "treeitem", "textField", "TextField", "DisclosureTriangle", "image", "img", "video", "audio"]);
const WITH_VALUE = new Set(["textbox", "searchbox", "combobox", "slider", "spinbutton", "TextField", "textField"]);
// States worth a word, shown only when true (every option of a select carries "selected", mostly false).
const STATES = ["checked", "pressed", "selected", "expanded", "disabled", "focused", "required", "invalid"];

const quote = (s) => JSON.stringify(String(s).replace(/\s+/g, " ").trim().slice(0, 200));
const prop = (node, name) => node.properties?.find((p) => p.name === name)?.value?.value;

function refOf(node) {
  return node.backendDOMNodeId ? `e${node.backendDOMNodeId}` : undefined;
}

// "e123" → 123, or undefined for anything else.
function parseRef(ref) {
  const m = /^e(\d+)$/.exec(String(ref ?? "").trim());
  return m ? Number(m[1]) : undefined;
}

function states(node) {
  const on = STATES.filter((s) => {
    const v = prop(node, s);
    // "invalid" is "false" (a string) on most fields; checked can be "mixed".
    return v === true || v === "true" || v === "mixed" || (s === "invalid" && v && v !== "false");
  });
  return on.length ? ` (${on.join(", ")})` : "";
}

function line(node, role, name, actionable) {
  const parts = [`- ${role}`];
  if (name) parts.push(quote(name));
  const ref = actionable ? refOf(node) : undefined;
  const tags = [];
  if (ref) tags.push(`ref=${ref}`);
  const level = prop(node, "level");
  if (role === "heading" && level) tags.push(`level=${level}`);
  if (tags.length) parts.push(`[${tags.join(" ")}]`);
  let out = parts.join(" ") + states(node);
  const value = node.value?.value;
  if (WITH_VALUE.has(role) && value !== undefined && value !== "") out += `: ${quote(value)}`;
  return out;
}

// Ignored nodes, the page root and unnamed wrappers aren't printed; their children move up a level.
function passesThrough(node, role, name) {
  return node.ignored || role === "RootWebArea" || (WRAPPERS.has(role) && !name);
}

const isActionable = (node, role) => ACTIONABLE.has(role) || prop(node, "focusable") === true;

// nodes is getFullAXTree's flat list (parents point at children by childIds). Returns the outline and how many
// lines didn't fit.
function formatAxTree(nodes, { maxLines = MAX_LINES, maxChars = MAX_CHARS } = {}) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) ?? nodes[0];
  const out = [];
  let chars = 0;
  let dropped = 0;

  function emit(text, depth) {
    if (out.length >= maxLines || chars + text.length > maxChars) return void dropped++;
    const indented = "  ".repeat(depth) + text;
    out.push(indented);
    chars += indented.length + 1;
  }

  const childrenOf = (node) => (node.childIds ?? []).map((id) => byId.get(id));

  function emitText(name, depth, parentName, parentRole) {
    if (name && name !== parentName && !WITH_VALUE.has(parentRole)) emit(`- text: ${quote(name)}`, depth);
  }

  // parentName: the nearest printed ancestor's name, so a button's own label isn't printed again as text; in a
  // field (parentRole), the text is its value, already on the field's line.
  function walk(node, depth, parentName, parentRole) {
    const role = node?.role?.value ?? "";
    if (!node || SKIP.has(role)) return;
    const name = String(node.name?.value ?? "").trim();
    const kids = childrenOf(node);
    if (passesThrough(node, role, name)) return kids.forEach((k) => walk(k, depth, parentName, parentRole));
    if (role === "StaticText") return emitText(name, depth, parentName, parentRole);
    const actionable = isActionable(node, role);
    if (!name && !actionable && !kids.length) return;
    emit(line(node, role, name, actionable), depth);
    for (const k of kids) walk(k, depth + 1, name || parentName, role);
  }

  walk(root, 0, "", "");
  return { text: out.join("\n"), dropped };
}

module.exports = { formatAxTree, parseRef, refOf, MAX_LINES };
