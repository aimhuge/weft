"use client";

// Settings → Sync's Pair a phone card (docs/architecture/mobile-security.md): a QR code the Weft phone app scans, the
// same link to open on another computer (a browser can read sealed threads but never approve), the paired devices with
// Revoke, and the two switches. These are not the push phones above them (components/PhoneSettings.tsx): signing in
// gets a phone its pushes, pairing gets it the workspace key and lets it approve with Face ID.
import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { usePairing } from "@/lib/use-pairing";
import { useNow } from "@/lib/use-now";
import { Spinner } from "./Icon";
import SwitchRow from "./SwitchRow";

const CARD = "rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl";
const SECTION_TITLE = "mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint";
const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

// The link as an SVG path of dark modules, drawn on white so a phone camera reads it in the dark theme too.
export function QrCode({ text, size = 168 }: { text: string; size?: number }) {
  const { count, d } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { count: n + 4, d: path };
  }, [text]);
  return (
    <svg role="img" aria-label="Pairing QR code" width={size} height={size} viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges" className="rounded-md">
      <rect width={count} height={count} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

const kindLabel = (d: { kind: string; platform: string }) =>
  d.kind === "browser" ? "Browser · reads sealed threads" : `${d.platform === "android" ? "Android" : "iPhone"} · approves with Face ID`;

export default function PairDevices() {
  const p = usePairing();
  const now = useNow();
  if (!p.available) return null;
  const code = p.code;
  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;
  return (
    <section data-settings-card className={CARD} onMouseDown={(e) => e.stopPropagation()}>
      <h4 className={SECTION_TITLE}>Pair a phone</h4>
      {code ? (
        <div className="flex gap-4">
          <QrCode text={code.link} />
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-[13px] text-ink">Scan this with the Weft app on your phone.</p>
            <p className={SUBTLE}>
              Your Mac checks the phone&apos;s claim and asks for Touch ID before it trusts it. The code works once, for {Math.floor(left / 60)}:
              {String(left % 60).padStart(2, "0")} more.
            </p>
            <p className={`flex items-center gap-2 ${SUBTLE}`}>
              <Spinner size={11} /> Waiting for the phone
            </p>
            <div className="mt-1 flex gap-2">
              <button type="button" className={BUTTON} onClick={() => void navigator.clipboard.writeText(code.link)}>
                Copy link for a browser
              </button>
              <button type="button" className={BUTTON} onClick={() => void p.cancel()}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className={SUBTLE}>A paired phone answers permissions with Face ID and reads sealed threads. Nothing else can approve once one is paired.</p>
          <button type="button" className={`shrink-0 ${BUTTON}`} onClick={() => void p.start()}>
            Pair a phone
          </button>
        </div>
      )}
      {p.note && <p className="mt-3 text-[12.5px] text-ink">{p.note}</p>}
      {p.error && <p className="mt-3 text-[12.5px] text-danger">{p.error}</p>}
      {p.devices.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          {p.devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] text-ink">{d.name}</div>
                <div className={SUBTLE}>
                  {kindLabel(d)} · <span className="font-mono">{d.fingerprint.slice(0, 8)}</span>
                </div>
              </div>
              <button type="button" className={BUTTON} onClick={() => void p.revoke(d.id)} aria-label={`Revoke ${d.name}`}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
        <SwitchRow
          title="Seal synced threads"
          hint="Thread text, card titles and long tool output go up encrypted with your workspace key. Only this Mac and paired devices can read them; shared cards stay plain."
          on={p.settings.seal}
          onChange={(seal) => void p.setSetting({ seal })}
        />
        <SwitchRow
          title="Approve from the web without a phone"
          hint="Lets an Allow sent from weft.zip run here with no Face ID. Off is safer: a stolen sign-in can't run tools on this Mac."
          on={p.settings.webApprovals}
          onChange={(webApprovals) => void p.setSetting({ webApprovals })}
        />
      </div>
    </section>
  );
}
