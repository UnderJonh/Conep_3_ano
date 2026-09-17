import { useCallback, useEffect, useRef, useState } from 'react';
import type { RankingEntry } from '../lib/database';
import { loadRanking, rankingLimit, sortRanking, storeRanking } from '../lib/ranking';
import { ensureSession } from '../lib/session';
import { errorMessage, supabase } from '../lib/supabase';

export function useCrossyRanking() {
  const [entries, setEntries] = useState(loadRanking);
  const [loading, setLoading] = useState(!!supabase);
  const [error, setError] = useState('');
  const [storageAvailable, setStorageAvailable] = useState(true);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const request = useRef(0);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const version = ++request.current;
    setLoading(true);
    try {
      const result = await supabase.from('crossy_ranking').select('id,nome,pontos,created_at')
        .order('pontos', { ascending: false }).order('created_at').limit(rankingLimit).abortSignal(AbortSignal.timeout(10000));
      if (result.error) throw result.error;
      if (version !== request.current) return;
      setEntries(result.data); storeRanking(result.data); setError('');
    } catch (err) { if (version === request.current) setError(errorMessage(err)); }
    finally { if (version === request.current) setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const update = () => { void refresh(); };
    window.addEventListener('focus', update); window.addEventListener('online', update);
    return () => { request.current++; window.removeEventListener('focus', update); window.removeEventListener('online', update); };
  }, [refresh]);

  const save = async (entry: RankingEntry) => {
    let saved = entry;
    if (supabase) {
      await ensureSession();
      const result = await supabase.rpc('registrar_recorde_crossy', { p_id: entry.id, p_nome: entry.nome, p_pontos: entry.pontos })
        .abortSignal(AbortSignal.timeout(10000));
      if (result.error) throw result.error;
      saved = result.data;
    }
    request.current++; setLoading(false);
    const next = sortRanking([...entriesRef.current.filter(item => item.id !== saved.id), saved]);
    entriesRef.current = next; setEntries(next); setError('');
    setStorageAvailable(storeRanking(next));
    if (supabase) void refresh();
  };

  return { entries, highScore: entries[0]?.pontos ?? 0, loading, error, storageAvailable, shared: !!supabase, refresh, save };
}
