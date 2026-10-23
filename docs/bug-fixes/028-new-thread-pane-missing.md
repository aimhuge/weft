# 028 — New thread window lost its browser pane

Date: 2026-10-23  
Severity: Low

## Symptom

Opening New thread showed the form without the browser pane that holds its splash page.

## Root cause

`useNewThreadPane` continued opening the New thread splash URL, but the `showNew` branch in `Board.tsx` rendered only `NewCardDialog`. No `BrowserPane` was mounted to size and display the native browser view.

## Fix

Before:

```tsx
{showNew ? (
  <NewCardDialog ... />
) : selected && threadProps ? (
  <OpenCard ... />
) : null}
```

After:

```tsx
{showNew ? <NewThreadWindow form={...} browser={...} onClose={...} /> : selected && threadProps ? (
  <OpenCard ... />
) : null}
```

`NewThreadWindow` keeps the form and browser pane in separate guarded components. The pane uses the board's existing browser state, width, and overlay behavior, and is mounted only in the desktop app where the native browser view exists. Its component test covers desktop and web rendering.

## Key rule

When the New thread splash URL is opened, mount a `BrowserPane` beside the New thread form so the native view receives bounds.

## Files

- `components/Board.tsx`
- `components/NewThreadWindow.tsx`
- `components/NewThreadWindow.test.tsx`
- `lib/use-new-thread-pane.ts` (existing splash-page behavior)
