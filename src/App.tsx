import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Cloud, Download, FolderHeart, Home, Eye, EyeOff, Leaf, Link, LogOut, Menu, Plus, Search, Settings, ShieldCheck, Sparkles, Users, Wallet, WifiOff, X } from 'lucide-react';
import { registerSW } from './lib/pwa';
import { usePwaInstall, type InstallController } from './lib/install';
import { InstallButton, InstallPromotion } from './InstallApp';
import { supabase } from './lib/supabase';
import { securityStage, type AccountSecurity } from './lib/account-security';
import { EmailConfirmationRequired } from './lib/password';
const AdminPage = lazy(() => import('./AdminPage'));
import { useAdminAccess } from './lib/admin';
import { useLedger } from './lib/store';
import { ThemeToggle, ThemeSettings } from './ThemeControls';
import { Avatar, Amount, Empty, Field, Modal } from './components';
import ExpenseForm from './ExpenseForm';
import SplitDefaults from './SplitDefaults';
import SettlementCard from './SettlementCard';
import { balances, categories, categoryIcons, debts, exportCsv, lensAmount, money, localDate, restorableExpense, uid, type Expense, type Group, type Audit, type Member } from './lib/domain';
type Page = 'overview' | 'groups' | 'friends' | 'activity' | 'analytics' | 'settings' | 'admin';
type Dialog = 'expense' | 'group' | 'member' | 'settle' | 'detail' | 'help' | 'defaults' | null;
const groupSymbols: Record<string, string> = { trip: '🏖️', home: '🪴', food: '☕', couple: '💛', other: '✨' };
const navItems: {
  id: Page;
  label: string;
  icon: typeof Home;
}[] = [{ id: 'overview', label: 'Overview', icon: Home }, { id: 'groups', label: 'Your groups', icon: FolderHeart }, { id: 'friends', label: 'Friends', icon: Users }, { id: 'activity', label: 'Activity', icon: Clock3 }, { id: 'analytics', label: 'Insights', icon: BarChart3 }];
function download(name: string, text: string, type = 'text/csv') { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export default function App() {
  const ledger = useLedger();
  const { profile, groups, demo, online, pending } = ledger;
  const admin = useAdminAccess(profile?.id, demo);
  const [page, setPage] = useState<Page>(() => new URLSearchParams(window.location.search).get('account') === 'setup' ? 'settings' : 'overview');
  const [active, setActive] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [editing, setEditing] = useState<Expense | undefined>();
  const [detail, setDetail] = useState<{
    group: Group;
    expense: Expense;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useState('');
  const [mobile, setMobile] = useState(false);
  const [lens, setLens] = useState('consumption');
  const [period, setPeriod] = useState('all');
  const install = usePwaInstall();
  const [update, setUpdate] = useState<((reload?: boolean) => Promise<void>) | null>(null);
  useEffect(() => {
    const updateSW = registerSW({ onNeedRefresh() { setUpdate(() => updateSW); } });

  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const group = groups.find(g => g.id === active);
  const me = profile?.id || '';
  function notify(text: string) { setToast(text); }
  function navigate(p: Page) { setPage(p); setActive(null); setSearch(''); setMobile(false); }
  function openExpense() { setEditing(undefined); setDialog(groups.length ? 'expense' : 'group'); }
  function audit(g: Group, action: string, description: string, details: Partial<Audit> = {}) { return { ...g, audit: [{ id: uid(), at: new Date().toISOString(), actor: profile!.name, action, description, ...details }, ...g.audit] }; }
  function saveExpense(g: Group, e: Expense) {
    try {
      const old = g.expenses.find(x => x.id === e.id);
      ledger.commit(audit({ ...g, expenses: old ? g.expenses.map(x => x.id === e.id ? e : x) : [e, ...g.expenses] }, old ? 'Updated expense' : 'Added expense', old ? `${e.description}: ${money(old.amount)} → ${money(e.amount)}` : `${e.description} · ${money(e.amount)}`));
      setDialog(null);
      notify(e.splitType === 'SETTLEMENT' ? 'Payment recorded. Balances updated.' : old ? 'Expense updated. History saved.' : 'Expense added. A little less to keep track of.');
      return true;
    }
    catch (e) {
      ledger.setError((e as Error).message);
      return false;
    }
  }
  const selectedGroups = group ? [group] : groups;
  const totalNet = groups.reduce((a, g) => a + (balances(g)[me] || 0), 0);
  const receive = groups.reduce((a, g) => a + Math.max(0, balances(g)[me] || 0), 0);
  const owe = groups.reduce((a, g) => a + Math.max(0, -(balances(g)[me] || 0)), 0);
  const allExpenses = selectedGroups.flatMap(g => g.expenses.map(e => ({ g, e }))).sort((a, b) => b.e.date.localeCompare(a.e.date));
  const filtered = allExpenses.filter(({ e, g }) => (`${e.description} ${g.name} ${e.category}`.toLowerCase().includes(search.toLowerCase())) && (filter === 'all' || e.category === filter));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastView = useRef(`${page}:${active || 'all'}`);
  useLayoutEffect(() => {
    const view = `${page}:${active || 'all'}`;
    if (lastView.current === view) return;
    lastView.current = view;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const element = document.querySelector<HTMLElement>('.view-content');
    const animation = element?.animate?.([
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' });
    void animation?.finished.catch(() => { /* Navigation can supersede an in-flight reveal. */ });
    return () => animation?.cancel();
  }, [page, active]);
  if (!ledger.ready)
    return <div className="boot">
      <span className="brand-mark" aria-hidden="true">
        <img src="/icon.svg" alt="" />
      </span>
      <p>Making room for the good stuff…</p>
    </div>;
  if (!profile)
    return <Onboarding onStart={ledger.onboard} demo={ledger.startDemo} error={ledger.error} install={install} />;
  const greet = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const memberName = (g: Group, id: string) => g.members.find(m => m.id === id)?.name || 'Member';
  const exportData = () => { download('faircrumb-expenses.csv', exportCsv(selectedGroups)); notify('CSV exported. Yours, always.'); };
  return <div className="app-shell">
    <a href="#main" className="skip-link">Skip to content</a>
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('overview'); }}>
        <span className="brand-mark" aria-hidden="true">
          <img src="/icon.svg" alt="" />
        </span>faircrumb<span className="brand-dot">.</span>
      </a>
      <button type="button" className="mobile-close icon-button" onClick={() => setMobile(false)} aria-label="Close navigation">
        <X />
      </button>
      <div className="workspace-label">YOUR LITTLE CORNER</div>
      <nav aria-label="Main navigation">{navItems.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={`nav-item ${page === id && !group ? 'active' : ''}`} onClick={() => navigate(id)}>
        <Icon size={19} />{label}{id === 'groups' && <span className="nav-count">{groups.length}</span>}{id === 'analytics' && <span className="new-badge">FREE</span>}</button>)}{admin.allowed && <button type="button" className={`nav-item ${page === 'admin' ? 'active' : ''}`} onClick={() => navigate('admin')}>
          <ShieldCheck size={19} />Admin</button>}</nav>
      <div className="sidebar-line" />
      <div className="row spread workspace-label">
        <span>YOUR GROUPS</span>
        <button type="button" className="icon-button" aria-label="Create a group" onClick={() => setDialog('group')}>
          <Plus size={16} />
        </button>
      </div>
      <div className="sidebar-groups">{groups.slice(0, 5).map(g => <button type="button" key={g.id} className={`mini-group ${active === g.id ? 'selected' : ''}`} onClick={() => { setActive(g.id); setPage('groups'); setSearch(''); setMobile(false); }}>
        <span className={`mini-group-icon ${g.category}`}>{groupSymbols[g.category]}</span>
        <span>{g.name}</span>
      </button>)}</div>
      <div className="sidebar-bottom">
        <div className="free-note">
          <Leaf size={21} />
          <strong>Good times. Zero fees.</strong>
          <p>No daily limits. No premium.<br />Just your people.</p>
          <span>FREE FOREVER <Sparkles size={12} />
          </span>
        </div>
        <button type="button" className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>
          <Settings size={19} />Settings</button>
        <button type="button" className="profile-button" onClick={() => navigate('settings')}>
          <Avatar member={profile} />
          <span>
            <strong>{profile.name}</strong>
            <small>@{profile.username}</small>
          </span>
          <ChevronDown size={15} />
        </button>
      </div>
    </aside>{mobile && <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobile(false)} />}
    <div className="main-shell">
      <header className="topbar">
        <div className="row">
          <button type="button" className="icon-button mobile-menu" onClick={() => setMobile(true)} aria-label="Open navigation">
            <Menu />
          </button>
          <span className="breadcrumb">
            <span className="breadcrumb-root">Your space</span> <ChevronRight size={14} />
            <strong>{group ? group.name : navItems.find(i => i.id === page)?.label || (page === 'admin' ? 'Admin' : 'Settings')}</strong>
          </span>
        </div>
        <div className="row topbar-actions">
          <ThemeToggle />
          <InstallButton controller={install} compact />
          <span className={`sync-status ${!online ? 'offline' : ''}`}>{!online ? <WifiOff size={14} /> : <Cloud size={15} />}<span>{!online ? 'Offline' : demo ? 'Demo workspace' : pending.length ? `${pending.length} pending` : 'Cloud connected'}</span>
          </span>
          <span className="divider" />
          <button type="button" className="icon-button" aria-label="Help and keyboard shortcuts" onClick={() => setDialog('help')}>
            <CircleHelp size={19} />
          </button>
          <Avatar member={profile} small />
        </div>
      </header>
      <InstallPromotion controller={install} />
      {demo && <div className="demo-banner">
        <span>
          <Sparkles size={14} /> You’re exploring a demo. Changes stay on this device.</span>
        <button type="button" onClick={() => void ledger.signOut()}>Create your own space <ArrowRight size={14} />
        </button>
      </div>}
      {!online && <div className="status-banner">You're offline. Your changes are saved on this device{demo ? '.' : ' and will sync when you reconnect.'}</div>}
      {update && <div className="status-banner row spread">
        <span>A new version is ready.</span>
        <button type="button" className="text-button" disabled={pending.length > 0} onClick={() => void update(true)}>Update app</button>
      </div>}
      {ledger.error && <div className="error-banner" role="alert">
        <span>{ledger.error}</span>
        <button type="button" className="icon-button" aria-label="Dismiss error" onClick={() => ledger.setError('')}>
          <X size={16} />
        </button>
      </div>}
      {!demo && !ledger.security.checking && !ledger.security.hasPassword && <div className="account-reminder">
        <ShieldCheck size={16} />
        <span>{ledger.security.pendingEmail ? 'Confirm your email, then finish setting your password.' : 'This account is not yet protected with a password. Secure it before clearing browser data or changing devices.'}</span>
        <button type="button" className="text-button" onClick={() => navigate('settings')}>Secure account<ArrowRight size={14} />
        </button>
      </div>}
      <main id="main" className="main-content" data-view={`${page}:${active || 'all'}`}>
        <div className="view-content" key={`${page}:${active || 'all'}`}>
          {page === 'admin' ? (admin.allowed ? <Suspense fallback={<p className="helper" role="status">Opening admin workspace…</p>}>
            <AdminPage />
          </Suspense> : <div className="panel settings-panel">
            <h1>Admin access required</h1>
            <p className="helper">{admin.checking ? 'Checking your verified email with the server…' : admin.error || 'The server has not authorized this account.'}</p>
            <button type="button" className="button" onClick={() => void admin.check()}>Check access</button>
          </div>) : page === 'settings' ? <SettingsPage security={ledger.security} refreshAccount={ledger.refreshAccount} profile={profile} demo={demo} online={online} pending={pending.length} update={ledger.updateProfile} signOut={ledger.signOut} notify={notify} exportData={() => download('faircrumb-backup.json', JSON.stringify({ profile, groups }, null, 2), 'application/json')} reload={ledger.reloadCloud} install={install} /> : page === 'analytics' ? <>
            <PageHeading eyebrow="A LITTLE CLARITY GOES A LONG WAY" title="Your money, in perspective." subtitle="What you paid and what you actually spent. Finally, separate." actions={<>
              <button type="button" className="button" onClick={() => window.print()}>
                <Download size={16} /> Save PDF</button>
              <button type="button" className="button" onClick={exportData}>
                <ArrowDownToLine size={16} />Export CSV</button>
            </>} />
            <div className="insight-filters">
              <select aria-label="Insights group" value={active || ''} onChange={e => setActive(e.target.value || null)}>
                <option value="">All groups</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
              <select aria-label="Insights time period" value={period} onChange={e => setPeriod(e.target.value)}>
                <option value="all">All time</option>
                <option value="month">This month</option>
                <option value="week">Last 7 days</option>
              </select>
            </div>
            <div className="tabs lens-tabs">{[['consumption', 'My actual share'], ['cash', 'Out of pocket'], ['group', 'Group spending']].map(([id, label]) => <button type="button" key={id} className={lens === id ? 'selected' : ''} onClick={() => setLens(id)}>{label}</button>)}</div>
            <Analytics groups={selectedGroups} me={me} lens={lens} period={period} />
          </> : page === 'friends' ? <>
            <PageHeading eyebrow="MONEY COMES AND GOES. PEOPLE STAY." title="Your people." subtitle="A clear view of who owes what, one group at a time." />
            <section className="panel">
              <div className="panel-heading">
                <h2>Friends & balances</h2>
                <span className="subtle-label">Strictly within your groups</span>
              </div>{groups.length ? groups.map(g => <div className="friend-group" key={g.id}>
                <button type="button" className="text-button" onClick={() => { setActive(g.id); setPage('groups'); }}>{groupSymbols[g.category]} {g.name}<ChevronRight size={14} />
                </button>{debts(g).filter(d => d.from === me || d.to === me).map(d => {
                  const other = g.members.find(m => m.id === (d.from === me ? d.to : d.from))!; return <div className="friend-row" key={`${d.from}-${d.to}`}>
                    <Avatar member={other} />
                    <div className="grow">
                      <strong>{other.name}</strong>
                      <small>@{other.username}{other.ghost ? ' · unclaimed profile' : ''}</small>
                    </div>
                    <Amount value={d.to === me ? d.amount : -d.amount} />
                    <button type="button" className="button small-button" onClick={() => { setActive(g.id); setDialog('settle'); }}>Settle up</button>
                  </div>;
                })}{!debts(g).some(d => d.from === me || d.to === me) && <p className="helper">All square in this group. Feels good.</p>}</div>) : <Empty title="Better with friends" detail="Create a group and add your people to get started." action={<button type="button" className="button primary" onClick={() => setDialog('group')}>Create a group</button>} />}</section>
          </> : page === 'activity' ? <>
            <PageHeading eyebrow="EVERY CHANGE HAS A STORY" title="Nothing lost in the shuffle." subtitle="An honest trail of expenses, edits, and settlements." />
            <section className="panel">
              <div className="panel-heading">
                <h2>Activity log</h2>
                <ShieldCheck size={18} />
              </div>{groups.flatMap(g => g.audit.map(a => ({ ...a, group: g.name, groupId: g.id }))).sort((a, b) => b.at.localeCompare(a.at)).length ? groups.flatMap(g => g.audit.map(a => ({ ...a, group: g.name, groupId: g.id }))).sort((a, b) => b.at.localeCompare(a.at)).map(a => <div className="activity-row" key={a.id}>
                <span className="activity-dot">
                  <Check size={16} />
                </span>
                <div className="grow">
                  <strong>{a.actor} · {a.action.toLowerCase()}</strong>
                  <p>{a.description}</p>
                  <small>{a.group}</small>
                  {restorableExpense(groups.find(g => g.id === a.groupId)!, a) && <button type="button" className="text-button restore-button" onClick={() => { try { const latest = groups.find(g => g.id === a.groupId)!; const expense = restorableExpense(latest, a); if (!expense) return; ledger.commit(audit({ ...latest, expenses: [expense, ...latest.expenses] }, 'Restored expense', expense.description, { expenseId: expense.id, after: expense })); notify('Expense restored. Balances recalculated.'); } catch (e) { ledger.setError((e as Error).message); } }}>Restore expense</button>}
                </div>
                <time>{new Date(a.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time>
              </div>) : <Empty title="A fresh start" detail="Every expense you add, edit, or delete will appear here." />}</section>
          </> : <>
            {group ? <>
              <button type="button" className="back-button" onClick={() => setActive(null)}>
                <ArrowLeft size={15} /> All groups</button>
              <PageHeading eyebrow={`${group.members.length} PEOPLE · ${group.currency} · ${group.category.toUpperCase()}`} title={group.name} subtitle="The memories are shared. The maths is handled." actions={<>
                <button type="button" className="button" onClick={() => setDialog('member')}>
                  <Users size={16} />Add people</button>
                <button type="button" className="button primary" onClick={openExpense}>
                  <Plus size={18} />Add expense</button>
              </>} />
              <div className="group-members">{group.members.map(m => <span className="member-chip" key={m.id}>
                <Avatar member={m} small />{m.id === me ? 'You' : m.name.split(' ')[0]}{m.ghost && <span className="ghost-label">unclaimed</span>}</span>)}<button type="button" className="text-button" onClick={() => setDialog('settle')}>Simplify & settle <ArrowUpRight size={15} />
                </button>
              </div>
            </> : <PageHeading eyebrow={`${greet.toUpperCase()}, ${profile.name.split(' ')[0].toUpperCase()} ☀`} title={page === 'groups' ? 'Good company. Shared tabs.' : 'Less figuring. More living.'} subtitle={page === 'groups' ? 'Trips, homes, and everything you do together.' : 'All your shared expenses, with a little breathing room.'} actions={<>
              <button type="button" className="button" onClick={() => setDialog('group')}>
                <Plus size={17} />New group</button>
              <button type="button" className="button primary" onClick={openExpense}>
                <Plus size={18} />Add expense</button>
            </>} />}
            <div className="balance-grid">
              <div className="balance-card net">
                <div className="row spread">
                  <span>{group ? 'Your group balance' : 'Your total balance'}</span>
                  <span className="balance-symbol">
                    <Wallet size={19} />
                  </span>
                </div>
                <div className="balance-number">{money(group ? balances(group)[me] || 0 : totalNet)}</div>
                <div className="row balance-foot">
                  <span className="tiny-dot" />{(group ? balances(group)[me] || 0 : totalNet) >= 0 ? 'Looking good. You’re owed overall.' : 'A little to square up with your people.'}</div>
                <svg className="balance-squiggle" viewBox="0 0 180 70" aria-hidden="true">
                  <path d="M0 60 Q30 5 55 40 T100 22 T145 12 T180 0" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>
              <div className="balance-card">
                <div className="row spread">
                  <span>You are owed</span>
                  <span className="balance-symbol green">
                    <ArrowDownLeft size={20} />
                  </span>
                </div>
                <div className="balance-number positive">{money(group ? Math.max(0, balances(group)[me] || 0) : receive)}</div>
                <div className="balance-foot">A few friendly IOUs <span className="mini-arrow">↙</span>
                </div>
              </div>
              <div className="balance-card">
                <div className="row spread">
                  <span>You owe</span>
                  <span className="balance-symbol peach">
                    <ArrowUpRight size={20} />
                  </span>
                </div>
                <div className="balance-number negative">{money(group ? Math.max(0, -(balances(group)[me] || 0)) : owe)}</div>
                <button type="button" className="balance-foot text-button" onClick={() => { setDialog('settle'); }}>Let’s square things up <ArrowRight size={14} />
                </button>
              </div>
            </div>
            {!group && <section className="groups-section">
              <div className="section-heading">
                <div className="row">
                  <h2>Your groups</h2>
                  <span className="count-pill">{groups.length}</span>
                </div>
                <button type="button" className="text-button" onClick={() => setDialog('group')}>Create a group <Plus size={15} />
                </button>
              </div>{groups.length ? <div className="group-grid">{groups.map(g => <button type="button" className={`group-card ${g.category}`} key={g.id} onClick={() => { setActive(g.id); setPage('groups'); setSearch(''); }}>
                <div className="group-cover">
                  <span>{groupSymbols[g.category] || '✨'}</span>
                  <span className="group-category">{g.category === 'trip' ? 'A LITTLE ADVENTURE' : g.category === 'home' ? 'HOME, SWEET HOME' : 'THE EVERYDAY GOOD'}</span>
                  <ArrowUpRight size={17} />
                </div>
                <div className="group-card-body">
                  <h3>{g.name}</h3>
                  <p>{g.members.length} people <span>·</span> {g.expenses.filter(e => e.splitType !== 'SETTLEMENT').length} expenses</p>
                  <div className="row spread group-card-footer">
                    <div className="avatar-stack">{g.members.slice(0, 4).map(m => <Avatar key={m.id} member={m} small />)}</div>
                    <Amount value={balances(g)[me] || 0} />
                  </div>
                </div>
              </button>)}</div> : <Empty title="Make room for your people" detail="Start with your next trip, your apartment, or just dinner." action={<button type="button" className="button primary" onClick={() => setDialog('group')}>
                <Plus size={16} /> Create your first group</button>} />}</section>}
            {group && <div className="group-toolbar">
              <button type="button" className="button" onClick={() => setDialog('defaults')}>
                <Settings size={16} />Split defaults</button>
              <button type="button" className="button" onClick={() => setDialog('settle')}>
                <ArrowRight size={16} /> Settle up</button>
              <button type="button" className="button" onClick={() => setPage('analytics')}>
                <BarChart3 size={16} /> Group insights</button>
              <button type="button" className="button" onClick={exportData}>
                <Download size={16} /> CSV</button>
              <button type="button" className="button" onClick={() => window.print()}>
                <Download size={16} /> PDF / Print</button>
            </div>}
            <div className="content-columns">
              <section className="panel expense-panel">
                <div className="panel-heading">
                  <h2>{group ? 'Group expenses' : 'Recent expenses'}</h2>
                  <span className="subtle-label">{allExpenses.length} total</span>
                </div>
                <div className="expense-controls">
                  <label className="search-box">
                    <Search size={16} />
                    <input aria-label="Search expenses" placeholder="Find an expense…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}>
                      <X size={14} />
                    </button>}</label>
                  <select aria-label="Filter by category" value={filter} onChange={e => setFilter(e.target.value)}>
                    <option value="all">All categories</option>{[...categories, 'Settlement'].map(c => <option key={c}>{c}</option>)}</select>
                </div>
                <div className="expense-table">
                  <div className="table-labels">
                    <span>EXPENSE</span>
                    <span>AMOUNT</span>
                    <span>YOUR SHARE</span>
                  </div>{filtered.length ? filtered.slice(0, page === 'overview' && !group ? 6 : 1000).map(({ g, e }) => {
                    const share = e.splits.find(s => s.memberId === me); return <button type="button" className="expense-row" key={e.id} onClick={() => { setDetail({ group: g, expense: e }); setConfirmDelete(false); setDialog('detail'); }}>
                      <span className="expense-main">
                        <span className={`category-icon cat-${e.category.split(' ')[0].toLowerCase()}`}>{categoryIcons[e.category] || '🧾'}</span>
                        <span className="expense-description">
                          <strong>{e.description}</strong>
                          <small>{group ? e.category : g.name}<span>·</span>{new Date(e.date + 'T12:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</small>
                        </span>
                      </span>
                      <span className="expense-total">
                        <strong>{money(e.amount)}</strong>
                        <small>{e.splits.filter(s => s.paid > 0).length > 1 ? 'Multiple payers' : `${memberName(g, e.splits.find(s => s.paid > 0)?.memberId || '').split(' ')[0]} paid`}</small>
                      </span>
                      <span className={`expense-share ${e.splitType === 'SETTLEMENT' ? 'positive' : ''}`}>
                        <strong>{e.splitType === 'SETTLEMENT' ? 'Settled' : money(share?.owed || 0)}</strong>
                        <small>{e.excluded ? 'excluded from stats' : e.splitType === 'SETTLEMENT' ? 'payment recorded' : e.splitType === 'EQUAL' ? 'split equally' : 'custom split'}</small>
                      </span>
                    </button>;
                  }) : <Empty title={search || filter !== 'all' ? 'No matching expenses' : 'The first one’s on the board'} detail={search || filter !== 'all' ? 'Try another search or category.' : 'Add a shared expense. We’ll handle who owes what.'} action={!search && filter === 'all' ? <button type="button" className="button" onClick={openExpense}>Add an expense <Plus size={15} />
                  </button> : undefined} />}</div>{filtered.length > 6 && page === 'overview' && !group && <button type="button" className="panel-bottom-link" onClick={() => setPage('groups')}>View all expenses <ArrowRight size={14} />
                  </button>}</section>
              <aside className="insights-rail">
                <section className="panel quick-insight">
                  <div className="panel-heading">
                    <h2>A little insight</h2>
                    <span className="insight-icon">
                      <BarChart3 size={16} />
                    </span>
                  </div>
                  <div className="insight-content">
                    <span className="subtle-label">YOUR ACTUAL SHARE · ALL TIME</span>
                    <h3>{money(selectedGroups.reduce((a, g) => a + g.expenses.reduce((s, e) => s + lensAmount(e, 'consumption', me), 0), 0))}</h3>
                    <p>What you consumed,<br />whoever picked up the tab.</p>
                    <MiniCategories groups={selectedGroups} me={me} />
                  </div>
                  <button type="button" className="panel-bottom-link" onClick={() => setPage('analytics')}>Explore your insights <ArrowUpRight size={15} />
                  </button>
                </section>
                <div className="gentle-note">
                  <span>✳</span>
                  <div>
                    <strong>Split the bill.<br />Keep the good vibes.</strong>
                    <p>Every feature is free.<br />That’s the whole idea.</p>
                  </div>
                </div>
              </aside>
            </div>
          </>}
        </div>
        <footer className="page-footer">
          <span>
            <Leaf size={13} /> A little less owing. A lot more living.</span>
          <span>Made for your people. Free for everyone.</span>
        </footer>
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Mobile navigation">{navItems.filter(i => i.id !== 'activity').map(({ id, label, icon: Icon }) => <button type="button" key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}>
      <Icon size={20} />
      <span>{label === 'Your groups' ? 'Groups' : label}</span>
    </button>)}<button type="button" className="mobile-add" aria-label="Add expense" onClick={openExpense}>
        <Plus size={23} />
      </button>
    </nav>
    {dialog === 'expense' && <Modal title={editing ? 'Edit expense' : 'Add a shared expense'} close={() => setDialog(null)}>
      <ExpenseForm key={editing?.id || active || 'new'} groups={groups} initialGroup={active || groups[0]?.id || ''} me={me} existing={editing} onSave={saveExpense} upload={!demo && online ? ledger.uploadReceipt : undefined} />
    </Modal>}
    {dialog === 'group' && <Modal title="Good things start with a group." close={() => setDialog(null)}>
      <CreateGroup me={profile} onSave={g => { ledger.commit(g); setActive(g.id); setPage('groups'); setDialog('member'); notify('Your group is ready. Add your people.'); }} />
    </Modal>}
    {dialog === 'defaults' && group && <Modal title="Your usual split, remembered." close={() => setDialog(null)}>
      <SplitDefaults group={group} save={value => { ledger.commit(audit({ ...group, defaultSplit: value }, 'Updated split defaults', group.name)); setDialog(null); notify('Default split saved for future expenses.'); }} />
    </Modal>}
    {dialog === 'member' && group && <Modal title="Bring your people along." close={() => setDialog(null)}>
      <AddMember group={group} find={ledger.addFriend} save={member => { ledger.commit(audit({ ...group, members: [...group.members, member] }, 'Added member', member.name)); notify(group.defaultSplit ? `${member.name} is in. Update split defaults to include them.` : `${member.name} is in.`); }} />
    </Modal>}
    {dialog === 'settle' && <Modal title="A clean slate feels good." close={() => setDialog(null)}>
      <p className="modal-intro">Simplified within each group. Record a payment only after the money has been sent.</p>{selectedGroups.some(g => debts(g).length) ? selectedGroups.flatMap(g => debts(g).map(d =>
        <SettlementCard key={`${g.id}-${d.from}-${d.to}`} group={g} debt={d} me={me} save={saveExpense} />)) : <Empty title="All square!" detail="No payments needed. Go make some new memories." />}</Modal>}
    {dialog === 'detail' && detail && <Modal title="The little details." close={() => setDialog(null)}>
      <div className="expense-detail">
        <span className="detail-emoji">{categoryIcons[detail.expense.category]}</span>
        <h3>{detail.expense.description}</h3>
        <div className="detail-amount">{money(detail.expense.amount)}</div>
        <p>{detail.group.name} · {new Date(detail.expense.date + 'T12:00:00').toLocaleDateString('en-IN', { dateStyle: 'long' })}</p>
        <span className="tag">{detail.expense.splitType.toLowerCase()} split{detail.expense.excluded ? ' · excluded from insights' : ''}</span>
      </div>
      <div className="detail-splits">
        <div className="row spread muted">
          <span>PERSON</span>
          <span>PAID / SHARE</span>
        </div>{detail.expense.splits.map(s => {
          const m = detail.group.members.find(m => m.id === s.memberId)!; return <div className="row spread" key={s.memberId}>
            <span className="row">
              <Avatar member={m} small />{m.name}</span>
            <span>{money(s.paid)} <span className="muted">/ {money(s.owed)}</span>
            </span>
          </div>;
        })}</div>{detail.expense.splitType !== 'SETTLEMENT' && <div className="row">
          <button type="button" className="button grow" onClick={() => { setActive(detail.group.id); setEditing(detail.expense); setDialog('expense'); }}>Edit expense</button>
          <button type="button" className="button danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>}{detail.expense.splitType === 'SETTLEMENT' && detail.expense.splits.some(s => s.memberId === me && (s.paid > 0 || s.owed > 0)) && <button type="button" className="button danger full" onClick={() => setConfirmDelete(true)}>Undo payment record</button>}{confirmDelete && <div className="delete-confirm">
          <p>{detail.expense.splitType === 'SETTLEMENT' ? 'Undo this payment record? The debt returns. This does not refund or reverse any real transfer.' : 'Delete this expense? Balances will update. You can restore it from Activity.'}</p>
          <button type="button" className="button danger" onClick={() => { const latest = groups.find(g => g.id === detail.group.id)!; ledger.commit(audit({ ...latest, expenses: latest.expenses.filter(e => e.id !== detail.expense.id) }, detail.expense.splitType === 'SETTLEMENT' ? 'Reversed payment' : 'Deleted expense', `${detail.expense.description} · ${money(detail.expense.amount)}`, { expenseId: detail.expense.id, before: detail.expense })); setDialog(null); notify(detail.expense.splitType === 'SETTLEMENT' ? 'Payment record undone. No money was moved.' : 'Expense deleted. Restore it from Activity.'); }}>{detail.expense.splitType === 'SETTLEMENT' ? 'Yes, undo record' : 'Yes, delete expense'}</button>
          <button type="button" className="text-button" onClick={() => setConfirmDelete(false)}>Keep it</button>
        </div>}{detail.expense.receipt && <ReceiptLink path={detail.expense.receipt} />}<h4>Group history</h4>{detail.group.audit.filter(a => (a.expenseId === detail.expense.id || (!a.expenseId && a.description.includes(detail.expense.description)))).map(a => <p className="helper" key={a.id}>{a.actor} · {a.action} · {new Date(a.at).toLocaleString()}<br />{a.description}</p>)}{!detail.group.audit.some(a => (a.expenseId === detail.expense.id || (!a.expenseId && a.description.includes(detail.expense.description)))) && <p className="helper">No recorded edits for this expense.</p>}</Modal>}
    {dialog === 'help' && <Modal title="A little help." close={() => setDialog(null)}>
      <div className="help-content">
        <h3>Shared expenses, without the strings.</h3>
        <p>Create a group, add friends by username, and start adding expenses. Choose equal, exact, percentage, shares, or item-based splits.</p>
        <h4>Actual share vs. out of pocket</h4>
        <p>Your share is what you consumed. Out of pocket is what you paid, including settlements. Personal transfers stay out of consumption charts.</p>
        <h4>Offline & sync</h4>
        <p>The app works offline after your first visit. Cloud changes queue on this device. Keep the app open after reconnecting until pending changes finish. Conflicts are shown in Settings.</p>
        <h4>Keep your account</h4>
        <p>Anonymous accounts live in your browser. Add your email and set a password in Settings before clearing site data or switching devices. Keep ghost claim tokens private.</p>
        <h4>Install on your phone</h4>
        <p>Add faircrumb to your home screen for easy access.</p>
        <InstallButton controller={install} />
      </div>
    </Modal>}
    {toast && <div className="toast" role="status">
      <Check size={17} />{toast}</div>}
  </div>;
}
function PageHeading({ eyebrow, title, subtitle, actions }: {
  eyebrow: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return <div className="page-heading">
    <div>
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}
function Onboarding({ onStart, demo, error, install }: {
  install: InstallController;
  onStart: (name: string, user: string, claim: string, password: string, login: boolean) => Promise<void>;
  demo: () => void;
  error: string;
}) {
  const [login, setLogin] = useState(false);
  const [name, setName] = useState('');
  const [user, setUser] = useState('');
  const [claim, setClaim] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState(error);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setIssue('');
    try {
      await onStart(name.trim(), user.toLowerCase().replace(/^@/, ''), claim, password, login);
    }
    catch (e) {
      setIssue((e as Error).message);
    }
    finally {
      setBusy(false);
    }
  }
  return <main className="welcome">
    <div className="welcome-story">
      <a href="#" className="brand">
        <span className="brand-mark" aria-hidden="true">
          <img src="/icon.svg" alt="" />
        </span>faircrumb.</a>
      <div className="welcome-copy">
        <div className="eyebrow">LESS OWING. MORE LIVING.</div>
        <h1>For the trips.<br />The dinners.<br />
          <em>Your people.</em>
        </h1>
        <p>Split the expenses, keep the memories.<br />No subscriptions. No awkward maths.</p>
        <div className="welcome-illustration">
          <span>🏝️</span>
          <div>
            <span>GOOD COMPANY</span>
            <strong>Priceless.</strong>
            <small>The rest? We’ll split it.</small>
          </div>
          <span className="illustration-star">✳</span>
        </div>
        <div className="welcome-features">
          <span>
            <Check size={16} />Unlimited expenses</span>
          <span>
            <Check size={16} />Every insight, free</span>
          <span>
            <Check size={16} />Works offline</span>
        </div>
      </div>
      <small>Built for friends. Free for everyone.</small>
    </div>
    <div className="welcome-form">
      <div className="welcome-appearance">
        <ThemeToggle />
      </div>
      <div className="onboarding-card">
        <InstallPromotion controller={install} />
        <span className="pill">
          <Leaf size={13} /> A LITTLE LESS FRICTION</span>
        <h2>{login ? 'Welcome back.' : 'Make yourself at home.'}</h2>
        <p>{login ? 'Your people and your tabs are right where you left them.' : 'A name, a username, and you’re in. No email needed.'}</p>
        <form className="form-stack" onSubmit={submit}>{!login && <Field label="Your name">
          <input autoComplete="name" placeholder="Alex Morgan" maxLength={60} required value={name} onChange={e => setName(e.target.value)} />
        </Field>}<Field label={login ? "Email or legacy username" : "Your username"} hint={login ? "Use the email you added in Settings. Older username-only accounts can still use their username." : "3–24 characters. Letters, numbers, and underscores."}>
            <div className="username-input">
              <span>{login ? '↗' : '@'}</span>
              <input autoComplete="username" pattern={login ? undefined : "@?[a-zA-Z0-9_]{3,24}"} placeholder={login ? "you@example.com" : "alex"} required value={user} onChange={e => setUser(e.target.value)} />
            </div>
          </Field>{login ? <Field label="Password">
            <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
          </Field> : <details>
            <summary>Recover an account or claim a friend’s profile</summary>
            <Field label="Private claim or recovery token">
              <input value={claim} onChange={e => setClaim(e.target.value)} autoComplete="off" />
            </Field>
          </details>}{issue && <p className="form-error" role="alert">{issue}</p>}<button type="submit" className="button primary full" disabled={busy}>{busy ? 'Getting things ready…' : login ? 'Welcome back' : 'Let’s get started'}<ArrowRight size={17} />
          </button>
        </form>
        <button type="button" className="onboarding-switch text-button" onClick={() => { setLogin(!login); setIssue(''); }}>{login ? 'New here? Create a space' : 'Already have a password? Sign in'}</button>
        <div className="or-line">
          <span>or take a look around</span>
        </div>
        <button type="button" className="button full" onClick={demo}>Explore the demo <ArrowUpRight size={16} />
        </button>
        <p className="onboarding-foot">
          <ShieldCheck size={14} /> Your expenses are your business. Always.</p>
      </div>
    </div>
  </main>;
}
function CreateGroup({ me, onSave }: {
  me: Member;
  onSave: (g: Group) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('trip');
  return <form className="form-stack" onSubmit={e => {
    e.preventDefault();
    if (name.trim())
      onSave({ id: uid(), name: name.trim(), category, currency: 'INR', members: [me], expenses: [], audit: [], revision: 0 });
  }}>
    <p className="modal-intro">For a big adventure or the everyday little things.</p>
    <Field label="Group name">
      <input required maxLength={80} autoFocus placeholder="A weekend worth remembering" value={name} onChange={e => setName(e.target.value)} />
    </Field>
    <Field label="What brings you together?">
      <select value={category} onChange={e => setCategory(e.target.value)}>{Object.entries(groupSymbols).map(([id, s]) => <option key={id} value={id}>{s} {id[0].toUpperCase() + id.slice(1)}</option>)}</select>
    </Field>
    <Field label="Currency">
      <select disabled>
        <option>INR · Indian rupee (₹)</option>
      </select>
    </Field>
    <p className="helper">Groups keep their own balances. No cross-group surprises.</p>
    <button type="submit" className="button primary full">Create group <Plus size={16} />
    </button>
  </form>;
}
function AddMember({ group, find, save }: {
  group: Group;
  find: (user: string, name: string) => Promise<{
    member: Member;
    claim: string | null;
  }>;
  save: (m: Member) => void;
}) {
  const [user, setUser] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  return <form className="form-stack" onSubmit={async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (group.members.some(m => m.username === user.toLowerCase().replace(/^@/, '')))
        throw new Error('They’re already in this group.');
      const result = await find(user.toLowerCase().replace(/^@/, ''), name.trim());
      save(result.member);
      setToken(result.claim || '');
      setUser('');
      setName('');
    }
    catch (e) {
      setError((e as Error).message);
    }
    finally {
      setBusy(false);
    }
  }}>
    <p className="modal-intro">Use an existing @username, or create an unclaimed profile. They can join later with the private claim token.</p>
    <Field label="Username">
      <input required pattern="@?[a-zA-Z0-9_]{3,24}" placeholder="@priya" value={user} onChange={e => setUser(e.target.value)} />
    </Field>
    <Field label="Name (for a new profile)">
      <input placeholder="Priya Shah" maxLength={60} value={name} onChange={e => setName(e.target.value)} />
    </Field>{error && <p className="form-error" role="alert">{error}</p>}{token && <div className="claim-box">
      <strong>Share this privately with your friend</strong>
      <p>Save it now. This token is only shown once.</p>
      <code>{token}</code>
      <button className="button small-button" type="button" onClick={() => void navigator.clipboard.writeText(token).catch(() => setError('Copy the token manually from the text above.'))}>
        <Link size={14} />Copy token</button>
    </div>}<button type="submit" className="button primary full" disabled={busy}>{busy ? 'Finding your friend…' : 'Add to group'}<Plus size={16} />
    </button>
  </form>;
}
function MiniCategories({ groups, me }: {
  groups: Group[];
  me: string;
}) {
  const totals = categories.map(c => ({ name: c, amount: groups.reduce((a, g) => a + g.expenses.filter(e => e.category === c).reduce((s, e) => s + lensAmount(e, 'consumption', me), 0), 0) })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount); const total = totals.reduce((a, c) => a + c.amount, 0); return <>
    <div className="stacked-bar" role="img" aria-label={totals.map(c => `${c.name}: ${money(c.amount)}`).join(', ') || 'No spending yet'}>{totals.map((c, i) => <span key={c.name} style={{ width: `${c.amount / total * 100}%`, background: `var(--chart-${i % 7})` }} />)}</div>
    <div className="category-legend">{totals.slice(0, 3).map((c, i) => <div className="row spread" key={c.name}>
      <span className="row">
        <i style={{ background: `var(--chart-${i})` }} />{c.name}</span>
      <strong>{Math.round(c.amount / total * 100)}%</strong>
    </div>)}</div>
  </>;
}
function Analytics({ groups, me, lens, period }: {
  groups: Group[];
  me: string;
  lens: string;
  period: string;
}) {
  const now = new Date(); const expenses = groups.flatMap(g => g.expenses).filter(e => period === 'all' || (period === 'month' ? e.date.startsWith(localDate(now).slice(0, 7)) : new Date(e.date + 'T12:00:00').getTime() >= now.getTime() - 7 * 86400000)); const total = expenses.reduce((s, e) => s + lensAmount(e, lens, me), 0); const cats = [...categories, 'Settlement'].map(c => ({ name: c, amount: expenses.filter(e => e.category === c).reduce((s, e) => s + lensAmount(e, lens, me), 0) })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount); let angle = 0; const gradient = cats.map((c, i) => { const start = angle; angle += c.amount / total * 360; return `var(--chart-${i % 7}) ${start}deg ${angle}deg`; }).join(','); const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); const date = localDate(d); return { date, label: d.toLocaleDateString('en-IN', { weekday: 'short' }), amount: expenses.filter(e => e.date === date).reduce((s, e) => s + lensAmount(e, lens, me), 0) }; }); const maxDay = Math.max(1, ...days.map(d => d.amount)); const members = Array.from(new Map(groups.flatMap(g => g.members).map(m => [m.id, m])).values()).map(m => ({ m, paid: expenses.reduce((a, e) => a + (e.splits.find(s => s.memberId === m.id)?.paid || 0), 0), owed: expenses.filter(e => !e.excluded && e.splitType !== 'SETTLEMENT').reduce((a, e) => a + (e.splits.find(s => s.memberId === m.id)?.owed || 0), 0) })); const maxMember = Math.max(1, ...members.flatMap(m => [m.paid, m.owed])); const months = Array.from({ length: 6 }, (_, i) => { const date = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1); const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; return { label: date.toLocaleDateString('en-IN', { month: 'short' }), amount: expenses.filter(e => e.date.startsWith(key)).reduce((a, e) => a + lensAmount(e, lens, me), 0) }; }); const maxMonth = Math.max(1, ...months.map(m => m.amount)); return <>
    <div className="analytics-summary">
      <span>{lens === 'cash' ? 'Your out-of-pocket payments' : lens === 'group' ? 'Total shared spending' : 'Your true consumption'}</span>
      <strong>{money(total)}</strong>
      <p>{lens === 'cash' ? 'Includes settlements: money that left your pocket.' : 'Settlements and excluded transfers are left out.'}</p>
    </div>
    <div className="analytics-grid">
      <section className="panel">
        <div className="panel-heading">
          <h2>Where it went</h2>
          <span className="subtle-label">BY CATEGORY</span>
        </div>
        <div className="donut-layout">
          <div className="donut" style={{ background: total ? `conic-gradient(${gradient})` : 'var(--line)' }} role="img" aria-label={`Category breakdown. ${cats.map(c => `${c.name} ${money(c.amount)}`).join(', ')}`}>
            <div>
              <small>TOTAL SPEND</small>
              <strong>{money(total)}</strong>
            </div>
          </div>
          <div className="donut-legend">{cats.length ? cats.map((c, i) => <div className="row spread" key={c.name}>
            <span className="row">
              <i style={{ background: `var(--chart-${i % 7})` }} />{c.name}</span>
            <strong>{money(c.amount)}</strong>
          </div>) : <p className="helper">Your next shared expense starts the story.</p>}</div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>The daily picture</h2>
          <span className="subtle-label">LAST 7 DAYS</span>
        </div>
        <div className="bar-chart">{days.map(d => <div className="bar-column" key={d.date}>
          <span>{money(d.amount)}</span>
          <div className="bar-track">
            <div style={{ height: `${d.amount / maxDay * 100}%` }} />
          </div>
          <small>{d.label}</small>
        </div>)}</div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Paid vs. consumed</h2>
          <span className="row chart-key">
            <i />Paid<i />Share</span>
        </div>
        <div className="member-chart">{members.map(({ m, paid, owed }) => <div key={m.id}>
          <div className="row spread">
            <strong>{m.id === me ? 'You' : m.name}</strong>
            <small>{money(paid)} / {money(owed)}</small>
          </div>
          <div className="horizontal-bar" aria-label={`${m.name} paid ${money(paid)}, consumed ${money(owed)}`}>
            <div style={{ width: `${paid / maxMember * 100}%` }} />
            <div style={{ width: `${owed / maxMember * 100}%` }} />
          </div>
        </div>)}</div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>A longer view</h2>
          <span className="subtle-label">6 MONTHS</span>
        </div>
        <div className="trend-chart">
          <svg viewBox="0 0 500 150" role="img" aria-label={months.map(m => `${m.label}: ${money(m.amount)}`).join(', ')}>
            <path d={`M ${months.map((m, i) => `${10 + i * 96} ${135 - m.amount / maxMonth * 115}`).join(' L ')}`} fill="none" stroke="var(--green)" strokeWidth="3" />{months.map((m, i) => <circle key={m.label} cx={10 + i * 96} cy={135 - m.amount / maxMonth * 115} r="4" fill="var(--green)" />)}</svg>
          <div className="row spread">{months.map(m => <span key={m.label} title={money(m.amount)}>{m.label}<small>{money(m.amount)}</small>
          </span>)}</div>
        </div>
      </section>
    </div>
  </>;
}
function SettingsPage({ security, refreshAccount, profile, demo, online, pending, update, signOut, notify, exportData, reload, install }: {
  security: AccountSecurity;
  refreshAccount: () => Promise<void>;
  profile: Member & {
    hasPassword?: boolean;
  };
  demo: boolean;
  online: boolean;
  pending: number;
  update: (n: string, u: string, p: string, email?: string) => Promise<void>;
  signOut: () => Promise<void>;
  notify: (s: string) => void;
  exportData: () => void;
  reload: () => Promise<void>;
  install: InstallController;
}) {
  const [name, setName] = useState(profile.name);
  const [upi, setUpi] = useState(profile.upi || '');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const stage = demo ? (profile.hasPassword ? 'secured' : 'start') : securityStage(security, profile.hasPassword);
  const secured = stage === 'secured';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  async function run(action: () => Promise<void>) {
    setError('');
    setConfirmation('');
    setBusy(true);
    try {
      await action();
    }
    catch (e) {
      if (e instanceof EmailConfirmationRequired) { setConfirmation(e.message); setPassword(''); setPasswordVisible(false); }
      else setError((e as Error).message);
    }
    finally {
      setBusy(false);
    }
  }
  const [recoveryEmail, setRecoveryEmail] = useState('');
  useEffect(() => { const linked = security.email || security.pendingEmail; if (linked && !linked.endsWith('.internal')) setRecoveryEmail(current => current || linked); }, [security.email, security.pendingEmail]);
  async function persistProfile() { await update(name.trim(), upi.trim(), password, recoveryEmail); setPassword(''); setPasswordVisible(false); setChangingPassword(false); notify(password ? 'Password saved. Your account is secured.' : 'Profile saved. Looking good.'); }
  async function discardAndReload() { await reload(); setConfirm(false); notify('Cloud data loaded.'); }
  return <>
    <PageHeading eyebrow="YOUR SPACE, YOUR WAY" title="The personal bits." subtitle="A familiar name, a way to pay, and a little peace of mind." />
    <div className="settings-layout">
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>Your profile</h2>
          <Avatar member={profile} />
        </div>
        <form className="form-stack" onSubmit={e => { e.preventDefault(); void run(persistProfile); }}>
          <Field label="Display name">
            <input required maxLength={60} value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="Username">
            <input disabled value={`@${profile.username}`} />
          </Field>
          <Field label="UPI ID" hint="Friends can open their payment app with your details pre-filled.">
            <input placeholder="yourname@bank" pattern="[a-zA-Z0-9.\-_]{2,255}@[a-zA-Z]{2,64}" value={upi} onChange={e => setUpi(e.target.value)} />
          </Field>
          <div className="settings-divider" />
          <div className="row">
            <ShieldCheck size={20} />
            <h3>{secured ? 'Account secured' : stage === 'confirm-email' ? 'Check your email' : stage === 'set-password' ? 'Email confirmed. One last step.' : stage === 'unavailable' ? 'Account status unavailable' : stage === 'checking' ? 'Checking account security…' : 'Keep your account, anywhere.'}</h3>
          </div>
          <p className="helper" role="status">{secured ? 'Your password is set. You can sign in on another device with your email and password.' : stage === 'confirm-email' ? `A confirmation link was sent to ${security.pendingEmail}. Open it, then return here to finish password setup.` : stage === 'set-password' ? 'Your email is verified. Enter a password below to finish securing your account. Email confirmation alone does not set your password.' : stage === 'unavailable' ? 'Your saved account status could not be checked. Reconnect and check again before changing your password.' : stage === 'checking' ? 'Checking your saved password and email status.' : 'Add your email and a password to sign in on another device. Your username and existing expenses stay the same.'}</p>
          {security.error && !demo && <p className="helper">Could not refresh account status: {security.error} <button type="button" className="text-button" onClick={() => void refreshAccount()}>Check again</button>
          </p>}
          {stage === 'confirm-email' && <button type="button" className="button" disabled={!online || busy} onClick={() => void refreshAccount()}>I’ve confirmed my email</button>}
          <Field label="Sign-in email" hint="Use an email address you can access. Email is only needed when securing your account, not when getting started.">
            <input type="email" autoComplete="email" placeholder="you@example.com" readOnly={secured || stage === 'confirm-email' || stage === 'set-password'} required={!!password && !secured && !demo} value={recoveryEmail} onChange={e => setRecoveryEmail(e.target.value)} />
          </Field>
          {secured && !changingPassword && <button type="button" className="button" onClick={() => setChangingPassword(true)}>Change password</button>}
          {(!secured || changingPassword) && stage !== 'checking' && stage !== 'unavailable' && stage !== 'confirm-email' && <Field label={secured ? 'New password' : 'Set your password'}>
            <div className="password-input" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPasswordVisible(false); }}>
              <input id="settings-password" type={passwordVisible ? 'text' : 'password'} minLength={12} autoComplete="new-password" placeholder="At least 12 characters" value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" className="icon-button password-toggle" aria-label={passwordVisible ? 'Hide password' : 'Show password'} aria-controls="settings-password" aria-pressed={passwordVisible} onMouseDown={event => event.preventDefault()} onClick={() => setPasswordVisible(visible => !visible)}>
                {passwordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </Field>}{secured && changingPassword && <button type="button" className="text-button" onClick={() => { setChangingPassword(false); setPassword(''); setPasswordVisible(false); }}>Cancel password change</button>}{demo && <p className="helper">Demo settings stay on this device. No password is registered.</p>}{confirmation && !secured && !security.emailConfirmed && <p className="confirmation-notice" role="status">{confirmation}</p>}{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" className="button primary" disabled={busy || !online || pending > 0}>{busy ? 'Saving…' : 'Save changes'}<Check size={16} />
          </button>
        </form>
      </section>
      <div className="form-stack">
        <ThemeSettings />
        <section className="panel settings-panel">
          <h3>Your data belongs to you.</h3>
          <p className="helper">Export a full local backup, including group history. CSV and PDF reports are available from your groups and insights.</p>
          <button type="button" className="button full" onClick={exportData}>
            <Download size={16} />Export JSON backup</button>
          <div className="sync-detail">
            <Cloud size={17} />{demo ? 'Local demo' : `${pending} groups waiting to sync`}</div>{!demo && <>
              <button type="button" className="text-button danger" disabled={!online || busy} onClick={() => setConfirm(true)}>Reload cloud data</button>{confirm && <div className="delete-confirm">
                <p>This discards unsynced local changes. Export a backup first.</p>
                <button type="button" className="button danger small-button" onClick={() => void run(discardAndReload)}>Discard local changes & reload</button>
              </div>}</>}</section>
        <section className="panel settings-panel">
          <h3>Feels right at home.</h3>
          <p className="helper">Keep faircrumb on your home screen for quick access to your groups.</p>{install.installed ? <span className="tag">You’re using the installed app</span> : <InstallButton controller={install} />}</section>
        <button type="button" className="button danger" onClick={() => {
          if (demo || profile.hasPassword) {
            void run(signOut);
          }
          else {
            setLeaving(true);
          }
        }}>
          <LogOut size={16} />{demo ? 'Leave demo' : 'Sign out'}</button>{leaving && <div className="delete-confirm">
            <p>This anonymous account has no password. Signing out can permanently lose access. Set a password above first.</p>
            <button type="button" className="button danger" onClick={() => void run(signOut)}>Sign out anyway</button>
            <button type="button" className="text-button" onClick={() => setLeaving(false)}>Keep my session</button>
          </div>}</div>
    </div>
  </>;
}
function ReceiptLink({ path }: {
  path: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    if (supabase)
      void supabase.storage.from('receipts').createSignedUrl(path, 300).then(({ data, error }) => {
        if (alive) {
          if (error)
            setError(error.message);
          else
            setUrl(data.signedUrl);
        }
      });
    return () => { alive = false; };
  }, [path]);
  return <div className="receipt-link">{error ? <p className="form-error">{error}</p> : url ? <a className="button" href={url} target="_blank" rel="noopener noreferrer">View receipt <ArrowUpRight size={15} />
  </a> : <p className="helper">Loading private receipt…</p>}</div>;
}
