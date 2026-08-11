-- Trip 앱 DB 스키마
-- Supabase SQL Editor에서 실행
--
-- 이 파일은 몇 번을 다시 실행해도 안전하다 (re-runnable).
--   * 테이블/인덱스: create ... if not exists
--   * 컬럼: alter table ... add column if not exists
--   * 정책·함수: drop policy if exists 후 create policy / create or replace function
--   * Realtime publication: 이미 등록된 테이블은 건너뛴다
-- 새 DB 프로비저닝과 기존 DB 마이그레이션 양쪽에 같은 파일을 쓴다.

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

-- 4-1. places 추가 컬럼
-- 앱은 방문 시간과 메모를 읽고 쓴다 (types/supabase.ts 의 visit_time / memo).
-- visit_time 은 'HH:MM' 문자열로 저장되고 화면에서는 앞 5글자만 잘라 쓴다 → time 타입.
alter table public.places add column if not exists visit_time time;
alter table public.places add column if not exists memo       text;

create index if not exists places_day_id_order_key on public.places (day_id, order_key);

-- =============================
-- RLS 헬퍼 함수
-- =============================
--
-- trip_members 에 대한 정책 안에서 trip_members 를 다시 조회하면
-- 그 하위 조회에도 같은 정책이 또 적용되어 Postgres 가
-- "infinite recursion detected in policy for relation" (42P17) 에러를 낸다.
-- security definer 함수는 함수 소유자 권한으로 실행되어 호출자의 RLS 를 타지 않으므로
-- 재귀 없이 멤버십을 확인할 수 있다.
-- search_path 를 고정해 search_path 조작을 통한 우회를 막는다.

create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.trip_members tm
    where tm.trip_id = p_trip_id
      and tm.user_id = auth.uid()
  );
$$;

-- 여행 생성자 확인.
-- 다른 테이블(trip_members)의 정책 안에서 trips 를 조회하므로,
-- trips 의 정책이 어떻게 바뀌든 판정이 흔들리지 않도록 여기도 security definer 로 둔다.
create or replace function public.is_trip_creator(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and t.created_by = auth.uid()
  );
$$;

revoke execute on function public.is_trip_member(uuid) from public;
revoke execute on function public.is_trip_creator(uuid) from public;
grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.is_trip_creator(uuid) to authenticated;

-- =============================
-- Row Level Security (RLS)
-- =============================

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.days enable row level security;
alter table public.places enable row level security;

-- trips: 멤버와 생성자가 조회, 생성자만 수정/삭제
--
-- 생성자를 조회 대상에 넣어야 하는 이유:
-- 앱은 여행을 .insert(...).select('id') 로 만들고, PostgREST 는 이걸
-- INSERT ... RETURNING 으로 보낸다. Postgres 는 RETURNING 으로 돌려줄 행이
-- 그 테이블의 select 정책을 반드시 통과해야 하고, 통과하지 못하면
-- 행을 조용히 빼는 게 아니라 에러(42501)를 낸다.
-- 이 시점에는 trip_members 행이 아직 없으므로(다음 문에서 넣는다)
-- 멤버 조건만 두면 여행 생성 자체가 실패한다.
-- created_by 는 trips_insert 가 이미 auth.uid() 로 강제하는 값이라
-- 이 조건으로 넓어지는 범위는 '본인이 만든 행' 뿐이고,
-- trips_update / trips_delete 의 조건과도 같다.
-- (컬럼 직접 비교라 trips 를 다시 조회하지 않으므로 재귀도 생기지 않는다)
drop policy if exists "trips_select" on public.trips;
create policy "trips_select" on public.trips
  for select using (created_by = auth.uid() or public.is_trip_member(id));

drop policy if exists "trips_insert" on public.trips;
create policy "trips_insert" on public.trips
  for insert with check (created_by = auth.uid());

drop policy if exists "trips_update" on public.trips;
create policy "trips_update" on public.trips
  for update using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- 여행 생성 도중 멤버 등록이 실패했을 때 앱이 방금 만든 여행을 되돌릴 수 있어야 한다
drop policy if exists "trips_delete" on public.trips;
create policy "trips_delete" on public.trips
  for delete using (created_by = auth.uid());

-- trip_members: 내가 속한 여행의 멤버만 조회
drop policy if exists "trip_members_select" on public.trip_members;
create policy "trip_members_select" on public.trip_members
  for select using (public.is_trip_member(trip_id));

-- trip_members: 본인이 만든 여행에 '본인' 멤버십만 넣을 수 있다.
--   user_id = auth.uid()      → 남을 임의로 끼워 넣지 못한다
--   is_trip_creator(trip_id)  → 남의 여행에 마음대로 참여하지 못한다
-- 초대 링크를 통한 참여는 service role 로 도는 /invite/[token] 라우트가 처리하므로
-- 이 정책을 더 열어 줄 필요가 없다.
drop policy if exists "trip_members_insert" on public.trip_members;
create policy "trip_members_insert" on public.trip_members
  for insert with check (
    user_id = auth.uid()
    and public.is_trip_creator(trip_id)
  );

-- days: 멤버만 CRUD
drop policy if exists "days_all" on public.days;
create policy "days_all" on public.days
  for all using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- places: 멤버만 CRUD
drop policy if exists "places_all" on public.places;
create policy "places_all" on public.places
  for all using (
    exists (
      select 1 from public.days d
      where d.id = day_id and public.is_trip_member(d.trip_id)
    )
  )
  with check (
    exists (
      select 1 from public.days d
      where d.id = day_id and public.is_trip_member(d.trip_id)
    )
  );

-- =============================
-- Realtime
-- =============================

-- days, places 테이블 Realtime 활성화 (이미 등록돼 있으면 건너뛴다)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'days'
  ) then
    alter publication supabase_realtime add table public.days;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'places'
  ) then
    alter publication supabase_realtime add table public.places;
  end if;
end $$;
