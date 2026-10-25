-- Notifications are derived from validated ledger writes, never browser recipients.
create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 group_id uuid not null references public.ledger_groups(id) on delete cascade,
 expense_id text not null,
 actor_name text not null,
 group_name text not null,
 description text not null,
 amount bigint not null,
 share bigint not null,
 created_at timestamptz not null default now(),
 read_at timestamptz,
 unique(recipient_id,group_id,expense_id)
);
create index notifications_recipient_created on public.notifications(recipient_id,created_at desc,id desc);
create index notifications_unread on public.notifications(recipient_id) where read_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from public,anon,authenticated;
grant select on public.notifications to authenticated;
create policy notifications_own on public.notifications for select to authenticated
 using(recipient_id=(select public.current_profile_id()));

create function private.notify_new_expenses() returns trigger
language plpgsql security definer set search_path='' as $$
declare expense jsonb; previous jsonb; split jsonb; me uuid=public.current_profile_id(); actor text;
begin
 -- Profile canonicalization and group-invite writes have no new expenses.
 if me is null then return new; end if;
 if tg_op='UPDATE' then previous=old.document; end if;
 select display_name into actor from public.profiles where id=me;
 for expense in select value from jsonb_array_elements(new.document->'expenses') loop
  if expense->>'splitType'='SETTLEMENT' then continue; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(previous->'expenses','[]')) e where e->>'id'=expense->>'id') then continue; end if;
  -- Restoring a deleted expense is not a newly added bill.
  if exists(select 1 from jsonb_array_elements(coalesce(previous->'audit','[]')) a where a->>'expenseId'=expense->>'id') then continue; end if;
  for split in select value from jsonb_array_elements(expense->'splits') loop
   if split->>'memberId'=me::text or ((split->>'paid')::bigint=0 and (split->>'owed')::bigint=0) then continue; end if;
   insert into public.notifications(recipient_id,actor_id,group_id,expense_id,actor_name,group_name,description,amount,share)
   values((split->>'memberId')::uuid,me,new.id,expense->>'id',actor,new.document->>'name',expense->>'description',(expense->>'amount')::bigint,(split->>'owed')::bigint)
   on conflict(recipient_id,group_id,expense_id) do nothing;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function private.notify_new_expenses() from public,anon,authenticated;
create trigger notify_new_expenses after insert or update on public.ledger_groups
 for each row execute function private.notify_new_expenses();

create function public.notification_feed() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'unread',(select count(*) from public.notifications where recipient_id=public.current_profile_id() and read_at is null),
 'items',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc) from
 (select * from public.notifications where recipient_id=public.current_profile_id() order by created_at desc,id desc limit 100) n),'[]'::jsonb))
$$;
create function public.mark_notifications_read(p_id uuid default null) returns void
language sql security definer set search_path='' as $$
 update public.notifications set read_at=now()
 where recipient_id=public.current_profile_id() and read_at is null and (p_id is null or id=p_id)
$$;
revoke all on function public.notification_feed(),public.mark_notifications_read(uuid) from public,anon;
grant execute on function public.notification_feed(),public.mark_notifications_read(uuid) to authenticated;
alter publication supabase_realtime add table public.notifications;
