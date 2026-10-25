// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { useAdminAccess } from '../src/lib/admin';
const server = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'signed-session' } }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => { } } } }) }, functions: { invoke: server.invoke } } }));
let root: Root; let host: HTMLDivElement; let admin: ReturnType<typeof useAdminAccess>;
function Harness() { admin = useAdminAccess('profile'); return <div>{admin.allowed ? 'Admin' : 'Ordinary user'}</div>; }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); server.invoke.mockReset(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('ignores forged local admin flags and uses the server decision', async () => { localStorage.setItem('isAdmin', 'true'); localStorage.setItem('admin_priviledge', '["owner@mail.com"]'); server.invoke.mockResolvedValue({ data: { isAdmin: false }, error: null }); await act(async () => root.render(<Harness />)); await act(async () => admin.check()); expect(host.textContent).toBe('Ordinary user'); expect(server.invoke).toHaveBeenCalledWith('admin', { body: { action: 'status' }, headers: { Authorization: 'Bearer signed-session' } }); });
it('revokes discovery when the server no longer grants access', async () => { server.invoke.mockResolvedValue({ data: { isAdmin: true }, error: null }); await act(async () => root.render(<Harness />)); await act(async () => admin.check()); expect(admin.allowed).toBe(true); server.invoke.mockResolvedValue({ data: { isAdmin: false }, error: null }); await act(async () => admin.check()); expect(admin.allowed).toBe(false); });
