-- Execute pelo SQL Editor ou `supabase db query --linked --file ...`.
-- Todos os dados e mudanças desta suíte são revertidos ao final.
begin;
create temporary table fixture (owner_id uuid, viewer_id uuid, outsider_id uuid, teste_id uuid);
insert into fixture values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
grant select on fixture to authenticated, anon, service_role;
insert into auth.users(id) select owner_id from fixture union all select viewer_id from fixture union all select outsider_id from fixture;
insert into public.testes(id, owner_id, nome, status, infos_player_1, infos_player_2)
select teste_id, owner_id, 'Validação SQL temporária', 'rodando',
  '{"pontos":15,"extra":"preservar"}', '{"pontos":10}' from fixture;
insert into public.teste_participantes(teste_id,user_id) select teste_id,viewer_id from fixture;
insert into private.dispositivos(teste_id,player,token_hash) select teste_id,1,repeat('a',64) from fixture;
insert into private.dispositivos(teste_id,player,token_hash) select teste_id,2,repeat('b',64) from fixture;

create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FALHA: %', message; end if; end; $$;

set local role service_role;
select public.registrar_tensao(teste_id,1,2.81,repeat('a',64)) from fixture;
select public.registrar_tensao(teste_id,2,1.94,repeat('b',64)) from fixture;
select pg_temp.assert_true(infos_player_1->>'pontos' = '15' and infos_player_1->>'extra' = 'preservar'
  and infos_player_1->>'tensao' = '2.81' and infos_player_2->>'tensao' = '1.94', 'Merge dos JSONs')
from public.testes where id = (select teste_id from fixture);
reset role;

select set_config('request.jwt.claims', json_build_object('sub',outsider_id,'role','authenticated')::text,true) from fixture;
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.testes where id = (select teste_id from fixture)) = 0, 'Intruso não lê teste');
do $$ begin
  begin
    perform public.finalizar_rodada((select teste_id from fixture),1);
    raise exception 'FALHA: intruso finalizou rodada';
  exception when sqlstate 'PT403' then null; end;
  begin
    perform public.configurar_dispositivo((select teste_id from fixture),1,repeat('c',64));
    raise exception 'FALHA: intruso trocou token';
  exception when sqlstate 'PT403' then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub',viewer_id,'role','authenticated')::text,true) from fixture;
set local role authenticated;
select pg_temp.assert_true((select count(*) from public.testes where id = (select teste_id from fixture)) = 1, 'Participante lê teste');
do $$ begin
  begin
    perform public.finalizar_rodada((select teste_id from fixture),1);
    raise exception 'FALHA: participante administrou rodada';
  exception when sqlstate 'PT403' then null; end;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub',owner_id,'role','authenticated')::text,true) from fixture;
set local role authenticated;
select public.finalizar_rodada(teste_id,1) from fixture;
select pg_temp.assert_true(rodada_atual = 2 and infos_player_1->>'pontos' = '15'
  and infos_player_1->>'extra' = 'preservar' and not (infos_player_1 ? 'tensao')
  and not (infos_player_1 ? 'atualizado_em'), 'Nova rodada limpa apenas dados transitórios')
from public.testes where id = (select teste_id from fixture);
select pg_temp.assert_true(numero = 1 and infos_player_1->>'tensao' = '2.81'
  and infos_player_2->>'pontos' = '10', 'Snapshot do histórico')
from public.rodadas where teste_id = (select teste_id from fixture);
do $$ begin
  begin
    perform public.finalizar_rodada((select teste_id from fixture),1);
    raise exception 'FALHA: finalização duplicada';
  exception when sqlstate 'PT409' then null; end;
  begin
    update public.testes set rodada_atual = 100 where id = (select teste_id from fixture);
    raise exception 'FALHA: escrita direta no estado';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.rodadas(teste_id,numero,infos_player_1,infos_player_2) values ((select teste_id from fixture),100,'{}','{}');
    raise exception 'FALHA: histórico adulterável';
  exception when insufficient_privilege then null; end;
  begin
    perform public.registrar_tensao((select teste_id from fixture),1,3,repeat('a',64));
    raise exception 'FALHA: cliente chamou RPC exclusiva do servidor';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role anon;
do $$ begin
  begin
    perform * from public.testes;
    raise exception 'FALHA: leitura sem login';
  exception when insufficient_privilege then null; end;
  begin
    perform public.finalizar_rodada((select teste_id from fixture),2);
    raise exception 'FALHA: RPC sem login';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
