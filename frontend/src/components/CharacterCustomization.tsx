import { useEffect, useRef, useState } from 'react';
import type { CharacterPreview } from '../crossy/game';
import { playAudioSample, playMusicSample } from '../crossy/audio';
import { characters, defaultPreferences } from '../lib/customization';
import type { GamePreferences } from '../lib/customization';
import { characterStepSounds } from '../lib/characterAudio';

const colors = [
  { value: '#ffffff', name: 'Original' },
  { value: '#ffd66b', name: 'Amarelo' },
  { value: '#ff9c9c', name: 'Rosa' },
  { value: '#94cfff', name: 'Azul' },
  { value: '#b6ed91', name: 'Verde' },
  { value: '#cfb0ff', name: 'Lilás' },
];

export function CharacterCustomization({ preferences, onChange }: { preferences: GamePreferences; onChange(value: GamePreferences): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<CharacterPreview | null>(null);
  const latest = useRef(preferences);
  latest.current = preferences;
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void import('../crossy/game').then(module => alive ? module.createCharacterPreview(canvas.current!, latest.current) : null).then(controller => {
      if (!controller) return;
      if (!alive) { controller.dispose(); return; }
      preview.current = controller; controller.setAppearance(latest.current);
    }).catch(() => { if (alive) setError('Não foi possível carregar a prévia.'); });
    return () => { alive = false; preview.current?.dispose(); preview.current = null; };
  }, []);
  useEffect(() => { preview.current?.setAppearance(preferences); }, [preferences.character, preferences.color]);

  return <div className="character-customization">
    <figure className="character-preview"><canvas ref={canvas} aria-label="Prévia 3D do personagem" /><figcaption>{error || characters.find(character => character.id === preferences.character)?.name}</figcaption></figure>
    <fieldset className="customization-options"><legend>Personagem</legend><div className="character-options">{characters.map(character => <button key={character.id} aria-pressed={preferences.character === character.id} onClick={() => onChange({ ...preferences, character: character.id })}>{character.name}</button>)}</div></fieldset>
    <fieldset className="customization-options"><legend>Cor do personagem</legend><div className="color-options">{colors.map(color => <button key={color.value} className="color-swatch" style={{ backgroundColor: color.value }} aria-label={color.name} title={color.name} aria-pressed={preferences.color === color.value} onClick={() => onChange({ ...preferences, color: color.value })}>{preferences.color === color.value ? '✓' : ''}</button>)}</div></fieldset>
    <div className="game-sound-settings">
      <div className="sound-channel"><label htmlFor="game-volume">Sons do jogo <output>{preferences.volume ? `${preferences.volume}%` : 'Desativados'}</output></label><input id="game-volume" type="range" min="0" max="100" step="1" value={preferences.volume} onChange={event => onChange({ ...preferences, volume: Number(event.target.value) })} /><button className="secondary-button" disabled={!preferences.volume} onClick={() => { void playAudioSample(characterStepSounds[preferences.character]); }}>Testar som</button></div>
      <div className="sound-channel"><label htmlFor="music-volume">Música de fundo <output>{preferences.musicVolume ? `${preferences.musicVolume}%` : 'Desativada'}</output></label><input id="music-volume" type="range" min="0" max="100" step="1" value={preferences.musicVolume} onChange={event => onChange({ ...preferences, musicVolume: Number(event.target.value) })} /><button className="secondary-button" disabled={!preferences.musicVolume} onClick={() => { void playMusicSample(); }}>Ouvir música</button></div>
    </div>
    <p className="small">As alterações são aplicadas na hora e ficam salvas neste navegador.</p>
    <button className="secondary-button" onClick={() => onChange({ ...defaultPreferences })}>Restaurar padrão</button>
  </div>;
}
