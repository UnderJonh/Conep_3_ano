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
