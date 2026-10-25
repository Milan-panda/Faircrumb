import { supabase } from './supabase';
import type { Group, Profile } from './domain';
export type IncomingInvite = { kind: 'group' | 'person'; token: string };
export type CreatedInvite = { id: string; token: string; expiresAt: string; name?: string; username?: string };
export function readInviteLink(hash = window.location.hash): IncomingInvite | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const person = params.get('person-invite'), group = params.get('group-invite');
  if (person !== null) return { kind: 'person', token: person };
  if (group !== null) return { kind: 'group', token: group };
  return null;
}
export function inviteUrl(kind: 'group' | 'person', token: string) { const url = new URL(window.location.origin + window.location.pathname); url.hash = new URLSearchParams({ [`${kind}-invite`]: token }).toString(); return url.href; }
export function clearInviteLink() { const url = new URL(window.location.href); const params = new URLSearchParams(url.hash.slice(1)); params.delete('person-invite'); params.delete('group-invite'); url.hash = params.toString(); history.replaceState(null, '', url.pathname + url.search + url.hash); }
export async function inviteRpc<T>(name: string, args: Record<string, unknown>): Promise<T> { if (!supabase) throw new Error('Connect Supabase to use invitations.'); if (!navigator.onLine) throw new Error('Connect to the internet to use this invitation.'); const { data, error } = await supabase.rpc(name, args); if (error) throw error; return data as T; }
export const createGroupInvite = (id: string) => inviteRpc<CreatedInvite>('create_group_invite', { p_group: id });
export const createPersonInvite = (id: string, proof?: string) => inviteRpc<CreatedInvite>('create_person_invite', { p_profile: id, p_claim: proof || null });
export type PersonalAcceptance = { profile: Profile; groupId: string | null; authId: string };
let personFlight: { token: string; promise: Promise<PersonalAcceptance> } | null = null;
export function acceptPersonInvite(token: string): Promise<PersonalAcceptance> {
  if (personFlight?.token === token) return personFlight.promise;
  const promise = (async () => {
    if (!/^[0-9a-f]{48}$/.test(token)) throw new Error('This invitation link is invalid. Ask your friend for a new link.');
    if (!supabase) throw new Error('Connect Supabase to use invitations.');
    if (!navigator.onLine) throw new Error('Connect to the internet to accept this invitation.');
    let { data, error } = await supabase.auth.getSession(); if (error) throw error;
    if (!data.session) { const signed = await supabase.auth.signInAnonymously(); if (signed.error) throw signed.error; data = { session: signed.data.session }; }
    if (!data.session) throw new Error('The guest sign-in could not be completed.');
    const result = await inviteRpc<{ profile: Profile; groupId: string | null }>('accept_person_invite', { p_token: token });
    return { ...result, authId: data.session.user.id };
  })();
  personFlight = { token, promise }; void promise.finally(() => { if (personFlight?.promise === promise) personFlight = null; }).catch(() => { }); return promise;
}
export type GroupAcceptance = { group: Group; groupId: string };
