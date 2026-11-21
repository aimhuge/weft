// Spelling items for the right-click menu on a misspelled word: Chromium underlines it, but Electron leaves the
// suggestions to the app. Up to five suggestions that replace the word, then Add to Dictionary, then a separator.
// Empty when the click wasn't on a misspelling, so the menu is unchanged everywhere else.
function spellingItems(params, contents) {
  const word = params.misspelledWord;
  if (!params.isEditable || !word) return [];
  const suggestions = (params.dictionarySuggestions || []).slice(0, 5);
  return [
    ...(suggestions.length
      ? suggestions.map((s) => ({ label: s, click: () => contents.replaceMisspelling(s) }))
      : [{ label: "No Guesses Found", enabled: false }]),
    { type: "separator" },
    { label: "Add to Dictionary", click: () => contents.session.addWordToSpellCheckerDictionary(word) },
    { type: "separator" },
  ];
}

module.exports = { spellingItems };
