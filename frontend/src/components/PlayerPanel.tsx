import type { PlayerInfo } from '../lib/database';
import { time, voltage } from '../lib/format';

export function PlayerPanel({ player, info }: { player: 1 | 2; info: PlayerInfo }) {
  const points = typeof info.pontos === 'number' ? info.pontos : null;
  return <section className={`player-panel player-${player}`} aria-label={`Player ${player}`}>
    <h2>PLAYER {player}</h2>
    <p className="muted">Tensão atual</p>
    <p className="voltage" aria-label={`Tensão Player ${player}`}>{voltage(info.tensao)} <span>V</span></p>
    <p className="points">{points ?? '--'} pontos</p>
    <div className="last-reading"><span>Última leitura</span><strong>{time(info.atualizado_em)}</strong></div>
  </section>;
}
