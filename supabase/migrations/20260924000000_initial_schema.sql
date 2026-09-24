-- NextWebEC CRM - initial schema
-- Apply through the Supabase SQL editor or `supabase db push`.
-- The only privileged key (service_role) belongs in a server-side Edge Function,
-- never in the static GitHub Pages application.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'executive');
create type public.lead_status as enum (
  'new', 'contacted', 'interested', 'meeting_scheduled',
  'proposal_sent', 'negotiation', 'won', 'lost'
);
create type public.lead_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.activity_type as enum ('call', 'whatsapp', 'email', 'meeting', 'note', 'task');
create type public.activity_result as enum ('pending', 'completed', 'cancelled');
create type public.commission_status as enum ('pending', 'partial', 'paid');

-- A profile is created by the auth.users trigger; do not insert it from the browser.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  email text not null unique check (email = lower(email)),
  role public.app_role not null default 'executive',
  is_active boolean not null default true,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 2 and 120),
  default_price numeric(12,2) not null default 0 check (default_price >= 0),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_number bigint generated always as identity unique,
  company_name text not null check (char_length(trim(company_name)) between 1 and 160),
  contact_name text not null check (char_length(trim(contact_name)) between 1 and 160),
  job_title text,
  phone text,
  email text check (email is null or email = lower(email)),
  city text,
  website text,
  source text,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  estimated_value numeric(12,2) not null default 0 check (estimated_value >= 0),
  status public.lead_status not null default 'new',
  priority public.lead_priority not null default 'medium',
  last_contact_at timestamptz,
  next_action text,
  next_action_at timestamptz,
  notes text,
  loss_reason text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lost_lead_has_reason check (status <> 'lost' or nullif(trim(loss_reason), '') is not null),
  constraint open_lead_has_no_loss_reason check (status = 'lost' or loss_reason is null)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  type public.activity_type not null,
  subject text not null check (char_length(trim(subject)) between 1 and 180),
  body text,
  result public.activity_result not null default 'completed',
  occurred_at timestamptz not null default now(),
  due_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint task_requires_due_date check (type <> 'task' or due_at is not null)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete restrict,
  executive_id uuid not null references public.profiles(id) on delete restrict,
  total_value numeric(12,2) not null check (total_value > 0),
  collected_amount numeric(12,2) not null default 0 check (collected_amount >= 0),
  pending_balance numeric(12,2) generated always as (total_value - collected_amount) stored,
  signed_at date not null default current_date,
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collected_does_not_exceed_total check (collected_amount <= total_value)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  paid_at date not null default current_date,
  payment_method text,
  reference text,
  notes text,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.sales(id) on delete restrict,
  executive_id uuid not null references public.profiles(id) on delete restrict,
  generated_amount numeric(12,2) not null default 0 check (generated_amount >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  pending_amount numeric(12,2) generated always as (generated_amount - paid_amount) stored,
  status public.commission_status not null default 'pending',
  paid_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paid_does_not_exceed_generated check (paid_amount <= generated_amount),
  constraint paid_commission_has_date check (paid_amount = 0 or paid_at is not null)
);

-- Immutable business audit records. The application never receives INSERT/UPDATE/DELETE grants.
create table public.lead_status_history (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete restrict,
  from_status public.lead_status,
  to_status public.lead_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create table public.lead_audit_log (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete restrict,
  operation text not null check (operation in ('INSERT', 'UPDATE')),
  actor_id uuid references public.profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

-- Indexes match the dashboard, Kanban and due-activity queries.
create index leads_owner_status_idx on public.leads (owner_id, status, updated_at desc);
create index leads_next_action_idx on public.leads (owner_id, next_action_at) where next_action_at is not null;
create index leads_status_idx on public.leads (status, updated_at desc);
create index activities_lead_occurred_idx on public.activities (lead_id, occurred_at desc);
create index activities_due_idx on public.activities (due_at) where result = 'pending';
create index sales_executive_signed_idx on public.sales (executive_id, signed_at desc);
create index payments_sale_paid_idx on public.payments (sale_id, paid_at desc);
create index commissions_executive_status_idx on public.commissions (executive_id, status);
create index lead_status_history_lead_idx on public.lead_status_history (lead_id, changed_at desc);
create index lead_audit_log_lead_idx on public.lead_audit_log (lead_id, created_at desc);

-- SECURITY DEFINER helpers deliberately have a fixed search_path. They make RLS
-- checks safe and avoid recursive policy evaluation on profiles.
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_active
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.current_actor_id()
returns uuid language sql stable security definer set search_path = public
as $$ select auth.uid(); $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Browser calls always receive their actor from the verified JWT, never from a
-- client-supplied UUID. A trusted service call may explicitly provide an actor.
create or replace function public.protect_lead_ownership()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
    end if;
    return new;
  end if;

  if auth.uid() is not null then
    if not public.is_admin() and new.owner_id is distinct from old.owner_id then
      raise exception 'Only an administrator can reassign a lead';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'The lead creator cannot be changed';
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.prepare_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end;
$$;

create or replace function public.prepare_sale()
returns trigger language plpgsql security definer set search_path = public
declare lead_owner uuid; lead_state public.lead_status;
begin
  select owner_id, status into lead_owner, lead_state from public.leads where id = new.lead_id;
  if lead_owner is null then raise exception 'Lead not found'; end if;
  if lead_state <> 'won' then raise exception 'A sale can only be registered for a won lead'; end if;
  if tg_op = 'INSERT' then
    new.executive_id := lead_owner;
    new.collected_amount := 0;
    if auth.uid() is not null then
      new.created_by := auth.uid(); new.updated_by := auth.uid();
    end if;
  elsif auth.uid() is not null then
    if not public.is_admin() and (new.lead_id is distinct from old.lead_id or new.executive_id is distinct from old.executive_id) then
      raise exception 'Only an administrator can change a sale owner or lead';
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.prepare_payment()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then new.recorded_by := auth.uid(); end if;
  return new;
end;
$$;

create or replace function public.recalculate_sale_and_commission()
returns trigger language plpgsql security definer set search_path = public
declare total_collected numeric(12,2); sale_executive uuid;
begin
  -- Marks this transaction-local write as originating in the trusted payment
  -- trigger, rather than as a browser attempting to mark a commission paid.
  perform set_config('nextwebec.recalculate_commission', 'true', true);
  select coalesce(sum(amount), 0) into total_collected from public.payments where sale_id = new.sale_id;
  update public.sales set collected_amount = total_collected where id = new.sale_id returning executive_id into sale_executive;
  insert into public.commissions (sale_id, executive_id, generated_amount, paid_amount, status)
  values (new.sale_id, sale_executive, round(total_collected * 0.40, 2), 0, 'pending')
  on conflict (sale_id) do update set
    generated_amount = excluded.generated_amount,
    status = case
      when public.commissions.paid_amount = excluded.generated_amount then 'paid'::public.commission_status
      when public.commissions.paid_amount > 0 then 'partial'::public.commission_status
      else 'pending'::public.commission_status
    end,
    updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_commission_payment()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if current_setting('nextwebec.recalculate_commission', true) is distinct from 'true'
     and not public.is_admin() and auth.uid() is not null then
    raise exception 'Only an administrator can mark commissions as paid';
  end if;
  new.status := case
    when new.paid_amount = new.generated_amount then 'paid'::public.commission_status
    when new.paid_amount > 0 then 'partial'::public.commission_status
    else 'pending'::public.commission_status
  end;
  if new.paid_amount = 0 then new.paid_at := null; end if;
  return new;
end;
$$;

create or replace function public.audit_lead_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.lead_audit_log (lead_id, operation, actor_id, before_data, after_data)
  values (
    new.id, tg_op, new.updated_by,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.lead_status_history (lead_id, from_status, to_status, changed_by)
    values (new.id, case when tg_op = 'UPDATE' then old.status else null end, new.status, new.updated_by);
  end if;
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger services_set_updated_at before update on public.services for each row execute function public.set_updated_at();
create trigger leads_set_actor before insert or update on public.leads for each row execute function public.protect_lead_ownership();
create trigger leads_set_updated_at before update on public.leads for each row execute function public.set_updated_at();
create trigger activities_set_actor before insert on public.activities for each row execute function public.prepare_activity();
create trigger sales_set_actor before insert or update on public.sales for each row execute function public.prepare_sale();
create trigger sales_set_updated_at before update on public.sales for each row execute function public.set_updated_at();
create trigger payments_set_actor before insert on public.payments for each row execute function public.prepare_payment();
create trigger payments_recalculate after insert on public.payments for each row execute function public.recalculate_sale_and_commission();
create trigger commissions_validate before insert or update on public.commissions for each row execute function public.validate_commission_payment();
create trigger commissions_set_updated_at before update on public.commissions for each row execute function public.set_updated_at();
create trigger leads_audit after insert or update on public.leads for each row execute function public.audit_lead_change();

-- Supabase Auth hook: an account created by the admin Edge Function gets an
-- executive profile by default. The first administrator is promoted manually
-- in the setup step documented below.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    lower(new.email)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.handle_new_user();

-- Seeded services are editable by an admin later.
insert into public.services (name) values
  ('Landing page / rediseño básico'),
  ('Web profesional'),
  ('Web empresarial'),
  ('Web corporativa'),
  ('Proyecto personalizado');

-- RLS is explicitly enabled on every application table.
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.sales enable row level security;
alter table public.payments enable row level security;
alter table public.commissions enable row level security;
alter table public.lead_status_history enable row level security;
alter table public.lead_audit_log enable row level security;

-- Profiles: no browser policy can alter roles or deactivate a colleague.
create policy "profiles_select_self_or_admin" on public.profiles for select to authenticated
  using (public.is_active_user() and (id = auth.uid() or public.is_admin()));
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (public.is_active_user() and id = auth.uid())
  with check (public.is_active_user() and id = auth.uid());

create policy "services_read_active" on public.services for select to authenticated
  using (public.is_active_user() and (is_active or public.is_admin()));
create policy "services_admin_manage" on public.services for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "leads_read_owner_or_admin" on public.leads for select to authenticated
  using (public.is_active_user() and (owner_id = auth.uid() or public.is_admin()));
create policy "leads_create_own_or_admin" on public.leads for insert to authenticated
  with check (public.is_active_user() and (public.is_admin() or owner_id = auth.uid()));
create policy "leads_update_owner_or_admin" on public.leads for update to authenticated
  using (public.is_active_user() and (owner_id = auth.uid() or public.is_admin()))
  with check (public.is_active_user() and (owner_id = auth.uid() or public.is_admin()));

create policy "activities_read_visible_lead" on public.activities for select to authenticated
  using (public.is_active_user() and exists (select 1 from public.leads l where l.id = lead_id and (l.owner_id = auth.uid() or public.is_admin())));
create policy "activities_create_for_visible_lead" on public.activities for insert to authenticated
  with check (public.is_active_user() and exists (select 1 from public.leads l where l.id = lead_id and (l.owner_id = auth.uid() or public.is_admin())));

create policy "sales_read_owner_or_admin" on public.sales for select to authenticated
  using (public.is_active_user() and (executive_id = auth.uid() or public.is_admin()));
create policy "sales_create_owner_or_admin" on public.sales for insert to authenticated
  with check (public.is_active_user() and (public.is_admin() or executive_id = auth.uid()));
create policy "sales_update_owner_or_admin" on public.sales for update to authenticated
  using (public.is_active_user() and (executive_id = auth.uid() or public.is_admin()))
  with check (public.is_active_user() and (executive_id = auth.uid() or public.is_admin()));

create policy "payments_read_sale_owner_or_admin" on public.payments for select to authenticated
  using (public.is_active_user() and exists (select 1 from public.sales s where s.id = sale_id and (s.executive_id = auth.uid() or public.is_admin())));
create policy "payments_create_sale_owner_or_admin" on public.payments for insert to authenticated
  with check (public.is_active_user() and exists (select 1 from public.sales s where s.id = sale_id and (s.executive_id = auth.uid() or public.is_admin())));

create policy "commissions_read_owner_or_admin" on public.commissions for select to authenticated
  using (public.is_active_user() and (executive_id = auth.uid() or public.is_admin()));
create policy "commissions_admin_update" on public.commissions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "lead_status_history_read_visible_lead" on public.lead_status_history for select to authenticated
  using (public.is_active_user() and exists (select 1 from public.leads l where l.id = lead_id and (l.owner_id = auth.uid() or public.is_admin())));
create policy "lead_audit_log_read_visible_lead" on public.lead_audit_log for select to authenticated
  using (public.is_active_user() and exists (select 1 from public.leads l where l.id = lead_id and (l.owner_id = auth.uid() or public.is_admin())));

-- Least privilege at the SQL layer supplements RLS. Role and active-state changes
-- are performed only by a trusted Supabase Edge Function using service_role.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from public;
revoke all on public.lead_status_history, public.lead_audit_log from authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.services, public.leads, public.activities, public.sales, public.payments, public.commissions, public.lead_status_history, public.lead_audit_log to authenticated;
grant insert on public.leads, public.activities, public.sales, public.payments to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant update (company_name, contact_name, job_title, phone, email, city, website, source, service_id, estimated_value, status, priority, last_contact_at, next_action, next_action_at, notes, loss_reason) on public.leads to authenticated;
grant update (total_value, signed_at, notes) on public.sales to authenticated;
grant update (paid_amount, paid_at, notes) on public.commissions to authenticated;
grant insert, update on public.services to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Run once after creating the first account in Supabase Auth:
-- update public.profiles set role = 'admin' where email = 'admin@nextwebec.com';
