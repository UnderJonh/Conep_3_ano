-- Integração Voltage Run. Fixtures e alterações são integralmente revertidas.
begin;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FALHA: %', message; end if; end; $$;

-- Mesma entrada elétrica, regras determinísticas: força, cadência, ruído e replay.
create function pg_temp.pulso(i jsonb,s jsonb,forca numeric,ms bigint) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := private.processar_amostra(i,s,0,ms-100,true);
  r := private.processar_amostra(r->'info',r->'estado',forca,ms-80,true);
  return private.processar_amostra(r->'info',r->'estado',0,ms,true);
end $$;
do $$
declare leve jsonb; forte jsonb; rapido jsonb; lento jsonb; r jsonb; anterior jsonb;
begin
  leve := pg_temp.pulso('{"extra":"preservar"}','{}',1.5,5000);
  forte := pg_temp.pulso('{}','{}',3.3,5000);
  perform pg_temp.assert_true((forte->'info'->>'distancia_cm')::int > (leve->'info'->>'distancia_cm')::int,'Força aumenta distância');
  perform pg_temp.assert_true(leve->'info'->>'extra'='preservar','JSON adicional preservado');
  rapido := pg_temp.pulso(forte->'info',forte->'estado',3.3,5300);
  lento := pg_temp.pulso(forte->'info',forte->'estado',3.3,6500);
  perform pg_temp.assert_true((rapido->'info'->>'distancia_cm')::int > (lento->'info'->>'distancia_cm')::int,'Cadência aumenta distância');
  r := pg_temp.pulso(forte->'info',forte->'estado',3.3,5150);
  perform pg_temp.assert_true(r->'info'->>'pisadas'='1','Debounce de 200 ms');
  r := pg_temp.pulso(forte->'info',forte->'estado',3.3,5000);
  perform pg_temp.assert_true(r->'info'=forte->'info','Replay não pontua');
  r := private.processar_amostra('{}','{}',0,5000,true);
  r := private.processar_amostra(r->'info',r->'estado',3.3,5020,true);
  for n in 1..20 loop r := private.processar_amostra(r->'info',r->'estado',3.3,5020+n*100,true); end loop;
  r := private.processar_amostra(r->'info',r->'estado',0,7100,true);
  perform pg_temp.assert_true(coalesce((r->'info'->>'pisadas')::int,0)=0,'Pressão mantida não pontua');
  r := pg_temp.pulso('{}','{}',0.4,5000);
  perform pg_temp.assert_true(coalesce((r->'info'->>'pisadas')::int,0)=0,'Ruído abaixo do limiar não pontua');
  r := private.processar_amostra('{}','{}',3.3,5000,true);
  r := private.processar_amostra(r->'info',r->'estado',0,5100,true);
  perform pg_temp.assert_true(coalesce((r->'info'->>'pisadas')::int,0)=0,'É necessário começar liberado');
end $$;

create temporary table fixture(owner_id uuid,viewer_id uuid,outsider_id uuid,teste_id uuid);
insert into fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on fixture to authenticated,anon,service_role;
insert into auth.users(id) select owner_id from fixture union all select viewer_id from fixture union all select outsider_id from fixture;
insert into public.testes(id,owner_id,nome,infos_player_1)
select teste_id,owner_id,'QA transacional Voltage Run','{"extra":"preservar"}' from fixture;
insert into public.teste_participantes select teste_id,viewer_id from fixture;
insert into private.dispositivos(teste_id,player,token_hash) select teste_id,1,repeat('a',64) from fixture;
insert into private.dispositivos(teste_id,player,token_hash) select teste_id,2,repeat('b',64) from fixture;

select set_config('request.jwt.claims',json_build_object('sub',outsider_id,'role','authenticated')::text,true) from fixture;
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.testes where id=(select teste_id from fixture))=0,'Intruso não lê arena');
do $$ begin
  begin perform public.iniciar_corrida((select teste_id from fixture),'oficial',1); raise exception 'FALHA: intruso iniciou'; exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',viewer_id,'role','authenticated')::text,true) from fixture;
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.testes where id=(select teste_id from fixture))=1,'Participante lê arena');
do $$ begin
  begin perform public.iniciar_corrida((select teste_id from fixture),'oficial',1); raise exception 'FALHA: participante iniciou'; exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true) from fixture;
set local role authenticated;
select public.iniciar_corrida(teste_id,'oficial',1) is not null from fixture;
do $$ begin
  begin perform public.concluir_corrida((select teste_id from fixture)); raise exception 'FALHA: término antecipado'; exception when sqlstate 'PT409' then null; end;
  begin perform public.pisada_treino((select teste_id from fixture),1,3.3); raise exception 'FALHA: teclado pontuou oficial'; exception when sqlstate 'PT409' then null; end;
  begin update public.testes set infos_player_1='{"pontos":999}' where id=(select teste_id from fixture); raise exception 'FALHA: pontos adulterados'; exception when insufficient_privilege then null; end;
  begin insert into public.ranking_mundial(nome) values('Falso'); raise exception 'FALHA: escrita direta ranking'; exception when insufficient_privilege then null; end;
  begin perform public.registrar_tensao((select teste_id from fixture),1,3.3,repeat('a',64)); raise exception 'FALHA: RPC de servidor exposta'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Só a fixture privilegiada acelera o tempo. APIs normais não possuem esta permissão.
update public.testes set corrida_inicio=clock_timestamp()-interval '2 seconds',corrida_fim=clock_timestamp()+interval '58 seconds' where id=(select teste_id from fixture);
set local role service_role;
do $$ declare ms bigint := floor(extract(epoch from clock_timestamp())*1000)::bigint; a jsonb; begin
  a := jsonb_build_array(jsonb_build_object('tensao',0,'instante_ms',ms-100),jsonb_build_object('tensao',3.3,'instante_ms',ms-80),jsonb_build_object('tensao',0,'instante_ms',ms));
  perform public.registrar_amostras((select teste_id from fixture),1,a,repeat('a',64));
  perform public.registrar_amostras((select teste_id from fixture),1,a,repeat('a',64));
  begin perform public.registrar_amostras((select teste_id from fixture),2,a,repeat('a',64)); raise exception 'FALHA: token cruzado'; exception when sqlstate 'PT401' then null; end;
  begin perform public.registrar_amostras((select teste_id from fixture),1,jsonb_build_array(jsonb_build_object('tensao',3,'instante_ms',ms-4000)),repeat('a',64)); raise exception 'FALHA: dados vencidos'; exception when sqlstate 'PT400' then null; end;
end $$;
select pg_temp.assert_true(infos_player_1->>'pisadas'='1' and infos_player_1->>'pontos'='40' and infos_player_1->>'extra'='preservar','Lote real e replay') from public.testes where id=(select teste_id from fixture);
reset role;
update public.testes set corrida_inicio=clock_timestamp()-interval '63 seconds',corrida_fim=clock_timestamp()-interval '3 seconds' where id=(select teste_id from fixture);
select private.expirar_corridas();
set local role authenticated;
select public.concluir_corrida(teste_id) is not null from fixture;
select pg_temp.assert_true(rodada_atual=2 and status='finalizado','Fim autônomo idempotente') from public.testes where id=(select teste_id from fixture);
select pg_temp.assert_true(count(*)=1,'Snapshot único') from public.rodadas where teste_id=(select teste_id from fixture);
select pg_temp.assert_true(resultado->>'vencedor'='1' and (resultado->>'elegivel_ranking')::boolean and infos_player_1->>'pontos'='40','Vencedor do snapshot') from public.rodadas where teste_id=(select teste_id from fixture);
select public.registrar_vencedor(ultima_rodada_id,'QA Vencedor') is not null from public.testes where id=(select teste_id from fixture);
select public.registrar_vencedor(ultima_rodada_id,'QA Vencedor') is not null from public.testes where id=(select teste_id from fixture);
select pg_temp.assert_true(count(*)=1 and max(pontos)=40 and max(player)=1,'Ranking único com pontuação do vencedor') from public.ranking_mundial where rodada_id in(select id from public.rodadas where teste_id=(select teste_id from fixture));
do $$ begin
  begin perform public.registrar_vencedor((select ultima_rodada_id from public.testes where id=(select teste_id from fixture)),'Outro nome'); raise exception 'FALHA: vitória reescrita'; exception when sqlstate 'PT409' then null; end;
end $$;
select public.iniciar_corrida(teste_id,'treino',2) is not null from fixture;
select pg_temp.assert_true(infos_player_1->>'pisadas'='0' and infos_player_1->>'extra'='preservar','Nova corrida zera somente campos do jogo') from public.testes where id=(select teste_id from fixture);
reset role;
update public.testes set corrida_inicio=clock_timestamp()-interval '2 seconds',corrida_fim=clock_timestamp()+interval '58 seconds' where id=(select teste_id from fixture);
set local role authenticated;
select public.pisada_treino(teste_id,1,3.3) is not null from fixture;
select public.finalizar_rodada(teste_id,2) is not null from fixture;
do $$ begin
  begin perform public.registrar_vencedor((select ultima_rodada_id from public.testes where id=(select teste_id from fixture)),'QA Treino'); raise exception 'FALHA: treino/interrupção no ranking'; exception when sqlstate 'PT403' then null; end;
end $$;
select public.iniciar_corrida(teste_id,'oficial',3) is not null from fixture;
reset role;
update public.testes set corrida_inicio=clock_timestamp()-interval '63 seconds',corrida_fim=clock_timestamp()-interval '3 seconds' where id=(select teste_id from fixture);
select private.expirar_corridas();
set local role authenticated;
do $$ begin
  begin perform public.registrar_vencedor((select ultima_rodada_id from public.testes where id=(select teste_id from fixture)),'QA Empate'); raise exception 'FALHA: empate no ranking'; exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
set local role anon;
select pg_temp.assert_true(count(*)=1,'Ranking é público') from public.ranking_mundial where nome='QA Vencedor';
do $$ begin
  begin perform * from public.testes; raise exception 'FALHA: arena privada exposta'; exception when insufficient_privilege then null; end;
  begin perform public.registrar_vencedor(gen_random_uuid(),'Anon'); raise exception 'FALHA: inscrição anônima'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
