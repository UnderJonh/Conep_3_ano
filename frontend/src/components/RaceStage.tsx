import type { CSSProperties } from 'react';
import type { PlayerInfo, Teste } from '../lib/database';
import { time, voltage } from '../lib/format';

export type RacePhase = 'ready' | 'countdown' | 'running' | 'settling' | 'finished';
export function getPhase(teste: Teste, now: number): RacePhase {
  if (teste.status === 'finalizado') return 'finished';
  if (teste.status !== 'rodando' || !teste.corrida_inicio || !teste.corrida_fim) return 'ready';
  if (now < Date.parse(teste.corrida_inicio)) return 'countdown';
  return now < Date.parse(teste.corrida_fim) ? 'running' : 'settling';
}
const number = (n: number | undefined) => (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function PlayerHud({ player, info, moving }: { player: 1 | 2; info: PlayerInfo; moving: boolean }) {
  return <section className={`player-hud hud-${player}`} aria-label={`Player ${player}`}>
    <h2>PLAYER {player}</h2>
    <div className="hud-reading"><span aria-hidden="true">ϟ</span><strong aria-label={`Tensão Player ${player}`}>{voltage(info.tensao)} V</strong></div>
    <dl><div><dt>Pontos</dt><dd aria-label={`Pontos Player ${player}`}>{info.pontos ?? 0}</dd></div>
      <div><dt>Distância</dt><dd aria-label={`Distância Player ${player}`}>{number(info.distancia)} <small>m</small></dd></div>
      <div><dt>Pisadas</dt><dd aria-label={`Pisadas Player ${player}`}>{info.pisadas ?? 0}</dd></div>
      <div><dt>Ritmo</dt><dd>{number(moving ? info.ritmo : 0)}<small>/s</small></dd></div></dl>
    <div className="voltage-meter" aria-label={`Força Player ${player}`} role="meter" aria-valuemin={0} aria-valuemax={3.3} aria-valuenow={Math.min(3.3, info.tensao ?? 0)}>
      <span style={{ width: `${Math.min(100, (info.tensao ?? 0) / 3.3 * 100)}%` }} />
    </div>
    <p className="hud-last">Pico: {voltage(info.pico_tensao)} V <span>{time(info.atualizado_em)}</span></p>
  </section>;
}

export function RaceStage({ teste, now, synced, connection }: { teste: Teste; now: number; synced: boolean; connection: string }) {
  const phase = getPhase(teste, now);
  const infos = [teste.infos_player_1, teste.infos_player_2];
  const active = infos.map(info => phase === 'running' && !!info.ultima_pisada_em && now - Date.parse(info.ultima_pisada_em) < 1200);
  const remaining = teste.corrida_fim ? Math.max(0, Math.ceil((Date.parse(teste.corrida_fim) - now) / 1000)) : 60;
  const distanceMax = Math.max(100, ...infos.map(info => info.distancia ?? 0));
  const countdown = teste.corrida_inicio ? Math.max(1, Math.ceil((Date.parse(teste.corrida_inicio) - now) / 1000)) : 3;
  const timer = !synced && teste.status === 'rodando' ? '--:--' : phase === 'running'
    ? `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}` : phase === 'ready' ? '01:00' : '00:00';
  return <section className={`race-stage phase-${phase} ${active.some(Boolean) ? 'track-moving' : ''}`} aria-label="Pista Voltage Run">
    <div className="race-title"><span>{teste.nome}</span><span className={`connection ${connection === 'Conectado ao tempo real' ? 'connected' : ''}`}><i />{connection}</span></div>
    <PlayerHud player={1} info={infos[0]} moving={active[0]} />
    <div className="race-clock"><strong>{phase === 'countdown' ? countdown : timer}</strong><span>{phase === 'countdown' ? 'PREPARE-SE' : phase === 'finished' ? 'CORRIDA ENCERRADA' : phase === 'settling' ? 'APURANDO RESULTADO' : 'TEMPO RESTANTE'}</span></div>
    <PlayerHud player={2} info={infos[1]} moving={active[1]} />
    <div className="road-light" aria-hidden="true" />
    {infos.map((info, index) => {
      const lead = Math.max(-75, Math.min(90, ((info.distancia ?? 0) - (infos[1 - index].distancia ?? 0)) * 1.3));
      return <div key={index} className={`runner runner-${index + 1} ${active[index] ? 'running' : ''}`} aria-hidden="true"
        style={{ '--lead': `${-lead}px`, '--speed': `${Math.max(.25, .75 - (info.ritmo ?? 0) * .1)}s` } as CSSProperties}>
        <div className="runner-label">P{index + 1}</div><div className="runner-sprite" />
      </div>;
    })}
    {phase === 'ready' ? <div className="stage-message"><strong>SUA TENSÃO TE LEVA MAIS LONGE</strong><span>Escolha o modo e prepare-se para correr.</span></div> : null}
    <div className="distance-track">{infos.map((info, index) => <div className={`distance-lane lane-${index + 1}`} key={index}>
      <strong>P{index + 1}</strong><div className="distance-bar"><span style={{ width: `${(info.distancia ?? 0) / distanceMax * 100}%` }} /></div><b>{number(info.distancia)} m</b>
    </div>)}</div>
  </section>;
}
