import { useCallback, useEffect, useState } from 'react';
import { useTeste } from '../hooks/useTeste';
import { useGameClock } from '../hooks/useGameClock';
import { client, errorMessage } from '../lib/supabase';
import { History } from './History';
import { DeviceSetup } from './DeviceSetup';
import { Leaderboard } from './Leaderboard';
import { RaceStage, getPhase } from './RaceStage';
import { WinnerForm } from './WinnerForm';

export function TestMonitor({ id, userId, navigate }: { id: string; userId: string; navigate: (path: string) => void }) {
  const { teste, rodadas, loading, error, historyError, connection, retry, applyServerState } = useTeste(id);
  const { now, synced } = useGameClock();
  const [mode, setMode] = useState<'oficial' | 'treino'>('oficial');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [cancelRound, setCancelRound] = useState<number | null>(null);
  const owner = teste?.owner_id === userId;
  const phase = teste ? getPhase(teste, now) : 'ready';
  const racing = teste?.status === 'rodando';
  const training = teste?.modo === 'treino' && phase === 'running' && owner;

  useEffect(() => {
    if (!racing || !teste?.corrida_fim || !synced) return;
    // Um único disparo no fim da corrida. O cron também encerra partidas sem navegador aberto.
    const timer = window.setTimeout(() => {
      void client().rpc('concluir_corrida', { p_teste_id: id }).then(({ data, error: err }) => {
        if (err && err.code !== 'PT409') setActionError(errorMessage(err));
        if (data) applyServerState(data);
      });
    }, Math.max(0, Date.parse(teste.corrida_fim) + 2400 - now));
    return () => clearTimeout(timer);
  }, [id, teste?.corrida_fim, racing, synced]);

  const step = useCallback(async (player: number, force: number) => {
    if (!training) return;
    const { error: err } = await client().rpc('pisada_treino', { p_teste_id: id, p_player: player, p_forca: force });
    if (err) setActionError(errorMessage(err));
  }, [id, training]);
  useEffect(() => {
    if (!training) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)))) return;
      const keys: Record<string, [number, number]> = { a: [1, 1.5], s: [1, 3.3], k: [2, 1.5], l: [2, 3.3] };
      const input = keys[event.key.toLowerCase()];
      if (input) { event.preventDefault(); void step(...input); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [training, step]);

  async function start() {
    if (!teste) return;
    setBusy(true); setActionError('');
    const { data, error: err } = await client().rpc('iniciar_corrida', { p_teste_id: id, p_modo: mode, p_rodada_esperada: teste.rodada_atual });
    setBusy(false);
    if (err) setActionError(errorMessage(err));
    else { setCancelRound(null); if (data) applyServerState(data); }
  }
  async function cancel() {
    if (cancelRound === null) return;
    setBusy(true); setActionError('');
    const { data, error: err } = await client().rpc('finalizar_rodada', { p_teste_id: id, p_rodada_esperada: cancelRound });
    setBusy(false); setCancelRound(null);
    if (err) setActionError(errorMessage(err));
    else if (data) applyServerState(data);
  }
  if (loading) return <main className="container" role="status">Preparando a pista...</main>;
  if (error || !teste) return <main className="container surface error-state"><h1>Não foi possível abrir a arena</h1><p role="alert">{error}</p><button onClick={retry}>Tentar novamente</button></main>;
  const result = rodadas.find(r => r.id === teste.ultima_rodada_id);
  return <main className="game-container">
    <RaceStage teste={teste} now={now} synced={synced} connection={connection} />
    <div className="game-bottom">
      <section className="game-controls" aria-label="Controle da corrida">
        <div className="round-info"><strong>⚑ RODADA {teste.status === 'finalizado' ? teste.rodada_atual - 1 : teste.rodada_atual}</strong><span className="mode-tag">{(racing ? teste.modo : mode) === 'oficial' ? 'OFICIAL · ESP32' : 'TREINO · FORA DO RANKING'}</span><p>{racing ? 'Cada pisada conta. Solte o sensor entre os passos.' : 'Prepare os dois jogadores. A largada é em 3 segundos.'}</p></div>
        {owner ? <><button className="start-button" disabled={busy || racing || !synced} onClick={() => void start()}>{busy ? 'Aguarde...' : !synced ? 'Sincronizando relógio...' : phase === 'countdown' ? 'Prepare-se...' : phase === 'running' ? 'ϟ Corrida em andamento' : phase === 'settling' ? 'Apurando resultado...' : '▶ Iniciar corrida'}</button>
          <button className="secondary mode-button" disabled={busy || racing} onClick={() => setMode(mode === 'oficial' ? 'treino' : 'oficial')}>{mode === 'oficial' ? '⌨ Treino no teclado' : 'ϟ Usar ESP32 · oficial'}</button></> : <p className="muted">Você está acompanhando esta arena.</p>}
      </section>
      {training ? <div className="training-controls" aria-label="Controles de treino">{([1, 2] as const).map(player => <div className={`training-player training-${player}`} key={player}><strong>PLAYER {player}</strong><button onClick={() => void step(player, 1.5)}>{player === 1 ? 'A' : 'K'} · Pisada leve</button><button onClick={() => void step(player, 3.3)}>{player === 1 ? 'S' : 'L'} · Pisada forte</button></div>)}<p className="small muted">Pressione as teclas ou toque nos botões. Solte e pressione novamente para cada pisada.</p></div> : null}
      {actionError ? <p role="alert" className="error">{actionError}</p> : null}
      {teste.status === 'finalizado' && result ? <WinnerForm key={result.id} rodada={result} isOwner={owner} /> : null}
      <div className="game-info-grid"><section className="neon-panel how-to"><h2>ⓘ Como jogar</h2><p>Pise, solte e repita.<br /><strong>Mais força e frequência,<br />mais distância.</strong></p><span>60 segundos. Dois jogadores. Uma vitória.</span><small>Manter o sensor pressionado não soma novas pisadas.</small></section><Leaderboard compact navigate={navigate} /></div>
      <div className="game-utilities">{owner ? <DeviceSetup id={id} /> : null}<details className="surface history-details"><summary>↺ Histórico de corridas <span>{rodadas.length}</span></summary><History rodadas={rodadas} error={historyError} isOwner={owner} /></details></div>
      {owner && racing ? cancelRound === null ? <button className="text-button cancel-race" onClick={() => setCancelRound(teste.rodada_atual)}>Interromper corrida</button> : <div className="confirmation"><p>Interromper a rodada {cancelRound}? O resultado parcial será salvo sem inscrição no ranking.</p><div className="button-row"><button disabled={busy} className="danger" onClick={() => void cancel()}>Confirmar interrupção</button><button disabled={busy} className="secondary" onClick={() => setCancelRound(null)}>Continuar corrida</button></div></div> : null}
      <footer className="game-footer"><span>VOLTAGE RUN <b>ϟ</b> SUA TENSÃO TE LEVA MAIS LONGE</span><span>ESP32 + SUPABASE · CONEP</span></footer>
    </div>
  </main>;
}
