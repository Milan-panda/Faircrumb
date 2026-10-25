import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
export type ExpenseNotification = { id: string; group_id: string; expense_id: string; actor_name: string; group_name: string; description: string; amount: number; share: number; created_at: string; read_at: string | null };
export type NotificationFeed = { items: ExpenseNotification[]; unread: number };
const empty: NotificationFeed = { items: [], unread: 0 };
export function useNotifications(profileId: string | undefined, demo: boolean, online: boolean) {
  const enabled = !!profileId && !demo && !!supabase;
  const [state, setState] = useState<{ owner: string | undefined; feed: NotificationFeed; loading: boolean; error: string }>({ owner: undefined, feed: empty, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  const owner = useRef(profileId);
  useLayoutEffect(() => { owner.current = profileId; return () => { owner.current = undefined; }; }, [profileId]);
  useEffect(() => {
    if (!enabled || !online) return;
    let alive = true, request = 0;
    const load = async () => {
      const version = ++request;
      try {
        const { data, error } = await supabase!.rpc('notification_feed'); if (error) throw error;
        if (alive && version === request) setState({ owner: profileId, feed: data || empty, loading: false, error: '' });
      } catch (e) { if (alive && version === request) setState(old => ({ owner: profileId, feed: old.owner === profileId ? old.feed : empty, loading: false, error: (e as Error).message })); }
    };
    void load();
    const channel = supabase!.channel(`notifications-${profileId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profileId}` }, () => void load()).subscribe(status => { if (status === 'SUBSCRIBED') void load(); });
    const focus = () => { if (document.visibilityState !== 'hidden') void load(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    const timer = setInterval(focus, 60000);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); void supabase!.removeChannel(channel); };
  }, [profileId, enabled, online, revision]);
  const markRead = useCallback(async (id?: string) => {
    if (!enabled || !online || !navigator.onLine) throw new Error('Connect to the internet to mark notifications as read.');
    const expected = profileId; const readAt = new Date().toISOString(); const { error } = await supabase!.rpc('mark_notifications_read', { p_id: id || null }); if (error) throw error;
    if (owner.current === expected) { setState(old => old.owner !== expected ? old : { ...old, feed: { ...old.feed, items: old.feed.items.map(n => !id || n.id === id ? { ...n, read_at: n.read_at || readAt } : n), unread: id ? Math.max(0, old.feed.unread - (old.feed.items.some(n => n.id === id && !n.read_at) ? 1 : 0)) : 0 } }); setRevision(n => n + 1); }
  }, [profileId, enabled, online]);
  const current = state.owner === profileId ? state : { feed: empty, loading: true, error: '' };
  return { ...(enabled ? current : { feed: empty, loading: false, error: '' }), markRead, retry: () => setRevision(n => n + 1) };
}
export type NotificationController = ReturnType<typeof useNotifications>;
