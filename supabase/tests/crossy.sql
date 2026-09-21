-- Execute após a migration nova. Todos os dados de teste são revertidos.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
insert into public.testes(nome) values ('Crossy QA');
select set_config('crossy.qa_connection', (select id::text from public.testes where nome = 'Crossy QA'), true);
select public.configurar_crossy(current_setting('crossy.qa_connection')::uuid, 1.5);
select public.configurar_dispositivo(current_setting('crossy.qa_connection')::uuid, 1, repeat('a', 64));
do $$ begin
  if public.dispositivos_configurados(current_setting('crossy.qa_connection')::uuid) <> array[1] then raise exception 'Placa não configurada'; end if;
  begin
    update public.testes set limiar_forte = 0.6;
    raise exception 'Escrita direta deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.configurar_dispositivo(current_setting('crossy.qa_connection')::uuid, 2, repeat('a', 64));
    raise exception 'Placa 2 deveria falhar';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform public.configurar_crossy(current_setting('crossy.qa_connection')::uuid, 0.3);
    raise exception 'Sensibilidade inválida deveria falhar';
  exception when sqlstate 'PT400' then null; end;
end $$;

select public.registrar_recorde_crossy('33333333-3333-4333-8333-333333333333', '  Ana  ', 12);
select public.registrar_recorde_crossy('33333333-3333-4333-8333-333333333333', 'Ana', 12);
select public.registrar_recorde_crossy('44444444-4444-4444-8444-444444444444', 'João', 20);
do $$ begin
  if (select count(id) from public.crossy_ranking where id = '33333333-3333-4333-8333-333333333333') <> 1 then raise exception 'Reenvio duplicou recorde'; end if;
  if (select nome from public.crossy_ranking order by pontos desc, created_at limit 1) <> 'João' then raise exception 'Ranking fora de ordem'; end if;
  begin
    perform public.registrar_recorde_crossy(gen_random_uuid(), '   ', 1);
    raise exception 'Nome vazio deveria falhar';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform public.registrar_recorde_crossy(gen_random_uuid(), repeat('x', 25), 1);
    raise exception 'Nome longo deveria falhar';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform public.registrar_recorde_crossy(gen_random_uuid(), 'Ana', 0);
    raise exception 'Pontuação zero deveria falhar';
  exception when sqlstate 'PT400' then null; end;
  begin
    perform public.registrar_recorde_crossy('33333333-3333-4333-8333-333333333333', 'Ana', 999);
    raise exception 'Alteração de recorde deveria falhar';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.registrar_tensao(current_setting('crossy.qa_connection')::uuid, 1, 2, repeat('a', 64));
    raise exception 'Navegador não pode enviar telemetria';
  exception when insufficient_privilege then null; end;
  begin
    perform public.registrar_comando_ws(current_setting('crossy.qa_connection')::uuid, 1, 'deadbeef', 1, 2.5, repeat('a', 64));
    raise exception 'Navegador nao pode registrar comando WebSocket';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
do $$ begin
  if exists (select id from public.testes where id = current_setting('crossy.qa_connection')::uuid) then raise exception 'Outro usuário leu conexão'; end if;
  begin
    perform public.configurar_crossy(current_setting('crossy.qa_connection')::uuid, 2);
    raise exception 'Outro usuário configurou conexão';
  exception when sqlstate 'PT403' then null; end;
  begin
    perform public.configurar_dispositivo(current_setting('crossy.qa_connection')::uuid, 1, repeat('b', 64));
    raise exception 'Outro usuário substituiu token';
  exception when sqlstate 'PT403' then null; end;
  begin
    perform public.registrar_recorde_crossy('33333333-3333-4333-8333-333333333333', 'Ana', 12);
    raise exception 'Outro usuário registrou partida alheia';
  exception when sqlstate 'PT409' then null; end;
end $$;

reset role;
set local role anon;
do $$ begin
  if (select count(id) from public.crossy_ranking where id in ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444')) <> 2 then raise exception 'Ranking público não acessível'; end if;
  begin
    perform owner_id from public.crossy_ranking;
    raise exception 'Ranking expôs identidade privada';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.crossy_ranking;
    raise exception 'Visitante apagou ranking';
  exception when insufficient_privilege then null; end;
  begin
    perform public.registrar_recorde_crossy(gen_random_uuid(), 'Visitante', 30);
    raise exception 'Gravação sem sessão deveria falhar';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role service_role;
do $$
declare id uuid := current_setting('crossy.qa_connection')::uuid;
  ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint - 2600;
  pulse jsonb; result jsonb;
begin
  -- Pisada fraca: não conta.
  result := public.registrar_amostras(id, 1, jsonb_build_array(
    jsonb_build_object('tensao', 0, 'instante_ms', ms),
    jsonb_build_object('tensao', 1.2, 'instante_ms', ms + 20),
    jsonb_build_object('tensao', 0, 'instante_ms', ms + 60)), repeat('a', 64));
  if (result->>'comandos')::integer <> 0 then raise exception 'Pisada fraca contou'; end if;
  -- Pisada forte seguida de reenvio idêntico: conta uma vez.
  pulse := jsonb_build_array(
    jsonb_build_object('tensao', 0, 'instante_ms', ms + 200),
    jsonb_build_object('tensao', 2.4, 'instante_ms', ms + 220),
    jsonb_build_object('tensao', 0, 'instante_ms', ms + 260));
  result := public.registrar_amostras(id, 1, pulse, repeat('a', 64));
  if (result->>'comandos')::integer <> 1 then raise exception 'Pisada forte não contou'; end if;
  result := public.registrar_amostras(id, 1, pulse, repeat('a', 64));
  if (result->>'comandos')::integer <> 1 then raise exception 'Reenvio duplicou comando'; end if;
  -- Repique dentro de 200 ms: não conta.
  result := public.registrar_amostras(id, 1, jsonb_build_array(
    jsonb_build_object('tensao', 2.4, 'instante_ms', ms + 280),
    jsonb_build_object('tensao', 0, 'instante_ms', ms + 320)), repeat('a', 64));
  if (result->>'comandos')::integer <> 1 then raise exception 'Repique contou'; end if;
  -- Pulso repartido entre lotes: conta somente na liberação.
  result := public.registrar_amostras(id, 1, jsonb_build_array(jsonb_build_object('tensao', 2.8, 'instante_ms', ms + 500)), repeat('a', 64));
  if (result->>'comandos')::integer <> 1 then raise exception 'Contou antes de soltar'; end if;
  result := public.registrar_amostras(id, 1, jsonb_build_array(jsonb_build_object('tensao', 0, 'instante_ms', ms + 550)), repeat('a', 64));
  if (result->>'comandos')::integer <> 2 then raise exception 'Pulso dividido não contou'; end if;
  -- Pressão mantida por mais de 1.500 ms: não conta.
  result := public.registrar_amostras(id, 1, jsonb_build_array(
    jsonb_build_object('tensao', 2.8, 'instante_ms', ms + 800),
    jsonb_build_object('tensao', 0, 'instante_ms', ms + 2400)), repeat('a', 64));
  if (result->>'comandos')::integer <> 2 then raise exception 'Pressão mantida contou'; end if;
  -- O segundo pino mantém debounce, replay e contador independentes.
  result := public.registrar_amostras(id, 2, jsonb_build_array(
    jsonb_build_object('tensao', 0, 'instante_ms', ms + 100),
    jsonb_build_object('tensao', 2.5, 'instante_ms', ms + 120),
    jsonb_build_object('tensao', 0, 'instante_ms', ms + 160)), repeat('a', 64));
  if (result->>'player')::integer <> 2 or (result->>'comandos')::integer <> 1 then raise exception 'Pisada do jogador 2 não contou'; end if;
  if (select (infos_player_1->>'comandos')::integer from public.testes where public.testes.id = id) <> 2 then raise exception 'Jogador 2 alterou contador do jogador 1'; end if;
  if (select (infos_player_2->>'comandos')::integer from public.testes where public.testes.id = id) <> 1 then raise exception 'Contador do jogador 2 não foi persistido'; end if;
  if not public.autenticar_dispositivo_ws(id, repeat('a', 64)) then raise exception 'Gateway nao autenticou a placa'; end if;
  if public.autenticar_dispositivo_ws(id, repeat('b', 64)) then raise exception 'Gateway aceitou token invalido'; end if;
  result := public.registrar_comando_ws(id, 2, 'deadbeef', 1, 2.7, repeat('a', 64));
  if not (result->>'aceito')::boolean or (result->>'comandos')::integer <> 2 then raise exception 'Comando WebSocket nao foi registrado'; end if;
  result := public.registrar_comando_ws(id, 2, 'deadbeef', 1, 2.7, repeat('a', 64));
  if (result->>'aceito')::boolean or (result->>'comandos')::integer <> 2 then raise exception 'Comando WebSocket duplicado foi contado'; end if;
  begin
    perform public.registrar_amostras(id, 1, pulse, repeat('b', 64));
    raise exception 'Token inválido deveria falhar';
  exception when sqlstate 'PT401' then null; end;
  begin
    perform public.registrar_tensao(id, 1, 'NaN'::float8, repeat('a', 64));
    raise exception 'NaN deveria falhar';
  exception when sqlstate 'PT400' then null; end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select public.configurar_crossy(current_setting('crossy.qa_connection')::uuid, 3.0);
select public.configurar_dispositivo(current_setting('crossy.qa_connection')::uuid, 1, repeat('c', 64));
reset role;
set local role service_role;
do $$
declare id uuid := current_setting('crossy.qa_connection')::uuid;
  ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  result jsonb;
begin
  begin
    perform public.registrar_tensao(id, 1, 0, repeat('a', 64));
    raise exception 'Token antigo não foi revogado';
  exception when sqlstate 'PT401' then null; end;
  result := public.registrar_amostras(id, 1, jsonb_build_array(
    jsonb_build_object('tensao', 0, 'instante_ms', ms),
    jsonb_build_object('tensao', 2.8, 'instante_ms', ms + 20),
    jsonb_build_object('tensao', 0, 'instante_ms', ms + 60)), repeat('c', 64));
  if (result->>'comandos')::integer <> 2 then raise exception 'Sensibilidade nova ignorada'; end if;
end $$;
reset role;
rollback;
