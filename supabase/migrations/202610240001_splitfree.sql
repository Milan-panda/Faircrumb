-- Run once in Supabase SQL Editor, or with `supabase db push`.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.profiles (
 id uuid primary key default gen_random_uuid(),
 auth_id uuid unique references auth.users(id) on delete set null,
 username text unique not null check(username ~ '^[a-z0-9_]{3,24}$'),
 display_name text not null check(length(trim(display_name)) between 1 and 60),
 upi_id text check(upi_id is null or upi_id ~ '^[a-zA-Z0-9.\-_]{2,255}@[a-zA-Z]{2,64}$'),
 created_at timestamptz not null default now()
);
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.ghost_claims(profile_id uuid primary key references public.profiles(id), token_hash text not null);
create table public.ledger_groups (
 id uuid primary key,
 document jsonb not null,
 revision integer not null default 1,
 created_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now()
);
create index ledger_members_idx on public.ledger_groups using gin ((document->'members'));
alter table public.profiles enable row level security;
alter table public.ledger_groups enable row level security;
-- No direct table mutations. All writes pass through validated transactional RPCs.
revoke all on public.profiles, public.ledger_groups from anon, authenticated;
grant select on public.ledger_groups to authenticated;
create function public.current_profile_id() returns uuid language sql stable security definer set search_path='' as $$ select id from public.profiles where auth_id=auth.uid() $$;
create policy group_member_read on public.ledger_groups for select to authenticated using (
 document->'members' @> jsonb_build_array(jsonb_build_object('id',public.current_profile_id()::text))
);
create function public.profile_json(p public.profiles) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'name',p.display_name,'username',p.username,'ghost',p.auth_id is null,'upi',p.upi_id)
$$;
create function public.my_profile() returns jsonb language sql stable security definer set search_path='' as $$
 select public.profile_json(p) || jsonb_build_object('hasPassword',coalesce((select u.encrypted_password <> '' from auth.users u where u.id=auth.uid()),false)) from public.profiles p where p.auth_id=auth.uid()
$$;
create function public.register_profile(p_name text,p_username text,p_claim text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; expected text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if exists(select 1 from public.profiles where auth_id=auth.uid()) then raise exception 'You already have a profile'; end if;
 if p_username !~ '^[a-z0-9_]{3,24}$' or length(trim(p_name)) not between 1 and 60 then raise exception 'Enter a valid name and username'; end if;
 select * into p from public.profiles where username=p_username for update;
 if found then
  if p.auth_id is not null then raise exception 'Username is already in use'; end if;
  select token_hash into expected from private.ghost_claims where profile_id=p.id;
  if expected is null or p_claim is null or expected<>encode(extensions.digest(p_claim,'sha256'),'hex') then raise exception 'This profile requires the private claim token from your friend'; end if;
  update public.profiles set auth_id=auth.uid(),display_name=trim(p_name) where id=p.id returning * into p;
  delete from private.ghost_claims where profile_id=p.id;
 else
  insert into public.profiles(auth_id,username,display_name) values(auth.uid(),p_username,trim(p_name)) returning * into p;
 end if;
 return public.profile_json(p);
end $$;
create function public.find_or_create_friend(p_username text,p_name text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; token text;
begin
 if public.current_profile_id() is null then raise exception 'Create a profile first'; end if;
 if p_username !~ '^[a-z0-9_]{3,24}$' then raise exception 'Username must be 3–24 lowercase letters, numbers or underscores'; end if;
 select * into p from public.profiles where username=p_username;
 if not found then
  if length(trim(p_name)) not between 1 and 60 then raise exception 'Enter a name for this new friend'; end if;
  token=encode(extensions.gen_random_bytes(24),'hex');
  insert into public.profiles(username,display_name) values(p_username,trim(p_name)) returning * into p;
  insert into private.ghost_claims values(p.id,encode(extensions.digest(token,'sha256'),'hex'));
 end if;
 -- UPI is only exposed to group members, not username lookups.
 return jsonb_build_object('member',public.profile_json(p)-'upi','claim',token);
end $$;
create function public.update_profile(p_name text,p_upi text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.current_profile_id() is null then raise exception 'Authentication required'; end if;
 update public.profiles set display_name=trim(p_name),upi_id=nullif(trim(p_upi),'') where auth_id=auth.uid();
 update public.ledger_groups g set document=jsonb_set(jsonb_set(g.document,'{members}',(select jsonb_agg(case when m->>'id'=public.current_profile_id()::text then (select public.profile_json(p) from public.profiles p where p.auth_id=auth.uid()) else m end) from jsonb_array_elements(g.document->'members') m)),'{revision}',to_jsonb(g.revision+1)),revision=g.revision+1,updated_at=now()
 where g.document->'members' @> jsonb_build_array(jsonb_build_object('id',public.current_profile_id()::text));
end $$;
create function public.save_group(p_document jsonb,p_expected integer) returns integer language plpgsql security definer set search_path='' as $$
declare
 me uuid=public.current_profile_id(); gid uuid; existing public.ledger_groups; mem jsonb; expense jsonb; split jsonb;
 amount bigint; paid bigint; owed bigint; next_revision integer; ids text[]; expense_ids text[]='{}';
 canonical_members jsonb='[]'; canonical_audit jsonb; event jsonb; actor text; previous jsonb; old_expense jsonb;
begin
 if me is null then raise exception 'Authentication required'; end if;
 if p_expected is null or p_expected<0 then raise exception 'Expected revision is required'; end if;
 if p_document is null or jsonb_typeof(p_document)<>'object' or not(p_document ?& array['id','name','category','currency','members','expenses']) or exists(select 1 from jsonb_each(p_document) e where e.key=any(array['id','name','category','currency','members','expenses']) and e.value='null'::jsonb) then raise exception 'Missing required group fields'; end if;
 if octet_length(p_document::text)>1048576 then raise exception 'Group has reached the 1 MB document limit. Export and start a new group.'; end if;
 gid=(p_document->>'id')::uuid;
 select * into existing from public.ledger_groups where id=gid for update;
 if found then
  if not existing.document->'members' @> jsonb_build_array(jsonb_build_object('id',me::text)) then raise exception 'Group membership required'; end if;
  if existing.revision<>p_expected then raise exception 'CONFLICT: newer group revision exists'; end if;
 else
  if p_expected<>0 then raise exception 'CONFLICT: group no longer exists'; end if;
 end if;
 if length(trim(p_document->>'name')) not between 1 and 80 or p_document->>'currency'<>'INR' or p_document->>'category' not in ('trip','home','food','couple','other') then raise exception 'Invalid group details'; end if;
 if jsonb_typeof(p_document->'members')<>'array' or jsonb_array_length(p_document->'members') not between 1 and 100 then raise exception 'Groups need 1–100 members'; end if;
 select array_agg(x->>'id') into ids from jsonb_array_elements(p_document->'members') x;
 if not me::text=any(ids) or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Invalid or duplicate members'; end if;
 if existing.id is not null and exists(select 1 from jsonb_array_elements(existing.document->'members') x where not (x->>'id'=any(ids))) then raise exception 'Removing members with ledger history is not supported'; end if;
 for mem in select value from jsonb_array_elements(p_document->'members') loop
  if not exists(select 1 from public.profiles where id=(mem->>'id')::uuid) then raise exception 'Unknown member'; end if;
  canonical_members=canonical_members || jsonb_build_array((select public.profile_json(p) from public.profiles p where p.id=(mem->>'id')::uuid));
 end loop;
 if jsonb_typeof(p_document->'expenses')<>'array' then raise exception 'Invalid expenses'; end if;
 for expense in select value from jsonb_array_elements(p_document->'expenses') loop
  if expense->>'id' is null or expense->>'id'=any(expense_ids) then raise exception 'Invalid or duplicate expense ID'; end if;
  expense_ids=array_append(expense_ids,expense->>'id');
  if jsonb_typeof(expense)<>'object' or not(expense ?& array['id','description','amount','category','date','splitType','excluded','splits']) or exists(select 1 from jsonb_each(expense) e where e.value='null'::jsonb) then raise exception 'Missing required expense fields'; end if;
  if jsonb_typeof(expense->'amount')<>'number' or expense->>'category' not in ('Food & drinks','Travel','Stay','Groceries','Rent','Utilities','Other','Settlement') then raise exception 'Invalid expense category or amount'; end if;
  if (expense->>'amount')::numeric<>trunc((expense->>'amount')::numeric) then raise exception 'Amount must be positive integer paise'; end if;
  amount=(expense->>'amount')::bigint;
  if amount is null or amount<=0 or amount>999999999999 or (expense->>'amount')::numeric<>amount then raise exception 'Amount must be positive integer paise'; end if;
  if length(trim(expense->>'description')) not between 1 and 120 or expense->>'date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid expense description or date'; end if;
  perform (expense->>'date')::date;
  if expense->>'splitType' not in ('EQUAL','EXACT','PERCENT','SHARES','ITEMIZED','SETTLEMENT') then raise exception 'Invalid split method'; end if;
  if jsonb_typeof(expense->'excluded')<>'boolean' or jsonb_typeof(expense->'splits')<>'array' then raise exception 'Invalid expense format'; end if;
  if jsonb_array_length(expense->'splits')<1 or (select count(distinct s->>'memberId') from jsonb_array_elements(expense->'splits') s)<>jsonb_array_length(expense->'splits') then raise exception 'Duplicate or empty splits'; end if;
  paid=0;owed=0;
  for split in select value from jsonb_array_elements(expense->'splits') loop
   if not(split ?& array['memberId','paid','owed']) or jsonb_typeof(split->'paid')<>'number' or jsonb_typeof(split->'owed')<>'number' then raise exception 'Missing split fields'; end if;
   if not(split->>'memberId'=any(ids)) or split->>'paid' is null or split->>'owed' is null or (split->>'paid')::numeric<0 or (split->>'owed')::numeric<0 or (split->>'paid')::numeric<>(split->>'paid')::bigint or (split->>'owed')::numeric<>(split->>'owed')::bigint then raise exception 'Invalid split'; end if;
   paid=paid+(split->>'paid')::bigint;owed=owed+(split->>'owed')::bigint;
  end loop;
  if paid<>amount or owed<>amount then raise exception 'Paid and owed totals must match the expense'; end if;
  if expense->>'splitType'='SETTLEMENT' and not exists(select 1 from jsonb_array_elements(expense->'splits') s where s->>'memberId'=me::text and ((s->>'paid')::bigint>0 or (s->>'owed')::bigint>0)) then
   if existing.id is null or not exists(select 1 from jsonb_array_elements(existing.document->'expenses') e where e=expense) then raise exception 'Only payment participants can record a settlement'; end if;
  end if;
 end loop;
 -- Generate trusted audit entries; browser-supplied history is ignored.
 select display_name into actor from public.profiles where id=me;
 canonical_audit=coalesce(existing.document->'audit','[]'::jsonb);
 if existing.id is null then
  canonical_audit=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'actor',actor,'action','Created group','description',p_document->>'name'));
 end if;
 for expense in select value from jsonb_array_elements(p_document->'expenses') loop
  old_expense=null;
  if existing.id is not null then select e into old_expense from jsonb_array_elements(existing.document->'expenses') e where e->>'id'=expense->>'id'; end if;
  if old_expense is null or old_expense<>expense then
   event=jsonb_build_object('id',gen_random_uuid(),'at',now(),'actor',actor,'action',case when old_expense is null then case when expense->>'splitType'='SETTLEMENT' then 'Recorded settlement' else 'Added expense' end else 'Updated expense' end,'description',(expense->>'description')||' · ₹'||((expense->>'amount')::numeric/100)::text,'expenseId',expense->>'id','before',old_expense,'after',expense);
   canonical_audit=jsonb_build_array(event)||canonical_audit;
  end if;
 end loop;
 if existing.id is not null then
  for old_expense in select value from jsonb_array_elements(existing.document->'expenses') loop
   if not(old_expense->>'id'=any(expense_ids)) then canonical_audit=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'actor',actor,'action','Deleted expense','description',old_expense->>'description','expenseId',old_expense->>'id','before',old_expense))||canonical_audit; end if;
  end loop;
  if existing.document->'members'<>canonical_members then canonical_audit=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'actor',actor,'action','Updated members','description',p_document->>'name'))||canonical_audit; end if;
 end if;
 next_revision=coalesce(existing.revision,0)+1;
 p_document=jsonb_set(jsonb_set(jsonb_set(p_document,'{members}',canonical_members),'{audit}',canonical_audit),'{revision}',to_jsonb(next_revision));
 if octet_length(p_document::text)>1048576 then raise exception 'Group document including history exceeds 1 MB. Export and start a new group.'; end if;
 if existing.id is null then insert into public.ledger_groups(id,document,revision,created_by) values(gid,p_document,next_revision,me);
 else update public.ledger_groups set document=p_document,revision=next_revision,updated_at=now() where id=gid; end if;
 return next_revision;
end $$;
-- Definer helpers are not exposed as callable RPCs.
revoke all on function public.profile_json(public.profiles) from public,anon,authenticated;
revoke all on function public.current_profile_id() from public,anon;
grant execute on function public.current_profile_id() to authenticated;
revoke all on function public.my_profile(),public.register_profile(text,text,text),public.find_or_create_friend(text,text),public.update_profile(text,text),public.save_group(jsonb,integer) from public,anon;
grant execute on function public.my_profile(),public.register_profile(text,text,text),public.find_or_create_friend(text,text),public.update_profile(text,text),public.save_group(jsonb,integer) to authenticated;
-- Realtime uses the same SELECT policy, so subscribers only receive their groups.
alter publication supabase_realtime add table public.ledger_groups;

-- Private receipts: never publish the bucket or expose permanent public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receipts','receipts',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy receipt_group_read on storage.objects for select to authenticated using (
 bucket_id='receipts' and exists(select 1 from public.ledger_groups g where g.id::text=split_part(name,'/',1))
);
create policy receipt_group_upload on storage.objects for insert to authenticated with check (
 bucket_id='receipts' and exists(select 1 from public.ledger_groups g where g.id::text=split_part(name,'/',1))
);
