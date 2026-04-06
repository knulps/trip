-- Trip 앱 DB 스키마
-- Supabase SQL Editor에서 실행

-- 1. trips
create table if not exists public.trips (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  start_date   date not null,
  end_date     date not null,
  created_by   uuid not null references auth.users(id) on delete cascade,
  invite_token uuid not null default gen_random_uuid() unique,
  created_at   timestamptz not null default now()
);

-- 2. trip_members
create table if not exists public.trip_members (
  trip_id    uuid not null references public.trips(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (trip_id, user_id)
);

-- 3. days
create table if not exists public.days (
  id       uuid primary key default gen_random_uuid(),
  trip_id  uuid not null references public.trips(id) on delete cascade,
  date     date not null,
  unique (trip_id, date)
);

-- 4. places
-- order_key: fractional-indexing 라이브러리 사용 (varchar)
create table if not exists public.places (
  id         uuid primary key default gen_random_uuid(),
  day_id     uuid not null references public.days(id) on delete cascade,
  order_key  text not null,
  name       text not null,
  lat        double precision not null,
  lng        double precision not null,
  address    text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists places_day_id_order_key on public.places (day_id, order_key);

-- =============================
-- Row Level Security (RLS)
-- =============================

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.days enable row level security;
alter table public.places enable row level security;

-- trips: 멤버만 조회, owner만 수정
create policy "trips_select" on public.trips
  for select using (
    id in (select trip_id from public.trip_members where user_id = auth.uid())
  );

create policy "trips_insert" on public.trips
  for insert with check (created_by = auth.uid());

create policy "trips_update" on public.trips
  for update using (created_by = auth.uid());

-- trip_members: 내 멤버십만 조회 (INSERT는 서버 측 service role만)
create policy "trip_members_select" on public.trip_members
  for select using (
    trip_id in (select trip_id from public.trip_members where user_id = auth.uid())
  );

-- days: 멤버만 CRUD
create policy "days_all" on public.days
  for all using (
    trip_id in (select trip_id from public.trip_members where user_id = auth.uid())
  );

-- places: 멤버만 CRUD
create policy "places_all" on public.places
  for all using (
    day_id in (
      select d.id from public.days d
      join public.trip_members tm on tm.trip_id = d.trip_id
      where tm.user_id = auth.uid()
    )
  );

-- =============================
-- Realtime
-- =============================

-- days, places 테이블 Realtime 활성화
alter publication supabase_realtime add table public.days;
alter publication supabase_realtime add table public.places;
