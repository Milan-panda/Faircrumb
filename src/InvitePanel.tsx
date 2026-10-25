import { useEffect, useState } from 'react';
import { Copy, Link, Share2 } from 'lucide-react';
import { createGroupInvite, inviteRpc, inviteUrl, type CreatedInvite } from './lib/invites';
export function ShareInvite({ kind, invite }: { kind: 'person' | 'group'; invite: CreatedInvite }) {
  const [copied, setCopied] = useState(false); const [error, setError] = useState(''); const url = inviteUrl(kind, invite.token);
  return <div className="invite-result">
    <strong>{kind === 'person' ? `Invite @${invite.username}` : 'Your group invitation'}</strong>
    <p>{kind === 'person' ? 'This link signs your friend into the profile you created, including their existing expenses.' : 'Existing users join directly. New users create an account or sign in first.'}</p>
    <label className="field">
      <span>Private invite link</span>
      <input readOnly value={url} onFocus={e => e.currentTarget.select()} />
    </label>
    <small>One person · Expires {new Date(invite.expiresAt).toLocaleString()}</small>
    <div className="row">
      <button type="button" className="button" onClick={() => void (navigator.clipboard?.writeText(url) || Promise.reject(new Error('Clipboard unavailable'))).then(() => setCopied(true)).catch(() => setError('Select the link above and copy it manually.'))}>
        <Copy size={15} />{copied ? 'Copied' : 'Copy invite link'}</button>{typeof navigator.share === 'function' && <button type="button" className="button" onClick={() => void navigator.share({ title: 'Join me on faircrumb', text: 'Here is your private faircrumb invitation.', url }).catch(e => { if (e.name !== 'AbortError') setError('Sharing could not open. Copy the link instead.'); })}>
          <Share2 size={15} />Share</button>}</div>{error && <p className="helper" role="status">{error}</p>}<p className="helper">Share privately. Anyone holding this link can use it until accepted, revoked or expired. The link is shown only here; create a new one if you lose it.</p>
  </div>;
}
type LinkStatus = { id: string; createdAt: string; expiresAt: string; status: string };
export default function InvitePanel({ groupId, enabled }: { groupId: string; enabled: boolean }) {
  const [invite, setInvite] = useState<CreatedInvite | null>(null); const [links, setLinks] = useState<LinkStatus[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [version, setVersion] = useState(0);
  useEffect(() => { let active = true; if (enabled) void inviteRpc<LinkStatus[]>('list_group_invites', { p_group: groupId }).then(data => { if (active) setLinks(data); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [groupId, enabled, version]);
  return <div className="form-stack">
    <p className="modal-intro">Invite someone into this group. Existing signed-in members of faircrumb join directly; new people finish normal onboarding first.</p>{!enabled && <p className="helper">Invites need a synced cloud group and an internet connection. Demo groups cannot generate working links.</p>}<button type="button" className="button primary full" disabled={!enabled || busy} onClick={async () => { setBusy(true); setError(''); try { setInvite(await createGroupInvite(groupId)); setVersion(v => v + 1); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <Link size={16} />{busy ? 'Creating link…' : 'Create unique group link'}</button>{error && <p className="form-error" role="alert">{error}</p>}{invite && <ShareInvite key={invite.id} kind="group" invite={invite} />} {!!links.length && <div className="invite-links">
        <h3>Recent group links</h3>{links.map(link =>
          <div key={link.id}>
            <span>{link.status} · {new Date(link.createdAt).toLocaleDateString()}</span>{link.status === 'active' && <button type="button" className="text-button danger" disabled={busy} onClick={async () => { setBusy(true); try { await inviteRpc('revoke_group_invite', { p_invite: link.id }); if (invite?.id === link.id) setInvite(null); setVersion(v => v + 1); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Revoke link</button>}</div>)}</div>}</div>;
}
