import { describe, expect, it, vi } from "vitest";
import { spellingItems } from "./spelling-menu.cjs";

function contents() {
  return { replaceMisspelling: vi.fn(), session: { addWordToSpellCheckerDictionary: vi.fn() } };
}

describe("spellingItems", () => {
  it("is empty off a misspelling, or outside an editable field", () => {
    expect(spellingItems({ isEditable: true, misspelledWord: "" }, contents())).toEqual([]);
    expect(spellingItems({ isEditable: false, misspelledWord: "teh", dictionarySuggestions: ["the"] }, contents())).toEqual([]);
  });

  it("offers up to five suggestions that replace the word, then Add to Dictionary", () => {
    const c = contents();
    const items = spellingItems(
      { isEditable: true, misspelledWord: "acrrued", dictionarySuggestions: ["accrued", "a", "b", "c", "d", "e"] },
      c,
    );
    const labels = items.map((i) => i.label ?? i.type);
    expect(labels).toEqual(["accrued", "a", "b", "c", "d", "separator", "Add to Dictionary", "separator"]);
    items[0]?.click?.();
    expect(c.replaceMisspelling).toHaveBeenCalledWith("accrued");
    items[6]?.click?.();
    expect(c.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("acrrued");
  });

  it("says so when there are no guesses", () => {
    const items = spellingItems({ isEditable: true, misspelledWord: "qzxv", dictionarySuggestions: [] }, contents());
    expect(items[0]).toEqual({ label: "No Guesses Found", enabled: false });
  });
});
