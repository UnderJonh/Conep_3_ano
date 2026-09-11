import { createClient } from '@supabase/supabase-js';
import { criarHandler } from './handler.ts';
import type { Registro } from './handler.ts';

// Estas variáveis existem somente no ambiente da Edge Function.
const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) throw new Error('Configuração do servidor ausente.');

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(criarHandler(async (leitura, tokenHash) => {
  const base = { p_teste_id: leitura.teste_id, p_player: leitura.player, p_token_hash: tokenHash };
  const { data, error } = leitura.amostras
    ? await supabase.rpc('registrar_amostras', { ...base, p_amostras: leitura.amostras })
    : await supabase.rpc('registrar_tensao', { ...base, p_tensao: leitura.tensao });
  return { data: data as Registro | null, error };
}));
