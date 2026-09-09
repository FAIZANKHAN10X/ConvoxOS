export type KeywordMatchType =
  'is' | 'contains' | 'contains_word' | 'begins_with';

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ManyChat keyword rules (help 14281211785884), minus Messenger-only
 * thumbs-up. Matching is case-insensitive. First matching keyword wins.
 */
export function matchKeywords(
  text: string,
  keywords: string[],
  matchType: KeywordMatchType
): boolean {
  const haystack = normalize(text);
  if (!haystack) return false;
  for (const raw of keywords) {
    const needle = normalize(raw);
    if (!needle) continue;
    if (matchType === 'is' && haystack === needle) return true;
    if (matchType === 'contains' && haystack.includes(needle)) return true;
    if (matchType === 'begins_with' && haystack.startsWith(needle)) return true;
    if (matchType === 'contains_word') {
      const pattern = new RegExp(`(^|\\W)${escapeRegExp(needle)}(\\W|$)`, 'i');
      if (pattern.test(haystack)) return true;
    }
  }
  return false;
}
