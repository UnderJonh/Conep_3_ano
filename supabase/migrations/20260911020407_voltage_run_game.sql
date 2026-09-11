-- Voltage Run v1: corridas de 60 s, pulsos de pressão e ranking público.
alter table public.testes drop constraint testes_status_check;
alter table public.testes add constraint testes_status_check check (status in ('aguardando','rodando','pausado','finalizado'));
alter table public.testes add column modo text not null default 'oficial' check (modo in ('oficial','treino'));
alter table public.testes add column corrida_inicio timestamptz;
alter table public.testes add column corrida_fim timestamptz;
alter table public.testes add column ultima_rodada_id uuid references public.rodadas(id) on delete set null;
create index testes_corridas_ativas_idx on public.testes(corrida_fim) where status = 'rodando';
create index testes_ultima_rodada_idx on public.testes(ultima_rodada_id);
-- Arenas do monitor anterior voltam à espera; leituras e históricos são preservados.
update public.testes set status='aguardando' where status='rodando' and corrida_inicio is null;

create table private.sinais (
  teste_id uuid not null references public.testes(id) on delete cascade,
  player integer not null check (player in (1,2)),
  estado jsonb not null default '{}',
  primary key(teste_id,player)
);
alter table private.sinais enable row level security;
revoke all on private.sinais from public,anon,authenticated;
grant all on private.sinais to service_role;

create table public.ranking_mundial (
  id uuid primary key default gen_random_uuid(),
  rodada_id uuid not null unique references public.rodadas(id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 24 and nome ~ '^[[:alnum:] ._-]+$'),
  player integer not null check (player in (1,2)),
  pontos integer not null check (pontos > 0),
  distancia numeric(10,2) not null check (distancia > 0),
  pisadas integer not null check (pisadas > 0),
  regras_versao text not null default 'v1-60s' check (regras_versao = 'v1-60s'),
  created_at timestamptz not null default now()
);
alter table public.ranking_mundial enable row level security;
revoke all on public.ranking_mundial from public,anon,authenticated;
grant select on public.ranking_mundial to anon,authenticated;
grant all on public.ranking_mundial to service_role;
create policy ranking_publico on public.ranking_mundial for select to anon,authenticated using (true);
create index ranking_distancia_idx on public.ranking_mundial(distancia desc,created_at,id);

-- Função pura: histerese, pico, liberação e debounce. Nunca premia tensão mantida.
create function private.processar_amostra(p_info jsonb,p_estado jsonb,p_tensao numeric,p_ms bigint,p_contar boolean)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  i jsonb := p_info; s jsonb := p_estado;
  pressionado boolean := coalesce((s->>'pressionado')::boolean,false);
  armado boolean := coalesce((s->>'armado')::boolean,false);
  pico numeric := coalesce((s->>'pico')::numeric,0);
  inicio bigint := coalesce((s->>'inicio')::bigint,0);
  ultimo bigint := coalesce((s->>'ultimo_passo')::bigint,0);
  duracao bigint; intervalo bigint; ritmo numeric; multiplicador numeric; cm integer;
begin
  if p_ms <= coalesce((s->>'ultimo_sample')::bigint,0) then
    return jsonb_build_object('info',i,'estado',s);
  end if;
  i := i || jsonb_build_object('tensao',p_tensao,'atualizado_em',to_timestamp(p_ms/1000.0));
  s := s || jsonb_build_object('ultimo_sample',p_ms);
  if not p_contar then
    return jsonb_build_object('info',i,'estado',s || '{"pressionado":false,"armado":false}');
  end if;
  if p_tensao <= 0.25 then
    if pressionado then
      duracao := p_ms - inicio;
      intervalo := p_ms - ultimo;
      if duracao between 20 and 1500 and intervalo >= 200 then
        ritmo := case when ultimo > 0 and intervalo <= 2000 then least(5,1000.0/intervalo) else 0 end;
        multiplicador := 1 + least(0.5,greatest(0,(ritmo-1)*0.2));
        cm := coalesce((i->>'distancia_cm')::integer,0) + round((100+300*least(pico,3.3)/3.3)*multiplicador)::integer;
        i := i || jsonb_build_object('pisadas',coalesce((i->>'pisadas')::integer,0)+1,
          'distancia_cm',cm,'distancia',cm/100.0,'pontos',cm/10,
          'ritmo',round(ritmo,2),'multiplicador',round(multiplicador,2),'pico_tensao',pico,
          'ultima_pisada_em',to_timestamp(p_ms/1000.0));
        s := s || jsonb_build_object('ultimo_passo',p_ms);
      end if;
    end if;
    s := s || '{"pressionado":false,"armado":true,"pico":0}';
  elsif p_tensao >= 0.6 and armado and not pressionado then
    s := s || jsonb_build_object('pressionado',true,'armado',false,'pico',p_tensao,'inicio',p_ms);
  elsif pressionado then
    s := s || jsonb_build_object('pico',greatest(pico,p_tensao));
  end if;
  return jsonb_build_object('info',i,'estado',s);
end $$;
revoke all on function private.processar_amostra(jsonb,jsonb,numeric,bigint,boolean) from public,anon,authenticated;
grant execute on function private.processar_amostra(jsonb,jsonb,numeric,bigint,boolean) to service_role;

-- Só acessível pelo servidor/rotinas autenticadas abaixo; todos usam o lock do teste.
create function private.encerrar_corrida(p_teste_id uuid,p_motivo text)
returns public.testes language plpgsql security invoker set search_path = '' as $$
declare t public.testes; r uuid; vencedor integer; d1 integer; d2 integer; elegivel boolean;
begin
  select * into t from public.testes where id=p_teste_id for update;
  if not found then raise sqlstate 'PT404' using message='Corrida não encontrada.'; end if;
  if t.status <> 'rodando' then return t; end if;
  d1 := coalesce((t.infos_player_1->>'distancia_cm')::integer,0);
  d2 := coalesce((t.infos_player_2->>'distancia_cm')::integer,0);
  elegivel := p_motivo='tempo' and t.modo='oficial' and t.corrida_fim is not null
    and clock_timestamp() >= t.corrida_fim + interval '2 seconds';
  vencedor := case when d1=d2 or p_motivo<>'tempo' then null when d1>d2 then 1 else 2 end;
  insert into public.rodadas(teste_id,numero,infos_player_1,infos_player_2,resultado)
  values(t.id,t.rodada_atual,t.infos_player_1,t.infos_player_2,jsonb_build_object(
    'vencedor',vencedor,'motivo',p_motivo,'modo',t.modo,'elegivel_ranking',elegivel and vencedor is not null,
    'duracao_segundos',60,'regras_versao','v1-60s','inicio',t.corrida_inicio,'fim',t.corrida_fim))
  returning id into r;
  update public.testes set status='finalizado',ultima_rodada_id=r,rodada_atual=rodada_atual+1
    where id=t.id returning * into t;
  return t;
end $$;
revoke all on function private.encerrar_corrida(uuid,text) from public,anon,authenticated;
grant execute on function private.encerrar_corrida(uuid,text) to service_role;

create function private.iniciar_corrida(p_teste_id uuid,p_modo text,p_rodada_esperada integer)
returns public.testes language plpgsql security definer set search_path = '' as $$
declare t public.testes; inicio timestamptz := clock_timestamp()+interval '3 seconds';
  zeros jsonb := '{"pontos":0,"distancia":0,"distancia_cm":0,"pisadas":0,"ritmo":0,"multiplicador":1,"pico_tensao":0}';
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Faça login.'; end if;
  select * into t from public.testes where id=p_teste_id and owner_id=auth.uid() for update;
  if not found then raise sqlstate 'PT403' using message='Você não administra esta corrida.'; end if;
  if t.status='rodando' or p_rodada_esperada is distinct from t.rodada_atual then
    raise sqlstate 'PT409' using message='A corrida já mudou. Atualize o painel.';
  end if;
  if p_modo is null or p_modo not in ('oficial','treino') then raise sqlstate 'PT400' using message='Modo inválido.'; end if;
  if p_modo='oficial' and (select count(*) from private.dispositivos where teste_id=t.id) <> 2 then
    raise sqlstate 'PT409' using message='Configure os tokens dos dois ESP32 antes da corrida oficial.';
  end if;
  delete from private.sinais where teste_id=t.id;
  update public.testes set status='rodando',modo=p_modo,corrida_inicio=inicio,corrida_fim=inicio+interval '60 seconds',
    infos_player_1=(infos_player_1-'tensao'-'atualizado_em'-'ultima_pisada_em')||zeros,
    infos_player_2=(infos_player_2-'tensao'-'atualizado_em'-'ultima_pisada_em')||zeros
    where id=t.id returning * into t;
  return t;
end $$;

create function private.concluir_corrida(p_teste_id uuid)
returns public.testes language plpgsql security definer set search_path = '' as $$
declare t public.testes;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Faça login.'; end if;
  select * into t from public.testes where id=p_teste_id and
    (owner_id=auth.uid() or exists(select 1 from public.teste_participantes where teste_id=p_teste_id and user_id=auth.uid())) for update;
  if not found then raise sqlstate 'PT403' using message='Sem acesso à corrida.'; end if;
  if t.status<>'rodando' then return t; end if;
  if t.corrida_fim is null or clock_timestamp()<t.corrida_fim+interval '2 seconds' then
    raise sqlstate 'PT409' using message='A corrida ainda não terminou.';
  end if;
  return private.encerrar_corrida(t.id,'tempo');
end $$;

-- Mantém o endpoint antigo para interrupção, sem publicar resultados parciais.
create or replace function private.finalizar_rodada(p_teste_id uuid,p_rodada_esperada integer)
returns public.testes language plpgsql security definer set search_path = '' as $$
declare t public.testes;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Faça login.'; end if;
  select * into t from public.testes where id=p_teste_id and owner_id=auth.uid() for update;
  if not found then raise sqlstate 'PT403' using message='Sem permissão.'; end if;
  if t.status<>'rodando' or p_rodada_esperada is distinct from t.rodada_atual then raise sqlstate 'PT409' using message='A rodada já mudou.'; end if;
  return private.encerrar_corrida(t.id,'interrompida');
end $$;
create or replace function private.alterar_status(p_teste_id uuid,p_status text)
returns public.testes language plpgsql security invoker set search_path = '' as $$
begin raise sqlstate 'PT400' using message='Use iniciar_corrida ou finalizar_rodada. Corridas competitivas não podem ser pausadas.'; end $$;

create function public.iniciar_corrida(p_teste_id uuid,p_modo text,p_rodada_esperada integer)
returns public.testes language sql security invoker set search_path = '' as $$select private.iniciar_corrida(p_teste_id,p_modo,p_rodada_esperada)$$;
create function public.concluir_corrida(p_teste_id uuid)
returns public.testes language sql security invoker set search_path = '' as $$select private.concluir_corrida(p_teste_id)$$;
create function public.hora_servidor() returns timestamptz language sql volatile security invoker set search_path = '' as $$select clock_timestamp()$$;
revoke all on function public.iniciar_corrida(uuid,text,integer),public.concluir_corrida(uuid),public.hora_servidor(),
  private.iniciar_corrida(uuid,text,integer),private.concluir_corrida(uuid) from public,anon,authenticated;
grant execute on function public.iniciar_corrida(uuid,text,integer),public.concluir_corrida(uuid),public.hora_servidor(),
  private.iniciar_corrida(uuid,text,integer),private.concluir_corrida(uuid) to authenticated;

create function private.aplicar_lote(p_teste_id uuid,p_player integer,p_amostras jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t public.testes; i jsonb; s jsonb; item jsonb; calculo jsonb; v numeric; ms bigint;
  agora bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  contar boolean; inicio_ms bigint; fim_ms bigint;
begin
  if p_player is null or p_player not in (1,2) or p_amostras is null or jsonb_typeof(p_amostras)<>'array'
    or jsonb_array_length(p_amostras) not between 1 and 50 then raise sqlstate 'PT400' using message='Amostras inválidas.'; end if;
  select * into t from public.testes where id=p_teste_id for update;
  if not found then raise sqlstate 'PT404' using message='Corrida não encontrada.'; end if;
  if t.status='rodando' and t.corrida_fim is not null and clock_timestamp()>=t.corrida_fim+interval '2 seconds' then
    t := private.encerrar_corrida(t.id,'tempo');
  end if;
  i := case when p_player=1 then t.infos_player_1 else t.infos_player_2 end;
  select estado into s from private.sinais where teste_id=t.id and player=p_player;
  s := coalesce(s,'{}');
  inicio_ms := floor(extract(epoch from t.corrida_inicio)*1000)::bigint;
  fim_ms := floor(extract(epoch from t.corrida_fim)*1000)::bigint;
  for item in select value from jsonb_array_elements(p_amostras) loop
    if jsonb_typeof(item->'tensao') is distinct from 'number' or jsonb_typeof(item->'instante_ms') is distinct from 'number' then
      raise sqlstate 'PT400' using message='Amostra precisa de tensão e instante_ms numéricos.';
    end if;
    v := (item->>'tensao')::numeric;
    ms := (item->>'instante_ms')::bigint;
    if v not between 0 and 3.6 or ms not between agora-3000 and agora+500 then
      raise sqlstate 'PT400' using message='Amostra fora da faixa ou do intervalo de relógio permitido.';
    end if;
    contar := t.status='rodando' and inicio_ms is not null and ms>=inicio_ms and ms<fim_ms;
    calculo := private.processar_amostra(i,s,v,ms,contar);
    i := calculo->'info'; s := calculo->'estado';
  end loop;
  insert into private.sinais(teste_id,player,estado) values(t.id,p_player,s)
    on conflict(teste_id,player) do update set estado=excluded.estado;
  if p_player=1 then update public.testes set infos_player_1=i where id=t.id;
  else update public.testes set infos_player_2=i where id=t.id; end if;
  return jsonb_build_object('ok',true,'teste_id',t.id,'player',p_player,'rodada',t.rodada_atual,
    'tensao',i->'tensao','pontos',coalesce(i->'pontos','0'),'distancia',coalesce(i->'distancia','0'),'status',t.status);
end $$;
revoke all on function private.aplicar_lote(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function private.aplicar_lote(uuid,integer,jsonb) to service_role;

create function public.registrar_amostras(p_teste_id uuid,p_player integer,p_amostras jsonb,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t public.testes;
begin
  select * into t from public.testes where id=p_teste_id for update;
  if not found then raise sqlstate 'PT404' using message='Corrida não encontrada.'; end if;
  if not exists(select 1 from private.dispositivos where teste_id=t.id and player=p_player and token_hash=p_token_hash) then
    raise sqlstate 'PT401' using message='Token do dispositivo inválido.';
  end if;
  if t.modo='treino' and t.status='rodando' then raise sqlstate 'PT409' using message='Esta corrida está em modo treino.'; end if;
  return private.aplicar_lote(t.id,p_player,p_amostras);
end $$;
revoke all on function public.registrar_amostras(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.registrar_amostras(uuid,integer,jsonb,text) to service_role;

-- Payload de leitura única continua disponível para curl e firmware anterior.
create or replace function public.registrar_tensao(p_teste_id uuid,p_player integer,p_tensao double precision,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_tensao is null or p_tensao<0 or p_tensao>3.6 or p_tensao='NaN'::float8 then
    raise sqlstate 'PT400' using message='Tensão deve estar entre 0 e 3,6 V.';
  end if;
  return public.registrar_amostras(p_teste_id,p_player,jsonb_build_array(jsonb_build_object(
    'tensao',p_tensao,'instante_ms',floor(extract(epoch from clock_timestamp())*1000)::bigint)),p_token_hash);
end $$;

create function private.pisada_treino(p_teste_id uuid,p_player integer,p_forca numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.testes; ms bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Faça login.'; end if;
  select * into t from public.testes where id=p_teste_id and owner_id=auth.uid() for update;
  if not found then raise sqlstate 'PT403' using message='Sem permissão.'; end if;
  if t.status<>'rodando' or t.modo<>'treino' then raise sqlstate 'PT409' using message='Inicie um treino para usar o teclado.'; end if;
  if p_player is null or p_player not in (1,2) or p_forca is null or p_forca not between 0.6 and 3.3 then
    raise sqlstate 'PT400' using message='Pisada inválida.';
  end if;
  return private.aplicar_lote(t.id,p_player,jsonb_build_array(
    jsonb_build_object('tensao',0,'instante_ms',ms-100),
    jsonb_build_object('tensao',p_forca,'instante_ms',ms-80),
    jsonb_build_object('tensao',0,'instante_ms',ms)));
end $$;
create function public.pisada_treino(p_teste_id uuid,p_player integer,p_forca numeric)
returns jsonb language sql security invoker set search_path = '' as $$select private.pisada_treino(p_teste_id,p_player,p_forca)$$;
revoke all on function private.pisada_treino(uuid,integer,numeric),public.pisada_treino(uuid,integer,numeric) from public,anon,authenticated;
grant execute on function private.pisada_treino(uuid,integer,numeric),public.pisada_treino(uuid,integer,numeric) to authenticated;

create function private.registrar_vencedor(p_rodada_id uuid,p_nome text)
returns public.ranking_mundial language plpgsql security definer set search_path = '' as $$
declare r public.rodadas; t public.testes; i jsonb; entrada public.ranking_mundial; nome_limpo text; vencedor integer;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message='Faça login.'; end if;
  select * into r from public.rodadas where id=p_rodada_id for update;
  if not found then raise sqlstate 'PT404' using message='Resultado não encontrado.'; end if;
  select * into t from public.testes where id=r.teste_id and owner_id=auth.uid();
  if not found then raise sqlstate 'PT403' using message='A inscrição deve ser feita no painel que realizou a corrida.'; end if;
  if (r.resultado->>'elegivel_ranking')::boolean is distinct from true or r.resultado->>'modo'<>'oficial'
    or r.resultado->>'motivo'<>'tempo' or r.resultado->>'regras_versao'<>'v1-60s' then
    raise sqlstate 'PT403' using message='Apenas vitórias em corridas oficiais completas entram no ranking.';
  end if;
  vencedor := (r.resultado->>'vencedor')::integer;
  if vencedor is null or vencedor not in (1,2) then raise sqlstate 'PT403' using message='Esta corrida não possui vencedor.'; end if;
  nome_limpo := regexp_replace(btrim(p_nome),'\s+',' ','g');
  if nome_limpo is null or char_length(nome_limpo) not between 2 and 24 or nome_limpo !~ '^[[:alnum:] ._-]+$' then
    raise sqlstate 'PT400' using message='Use de 2 a 24 letras, números, espaços, ponto, hífen ou sublinhado.';
  end if;
  select * into entrada from public.ranking_mundial where rodada_id=r.id;
  if found then
    if entrada.nome=nome_limpo then return entrada; end if;
    raise sqlstate 'PT409' using message='Esta vitória já foi registrada.';
  end if;
  i := case when vencedor=1 then r.infos_player_1 else r.infos_player_2 end;
  insert into public.ranking_mundial(rodada_id,nome,player,pontos,distancia,pisadas)
    values(r.id,nome_limpo,vencedor,(i->>'pontos')::integer,(i->>'distancia')::numeric,(i->>'pisadas')::integer)
    returning * into entrada;
  return entrada;
end $$;
create function public.registrar_vencedor(p_rodada_id uuid,p_nome text)
returns public.ranking_mundial language sql security invoker set search_path = '' as $$select private.registrar_vencedor(p_rodada_id,p_nome)$$;
revoke all on function private.registrar_vencedor(uuid,text),public.registrar_vencedor(uuid,text) from public,anon,authenticated;
grant execute on function private.registrar_vencedor(uuid,text),public.registrar_vencedor(uuid,text) to authenticated;

-- Fim autônomo mesmo se ambos os dispositivos e todos os navegadores desconectarem.
create function private.expirar_corridas() returns void language plpgsql security invoker set search_path = '' as $$
declare t record;
begin
  for t in select id from public.testes where status='rodando' and corrida_fim<clock_timestamp()-interval '2 seconds'
    order by corrida_fim limit 50 for update skip locked loop
    perform private.encerrar_corrida(t.id,'tempo');
  end loop;
end $$;
revoke all on function private.expirar_corridas() from public,anon,authenticated;
grant execute on function private.expirar_corridas() to service_role;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('conep_voltage_run_expirar_v1','5 seconds','select private.expirar_corridas()');
alter publication supabase_realtime add table public.ranking_mundial;
