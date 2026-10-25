// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import AdminPage from '../src/AdminPage';
const request = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/admin', () => ({ adminRequest: request }));
let root: Root; let host: HTMLDivElement;
const person = { profileId: '11111111-1111-4111-8111-111111111111', authId: null, username: 'friend', name: 'Friend', recoverable: true };
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); localStorage.clear(); request.mockReset(); request.mockImplementation(async (body: { action: string; entity: string }) => body.action === 'list' ? { items: body.entity === 'users' || body.entity === 'claims' ? [person] : [], total: 1, page: 1, pageSize: 25 } : { token: 'new-private-token', username: 'friend', expiresAt: '2026-10-26T00:00:00Z' }); HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('loads server records and requires confirmation before reissuing a token', async () => { await act(async () => root.render(<AdminPage />)); expect(host.textContent).toContain('@friend'); await act(async () => button('Reissue recovery token').click()); expect(request.mock.calls.some(([body]) => body.action === 'reissue-token')).toBe(false); expect(host.textContent).toContain('invalidates any previous token'); await act(async () => button('Reissue token').click()); expect(request).toHaveBeenCalledWith({ action: 'reissue-token', profileId: person.profileId }); expect(host.querySelector('dialog')!.textContent).toContain('new-private-token'); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0); });
it('shows an authorization failure without retaining earlier records', async () => { request.mockRejectedValue(new Error('Admin access is not enabled for this verified email.')); await act(async () => root.render(<AdminPage />)); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Admin access'); expect(host.textContent).not.toContain('@friend'); });
