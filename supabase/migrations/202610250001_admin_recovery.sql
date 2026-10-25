-- Admin-only RPCs are callable solely by the server service role. The Edge
-- function verifies the current user and server environment allowlist first.
create table private.recovery_tokens (
 profile_id uuid primary key references public.profiles(id) on delete cascade,
 token_hash text not null,
 owner_auth_id uuid,
 expires_at timestamptz not null,
 issued_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table private.admin_audit (
 id uuid primary key default gen_random_uuid(),
 actor uuid not null references auth.users(id),
 action text not null,
 profile_id uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
revoke all on private.recovery_tokens,private.admin_audit from public,anon,authenticated;

create function public.admin_list(p_entity text,p_page integer,p_query text,p_actor uuid) returns jsonb
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
   select jsonb_build_object('profileId',p.id,'username',p.username,'name',p.display_name,'kind',case when p.auth_id is null then 'ghost' else 'anonymous' end,'recoverable',p.auth_id is null or(u.is_anonymous and coalesce(u.email,'')='' and coalesce(u.email_change,'')=''),'tokenStatus',case when r.profile_id is not null then case when r.expires_at>now() then 'active' else 'expired' end when c.profile_id is not null then 'legacy claim exists' else 'not issued' end,'expiresAt',r.expires_at,'issuedAt',r.created_at) item
   from public.profiles p left join auth.users u on u.id=p.auth_id left join private.recovery_tokens r on r.profile_id=p.id left join private.ghost_claims c on c.profile_id=p.id
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

create function public.admin_reissue_token(p_profile uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; token text; expiry timestamptz=now()+interval '24 hours';
begin
 if not exists(select 1 from auth.users where id=p_actor and is_anonymous=false and email_confirmed_at is not null) then raise exception 'Verified actor required'; end if;
 select * into p from public.profiles where id=p_profile for update;
 if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
 if p.auth_id is not null and not exists(select 1 from auth.users where id=p.auth_id and is_anonymous and coalesce(email,'')='' and coalesce(email_change,'')='') then raise exception 'RECOVERY_NOT_ALLOWED'; end if;
 token=encode(extensions.gen_random_bytes(24),'hex');
 insert into private.recovery_tokens(profile_id,token_hash,owner_auth_id,expires_at,issued_by) values(p.id,encode(extensions.digest(token,'sha256'),'hex'),p.auth_id,expiry,p_actor)
 on conflict(profile_id) do update set token_hash=excluded.token_hash,owner_auth_id=excluded.owner_auth_id,expires_at=excluded.expires_at,issued_by=excluded.issued_by,created_at=now();
 delete from private.ghost_claims where profile_id=p.id;
 insert into private.admin_audit(actor,action,profile_id) values(p_actor,'RECOVERY_TOKEN_REISSUED',p.id);
 return jsonb_build_object('token',token,'expiresAt',expiry,'username',p.username);
end $$;
revoke all on function public.admin_list(text,integer,text,uuid),public.admin_reissue_token(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_list(text,integer,text,uuid),public.admin_reissue_token(uuid,uuid) to service_role;

-- Accept a one-use recovery token for the original profile, including an active
-- anonymous profile whose original browser session has been lost. Keep its ID.
create or replace function public.register_profile(p_name text,p_username text,p_claim text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; expected text; recovery private.recovery_tokens;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if exists(select 1 from public.profiles where auth_id=auth.uid()) then raise exception 'You already have a profile. Use a separate signed-out session to recover another profile.'; end if;
 if p_username !~ '^[a-z0-9_]{3,24}$' or length(trim(p_name)) not between 1 and 60 then raise exception 'Enter a valid name and username'; end if;
 select * into p from public.profiles where username=p_username for update;
 if found then
  select * into recovery from private.recovery_tokens where profile_id=p.id;
  if recovery.profile_id is not null then
   if p_claim is null or recovery.expires_at<=now() or recovery.token_hash<>encode(extensions.digest(p_claim,'sha256'),'hex') or recovery.owner_auth_id is distinct from p.auth_id then raise exception 'Recovery token is invalid or expired'; end if;
   if p.auth_id is not null and not exists(select 1 from auth.users where id=p.auth_id and is_anonymous and coalesce(email,'')='' and coalesce(email_change,'')='') then raise exception 'This account must be recovered using its verified email'; end if;
  else
   if p.auth_id is not null then raise exception 'Username is already in use'; end if;
   select token_hash into expected from private.ghost_claims where profile_id=p.id;
   if expected is null or p_claim is null or expected<>encode(extensions.digest(p_claim,'sha256'),'hex') then raise exception 'This profile requires the private claim token from your friend or a valid recovery token'; end if;
  end if;
  update public.profiles set auth_id=auth.uid(),display_name=trim(p_name) where id=p.id returning * into p;
  if recovery.profile_id is not null then insert into private.admin_audit(actor,action,profile_id) values(auth.uid(),'RECOVERY_TOKEN_REDEEMED',p.id); end if;
  delete from private.recovery_tokens where profile_id=p.id;
  delete from private.ghost_claims where profile_id=p.id;
 else
  insert into public.profiles(auth_id,username,display_name) values(auth.uid(),p_username,trim(p_name)) returning * into p;
 end if;
 return public.profile_json(p);
end $$;

create function public.admin_group(p_group uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from auth.users where id=p_actor and is_anonymous=false and email_confirmed_at is not null) then raise exception 'Verified actor required'; end if;
 select document into result from public.ledger_groups where id=p_group;
 if result is null then raise exception 'GROUP_NOT_FOUND'; end if;
 insert into private.admin_audit(actor,action) values(p_actor,'GROUP_LEDGER_VIEWED');
 return result;
end $$;
revoke all on function public.admin_group(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_group(uuid,uuid) to service_role;
