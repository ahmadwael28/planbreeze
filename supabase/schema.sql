-- Planbreeze cloud storage.
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.

create table if not exists public.projects (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  name       text        not null default 'Untitled plan',
  data       jsonb       not null,
  -- Incremented on every save; used to detect edits made on another device.
  version    integer     not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  -- Keep a single plan (including any background drawing) to a sane size.
  constraint projects_data_size check (pg_column_size(data) < 8000000)
);

create index if not exists projects_user_updated_idx on public.projects (user_id, updated_at desc);

-- Row-level security: every signed-in user sees and changes only their own projects.
alter table public.projects enable row level security;

drop policy if exists "Users read their own projects" on public.projects;
create policy "Users read their own projects"
  on public.projects for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create their own projects" on public.projects;
create policy "Users create their own projects"
  on public.projects for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own projects" on public.projects;
create policy "Users update their own projects"
  on public.projects for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete their own projects" on public.projects;
create policy "Users delete their own projects"
  on public.projects for delete to authenticated
  using ((select auth.uid()) = user_id);
