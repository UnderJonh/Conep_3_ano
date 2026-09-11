import type { Rodada } from '../lib/database';
import { useState } from 'react';
import { WinnerForm } from './WinnerForm';
import { time, voltage } from '../lib/format';

export function History({ rodadas, error, isOwner = false }: { rodadas: Rodada[]; error: string; isOwner?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const victory = rodadas.find(r => r.id === selected);
  return <section className="surface history">
    <h2>Histórico de corridas</h2>
    <p className="muted small">{rodadas.length ? `${rodadas.length} rodada(s) finalizada(s) · últimas 100` : 'As rodadas finalizadas aparecem aqui.'}</p>
    {error ? <p role="alert" className="error">{error}</p> : null}
    {rodadas.length ? <div className="table-scroll"><table>
      <thead><tr><th>Rodada</th><th>Player 1</th><th>Player 2</th><th>Resultado</th><th>Finalizada em</th>{isOwner ? <th>Ranking</th> : null}</tr></thead>
      <tbody>{rodadas.map((r) => <tr key={r.id}>
        <td>{r.numero}</td><td>{r.resultado.modo ? `${r.infos_player_1.distancia ?? 0} m` : `${voltage(r.infos_player_1.tensao)} V`}</td>
        <td>{r.resultado.modo ? `${r.infos_player_2.distancia ?? 0} m` : `${voltage(r.infos_player_2.tensao)} V`}</td><td>{r.resultado.motivo === 'interrompida' ? 'Interrompida' : r.resultado.modo ? r.resultado.vencedor ? `Player ${r.resultado.vencedor}` : 'Empate' : 'Monitoramento'}{r.resultado.modo === 'treino' ? ' · Treino' : ''}</td><td>{time(r.created_at, true)}</td>{isOwner ? <td>{(r.resultado.elegivel_arena || r.resultado.elegivel_ranking) ? <button className="text-button" onClick={() => setSelected(selected === r.id ? null : r.id)}>Abrir vitória</button> : '—'}</td> : null}
      </tr>)}</tbody>
    </table></div> : <p className="empty-inline">Nenhuma rodada finalizada.</p>}
    {victory ? <WinnerForm key={victory.id} rodada={victory} isOwner={isOwner} autoOpen /> : null}
  </section>;
}
