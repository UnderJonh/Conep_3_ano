import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { client, errorMessage } from '../lib/supabase';
import type { Teste } from '../lib/database';
import { statusLabel, time } from '../lib/format';

export function TestList({ navigate }: { navigate: (path: string) => void }) {
  const [testes, setTestes] = useState<Teste[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void client().from('testes').select('*').order('created_at', { ascending: false }).limit(100)
      .then(({ data, error: err }) => {
        if (!active) return;
        setLoading(false);
        if (err) setError(errorMessage(err));
        else setTestes(data ?? []);
      });
    return () => { active = false; };
  }, [attempt]);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { data, error: err } = await client().from('testes').insert({ nome: name.trim() }).select().single();
      if (err) throw err;
      navigate(`/testes/${data.id}`);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <main className="container">
    <div className="page-title"><div><span className="eyebrow">SUAS CORRIDAS</span><h1>Escolha sua arena.</h1><p className="muted">Pise mais forte. Encontre seu ritmo. Vá mais longe.</p></div></div>
    <form className="surface create-form" onSubmit={(e) => void create(e)}>
      <label>Nome da arena<input required maxLength={120} placeholder="Ex.: Arena CONEP" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button disabled={busy || !name.trim()}>{busy ? 'Criando...' : 'Criar arena'}</button>
    </form>
    {error ? <div className="error" role="alert">{error} <button className="text-button" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button></div> : null}
    {loading ? <p role="status">Carregando arenas...</p> : testes.length ?
      <section className="surface test-list" aria-label="Testes disponíveis">{testes.map((t) =>
        <a href={`/testes/${t.id}`} key={t.id} onClick={(e) => { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); navigate(`/testes/${t.id}`); } }}>
          <div><h2>{t.nome}</h2><span className="small muted">Criado em {time(t.created_at, true)}</span></div>
          <span>Rodada {t.rodada_atual}</span><span className={`status ${t.status}`}>{statusLabel[t.status]}</span><span aria-hidden="true">→</span>
        </a>)}</section> : !error ? <section className="empty-state"><h2>Sua primeira corrida começa aqui.</h2><p className="muted">Crie uma arena e prepare os dois jogadores.</p></section> : null}
    <p className="small muted">São exibidas as últimas 100 arenas criadas neste navegador.</p>
  </main>;
}
