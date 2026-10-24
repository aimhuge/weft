# 034: a thread could approve its own permission prompts through the board-view tools

**Date:** 2026-10-20 · **Severity:** Medium (an agent could grant itself the permissions, folders and settings it was supposed to wait for the user to grant)

## Symptom

`mcp__board_view__click` let a thread click any element in the board window, by CSS selector. The board window
holds the things that decide what a thread is allowed to do: the permission prompt (Allow / Deny), the folder grant
("This card" / "Always"), the mode picker (`default` / `acceptEdits` / `auto` / `bypassPermissions`), and the
Settings dialog. A thread could answer its own prompt, widen its own folder access, or loosen its own mode without
the user ever seeing a dialog.

The user watching the board had no way to tell. The click arrived from a thread's tool call, and the panel it hit
looked the same as one the user had clicked. Found in the 2026-10-20 pentest as P-1.

## Cause

The board-view control server (`electron/board-view.cjs`) ran a fixed page script per operation. Its click script
gated one thing — `data-secret-action`, the controls that reveal or copy a secret value — and then clicked
everything else:

```js
// before
click: (sel) =>
  `(() => { ${find(sel)} if (el.closest(${q(SECRET_ACTION)})) return { found: true, refused: true }; el.scrollIntoView({ block: "nearest" }); el.click(); return { found: true }; })()`,
```

Nothing marked a control as the user's alone. The board-view's allowlist was a list of operations, not a list of
things a thread may not do, so a control that granted power was reachable by default.

## Fix

Two layers, because either alone is bypassable.

**The marker.** Every control that grants power carries `data-human-only`, and the board-view refuses to click or
type into one. The refusal says only the user can do it.

```js
// after — electron/board-view.cjs
const HUMAN_ONLY = "[data-human-only]";

click: (sel) =>
  `(() => { ${find(sel)} if (el.closest(${q(SECRET_ACTION)})) return { found: true, refused: true }; if (el.closest(${q(HUMAN_ONLY)})) return { found: true, humanOnly: true }; el.scrollIntoView({ block: "nearest" });` +
  ` const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;` +
  ` const top = document.elementFromPoint(x, y);` +
  ` if (!top || !(top === el || el.contains(top))) return { found: true, covered: true };` +
  ` return { found: true, x, y }; })()`,
```

```js
// after — electron/board-view.cjs
function humanOnly(selector) {
  return new Error(`${selector} answers a permission, grants access or changes settings; only you can do that, so ask the user.`);
}
```

The markers sit on the permission panel (`components/ThreadFooter.tsx`), the reply box while a question waits
(`components/ReplyBox.tsx`), the question form (`components/QuestionForm.tsx`), the mode picker
(`components/ModePicker.tsx`) and the Settings panel (`components/SettingsDialog.tsx`):

```tsx
// after — components/ThreadFooter.tsx
<div data-human-only className="flex shrink-0 flex-col border-t border-warn/40 bg-warn-soft px-4 py-3">
```

Screenshots and reads still work over a marked element — a thread may look at the prompt, it may not answer it.

**The trusted event.** The marker alone is not enough: a handler could gate on `event.isTrusted`, and
`Element.click()` called from `executeJavaScript` produces an untrusted event, so that check would still let the
click through. The fix removes the untrusted path and delivers real mouse events instead. Electron's
`webContents.sendInputEvent` produces a trusted event, so the user's own actions and the thread's cannot be told
apart by `isTrusted` — only by the marker.

```js
// after — electron/board-view.cjs
// Real, trusted mouse events. element.click() inside executeJavaScript would be untrusted and any
// allow handler that gates on `e.isTrusted` would still let it through (pentest 2026-10-20, P-1).
const zoom = wc.getZoomFactor();
const x = Math.round(r.x * zoom);
const y = Math.round(r.y * zoom);
wc.sendInputEvent({ type: "mouseMove", x, y });
wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
```

The preflight also hit-tests the element's centre with `elementFromPoint` and refuses when something else is on
top. A thread could otherwise name a harmless element sitting beneath an Allow button; the preflight saw no
`data-human-only` marker on the element it had selected, and the trusted click landed on the button underneath.

**Key rule:** an action that grants power to the very agent asking for it must be structurally unreachable from the
agent's own tool — mark it so the tool refuses it, and deliver the user's own actions as trusted events so a
second check can't be fooled.

The rest of the board-view is unchanged: `read` and `screenshot` still see everything a thread needs to follow
along, `hover` still sends a real mouse move, and `data-secret` / `data-secret-action` keep their existing
behaviour.

**Files:** `electron/board-view.cjs` (the `data-human-only` gate, the hit-test preflight, the trusted mouse
events), `components/ReplyBox.tsx`, `components/QuestionForm.tsx`, `components/ThreadFooter.tsx`,
`components/ModePicker.tsx`, `components/SettingsDialog.tsx` (the markers), `electron/board-view.test.ts`
(the refusals and the trusted-event path), `docs/architecture/board-view.md`.
