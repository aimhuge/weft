"use client";

// The four-column workspace for an open card: thread | editor | pane | show, with drag dividers
// between neighbours and 18px closed slivers you can click to reopen (none for the editor while the
// thread shows: its header's ✏︎ opens it). The workspace state
// (which columns are open, how wide each is) lives in lib/use-workspace-layout.ts, which CardWorkspace
// reads; the board provides the four column elements already mounted.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { COLUMNS, type ColumnId, type Layout } from "@/lib/workspace-layout";
import Icon, { type IconName } from "./Icon";

const SLIVER_WIDTH = 18; // An 18 px sliver for a closed column, its icon centered.

const COLUMN_ICON: Record<ColumnId, IconName> = {
  thread: "sparkles", // The thread panel's main action is the conversation
  editor: "pencil",
  pane: "globe",
  show: "eye",
};

const COLUMN_LABEL: Record<ColumnId, string> = {
  thread: "Thread",
  editor: "Editor",
  pane: "Pane",
  show: "Show",
};

const COLUMN_ARIA: Record<ColumnId, string> = {
  thread: "Open thread column",
  editor: "Open editor column",
  pane: "Open browser column",
  show: "Open show column",
};

export interface CardWorkspace {
  layout: Layout;
  fill: ColumnId;
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
  toggle: (id: ColumnId) => void;
  dragDivider: (leftId: ColumnId, rightId: ColumnId, dx: number, containerWidth: number) => void;
  fitToContainer: (containerWidth: number) => void;
  // The four column contents. Each can be `null` to leave a closed-looking slot for tests
  // (production always passes a real element for the open columns).
  columns: Record<ColumnId, ReactNode>;
}

// One column rendered in the workspace. Fixed columns keep their width; the fill expands. A closed
// column becomes a slim button strip on the left of its slot.
function Column({
  id,
  layout,
  fill,
  node,
  onOpen,
}: {
  id: ColumnId;
  layout: Layout;
  fill: ColumnId;
  node: ReactNode;
  onOpen: (id: ColumnId) => void;
}) {
  if (!layout.open[id]) {
    // The thread's header has a ✏︎ for the editor, so its strip would only push the thread and the
    // pane apart; it shows only when the thread is closed too.
    if (id === "editor" && layout.open.thread) return null;
    return (
      <button
        type="button"
        onClick={() => onOpen(id)}
        aria-label={COLUMN_ARIA[id]}
        title={`${COLUMN_LABEL[id]} (closed) — click to open`}
        className="flex shrink-0 cursor-pointer items-center justify-center border-r border-line bg-sunken text-muted hover:bg-accent/10 hover:text-ink"
        style={{ width: SLIVER_WIDTH }}
      >
        <Icon name={COLUMN_ICON[id]} size={14} />
      </button>
    );
  }
  const isFill = id === fill;
  return (
    <div
      data-column={id}
      data-fill={isFill || undefined}
      className={`flex min-h-0 ${isFill ? "min-w-0 flex-1" : "shrink-0"}`}
      style={isFill ? undefined : { width: layout.width[id] }}
    >
      {node}
    </div>
  );
}

// The 6 px drag divider between two adjacent open columns. Listens on `window` so the pointer keeps
// tracking even if it leaves the divider's hit area; a single up handler ends the drag.
function Divider({
  leftId,
  rightId,
  onDrag,
  setDragging,
  containerWidth,
}: {
  leftId: ColumnId;
  rightId: ColumnId;
  onDrag: (leftId: ColumnId, rightId: ColumnId, dx: number, containerWidth: number) => void;
  setDragging: (dragging: boolean) => void;
  containerWidth: number;
}) {
  const lastX = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(true);
      lastX.current = e.clientX;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - lastX.current;
        lastX.current = ev.clientX;
        if (dx !== 0) onDrag(leftId, rightId, dx, containerWidth);
      };
      const up = () => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [leftId, rightId, onDrag, setDragging, containerWidth],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize between ${COLUMN_LABEL[leftId]} and ${COLUMN_LABEL[rightId]}`}
      onPointerDown={onPointerDown}
      className="group relative z-10 -mx-1.5 flex w-3 shrink-0 cursor-col-resize items-center justify-center"
    >
      <span className="block h-full w-[1.5px] bg-line group-hover:bg-accent/30" aria-hidden="true" />
    </div>
  );
}

export default function CardWorkspace({
  layout,
  fill,
  dragging,
  setDragging,
  toggle,
  dragDivider,
  fitToContainer,
  columns,
}: CardWorkspace) {
  const wrap = useRef<HTMLDivElement>(null);
  // The container width is read in two places: the effect that reports to fitToContainer, and the
  // render that passes it to each divider's pointer handler. Caching it in state keeps both honest
  // (you can't read `wrap.current` during render — React doesn't know to re-render) and means the
  // divider handler never sees a stale width.
  const [containerWidth, setContainerWidth] = useState(0);

  // Observe the container's actual width and refit fixed columns when it shrinks past what they
  // would naturally take. The drag handler already fits each move, so this is the passive fallback
  // for window resizes, developer-tools docking, etc. fitToWidth is a no-op when the layout
  // already fits, so calling it with a wrong/0 width is safe. The layout is a dep so opening a column
  // refits too.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const report = () => {
      const w = el.getBoundingClientRect().width;
      setContainerWidth((prev) => (prev === w ? prev : w));
      fitToContainer(w);
    };
    report();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(report);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, [fitToContainer, layout]);

  // Walk the columns in render order. Each column is either open (its content) or a sliver button
  // you can click to reopen. A divider sits between each pair of consecutive open columns, even
  // when closed slivers lie between them (thread | ✏︎ | pane): it goes right after the left column,
  // so dragging it moves that column's edge. The fill column flexes, the others keep their width.
  const rendered: ReactNode[] = [];
  let prevOpen: ColumnId | null = null;
  let dividerAt = 0;
  for (const id of COLUMNS) {
    if (layout.open[id]) {
      if (prevOpen) {
        void rendered.splice(
          dividerAt,
          0,
          <Divider
            key={`${prevOpen}-${id}`}
            leftId={prevOpen}
            rightId={id}
            onDrag={dragDivider}
            setDragging={setDragging}
            containerWidth={containerWidth}
          />,
        );
      }
      prevOpen = id;
      dividerAt = rendered.length + 1;
    }
    rendered.push(
      <Column
        key={id}
        id={id}
        layout={layout}
        fill={fill}
        node={layout.open[id] ? columns[id] : null}
        onOpen={toggle}
      />,
    );
  }

  return (
    <div ref={wrap} data-dragging={dragging || undefined} className="flex h-full min-h-0 w-full overflow-hidden">
      {rendered}
    </div>
  );
}
