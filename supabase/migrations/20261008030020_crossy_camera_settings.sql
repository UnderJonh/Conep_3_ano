-- Shared camera tuning for the hidden in-game editor.
begin;

create table public.crossy_camera_settings (
  profile text primary key check (profile in ('desktop', 'mobile')),
  horizontal numeric(6,4) not null check (horizontal between -0.30 and 0.30),
  vertical numeric(6,4) not null check (vertical between -0.30 and 0.30),
  zoom numeric(6,4) not null check (zoom between 0.60 and 1.60),
  updated_at timestamptz not null default now()
);

insert into public.crossy_camera_settings (profile, horizontal, vertical, zoom)
values
  ('desktop', 0, 0, 1),
  ('mobile', 0.16, 0.065, 1);

alter table public.crossy_camera_settings enable row level security;

revoke all on public.crossy_camera_settings from public, anon, authenticated;
grant select on public.crossy_camera_settings to anon, authenticated;
grant update (horizontal, vertical, zoom, updated_at) on public.crossy_camera_settings to authenticated;
grant all on public.crossy_camera_settings to service_role;

create policy ler_configuracao_camera
  on public.crossy_camera_settings
  for select
  to anon, authenticated
  using (true);

create policy atualizar_configuracao_camera
  on public.crossy_camera_settings
  for update
  to authenticated
  using (profile in ('desktop', 'mobile'))
  with check (profile in ('desktop', 'mobile'));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'crossy_camera_settings'
  ) then
    alter publication supabase_realtime add table public.crossy_camera_settings;
  end if;
end $$;

commit;
