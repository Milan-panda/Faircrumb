// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const api = vi.hoisted(() => ({ rpc: vi.fn(), listener: null as null | (() => void), remove: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: api.rpc, channel: () => ({ on(_event: unknown, _filter: unknown, callback: () => void) { api.listener = callback; return this; }, subscribe() { return this; } }), removeChannel: api.remove } }));
import { useNotifications, type NotificationController } from '../src/lib/notifications';
import NotificationsPage from '../src/NotificationsPage';
let root: Root, host: HTMLDivElement, controller: NotificationController;
const note = { id: 'one', group_id: 'group', expense_id: 'bill', actor_name: 'Priya', group_name: 'Goa', description: 'Dinner', amount: 12000, share: 6000, created_at: '2026-10-25T12:00:00Z', read_at: null };
const open = vi.fn();
function Harness({ id = 'me', online = true, demo = false }: { id?: string; online?: boolean; demo?: boolean }) { controller = useNotifications(id, demo, online); return <NotificationsPage controller={controller} online={online} demo={demo} open={open} />; }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); api.listener = null; vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); api.rpc.mockResolvedValue({ data: { items: [note], unread: 1 }, error: null }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('loads unread expenses, refreshes live, and marks read through the backend', async () => {
  await act(async () => root.render(<Harness />)); expect(host.textContent).toContain('Priya added Dinner'); expect(host.textContent).toContain('1 unread');
  api.rpc.mockResolvedValue({ data: { items: [{ ...note, read_at: 'now' }], unread: 0 }, error: null });
  await act(async () => controller.markRead('one')); expect(api.rpc).toHaveBeenCalledWith('mark_notifications_read', { p_id: 'one' }); expect(controller.feed.unread).toBe(0);
  api.rpc.mockResolvedValue({ data: { items: [note], unread: 1 }, error: null }); await act(async () => api.listener!()); expect(controller.feed.unread).toBe(1);
});
it('shows deleted-expense failures without marking an update as read', async () => {
  open.mockRejectedValue(new Error('This expense has been deleted.')); await act(async () => root.render(<Harness />));
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('View expense'))!; await act(async () => button.click());
  expect(host.textContent).toContain('This expense has been deleted.'); expect(api.rpc).not.toHaveBeenCalledWith('mark_notifications_read', expect.anything());
});
it('does not expose the previous account feed while the next account loads', async () => {
  await act(async () => root.render(<Harness />)); api.rpc.mockImplementation(() => new Promise(() => { })); await act(async () => root.render(<Harness id="someone-else" />));
  expect(host.textContent).not.toContain('Priya added Dinner'); expect(controller.feed.unread).toBe(0); expect(api.remove).toHaveBeenCalled();
});
it('shows offline and demo states without requesting a feed', async () => {
  await act(async () => root.render(<Harness online={false} />)); expect(host.textContent).toContain('offline'); expect(api.rpc).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness demo />)); expect(host.textContent).toContain('real workspace'); expect(api.rpc).not.toHaveBeenCalled();
});
it('shows feed errors and supports retry', async () => {
  api.rpc.mockResolvedValueOnce({ data: null, error: new Error('Unable to load updates') }); await act(async () => root.render(<Harness />)); expect(host.textContent).toContain('Unable to load updates');
  await act(async () => controller.retry()); expect(host.textContent).toContain('Priya added Dinner');
});
