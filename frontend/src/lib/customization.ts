export const characters = [
  { id: 'chicken', name: 'Galinha' },
  { id: 'bacon', name: 'Toucinho' },
  { id: 'avocoder', name: 'Abacodificador' },
  { id: 'wheeler', name: 'Rodinhas' },
  { id: 'palmer', name: 'Palmeiro' },
] as const;

export type CharacterId = typeof characters[number]['id'];
export type Appearance = { character: CharacterId; color: string };
export type GamePreferences = Appearance & { volume: number; musicVolume: number };
export const defaultPreferences: GamePreferences = { character: 'chicken', color: '#ffffff', volume: 60, musicVolume: 28 };
const storageKey = 'crossy:customization:v1';
const playerTwoStorageKey = 'crossy:player-two:v1';
export const defaultPlayerTwoAppearance: Appearance = { character: 'bacon', color: '#cfb0ff' };

export function loadPreferences(): GamePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<GamePreferences> | null;
    return {
      character: characters.some(character => character.id === saved?.character) ? saved!.character! : defaultPreferences.character,
      color: typeof saved?.color === 'string' && /^#[\da-f]{6}$/i.test(saved.color) ? saved.color : defaultPreferences.color,
      volume: typeof saved?.volume === 'number' && Number.isFinite(saved.volume) ? Math.max(0, Math.min(100, saved.volume)) : defaultPreferences.volume,
      musicVolume: typeof saved?.musicVolume === 'number' && Number.isFinite(saved.musicVolume) ? Math.max(0, Math.min(100, saved.musicVolume)) : defaultPreferences.musicVolume,
    };
  } catch { return { ...defaultPreferences }; }
}

export function savePreferences(preferences: GamePreferences) {
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Storage may be disabled. */ }
}

export function loadPlayerTwoAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(playerTwoStorageKey) ?? 'null') as Partial<Appearance> | null;
    return {
      character: characters.some(character => character.id === saved?.character) ? saved!.character! : defaultPlayerTwoAppearance.character,
      color: typeof saved?.color === 'string' && /^#[\da-f]{6}$/i.test(saved.color) ? saved.color : defaultPlayerTwoAppearance.color,
    };
  } catch { return { ...defaultPlayerTwoAppearance }; }
}

export function savePlayerTwoAppearance(appearance: Appearance) {
  try { localStorage.setItem(playerTwoStorageKey, JSON.stringify(appearance)); } catch { /* Storage may be disabled. */ }
}
