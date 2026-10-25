import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { adminRequest, type AdminList, type AdminRow } from './lib/admin';
import { Empty, Modal } from './components';
import { money, type Group } from './lib/domain';
type Entity = 'users' | 'groups' | 'claims' | 'audit';
const label = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value);
const when = (value: unknown) => value ? new Date(String(value)).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export default function AdminPage() {
  const [entity, setEntity] = useState<Entity>('users'); const [query, setQuery] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminList | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<AdminRow | null>(null); const [token, setToken] = useState<{ token: string; expiresAt: string; username: string } | null>(null); const [rotating, setRotating] = useState(false);
  const [group, setGroup] = useState<Group | null>(null); const [loadingGroup, setLoadingGroup] = useState(false); const [copied, setCopied] = useState(false);
  const requestVersion = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; requestVersion.current++; }; }, []);
  useEffect(() => { let active = true; const current = ++requestVersion.current; setLoading(true); setError(''); setData(null); void adminRequest<AdminList>({ action: 'list', entity, page, query: search }).then(result => { if (active && current === requestVersion.current) setData(result); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [entity, page, search, version]);
  async function inspect(row: AdminRow) { setLoadingGroup(true); setError(''); try { const result = await adminRequest<Group>({ action: 'group', groupId: row.id }); if (alive.current) setGroup(result); } catch (e) { if (alive.current) setError((e as Error).message); } finally { if (alive.current) setLoadingGroup(false); } }
  async function reissue() { if (!selected || rotating) return; setRotating(true); setError(''); try { const result = await adminRequest<{ token: string; expiresAt: string; username: string }>({ action: 'reissue-token', profileId: selected.profileId }); if (alive.current) { setToken(result); setSelected(null); setCopied(false); setVersion(v => v + 1); } } catch (e) { if (alive.current) setError((e as Error).message); } finally { if (alive.current) setRotating(false); } }
  const tabNames: Record<Entity, string> = { users: 'Users', groups: 'Groups', claims: 'Recovery & claims', audit: 'Admin activity' };
  return <>
    <div className="page-heading">
      <div>
        <div className="eyebrow">SERVER-AUTHORIZED ADMINISTRATION</div>
        <h1>Admin workspace.</h1>
        <p>Users, group ledgers and controlled account recovery.</p>
      </div>
      <button type="button" className="button" disabled={loading} onClick={() => setVersion(v => v + 1)}>
        <RefreshCw size={16} />Refresh</button>
    </div>
    <div className="admin-note">
      <ShieldCheck size={18} />
      <p>Access is checked against the verified Auth email on every server request. Existing tokens are one-way hashes. Reissuing creates a new 24-hour token and revokes the previous one.</p>
    </div>
    <div className="tabs admin-tabs" role="group" aria-label="Admin sections">{(Object.keys(tabNames) as Entity[]).map(key =>
      <button type="button" key={key} aria-pressed={entity === key} className={entity === key ? 'selected' : ''} onClick={() => { setEntity(key); setPage(1); setQuery(''); setSearch(''); }}>{tabNames[key]}</button>)}</div>
    <form className="admin-search" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}>
      <label className="search-box">
        <Search size={17} />
        <input aria-label="Search admin records" maxLength={100} placeholder={entity === 'users' ? 'Search name, username or email…' : 'Search records…'} value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      <button className="button" type="submit">Search</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="panel admin-panel" aria-busy={loading}>
      <div className="panel-heading">
        <h2>{tabNames[entity]}</h2>
        <span className="subtle-label">{loading ? 'Checking server…' : `${data?.total ?? 0} records`}</span>
      </div>
      {loading ? <p className="helper admin-loading" role="status">Loading authorized server records…</p> : !data?.items.length ? <Empty title="No matching records" detail="Try another search or section." /> : <div className="admin-records">{data.items.map((row, index) =>
        <article className="admin-record" key={String(row.profileId || row.authId || row.id || index)}>
          {entity === 'users' ? <>
            <div>
              <strong>{label(row.name || row.email || 'Auth user without a profile')}</strong>
              <span>@{label(row.username)}</span>
            </div>
            <dl>
              <dt>Email</dt>
              <dd>{label(row.email)}</dd>
              <dt>Profile ID</dt>
              <dd>{label(row.profileId)}</dd>
              <dt>Auth ID</dt>
              <dd>{label(row.authId)}</dd>
              <dt>Account</dt>
              <dd>{!row.authId ? 'Ghost profile' : row.anonymous ? 'Anonymous' : row.emailConfirmed ? 'Verified email' : 'Email unconfirmed'}</dd>
              <dt>Password</dt>
              <dd>{row.hasPassword ? 'Set' : 'Not set'}</dd>
            </dl>{!!row.recoverable && <button type="button" className="button small-button" onClick={() => setSelected(row)}>Reissue recovery token</button>}</> : entity === 'groups' ? <>
              <div>
                <strong>{label(row.name)}</strong>
                <span>{label(row.currency)} · {label(row.expenseCount)} expenses</span>
              </div>
              <dl>
                <dt>Group ID</dt>
                <dd>{label(row.id)}</dd>
                <dt>Updated</dt>
                <dd>{when(row.updatedAt)}</dd>
                <dt>Members</dt>
                <dd>{Array.isArray(row.members) ? row.members.map((m: { name?: string }) => m.name).join(', ') : '—'}</dd>
              </dl>
              <button type="button" className="button small-button" disabled={loadingGroup} onClick={() => void inspect(row)}>View full ledger</button>
            </> : entity === 'claims' ? <>
              <div>
                <strong>@{label(row.username)}</strong>
                <span>{label(row.kind)} profile</span>
              </div>
              <dl>
                <dt>Token status</dt>
                <dd>{label(row.tokenStatus)}</dd>
                <dt>Expires</dt>
                <dd>{when(row.expiresAt)}</dd>
                <dt>Profile ID</dt>
                <dd>{label(row.profileId)}</dd>
              </dl>
              <button type="button" className="button small-button" disabled={!row.recoverable} onClick={() => setSelected(row)}>Reissue recovery token</button>
            </> : <>
            <div>
              <strong>{label(row.action).replaceAll('_', ' ').toLowerCase()}</strong>
              <span>{when(row.at)}</span>
            </div>
            <dl>
              <dt>Actor</dt>
              <dd>{label(row.actorEmail || row.actorId)}</dd>
              <dt>Profile</dt>
              <dd>@{label(row.username)}</dd>
            </dl>
          </>}
        </article>)}</div>}
      {data && data.total > 25 && <div className="admin-pagination">
        <button type="button" className="button small-button" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>
          <ArrowLeft size={14} />Previous</button>
        <span>Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
        <button type="button" className="button small-button" disabled={page * data.pageSize >= data.total || loading} onClick={() => setPage(p => p + 1)}>Next<ArrowRight size={14} />
        </button>
      </div>}
    </section>
    {selected && <Modal title="Reissue private recovery token?" close={() => { if (!rotating) setSelected(null); }}>
      <div className="form-stack">
        <p className="modal-intro">This invalidates any previous token for @{label(selected.username)}. For an anonymous account, redemption transfers the original profile and its group access to the new session, and the old session loses profile access.</p>
        <p className="helper">Verify the person’s ownership before sharing the new token privately. This action is logged. Verified or pending-email accounts cannot be recovered this way.</p>{error && <p className="form-error" role="alert">{error}</p>}<button type="button" className="button primary full" disabled={rotating} onClick={() => void reissue()}>{rotating ? 'Creating token…' : 'Reissue token'}</button>
      </div>
    </Modal>}
    {token && <Modal title="Private recovery token" close={() => setToken(null)}>
      <div className="form-stack">
        <p className="helper">Share only with the verified owner of @{token.username}. Shown once; it cannot be retrieved later. If lost, reissue another token.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="claim-box">
          <code>{token.token}</code>
          <small>Expires {when(token.expiresAt)}</small>
        </div>
        <button type="button" className="button" onClick={() => void navigator.clipboard.writeText(token.token).then(() => setCopied(true)).catch(() => setError('Copy the token manually from the dialog.'))}>
          <Copy size={16} />{copied ? 'Copied' : 'Copy token'}</button>
        <p className="helper">The owner opens a signed-out session, chooses their original username, expands “Recover an account”, and enters this token. Their existing group/expense profile is preserved. They should then add a verified email and password.</p>
      </div>
    </Modal>}
    {group && <Modal title={group.name} wide close={() => setGroup(null)}>
      <p className="helper">{group.members.map(m => m.name).join(' · ')}</p>
      <div className="admin-ledger">{group.expenses.map(e =>
        <div key={e.id}>
          <strong>{e.description}</strong>
          <span>{money(e.amount)} · {e.date}</span>
        </div>)}</div>
      <details>
        <summary>Full ledger and audit history</summary>
        <pre className="admin-json">{JSON.stringify(group, null, 2)}</pre>
      </details>
    </Modal>}
  </>;
}
