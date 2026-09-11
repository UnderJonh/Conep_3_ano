import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configError, supabase, errorMessage } from './lib/supabase';
import { isUuid } from './lib/format';
import { TestList } from './components/TestList';
import { TestMonitor } from './components/TestMonitor';
import { Leaderboard } from './components/Leaderboard';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [authError, setAuthError] = useState('');
  const [authAttempt, setAuthAttempt] = useState(0);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (next) { setSession(next); setLoading(false); setAuthError(''); }
    });
    let active = true;
    async function enterArena() {
      setLoading(true); setAuthError('');
      const current = await supabase!.auth.getSession();
      if (!active) return;
      if (current.error) { setAuthError(errorMessage(current.error)); setLoading(false); return; }
      if (current.data.session) { setSession(current.data.session); setLoading(false); return; }
      const anonymous = await supabase!.auth.signInAnonymously();
      if (!active) return;
      if (anonymous.error || !anonymous.data.session) {
        setAuthError(errorMessage(anonymous.error)); setLoading(false); return;
      }
      setSession(anonymous.data.session); setLoading(false);
    }
    void enterArena();
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [authAttempt]);
  function navigate(next: string) {
    window.history.pushState(null, '', next); setPath(next); window.scrollTo(0, 0);
  }
  const match = path.match(/^\/testes\/([^/]+)\/?$/);
  return <>
    <header className="site-header"><div className="header-inner">
      <a href="/" className="brand" onClick={(e) => { e.preventDefault(); navigate('/'); }} aria-label="Voltage Run início"><span>VOLTAGE</span><em>RUN</em><b>ϟ</b></a>
      <span className="app-name">ARENA CONEP</span>
      <nav className="header-nav" aria-label="Principal"><a href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>Corridas</a><a href="/ranking" onClick={e => { e.preventDefault(); navigate('/ranking'); }}>Ranking mundial</a></nav>
    </div></header>
    {configError ? <main className="container surface error-state"><h1>Conecte o seu Supabase</h1><p>{configError}</p><p>Consulte o README para a configuração inicial.</p></main>
      : path === '/ranking' ? <main className="container ranking-page"><div className="page-title"><div><span className="eyebrow">VOLTAGE RUN · CLASSIFICAÇÃO GLOBAL</span><h1>Os nomes que foram mais longe.</h1><p className="muted">Cada recorde começa com uma pisada. Este pode ser o seu lugar.</p></div></div><Leaderboard navigate={navigate} /></main>
      : loading ? <main className="container" role="status">Preparando sua arena...</main>
      : authError || !session ? <main className="container surface error-state"><h1>Não foi possível preparar a arena</h1><p role="alert">{authError}</p><button onClick={() => setAuthAttempt(value => value + 1)}>Tentar novamente</button></main>
      : path === '/' ? <TestList key={session.user.id} navigate={navigate} />
      : match && isUuid(match[1]) ? <TestMonitor key={`${session.user.id}:${match[1]}`} id={match[1]} userId={session.user.id} navigate={navigate} />
      : <main className="container"><h1>Página não encontrada</h1><p>Abra um teste válido pela lista.</p><button onClick={() => navigate('/')}>Meus testes</button></main>}
  </>;
}
