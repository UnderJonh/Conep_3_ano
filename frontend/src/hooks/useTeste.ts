import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Rodada, Teste } from '../lib/database';
import { client, errorMessage } from '../lib/supabase';

export function useTeste(id: string) {
  const [teste, setTeste] = useState<Teste | null>(null);
  const [rodadas, setRodadas] = useState<Rodada[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [connection, setConnection] = useState('Conectando...');
  const [attempt, setAttempt] = useState(0);
  const acceptServerState = useRef<((value: Teste) => void) | null>(null);

  useEffect(() => {
    const db = client();
    let alive = true;
    let channel: RealtimeChannel | undefined;
    let lastRound = 0;
    let historyRequest = 0;
    let stateRequest = 0;
    setLoading(true);
    setError('');
    setTeste(null);
    setRodadas([]);
    setConnection('Conectando...');

    async function history() {
      const request = ++historyRequest;
      const { data, error: err } = await db.from('rodadas').select('*')
        .eq('teste_id', id).order('numero', { ascending: false }).limit(100);
      if (!alive || request !== historyRequest) return;
      setHistoryError(err ? errorMessage(err) : '');
      if (data) setRodadas(data);
    }
    function accept(incoming: Teste) {
      if (!alive) return;
      // Uma resposta HTTP atrasada nunca substitui um UPDATE mais recente.
      setTeste((current) => !current || incoming.revisao >= current.revisao ? incoming : current);
      if (incoming.rodada_atual > lastRound) {
        lastRound = incoming.rodada_atual;
        void history();
      }
    }
    acceptServerState.current = accept;
    async function snapshot() {
      const request = ++stateRequest;
      const { data, error: err } = await db.from('testes').select('*').eq('id', id).maybeSingle();
      if (!alive || request !== stateRequest) return false;
      setLoading(false);
      if (err || !data) {
        setError(err ? errorMessage(err) : 'Teste não encontrado ou sem permissão de acesso.');
        setTeste(null);
        setRodadas([]);
        setConnection('Sem conexão');
        return false;
      }
      setError('');
      accept(data);
      return true;
    }
    async function connect() {
      // Primeiro estado inicial; depois subscription, conforme o fluxo solicitado.
      if (!await snapshot() || !alive) return;
      channel = db.channel(`teste:${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'testes', filter: `id=eq.${id}` },
          (payload) => accept(payload.new as Teste))
        .subscribe((status) => {
          if (!alive) return;
          setConnection(status === 'SUBSCRIBED' ? 'Conectado ao tempo real' : 'Reconectando...');
          if (status === 'SUBSCRIBED') {
            // Fecha a janela entre SELECT e subscription; recupera eventos na reconexão.
            // Isto é recuperação por evento, não polling.
            void snapshot();
            void history();
          }
        });
    }
    const resync = () => {
      if (document.visibilityState === 'visible') { void snapshot(); void history(); }
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('online', resync);
    void connect();
    return () => {
      alive = false;
      acceptServerState.current = null;
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('online', resync);
      if (channel) void db.removeChannel(channel);
    };
  }, [id, attempt]);

  return { teste, rodadas, loading, error, historyError, connection, retry: () => setAttempt((n) => n + 1),
    applyServerState: (value: Teste) => acceptServerState.current?.(value) };
}
