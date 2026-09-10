import { useState } from 'react';
import { useTeste } from '../hooks/useTeste';
import { client, errorMessage } from '../lib/supabase';
import { statusLabel } from '../lib/format';
import { PlayerPanel } from './PlayerPanel';
import { History } from './History';
import { DeviceSetup } from './DeviceSetup';

export function TestMonitor({ id, userId, navigate }: { id: string; userId: string; navigate: (path: string) => void }) {
  const { teste, rodadas, loading, error, historyError, connection, retry } = useTeste(id);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmFinish, setConfirmFinish] = useState<number | null>(null);
  async function action(kind: 'status' | 'finish') {
    if (!teste) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      const { error: err } = kind === 'finish'
        ? await client().rpc('finalizar_rodada', { p_teste_id: id, p_rodada_esperada: confirmFinish ?? teste.rodada_atual })
        : await client().rpc('alterar_status', { p_teste_id: id, p_status: teste.status === 'rodando' ? 'pausado' : 'rodando' });
      if (err) throw err;
      setNotice(kind === 'finish' ? `Rodada ${teste.rodada_atual} salva no histórico.` : 'Status atualizado.');
      setConfirmFinish(null);
      // O estado visual é recebido pela subscription; retry recupera caso esteja offline.
      if (connection !== 'Conectado ao tempo real') retry();
    } catch (err) { setActionError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <main className="container">
    <a className="back-link" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>← Meus testes</a>
    {loading ? <p role="status">Carregando teste...</p> : error || !teste ? <section className="surface error-state"><h1>Não foi possível abrir o teste</h1><p role="alert">{error}</p><button onClick={retry}>Tentar novamente</button></section> : <>
      <div className="page-title"><div><h1>{teste.nome}</h1><p className="muted">Acompanhe as leituras dos dois jogadores em tempo real.</p></div>
        <span role="status" className={`connection ${connection === 'Conectado ao tempo real' ? 'connected' : ''}`}><i />{connection}</span>
      </div>
      <section className="surface round-toolbar" aria-label="Controle da rodada">
        <strong className="round-number">RODADA {teste.rodada_atual}</strong><span className={`status ${teste.status}`}>{statusLabel[teste.status]}</span>
        {teste.owner_id === userId ? <div className="round-actions">
          <button className="secondary" disabled={busy} onClick={() => void action('status')}>{teste.status === 'rodando' ? 'Ⅱ  Pausar' : teste.status === 'pausado' ? 'Retomar teste' : 'Iniciar teste'}</button>
          <button disabled={busy || teste.status !== 'rodando'} onClick={() => setConfirmFinish(teste.rodada_atual)}>Finalizar rodada</button>
        </div> : <span className="viewer-label muted small">Acesso de visualização</span>}
      </section>
      {confirmFinish !== null ? <div className="surface confirmation" role="region" aria-label="Confirmar finalização">
        <p>Salvar as leituras da rodada {confirmFinish} e iniciar a rodada {confirmFinish + 1}?</p>
        <div className="button-row"><button disabled={busy} onClick={() => void action('finish')}>{busy ? 'Salvando...' : 'Salvar e avançar'}</button><button className="secondary" disabled={busy} onClick={() => setConfirmFinish(null)}>Cancelar</button></div>
      </div> : null}
      {actionError ? <p role="alert" className="error">{actionError}</p> : null}
      {notice ? <p role="status" className="success small">{notice}</p> : null}
      <div className="players"><PlayerPanel player={1} info={teste.infos_player_1} /><PlayerPanel player={2} info={teste.infos_player_2} /></div>
      <History rodadas={rodadas} error={historyError} />
      {teste.owner_id === userId ? <DeviceSetup id={id} /> : null}
      <p className="footnote">As leituras são atualizadas automaticamente. {teste.status !== 'rodando' ? 'Inicie ou retome o teste para receber leituras.' : ''}</p>
    </>}
  </main>;
}
