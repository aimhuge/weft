// Finding one element by selector, the way an agent means it. The tools take a CSS selector, but agents
// (and Playwright-trained habits) also write Playwright's text pseudo-classes: `:text-is("Settings…")`,
// `:text("Save")`, `:has-text("menu")`, and Playwright nests them inside `:has()`:
// `button[role="menuitem"]:has(span:text-is("Settings…"))`. The browser's querySelector throws on those
// ("not a valid selector"), so a click on a menu item died with a SyntaxError the agent couldn't act on.
//
// This module compiles a selector into a page function that finds the element itself: the CSS goes to
// querySelectorAll as it was written, and the text parts are matched by reading textContent, so the
// nesting between them (a text condition on a descendant, inside :has()) is kept.
//
// Only the pseudo-classes agents actually write are supported; anything else is left to CSS, so an
// invalid selector still fails the way it always did (docs/architecture/agent-browser.md).

const q = (value) => JSON.stringify(value);

// The text pseudo-classes we understand, and what each asks for.
const TEXT_PSEUDOS = {
  "text-is": { exact: true },
  text: { exact: true },
  "has-text": { contains: true },
  "text-matches": { matches: true },
};

/**
 * A selector, split into the CSS part and the text conditions.
 *
 * `css` is the selector with the text pseudo-classes taken out, so CSS can parse what's left.
 * `conditions` are the text tests, each with the CSS part it applies to: a test at the top level
 * applies to the element itself; a test inside `:has()` applies to a descendant, and the element must
 * have one that matches.
 *
 *   '[role="menu"] button[role="menuitem"]:has(span:text-is("Settings…"))'
 *     → css: '[role="menu"] button[role="menuitem"]:has(span)'
 *       conditions: [{ scope: 'descendant', css: 'span', exact: true, value: 'Settings…' }]
 */
function parseSelector(selector) {
  const sel = String(selector);
  const conditions = [];
  let css = "";
  let i = 0;
  // The open groups: each holds the CSS written since it opened, its conditions, and the source of
  // the pseudo-class that opened it.
  const groups = [];
  while (i < sel.length) {
    const ch = sel[i];
    if (ch === "(") {
      groups.push({ name: "", source: "", css: "", conditions: [], open: "(" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      const group = groups.pop();
      if (!group) {
        css += ch;
        i += 1;
        continue;
      }
      css += closeGroup(group, conditions);
      i += 1;
      continue;
    }
    if (ch === ":") {
      const pseudo = readPseudo(sel, i);
      if (pseudo) {
        // A text pseudo-class: it's a condition, not CSS.
        const condition = { ...pseudo.test };
        const group = groups[groups.length - 1];
        if (group) group.conditions.push(condition);
        else conditions.push({ ...condition, scope: "self" });
        i = pseudo.next;
        continue;
      }
      // Another pseudo-class: it opens a group we want to know the name of.
      const named = readNamedPseudo(sel, i);
      if (named) {
        groups.push({ name: named.name, source: `:${named.name}`, css: "", conditions: [], open: "(" });
        i = named.next;
        continue;
      }
    }
    const group = groups[groups.length - 1];
    if (group) group.css += ch;
    else css += ch;
    i += 1;
  }
  // Any group left open (an unbalanced selector) goes back to CSS as it was written.
  while (groups.length) {
    const group = groups.pop();
    css += `${group.source}${group.open}${group.css}`;
    conditions.push(...group.conditions);
  }
  return { css: css.trim(), conditions };
}

// A group that closes: the CSS it gives back, and the conditions it adds.
// A :has(...) whose text conditions we took out gives back nothing but the descendant test — the
// wrapper is already in the CSS, and the test says what it means. Any other group is CSS as it was.
function closeGroup(group, conditions) {
  const inner = group.css;
  if (group.name === "has" && group.conditions.length) {
    for (const c of group.conditions) conditions.push({ ...c, scope: "descendant", css: inner.trim() || c.css });
    return "";
  }
  for (const c of group.conditions) conditions.push({ ...c, scope: group.name === "has" ? "descendant" : c.scope });
  return `${group.source}${group.open}${inner})`;
}

// The pseudo-class at `at`, if it's one of ours; where it ends and what it asks for.
function readPseudo(sel, at) {
  const m = /^:([a-z][a-z0-9-]*)\(/i.exec(sel.slice(at));
  if (!m) return null;
  const name = m[1].toLowerCase();
  const kind = TEXT_PSEUDOS[name];
  if (!kind) return null;
  const arg = readArgument(sel, at + m[0].length);
  if (!arg) return null;
  return { test: { ...kind, value: unquote(arg.value) }, next: arg.next };
}

// The parenthesised argument of a pseudo-class, quotes and nesting aware: where it ends and what's in it.
function readArgument(sel, from) {
  let depth = 1;
  let i = from;
  let value = "";
  let quote = "";
  while (i < sel.length) {
    const ch = sel[i];
    if (quote) {
      if (ch === "\\") {
        value += ch + (sel[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (ch === quote) quote = "";
      value += ch;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      value += ch;
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { value, next: i + 1 };
    }
    value += ch;
    i += 1;
  }
  return null;
}

// A pseudo-class we don't handle as text: its name, and where it ends.
function readNamedPseudo(sel, at) {
  const m = /^:([a-z][a-z0-9-]*)\(/i.exec(sel.slice(at));
  if (!m) return null;
  return { name: m[1].toLowerCase(), next: at + m[0].length };
}

// `"Settings…"` → Settings…, with backslash escapes undone.
function unquote(arg) {
  const s = arg.trim();
  if (!/^["'].*["']$/.test(s)) return s;
  const body = s.slice(1, -1);
  return body.replace(/\\(.)/g, "$1");
}

// Does an element's text pass a test? The text is what a person reads on it: its own text plus its
// descendants', with whitespace collapsed.
function textOf(el) {
  return String(el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function passes(text, test) {
  if (test.exact) return text === test.value;
  if (test.contains) return text.includes(test.value);
  if (test.matches) {
    try {
      return new RegExp(test.value).test(text);
    } catch {
      return false;
    }
  }
  return false;
}

// The page-side helpers, shared by both expressions, so the two stay in step.
const HELPERS = `const textOf = (el) => String(el.textContent ?? "").replace(/\\s+/g, " ").trim();
const passes = (text, t) => {
  if (t.exact) return text === t.value;
  if (t.contains) return text.includes(t.value);
  if (t.matches) { try { return new RegExp(t.value).test(text); } catch { return false; } }
  return false;
};`;

// The page-side loop: the first candidate that matches every condition, or null.
// The CSS goes straight into querySelectorAll, JSON-encoded once, so a selector is data and never code.
const match = (css) => `const candidates = [...document.querySelectorAll(${q(css || "*")})];
for (const el of candidates) {
  let ok = true;
  for (const c of conditions) {
    if (c.scope === "descendant") {
      const hit = [...el.querySelectorAll(c.css || "*")].some((d) => passes(textOf(d), c));
      if (!hit) { ok = false; break; }
    } else if (!passes(textOf(el), c)) {
      ok = false; break;
    }
  }
  if (ok) return el;
}
return null;`;

/**
 * The page function that finds the element a selector names.
 *
 * Returns the expression to evaluate in the page. It's a plain function string, so it runs in the
 * page's own context. It returns the element itself (a remote object to CDP) or null when nothing
 * matches; an invalid CSS part throws, as querySelector does.
 */
function findExpression(selector) {
  const { css, conditions } = parseSelector(selector);
  return `(() => {
    const conditions = ${q(conditions)};
    ${HELPERS}
    ${match(css)}
  })()`;
}

/**
 * The expression that says whether a selector matches something visible. Used by wait_for, which
 * polls the page until the thing shows up.
 */
function visibleExpression(selector) {
  const { css, conditions } = parseSelector(selector);
  return `(() => {
    const conditions = ${q(conditions)};
    ${HELPERS}
    const candidates = [...document.querySelectorAll(${q(css || "*")})];
    for (const el of candidates) {
      let ok = true;
      for (const c of conditions) {
        if (c.scope === "descendant") {
          const hit = [...el.querySelectorAll(c.css || "*")].some((d) => passes(textOf(d), c));
          if (!hit) { ok = false; break; }
        } else if (!passes(textOf(el), c)) {
          ok = false; break;
        }
      }
      if (!ok) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) return true;
    }
    return false;
  })()`;
}

/** True when the selector is one of ours and needs the custom finder. */
function isTextual(selector) {
  return parseSelector(selector).conditions.length > 0;
}

/**
 * The page script that boxes the element a selector names, for a screenshot that says "click here".
 * It scrolls the element into view, draws an orange rectangle around it, and answers whether it found one.
 */
function highlightExpression(selector) {
  return `(() => {
    const el = (${findExpression(selector)});
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.id = "__weft_highlight";
    box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #e8542f;border-radius:8px;box-shadow:0 0 0 4px rgb(232 84 47/.25);" +
      "left:" + (r.left - 6) + "px;top:" + (r.top - 6) + "px;width:" + (r.width + 6) + "px;height:" + (r.height + 6) + "px";
    document.documentElement.appendChild(box);
    return true;
  })()`;
}

/** What to say when a selector isn't valid, so the agent can fix it rather than repeat it. */
function invalidMessage(selector) {
  return `${selector} isn't a valid CSS selector. Use a plain CSS selector (for example button[role="menuitem"]), or take a snapshot and use the element's ref.`;
}

module.exports = {
  parseSelector,
  findExpression,
  visibleExpression,
  highlightExpression,
  isTextual,
  invalidMessage,
  textOf,
  passes,
};
