alter table public.testes
  add column if not exists infos_player_2 jsonb not null default '{}'
  check (jsonb_typeof(infos_player_2) = 'object');

-- The single ESP32 uses one token, but each ADC pin keeps an independent
-- debounce/replay state and an independent public command counter.
update private.sinais
set estado = jsonb_build_object('player_1', estado, 'player_2', '{}'::jsonb)
where not (estado ? 'player_1');

create or replace function private.configurar_crossy(p_teste_id uuid, p_limiar numeric)
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

create or replace function private.configurar_dispositivo(p_teste_id uuid, p_player integer, p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = 'Faça login.'; end if;
  perform 1 from public.testes where id = p_teste_id and owner_id = auth.uid() for update;
  if not found then raise sqlstate 'PT403' using message = 'Conexão sem permissão de administração.'; end if;
  if p_player is distinct from 1 or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise sqlstate 'PT400' using message = 'Use a placa 1 e um token válido.';
  end if;
  insert into private.dispositivos(teste_id, token_hash) values (p_teste_id, p_token_hash)
    on conflict (teste_id) do update set token_hash = excluded.token_hash, created_at = now();
  update private.sinais set estado = '{}'::jsonb where teste_id = p_teste_id;
end $$;

create or replace function public.registrar_amostras(p_teste_id uuid, p_player integer, p_amostras jsonb, p_token_hash text)
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
  return jsonb_build_object('ok', true, 'teste_id', t.id, 'player', p_player,
    'tensao', i->'tensao', 'comandos', coalesce(i->'comandos', '0'));
end $$;
