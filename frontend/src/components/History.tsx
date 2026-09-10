import type { Rodada } from '../lib/database';
import { time, voltage } from '../lib/format';

export function History({ rodadas, error }: { rodadas: Rodada[]; error: string }) {
  return <section className="surface history">
    <h2>Histórico de rodadas</h2>
    <p className="muted small">{rodadas.length ? `${rodadas.length} rodada(s) finalizada(s) · últimas 100` : 'As rodadas finalizadas aparecem aqui.'}</p>
    {error ? <p role="alert" className="error">{error}</p> : null}
    {rodadas.length ? <div className="table-scroll"><table>
      <thead><tr><th>Rodada</th><th>Player 1</th><th>Player 2</th><th>Finalizada em</th></tr></thead>
      <tbody>{rodadas.map((r) => <tr key={r.id}>
        <td>{r.numero}</td><td>{voltage(r.infos_player_1.tensao)} V</td>
        <td>{voltage(r.infos_player_2.tensao)} V</td><td>{time(r.created_at, true)}</td>
      </tr>)}</tbody>
    </table></div> : <p className="empty-inline">Nenhuma rodada finalizada.</p>}
  </section>;
}
