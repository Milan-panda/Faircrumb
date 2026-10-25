// @vitest-environment happy-dom
import { beforeEach, it, expect, vi } from 'vitest';
const api = vi.hoisted(() => ({ getSession: vi.fn(), signInAnonymously: vi.fn(), rpc: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: api.getSession, signInAnonymously: api.signInAnonymously }, rpc: api.rpc } }));
import { readInviteLink, inviteUrl, clearInviteLink, acceptPersonInvite } from '../src/lib/invites';
const token = 'a'.repeat(48);
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); history.replaceState(null, '', '/'); api.rpc.mockResolvedValue({ data: { profile: { id: 'original', name: 'Priya', username: 'priya' }, groupId: 'trip' }, error: null }); });
it('keeps the two invite scopes distinct and sends the secret in a fragment', () => {
  expect(readInviteLink('#group-invite=' + token)).toEqual({ kind: 'group', token });
  expect(readInviteLink('#person-invite=' + token)).toEqual({ kind: 'person', token });
  const link = new URL(inviteUrl('person', token)); expect(link.search).toBe(''); expect(link.hash).toBe('#person-invite=' + token);
  expect(readInviteLink('#access_token=auth')).toBeNull();
  expect(api.signInAnonymously).not.toHaveBeenCalled();
});
it('removes only invitation parameters after acceptance', () => {
  history.replaceState(null, '', '/?account=setup#person-invite=' + token + '&other=value'); clearInviteLink();
  expect(location.search).toBe('?account=setup'); expect(location.hash).toBe('#other=value');
});
it('automatically signs in a new recipient and claims their existing profile with no form', async () => {
  api.getSession.mockResolvedValue({ data: { session: null }, error: null });
  api.signInAnonymously.mockResolvedValue({ data: { session: { user: { id: 'auth' } } }, error: null });
  const [a, b] = await Promise.all([acceptPersonInvite(token), acceptPersonInvite(token)]);
  expect(a.profile.id).toBe('original'); expect(b.authId).toBe('auth'); expect(api.signInAnonymously).toHaveBeenCalledTimes(1);
  expect(api.rpc).toHaveBeenCalledWith('accept_person_invite', { p_token: token });
});
it('reuses a session and surfaces account mismatch without switching identities', async () => {
  api.getSession.mockResolvedValue({ data: { session: { user: { id: 'existing' } } }, error: null }); api.rpc.mockResolvedValue({ data: null, error: new Error('ACCOUNT_MISMATCH') });
  await expect(acceptPersonInvite(token)).rejects.toThrow('ACCOUNT_MISMATCH'); expect(api.signInAnonymously).not.toHaveBeenCalled();
});
it('rejects malformed and offline links before creating anonymous accounts', async () => {
  await expect(acceptPersonInvite('bad')).rejects.toThrow('invalid');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await expect(acceptPersonInvite(token)).rejects.toThrow('internet'); expect(api.getSession).not.toHaveBeenCalled();
});
