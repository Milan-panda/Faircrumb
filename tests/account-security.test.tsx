// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../src/App';
const server = vi.hoisted(() => ({ user: { id: 'auth-me', email: '', new_email: '', email_confirmed_at: '', is_anonymous: true }, hasPassword: false, listeners: new Set<(event: string, session: unknown) => void>() }));
vi.mock('../src/lib/supabase', () => ({  
supabase: {
    auth: { getSession: async () => ({ data: { session: { user: server.user } }, error: null }), getUser: async () => ({ data: { user: server.user }, error: null }), onAuthStateChange: (callback: (event: string, session: unknown) => void) => { server.listeners.add(callback); return { data: { subscription: { unsubscribe: () => server.listeners.delete(callback) } } }; }, updateUser: async (attributes: { email?: string; password?: string }) => { if (attributes.email) server.user = { ...server.user, new_email: attributes.email }; if (attributes.password) server.hasPassword = true; return { data: { user: server.user }, error: null }; } },
    rpc: async (name: string) => ({ data: name === 'my_profile' ? { id: 'me', name: 'Milan', username: 'milan', hasPassword: server.hasPassword } : null, error: null }),
    from: () => ({ select: async () => ({ data: [], error: null }) }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: async () => { }
  }
}));
let host: HTMLDivElement; let root: Root;
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(el => el.textContent?.trim() === text)!;
async function click(el: HTMLElement) { await act(async () => el.click()); }
async function input(el: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function mount() { await act(async () => root.render(<App />)); if (host.querySelector('h1')?.textContent !== 'The personal bits.') await click(button('Settings')); }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); server.user = { id: 'auth-me', email: '', new_email: '', email_confirmed_at: '', is_anonymous: true }; server.hasPassword = false; server.listeners.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });
it('shows confirm-email, verified-email and secured stages, then preserves secured state after reload', async () => {
  await mount(); await input(host.querySelector('input[type="email"]')!, 'milan@mail.com'); await input(host.querySelector('#settings-password')!, 'my-private-password');
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain('Check your email'); expect(host.querySelector('#settings-password')).toBeNull(); expect(server.hasPassword).toBe(false);
  server.user = { ...server.user, email: 'milan@mail.com', new_email: '', email_confirmed_at: '2026-10-25', is_anonymous: false };
  await click(button('I’ve confirmed my email'));
  expect(host.textContent).toContain('Email confirmed. One last step.'); expect(host.textContent).not.toContain('Account secured'); expect(host.querySelector('.confirmation-notice')).toBeNull();
  await input(host.querySelector('#settings-password')!, 'my-private-password'); await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain('Account secured'); expect(host.querySelector('#settings-password')).toBeNull(); expect(button('Change password')).toBeDefined();
  await act(async () => root.unmount()); root = createRoot(host); await mount(); expect(host.textContent).toContain('Account secured'); expect(host.querySelector('#settings-password')).toBeNull();
  await click(button('Change password')); expect(host.querySelector('#settings-password')).not.toBeNull(); await click(button('Cancel password change')); expect(host.querySelector('#settings-password')).toBeNull();
});
it('uses authoritative password state instead of a stale unsecured cached profile', async () => {
  const cached = { id: 'me', name: 'Milan', username: 'milan', hasPassword: false }; localStorage.setItem('splitfree-me-v1', JSON.stringify({ profile: cached, groups: [], pending: [] })); server.hasPassword = true; server.user = { ...server.user, email: 'milan@mail.com', email_confirmed_at: '2026-10-25', is_anonymous: false };
  await mount(); expect(host.textContent).toContain('Account secured'); expect(host.querySelector('#settings-password')).toBeNull();
});
it('returns an email-confirmation redirect directly to Settings', async () => {
  history.replaceState(null, '', '/?account=setup'); server.user = { ...server.user, email: 'milan@mail.com', email_confirmed_at: '2026-10-25', is_anonymous: false }; await act(async () => root.render(<App />)); expect(host.querySelector('h1')?.textContent).toBe('The personal bits.'); expect(host.textContent).toContain('Email confirmed. One last step.');
});
it('refreshes server account status after returning from the confirmation tab', async () => {
  await mount(); server.user = { ...server.user, email: 'milan@mail.com', email_confirmed_at: '2026-10-25', is_anonymous: false }; server.hasPassword = true; await act(async () => window.dispatchEvent(new Event('focus'))); expect(host.textContent).toContain('Account secured');
});

it('responds to Auth user updates outside the auth callback lock', async () => {
  await mount(); server.hasPassword = true; server.user = { ...server.user, email: 'milan@mail.com', email_confirmed_at: '2026-10-25', is_anonymous: false };
  await act(async () => { server.listeners.forEach(callback => callback('USER_UPDATED', { user: server.user })); await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(host.textContent).toContain('Account secured'); expect(host.querySelector('#settings-password')).toBeNull();
});
