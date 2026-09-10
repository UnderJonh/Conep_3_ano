import { createClient } from '@supabase/supabase-js';
import type { Database } from './database';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

function validConfig() {
  if (!url || !key || /SUBSTITUA|SEU_PROJETO/.test(`${url} ${key}`)) return false;
  if (key.startsWith('sb_secret_')) return false;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (key.startsWith('sb_publishable_')) return true;
    // Compatibilidade com anon JWT; recusa service_role acidental.
    return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon';
  } catch { return false; }
}

export const configError = validConfig() ? null : 'Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo .env.local da raiz e reinicie o servidor.';
export const supabase = configError ? null : createClient<Database>(url!, key!);
export const apiUrl = url ? `${url.replace(/\/$/, '')}/functions/v1/receber-tensao` : '';

export function client() {
  if (!supabase) throw new Error(configError ?? 'Supabase indisponível.');
  return supabase;
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
    if (/Invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
    if (/Email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.';
    if (/Failed to fetch|fetch failed/i.test(message)) return 'Sem conexão com o Supabase. Verifique sua internet.';
    if (/schema cache|does not exist/i.test(message)) return 'Estrutura do banco indisponível. Aplique as migrations do projeto.';
    return message;
  }
  return 'Não foi possível concluir a operação.';
}
