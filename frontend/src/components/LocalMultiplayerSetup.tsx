import { useEffect, useRef, useState } from 'react';
import type { CharacterPreview } from '../crossy/game';
import { characters } from '../lib/customization';
import type { Appearance } from '../lib/customization';

const colors = [
  { value: '#ffffff', name: 'Original' },
  { value: '#ffd66b', name: 'Amarelo' },
  { value: '#ff9c9c', name: 'Rosa' },
  { value: '#94cfff', name: 'Azul' },
  { value: '#b6ed91', name: 'Verde' },
  { value: '#cfb0ff', name: 'Lilás' },
];

function PlayerSelector({ player, control, appearance, onChange }: {
  player: 1 | 2;
  control: string;
  appearance: Appearance;
  onChange(value: Appearance): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<CharacterPreview | null>(null);
  const latest = useRef(appearance);
  latest.current = appearance;
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void import('../crossy/game').then(module => alive ? module.createCharacterPreview(canvas.current!, latest.current) : null).then(controller => {
      if (!controller) return;
      if (!alive) { controller.dispose(); return; }
      preview.current = controller;
      controller.setAppearance(latest.current);
    }).catch(() => { if (alive) setError('Prévia indisponível'); });
    return () => { alive = false; preview.current?.dispose(); preview.current = null; };
  }, []);
  useEffect(() => { preview.current?.setAppearance(appearance); }, [appearance.character, appearance.color]);

  return <section className="local-player-setup" aria-labelledby={`local-player-${player}`}>
    <h2 id={`local-player-${player}`}>Jogador {player}</h2>
    <figure className="local-character-preview">
      <canvas ref={canvas} aria-label={`Prévia 3D do personagem do jogador ${player}`} />
      <figcaption>{error || characters.find(character => character.id === appearance.character)?.name}</figcaption>
    </figure>
    <fieldset className="local-options"><legend>Personagem</legend><div className="local-character-options">
      {characters.map(character => <button key={character.id} aria-pressed={appearance.character === character.id} onClick={() => onChange({ ...appearance, character: character.id })}>{character.name}</button>)}
    </div></fieldset>
    <fieldset className="local-options"><legend>Cor</legend><div className="color-options">
      {colors.map(color => <button key={color.value} className="color-swatch" style={{ backgroundColor: color.value }} aria-label={`${color.name} · jogador ${player}`} title={color.name} aria-pressed={appearance.color === color.value} onClick={() => onChange({ ...appearance, color: color.value })}>{appearance.color === color.value ? '✓' : ''}</button>)}
    </div></fieldset>
    <p className="local-control"><span>Controle</span><kbd>{control}</kbd></p>
  </section>;
}

export function LocalMultiplayerSetup({ appearances, onChange, onStart, onSinglePlayer }: {
  appearances: [Appearance, Appearance];
  onChange(player: 1 | 2, value: Appearance): void;
  onStart(): void;
  onSinglePlayer(): void;
}) {
  return <div className="local-setup">
    <div className="game-mode-switch" aria-label="Modo de jogo">
      <button className="secondary-button" onClick={onSinglePlayer}>1 jogador</button>
      <button aria-pressed="true">Multiplayer local</button>
    </div>
    <div className="local-player-grid">
      <PlayerSelector player={1} control="ESPAÇO" appearance={appearances[0]} onChange={value => onChange(1, value)} />
      <PlayerSelector player={2} control="ENTER" appearance={appearances[1]} onChange={value => onChange(2, value)} />
    </div>
    <button className="start-local-game" onClick={onStart}>Jogar</button>
  </div>;
}
