import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  from: vi.fn(),
  feed: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getClaims: mocks.getClaims },
    from: mocks.from,
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: vi.fn(() => ({})),
}));

vi.mock('@/lib/activity/feed', () => ({
  getContactActivityFeed: mocks.feed,
}));

import { GET } from './route';

const params = { params: Promise.resolve({ id: 'contact-1' }) };
const url = 'http://localhost/api/contacts/contact-1/activity';

// Minimal PostgREST chain: select -> eq -> eq -> maybeSingle
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.maybeSingle = async () => result;
  return c;
}

beforeEach(() => {
  mocks.getClaims.mockReset();
  mocks.from.mockReset();
  mocks.feed.mockReset();
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: 'user-1' } },
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return chain({ data: { account_id: 'account-1' }, error: null });
    }
    if (table === 'contacts') {
      return chain({ data: { id: 'contact-1' }, error: null });
    }
    return chain({ data: null, error: null });
  });
  mocks.feed.mockResolvedValue({ items: [], nextCursor: null });
});

describe('GET /api/contacts/[id]/activity (getClaims pilot)', () => {
  it('serves the feed for a valid JWT without a getUser round trip', async () => {
    const res = await GET(new Request(url), params);
    expect(res.status).toBe(200);
    expect(mocks.getClaims).toHaveBeenCalledTimes(1);
    expect(mocks.feed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contactId: 'contact-1', accountId: 'account-1' })
    );
  });

  it('rejects expired/malformed tokens with 401', async () => {
    mocks.getClaims.mockResolvedValueOnce({
      data: { claims: null },
      error: { message: 'expired' },
    });
    const res = await GET(new Request(url), params);
    expect(res.status).toBe(401);
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it('rejects a token without a subject with 401', async () => {
    mocks.getClaims.mockResolvedValueOnce({
      data: { claims: {} },
      error: null,
    });
    const res = await GET(new Request(url), params);
    expect(res.status).toBe(401);
  });

  it('keeps account isolation: unknown profile -> 400, foreign contact -> 404', async () => {
    mocks.from.mockImplementationOnce(() => chain({ data: null, error: null }));
    const noAccount = await GET(new Request(url), params);
    expect(noAccount.status).toBe(400);

    mocks.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain({ data: { account_id: 'account-1' }, error: null });
      }
      return chain({ data: null, error: null });
    });
    const foreign = await GET(new Request(url), params);
    expect(foreign.status).toBe(404);
    expect(mocks.feed).not.toHaveBeenCalled();
  });
});
