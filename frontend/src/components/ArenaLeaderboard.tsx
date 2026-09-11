import { useEffect, useState } from 'react';
import type { ArenaRanking } from '../lib/database';
import { client, errorMessage } from '../lib/supabase';

export function ArenaLeaderboard({ id, refresh }: { id: string; refresh: number }) {
  const [entries, setEntries] = useState<ArenaRanking[]>([]);
  const [mode, setMode] = useState<'oficial' | 'treino'>('oficial');
  const [duration, setDuration] = useState(60);
  const [durations, setDurations] = useState([15, 30, 60, 90, 120, 180, 300, 600]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true; let request = 0;
    const db = client();
    async function fetchRanking() {
      const version = ++request;
      const { data, error: err } = await db.from('ranking_arena').select('*').eq('teste_id', id)
        .eq('modo', mode).eq('duracao_segundos', duration)
        .order('distancia', { ascending: false }).order('created_at').order('id').limit(100);
      if (!alive || version !== request) return;
      setLoading(false); setError(err ? errorMessage(err) : ''); if (data) setEntries(data);
    }
    async function fetchCategories() {
      const { data } = await db.from('ranking_arena').select('duracao_segundos').eq('teste_id', id);
      if (alive && data) setDurations(Array.from(new Set([15,30,60,90,120,180,300,600,...data.map(r => r.duracao_segundos)])).sort((a,b) => a-b));
    }
    setLoading(true); setEntries([]);
    void fetchRanking(); void fetchCategories();
    const channel = db.channel(`arena-ranking:${id}:${mode}:${duration}`).on('postgres_changes',
      { event: '*', schema: 'public', table: 'ranking_arena', filter: `teste_id=eq.${id}` },
      () => { void fetchRanking(); void fetchCategories(); }).subscribe(status => { if (status === 'SUBSCRIBED') void fetchRanking(); });
    return () => { alive = false; void db.removeChannel(channel); };
  }, [id, mode, duration, refresh, attempt]);
  return <section className="neon-panel leaderboard arena-leaderboard">
    <div className="section-heading"><div><span className="eyebrow">HALL DA FAMA</span><h2>🏆 Ranking da arena</h2></div><span className="mode-tag">TOP 100</span></div>
    <div className="ranking-filters"><label>Categoria<select value={mode} onChange={e => setMode(e.target.value as 'oficial' | 'treino')}><option value="oficial">Oficial · ESP32</option><option value="treino">Treino · teclado</option></select></label><label>Duração no ranking<select value={duration} onChange={e => setDuration(Number(e.target.value))}>{durations.map(n => <option key={n} value={n}>{n} segundos</option>)}</select></label></div>
    {loading ? <p role="status">Carregando vitórias...</p> : error ? <p role="alert" className="error">{error} <button onClick={() => setAttempt(n => n+1)}>Tentar novamente</button></p> : entries.length ? <div className="table-scroll"><table><thead><tr><th>#</th><th>Vencedor</th><th>Distância</th><th>Pontos</th></tr></thead><tbody>{entries.map((r, i) => <tr key={r.id}><td className={i<3 ? 'podium' : ''}>{String(i+1).padStart(2,'0')}</td><td>{r.nome}</td><td>{r.distancia.toLocaleString('pt-BR')} m</td><td>{r.pontos}</td></tr>)}</tbody></table></div> : <div className="ranking-empty"><span>Seu nome pode ser o primeiro.</span><p>Vitórias de {duration} segundos no modo {mode === 'treino' ? 'treino' : 'oficial'} aparecem aqui.</p></div>}
    <p className="small muted">Cada duração e modo têm seu próprio pódio. Nomes e resultados são públicos.</p>
  </section>;
}
