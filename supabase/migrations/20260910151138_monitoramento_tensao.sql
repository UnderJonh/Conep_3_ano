-- Estado atual, histórico imutável e dispositivos com credencial por player.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.testes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rodada_atual integer not null default 1 check (rodada_atual > 0),
  infos_player_1 jsonb not null default '{}' check (jsonb_typeof(infos_player_1) = 'object'),
  infos_player_2 jsonb not null default '{}' check (jsonb_typeof(infos_player_2) = 'object'),
  status text not null default 'aguardando' check (status in ('aguardando', 'rodando', 'pausado')),
  revisao bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index testes_owner_id_idx on public.testes(owner_id);

create table public.teste_participantes (
  teste_id uuid not null references public.testes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (teste_id, user_id)
);
create index teste_participantes_user_id_idx on public.teste_participantes(user_id);

create table public.rodadas (
  id uuid primary key default gen_random_uuid(),
  teste_id uuid not null references public.testes(id) on delete cascade,
  numero integer not null check (numero > 0),
  infos_player_1 jsonb not null,
  infos_player_2 jsonb not null,
  resultado jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (teste_id, numero)
);

create table private.dispositivos (
  teste_id uuid not null references public.testes(id) on delete cascade,
  player smallint not null check (player in (1, 2)),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (teste_id, player)
);

alter table public.testes enable row level security;
alter table public.rodadas enable row level security;
alter table public.teste_participantes enable row level security;
alter table private.dispositivos enable row level security;

-- Privilégios explícitos, inclusive em projetos com grants automáticos antigos.
revoke all on public.testes, public.rodadas, public.teste_participantes from anon, authenticated;
revoke all on private.dispositivos from public, anon, authenticated;
grant select on public.testes, public.rodadas, public.teste_participantes to authenticated;
grant insert (nome) on public.testes to authenticated;
grant all on public.testes, public.rodadas, public.teste_participantes, private.dispositivos to service_role;

create policy participantes_leem_proprio_acesso on public.teste_participantes
  for select to authenticated using (user_id = (select auth.uid()));
create policy usuarios_leem_testes_autorizados on public.testes
  for select to authenticated using (
    owner_id = (select auth.uid()) or id in (
      select teste_id from public.teste_participantes where user_id = (select auth.uid())
    )
  );
create policy usuarios_criam_proprios_testes on public.testes
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy usuarios_leem_historico_autorizado on public.rodadas
  for select to authenticated using (teste_id in (select id from public.testes));

create function private.marcar_atualizacao() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.revisao := old.revisao + 1;
  return new;
end;
$$;
revoke all on function private.marcar_atualizacao() from public, anon, authenticated;
create trigger testes_updated_at before update on public.testes
  for each row execute function private.marcar_atualizacao();

-- Só o servidor pode chamar esta RPC. O lock também serializa com finalizar_rodada.
create function public.registrar_tensao(
  p_teste_id uuid, p_player integer, p_tensao double precision, p_token_hash text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_teste public.testes;
  v_leitura jsonb;
begin
  if p_teste_id is null or p_player is null or p_player not in (1, 2)
    or p_tensao is null or p_tensao < 0
    or p_tensao in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then
    raise sqlstate 'PT400' using message = 'Leitura inválida.';
  end if;
  select * into v_teste from public.testes where id = p_teste_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'Teste não encontrado.';
  end if;
  if not exists (select 1 from private.dispositivos
    where teste_id = p_teste_id and player = p_player and token_hash = p_token_hash) then
    raise sqlstate 'PT401' using message = 'Token do dispositivo inválido.';
  end if;
  if v_teste.status <> 'rodando' then
    raise sqlstate 'PT409' using message = 'O teste não está rodando.';
  end if;
  v_leitura := jsonb_build_object('tensao', p_tensao, 'atualizado_em', clock_timestamp());
  if p_player = 1 then
    update public.testes set infos_player_1 = infos_player_1 || v_leitura where id = p_teste_id;
  else
    update public.testes set infos_player_2 = infos_player_2 || v_leitura where id = p_teste_id;
  end if;
  return jsonb_build_object('ok', true, 'teste_id', p_teste_id, 'player', p_player,
    'rodada', v_teste.rodada_atual, 'tensao', p_tensao);
end;
$$;
revoke all on function public.registrar_tensao(uuid, integer, double precision, text) from public, anon, authenticated;
grant execute on function public.registrar_tensao(uuid, integer, double precision, text) to service_role;

-- As únicas funções privilegiadas ficam fora dos schemas expostos pela Data API.
-- Cada uma valida auth.uid(), propriedade do teste e parâmetros no servidor.
create function private.configurar_dispositivo(p_teste_id uuid, p_player integer, p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Faça login.'; end if;
  perform 1 from public.testes where id = p_teste_id and owner_id = auth.uid() for update;
  if not found then raise sqlstate 'PT403' using message = 'Teste sem permissão de administração.'; end if;
  if p_player is null or p_player not in (1, 2) or p_token_hash is null
    or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT400' using message = 'Dispositivo inválido.';
  end if;
  insert into private.dispositivos(teste_id, player, token_hash)
    values (p_teste_id, p_player, p_token_hash)
    on conflict (teste_id, player) do update set token_hash = excluded.token_hash, created_at = now();
end;
$$;

create function private.alterar_status(p_teste_id uuid, p_status text)
returns public.testes language plpgsql security definer set search_path = '' as $$
declare v_teste public.testes;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Faça login.'; end if;
  if p_status is null or p_status not in ('rodando', 'pausado') then
    raise sqlstate 'PT400' using message = 'Status inválido.';
  end if;
  update public.testes set status = p_status where id = p_teste_id and owner_id = auth.uid()
    returning * into v_teste;
  if not found then raise sqlstate 'PT403' using message = 'Teste sem permissão de administração.'; end if;
  return v_teste;
end;
$$;

create function private.finalizar_rodada(p_teste_id uuid, p_rodada_esperada integer)
returns public.testes language plpgsql security definer set search_path = '' as $$
declare v_teste public.testes;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Faça login.'; end if;
  select * into v_teste from public.testes where id = p_teste_id and owner_id = auth.uid() for update;
  if not found then raise sqlstate 'PT403' using message = 'Teste sem permissão de administração.'; end if;
  if p_rodada_esperada is null or v_teste.rodada_atual <> p_rodada_esperada then
    raise sqlstate 'PT409' using message = 'A rodada já mudou. Confira o estado atual.';
  end if;
  if v_teste.status <> 'rodando' then
    raise sqlstate 'PT409' using message = 'Inicie o teste antes de finalizar a rodada.';
  end if;
  insert into public.rodadas(teste_id, numero, infos_player_1, infos_player_2, resultado)
    values (v_teste.id, v_teste.rodada_atual, v_teste.infos_player_1, v_teste.infos_player_2,
      jsonb_build_object('finalizado_por', auth.uid()));
  update public.testes set rodada_atual = rodada_atual + 1,
    infos_player_1 = infos_player_1 - 'tensao' - 'atualizado_em',
    infos_player_2 = infos_player_2 - 'tensao' - 'atualizado_em'
    where id = p_teste_id returning * into v_teste;
  return v_teste;
end;
$$;

revoke all on function private.configurar_dispositivo(uuid, integer, text),
  private.alterar_status(uuid, text), private.finalizar_rodada(uuid, integer) from public, anon, authenticated;
grant execute on function private.configurar_dispositivo(uuid, integer, text),
  private.alterar_status(uuid, text), private.finalizar_rodada(uuid, integer) to authenticated;

-- Wrappers invoker: API pública estreita; não concede escrita direta no histórico/estado.
create function public.configurar_dispositivo(p_teste_id uuid, p_player integer, p_token_hash text)
returns void language sql security invoker set search_path = '' as $$
  select private.configurar_dispositivo(p_teste_id, p_player, p_token_hash);
$$;
create function public.alterar_status(p_teste_id uuid, p_status text)
returns public.testes language sql security invoker set search_path = '' as $$
  select private.alterar_status(p_teste_id, p_status);
$$;
create function public.finalizar_rodada(p_teste_id uuid, p_rodada_esperada integer)
returns public.testes language sql security invoker set search_path = '' as $$
  select private.finalizar_rodada(p_teste_id, p_rodada_esperada);
$$;
revoke all on function public.configurar_dispositivo(uuid, integer, text),
  public.alterar_status(uuid, text), public.finalizar_rodada(uuid, integer) from public, anon, authenticated;
grant execute on function public.configurar_dispositivo(uuid, integer, text),
  public.alterar_status(uuid, text), public.finalizar_rodada(uuid, integer) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'testes') then
    alter publication supabase_realtime add table public.testes;
  end if;
end $$;
