import { describe, expect, it } from 'vitest';

import { matchKeywords } from './keywords';

describe('matchKeywords', () => {
  it('treats Message is as exact and case-insensitive', () => {
    expect(matchKeywords('HELLO', ['hello'], 'is')).toBe(true);
    expect(matchKeywords('hello there', ['hello'], 'is')).toBe(false);
  });

  it('treats Message contains as a substring', () => {
    expect(
      matchKeywords('Hello, please send info', ['hello'], 'contains')
    ).toBe(true);
  });

  it('treats contains_word as a whole word', () => {
    expect(matchKeywords('within', ['hi'], 'contains_word')).toBe(false);
    expect(matchKeywords('say hi now', ['hi'], 'contains_word')).toBe(true);
    expect(matchKeywords('dislike', ['like'], 'contains_word')).toBe(false);
  });

  it('treats begins_with as a prefix', () => {
    expect(matchKeywords('can you help', ['can you'], 'begins_with')).toBe(
      true
    );
    expect(matchKeywords('please can you', ['can you'], 'begins_with')).toBe(
      false
    );
  });
});
