export type SpellingItem = { label?: string; type?: "separator"; enabled?: boolean; click?: () => void };

export function spellingItems(
  params: { isEditable: boolean; misspelledWord: string; dictionarySuggestions?: string[] },
  contents: { replaceMisspelling(word: string): void; session: { addWordToSpellCheckerDictionary(word: string): unknown } },
): SpellingItem[];
