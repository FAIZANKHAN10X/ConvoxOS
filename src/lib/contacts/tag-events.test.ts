import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
}));

vi.mock('./tag-write', () => ({
  addContactTagIfAbsent: mocks.add,
}));

import {
  addContactTagAndDispatch,
  getTagChainDepth,
  MAX_TAG_CHAIN_DEPTH,
} from './tag-events';

const base = {
  db: {} as never,
  accountId: 'account-1',
  contactId: 'contact-1',
  tagId: 'tag-1',
};

beforeEach(() => {
  mocks.add.mockReset();
});

describe('addContactTagAndDispatch', () => {
  it('adds a newly inserted tag (no automation dispatch exists)', async () => {
    mocks.add.mockResolvedValue(true);

    const result = await addContactTagAndDispatch({
      ...base,
      context: { vars: { source: 'flow', _tag_chain_depth: 1 } },
    });

    // No automation engine remains — the helper only records the tag join.
    expect(result).toEqual({ added: true, dispatched: false });
  });

  it('reports duplicate when the tag already exists', async () => {
    mocks.add.mockResolvedValue(false);

    await expect(addContactTagAndDispatch(base)).resolves.toEqual({
      added: false,
      dispatched: false,
      reason: 'duplicate',
    });
  });

  it('adds the tag but cuts a chain at the configured depth limit', async () => {
    mocks.add.mockResolvedValue(true);

    await expect(
      addContactTagAndDispatch({
        ...base,
        context: { vars: { _tag_chain_depth: MAX_TAG_CHAIN_DEPTH } },
      })
    ).resolves.toEqual({
      added: true,
      dispatched: false,
    });
  });

  it('records a single add without looping', async () => {
    mocks.add.mockResolvedValue(true);
    await addContactTagAndDispatch({ ...base, tagId: 'tag-a' });

    expect(mocks.add).toHaveBeenCalledTimes(1);
  });
});

describe('getTagChainDepth', () => {
  it('normalizes missing, invalid and fractional values', () => {
    expect(getTagChainDepth()).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: '3' } })).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: -1 } })).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: 2.8 } })).toBe(2);
  });
});
