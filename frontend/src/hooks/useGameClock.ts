import { useEffect, useState } from 'react';
import { client } from '../lib/supabase';

export function useGameClock() {
  const [clock, setClock] = useState({ now: Date.now(), synced: false });
  useEffect(() => {
    let alive = true;
    let anchor = Date.now();
    let monotonic = performance.now();
    let synced = false;
    async function sync() {
      const before = performance.now();
      const { data, error } = await client().rpc('hora_servidor');
      if (!alive) return;
      if (data && !error) {
        anchor = Date.parse(data) + (performance.now() - before) / 2;
        monotonic = performance.now(); synced = true;
      }
    }
    void sync();
    // Somente animação do relógio local; nenhuma consulta periódica ao servidor.
    const timer = window.setInterval(() => setClock({ now: anchor + performance.now() - monotonic, synced }), 100);
    window.addEventListener('online', sync);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('online', sync); };
  }, []);
  return clock;
}
