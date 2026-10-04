-- Planbreeze cloud storage and sharing.
-- Run this in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- It's safe to run again (e.g. after an update): it only adds what's missing and refreshes the rules.

-- ---------------------------------------------------------------------------
-- Plans

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

-- Set by the owner to let anyone with the link view the plan (null: only the people it's shared with).
alter table public.projects add column if not exists share_token text;

-- ---------------------------------------------------------------------------
-- Sharing: the owner adds people by email, who can view or edit the plan once they sign in with
-- that email.

create table if not exists public.project_shares (
  owner_id    uuid        not null default auth.uid(),
  project_id  text        not null,
  email       text        not null check (email = lower(email)),
  role        text        not null default 'viewer' check (role in ('viewer', 'editor')),
  owner_email text,
  created_at  timestamptz not null default now(),
  primary key (owner_id, project_id, email),
  foreign key (owner_id, project_id) references public.projects (user_id, id) on delete cascade
);

create index if not exists project_shares_email_idx on public.project_shares (email);

-- The signed-in user's email (lower case), once it's confirmed.
create or replace function public.my_email() returns text
language sql stable security definer set search_path = ''
as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null
$$;

alter table public.project_shares alter column owner_email set default public.my_email();

-- Is this plan shared with the signed-in user (as an editor, when `editor`)?
create or replace function public.shared_with_me(owner uuid, project text, editor boolean default false) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_shares s
    where s.owner_id = owner and s.project_id = project and s.email = public.my_email()
      and (not editor or s.role = 'editor')
  )
$$;

-- A plan opened with its view link (anyone with the link, signed in or not, can view it).
create or replace function public.shared_project(owner uuid, project text, token text)
returns table (id text, name text, data jsonb, version integer, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, p.data, p.version, p.updated_at
  from public.projects p
  where p.user_id = owner and p.id = project and p.share_token is not null and p.share_token = token
$$;

-- Nobody can move a plan to another owner or id, and only its owner can turn its link on or off.
create or replace function public.guard_project_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.id <> old.id then
    raise exception 'A plan''s owner and id can''t change';
  end if;
  if new.share_token is distinct from old.share_token and old.user_id is distinct from auth.uid() then
    raise exception 'Only the owner can change who has the link';
  end if;
  return new;
end
$$;

drop trigger if exists guard_project_update on public.projects;
create trigger guard_project_update before update on public.projects
  for each row execute function public.guard_project_update();

-- ---------------------------------------------------------------------------
-- Access through the Data API (needed when new tables aren't exposed automatically). The
-- row-level security policies below decide which rows each user can reach; signed-out visitors
-- get nothing except a plan whose view link they have.

grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.project_shares to authenticated;
revoke all on table public.projects from anon;
revoke all on table public.project_shares from anon;
revoke all on function public.shared_project(uuid, text, text) from public;
grant execute on function public.shared_project(uuid, text, text) to anon, authenticated;
grant execute on function public.my_email() to authenticated;
grant execute on function public.shared_with_me(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: every signed-in user sees and changes only their own plans, plus the
-- plans shared with them (editors can save changes; only owners can delete or share).

alter table public.projects enable row level security;
alter table public.project_shares enable row level security;

drop policy if exists "Users read their own projects" on public.projects;
drop policy if exists "Users read their own and shared projects" on public.projects;
create policy "Users read their own and shared projects"
  on public.projects for select to authenticated
  using ((select auth.uid()) = user_id or public.shared_with_me(user_id, id));

drop policy if exists "Users create their own projects" on public.projects;
create policy "Users create their own projects"
  on public.projects for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update their own projects" on public.projects;
drop policy if exists "Owners and editors update projects" on public.projects;
create policy "Owners and editors update projects"
  on public.projects for update to authenticated
  using ((select auth.uid()) = user_id or public.shared_with_me(user_id, id, true))
  with check ((select auth.uid()) = user_id or public.shared_with_me(user_id, id, true));

drop policy if exists "Users delete their own projects" on public.projects;
create policy "Users delete their own projects"
  on public.projects for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Owners manage who their plans are shared with" on public.project_shares;
create policy "Owners manage who their plans are shared with"
  on public.project_shares for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "People see plans shared with them" on public.project_shares;
create policy "People see plans shared with them"
  on public.project_shares for select to authenticated
  using (email = (select public.my_email()));

drop policy if exists "People can leave plans shared with them" on public.project_shares;
create policy "People can leave plans shared with them"
  on public.project_shares for delete to authenticated
  using (email = (select public.my_email()));
