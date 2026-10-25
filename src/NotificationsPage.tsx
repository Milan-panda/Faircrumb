import { useState } from 'react';
import { Bell, Check, ArrowRight } from 'lucide-react';
import { Empty } from './components';
import { money } from './lib/domain';
import type { ExpenseNotification, NotificationController } from './lib/notifications';
export default function NotificationsPage({ controller, online, demo, open }: { controller: NotificationController; online: boolean; demo: boolean; open: (n: ExpenseNotification) => Promise<void> }) {
  const { feed, loading, error, markRead, retry } = controller; const [busy, setBusy] = useState(''); const [actionError, setError] = useState('');
  async function run(id: string, action: () => Promise<void>) { setBusy(id); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } }
  return <section className="notifications-page">
    <div className="section-heading">
      <div>
        <p className="eyebrow">YOUR UPDATES</p>
        <h1>Notifications</h1>
        <p className="helper">New expenses that include you, all in one place.</p>
      </div>
      <button type="button" className="button" disabled={!online || !!busy || !feed.unread} onClick={() => void run('all', () => markRead())}>
        <Check size={16} />Mark all as read</button>
    </div>
    {!online && <p className="confirmation-notice" role="status">You’re offline. New notifications will appear when you reconnect.</p>}
    {(error || actionError) && <p className="form-error" role="alert">{actionError || error} {error && <button type="button" className="text-button" onClick={retry}>Retry</button>}</p>}
    {loading && !error && online && !demo ? <p className="helper" role="status">Loading notifications…</p> : !feed.items.length ? <Empty title={demo ? 'Notifications live in your real workspace' : 'You’re all caught up'} detail="When someone adds an expense that includes you, it will appear here." /> : <>
      <p className="helper" aria-live="polite">{feed.unread ? `${feed.unread} unread` : 'All read'} · Latest {feed.items.length} updates</p>
      <ul className="notification-list">{feed.items.map(n =>
        <li key={n.id} className={!n.read_at ? 'unread' : ''}>
          <Bell size={18} aria-hidden="true" />
          <div className="notification-copy">
            <strong>{n.actor_name} added {n.description}</strong>
            <p>{n.group_name} · {money(n.amount)} total · Your share {money(n.share)}</p>
            <time dateTime={n.created_at}>{new Date(n.created_at).toLocaleString()}</time>
            <div className="notification-actions">
              <button type="button" className="text-button" disabled={!!busy || !online} onClick={() => void run(n.id, () => open(n))}>View expense <ArrowRight size={14} />
              </button>{!n.read_at && <button type="button" className="text-button" disabled={!!busy || !online} onClick={() => void run(n.id, () => markRead(n.id))}>Mark as read</button>}</div>
          </div>{!n.read_at && <span className="notification-dot" aria-label="Unread" />}</li>)}</ul>
    </>}
  </section>;
}
