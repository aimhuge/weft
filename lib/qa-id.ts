// The name a Local Simulator device goes by: what stays stable, a simulator's udid or an emulator's name (its adb serial changes
// with each boot). Alone, so the board can import it without the server's simulator code.
export const stableId = (d: { platform: "ios" | "android"; id: string; name: string }) => (d.platform === "ios" ? d.id : d.name);
