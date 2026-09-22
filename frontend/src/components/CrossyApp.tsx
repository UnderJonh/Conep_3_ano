import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameController, LocalMultiplayerController } from '../crossy/game';
import { credits } from '../lib/credits';
import { loadPlayerTwoAppearance, loadPreferences, savePlayerTwoAppearance, savePreferences } from '../lib/customization';
import type { Appearance } from '../lib/customization';
import { setGameVolume, setMusicStage, setMusicVolume, unlockAudio } from '../crossy/audio';
import { EspControllerGuide } from './EspControllerGuide';
import { CharacterCustomization } from './CharacterCustomization';
import { LocalMultiplayerSetup } from './LocalMultiplayerSetup';
import { PlayerRanking } from './PlayerRanking';
import { useCrossyRanking } from '../hooks/useCrossyRanking';
import { useUsbController } from '../hooks/useUsbController';
import { playerNameLimit } from '../lib/ranking';
import { recordProgress } from '../lib/recordProgress';
import { errorMessage } from '../lib/supabase';
import title from '../../../Expo-Crossy-Road-master/assets/images/title.png';

type PlayState = 'home' | 'playing' | 'over';
type GameMode = 'single' | 'local';
type Modal = 'esp' | 'credits' | 'customization' | 'local' | 'ranking' | 'record' | null;

export default function CrossyApp() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameController | LocalMultiplayerController | null>(null);
  const modalRef = useRef<string | null>(null);
  const modeRef = useRef<GameMode>('single');
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [godMode, setGodMode] = useState(false);
  const godModeRef = useRef(false);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const runRecordRef = useRef(0);
  const [state, setState] = useState<PlayState>('home');
  const [mode, setMode] = useState<GameMode>('single');
  const [localScores, setLocalScores] = useState<[number, number]>([0, 0]);
  const [localStates, setLocalStates] = useState<[PlayState, PlayState]>(['home', 'home']);
  const [modal, setModal] = useState<Modal>(null);
  const ranking = useCrossyRanking();
  const highScoreRef = useRef(ranking.highScore);
  highScoreRef.current = ranking.highScore;
  const [record, setRecord] = useState<{ id: string; score: number } | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [preferences, setPreferences] = useState(loadPreferences);
  const [playerTwoAppearance, setPlayerTwoAppearance] = useState(loadPlayerTwoAppearance);
  const preferencesRef = useRef(preferences);
  const playerTwoAppearanceRef = useRef(playerTwoAppearance);
  preferencesRef.current = preferences;
  playerTwoAppearanceRef.current = playerTwoAppearance;
  modeRef.current = mode;
  modalRef.current = modal;

  const forwardPlayer = useCallback((player: 1 | 2) => {
    if (modalRef.current) return;
    const controller = game.current;
    if (!controller) return;
    if (modeRef.current === 'local') (controller as LocalMultiplayerController).forward(player);
    else if (player === 1) (controller as GameController).forward();
  }, []);
  const forward = useCallback(() => { forwardPlayer(1); }, [forwardPlayer]);
  const usb = useUsbController(forwardPlayer);

  useEffect(() => {
    let sequence = '';
    const activateGodMode = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;
      sequence = `${sequence}${event.key.toLowerCase()}`.slice(-3);
      if (sequence !== 'god') return;
      sequence = '';
      if (godModeRef.current) return;
      godModeRef.current = true;
      setGodMode(true);
      game.current?.setGodMode(true);
    };
    window.addEventListener('keydown', activateGodMode, { capture: true });
    return () => { window.removeEventListener('keydown', activateGodMode, { capture: true }); };
  }, []);

  useEffect(() => {
    let alive = true;
    let controller: GameController | LocalMultiplayerController | undefined;
    setReady(false);
    setLoadError('');
    setState('home');
    setScore(0);
    scoreRef.current = 0;
    runRecordRef.current = highScoreRef.current;
    setMusicStage('normal');
    setLocalScores([0, 0]);
    setLocalStates(['home', 'home']);

    void import('../crossy/game').then(module => {
      if (!alive) return null;
      if (mode === 'local') {
        return module.createLocalMultiplayerGame(canvas.current!, {
          onScore: (player, value) => {
            if (!alive) return;
            setLocalScores(scores => player === 1 ? [value, scores[1]] : [scores[0], value]);
          },
          onState: (player, value) => {
            if (!alive) return;
            setLocalStates(states => player === 1 ? [value, states[1]] : [states[0], value]);
          },
        }, [preferencesRef.current, playerTwoAppearanceRef.current]);
      }
      return module.createGame(canvas.current!, {
        onScore: value => {
          if (!alive) return;
          scoreRef.current = value;
          setScore(value);
          const progress = recordProgress(value, runRecordRef.current);
          setMusicStage(progress.stage);
          (game.current as GameController | null)?.setCrowned?.(progress.crowned);
        },
        onState: value => {
          if (!alive) return;
          setState(value);
          if (value === 'playing' && scoreRef.current === 0) {
            runRecordRef.current = highScoreRef.current;
            setMusicStage('normal');
            (game.current as GameController | null)?.setCrowned?.(false);
          }
          if (value === 'over' && scoreRef.current > highScoreRef.current) {
            setRecord({ id: crypto.randomUUID(), score: scoreRef.current });
            setPlayerName('');
            setSaveError('');
            modalRef.current = 'record';
            setModal('record');
          }
        },
      }, preferencesRef.current);
    }).then(next => {
      if (!next) return;
      controller = next;
      if (!alive) { next.dispose(); return; }
      game.current = next;
      next.setGodMode(godModeRef.current);
      next.pause(!!modalRef.current || document.hidden);
      setReady(true);
    }).catch(err => { if (alive) setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar o jogo.'); });

    const resize = () => controller?.resize();
    const visibility = () => controller?.pause(!!modalRef.current || document.hidden);
    const key = (event: KeyboardEvent) => {
      if (event.repeat || modalRef.current) return;
      if (event.target instanceof HTMLElement && event.target.closest('button,input,select,textarea,a,[contenteditable="true"]') && !event.target.closest('.game-touch')) return;
      if (modeRef.current === 'local') {
        if (!['Space', 'Enter', 'NumpadEnter'].includes(event.code)) return;
        event.preventDefault();
        forwardPlayer(event.code === 'Space' ? 1 : 2);
      } else {
        if (!['Space', 'ArrowUp'].includes(event.code)) return;
        event.preventDefault();
        forward();
      }
    };
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', unlockAudio, { capture: true });
    window.addEventListener('keydown', unlockAudio, { capture: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive = false;
      controller?.dispose();
      game.current = null;
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', unlockAudio, { capture: true });
      window.removeEventListener('keydown', unlockAudio, { capture: true });
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [forward, forwardPlayer, mode]);

  useEffect(() => { savePreferences(preferences); }, [preferences]);
  useEffect(() => { savePlayerTwoAppearance(playerTwoAppearance); }, [playerTwoAppearance]);
  useEffect(() => { setGameVolume(preferences.volume / 100); }, [preferences.volume]);
  useEffect(() => { setMusicVolume(preferences.musicVolume / 100); }, [preferences.musicVolume]);
  useEffect(() => {
    if (mode === 'local') (game.current as LocalMultiplayerController | null)?.setAppearance(preferencesRef.current, 1);
    else (game.current as GameController | null)?.setAppearance(preferencesRef.current);
  }, [mode, preferences.character, preferences.color]);
  useEffect(() => {
    if (mode === 'local') (game.current as LocalMultiplayerController | null)?.setAppearance(playerTwoAppearanceRef.current, 2);
  }, [mode, playerTwoAppearance.character, playerTwoAppearance.color]);
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
  function updateLocalAppearance(player: 1 | 2, value: Appearance) {
    if (player === 1) setPreferences(current => ({ ...current, ...value }));
    else setPlayerTwoAppearance(value);
  }
  function startLocalGame() {
    setModal(null);
    if (mode === 'local') game.current?.restart();
    else setMode('local');
  }
  function useSinglePlayer() {
    setModal(null);
    if (mode === 'single') game.current?.restart();
    else setMode('single');
  }
  async function saveRecord(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || savingRef.current) return;
    const name = playerName.trim();
    if (!name || /[\x00-\x1f\x7f]/.test(name)) { setSaveError('Informe um nome válido.'); return; }
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await ranking.save({ id: record.id, nome: name, pontos: record.score, created_at: new Date().toISOString() });
      setModal('ranking');
    } catch (err) { setSaveError(errorMessage(err)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  const localAppearances: [Appearance, Appearance] = [preferences, playerTwoAppearance];
  return <main className={`crossy-app mode-${mode}`} data-god-mode={godMode ? 'active' : 'inactive'}>
    <canvas ref={canvas} className="game-canvas" aria-label="Cenário 3D do Crossy Road" />
    {godMode ? <div className="god-mode-indicator" role="status" aria-live="polite">GOD MODE</div> : null}
    {ready && mode === 'single' && state !== 'over' ? <button className="game-touch" aria-label="Mover galinha para frente" onClick={forward} /> : null}
    {ready && mode === 'local' ? <div className="local-touch-controls"><button aria-label="Mover jogador 1 para frente" onClick={() => forwardPlayer(1)} /><button aria-label="Mover jogador 2 para frente" onClick={() => forwardPlayer(2)} /></div> : null}
    {ready && mode === 'single' && state === 'home' ? <div className="home-overlay"><img src={title} alt="Crossy Road" /><p>Pise forte para iniciar</p></div> : null}
    {ready && mode === 'single' && state !== 'home' ? <output className="crossy-score" aria-label="Pontuação">{score}</output> : null}
    {ready && mode === 'local' ? <div className="local-hud" aria-label="Placar multiplayer local">
      {([1, 2] as const).map(player => <section key={player} className={`local-hud-player player-${player}`}><span>Jogador {player}</span><output aria-label={`Pontuação do jogador ${player}`}>{localScores[player - 1]}</output><kbd>{player === 1 ? 'ESPAÇO' : 'ENTER'}</kbd>{localStates[player - 1] === 'home' ? <small>Pressione para iniciar</small> : null}</section>)}
    </div> : null}
    {ready && mode === 'single' ? <div className="crossy-best" aria-label="Recorde">Recorde <strong>{ranking.highScore}</strong></div> : null}
    {!ready ? <div className="loading-game" role={loadError ? 'alert' : 'status'}>{loadError || 'Carregando o jogo…'}{loadError ? <button onClick={() => window.location.reload()}>Tentar novamente</button> : null}</div> : null}
    {mode === 'single' && state === 'over' ? <div className="game-over"><h1>Fim de jogo</h1><p>{score} {score === 1 ? 'passo' : 'passos'}</p><button onClick={() => game.current?.restart()}>Jogar novamente</button></div> : null}
    {mode === 'local' ? <div className="local-game-state">
      {localStates.map((playerState, index) => playerState === 'over' ? <div key={index} className={`local-player-over player-${index + 1}`} aria-label={`Fim de jogo do jogador ${index + 1}`}><strong>Fim de jogo</strong><span>{localScores[index]} {localScores[index] === 1 ? 'passo' : 'passos'}</span>{index === 0 && localStates[1] === 'over' ? <small>Jogador 1: aperte para reiniciar</small> : null}</div> : null)}
    </div> : null}
    <div className="game-toolbar">
      <button className="settings-icon" aria-label="Ranking de jogadores" title="Ranking de jogadores" onClick={() => { setModal('ranking'); void ranking.refresh(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 3h8v5a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 12v6m-4 3v-3h8v3M6 21h12"/></svg>
      </button>
      <button className="settings-icon" aria-label="Personalizar personagem" title="Personalizar personagem" disabled={!ready} onClick={() => setModal('customization')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.2a2.4 2.4 0 0 0 1.7-4.1 1.4 1.4 0 0 1 1-2.4H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".75"/><circle cx="10" cy="6.5" r=".75"/><circle cx="14.5" cy="6.5" r=".75"/><circle cx="17" cy="10" r=".75"/></svg>
      </button>
      <button className="settings-icon mode-icon" aria-label="Configurar multiplayer local" title="Configurar multiplayer local" disabled={!ready} onClick={() => setModal('local')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 19c.5-3.8 2.3-5.7 5.5-5.7s5 1.9 5.5 5.7M13.5 14.5c1-.8 2.1-1.2 3.5-1.2 2.7 0 4.2 1.7 4.5 5.2"/></svg>
      </button>
      <button className="settings-icon" aria-label="O controle ESP32" title="O controle ESP32" onClick={() => setModal('esp')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 3-.6 2.1-1.8 1L4.5 5.6l-3 5.2 1.5 1.5v2L1.5 16l3 5.2 2.1-.5 1.8 1L9 24h6l.6-2.3 1.8-1 2.1.5 3-5.2-1.5-1.7v-2l1.5-1.5-3-5.2-2.1.5-1.8-1L15 3Z" transform="translate(0 -1.5) scale(1 .9)"/><circle cx="12" cy="11" r="3"/></svg>
      </button>
      <button className="credits-button" onClick={() => setModal('credits')}>Créditos</button>
    </div>
    <dialog className="crossy-dialog" data-modal={modal} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); closeModal(); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeModal(); } }}>
      <div className="dialog-heading"><h1 id="dialog-title">{modal === 'esp' ? 'O controle ESP32' : modal === 'customization' ? 'Personalizar personagem' : modal === 'local' ? 'Escolha o modo' : modal === 'ranking' ? 'Ranking de jogadores' : modal === 'record' ? 'Novo recorde!' : credits.title}</h1><button className="close-dialog" aria-label="Fechar" disabled={saving} onClick={closeModal}>×</button></div>
      <div className="dialog-content">
        {modal === 'esp' ? <EspControllerGuide multiplayer={mode === 'local'} {...usb} /> : null}
        {modal === 'customization' ? <CharacterCustomization preferences={preferences} onChange={setPreferences} /> : null}
        {modal === 'local' ? <LocalMultiplayerSetup appearances={localAppearances} onChange={updateLocalAppearance} onStart={startLocalGame} onSinglePlayer={useSinglePlayer} /> : null}
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
