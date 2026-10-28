# 045 — the dictation key ignored the extra modifiers

**Date:** 2026-10-28 · **Severity:** Medium (the feature was reachable another way — the mic button — so nothing was lost, but the key did nothing at all)

## Symptom

The user pressed **⌘⌥'** (Command + Option + apostrophe) to start dictation and nothing happened. No
recording, no error, no reaction of any kind.

The binding on screen read **⌥'** (Option + apostrophe), and that combination *did* work, which made
it look like the user was pressing the wrong thing. They were not: ⌘⌥' is what people reach for when
the bare combination is taken by another app, and the binding should have answered to it.

## Root cause

`lib/shortcuts.ts` `matches()` compared every modifier with `===`, so a binding had to be matched by
an *exact* combination:

```ts
return e.code === b.code && e.altKey === b.alt && e.ctrlKey === b.ctrl
  && e.metaKey === b.meta && e.shiftKey === b.shift;
```

The default binding is `{ code: "Quote", alt: true, ctrl: false, meta: false, shift: false }`. A
press of ⌘⌥' arrives as `metaKey: true`, and the binding says `meta: false` — so `true === false` is
false, and the key did not match. Every press of a *different* modifier combination was silently
ignored, with no way for the user to tell that the key was taken and merely mis-bound.

**Why it was written that way.** Strict equality is the obvious way to say "these modifiers", and
the one shortcut that used it was the dictation binding, whose default (`⌥'`) was thought to be
unambiguous. It is not: on macOS, Option+`'` is the `æ` dead key, and users rebind the shortcut to
whatever their apps leave free.

## Fix

`matches()` now treats a binding as a **set of modifiers** rather than an exact combination: every
modifier the binding names has to be held, and the ones it leaves out are free.

```ts
if (e.code !== b.code) return false;
if (e.shiftKey !== b.shift) return false;
if (b.alt  && !e.altKey)  return false;
if (b.ctrl && !e.ctrlKey) return false;
if (b.meta && !e.metaKey) return false;
return true;
```

**Shift is the exception, and deliberately.** Shift changes *which character* the key produces
(`'` becomes `"`), so it is part of the key's identity rather than an extra modifier; a binding of
`⌥'` must not fire on `⌥⇧'`. Command and Control do not change the character, so an extra one of
those is harmless and is exactly the escape hatch people need.

**Why this fix rather than changing the default binding.** Making the default `⌘⌥'` would have fixed
this one user and left every other rebinding just as broken: the same strict comparison governs
whichever binding is stored. Fixing the comparison fixes the whole class, including the bindings
users set themselves in Settings → Shortcuts.

## Key rule

**A shortcut binding is a set of modifiers, not a combination.** Every modifier it names must be
held; the ones it leaves out are free. Shift is part of the key's identity (it changes the
character) and so must match exactly.

## Files

`lib/shortcuts.ts`, `lib/shortcuts.test.ts`, `lib/dictation-shortcut.test.ts`.
