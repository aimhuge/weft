"use client";

// A QR code for Pair a phone (components/PairDevices.tsx) and the phone app's TestFlight prompt (components/PhonePrompt.tsx).
import qrcode from "qrcode-generator";
import { useMemo } from "react";

// The link as an SVG path of dark modules, drawn on white so a phone camera reads it in the dark theme too.
export function QrCode({ text, size = 168, label = "Pairing QR code" }: { text: string; size?: number; label?: string }) {
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
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges" className="rounded-md">
      <rect width={count} height={count} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
