import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  enqueue: vi.fn(),
  process: vi.fn(),
}));

vi.mock('./tag-write', () => ({
  addContactTagIfAbsent: mocks.add,
  removeContactTag: mocks.remove,
}));

vi.mock('@/lib/automation/events', () => ({
  enqueueDomainEventWithClient: mocks.enqueue,
}));

vi.mock('@/lib/automation/kick', () => ({
  kickDomainEvent: mocks.process,
}));

import {
  addContactTagAndDispatch,
  getTagChainDepth,
  MAX_TAG_CHAIN_DEPTH,
  removeContactTagAndDispatch,
} from './tag-events';

const base = {
  db: {} as never,
  accountId: 'account-1',
  contactId: 'contact-1',
  tagId: 'tag-1',
};

beforeEach(() => {
  mocks.add.mockReset();
  mocks.remove.mockReset();
  mocks.enqueue.mockReset();
  mocks.process.mockReset();
  mocks.enqueue.mockResolvedValue({ id: 'evt-1' });
  mocks.process.mockResolvedValue({});
});

describe('addContactTagAndDispatch', () => {
  it('enqueues tag_added and kicks the worker', async () => {
    mocks.add.mockResolvedValue(true);

    const result = await addContactTagAndDispatch({
      ...base,
      context: { vars: { source: 'flow', _tag_chain_depth: 1 } },
    });

    expect(result).toEqual({ added: true, dispatched: true });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      base.db,
      expect.objectContaining({
        eventType: 'tag_added',
        contactId: 'contact-1',
        payload: { tag_id: 'tag-1' },
        chainDepth: 1,
      })
    );
    expect(mocks.process).toHaveBeenCalled();
  });

  it('reports duplicate when the tag already exists', async () => {
    mocks.add.mockResolvedValue(false);

    await expect(addContactTagAndDispatch(base)).resolves.toEqual({
      added: false,
      dispatched: false,
      reason: 'duplicate',
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues at max depth but does not treat it as a dispatch', async () => {
    mocks.add.mockResolvedValue(true);

    await expect(
      addContactTagAndDispatch({
        ...base,
        context: { vars: { _tag_chain_depth: MAX_TAG_CHAIN_DEPTH } },
      })
    ).resolves.toEqual({
      added: true,
      dispatched: false,
      reason: 'max_depth',
    });
    expect(mocks.enqueue).toHaveBeenCalled();
  });

  it('records a single add without looping', async () => {
    mocks.add.mockResolvedValue(true);
    await addContactTagAndDispatch({ ...base, tagId: 'tag-a' });

    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('removeContactTagAndDispatch', () => {
  it('enqueues tag_removed when a join row is deleted', async () => {
    mocks.remove.mockResolvedValue(true);

    await expect(removeContactTagAndDispatch(base)).resolves.toEqual({
      removed: true,
      dispatched: true,
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      base.db,
      expect.objectContaining({
        eventType: 'tag_removed',
        payload: { tag_id: 'tag-1' },
      })
    );
    expect(mocks.process).toHaveBeenCalledWith('evt-1');
  });

  it('does not emit when the tag was not on the contact', async () => {
    mocks.remove.mockResolvedValue(false);
    await expect(removeContactTagAndDispatch(base)).resolves.toEqual({
      removed: false,
      dispatched: false,
      reason: 'absent',
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
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
