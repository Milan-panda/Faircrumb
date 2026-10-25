import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { acceptPersonInvite, inviteRpc, readInviteLink, type GroupAcceptance } from './invites';
import { initialSecurity } from './account-security';
import { setAccountPassword } from './password';
import { demoGroups, demoProfile } from './demo';
import type { Group, Profile } from './domain';
type Snapshot = {
  groups: Group[];
  pending: string[];
  profile: Profile;
};
type LedgerState = {
  groups: Group[];
  pending: string[];
  profile: Profile | null;
  demo: boolean;
};
const initial: LedgerState = { groups: [], pending: [], profile: null, demo: false };
// Keep the pre-rebrand storage namespace so existing ledgers and offline writes stay available.
const storageKey = (p: Profile, d: boolean) => d ? 'splitfree-demo-v1' : `splitfree-${p.id}-v1`;
const safeRead = (key: string) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  }
  catch {
    return null;
  }
};
export function useLedger() {
  const [snapshot, setSnapshot] = useState<LedgerState>(initial);
  const state = useRef<LedgerState>(initial);
  const { profile, groups, pending, demo } = snapshot;
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState('');
  const syncing = useRef(false);
  const [security, setSecurity] = useState(initialSecurity);
  const securityVersion = useRef(0);
  const publish = useCallback((next: LedgerState) => { state.current = next; setSnapshot(next); }, []);
  const apply = useCallback((p: Profile, d: boolean) => { const cached = safeRead(storageKey(p, d)) as Snapshot | null; if (state.current.profile?.id !== p.id || state.current.demo !== d) { securityVersion.current++; setSecurity(initialSecurity); } publish({ profile: d ? cached?.profile || p : p, groups: cached?.groups || (d ? demoGroups() : []), pending: cached?.pending || [], demo: d }); setReady(true); }, [publish]);
  useEffect(() => {
    let alive = true; async function boot() {
      try {
        if (localStorage.getItem('splitfree-mode') === 'demo' && !readInviteLink()) {
          if (alive)
            apply(demoProfile, true);
          return;
        }
        if (supabase) {
          const { data, error } = await supabase.auth.getSession();
          if (error)
            throw error;
          if (data.session) {
            const cached = safeRead(`splitfree-auth-${data.session.user.id}`) as Profile | null;
            if (cached && alive)
              apply(cached, false);
            if (!navigator.onLine && cached)
              return;
            const { data: p, error: e } = await supabase.rpc('my_profile');
            if (e)
              throw e;
            if (p && alive) {
              localStorage.setItem(`splitfree-auth-${data.session.user.id}`, JSON.stringify(p));
              if (!cached)
                apply(p, false);
              else
                publish({ ...state.current, profile: p });
            }
          }
        }
      }
      catch (e) {
        if (alive)
          setError((e as Error).message);
      }
      finally {
        if (alive)
          setReady(true);
      }
    } void boot(); return () => { alive = false; };
  }, [apply, publish]);
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  useEffect(() => {
    if (profile) {
      try {
        localStorage.setItem(storageKey(profile, demo), JSON.stringify({ profile, groups, pending }));
      }
      catch {
        setError('Device storage is full. Keep this page open and export your data.');
      }
    }
  }, [profile, groups, pending, demo]);
  const refreshAccount = useCallback(async () => {
    const before = state.current;
    if (!supabase || before.demo || !before.profile) return;
    if (!navigator.onLine) { setSecurity(old => ({ ...old, checking: false, error: 'Connect to the internet to refresh account status.' })); return; }
    const version = ++securityVersion.current;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new Error('Your account session could not be checked.');
      const { data: p, error: profileError } = await supabase.rpc('my_profile');
      if (profileError) throw profileError;
      if (version !== securityVersion.current || state.current.demo || state.current.profile?.id !== before.profile.id || p?.id !== before.profile.id) return;
      const hasPassword = typeof p.hasPassword === 'boolean' ? p.hasPassword : !!state.current.profile.hasPassword;
      setSecurity({ checking: false, email: data.user.email || '', pendingEmail: data.user.new_email || '', emailConfirmed: !!data.user.email_confirmed_at && !data.user.is_anonymous, hasPassword, error: '' });
      // Account security is private. Never put the email into shared group members.
      publish({ ...state.current, profile: { ...state.current.profile, hasPassword } });
      try { localStorage.setItem(`splitfree-auth-${data.user.id}`, JSON.stringify({ ...p, hasPassword })); } catch {/* The ledger persistence path reports unavailable device storage. */ }
    } catch (e) { if (version === securityVersion.current) setSecurity(old => ({ ...old, checking: false, error: (e as Error).message })); }
  }, [publish]);
  useEffect(() => {
    if (!profile || demo) return;
    void refreshAccount();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Defer Auth API calls outside the auth callback's lock.
    const result = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!session) return;
      clearTimeout(timer); timer = setTimeout(() => void refreshAccount(), 0);
    });
    const focus = () => void refreshAccount();
    const visible = () => { if (document.visibilityState === 'visible') void refreshAccount(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); result?.data.subscription.unsubscribe(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible); securityVersion.current++; };
  }, [profile?.id, demo, online, refreshAccount]);
  const refresh = useCallback(async () => {
    const before = state.current;
    if (!supabase || before.demo || !before.profile || !navigator.onLine)
      return;
    const { data, error } = await supabase.from('ledger_groups').select('document,revision');
    if (state.current.profile?.id !== before.profile.id || state.current.demo)
      return;
    if (error) {
      setError(error.message);
      return;
    }
    const current = state.current;
    const dirty = new Set(current.pending);
    const remote = (data || []).map(r => ({ ...r.document, revision: r.revision }) as Group);
    // Pending documents always win locally until the server acknowledges their revision.
    // Responses from older requests cannot roll a newer revision back.
    const oldById = new Map(current.groups.map(g => [g.id, g]));
    const remoteIds = new Set(remote.map(g => g.id));
    publish({ ...current, groups: [...remote.filter(r => !dirty.has(r.id)).map(r => { const old = oldById.get(r.id); return old && old.revision > r.revision ? old : r; }), ...current.groups.filter(g => dirty.has(g.id) || !remoteIds.has(g.id))] });
  }, [publish]);
  const sync = useCallback(async () => {
    if (syncing.current || !supabase || state.current.demo || !state.current.profile || !navigator.onLine)
      return;
    syncing.current = true;
    const owner = state.current.profile.id;
    try {
      for (const id of [...state.current.pending]) {
        const current = state.current;
        const group = current.groups.find(g => g.id === id);
        if (!group || current.profile?.id !== owner || current.demo)
          continue;
        const { data, error } = await supabase.rpc('save_group', { p_document: group, p_expected: group.revision });
        if (state.current.profile?.id !== owner || state.current.demo)
          break;
        if (error) {
          setError(error.message.includes('CONFLICT') ? 'A group changed on another device. Export your local data, then use “Reload cloud data” in Settings to resolve the conflict.' : error.message);
          break;
        }
        const latest = state.current;
        const latestGroup = latest.groups.find(g => g.id === id);
        const changedDuringUpload = latestGroup !== group;
        publish({ ...latest, groups: latest.groups.map(g => g.id === id ? { ...g, revision: Number(data) } : g), pending: changedDuringUpload ? [...latest.pending] : latest.pending.filter(x => x !== id) });
      }
    }
    finally {
      syncing.current = false;
    }
    await refresh();
  }, [publish, refresh]);
  useEffect(() => {
    if (profile && !demo && online) {
      void sync();
      void refresh();
      const channel = supabase?.channel(`ledger-${profile.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_groups' }, () => void refresh()).subscribe();
      return () => {
        if (channel)
          void supabase?.removeChannel(channel);
      };
    }
  }, [profile?.id, demo, online, sync, refresh]);
  useEffect(() => {
    if (pending.length && online && !demo) {
      const timer = setTimeout(() => void sync(), 500);
      return () => clearTimeout(timer);
    }
  }, [pending, online, demo, sync]);
  function commit(group: Group) {
    const current = state.current; if (!current.profile)
      return; const nextGroups = current.groups.some(g => g.id === group.id) ? current.groups.map(g => g.id === group.id ? group : g) : [group, ...current.groups]; const nextPending = current.demo ? [] : Array.from(new Set([...current.pending, group.id])); try {
        localStorage.setItem(storageKey(current.profile, current.demo), JSON.stringify({ groups: nextGroups, pending: nextPending, profile: current.profile }));
      }
    catch {
      throw new Error('Device storage is full. Export your data before adding more.');
    } publish({ ...current, groups: nextGroups, pending: nextPending });
  }
  const fetchNotificationGroup = useCallback(async (id: string) => {
    const before = state.current;
    if (!supabase || !before.profile || before.demo || !navigator.onLine) throw new Error('Connect to the internet to open this expense.');
    if (before.pending.includes(id)) throw new Error('Sync your pending changes before opening this update.');
    const { data, error } = await supabase.from('ledger_groups').select('document,revision').eq('id', id).single();
    if (error || !data) throw new Error('This group is no longer available.');
    const current = state.current;
    if (current.profile?.id !== before.profile.id || current.demo) throw new Error('Your account changed. Open the notification again.');
    if (current.pending.includes(id)) throw new Error('Sync your pending changes before opening this update.');
    const remote = { ...data.document, revision: data.revision } as Group;
    const cached = current.groups.find(g => g.id === id);
    const target = cached && cached.revision > remote.revision ? cached : remote;
    publish({ ...current, groups: [target, ...current.groups.filter(g => g.id !== id)] }); return target;
  }, [publish]);
  const acceptPersonalInvitation = useCallback(async (token: string) => {
    const result = await acceptPersonInvite(token);
    localStorage.removeItem('splitfree-mode');
    try { localStorage.setItem(`splitfree-auth-${result.authId}`, JSON.stringify(result.profile)); } catch {/* The ledger cache reports storage failures separately. */ }
    apply(result.profile, false); await refresh(); return result.groupId;
  }, [apply, refresh]);
  const acceptGroupInvitation = useCallback(async (token: string) => {
    if (!state.current.profile || state.current.demo) throw new Error('Create an account or sign in before joining this group.');
    const result = await inviteRpc<GroupAcceptance>('accept_group_invite', { p_token: token });
    const current = state.current;
    if (!current.pending.includes(result.groupId)) publish({ ...current, groups: [result.group, ...current.groups.filter(g => g.id !== result.groupId)] });
    return result.groupId;
  }, [publish]);
  async function onboard(name: string, username: string, claim: string, password: string, login: boolean) {
    if (!supabase)
      throw new Error('Connect Supabase using .env.local to create an account. You can explore the demo now.'); if (login) {
        const { error } = await supabase.auth.signInWithPassword({ email: username.includes('@') ? username.trim().toLowerCase() : `${username}@splitfree.internal`, password });
        if (error)
          throw error;
      }
    else {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error)
          throw error;
      }
      const { error } = await supabase.rpc('register_profile', { p_name: name, p_username: username, p_claim: claim || null });
      if (error)
        throw error;
    } const { data: p, error } = await supabase.rpc('my_profile'); if (error)
      throw error; if (!p)
      throw new Error('This account has no profile.'); const { data: sessionData } = await supabase.auth.getSession(); if (sessionData.session)
      localStorage.setItem(`splitfree-auth-${sessionData.session.user.id}`, JSON.stringify(p)); localStorage.removeItem('splitfree-mode'); apply(p, false);
  }
  async function updateProfile(name: string, upi: string, password: string, email?: string) {
    const current = state.current; if (!current.profile)
      return; if (!current.demo && current.pending.length)
      throw new Error('Sync pending expenses before updating your profile.'); if (!current.demo) {
        if (password) {
          try {
            const user = await setAccountPassword(supabase!.auth, current.profile.username, password, email);
            securityVersion.current++;
            setSecurity({ checking: false, email: user.email || '', pendingEmail: user.new_email || '', emailConfirmed: !!user.email_confirmed_at, hasPassword: true, error: '' });
          } catch (e) { await refreshAccount(); throw e; }
          // Auth and profile writes are separate operations. Preserve the successful
          // password state even if the subsequent display-name/UPI write fails.
          publish({ ...state.current, profile: { ...state.current.profile!, hasPassword: true } });
        }
        const { error } = await supabase!.rpc('update_profile', { p_name: name, p_upi: upi });
        if (error)
          throw error;
        await refresh();
      } const updated = { ...current.profile, name, upi, hasPassword: current.profile.hasPassword || (!current.demo && !!password) }; publish({ ...state.current, profile: updated, groups: state.current.groups.map(g => ({ ...g, members: g.members.map(m => m.id === updated.id ? updated : m) })) });
  }
  async function addFriend(username: string, name: string) {
    if (state.current.demo) {
      if (!name)
        throw new Error('Enter a name for your demo friend.');
      return { member: { id: crypto.randomUUID(), username, name, ghost: true }, claim: 'demo-only-' + crypto.randomUUID() };
    } const { data, error } = await supabase!.rpc('find_or_create_friend', { p_username: username, p_name: name }); if (error)
      throw error; return data as {
        member: Profile;
        claim: string | null;
      };
  }
  async function uploadReceipt(group: Group, file: File) {
    if (!supabase || state.current.demo || !navigator.onLine)
      throw new Error('Receipt uploads require a cloud connection.');
    const types: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    if (!types[file.type] || file.size > 5 * 1024 * 1024)
      throw new Error('Use a JPG, PNG, WebP or PDF up to 5 MB.');
    const path = `${group.id}/${crypto.randomUUID()}.${types[file.type]}`;
    const { error } = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type, cacheControl: '0', upsert: false });
    if (error)
      throw error;
    return path;
  }
  async function signOut() {
    if (state.current.pending.length)
      throw new Error('Sync or export and explicitly discard your pending changes before leaving.'); if (!state.current.demo && supabase) {
        const { error } = await supabase.auth.signOut();
        if (error)
          throw error;
      } localStorage.removeItem('splitfree-mode'); securityVersion.current++; setSecurity(initialSecurity); publish(initial);
  }
  async function reloadCloud() {
    if (!supabase || state.current.demo)
      return; const { data, error } = await supabase.from('ledger_groups').select('document,revision'); if (error)
      throw error; publish({ ...state.current, pending: [], groups: (data || []).map(r => ({ ...r.document, revision: r.revision })) }); setError('');
  }
  return { profile, groups, fetchNotificationGroup, acceptPersonalInvitation, acceptGroupInvitation, security, refreshAccount, demo, ready, online, pending, error, setError, commit, onboard, updateProfile, addFriend, uploadReceipt, signOut, reloadCloud, sync, startDemo: () => { localStorage.setItem('splitfree-mode', 'demo'); apply(demoProfile, true); } };
}
