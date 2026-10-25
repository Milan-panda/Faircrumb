import { describe, it, expect, vi } from 'vitest';
import { adminEmails, createAdminHandler, type VerifiedUser } from '../supabase/functions/admin/handler';
const user: VerifiedUser = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@mail.com', email_confirmed_at: '2026-10-25', is_anonymous: false };
function fixture(override: Partial<VerifiedUser> = {}, allowlist = '["owner@mail.com"]') {
  const authenticate = vi.fn(async (token: string) => token === 'signed-session' ? { ...user, ...override } : null);
  const rpc = vi.fn(async () => ({ data: { items: [], total: 0, page: 1, pageSize: 25 }, error: null }));
  const handler = createAdminHandler({ authenticate, allowlist: () => allowlist, rpc });
  const request = (body: unknown, token = 'signed-session') => handler(new Request('https://api.test/admin', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { request, rpc, authenticate, handler };
}
describe('server admin authorization', () => {
  it('fails closed for empty, malformed, non-array and username allowlists', async () => {
    for (const raw of ['', '[]', '{}', 'broken', '["milan"]', '["owner@mail.com",null]']) { expect(adminEmails(raw)).toEqual([]); const f = fixture({}, raw); expect((await f.request({ action: 'list', entity: 'users' })).status).toBe(403); expect(f.rpc).not.toHaveBeenCalled(); }
  });
  it('normalizes verified emails and permits an allowlisted owner', async () => {
    expect(adminEmails('[" OWNER@mail.com ","owner@mail.com"]')).toEqual(['owner@mail.com']); const f = fixture({ email: 'OWNER@mail.com' }); const response = await f.request({ action: 'list', entity: 'users', page: 2 }); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(f.rpc).toHaveBeenCalledWith('admin_list', { p_entity: 'users', p_page: 2, p_query: '', p_actor: user.id });
  });
  it('rejects anonymous and unverified accounts even if the email matches', async () => {
    for (const override of [{ is_anonymous: true }, { email_confirmed_at: '' }]) { const f = fixture(override); expect((await f.request({ action: 'reissue-token', profileId: user.id })).status).toBe(403); expect(f.rpc).not.toHaveBeenCalled(); }
  });
  it('does not accept caller-supplied admin flags, email or actor identity', async () => {
    const f = fixture({ email: 'ordinary@mail.com' }); expect((await f.request({ action: 'list', entity: 'users', isAdmin: true, email: user.email, admin_priviledge: [user.email], role: 'service_role', p_actor: user.id })).status).toBe(403); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('does not accept unsigned or fabricated sessions', async () => {
    const f = fixture(); expect((await f.request({ action: 'status' }, 'forged-token')).status).toBe(401); expect(f.rpc).not.toHaveBeenCalled();
    const missing = await f.handler(new Request('https://api.test/admin', { method: 'POST', body: '{}' })); expect(missing.status).toBe(401);
  });
  it('returns only a status flag to a normal authenticated user', async () => {
    const f = fixture({ email: 'ordinary@mail.com' }); const response = await f.request({ action: 'status' }); expect(await response.json()).toEqual({ isAdmin: false }); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('uses the verified actor for token rotation and validates requested IDs', async () => {
    const f = fixture(); expect((await f.request({ action: 'reissue-token', profileId: 'bad' })).status).toBe(400); await f.request({ action: 'reissue-token', profileId: user.id, actor: 'forged' }); expect(f.rpc).toHaveBeenCalledWith('admin_reissue_token', { p_profile: user.id, p_actor: user.id });
  });
  it('rejects unknown actions, arbitrary RPC names and oversized bodies', async () => {
    const f = fixture(); expect((await f.request({ action: 'delete-all-users' })).status).toBe(400); expect((await f.request({ action: 'list', entity: 'auth.users' })).status).toBe(400); expect((await f.request({ action: 'list', entity: 'users', page: -1 })).status).toBe(400); expect((await f.request({ action: 'status', padding: 'x'.repeat(9000) })).status).toBe(413); expect(f.rpc).not.toHaveBeenCalled();
  });
});
