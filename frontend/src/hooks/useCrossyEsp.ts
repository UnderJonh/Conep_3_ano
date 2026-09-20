import { useCallback, useEffect, useRef, useState } from 'react';
import { client, configError, errorMessage } from '../lib/supabase';
import type { Teste } from '../lib/database';
import { ensureSession } from '../lib/session';

let preparing: Promise<Teste> | undefined;
async function prepareBoard() {
  const db = client();
  const userId = await ensureSession();
  const existing = await db.from('testes').select('*').eq('owner_id', userId).order('created_at').limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await db.from('testes').insert({ nome: 'Crossy Road · CONEP' }).select('*').single();
  if (created.error) throw created.error;
  const configured = await db.rpc('configurar_crossy', { p_teste_id: created.data.id, p_limiar: 1.5 });
  if (configured.error) throw configured.error;
  return configured.data;
}

export function useCrossyEsp(forwardOne: () => void, forwardTwo: () => void = () => {}) {
  const [teste, setTeste] = useState<Teste | null>(null);
  const [error, setError] = useState(configError ?? '');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const receive = useRef<[() => void, () => void]>([forwardOne, forwardTwo]);
  receive.current = [forwardOne, forwardTwo];
  const enabled = useRef((() => { try { return localStorage.getItem('crossy:esp-enabled:v1') === 'true'; } catch { return false; } })());
  const enable = useCallback(() => {
    enabled.current = true;
    try { localStorage.setItem('crossy:esp-enabled:v1', 'true'); } catch { /* The connection still works without storage. */ }
    setAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled.current || configError) return;
    let alive = true;
    let cleanup = () => {};
    setConnecting(true);
    setError('');
    preparing ??= prepareBoard().catch(err => { preparing = undefined; throw err; });
    void preparing.then(board => {
      if (!alive) return;
      const db = client();
      let revision = -1;
      let commands: [number | null, number | null] = [null, null];
      function accept(next: Teste, baseline = false) {
        if (!alive || next.revisao < revision) return;
        const infos = [next.infos_player_1, next.infos_player_2];
        infos.forEach((info, index) => {
          const count = Number(info?.comandos ?? 0);
          const previous = commands[index];
          commands[index] = count;
          const at = Date.parse(String(info?.comando_em ?? ''));
          if (!baseline && previous !== null && count > previous && Date.now() - at < 5000 && document.visibilityState === 'visible') {
            for (let command = 0; command < Math.min(10, count - previous); command++) receive.current[index]();
          }
        });
        revision = next.revisao;
        setTeste(next);
      }
      accept(board, true);
      async function snapshot() {
        commands = [null, null];
        const result = await db.from('testes').select('*').eq('id', board.id).single();
        if (!alive) return false;
        if (result.error) { setError(errorMessage(result.error)); return false; }
        accept(result.data, true);
        setError('');
        return true;
      }
      const channel = db.channel(`crossy:${board.id}`).on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'testes', filter: `id=eq.${board.id}`,
      }, payload => accept(payload.new as Teste)).subscribe(status => {
        if (!alive) return;
        setConnected(false);
        if (status === 'SUBSCRIBED') void snapshot().then(isReady => { if (alive) setConnected(isReady); });
        else {
          commands = [null, null];
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setError('Conexão interrompida. Tentando reconectar ao ESP.');
        }
      });
      const resume = () => { if (document.visibilityState === 'visible') void snapshot(); };
      document.addEventListener('visibilitychange', resume);
      window.addEventListener('online', resume);
      cleanup = () => {
        void db.removeChannel(channel);
        document.removeEventListener('visibilitychange', resume);
        window.removeEventListener('online', resume);
      };
      setConnecting(false);
    }).catch(err => { if (alive) { setError(errorMessage(err)); setConnecting(false); } });
    return () => { alive = false; cleanup(); setConnected(false); };
  }, [attempt]);
  return { teste, error, connecting, connected, enable };
}
