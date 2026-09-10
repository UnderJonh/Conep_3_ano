import { useState } from 'react';
import type { FormEvent } from 'react';
import { client, errorMessage } from '../lib/supabase';

export function AuthForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const { error: err } = await client().auth.signInWithPassword({ email: email.trim(), password });
      if (err) throw err;
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout"><section className="surface auth-form">
    <h1>Acompanhe seu teste</h1>
    <p className="muted">Entre para visualizar as leituras dos jogadores e gerenciar suas rodadas.</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" /></label>
      <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Sua senha" /></label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button disabled={busy}>{busy ? 'Entrando...' : 'Entrar'}</button>
    </form>
    <p className="small muted">Primeiro acesso? Solicite sua conta ao responsável pelo projeto.</p>
  </section></main>;
}
