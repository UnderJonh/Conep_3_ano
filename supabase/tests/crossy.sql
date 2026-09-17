begin;
do $$
declare i jsonb:='{}'; s jsonb:='{}'; result jsonb; count_before bigint;
begin
  -- Ignore a weak press, then accept exactly one complete strong press.
  result:=private.processar_amostra_crossy(i,s,0,1000,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,1.2,1020,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,0,1060,1.5); i:=result->'info';s:=result->'estado';
  if coalesce((i->>'comandos')::bigint,0)<>0 then raise exception 'Weak press moved the chicken'; end if;
  result:=private.processar_amostra_crossy(i,s,1.5,1100,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,2.5,1120,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,0,1140,1.5); i:=result->'info';s:=result->'estado';
  if (i->>'comandos')::bigint<>1 or (i->>'pico_tensao')::numeric<>2.5 then raise exception 'Strong press was not counted once'; end if;
  -- Duplicate batches, bounce, and a held sensor cannot produce extra commands.
  result:=private.processar_amostra_crossy(i,s,2.5,1120,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,0,1140,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,3.3,1180,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,0,1200,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,3.3,1600,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,3.3,3200,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,0,3300,1.5); i:=result->'info';s:=result->'estado';
  if (i->>'comandos')::bigint<>1 then raise exception 'Duplicate, bounce, or held press counted'; end if;
  result:=private.processar_amostra_crossy(i,s,2,3600,1.5); i:=result->'info';s:=result->'estado';
  result:=private.processar_amostra_crossy(i,s,0,3640,1.5); i:=result->'info';s:=result->'estado';
  if (i->>'comandos')::bigint<>2 then raise exception 'Second valid press missing'; end if;
  -- A device booting with pressure already applied must first be released.
  result:=private.processar_amostra_crossy('{}','{}',3.3,1000,1.5);
  result:=private.processar_amostra_crossy(result->'info',result->'estado',0,1040,1.5);
  if coalesce((result->'info'->>'comandos')::bigint,0)<>0 then raise exception 'Startup press counted'; end if;
  -- Configured sensitivity changes the minimum qualifying voltage.
  result:=private.processar_amostra_crossy('{}','{}',0,1000,2.5);
  result:=private.processar_amostra_crossy(result->'info',result->'estado',2,1020,2.5);
  result:=private.processar_amostra_crossy(result->'info',result->'estado',0,1060,2.5);
  if coalesce((result->'info'->>'comandos')::bigint,0)<>0 then raise exception 'Sensitivity ignored'; end if;
end $$;
select 'Crossy pulse detection passed' as resultado;
rollback;
