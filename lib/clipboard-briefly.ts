// Copies text that shouldn't stay on the clipboard, a passkey pairing link (docs/architecture/mobile-security.md,
// "Pairing a passkey"), and clears it after a minute if it's still there. Anything that reads the clipboard meanwhile
// (a thread's pbpaste, a page's script) could still race the claim; the code on the page and in Touch ID catches that.
export const CLEAR_AFTER_MS = 60_000;

export async function copyBriefly(text: string, clipboard: Pick<Clipboard, "writeText" | "readText"> = navigator.clipboard, wait: (ms: number, fn: () => void) => void = (ms, fn) => void setTimeout(fn, ms)) {
  await clipboard.writeText(text);
  wait(CLEAR_AFTER_MS, () => {
    void clipboard
      .readText()
      .then((now) => (now === text ? clipboard.writeText("") : undefined))
      .catch(() => {});
  });
}
