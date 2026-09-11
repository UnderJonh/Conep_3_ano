-- Somente fixtures temporárias. Nenhuma alteração de dados sobrevive ao rollback.
begin;
create function pg_temp.check_ok(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FALHA: %',message; end if; end $$;
create temporary table fixture(owner_id uuid,outsider_id uuid,teste_id uuid);
insert into fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on fixture to authenticated,anon;
insert into auth.users(id) select owner_id from fixture union all select outsider_id from fixture;
insert into public.testes(id,owner_id,nome) select teste_id,owner_id,'QA duração transacional' from fixture;
insert into private.dispositivos(teste_id,player,token_hash)
select teste_id,1,repeat('a',64) from fixture union all select teste_id,2,repeat('b',64) from fixture;
select set_config('request.jwt.claims',json_build_object('sub',outsider_id,'role','authenticated')::text,true) from fixture;
set local role authenticated;
do $$ begin
  begin perform public.iniciar_corrida((select teste_id from fixture),'oficial',1,15); raise exception 'Intruso iniciou'; exception when sqlstate 'PT403' then null; end;
  begin perform public.dispositivos_configurados((select teste_id from fixture)); raise exception 'Intruso leu configuração'; exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true) from fixture;
set local role authenticated;
do $$ declare n integer; t public.testes; begin
  foreach n in array array[14,601,null] loop
    begin perform public.iniciar_corrida((select teste_id from fixture),'oficial',1,n); raise exception 'Duração inválida aceita'; exception when sqlstate 'PT400' then null; end;
  end loop;
  t := public.iniciar_corrida((select teste_id from fixture),'oficial',1,600);
  perform pg_temp.check_ok(t.duracao_segundos=600 and t.corrida_fim-t.corrida_inicio=interval '600 seconds','Duração máxima aplicada');
  t := public.finalizar_rodada(t.id,1);
  perform pg_temp.check_ok((select (resultado->>'elegivel_arena')::boolean=false from public.rodadas where id=t.ultima_rodada_id),'Interrupção fora do ranking');
  t := public.iniciar_corrida(t.id,'oficial',2,15);
  perform pg_temp.check_ok(t.duracao_segundos=15,'Duração mínima aplicada');
end $$;
reset role;
update public.testes set corrida_inicio=clock_timestamp()-interval '30 seconds',corrida_fim=clock_timestamp()-interval '15 seconds',
  infos_player_1='{"distancia_cm":800,"distancia":8,"pontos":80,"pisadas":2}',
  infos_player_2='{"distancia_cm":400,"distancia":4,"pontos":40,"pisadas":1}'
where id=(select teste_id from fixture);
set local role authenticated;
do $$ declare t public.testes; r public.rodadas; entry public.ranking_arena; duplicate public.ranking_arena; begin
  t := public.concluir_corrida((select teste_id from fixture));
  select * into r from public.rodadas where id=t.ultima_rodada_id;
  perform pg_temp.check_ok(r.resultado->>'duracao_segundos'='15' and r.resultado->>'vencedor'='1','Snapshot com duração real e vencedor');
  perform pg_temp.check_ok((r.resultado->>'elegivel_arena')::boolean and not (r.resultado->>'elegivel_ranking')::boolean,'Categoria personalizada não acessa mundial');
  begin perform public.registrar_vencedor(r.id,'QA Mundial'); raise exception 'Personalizada entrou no mundial'; exception when sqlstate 'PT403' then null; end;
  begin perform public.registrar_vencedor_arena(r.id,'QA Mundial',true); raise exception 'Publicação indireta no mundial'; exception when sqlstate 'PT403' then null; end;
  perform pg_temp.check_ok(not exists(select 1 from public.ranking_arena where rodada_id=r.id),'Publicação recusada é atômica');
  entry := public.registrar_vencedor_arena(r.id,'QA Arena',false);
  duplicate := public.registrar_vencedor_arena(r.id,'QA Arena',false);
  perform pg_temp.check_ok(entry.id=duplicate.id and entry.distancia=8 and entry.duracao_segundos=15,'Inscrição idempotente e pontuação do servidor');
  begin perform public.registrar_vencedor_arena(r.id,'QA Outro',false); raise exception 'Nome trocado'; exception when sqlstate 'PT409' then null; end;
  -- Assinatura antiga continua compatível após uma corrida personalizada.
  t := public.iniciar_corrida(t.id,'oficial',3);
  perform pg_temp.check_ok(t.duracao_segundos=60 and t.corrida_fim-t.corrida_inicio=interval '60 seconds','Cliente anterior preserva 60 s');
end $$;
reset role;
set local role anon;
select pg_temp.check_ok((select count(*) from public.ranking_arena where teste_id=(select teste_id from fixture))=1,'Ranking da arena público');
do $$ begin
  begin insert into public.ranking_arena(teste_id) select teste_id from fixture; raise exception 'Escrita pública permitida'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
