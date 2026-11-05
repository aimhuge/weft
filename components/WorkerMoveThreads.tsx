"use client";

// Settings → Devices (docs/architecture/device-registry.md#moving-a-workers-threads): a worker's threads onto another
// worker of yours. MoveThreads is the picker a revoked or offline worker offers; RevokeConfirm is Revoke's confirm for
// a worker that owns threads, which offers the same move before the revoke.
import { useState } from "react";
import type { DeviceView } from "@/lib/device-registry";
import { moveTargets, threadsText } from "@/lib/device-move";

const BUTTON =
  "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
const SELECT =
  "rounded-md border border-line-strong bg-surface px-2 py-1 text-[12.5px] text-ink";

function TargetSelect({
  targets,
  value,
  onChange,
  label,
  leave,
}: {
  targets: DeviceView[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  leave?: string;
}) {
  return (
    <select
      className={SELECT}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    >
      {leave !== undefined && <option value="">{leave}</option>}
      {targets.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
          {t.status === "online" || t.status === "busy" ? "" : " · offline"}
        </option>
      ))}
    </select>
  );
}

export function MoveThreads({
  device,
  devices,
  onMove,
  onClose,
}: {
  device: DeviceView;
  devices: readonly DeviceView[];
  onMove: (to: DeviceView) => void;
  onClose: () => void;
}) {
  const targets = moveTargets(device, devices);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const target = targets.find((t) => t.id === to);
  return (
    <div className="mt-2 flex w-full flex-wrap items-center gap-2 text-[12.5px] text-ink">
      <span>
        Move {device.name}&apos;s {threadsText(device.threads)} to
      </span>
      <TargetSelect
        targets={targets}
        value={to}
        onChange={setTo}
        label={`Move ${device.name}'s threads to`}
      />
      <button
        type="button"
        className={BUTTON}
        disabled={!target}
        onClick={() => {
          if (target) onMove(target);
          onClose();
        }}
      >
        Move
      </button>
      <button type="button" className={BUTTON} onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

export function RevokeConfirm({
  device,
  devices,
  onRevoke,
  onClose,
}: {
  device: DeviceView;
  devices: readonly DeviceView[];
  onRevoke: (moveTo?: DeviceView) => void;
  onClose: () => void;
}) {
  const targets = moveTargets(device, devices);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const target = targets.find((t) => t.id === to);
  return (
    <div
      className="mt-2 flex w-full flex-wrap items-center gap-2 text-[12.5px] text-ink"
      role="group"
      aria-label={`Revoke ${device.name}?`}
    >
      <span>
        {device.name} owns {threadsText(device.threads)}.
        {targets.length
          ? " Move them to"
          : " They stay under it until you move them to another worker."}
      </span>
      {targets.length > 0 && (
        <TargetSelect
          targets={targets}
          value={to}
          onChange={setTo}
          label={`Move ${device.name}'s threads to`}
          leave="leave them here"
        />
      )}
      <button
        type="button"
        className={BUTTON}
        onClick={() => {
          onRevoke(target);
          onClose();
        }}
      >
        {target ? "Move and revoke" : "Revoke"}
      </button>
      <button type="button" className={BUTTON} onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
