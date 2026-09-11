import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Ranking, Rodada } from '../lib/database';
import { client, errorMessage } from '../lib/supabase';

export function WinnerForm({ rodada, isOwner }: { rodada: Rodada; isOwner: boolean }) {
  const [name, setName] = useState('');
  const [entry, setEntry] = useState<Ranking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void client().from('ranking_mundial').select('*').eq('rodada_id', rodada.id).maybeSingle().then(({ data }) => { if (active && data) setEntry(data); });
    return () => { active = false; };
  }, [rodada.id]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const { data, error: err } = await client().rpc('registrar_vencedor', { p_rodada_id: rodada.id, p_nome: name.trim() });
    setBusy(false);
    if (err) setError(errorMessage(err));
    else setEntry(data);
  }
  const { vencedor, motivo, modo, elegivel_ranking } = rodada.resultado;
  const info = vencedor === 1 ? rodada.infos_player_1 : rodada.infos_player_2;
  return <section className={`winner-panel ${vencedor ? `winner-${vencedor}` : ''}`} aria-label="Resultado da corrida">
    <span className="winner-symbol" aria-hidden="true">{motivo === 'interrompida' ? 'Ⅱ' : vencedor ? '★' : '='}</span>
    <div><p className="result-kicker">RODADA {rodada.numero} · {modo === 'treino' ? 'TREINO' : 'OFICIAL'}</p>
      <h2>{motivo === 'interrompida' ? 'Corrida interrompida' : vencedor ? `PLAYER ${vencedor} VENCEU!` : 'EMPATE! MAIS UMA CORRIDA?'}</h2>
      <p>{vencedor ? `${(info.distancia ?? 0).toLocaleString('pt-BR')} metros · ${info.pontos ?? 0} pontos` : motivo === 'interrompida' ? 'Um resultado parcial não entra no ranking.' : 'Ninguém se inscreve no ranking nesta rodada.'}</p>
      {modo === 'treino' ? <p className="muted small">Treinos não entram no ranking mundial.</p> : null}
    </div>
    {elegivel_ranking && isOwner ? <div className="winner-entry">{entry ? <p className="success" role="status">{entry.nome}, sua vitória está no ranking mundial!</p> : <form onSubmit={event => void submit(event)}>
      <label>Nome do vencedor<input required minLength={2} maxLength={24} placeholder="Seu nome na história" value={name} onChange={event => setName(event.target.value)} /></label>
      <button disabled={busy}>{busy ? 'Registrando...' : 'Entrar no ranking'}</button>
      <p className="small muted">O nome será público. Uma inscrição por vitória.</p>
    </form>}{error ? <p role="alert" className="error">{error}</p> : null}</div> : null}
  </section>;
}
