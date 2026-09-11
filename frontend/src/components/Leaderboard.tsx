import { useEffect, useState } from 'react';
import type { Ranking } from '../lib/database';
import { client, errorMessage } from '../lib/supabase';

export function Leaderboard({ compact = false, navigate }: { compact?: boolean; navigate: (path: string) => void }) {
  const [entries, setEntries] = useState<Ranking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let version = 0;
    const db = client();
    async function fetchRanking() {
      const current = ++version;
      const { data, error: err } = await db.from('ranking_mundial').select('*')
        .order('distancia', { ascending: false }).order('created_at').order('id').limit(compact ? 3 : 100);
      if (!active || current !== version) return;
      setLoading(false); setError(err ? errorMessage(err) : '');
      if (data) setEntries(data);
    }
    void fetchRanking();
    const channel = db.channel(`ranking:${compact ? 'compact' : 'full'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ranking_mundial' }, () => void fetchRanking())
      .subscribe((status) => { if (status === 'SUBSCRIBED') void fetchRanking(); });
    return () => { active = false; void db.removeChannel(channel); };
  }, [compact, attempt]);
  return <section className={`neon-panel leaderboard ${compact ? 'compact' : ''}`}>
    <div className="section-heading"><h2>🏆 Ranking mundial</h2>{!compact ? <span className="mode-tag">Oficial · 60 segundos</span> : null}</div>
    {loading ? <p role="status" className="muted">Carregando os vencedores...</p> : null}
    {error ? <p className="error" role="alert">{error} <button onClick={() => setAttempt(n => n + 1)}>Tentar novamente</button></p> : null}
    {!loading && !error && !entries.length ? <div className="ranking-empty"><span>O primeiro lugar está esperando.</span><p>Vença uma corrida oficial e escreva seu nome aqui.</p></div> : null}
    {entries.length ? <div className="table-scroll"><table>
      <thead><tr><th>#</th><th>Corredor</th><th>Distância</th><th>Pontos</th>{!compact ? <th>Pisadas</th> : null}</tr></thead>
      <tbody>{entries.map((entry, index) => <tr key={entry.id}>
        <td className={index < 3 ? 'podium' : ''}>{String(index + 1).padStart(2, '0')}</td>
        <td>{entry.nome}</td><td>{entry.distancia.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} m</td>
        <td>{entry.pontos.toLocaleString('pt-BR')}</td>{!compact ? <td>{entry.pisadas}</td> : null}
      </tr>)}</tbody>
    </table></div> : null}
    {compact ? <a className="ranking-link" href="/ranking" onClick={(e) => { e.preventDefault(); navigate('/ranking'); }}>Ver ranking completo →</a>
      : <p className="small muted">As 100 maiores distâncias entre os vencedores. Apenas corridas completas com sensores. Empates de distância mantêm primeiro o registro mais antigo.</p>}
  </section>;
}
