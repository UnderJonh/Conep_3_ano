-- Crossy Road uses the existing authenticated ESP ingestion and Realtime table.
-- Historical races remain readable; new Crossy connections use only player 1.
alter table public.testes add column crossy boolean not null default false;
alter table public.testes add column limiar_forte numeric not null default 1.5
  check (limiar_forte between 0.6 and 3.3);
alter table public.testes add constraint crossy_sem_corrida
  check (not crossy or (status='aguardando' and corrida_inicio is null and corrida_fim is null));

create function private.configurar_crossy(p_teste_id uuid,p_limiar numeric)
returns public.testes language plpgsql security definer set search_path = '' as $$
declare t public.testes;
begin
  select * into t from public.testes where id=p_teste_id for update;
  if not found then raise sqlstate 'PT404' using message='Conexão não encontrada.'; end if;
  if auth.uid() is null or t.owner_id<>auth.uid() then
    raise sqlstate 'PT403' using message='Somente o proprietário configura esta placa.';
  end if;
  if p_limiar is null or p_limiar not between 0.6 and 3.3 then
    raise sqlstate 'PT400' using message='O limite deve estar entre 0,6 e 3,3 V.';
  end if;
  if t.status<>'aguardando' then raise sqlstate 'PT409' using message='Esta conexão ainda tem uma corrida em andamento.'; end if;
  -- Do not count a pulse that started under a different threshold.
  if not t.crossy or t.limiar_forte<>p_limiar then
    delete from private.sinais where teste_id=t.id;
  end if;
  update public.testes set crossy=true,limiar_forte=p_limiar,corrida_inicio=null,corrida_fim=null
    where id=t.id returning * into t;
  return t;
end $$;
create function public.configurar_crossy(p_teste_id uuid,p_limiar numeric)
returns public.testes language sql security invoker set search_path = ''
as $$ select private.configurar_crossy(p_teste_id,p_limiar) $$;
revoke all on function private.configurar_crossy(uuid,numeric),public.configurar_crossy(uuid,numeric) from public,anon,authenticated;
grant execute on function private.configurar_crossy(uuid,numeric),public.configurar_crossy(uuid,numeric) to authenticated;

create function private.processar_amostra_crossy(p_info jsonb,p_estado jsonb,p_tensao numeric,p_ms bigint,p_limiar numeric)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare i jsonb:=coalesce(p_info,'{}'); s jsonb:=coalesce(p_estado,'{}');
  armado boolean:=coalesce((s->>'armado')::boolean,false);
  pressionado boolean:=coalesce((s->>'pressionado')::boolean,false);
  inicio bigint:=coalesce((s->>'inicio')::bigint,0);
  ultimo bigint:=coalesce((s->>'ultimo')::bigint,0);
  ultima_amostra bigint:=coalesce((s->>'ultima_amostra')::bigint,0);
  pico numeric:=coalesce((s->>'pico')::numeric,0);
begin
  -- HTTP retries and out-of-order samples cannot replay a command.
  if p_ms<=ultima_amostra then return jsonb_build_object('info',i,'estado',s); end if;
  i:=i||jsonb_build_object('tensao',p_tensao,'atualizado_em',to_timestamp(p_ms/1000.0));
  if p_tensao<=0.25 then
    if pressionado and p_ms-inicio between 20 and 1500 and p_ms-ultimo>=200 then
      i:=i||jsonb_build_object('comandos',coalesce((i->>'comandos')::bigint,0)+1,
        'comando_em',to_timestamp(p_ms/1000.0),'pico_tensao',pico);
      s:=s||jsonb_build_object('ultimo',p_ms);
    end if;
    s:=s||jsonb_build_object('armado',true,'pressionado',false,'pico',0);
  elsif armado and not pressionado and p_tensao>=p_limiar then
    s:=s||jsonb_build_object('armado',false,'pressionado',true,'inicio',p_ms,'pico',p_tensao);
  elsif pressionado then
    s:=s||jsonb_build_object('pico',greatest(pico,p_tensao));
  end if;
  s:=s||jsonb_build_object('ultima_amostra',p_ms);
  return jsonb_build_object('info',i,'estado',s);
end $$;
revoke all on function private.processar_amostra_crossy(jsonb,jsonb,numeric,bigint,numeric) from public,anon,authenticated;
grant execute on function private.processar_amostra_crossy(jsonb,jsonb,numeric,bigint,numeric) to service_role;

create or replace function private.aplicar_lote(p_teste_id uuid,p_player integer,p_amostras jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t public.testes; i jsonb; s jsonb; item jsonb; calculo jsonb; v numeric; ms bigint;
  agora bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint;
  contar boolean; inicio_ms bigint; fim_ms bigint;
begin
  if p_player is null or p_player not in (1,2) or p_amostras is null or jsonb_typeof(p_amostras)<>'array'
    or jsonb_array_length(p_amostras) not between 1 and 50 then raise sqlstate 'PT400' using message='Amostras inválidas.'; end if;
  select * into t from public.testes where id=p_teste_id for update;
  if not found then raise sqlstate 'PT404' using message='Conexão não encontrada.'; end if;
  if t.crossy and p_player<>1 then raise sqlstate 'PT400' using message='Crossy Road usa somente uma placa (player 1).'; end if;
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
    if t.crossy then calculo := private.processar_amostra_crossy(i,s,v,ms,t.limiar_forte);
    else
      contar := t.status='rodando' and inicio_ms is not null and ms>=inicio_ms and ms<fim_ms;
      calculo := private.processar_amostra(i,s,v,ms,contar);
    end if;
    i := calculo->'info'; s := calculo->'estado';
  end loop;
  insert into private.sinais(teste_id,player,estado) values(t.id,p_player,s)
    on conflict(teste_id,player) do update set estado=excluded.estado;
  if p_player=1 then update public.testes set infos_player_1=i where id=t.id;
  else update public.testes set infos_player_2=i where id=t.id; end if;
  return jsonb_build_object('ok',true,'teste_id',t.id,'player',p_player,'rodada',t.rodada_atual,
    'tensao',i->'tensao','pontos',coalesce(i->'pontos','0'),'distancia',coalesce(i->'distancia','0'),
    'comandos',coalesce(i->'comandos','0'),'status',t.status);
end $$;
