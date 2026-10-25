-- Separate group membership invitations from bearer links that claim a ghost profile.
create table private.invites (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('group','person')),
 group_id uuid references public.ledger_groups(id) on delete cascade,
 profile_id uuid references public.profiles(id) on delete cascade,
 token_hash text unique not null,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 used_by uuid references public.profiles(id),
 used_at timestamptz,
 revoked_at timestamptz,
 check((kind='group' and group_id is not null and profile_id is null) or (kind='person' and profile_id is not null and group_id is null))
);
create index invites_group_idx on private.invites(group_id);
create index invites_profile_idx on private.invites(profile_id);
revoke all on private.invites from public,anon,authenticated;

create function public.create_group_invite(p_group uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid=public.current_profile_id(); secret text; i private.invites;
begin
 if me is null or not exists(select 1 from public.ledger_groups where id=p_group and document->'members' @> jsonb_build_array(jsonb_build_object('id',me::text))) then raise exception 'Group membership required'; end if;
 secret=encode(extensions.gen_random_bytes(24),'hex');
 insert into private.invites(kind,group_id,created_by,token_hash) values('group',p_group,me,encode(extensions.digest(secret,'sha256'),'hex')) returning * into i;
 return jsonb_build_object('id',i.id,'token',secret,'expiresAt',i.expires_at);
end $$;
create function public.list_group_invites(p_group uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid=public.current_profile_id(); result jsonb;
begin
 if me is null or not exists(select 1 from public.ledger_groups where id=p_group and document->'members' @> jsonb_build_array(jsonb_build_object('id',me::text))) then raise exception 'Group membership required'; end if;
 select coalesce(jsonb_agg(item),'[]') into result from(select jsonb_build_object('id',id,'createdAt',created_at,'expiresAt',expires_at,'status',case when revoked_at is not null then 'revoked' when used_at is not null then 'used' when expires_at<=now() then 'expired' else 'active' end) item from private.invites where group_id=p_group order by created_at desc,id limit 30) rows;
 return result;
end $$;
create function public.revoke_group_invite(p_invite uuid) returns void language plpgsql security definer set search_path='' as $$
declare me uuid=public.current_profile_id(); i private.invites;
begin
 select * into i from private.invites where id=p_invite and kind='group';
 if me is null or i.id is null or not exists(select 1 from public.ledger_groups where id=i.group_id and document->'members' @> jsonb_build_array(jsonb_build_object('id',me::text))) then raise exception 'Group membership required'; end if;
 update private.invites set revoked_at=now() where id=i.id and used_at is null;
end $$;
create function public.create_person_invite(p_profile uuid,p_claim text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid=public.current_profile_id(); p public.profiles; secret text; i private.invites;
begin
 if me is null then raise exception 'Create your profile first'; end if;
 select * into p from public.profiles where id=p_profile for update;
 if p.id is null or p.auth_id is not null then raise exception 'Only unclaimed profiles can receive a personal invite'; end if;
 if not exists(select 1 from public.ledger_groups g where g.document->'members' @> jsonb_build_array(jsonb_build_object('id',me::text),jsonb_build_object('id',p.id::text))) and not exists(select 1 from private.ghost_claims c where c.profile_id=p.id and p_claim is not null and c.token_hash=encode(extensions.digest(p_claim,'sha256'),'hex')) then raise exception 'Shared group membership or original claim proof required'; end if;
 update private.invites set revoked_at=now() where profile_id=p.id and used_at is null and revoked_at is null;
 delete from private.ghost_claims where profile_id=p.id;
 delete from private.recovery_tokens where profile_id=p.id;
 secret=encode(extensions.gen_random_bytes(24),'hex');
 insert into private.invites(kind,profile_id,created_by,token_hash) values('person',p.id,me,encode(extensions.digest(secret,'sha256'),'hex')) returning * into i;
 return jsonb_build_object('id',i.id,'token',secret,'expiresAt',i.expires_at,'name',p.display_name,'username',p.username);
end $$;
create function public.accept_person_invite(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.invites; p public.profiles; me uuid=public.current_profile_id(); first_group uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'Invalid invitation'; end if;
 select * into i from private.invites where kind='person' and token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
 if i.id is null then raise exception 'Invalid invitation'; end if;
 select * into p from public.profiles where id=i.profile_id for update;
 select * into i from private.invites where id=i.id for update;
 if me is not null and me<>p.id then raise exception 'ACCOUNT_MISMATCH: This invitation belongs to a different profile. Open it in a signed-out browser session.'; end if;
 if p.auth_id=auth.uid() then
  select id into first_group from public.ledger_groups where document->'members' @> jsonb_build_array(jsonb_build_object('id',p.id::text)) order by updated_at desc limit 1;
  return jsonb_build_object('profile',public.profile_json(p),'groupId',first_group);
 end if;
 if i.revoked_at is not null or i.expires_at<=now() or i.used_at is not null or p.auth_id is not null then raise exception 'This invitation was used, revoked, or expired'; end if;
 update public.profiles set auth_id=auth.uid() where id=p.id returning * into p;
 -- Refresh canonical membership data and publish the claimed state through Realtime.
 perform public.update_profile(p.display_name,p.upi_id);
 update private.invites set used_by=p.id,used_at=now() where id=i.id;
 delete from private.ghost_claims where profile_id=p.id;
 delete from private.recovery_tokens where profile_id=p.id;
 insert into private.admin_audit(actor,action,profile_id) values(auth.uid(),'PERSON_INVITE_ACCEPTED',p.id);
 select id into first_group from public.ledger_groups where document->'members' @> jsonb_build_array(jsonb_build_object('id',p.id::text)) order by updated_at desc limit 1;
 return jsonb_build_object('profile',public.profile_json(p),'groupId',first_group);
end $$;
create function public.accept_group_invite(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.invites; me uuid=public.current_profile_id(); p public.profiles; g public.ledger_groups; members jsonb; history jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if me is null then raise exception 'ONBOARDING_REQUIRED: Create a profile or sign in first'; end if;
 if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'Invalid invitation'; end if;
 select * into i from private.invites where kind='group' and token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
 if i.id is null then raise exception 'Invalid invitation'; end if;
 select * into g from public.ledger_groups where id=i.group_id for update;
 select * into i from private.invites where id=i.id for update;
 if g.id is null then raise exception 'Group no longer exists'; end if;
 if g.document->'members' @> jsonb_build_array(jsonb_build_object('id',me::text)) then return jsonb_build_object('group',g.document,'groupId',g.id); end if;
 if i.revoked_at is not null or i.used_at is not null or i.expires_at<=now() then raise exception 'This invitation was used, revoked, or expired'; end if;
 if jsonb_array_length(g.document->'members')>=100 then raise exception 'This group already has 100 members'; end if;
 select * into p from public.profiles where id=me;
 members=g.document->'members'||jsonb_build_array(public.profile_json(p));
 history=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'actor',p.display_name,'action','Joined through invite','description',p.display_name))||coalesce(g.document->'audit','[]'::jsonb);
 g.document=jsonb_set(jsonb_set(jsonb_set(g.document,'{members}',members),'{audit}',history),'{revision}',to_jsonb(g.revision+1));
 if octet_length(g.document::text)>1048576 then raise exception 'Group document has reached its size limit'; end if;
 update public.ledger_groups set document=g.document,revision=revision+1,updated_at=now() where id=g.id;
 update private.invites set used_by=me,used_at=now() where id=i.id;
 return jsonb_build_object('group',g.document,'groupId',g.id);
end $$;
-- Admin recovery invalidates any outstanding personal invite for the same ghost.
create function private.revoke_person_invites_for_recovery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.invites set revoked_at=now() where profile_id=new.profile_id and used_at is null and revoked_at is null;
 return new;
end $$;
create trigger recovery_revokes_person_invites after insert or update on private.recovery_tokens for each row execute function private.revoke_person_invites_for_recovery();
revoke all on function private.revoke_person_invites_for_recovery() from public,anon,authenticated;
revoke all on function public.create_group_invite(uuid),public.list_group_invites(uuid),public.revoke_group_invite(uuid),public.create_person_invite(uuid,text),public.accept_person_invite(text),public.accept_group_invite(text) from public,anon;
grant execute on function public.create_group_invite(uuid),public.list_group_invites(uuid),public.revoke_group_invite(uuid),public.create_person_invite(uuid,text),public.accept_person_invite(text),public.accept_group_invite(text) to authenticated;

-- Keep the existing service-role Admin claims view aware of personal invitations.
create or replace function public.admin_list(p_entity text,p_page integer,p_query text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; total bigint; skip integer=(greatest(p_page,1)-1)*25; q text='%'||left(coalesce(p_query,''),100)||'%';
begin
 if not exists(select 1 from auth.users where id=p_actor and is_anonymous=false and email_confirmed_at is not null) then raise exception 'Verified actor required'; end if;
 if p_entity='users' then
  select count(*) into total from auth.users u full join public.profiles p on p.auth_id=u.id where coalesce(p.username,'') ilike q or coalesce(p.display_name,'') ilike q or coalesce(u.email,'') ilike q;
  select coalesce(jsonb_agg(item),'[]') into result from (
   select jsonb_build_object('profileId',p.id,'authId',u.id,'username',p.username,'name',p.display_name,'email',u.email,'anonymous',u.is_anonymous,'emailConfirmed',u.email_confirmed_at is not null,'hasPassword',coalesce(u.encrypted_password,'')<>'','createdAt',coalesce(p.created_at,u.created_at),'recoverable',p.id is not null and (u.id is null or(u.is_anonymous and coalesce(u.email,'')='' and coalesce(u.email_change,'')=''))) item
   from auth.users u full join public.profiles p on p.auth_id=u.id
   where coalesce(p.username,'') ilike q or coalesce(p.display_name,'') ilike q or coalesce(u.email,'') ilike q
   order by coalesce(p.created_at,u.created_at) desc,coalesce(p.id,u.id) limit 25 offset skip
  ) rows;
 elsif p_entity='groups' then
  select count(*) into total from public.ledger_groups where document->>'name' ilike q;
  select coalesce(jsonb_agg(item),'[]') into result from (
   select jsonb_build_object('id',g.id,'name',g.document->>'name','category',g.document->>'category','currency',g.document->>'currency','members',g.document->'members','expenseCount',jsonb_array_length(g.document->'expenses'),'revision',g.revision,'updatedAt',g.updated_at) item
   from public.ledger_groups g where g.document->>'name' ilike q order by g.updated_at desc,g.id limit 25 offset skip
  ) rows;
 elsif p_entity='claims' then
  select count(*) into total from public.profiles p left join auth.users u on u.id=p.auth_id where (p.auth_id is null or u.is_anonymous or exists(select 1 from private.recovery_tokens r where r.profile_id=p.id)) and(p.username ilike q or p.display_name ilike q);
  select coalesce(jsonb_agg(item),'[]') into result from (
   select jsonb_build_object('profileId',p.id,'username',p.username,'name',p.display_name,'kind',case when p.auth_id is null then 'ghost' else 'anonymous' end,'recoverable',p.auth_id is null or(u.is_anonymous and coalesce(u.email,'')='' and coalesce(u.email_change,'')=''),'tokenStatus',case when r.profile_id is not null then case when r.expires_at>now() then 'active' else 'expired' end when i.id is not null then case when i.revoked_at is not null then 'invite revoked' when i.used_at is not null then 'invite accepted' when i.expires_at<=now() then 'invite expired' else 'personal invite active' end when c.profile_id is not null then 'legacy claim exists' else 'not issued' end,'expiresAt',coalesce(r.expires_at,i.expires_at),'issuedAt',coalesce(r.created_at,i.created_at)) item
   from public.profiles p left join auth.users u on u.id=p.auth_id left join private.recovery_tokens r on r.profile_id=p.id left join private.ghost_claims c on c.profile_id=p.id left join lateral(select * from private.invites where profile_id=p.id and kind='person' order by created_at desc,id desc limit 1) i on true
   where(p.auth_id is null or u.is_anonymous or r.profile_id is not null) and(p.username ilike q or p.display_name ilike q) order by p.created_at desc,p.id limit 25 offset skip
  ) rows;
 elsif p_entity='audit' then
  select count(*) into total from private.admin_audit a left join public.profiles p on p.id=a.profile_id where coalesce(p.username,'') ilike q or a.action ilike q;
  select coalesce(jsonb_agg(item),'[]') into result from (
   select jsonb_build_object('id',a.id,'actorId',a.actor,'actorEmail',u.email,'action',a.action,'profileId',a.profile_id,'username',p.username,'at',a.created_at) item from private.admin_audit a left join public.profiles p on p.id=a.profile_id left join auth.users u on u.id=a.actor where coalesce(p.username,'') ilike q or a.action ilike q order by a.created_at desc,a.id limit 25 offset skip
  ) rows;
 else raise exception 'Unknown admin list'; end if;
 return jsonb_build_object('items',result,'total',total,'page',p_page,'pageSize',25);
end $$;

