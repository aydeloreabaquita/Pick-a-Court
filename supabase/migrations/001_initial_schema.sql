create extension if not exists btree_gist;
create extension if not exists pgcrypto;

create type public.user_role as enum ('player', 'staff', 'admin');
create type public.court_status as enum ('available', 'maintenance', 'inactive');
create type public.booking_status as enum ('pending_payment', 'confirmed', 'cancelled', 'completed', 'expired');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded', 'expired');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  role public.user_role not null default 'player',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  address text not null,
  timezone text not null default 'Asia/Manila',
  opens_at time not null default '06:00',
  closes_at time not null default '23:00',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  sport text not null,
  court_type text not null,
  hourly_rate integer not null check (hourly_rate >= 0),
  currency text not null default 'PHP' check (char_length(currency) = 3),
  status public.court_status not null default 'available',
  description text,
  created_at timestamptz not null default now(),
  unique (venue_id, name)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  court_id uuid not null references public.courts(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  amount integer not null check (amount >= 0),
  currency text not null default 'PHP' check (char_length(currency) = 3),
  status public.booking_status not null default 'pending_payment',
  notes text,
  expires_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (
    court_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending_payment', 'confirmed'));

create index bookings_user_id_idx on public.bookings(user_id, starts_at desc);
create index bookings_court_id_idx on public.bookings(court_id, starts_at);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  provider text not null default 'paymongo',
  provider_reference text unique,
  checkout_url text,
  amount integer not null check (amount >= 0),
  currency text not null default 'PHP',
  status public.payment_status not null default 'pending',
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_events (
  provider_event_id text primary key,
  provider text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create table public.maintenance_blocks (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute procedure public.updated_at();
create trigger bookings_updated_at before update on public.bookings
for each row execute procedure public.updated_at();
create trigger payments_updated_at before update on public.payments
for each row execute procedure public.updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.is_admin()
  then
    raise exception 'Only administrators may change account roles';
  end if;
  return new;
end;
$$;

create trigger protect_profile_role_before_update
before update on public.profiles
for each row execute procedure public.protect_profile_role();

alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.courts enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.maintenance_blocks enable row level security;

create policy "profiles read own" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles update own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "venues public read" on public.venues for select using (active or public.is_admin());
create policy "courts public read" on public.courts for select using (true);
create policy "bookings read own" on public.bookings for select using (user_id = auth.uid() or public.is_admin());
create policy "bookings create own" on public.bookings for insert with check (user_id = auth.uid());
create policy "bookings cancel own" on public.bookings for update using (user_id = auth.uid() or public.is_admin());
create policy "payments read own" on public.payments for select using (user_id = auth.uid() or public.is_admin());
create policy "maintenance public read" on public.maintenance_blocks for select using (true);
create policy "admin manages venues" on public.venues for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manages courts" on public.courts for all using (public.is_admin()) with check (public.is_admin());
create policy "admin manages maintenance" on public.maintenance_blocks for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.create_booking(
  p_court_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_notes text default null
) returns public.bookings
language plpgsql security invoker set search_path = '' as $$
declare
  selected_court public.courts;
  result public.bookings;
  duration_hours numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_starts_at <= now() then raise exception 'Booking must start in the future'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Invalid booking window'; end if;

  select * into selected_court from public.courts where id = p_court_id and status = 'available';
  if not found then raise exception 'Court is unavailable'; end if;

  if exists (
    select 1 from public.maintenance_blocks
    where court_id = p_court_id
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then raise exception 'Court is under maintenance'; end if;

  duration_hours := extract(epoch from (p_ends_at - p_starts_at)) / 3600;
  insert into public.bookings (
    user_id, court_id, starts_at, ends_at, amount, currency, notes, expires_at
  ) values (
    auth.uid(), p_court_id, p_starts_at, p_ends_at,
    ceil(duration_hours * selected_court.hourly_rate)::integer,
    selected_court.currency, p_notes, now() + interval '15 minutes'
  ) returning * into result;
  return result;
exception
  when exclusion_violation then raise exception 'Selected time is no longer available';
end;
$$;

grant execute on function public.create_booking(uuid,timestamptz,timestamptz,text) to authenticated;
