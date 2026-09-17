import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameController } from '../crossy/game';
import { useCrossyEsp } from '../hooks/useCrossyEsp';
import { credits } from '../lib/credits';
import { CrossyEspSetup } from './CrossyEspSetup';
import title from '../../../Expo-Crossy-Road-master/assets/images/title.png';

export default function CrossyApp() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameController | null>(null);
  const modalRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [score, setScore] = useState(0);
  const [state, setState] = useState<'home' | 'playing' | 'over'>('home');
  const [modal, setModal] = useState<'esp' | 'credits' | null>(null);
  modalRef.current = modal;
  const forward = useCallback(() => { if (!modalRef.current) game.current?.forward(); }, []);
  const esp = useCrossyEsp(forward);
  useEffect(() => {
    let alive = true;
    let controller: GameController | undefined;
    void import('../crossy/game').then(module => module.createGame(canvas.current!, {
      onScore: value => { if (alive) setScore(value); },
      onState: value => { if (alive) setState(value); },
    })).then(next => {
      controller = next;
      if (!alive) { next.dispose(); return; }
      game.current = next; next.pause(!!modalRef.current || document.hidden); setReady(true);
    }).catch(err => { if (alive) setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar o jogo.'); });
    const resize = () => controller?.resize();
    const visibility = () => controller?.pause(!!modalRef.current || document.hidden);
    const key = (event: KeyboardEvent) => {
      if (event.repeat || modalRef.current || !['Space', 'ArrowUp'].includes(event.code)) return;
      if (event.target instanceof HTMLElement && event.target.closest('button,input,select,textarea,a,[contenteditable="true"]') && !event.target.closest('.game-touch')) return;
      event.preventDefault(); forward();
    };
    window.addEventListener('resize', resize); window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive = false; controller?.dispose(); game.current = null;
      window.removeEventListener('resize', resize); window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [forward]);
  useEffect(() => { game.current?.pause(!!modal || document.hidden); }, [modal]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLDialogElement>('dialog');
    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { dialog?.close(); previous?.focus(); };
  }, [modal]);

  return <main className="crossy-app">
    <canvas ref={canvas} className="game-canvas" aria-label="Cenário 3D do Crossy Road" />
    {ready && state !== 'over' ? <button className="game-touch" aria-label="Mover galinha para frente" onClick={forward} /> : null}
    {ready && state === 'home' ? <div className="home-overlay"><img src={title} alt="Crossy Road" /><p>Pise forte para avançar</p><small>Ou toque na tela / pressione espaço</small></div> : null}
    {ready && state !== 'home' ? <output className="crossy-score" aria-label="Pontuação">{score}</output> : null}
    {!ready ? <div className="loading-game" role={loadError ? 'alert' : 'status'}>{loadError || 'Carregando o jogo…'}{loadError ? <button onClick={() => window.location.reload()}>Tentar novamente</button> : null}</div> : null}
    {state === 'over' ? <div className="game-over"><h1>Fim de jogo</h1><p>{score} {score === 1 ? 'passo' : 'passos'}</p><button onClick={() => game.current?.restart()}>Jogar novamente</button></div> : null}
    <div className="game-toolbar">
      <button className="settings-icon" aria-label="Configurar ESP32" title="Configurar ESP32" onClick={() => { if (!esp.connecting && (!esp.teste || esp.error)) esp.enable(); setModal('esp'); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 3-.6 2.1-1.8 1L4.5 5.6l-3 5.2 1.5 1.5v2L1.5 16l3 5.2 2.1-.5 1.8 1L9 24h6l.6-2.3 1.8-1 2.1.5 3-5.2-1.5-1.7v-2l1.5-1.5-3-5.2-2.1.5-1.8-1L15 3Z" transform="translate(0 -1.5) scale(1 .9)"/><circle cx="12" cy="11" r="3"/></svg>
      </button>
      <button className="credits-button" onClick={() => setModal('credits')}>Créditos</button>
    </div>
    <dialog className="crossy-dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); setModal(null); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setModal(null); } }}>
      <div className="dialog-heading"><h1 id="dialog-title">{modal === 'esp' ? 'Configurar ESP32' : credits.title}</h1><button className="close-dialog" aria-label="Fechar" onClick={() => setModal(null)}>×</button></div>
      <div hidden={modal !== 'esp'}><CrossyEspSetup {...esp} /></div>
      <div hidden={modal !== 'credits'} className="credits-content"><h2>{credits.project}</h2><p>{credits.description}</p><p>{credits.team}</p><p className="original-credit">{credits.original} <a href="/crossy-license.txt" target="_blank" rel="noreferrer">Ver licença</a></p></div>
    </dialog>
  </main>;
}
