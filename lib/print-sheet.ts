// Printing the shortcut sheet (lib/shortcut-sheet.ts). The desktop app prints it from Electron main (electron/print.cjs)
// and can say which printers macOS has; a browser tab can't see printers, so it prints from a hidden iframe and the
// welcome never offers it there.

// The names of the printers this Mac has. Empty on the web, in an older shell, or when main can't tell.
export async function printerNames(): Promise<string[]> {
  try {
    return (await window.weft?.print?.printers()) ?? [];
  } catch {
    return [];
  }
}

// Opens the system print dialog on the sheet. Resolves once the dialog is up (web) or done (desktop).
export async function printHtml(html: string): Promise<void> {
  const print = window.weft?.print;
  if (print) {
    await print.html(html);
    return;
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = html;
  frame.onload = () => {
    const win = frame.contentWindow;
    win?.addEventListener("afterprint", () => frame.remove());
    win?.print();
  };
  document.body.appendChild(frame);
}
