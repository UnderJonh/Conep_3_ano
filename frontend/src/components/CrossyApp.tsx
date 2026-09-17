import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameController } from '../crossy/game';
import { useCrossyEsp } from '../hooks/useCrossyEsp';
import { credits } from '../lib/credits';
import { loadPreferences, savePreferences } from '../lib/customization';
import { setGameVolume, setMusicVolume, unlockAudio } from '../crossy/audio';
import { CrossyEspSetup } from './CrossyEspSetup';
import { CharacterCustomization } from './CharacterCustomization';
import { PlayerRanking } from './PlayerRanking';
import { useCrossyRanking } from '../hooks/useCrossyRanking';
import { playerNameLimit } from '../lib/ranking';
import { errorMessage } from '../lib/supabase';
import title from '../../../Expo-Crossy-Road-master/assets/images/title.png';

export default function CrossyApp() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameController | null>(null);
  const modalRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [state, setState] = useState<'home' | 'playing' | 'over'>('home');
  const [modal, setModal] = useState<'esp' | 'credits' | 'customization' | 'ranking' | 'record' | null>(null);
  const ranking = useCrossyRanking();
  const highScoreRef = useRef(ranking.highScore);
  highScoreRef.current = ranking.highScore;
  const [record, setRecord] = useState<{ id: string; score: number } | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [preferences, setPreferences] = useState(loadPreferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  modalRef.current = modal;
  const forward = useCallback(() => { if (!modalRef.current) game.current?.forward(); }, []);
  const esp = useCrossyEsp(forward);
  useEffect(() => {
    let alive = true;
    let controller: GameController | undefined;
    void import('../crossy/game').then(module => alive ? module.createGame(canvas.current!, {
      onScore: value => { if (alive) { scoreRef.current = value; setScore(value); } },
      onState: value => {
        if (!alive) return;
        setState(value);
        if (value === 'over' && scoreRef.current > highScoreRef.current) {
          setRecord({ id: crypto.randomUUID(), score: scoreRef.current });
          setPlayerName(''); setSaveError('');
          modalRef.current = 'record'; setModal('record');
        }
      },
    }, preferencesRef.current) : null).then(next => {
      if (!next) return;
      controller = next;
      if (!alive) { next.dispose(); return; }
      game.current = next; next.setAppearance(preferencesRef.current); next.pause(!!modalRef.current || document.hidden); setReady(true);
    }).catch(err => { if (alive) setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar o jogo.'); });
    const resize = () => controller?.resize();
    const visibility = () => controller?.pause(!!modalRef.current || document.hidden);
    const key = (event: KeyboardEvent) => {
      if (event.repeat || modalRef.current || !['Space', 'ArrowUp'].includes(event.code)) return;
      if (event.target instanceof HTMLElement && event.target.closest('button,input,select,textarea,a,[contenteditable="true"]') && !event.target.closest('.game-touch')) return;
      event.preventDefault(); forward();
    };
    window.addEventListener('resize', resize); window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', unlockAudio, { capture: true });
    window.addEventListener('keydown', unlockAudio, { capture: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive = false; controller?.dispose(); game.current = null;
      window.removeEventListener('resize', resize); window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', unlockAudio, { capture: true });
      window.removeEventListener('keydown', unlockAudio, { capture: true });
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [forward]);
  useEffect(() => { savePreferences(preferences); }, [preferences]);
  useEffect(() => { setGameVolume(preferences.volume / 100); }, [preferences.volume]);
  useEffect(() => { setMusicVolume(preferences.musicVolume / 100); }, [preferences.musicVolume]);
  useEffect(() => { game.current?.setAppearance(preferencesRef.current); }, [preferences.character, preferences.color]);
  useEffect(() => { game.current?.pause(!!modal || document.hidden); }, [modal]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLDialogElement>('dialog');
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>(modal === 'record' ? '#player-name' : 'button')?.focus();
    return () => { dialog?.close(); previous?.focus(); };
  }, [modal]);

  function closeModal() { if (!savingRef.current) setModal(null); }
  async function saveRecord(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || savingRef.current) return;
    const name = playerName.trim();
    if (!name || /[\x00-\x1f\x7f]/.test(name)) { setSaveError('Informe um nome válido.'); return; }
    savingRef.current = true; setSaving(true); setSaveError('');
    try {
      await ranking.save({ id: record.id, nome: name, pontos: record.score, created_at: new Date().toISOString() });
      setModal('ranking');
    } catch (err) { setSaveError(errorMessage(err)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <main className="crossy-app">
    <canvas ref={canvas} className="game-canvas" aria-label="Cenário 3D do Crossy Road" />
    {ready && state !== 'over' ? <button className="game-touch" aria-label="Mover galinha para frente" onClick={forward} /> : null}
    {ready && state === 'home' ? <div className="home-overlay"><img src={title} alt="Crossy Road" /><p>Pise forte para iniciar</p></div> : null}
    {ready && state !== 'home' ? <output className="crossy-score" aria-label="Pontuação">{score}</output> : null}
    {ready ? <div className="crossy-best" aria-label="Recorde">Recorde <strong>{ranking.highScore}</strong></div> : null}
    {!ready ? <div className="loading-game" role={loadError ? 'alert' : 'status'}>{loadError || 'Carregando o jogo…'}{loadError ? <button onClick={() => window.location.reload()}>Tentar novamente</button> : null}</div> : null}
    {state === 'over' ? <div className="game-over"><h1>Fim de jogo</h1><p>{score} {score === 1 ? 'passo' : 'passos'}</p><button onClick={() => game.current?.restart()}>Jogar novamente</button></div> : null}
    <div className="game-toolbar">
      <button className="settings-icon" aria-label="Ranking de jogadores" title="Ranking de jogadores" onClick={() => { setModal('ranking'); void ranking.refresh(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 3h8v5a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 12v6m-4 3v-3h8v3M6 21h12"/></svg>
      </button>
      <button className="settings-icon" aria-label="Personalizar personagem" title="Personalizar personagem" disabled={!ready} onClick={() => setModal('customization')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.2a2.4 2.4 0 0 0 1.7-4.1 1.4 1.4 0 0 1 1-2.4H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".75"/><circle cx="10" cy="6.5" r=".75"/><circle cx="14.5" cy="6.5" r=".75"/><circle cx="17" cy="10" r=".75"/></svg>
      </button>
      <button className="settings-icon" aria-label="Configurar ESP32" title="Configurar ESP32" onClick={() => { if (!esp.connecting && (!esp.teste || esp.error)) esp.enable(); setModal('esp'); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 3-.6 2.1-1.8 1L4.5 5.6l-3 5.2 1.5 1.5v2L1.5 16l3 5.2 2.1-.5 1.8 1L9 24h6l.6-2.3 1.8-1 2.1.5 3-5.2-1.5-1.7v-2l1.5-1.5-3-5.2-2.1.5-1.8-1L15 3Z" transform="translate(0 -1.5) scale(1 .9)"/><circle cx="12" cy="11" r="3"/></svg>
      </button>
      <button className="credits-button" onClick={() => setModal('credits')}>Créditos</button>
    </div>
    <dialog className="crossy-dialog" data-modal={modal} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); closeModal(); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeModal(); } }}>
      <div className="dialog-heading"><h1 id="dialog-title">{modal === 'esp' ? 'Configurar ESP32' : modal === 'customization' ? 'Personalizar personagem' : modal === 'ranking' ? 'Ranking de jogadores' : modal === 'record' ? 'Novo recorde!' : credits.title}</h1><button className="close-dialog" aria-label="Fechar" disabled={saving} onClick={closeModal}>×</button></div>
      <div className="dialog-content">
      <div hidden={modal !== 'esp'}><CrossyEspSetup {...esp} /></div>
      {modal === 'customization' ? <CharacterCustomization preferences={preferences} onChange={setPreferences} /> : null}
      {modal === 'ranking' ? <PlayerRanking {...ranking} onRetry={() => { void ranking.refresh(); }} /> : null}
      {modal === 'record' && record ? <form className="record-form" onSubmit={saveRecord}>
        <p className="record-score">{record.score} <span>{record.score === 1 ? 'passo' : 'passos'}</span></p>
        <p>Você superou o recorde! Coloque seu nome no ranking.</p>
        <label htmlFor="player-name">Nome do jogador<input id="player-name" value={playerName} onChange={event => setPlayerName(event.target.value)} maxLength={playerNameLimit} placeholder="Seu nome" autoComplete="nickname" required disabled={saving} aria-describedby="player-name-help" /></label>
        <p id="player-name-help" className="small">Até {playerNameLimit} caracteres. {ranking.shared ? 'Seu nome e pontuação aparecerão no ranking público.' : 'Seu recorde fica salvo neste navegador.'}</p>
        {saveError ? <p role="alert" className="setup-error">{saveError}</p> : null}
        <div className="record-actions"><button type="submit" disabled={saving || !playerName.trim()}>{saving ? 'Salvando…' : 'Salvar no ranking'}</button><button type="button" className="secondary-button" disabled={saving} onClick={closeModal}>Agora não</button></div>
      </form> : null}
      <div hidden={modal !== 'credits'} className="credits-content">
        <h2>{credits.project}</h2><p>{credits.description}</p>
        <ol className="credits-team">{credits.team.map(member => <li key={member.name}><strong>{member.name}</strong><p>{member.role}</p></li>)}</ol>
        <p className="original-credit">{credits.original} <a href="/crossy-license.txt" target="_blank" rel="noreferrer">Ver licença</a></p>
      </div>
      </div>
    </dialog>
  </main>;
}
