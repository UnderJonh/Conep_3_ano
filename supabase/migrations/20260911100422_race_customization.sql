-- Duração validada no servidor; o mundial mantém sua categoria original de 60 s.
alter table public.testes add column duracao_segundos integer not null default 60
  check (duracao_segundos between 15 and 600);

create function private.iniciar_corrida(p_teste_id uuid,p_modo text,p_rodada_esperada integer,p_duracao_segundos integer)
returns public.testes language plpgsql security definer set search_path = '' as $$
declare t public.testes;
begin
  if p_duracao_segundos is null or p_duracao_segundos not between 15 and 600 then
    raise sqlstate 'PT400' using message='Escolha uma duração de 15 a 600 segundos.';
  end if;
  -- A rotina original valida proprietário, modo, rodada e os dois dispositivos.
  t := private.iniciar_corrida(p_teste_id,p_modo,p_rodada_esperada);
  update public.testes set duracao_segundos=p_duracao_segundos,
    corrida_fim=corrida_inicio+make_interval(secs=>p_duracao_segundos)
    where id=t.id returning * into t;
  return t;
end $$;
create function public.iniciar_corrida(p_teste_id uuid,p_modo text,p_rodada_esperada integer,p_duracao_segundos integer)
returns public.testes language sql security invoker set search_path = '' as $$
  select private.iniciar_corrida(p_teste_id,p_modo,p_rodada_esperada,p_duracao_segundos)
$$;
-- Clientes antigos continuam iniciando corridas de 60 s, inclusive após uma personalizada.
create or replace function public.iniciar_corrida(p_teste_id uuid,p_modo text,p_rodada_esperada integer)
returns public.testes language sql security invoker set search_path = '' as $$
  select private.iniciar_corrida(p_teste_id,p_modo,p_rodada_esperada,60)
$$;
revoke all on function private.iniciar_corrida(uuid,text,integer,integer),public.iniciar_corrida(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function private.iniciar_corrida(uuid,text,integer,integer),public.iniciar_corrida(uuid,text,integer,integer) to authenticated;

create or replace function private.encerrar_corrida(p_teste_id uuid,p_motivo text)
returns public.testes language plpgsql security invoker set search_path = '' as $$
declare t public.testes; r uuid; vencedor integer; d1 integer; d2 integer; completa boolean; duracao integer;
begin
  select * into t from public.testes where id=p_teste_id for update;
  if not found then raise sqlstate 'PT404' using message='Corrida não encontrada.'; end if;
  if t.status <> 'rodando' then return t; end if;
  duracao := extract(epoch from (t.corrida_fim-t.corrida_inicio))::integer;
  d1 := coalesce((t.infos_player_1->>'distancia_cm')::integer,0);
  d2 := coalesce((t.infos_player_2->>'distancia_cm')::integer,0);
  completa := p_motivo='tempo' and t.corrida_fim is not null
    and clock_timestamp() >= t.corrida_fim + interval '2 seconds';
  vencedor := case when d1=d2 or not completa then null when d1>d2 then 1 else 2 end;
  insert into public.rodadas(teste_id,numero,infos_player_1,infos_player_2,resultado)
  values(t.id,t.rodada_atual,t.infos_player_1,t.infos_player_2,jsonb_build_object(
    'vencedor',vencedor,'motivo',p_motivo,'modo',t.modo,
    'elegivel_ranking',completa and vencedor is not null and t.modo='oficial' and duracao=60,
    'elegivel_arena',completa and vencedor is not null,
    'duracao_segundos',duracao,'regras_versao','v1-'||duracao||'s','inicio',t.corrida_inicio,'fim',t.corrida_fim)) returning id into r;
  update public.testes set status='finalizado',ultima_rodada_id=r,rodada_atual=rodada_atual+1
    where id=t.id returning * into t;
  return t;
end $$;

create table public.ranking_arena (
  id uuid primary key default gen_random_uuid(),
  teste_id uuid not null references public.testes(id) on delete cascade,
  rodada_id uuid not null unique references public.rodadas(id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 24 and nome ~ '^[[:alnum:] ._-]+$'),
  player integer not null check (player in (1,2)),
  pontos integer not null check (pontos>0), distancia numeric(10,2) not null check (distancia>0),
  pisadas integer not null check (pisadas>0),
  modo text not null check (modo in ('oficial','treino')),
  duracao_segundos integer not null check (duracao_segundos between 15 and 600),
  created_at timestamptz not null default now()
);
alter table public.ranking_arena enable row level security;
revoke all on public.ranking_arena from public,anon,authenticated;
grant select on public.ranking_arena to anon,authenticated;
grant all on public.ranking_arena to service_role;
create policy ranking_arena_publico on public.ranking_arena for select to anon,authenticated using(true);
create index ranking_arena_categoria_idx on public.ranking_arena(teste_id,modo,duracao_segundos,distancia desc,created_at,id);
insert into public.ranking_arena(teste_id,rodada_id,nome,player,pontos,distancia,pisadas,modo,duracao_segundos,created_at)
select r.teste_id,m.rodada_id,m.nome,m.player,m.pontos,m.distancia,m.pisadas,'oficial',60,m.created_at
from public.ranking_mundial m join public.rodadas r on r.id=m.rodada_id;

create function private.registrar_vencedor_arena(p_rodada_id uuid,p_nome text,p_publicar_mundial boolean)
returns public.ranking_arena language plpgsql security definer set search_path = '' as $$
declare r public.rodadas; i jsonb; entrada public.ranking_arena; nome_limpo text; vencedor integer;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Sessão indisponível. Reabra a arena.'; end if;
  select * into r from public.rodadas where id=p_rodada_id for update;
  if not found then raise sqlstate 'PT404' using message='Resultado não encontrado.'; end if;
  if not exists(select 1 from public.testes where id=r.teste_id and owner_id=auth.uid()) then
    raise sqlstate 'PT403' using message='Registre a vitória no navegador que administra a arena.';
  end if;
  vencedor := (r.resultado->>'vencedor')::integer;
  if r.resultado->>'motivo' is distinct from 'tempo' or vencedor is null or vencedor not in (1,2)
    or coalesce((r.resultado->>'elegivel_arena')::boolean,(r.resultado->>'elegivel_ranking')::boolean,false) is not true then
    raise sqlstate 'PT403' using message='Apenas vitórias em corridas completas entram no ranking da arena.';
  end if;
  nome_limpo := regexp_replace(btrim(p_nome),'\s+',' ','g');
  if nome_limpo is null or char_length(nome_limpo) not between 2 and 24 or nome_limpo !~ '^[[:alnum:] ._-]+$' then
    raise sqlstate 'PT400' using message='Use de 2 a 24 letras, números, espaços, ponto, hífen ou sublinhado.';
  end if;
  select * into entrada from public.ranking_arena where rodada_id=r.id;
  if found and entrada.nome<>nome_limpo then raise sqlstate 'PT409' using message='Esta vitória já foi registrada.'; end if;
  if p_publicar_mundial then perform private.registrar_vencedor(r.id,nome_limpo); end if;
  if entrada.id is not null then return entrada; end if;
  i := case when vencedor=1 then r.infos_player_1 else r.infos_player_2 end;
  insert into public.ranking_arena(teste_id,rodada_id,nome,player,pontos,distancia,pisadas,modo,duracao_segundos)
    values(r.teste_id,r.id,nome_limpo,vencedor,(i->>'pontos')::integer,(i->>'distancia')::numeric,
      (i->>'pisadas')::integer,r.resultado->>'modo',(r.resultado->>'duracao_segundos')::integer) returning * into entrada;
  return entrada;
end $$;
create function public.registrar_vencedor_arena(p_rodada_id uuid,p_nome text,p_publicar_mundial boolean default false)
returns public.ranking_arena language sql security invoker set search_path = '' as $$
  select private.registrar_vencedor_arena(p_rodada_id,p_nome,p_publicar_mundial)
$$;
revoke all on function private.registrar_vencedor_arena(uuid,text,boolean),public.registrar_vencedor_arena(uuid,text,boolean) from public,anon,authenticated;
grant execute on function private.registrar_vencedor_arena(uuid,text,boolean),public.registrar_vencedor_arena(uuid,text,boolean) to authenticated;

-- Retorna apenas os players configurados; nunca os hashes ou tokens.
create function private.dispositivos_configurados(p_teste_id uuid) returns integer[]
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.testes where id=p_teste_id and owner_id=auth.uid()) then
    raise sqlstate 'PT403' using message='Sem acesso à configuração desta arena.';
  end if;
  return coalesce((select array_agg(player::integer order by player) from private.dispositivos where teste_id=p_teste_id),'{}'::integer[]);
end $$;
create function public.dispositivos_configurados(p_teste_id uuid) returns integer[]
language sql security invoker set search_path = '' as $$select private.dispositivos_configurados(p_teste_id)$$;
revoke all on function private.dispositivos_configurados(uuid),public.dispositivos_configurados(uuid) from public,anon,authenticated;
grant execute on function private.dispositivos_configurados(uuid),public.dispositivos_configurados(uuid) to authenticated;
alter publication supabase_realtime add table public.ranking_arena;
