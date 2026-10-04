create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, username text unique not null, avatar_url text, created_at timestamptz not null default now());
create table if not exists public.friend_requests (id uuid primary key default gen_random_uuid(), from_id uuid not null references public.profiles(id) on delete cascade, to_id uuid not null references public.profiles(id) on delete cascade, status text not null default 'pending' check(status in ('pending','accepted','rejected')), created_at timestamptz not null default now(), unique(from_id,to_id));
create table if not exists public.friends (user_id uuid not null references public.profiles(id) on delete cascade, friend_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), primary key(user_id,friend_id));
create table if not exists public.messages (id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles(id) on delete cascade, receiver_id uuid not null references public.profiles(id) on delete cascade, content text not null check(length(content)>0 and length(content)<=4000), created_at timestamptz not null default now());
alter table public.profiles enable row level security; alter table public.friend_requests enable row level security; alter table public.friends enable row level security; alter table public.messages enable row level security;
create policy "profiles readable" on public.profiles for select to authenticated using (true); create policy "own profile insert" on public.profiles for insert to authenticated with check (id=auth.uid()); create policy "own profile update" on public.profiles for update to authenticated using(id=auth.uid());
create policy "requests read" on public.friend_requests for select to authenticated using(from_id=auth.uid() or to_id=auth.uid()); create policy "requests send" on public.friend_requests for insert to authenticated with check(from_id=auth.uid() and to_id<>from_id and status='pending' and not exists(select 1 from public.friends f where f.user_id=auth.uid() and f.friend_id=friend_requests.to_id));
create policy "friends read" on public.friends for select to authenticated using(user_id=auth.uid());
create policy "messages read" on public.messages for select to authenticated using(sender_id=auth.uid() or receiver_id=auth.uid()); create policy "messages send" on public.messages for insert to authenticated with check(sender_id=auth.uid() and exists(select 1 from public.friends f where f.user_id=auth.uid() and f.friend_id=messages.receiver_id));
create or replace function public.accept_friend_request(request_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.friend_requests;
begin
 select * into r from public.friend_requests where id=request_id and to_id=auth.uid() and status='pending' for update;
 if not found or r.from_id=r.to_id then raise exception 'Invalid request'; end if;
 update public.friend_requests set status='accepted' where id=r.id;
 insert into public.friends(user_id,friend_id) values(r.from_id,r.to_id),(r.to_id,r.from_id) on conflict do nothing;
end $$;
revoke all on function public.accept_friend_request(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,username) values(new.id,coalesce(new.raw_user_meta_data->>'username',split_part(new.email,'@',1))); return new; end $$;
drop trigger if exists on_auth_user_created on auth.users; create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Explicit least-privilege grants for fresh installations. Existing deployments
-- already receive the matching social policies through Companion setup.
revoke all on public.profiles, public.friend_requests, public.friends, public.messages from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.friend_requests, public.messages to authenticated;
grant select on public.friends to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
