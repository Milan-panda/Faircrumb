-- Upgrade existing installations: group default splits, expense restoration history and payment reversal protection.
create or replace function public.save_group(p_document jsonb,p_expected integer) returns integer language plpgsql security definer set search_path='' as $$
declare
 me uuid=public.current_profile_id(); gid uuid; existing public.ledger_groups; mem jsonb; expense jsonb; split jsonb;
 amount bigint; paid bigint; owed bigint; next_revision integer; ids text[]; expense_ids text[]='{}';
 defaults jsonb; default_ids text[]; default_weight numeric; default_sum numeric;
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
 defaults=p_document->'defaultSplit';
 if defaults is not null then
  if jsonb_typeof(defaults)<>'object' or not(defaults ?& array['mode','participants','values']) or jsonb_typeof(defaults->'mode')<>'string' or defaults->>'mode' not in ('EQUAL','PERCENT','SHARES') or jsonb_typeof(defaults->'participants')<>'array' or jsonb_typeof(defaults->'values')<>'object' then raise exception 'Invalid default split'; end if;
  select array_agg(x) into default_ids from jsonb_array_elements_text(defaults->'participants') x;
  if default_ids is null or cardinality(default_ids)<1 or cardinality(default_ids)<>(select count(distinct x) from unnest(default_ids) x) or exists(select 1 from unnest(default_ids) x where not x=any(ids)) then raise exception 'Invalid default participants'; end if;
  if defaults->>'mode'<>'EQUAL' then
   default_sum=0;
   for mem in select value from jsonb_array_elements(defaults->'participants') loop
    if coalesce(defaults->'values'->>(mem#>>'{}'),case when defaults->>'mode'='SHARES' then '1' else '0' end) !~ '^[0-9]{1,7}(\.[0-9]{1,4})?$' then raise exception 'Invalid default weights'; end if;
    default_weight=coalesce(defaults->'values'->>(mem#>>'{}'),case when defaults->>'mode'='SHARES' then '1' else '0' end)::numeric;
    if default_weight>1000000 then raise exception 'Default weights are too large'; end if;
    default_sum=default_sum+default_weight;
   end loop;
   if default_sum<=0 or (defaults->>'mode'='PERCENT' and default_sum<>100) then raise exception 'Default percentages must total 100 and shares must be positive'; end if;
  end if;
 end if;
 if jsonb_typeof(p_document->'expenses')<>'array' then raise exception 'Invalid expenses'; end if;
 for expense in select value from jsonb_array_elements(p_document->'expenses') loop
  if expense->>'id' is null or expense->>'id'=any(expense_ids) then raise exception 'Invalid or duplicate expense ID'; end if;
  expense_ids=array_append(expense_ids,expense->>'id');
  previous=null;
  if existing.id is not null then select e into previous from jsonb_array_elements(existing.document->'expenses') e where e->>'id'=expense->>'id'; end if;
  if previous->>'splitType'='SETTLEMENT' and previous<>expense then raise exception 'Recorded payments cannot be edited. Undo the record and create a corrected payment.'; end if;
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
   event=jsonb_build_object('id',gen_random_uuid(),'at',now(),'actor',actor,'action',case when old_expense is null then case when expense->>'splitType'='SETTLEMENT' then 'Recorded settlement' else case when exists(select 1 from jsonb_array_elements(canonical_audit) a where a->>'action'='Deleted expense' and a->>'expenseId'=expense->>'id') then 'Restored expense' else 'Added expense' end end else 'Updated expense' end,'description',(expense->>'description')||' · ₹'||((expense->>'amount')::numeric/100)::text,'expenseId',expense->>'id','before',old_expense,'after',expense);
   canonical_audit=jsonb_build_array(event)||canonical_audit;
  end if;
 end loop;
 if existing.id is not null then
  for old_expense in select value from jsonb_array_elements(existing.document->'expenses') loop
   if not(old_expense->>'id'=any(expense_ids)) then
    if old_expense->>'splitType'='SETTLEMENT' and not exists(select 1 from jsonb_array_elements(old_expense->'splits') x where x->>'memberId'=me::text and ((x->>'paid')::bigint>0 or (x->>'owed')::bigint>0)) then raise exception 'Only payment participants can undo a settlement'; end if;
    canonical_audit=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'actor',actor,'action',case when old_expense->>'splitType'='SETTLEMENT' then 'Reversed payment' else 'Deleted expense' end,'description',old_expense->>'description','expenseId',old_expense->>'id','before',old_expense))||canonical_audit; end if;
  end loop;
  if existing.document->'defaultSplit' is distinct from p_document->'defaultSplit' then canonical_audit=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'actor',actor,'action','Updated split defaults','description',p_document->>'name','before',existing.document->'defaultSplit','after',p_document->'defaultSplit'))||canonical_audit; end if;
  if existing.document->'members'<>canonical_members then canonical_audit=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'actor',actor,'action','Updated members','description',p_document->>'name'))||canonical_audit; end if;
 end if;
 next_revision=coalesce(existing.revision,0)+1;
 p_document=jsonb_set(jsonb_set(jsonb_set(p_document,'{members}',canonical_members),'{audit}',canonical_audit),'{revision}',to_jsonb(next_revision));
 if octet_length(p_document::text)>1048576 then raise exception 'Group document including history exceeds 1 MB. Export and start a new group.'; end if;
 if existing.id is null then insert into public.ledger_groups(id,document,revision,created_by) values(gid,p_document,next_revision,me);
 else update public.ledger_groups set document=p_document,revision=next_revision,updated_at=now() where id=gid; end if;
 return next_revision;
end $$;
