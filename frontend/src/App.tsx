import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configError, supabase, errorMessage } from './lib/supabase';
import { isUuid } from './lib/format';
import { AuthForm } from './components/AuthForm';
import { TestList } from './components/TestList';
import { TestMonitor } from './components/TestMonitor';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [authError, setAuthError] = useState('');
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (!supabase) return;
    // onAuthStateChange fornece INITIAL_SESSION e atualizações futuras no mesmo fluxo.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next); setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  function navigate(next: string) {
    window.history.pushState(null, '', next); setPath(next); window.scrollTo(0, 0);
  }
  async function logout() {
    const { error } = await supabase!.auth.signOut();
    if (error) setAuthError(errorMessage(error));
  }
  const match = path.match(/^\/testes\/([^/]+)\/?$/);
  return <>
    <header className="site-header"><div className="header-inner">
      <a href="/" className="brand" onClick={(e) => { e.preventDefault(); navigate('/'); }} aria-label="CONEP início">CONEP <svg aria-hidden="true" viewBox="0 0 36 36"><path d="M2 19h10l4-14 6 27 5-13h7" /></svg></a>
      <span className="app-name">Monitor de tensão</span>
      {session ? <button className="text-button logout" onClick={() => void logout()}>Sair</button> : null}
    </div></header>
    {authError ? <p role="alert" className="error container">{authError}</p> : null}
    {configError ? <main className="container surface error-state"><h1>Conecte o seu Supabase</h1><p>{configError}</p><p>Consulte o README para a configuração inicial.</p></main>
      : loading ? <main className="container" role="status">Preparando seu painel...</main>
      : !session ? <AuthForm />
      : path === '/' ? <TestList key={session.user.id} navigate={navigate} />
      : match && isUuid(match[1]) ? <TestMonitor key={`${session.user.id}:${match[1]}`} id={match[1]} userId={session.user.id} navigate={navigate} />
      : <main className="container"><h1>Página não encontrada</h1><p>Abra um teste válido pela lista.</p><button onClick={() => navigate('/')}>Meus testes</button></main>}
  </>;
}
