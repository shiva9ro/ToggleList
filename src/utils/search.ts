/**
 * Normalize Japanese text for a loose substring search.
 *
 * - NFKC unifies half-width kana and full-width Latin characters.
 * - Katakana is folded into hiragana.
 * - Whitespace is ignored so that spacing differences do not affect matches.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/[ァ-ヶ]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60),
    )
    .replace(/\s+/g, '')
}
