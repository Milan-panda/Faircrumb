import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
export async function adminRequest<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Connect Supabase to use server administration.');
  const { data: session, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session.session) throw new Error('Sign in to use administration.');
  const { data, error } = await supabase.functions.invoke('admin', { body, headers: { Authorization: `Bearer ${session.session.access_token}` } });
  if (error) {
    let message = 'Admin service is unavailable or access was denied. Check the Edge Function deployment.';
    if (error.context instanceof Response) { try { const detail = await error.context.clone().json(); if (typeof detail.error === 'string') message = detail.error; } catch {/* No server error detail. */ } }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
export function useAdminAccess(profileId?: string, demo = false) {
  const [allowed, setAllowed] = useState(false);
  const generation = useRef(0);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    const current = ++generation.current;
    if (!profileId || demo || !navigator.onLine) { setAllowed(false); setChecking(false); return; }
    setChecking(true); setError('');
    try { const response = await adminRequest<{ isAdmin: boolean }>({ action: 'status' }); if (current === generation.current) setAllowed(response.isAdmin === true); } catch (e) { if (current === generation.current) { setAllowed(false); setError((e as Error).message); } } finally { if (current === generation.current) setChecking(false); }
  }, [profileId, demo]);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); generation.current++; setAllowed(false); timer = setTimeout(() => { if (active) void check(); }, 0); };
    schedule();
    const subscription = !demo && profileId ? supabase?.auth.onAuthStateChange(schedule) : undefined;
    window.addEventListener('online', schedule); window.addEventListener('offline', schedule); window.addEventListener('focus', schedule);
    return () => { active = false; generation.current++; clearTimeout(timer); subscription?.data.subscription.unsubscribe(); window.removeEventListener('online', schedule); window.removeEventListener('offline', schedule); window.removeEventListener('focus', schedule); };
  }, [check, profileId, demo]);
  // This flag only controls discovery. Every list/rotation is authorized again by the server.
  return { allowed, error, checking, check };
}
export type AdminRow = Record<string, unknown>;
export type AdminList = { items: AdminRow[]; total: number; page: number; pageSize: number };
