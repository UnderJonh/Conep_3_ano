-- RECONSTRUÃ‡ÃƒO DO ZERO: apaga conexÃµes, tokens, sinais e rankings do jogo.
-- Execute este arquivo inteiro no SQL Editor do projeto CONEP.
-- Auth, Storage e dados que nÃ£o pertencem ao jogo sÃ£o preservados.
begin;

do $$ declare job record; begin
  if to_regclass('cron.job') is not null then
    for job in select jobid from cron.job where jobname = 'conep_voltage_run_expirar_v1' loop
      perform cron.unschedule(job.jobid);
    end loop;
  end if;
end $$;

do $$ declare fn record; begin
  for fn in select p.oid::regprocedure::text as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'configurar_crossy', 'configurar_dispositivo', 'dispositivos_configurados',
      'registrar_recorde_crossy', 'registrar_amostras', 'registrar_tensao',
      'autenticar_dispositivo_ws', 'registrar_comando_ws',
      'alterar_status', 'finalizar_rodada', 'iniciar_corrida', 'concluir_corrida',
      'registrar_vencedor', 'registrar_vencedor_arena', 'pisada_treino', 'hora_servidor'
    ) loop
    execute format('drop function if exists %s cascade', fn.signature);
  end loop;
end $$;

drop table if exists public.ranking_arena, public.ranking_mundial, public.rodadas,
  public.teste_participantes, public.crossy_ranking, public.testes cascade;
-- Retira somente os objetos private usados pelas versÃµes anteriores deste jogo.
drop table if exists private.dispositivos, private.sinais cascade;
do $$ declare fn record; begin
  for fn in select p.oid::regprocedure::text as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in (
      'marcar_atualizacao', 'configurar_crossy', 'configurar_dispositivo', 'dispositivos_configurados',
      'registrar_recorde_crossy', 'processar_amostra', 'processar_amostra_crossy', 'aplicar_lote',
      'expirar_corridas', 'encerrar_corrida', 'iniciar_corrida', 'concluir_corrida',
      'alterar_status', 'finalizar_rodada', 'registrar_vencedor', 'registrar_vencedor_arena', 'pisada_treino'
    ) loop
    execute format('drop function if exists %s cascade', fn.signature);
  end loop;
end $$;

-- Banco novo do Crossy Road: uma placa, pisadas e ranking de jogadores.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.testes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  infos_player_1 jsonb not null default '{}' check (jsonb_typeof(infos_player_1) = 'object'),
  infos_player_2 jsonb not null default '{}' check (jsonb_typeof(infos_player_2) = 'object'),
  limiar_forte numeric not null default 1.50 check (limiar_forte between 0.60 and 3.30),
  revisao bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index testes_owner_created_idx on public.testes(owner_id, created_at);

create table private.dispositivos (
  teste_id uuid primary key references public.testes(id) on delete cascade,
  player smallint not null default 1 check (player = 1),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create table private.sinais (
  teste_id uuid primary key references public.testes(id) on delete cascade,
  estado jsonb not null default '{}' check (jsonb_typeof(estado) = 'object')
);
create table public.crossy_ranking (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (nome = btrim(nome) and char_length(nome) between 1 and 24 and nome !~ '[[:cntrl:]]'),
  pontos integer not null check (pontos > 0),
  created_at timestamptz not null default now()
);
create index crossy_ranking_score_idx on public.crossy_ranking(pontos desc, created_at asc);
create index crossy_ranking_owner_idx on public.crossy_ranking(owner_id);

alter table public.testes enable row level security;
alter table public.crossy_ranking enable row level security;
alter table private.dispositivos enable row level security;
alter table private.sinais enable row level security;
revoke all on public.testes, public.crossy_ranking, private.dispositivos, private.sinais from public, anon, authenticated;
grant select on public.testes to authenticated;
grant insert (nome) on public.testes to authenticated;
grant select (id, nome, pontos, created_at) on public.crossy_ranking to anon, authenticated;
grant all on public.testes, public.crossy_ranking, private.dispositivos, private.sinais to service_role;

create policy ler_propria_conexao on public.testes for select to authenticated
  using (owner_id = (select auth.uid()));
create policy criar_propria_conexao on public.testes for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy ler_ranking_publico on public.crossy_ranking for select to anon, authenticated using (true);

create function private.marcar_atualizacao() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  new.revisao := old.revisao + 1;
  return new;
end $$;
revoke all on function private.marcar_atualizacao() from public, anon, authenticated;
create trigger testes_updated_at before update on public.testes
  for each row execute function private.marcar_atualizacao();

-- Administração apenas pelo dono da conexão; credenciais nunca saem de private.
create function private.configurar_crossy(p_teste_id uuid, p_limiar numeric)
returns public.testes language plpgsql security definer set search_path = '' as $$
declare t public.testes;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Faça login.'; end if;
  if p_limiar is null or not (p_limiar between 0.60 and 3.30) then
    raise sqlstate 'PT400' using message = 'Força mínima inválida.';
  end if;
  select * into t from public.testes where id = p_teste_id and owner_id = auth.uid() for update;
  if not found then raise sqlstate 'PT403' using message = 'Conexão sem permissão de administração.'; end if;
  update public.testes set limiar_forte = p_limiar where id = t.id returning * into t;
  update private.sinais set estado = '{}'::jsonb where teste_id = t.id;
  return t;
end $$;

create function private.configurar_dispositivo(p_teste_id uuid, p_player integer, p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Faça login.'; end if;
  perform 1 from public.testes where id = p_teste_id and owner_id = auth.uid() for update;
  if not found then raise sqlstate 'PT403' using message = 'Conexão sem permissão de administração.'; end if;
  if p_player is distinct from 1 or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT400' using message = 'Crossy Road usa somente a placa 1, com token válido.';
  end if;
  insert into private.dispositivos(teste_id, token_hash) values (p_teste_id, p_token_hash)
    on conflict (teste_id) do update set token_hash = excluded.token_hash, created_at = now();
  update private.sinais set estado = '{}'::jsonb where teste_id = p_teste_id;
end $$;

create function private.dispositivos_configurados(p_teste_id uuid)
returns integer[] language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Faça login.'; end if;
  if not exists (select 1 from public.testes where id = p_teste_id and owner_id = auth.uid()) then
    raise sqlstate 'PT403' using message = 'Conexão sem permissão de administração.';
  end if;
  return array(select player::integer from private.dispositivos where teste_id = p_teste_id);
end $$;

create function private.registrar_recorde_crossy(p_id uuid, p_nome text, p_pontos integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.crossy_ranking;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Faça login.'; end if;
  if p_id is null or p_nome is null or char_length(btrim(p_nome)) not between 1 and 24
    or p_nome ~ '[[:cntrl:]]' or p_pontos is null or p_pontos <= 0 then
    raise sqlstate 'PT400' using message = 'Informe um nome de até 24 caracteres e pontuação positiva.';
  end if;
  insert into public.crossy_ranking(id, owner_id, nome, pontos)
    values (p_id, auth.uid(), btrim(p_nome), p_pontos) on conflict (id) do nothing;
  select * into r from public.crossy_ranking where id = p_id and owner_id = auth.uid();
  if not found or r.nome <> btrim(p_nome) or r.pontos <> p_pontos then
    raise sqlstate 'PT409' using message = 'Esta partida já foi registrada.';
  end if;
  return jsonb_build_object('id', r.id, 'nome', r.nome, 'pontos', r.pontos, 'created_at', r.created_at);
end $$;

create function public.configurar_crossy(p_teste_id uuid, p_limiar numeric)
returns public.testes language sql security invoker set search_path = '' as $$ select private.configurar_crossy(p_teste_id, p_limiar) $$;
create function public.configurar_dispositivo(p_teste_id uuid, p_player integer, p_token_hash text)
returns void language sql security invoker set search_path = '' as $$ select private.configurar_dispositivo(p_teste_id, p_player, p_token_hash) $$;
create function public.dispositivos_configurados(p_teste_id uuid)
returns integer[] language sql security invoker set search_path = '' as $$ select private.dispositivos_configurados(p_teste_id) $$;
create function public.registrar_recorde_crossy(p_id uuid, p_nome text, p_pontos integer)
returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_recorde_crossy(p_id, p_nome, p_pontos) $$;
revoke all on function private.configurar_crossy(uuid,numeric), public.configurar_crossy(uuid,numeric),
  private.configurar_dispositivo(uuid,integer,text), public.configurar_dispositivo(uuid,integer,text),
  private.dispositivos_configurados(uuid), public.dispositivos_configurados(uuid),
  private.registrar_recorde_crossy(uuid,text,integer), public.registrar_recorde_crossy(uuid,text,integer) from public, anon, authenticated;
grant execute on function private.configurar_crossy(uuid,numeric), public.configurar_crossy(uuid,numeric),
  private.configurar_dispositivo(uuid,integer,text), public.configurar_dispositivo(uuid,integer,text),
  private.dispositivos_configurados(uuid), public.dispositivos_configurados(uuid),
  private.registrar_recorde_crossy(uuid,text,integer), public.registrar_recorde_crossy(uuid,text,integer) to authenticated;

-- RPC exclusiva do servidor. Um lock serializa lotes e mudanças de configuração.
create function public.registrar_amostras(p_teste_id uuid, p_player integer, p_amostras jsonb, p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t public.testes; i jsonb; estados jsonb; s jsonb; chave text; item jsonb; v numeric; ms bigint; anterior bigint := 0;
  agora bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if p_player is null or p_player not in (1, 2) or p_amostras is null or jsonb_typeof(p_amostras) <> 'array' then
    raise sqlstate 'PT400' using message = 'Informe amostras do jogador 1 ou 2.';
  end if;
  if jsonb_array_length(p_amostras) not between 1 and 50 then
    raise sqlstate 'PT400' using message = 'Envie entre 1 e 50 amostras.';
  end if;
  select * into t from public.testes where id = p_teste_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Conexão não encontrada.'; end if;
  if p_token_hash is null or not exists (select 1 from private.dispositivos where teste_id = t.id and token_hash = p_token_hash) then
    raise sqlstate 'PT401' using message = 'Token do dispositivo inválido.';
  end if;
  chave := 'player_' || p_player;
  i := case when p_player = 1 then t.infos_player_1 else t.infos_player_2 end;
  select estado into estados from private.sinais where teste_id = t.id;
  estados := coalesce(estados, '{}');
  s := coalesce(estados->chave, '{}');
  for item in select value from jsonb_array_elements(p_amostras) loop
    if jsonb_typeof(item->'tensao') is distinct from 'number' or jsonb_typeof(item->'instante_ms') is distinct from 'number' then
      raise sqlstate 'PT400' using message = 'Amostra precisa de tensão e instante_ms numéricos.';
    end if;
    v := (item->>'tensao')::numeric;
    if v not between 0 and 3.6 or (item->>'instante_ms')::numeric not between agora - 3000 and agora + 500
      or mod((item->>'instante_ms')::numeric, 1) <> 0 then
      raise sqlstate 'PT400' using message = 'Amostra fora da faixa ou do intervalo de relógio permitido.';
    end if;
    ms := (item->>'instante_ms')::bigint;
    if ms <= anterior then raise sqlstate 'PT400' using message = 'Ordene as amostras por instante_ms.'; end if;
    anterior := ms;
    if ms <= coalesce((s->>'ultima_amostra')::bigint, 0) then continue; end if;
    i := i || jsonb_build_object('tensao', v, 'atualizado_em', to_timestamp(ms / 1000.0));
    if v <= 0.25 then
      if coalesce((s->>'pressionado')::boolean, false)
        and ms - (s->>'inicio')::bigint between 20 and 1500
        and ms - coalesce((s->>'ultimo')::bigint, 0) >= 200 then
        i := i || jsonb_build_object('comandos', coalesce((i->>'comandos')::bigint, 0) + 1,
          'comando_em', to_timestamp(ms / 1000.0), 'pico_tensao', s->'pico');
        s := s || jsonb_build_object('ultimo', ms);
      end if;
      s := s || jsonb_build_object('armado', true, 'pressionado', false, 'pico', 0);
    elsif coalesce((s->>'armado')::boolean, false) and not coalesce((s->>'pressionado')::boolean, false) and v >= t.limiar_forte then
      s := s || jsonb_build_object('armado', false, 'pressionado', true, 'inicio', ms, 'pico', v);
    elsif coalesce((s->>'pressionado')::boolean, false) then
      s := s || jsonb_build_object('pico', greatest(coalesce((s->>'pico')::numeric, 0), v));
    end if;
    s := s || jsonb_build_object('ultima_amostra', ms);
  end loop;
  estados := jsonb_set(estados, array[chave], s, true);
  insert into private.sinais(teste_id, estado) values (t.id, estados)
    on conflict (teste_id) do update set estado = excluded.estado;
  if p_player = 1 then
    update public.testes set infos_player_1 = i where id = t.id;
  else
    update public.testes set infos_player_2 = i where id = t.id;
  end if;
  return jsonb_build_object('ok', true, 'teste_id', t.id, 'player', p_player, 'tensao', i->'tensao', 'comandos', coalesce(i->'comandos', '0'));
end $$;
create function public.registrar_tensao(p_teste_id uuid, p_player integer, p_tensao double precision, p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_tensao is null or not (p_tensao between 0 and 3.6) then raise sqlstate 'PT400' using message = 'Tensão inválida.'; end if;
  return public.registrar_amostras(p_teste_id, p_player,
    jsonb_build_array(jsonb_build_object('tensao', p_tensao, 'instante_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint)), p_token_hash);
end $$;
revoke all on function public.registrar_amostras(uuid,integer,jsonb,text), public.registrar_tensao(uuid,integer,double precision,text) from public, anon, authenticated;
grant execute on function public.registrar_amostras(uuid,integer,jsonb,text), public.registrar_tensao(uuid,integer,double precision,text) to service_role;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'testes') then
    alter publication supabase_realtime add table public.testes;
  end if;
end $$;

-- RPCs usadas exclusivamente pelo gateway WebSocket. O navegador e o ESP32
-- nunca recebem a service role; o gateway envia somente o hash do token.
create function public.autenticar_dispositivo_ws(p_teste_id uuid, p_token_hash text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select p_token_hash is not null
    and p_token_hash ~ '^[a-f0-9]{64}$'
    and exists (
      select 1
      from private.dispositivos d
      join public.testes t on t.id = d.teste_id
        where d.teste_id = p_teste_id and d.token_hash = p_token_hash
    )
$$;

create function public.registrar_comando_ws(
  p_teste_id uuid,
  p_player integer,
  p_sessao text,
  p_sequencia bigint,
  p_tensao double precision,
  p_token_hash text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  t public.testes;
  i jsonb;
  estados jsonb;
  s jsonb;
  chave text;
  agora timestamptz := clock_timestamp();
begin
  if p_player is null or p_player not in (1, 2)
    or p_sessao is null or p_sessao !~ '^[a-f0-9]{8}$'
    or p_sequencia is null or p_sequencia not between 1 and 2147483647
    or p_tensao is null or not (p_tensao between 0 and 3.6) then
    raise sqlstate 'PT400' using message = 'Comando WebSocket invalido.';
  end if;

  select * into t from public.testes where id = p_teste_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Conexao nao encontrada.'; end if;
  if p_token_hash is null or not exists (
    select 1 from private.dispositivos
    where teste_id = t.id and token_hash = p_token_hash
  ) then
    raise sqlstate 'PT401' using message = 'Token do dispositivo invalido.';
  end if;

  select estado into estados from private.sinais where teste_id = t.id;
  estados := coalesce(estados, '{}'::jsonb);
  chave := 'ws_player_' || p_player;
  s := coalesce(estados->chave, '{}'::jsonb);

  if s->>'sessao' = p_sessao and coalesce((s->>'sequencia')::bigint, 0) >= p_sequencia then
    return jsonb_build_object(
      'ok', true,
      'aceito', false,
      'teste_id', t.id,
      'player', p_player,
      'comandos', coalesce((case when p_player = 1 then t.infos_player_1 else t.infos_player_2 end)->>'comandos', '0')
    );
  end if;

  estados := jsonb_set(estados, array[chave], jsonb_build_object(
    'sessao', p_sessao,
    'sequencia', p_sequencia
  ), true);
  insert into private.sinais(teste_id, estado) values (t.id, estados)
    on conflict (teste_id) do update set estado = excluded.estado;

  i := case when p_player = 1 then t.infos_player_1 else t.infos_player_2 end;
  i := i || jsonb_build_object(
    'tensao', p_tensao,
    'pico_tensao', p_tensao,
    'atualizado_em', agora,
    'comando_em', agora,
    'comandos', coalesce((i->>'comandos')::bigint, 0) + 1
  );

  if p_player = 1 then
    update public.testes set infos_player_1 = i where id = t.id;
  else
    update public.testes set infos_player_2 = i where id = t.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'aceito', true,
    'teste_id', t.id,
    'player', p_player,
    'comandos', i->'comandos'
  );
end $$;

revoke all on function public.autenticar_dispositivo_ws(uuid,text),
  public.registrar_comando_ws(uuid,integer,text,bigint,double precision,text)
  from public, anon, authenticated;
grant execute on function public.autenticar_dispositivo_ws(uuid,text),
  public.registrar_comando_ws(uuid,integer,text,bigint,double precision,text)
  to service_role;


-- Alinha o histÃ³rico com a migration Ãºnica usada por esta versÃ£o do projeto.
do $$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version in (
      '20260910151138', '20260911020407', '20260911100422', '20260917140736'
    );
    insert into supabase_migrations.schema_migrations(version, name, statements)
      values ('20260917155448', 'crossy_game_from_scratch', array[]::text[]),
        ('20260920154931', 'local_multiplayer', array[]::text[]),
        ('20260921180023', 'websocket_commands', array[]::text[])
      on conflict (version) do update set name = excluded.name;
  end if;
end $$;
commit;