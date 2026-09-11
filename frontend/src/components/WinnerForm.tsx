import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { ArenaRanking, Rodada } from '../lib/database';
import { client, errorMessage } from '../lib/supabase';

export function WinnerForm({ rodada, isOwner, autoOpen = false, onSaved }: { rodada: Rodada; isOwner: boolean; autoOpen?: boolean; onSaved?: () => void }) {
  const [name, setName] = useState('');
  const [entry, setEntry] = useState<ArenaRanking | null>(null);
  const [world, setWorld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const { vencedor, motivo, modo, elegivel_ranking } = rodada.resultado;
  const eligible = !!vencedor && motivo === 'tempo' && (rodada.resultado.elegivel_arena || elegivel_ranking);
  const info = vencedor === 1 ? rodada.infos_player_1 : rodada.infos_player_2;
  const title = motivo === 'interrompida' ? 'Corrida interrompida' : vencedor ? `PLAYER ${vencedor} VENCEU!` : 'EMPATE! MAIS UMA CORRIDA?';
  useEffect(() => {
    let active = true;
    void client().from('ranking_arena').select('*').eq('rodada_id', rodada.id).maybeSingle().then(({ data, error: err }) => {
      if (!active) return;
      if (data) setEntry(data);
      if (err) setError(errorMessage(err));
      setLoaded(true);
      if (autoOpen && isOwner && eligible && !data) {
        let dismissed = false;
        try { dismissed = sessionStorage.getItem(`voltage-result:${rodada.id}`) === 'closed'; } catch { /* armazenamento opcional */ }
        if (!dismissed) setOpen(true);
      }
    });
    return () => { active = false; };
  }, [rodada.id, autoOpen, isOwner, eligible]);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) { element.showModal(); element.querySelector<HTMLInputElement>('input:not([type=checkbox])')?.focus(); }
    if (!open && element?.open) element.close();
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = old; };
  }, [open]);
  function dismiss() {
    setOpen(false);
    try { sessionStorage.setItem(`voltage-result:${rodada.id}`, 'closed'); } catch { /* armazenamento opcional */ }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const { data, error: err } = await client().rpc('registrar_vencedor_arena', {
      p_rodada_id: rodada.id, p_nome: name.trim(), p_publicar_mundial: !!elegivel_ranking && world,
    });
    setBusy(false);
    if (err) setError(errorMessage(err));
    else { setEntry(data); onSaved?.(); }
  }
  const resultStats = <p>{vencedor ? `${(info.distancia ?? 0).toLocaleString('pt-BR')} metros · ${info.pontos ?? 0} pontos` : motivo === 'interrompida' ? 'Um resultado parcial não entra no ranking.' : 'Prontos para a revanche?'}</p>;
  return <section className={`winner-panel ${vencedor ? `winner-${vencedor}` : ''}`} aria-label="Resultado da corrida">
    <span className="winner-symbol" aria-hidden="true">{motivo === 'interrompida' ? 'Ⅱ' : vencedor ? '★' : '='}</span>
    <div><p className="result-kicker">RODADA {rodada.numero} · {modo === 'treino' ? 'TREINO' : 'OFICIAL'} · {rodada.resultado.duracao_segundos ?? 60} s</p>
      {open ? <p>Uma nova vitória na arena.</p> : <h2>{title}</h2>}{resultStats}
      {entry && !open ? <p className="success">{entry.nome} está no ranking da arena!</p> : null}
    </div>
    {eligible && isOwner ? <button className="secondary result-open" disabled={!loaded} onClick={() => setOpen(true)}>{entry ? 'Ver vitória' : 'Registrar meu nome'}</button> : null}
    {eligible && isOwner ? <dialog ref={dialog} className={`victory-dialog victory-${vencedor}`} aria-labelledby={`victory-title-${rodada.id}`} onCancel={e => { e.preventDefault(); if (!busy) dismiss(); }}>
      <div className="victory-confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ '--i': i, '--x': `${(i * 37) % 100}%`, '--drift': `${i % 2 ? 75 : -75}px` } as CSSProperties} />)}</div>
      <button className="text-button dialog-close" aria-label="Fechar resultado" disabled={busy} onClick={dismiss}>×</button>
      <div className="victory-medal" aria-hidden="true">🏆</div><span className="eyebrow">NOVO CAMPEÃO · RODADA {rodada.numero}</span>
      <h2 id={`victory-title-${rodada.id}`}>{title}</h2>{resultStats}
      <div className="victory-stats"><span><b>{info.pisadas ?? 0}</b>PISADAS</span><span><b>{rodada.resultado.duracao_segundos ?? 60}s</b>DURAÇÃO</span><span><b>{modo === 'treino' ? 'TECLADO' : 'ESP32'}</b>{modo === 'treino' ? 'TREINO' : 'OFICIAL'}</span></div>
      {entry ? <div className="victory-saved"><p className="success" role="status">{entry.nome}, sua vitória está no ranking da arena!</p>{world ? <p>Também publicada no ranking mundial.</p> : null}<button onClick={dismiss}>Voltar à arena</button></div> : <form onSubmit={event => void submit(event)}>
        <label>Nome do vencedor<input autoFocus required minLength={2} maxLength={24} placeholder="Como devemos chamar o campeão?" value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
        {elegivel_ranking ? <label className="checkbox-row"><input type="checkbox" checked={world} onChange={e => setWorld(e.target.checked)} disabled={busy} />Publicar também no ranking mundial</label> : <p className="small muted">Esta vitória entra na categoria {modo === 'treino' ? 'treino' : 'oficial'} de {rodada.resultado.duracao_segundos} s da arena.</p>}
        <button className="start-button" disabled={busy}>{busy ? 'Registrando...' : 'Salvar no ranking da arena'}</button>
        <p className="small muted">Nome público · uma inscrição por vitória.</p>
        <button type="button" className="text-button" disabled={busy} onClick={dismiss}>Agora não</button>
      </form>}
      {error ? <p role="alert" className="error">{error}</p> : null}
    </dialog> : null}
  </section>;
}
