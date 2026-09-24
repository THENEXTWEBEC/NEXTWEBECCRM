-- Complete the CRM application model and tighten administrative money operations.
alter type public.lead_status add value if not exists 'meeting_completed';
alter type public.activity_type add value if not exists 'proposal';
alter type public.activity_type add value if not exists 'other';
alter type public.lead_status add value if not exists 'awaiting_payment';

alter table public.profiles add column if not exists phone text;
alter table public.leads add column if not exists whatsapp text;
alter table public.leads add column if not exists country text;
alter table public.leads add column if not exists lead_origin text not null default 'self_generated'
  check (lead_origin in ('self_generated','company_assigned','referral','other'));
alter table public.leads add column if not exists original_owner_id uuid references public.profiles(id) on delete restrict;
alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists deleted_by uuid references public.profiles(id) on delete restrict;
update public.leads set original_owner_id=owner_id where original_owner_id is null;
alter table public.leads alter column original_owner_id set not null;

create index if not exists leads_phone_normalized_idx on public.leads (regexp_replace(phone, '[^0-9]', '', 'g')) where phone is not null;
create index if not exists leads_email_normalized_idx on public.leads (lower(email)) where email is not null;
create index if not exists leads_company_normalized_idx on public.leads (lower(trim(company_name)));

create or replace function public.protect_lead_ownership()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
      if not public.is_admin() then new.owner_id := auth.uid(); end if;
    end if;
    new.original_owner_id := new.owner_id;
    new.company_name := trim(regexp_replace(new.company_name, '[[:space:]]+', ' ', 'g'));
    new.contact_name := trim(regexp_replace(new.contact_name, '[[:space:]]+', ' ', 'g'));
    new.phone := nullif(regexp_replace(coalesce(new.phone,''), '[^+0-9]', '', 'g'), '');
    new.email := nullif(lower(trim(new.email)), '');
    if nullif(trim(coalesce(new.website,'')),'') is not null then
      new.website := 'https://' || regexp_replace(regexp_replace(lower(trim(new.website)), '^https?://', '', 'i'), '^www[.]', '', 'i');
    else new.website := null; end if;
    return new;
  end if;
  if new.original_owner_id is distinct from old.original_owner_id then
    raise exception 'Original lead ownership cannot be changed';
  end if;
  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Original registration details cannot be changed';
  end if;
  if auth.uid() is not null then
    if not public.is_admin() and (new.owner_id is distinct from old.owner_id or new.deleted_at is distinct from old.deleted_at) then
      raise exception 'Only an administrator can reassign or archive a lead';
    end if;
    new.updated_by := auth.uid();
    if public.is_admin() and new.deleted_at is distinct from old.deleted_at then
      new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
    end if;
  end if;
  new.company_name := trim(regexp_replace(new.company_name, '[[:space:]]+', ' ', 'g'));
  new.contact_name := trim(regexp_replace(new.contact_name, '[[:space:]]+', ' ', 'g'));
  new.phone := nullif(regexp_replace(coalesce(new.phone,''), '[^+0-9]', '', 'g'), '');
  new.email := nullif(lower(trim(new.email)), '');
  if nullif(trim(coalesce(new.website,'')),'') is not null then
    new.website := 'https://' || regexp_replace(regexp_replace(lower(trim(new.website)), '^https?://', '', 'i'), '^www[.]', '', 'i');
  else new.website := null; end if;
  return new;
end;
$$;

-- A narrow duplicate check lets an authenticated user learn only enough to avoid
-- a collision; RLS continues to hide the rest of a colleague's lead record.
create or replace function public.check_lead_duplicate(
  p_phone text default null, p_email text default null, p_website text default null,
  p_company text default null, p_contact text default null
)
returns table(company_name text, owner_name text, created_at timestamptz, status public.lead_status, match_reason text)
language plpgsql stable security definer set search_path = public
as $$
declare actor uuid := auth.uid(); phone_key text; email_key text; domain_key text; company_key text; contact_key text;
begin
  if actor is null or not public.is_active_user() then raise exception 'Authentication required'; end if;
  phone_key := nullif(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g'), '');
  email_key := nullif(lower(trim(coalesce(p_email,''))), '');
  domain_key := nullif(lower(regexp_replace(split_part(regexp_replace(trim(coalesce(p_website,'')), '^https?://', '', 'i'), '/', 1), '^www[.]', '', 'i')), '');
  company_key := nullif(lower(trim(regexp_replace(coalesce(p_company,''), '[[:space:]]+', ' ', 'g'))), '');
  contact_key := nullif(lower(trim(regexp_replace(coalesce(p_contact,''), '[[:space:]]+', ' ', 'g'))), '');
  return query
  select l.company_name, p.full_name, l.created_at, l.status,
    case when phone_key is not null and regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g')=phone_key then 'phone'
         when email_key is not null and lower(coalesce(l.email,''))=email_key then 'email'
         when domain_key is not null and lower(regexp_replace(split_part(regexp_replace(trim(coalesce(l.website,'')), '^https?://', '', 'i'), '/', 1), '^www[.]', '', 'i'))=domain_key then 'website'
         when company_key is not null and lower(trim(regexp_replace(l.company_name, '[[:space:]]+', ' ', 'g')))=company_key
           and contact_key is not null and lower(trim(regexp_replace(l.contact_name, '[[:space:]]+', ' ', 'g')))=contact_key then 'contact_company'
         else 'company' end
  from public.leads l join public.profiles p on p.id=l.owner_id
  where l.deleted_at is null and (
    (phone_key is not null and regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g')=phone_key)
    or (email_key is not null and lower(coalesce(l.email,''))=email_key)
    or (domain_key is not null and lower(regexp_replace(split_part(regexp_replace(trim(coalesce(l.website,'')), '^https?://', '', 'i'), '/', 1), '^www[.]', '', 'i'))=domain_key)
    or (company_key is not null and lower(trim(regexp_replace(l.company_name, '[[:space:]]+', ' ', 'g')))=company_key
       and (contact_key is null or lower(trim(regexp_replace(l.contact_name, '[[:space:]]+', ' ', 'g')))=contact_key))
  )
  order by case when phone_key is not null and regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g')=phone_key then 1
                when email_key is not null and lower(coalesce(l.email,''))=email_key then 2
                when domain_key is not null and lower(regexp_replace(split_part(regexp_replace(trim(coalesce(l.website,'')), '^https?://', '', 'i'), '/', 1), '^www[.]', '', 'i'))=domain_key then 3
                else 4 end, l.created_at
  limit 1;
end;
$$;
revoke all on function public.check_lead_duplicate(text,text,text,text,text) from public, anon;
grant execute on function public.check_lead_duplicate(text,text,text,text,text) to authenticated;

-- Only administrators confirm client receipts and commission disbursements.
drop policy if exists payments_create_sale_owner_or_admin on public.payments;
create policy payments_admin_insert on public.payments for insert to authenticated
  with check (public.is_admin() and exists (select 1 from public.sales s where s.id=sale_id));
revoke insert on public.payments from authenticated;
grant insert on public.payments to authenticated;

-- Keep soft-delete controls at the database layer; standard users cannot set them.
grant update (deleted_at) on public.leads to authenticated;
create policy leads_admin_soft_delete on public.leads for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Keep audit and ownership history readable only while the parent lead is visible.
-- SECURITY DEFINER RPC returns a minimal duplicate disclosure for collision prevention.

-- Serialize lead creation and perform duplicate detection plus insert atomically.
-- At this team size, one short transaction-wide lock is preferable to any chance
-- of two representatives claiming the same record at the same time.
create or replace function public.create_lead_if_unique(
  p_company text, p_contact text, p_phone text default null, p_email text default null,
  p_website text default null, p_service_id uuid default null, p_estimated_value numeric default 0,
  p_source text default null, p_lead_origin text default 'self_generated', p_notes text default null
)
returns table(created boolean, lead_id uuid, company_name text, owner_name text, created_at timestamptz, status public.lead_status)
language plpgsql security definer set search_path = public
as $$
declare actor uuid := auth.uid(); existing record; new_id uuid;
begin
  if actor is null or not public.is_active_user() then raise exception 'Authentication required'; end if;
  if nullif(trim(p_company),'') is null or nullif(trim(p_contact),'') is null then raise exception 'Company and contact are required'; end if;
  if p_estimated_value is null or p_estimated_value < 0 then raise exception 'Estimated value cannot be negative'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nextwebec:create_lead', 0));
  select * into existing from public.check_lead_duplicate(p_phone,p_email,p_website,p_company,p_contact) limit 1;
  if existing.company_name is not null then
    return query select false, null::uuid, existing.company_name, existing.owner_name, existing.created_at, existing.status;
    return;
  end if;
  insert into public.leads(company_name,contact_name,phone,email,website,service_id,estimated_value,source,
      lead_origin,notes,owner_id,original_owner_id,created_by,updated_by)
  values(trim(regexp_replace(p_company,'[[:space:]]+',' ','g')),
      trim(regexp_replace(p_contact,'[[:space:]]+',' ','g')),
      nullif(regexp_replace(coalesce(p_phone,''),'[^+0-9]','','g'),''),
      nullif(lower(trim(coalesce(p_email,''))),''),
      nullif(lower(regexp_replace(trim(coalesce(p_website,'')),'^https?://','https://','i')),''),
      p_service_id,greatest(p_estimated_value,0),nullif(trim(p_source),''),coalesce(p_lead_origin,'self_generated'),
      nullif(trim(p_notes),''),actor,actor,actor,actor)
  returning id into new_id;
  return query select true,new_id,trim(p_company),p.full_name,l.created_at,l.status
    from public.leads l join public.profiles p on p.id=l.owner_id where l.id=new_id;
end;
$$;
revoke all on function public.create_lead_if_unique(text,text,text,text,text,uuid,numeric,text,text,text) from public, anon;
grant execute on function public.create_lead_if_unique(text,text,text,text,text,uuid,numeric,text,text,text) to authenticated;
-- All lead creation must go through the atomic duplicate check.
revoke insert on public.leads from authenticated;

-- Archived opportunities are excluded from sellers' lead and audit views.
drop policy if exists leads_read_owner_or_admin on public.leads;
create policy leads_read_owner_or_admin on public.leads for select to authenticated
  using (public.is_active_user() and ((owner_id = auth.uid() and deleted_at is null) or public.is_admin()));
drop policy if exists leads_update_owner_or_admin on public.leads;
create policy leads_update_owner_or_admin on public.leads for update to authenticated
  using (public.is_active_user() and ((owner_id = auth.uid() and deleted_at is null) or public.is_admin()))
  with check (public.is_active_user() and ((owner_id = auth.uid() and deleted_at is null) or public.is_admin()));

-- Seed editable reference prices for projects created from an earlier setup.
update public.services set default_price=250 where name='Landing page / rediseño básico' and default_price=0;
update public.services set default_price=450 where name='Web profesional' and default_price=0;
update public.services set default_price=750 where name='Web empresarial' and default_price=0;
update public.services set default_price=1350 where name='Web corporativa' and default_price=0;
insert into public.services(name,default_price) values ('Proyecto corporativo amplio',2000),('Otro / personalizado',0)
on conflict (name) do nothing;

-- Provide only display names needed to attribute timeline entries across the team.
create or replace function public.get_profile_names()
returns table(id uuid, full_name text)
language sql stable security definer set search_path = public
as $$
  select p.id,p.full_name from public.profiles p where public.is_active_user();
$$;
revoke all on function public.get_profile_names() from public, anon;
grant execute on function public.get_profile_names() to authenticated;
