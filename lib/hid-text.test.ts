import { describe, expect, it } from "vitest";
import { charOf, hidPresses } from "./hid-text";
import { hidUsage } from "./hid-keys";

describe("charOf", () => {
  it("reads letters, digits and punctuation, with Shift", () => {
    expect(charOf(hidUsage("KeyA") as number, false)).toBe("a");
    expect(charOf(hidUsage("KeyZ") as number, true)).toBe("Z");
    expect(charOf(hidUsage("Digit1") as number, false)).toBe("1");
    expect(charOf(hidUsage("Digit0") as number, true)).toBe(")");
    expect(charOf(hidUsage("Slash") as number, true)).toBe("?");
    expect(charOf(hidUsage("Enter") as number, false)).toBe("\n");
    expect(charOf(hidUsage("ArrowUp") as number, false)).toBeNull();
  });
});

describe("hidPresses", () => {
  it("types every printable ASCII character a US keyboard has, and back again", () => {
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
    const presses = hidPresses(ascii);
    expect(presses).toHaveLength(95);
    expect(presses.map((p) => charOf(p.usage, p.shift)).join("")).toBe(ascii);
  });

  it("takes a newline or a CRLF as one Return, and drops what no key types", () => {
    expect(hidPresses("a\r\nb\rc\td")).toEqual([
      { usage: 4, shift: false },
      { usage: 40, shift: false },
      { usage: 5, shift: false },
      { usage: 40, shift: false },
      { usage: 6, shift: false },
      { usage: 43, shift: false },
      { usage: 7, shift: false },
    ]);
    expect(hidPresses("é✓😀")).toEqual([]);
  });
});
