// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLedger } from '../src/lib/store';
import type { Group, Profile } from '../src/lib/domain';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), getSession: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), signInWithPassword: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: () => ({ select: mocks.select }), auth: { onAuthStateChange: mocks.onAuthStateChange, getSession: mocks.getSession, getUser: mocks.getUser, updateUser: mocks.updateUser, signInWithPassword: mocks.signInWithPassword }, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => Promise.resolve() } }));
const me: Profile = { id: 'me', name: 'Me', username: 'myname' };
const group: Group = { id: 'g', name: 'Trip', category: 'trip', currency: 'INR', revision: 0, members: [me], expenses: [], audit: [] };
let ledger: ReturnType<typeof useLedger>;
let root: Root;
let host: HTMLDivElement;
function Harness() { ledger = useLedger(); return <div>{ledger.groups.map(g => g.name).join(',')}</div>; }
async function mount() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<Harness />)); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  vi.clearAllMocks();
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'auth-me', email: '', is_anonymous: true } }, error: null });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'auth-me' } } }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'my_profile' ? me : 1, error: null }));
  mocks.select.mockResolvedValue({ data: [], error: null });
  localStorage.setItem('splitfree-auth-auth-me', JSON.stringify(me));
  localStorage.setItem('splitfree-me-v1', JSON.stringify({ profile: me, groups: [group], pending: [] }));
});
afterEach(async () => {
  if (root)
    await act(async () => root.unmount()); host?.remove(); vi.restoreAllMocks();
});
describe('offline and synchronization', () => {
  it('restores an authenticated cached ledger offline without querying the profile', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await mount();
    expect(ledger.profile?.id).toBe('me');
    expect(ledger.groups[0].name).toBe('Trip');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(ledger.online).toBe(false);
  });
  it('retains edits made while an earlier version is uploading', async () => {
    let resolveFirst: ((v: unknown) => void) | undefined;
    let saves = 0;
    mocks.rpc.mockImplementation(async (name: string, args?: {
      p_document: Group;
      p_expected: number;
    }) => {
      if (name === 'my_profile')
        return { data: me, error: null };
      if (name === 'save_group') {
        saves++;
        if (saves === 1)
          return await new Promise(resolve => { resolveFirst = resolve; });
        expect(args!.p_expected).toBe(1);
        return { data: 2, error: null };
      }
      return { data: null, error: null };
    });
    await mount();
    await act(async () => ledger.commit({ ...ledger.groups[0], name: 'First edit' }));
    let syncing: Promise<void>;
    await act(async () => { syncing = ledger.sync(); });
    await act(async () => ledger.commit({ ...ledger.groups[0], name: 'Second edit' }));
    await act(async () => { resolveFirst!({ data: 1, error: null }); await syncing!; });
    expect(ledger.groups[0].name).toBe('Second edit');
    expect(ledger.groups[0].revision).toBe(1);
    expect(ledger.pending).toEqual(['g']);
    await act(async () => ledger.sync());
    expect(ledger.groups[0].name).toBe('Second edit');
    expect(ledger.groups[0].revision).toBe(2);
    expect(ledger.pending).toEqual([]);
  });
  it('keeps unsynced data and shows a revision conflict', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'my_profile' ? { data: me, error: null } : { data: null, error: { message: 'CONFLICT: newer group revision exists' } });
    await mount();
    await act(async () => ledger.commit({ ...ledger.groups[0], name: 'My offline changes' }));
    await act(async () => ledger.sync());
    expect(ledger.pending).toEqual(['g']);
    expect(ledger.groups[0].name).toBe('My offline changes');
    expect(ledger.error).toContain('another device');
  });
  it('keeps password success if the separate profile save fails', async () => {
    const user = { id: 'auth-me', email: 'myname@splitfree.internal', email_confirmed_at: '2026-10-25', is_anonymous: false };
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.updateUser.mockResolvedValue({ data: { user }, error: null });
    mocks.rpc.mockImplementation(async (name: string) => name === 'update_profile' ? { data: null, error: new Error('Profile write failed') } : { data: me, error: null });
    await mount();
    await act(async () => { await expect(ledger.updateProfile('New name', '', 'a-long-private-password')).rejects.toThrow('Profile write failed'); });
    expect(ledger.profile?.hasPassword).toBe(true);
    expect(ledger.profile?.name).toBe('Me');
    expect(JSON.parse(localStorage.getItem('splitfree-me-v1')!).profile.hasPassword).toBe(true);
  });
  it('does not mark the account protected if Auth rejects the password', async () => {
    const user = { id: 'auth-me', email: 'myname@splitfree.internal', email_confirmed_at: '2026-10-25', is_anonymous: false };
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.updateUser.mockResolvedValue({ data: { user: null }, error: new Error('Password rejected') });
    await mount();
    await act(async () => { await expect(ledger.updateProfile('New name', '', 'a-long-private-password')).rejects.toThrow('Password rejected'); });
    expect(ledger.profile?.hasPassword).not.toBe(true);
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'update_profile')).toBe(false);
  });

  it('signs in with the real email without appending the synthetic domain', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null }); await mount();
    await act(async () => ledger.onboard('', 'milan@mail.com', '', 'a-long-private-password', true));
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'milan@mail.com', password: 'a-long-private-password' });
  });

});
