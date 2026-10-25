import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthEmailRateLimited, setAccountPassword } from '../src/lib/password';
const anonymous = { id: 'same-auth-user', email: '', is_anonymous: true, email_confirmed_at: null };
const permanent = { ...anonymous, email: 'milan@mail.com', is_anonymous: false, email_confirmed_at: '2026-10-25T00:00:00Z' };
function fixture() {
  let user = { ...anonymous } as typeof anonymous | typeof permanent;
  const getUser = vi.fn(async () => ({ data: { user }, error: null }));
  const updateUser = vi.fn(async (attributes: { email?: string; password?: string }) => {
    if (attributes.email && attributes.password) throw new Error('Email address "" is invalid');
    if (attributes.email) user = { ...permanent, email: attributes.email };
    return { data: { user }, error: null };
  });
  return { auth: { getUser, updateUser } as unknown as SupabaseClient['auth'], getUser, updateUser, setUser: (next: typeof permanent) => { user = next; } };
}
describe('username password setup', () => {
  it('links the email before setting the first password, retaining the same account', async () => {
    const f = fixture();
    const result = await setAccountPassword(f.auth, '@Milan', 'a-long-private-password', 'milan@mail.com');
    expect(f.updateUser.mock.calls.map(([attributes]) => attributes)).toEqual([{ email: 'milan@mail.com' }, { password: 'a-long-private-password' }]);
    expect(f.getUser).toHaveBeenCalledTimes(2);
    expect(result.id).toBe(anonymous.id);
  });
  it('does not change email when updating an existing password or retrying after linking', async () => {
    const f = fixture(); f.setUser(permanent);
    await setAccountPassword(f.auth, 'milan', 'a-long-private-password', 'milan@mail.com');
    expect(f.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'a-long-private-password' });
  });
  it('stops before the password step when email confirmation is still pending', async () => {
    const f = fixture();
    f.updateUser.mockImplementationOnce(async () => ({ data: { user: anonymous }, error: null }));
    await expect(setAccountPassword(f.auth, 'milan', 'a-long-private-password', 'milan@mail.com')).rejects.toThrow('Confirm your email');
    expect(f.updateUser).toHaveBeenCalledTimes(1);
  });
  it('retains the original Auth error and supports retry after a failed password write', async () => {
    const f = fixture(); const error = new Error('Password is too common');
    f.updateUser.mockImplementationOnce(async () => { f.setUser(permanent); return { data: { user: permanent }, error: null }; });
    f.updateUser.mockRejectedValueOnce(error);
    await expect(setAccountPassword(f.auth, 'milan', 'a-long-private-password', 'milan@mail.com')).rejects.toBe(error);
    await setAccountPassword(f.auth, 'milan', 'another-long-password', 'milan@mail.com');
    expect(f.updateUser.mock.calls[2][0]).toEqual({ password: 'another-long-password' });
  });
  it('never overwrites an unrelated existing email', async () => {
    const f = fixture(); f.setUser({ ...permanent, email: 'real@personal.com' });
    await expect(setAccountPassword(f.auth, 'milan', 'a-long-private-password', 'milan@mail.com')).rejects.toThrow('different sign-in email');
    expect(f.updateUser).not.toHaveBeenCalled();
  });
  it('rejects invalid local input before any Auth mutation', async () => {
    const f = fixture();
    await expect(setAccountPassword(f.auth, '', 'a-long-private-password')).rejects.toThrow('username');
    await expect(setAccountPassword(f.auth, 'milan', 'short')).rejects.toThrow('12 characters');
    expect(f.updateUser).not.toHaveBeenCalled();
  });
  it('requires a real email for a new anonymous account', async () => {
    const f = fixture();
    await expect(setAccountPassword(f.auth, 'milan', 'a-long-private-password')).rejects.toThrow('Enter an email');
    await expect(setAccountPassword(f.auth, 'milan', 'a-long-private-password', 'milan@splitfree.internal')).rejects.toThrow('real email');
    expect(f.updateUser).not.toHaveBeenCalled();
  });
  it('can update an already linked email account without inventing a username alias', async () => {
    const f = fixture(); f.setUser(permanent);
    await setAccountPassword(f.auth, 'milan', 'a-long-private-password');
    expect(f.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'a-long-private-password' });
  });

  it('explains the server email quota and never proceeds to set a password', async () => {
    const f = fixture();
    // The client returns Auth errors in its result rather than throwing them.
    f.updateUser.mockReset();
    f.updateUser.mockResolvedValueOnce({ data: { user: anonymous }, error: Object.assign(new Error('email rate limit exceeded'), { code: 'over_email_send_rate_limit' }) } as never);
    await expect(setAccountPassword(f.auth, 'milan', 'a-long-private-password', 'milan@mail.com')).rejects.toBeInstanceOf(AuthEmailRateLimited);
    expect(f.updateUser).toHaveBeenCalledTimes(1);
  });
  it('does not resend an email that is already awaiting confirmation', async () => {
    const f = fixture();
    f.getUser.mockResolvedValue({ data: { user: { ...anonymous, new_email: 'milan@mail.com' } }, error: null } as never);
    await expect(setAccountPassword(f.auth, 'milan', 'a-long-private-password', 'milan@mail.com')).rejects.toThrow('Confirm your email');
    expect(f.updateUser).not.toHaveBeenCalled();
  });

});
