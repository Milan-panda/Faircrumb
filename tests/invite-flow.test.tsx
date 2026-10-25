// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({ ledger: {} as any, personal: vi.fn(), group: vi.fn() }));
vi.mock('../src/lib/store', () => ({ useLedger: () => mock.ledger }));
vi.mock('../src/lib/admin', () => ({ useAdminAccess: () => ({ allowed: false }) }));
vi.mock('../src/lib/notifications',()=>({useNotifications:()=>({feed:{items:[],unread:0},loading:false,error:'',markRead:vi.fn(),retry:vi.fn()})}));
import App from '../src/App';
let root: Root, host: HTMLDivElement;
const token = 'a'.repeat(48);
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); vi.resetAllMocks(); history.replaceState(null, '', '/'); mock.ledger = { ready: true, profile: null, groups: [], demo: false, online: true, pending: [], security: { checking: false, email: '', pendingEmail: '', hasPassword: false }, error: '', acceptPersonalInvitation: mock.personal, acceptGroupInvitation: mock.group }; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); history.replaceState(null, '', '/'); });
it('keeps a new group invite recipient on normal onboarding without signing in automatically', async () => {
  history.replaceState(null, '', '/#group-invite=' + token); await act(async () => root.render(<App />));
  expect(host.textContent).toContain('Create your account or sign in below'); expect(mock.group).not.toHaveBeenCalled(); expect(mock.personal).not.toHaveBeenCalled();
});
it('joins an existing account directly and clears the invitation fragment', async () => {
  history.replaceState(null, '', '/#group-invite=' + token); mock.ledger.profile = { id: 'existing', name: 'Milan' }; mock.group.mockResolvedValue(null);
  await act(async () => root.render(<App />)); expect(mock.group).toHaveBeenCalledWith(token); expect(location.hash).toBe('');
});
it('attempts personal claim automatically and exposes errors without showing a claim-token form', async () => {
  history.replaceState(null, '', '/#person-invite=' + token); mock.personal.mockRejectedValue(new Error('This invitation was used, revoked, or expired'));
  await act(async () => root.render(<App />)); expect(mock.personal).toHaveBeenCalledWith(token); expect(host.textContent).toContain('used, revoked, or expired'); expect(host.querySelector('input')).toBeNull();
  const retry = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Try again')!; await act(async () => retry.click()); expect(mock.personal).toHaveBeenCalledTimes(2);
});
it('waits offline without attempting to consume the personal invitation', async () => {
  history.replaceState(null, '', '/#person-invite=' + token); mock.ledger.online = false; await act(async () => root.render(<App />)); expect(host.textContent).toContain('Connect to the internet'); expect(mock.personal).not.toHaveBeenCalled();
});
