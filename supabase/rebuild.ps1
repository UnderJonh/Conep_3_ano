param([string]$OutputPath = (Join-Path $PSScriptRoot 'rebuild.sql'))
$ErrorActionPreference = 'Stop'
$migration = Join-Path $PSScriptRoot 'migrations/20260917155448_crossy_game_from_scratch.sql'
$reset = @'
-- RECONSTRUÇÃO DO ZERO: apaga conexões, tokens, sinais e rankings do jogo.
-- Execute este arquivo inteiro no SQL Editor do projeto CONEP.
-- Auth, Storage e dados que não pertencem ao jogo são preservados.
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
      'alterar_status', 'finalizar_rodada', 'iniciar_corrida', 'concluir_corrida',
      'registrar_vencedor', 'registrar_vencedor_arena', 'pisada_treino', 'hora_servidor'
    ) loop
    execute format('drop function if exists %s cascade', fn.signature);
  end loop;
end $$;

drop table if exists public.ranking_arena, public.ranking_mundial, public.rodadas,
  public.teste_participantes, public.crossy_ranking, public.testes cascade;
-- Retira somente os objetos private usados pelas versões anteriores deste jogo.
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

'@
$history = @'

-- Alinha o histórico com a migration única usada por esta versão do projeto.
do $$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version in (
      '20260910151138', '20260911020407', '20260911100422', '20260917140736'
    );
    insert into supabase_migrations.schema_migrations(version, name, statements)
      values ('20260917155448', 'crossy_game_from_scratch', array[]::text[])
      on conflict (version) do update set name = excluded.name;
  end if;
end $$;
commit;
'@
$sql = $reset + "`n" + [IO.File]::ReadAllText($migration) + "`n" + $history
[IO.File]::WriteAllText($OutputPath, $sql, [Text.UTF8Encoding]::new($false))
Write-Output "SQL completo gerado em $OutputPath"
