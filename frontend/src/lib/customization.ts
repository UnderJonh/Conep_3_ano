export const characters = [
  { id: 'chicken', name: 'Galinha' },
  { id: 'bacon', name: 'Bacon' },
  { id: 'avocoder', name: 'Avocoder' },
  { id: 'brent', name: 'Brent' },
  { id: 'wheeler', name: 'Wheeler' },
  { id: 'palmer', name: 'Palmer' },
  { id: 'juwan', name: 'Juwan' },
] as const;

export type CharacterId = typeof characters[number]['id'];
export type Appearance = { character: CharacterId; color: string };
export type GamePreferences = Appearance & { volume: number };
export const defaultPreferences: GamePreferences = { character: 'chicken', color: '#ffffff', volume: 60 };
const storageKey = 'crossy:customization:v1';

export function loadPreferences(): GamePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<GamePreferences> | null;
    return {
      character: characters.some(character => character.id === saved?.character) ? saved!.character! : defaultPreferences.character,
      color: typeof saved?.color === 'string' && /^#[\da-f]{6}$/i.test(saved.color) ? saved.color : defaultPreferences.color,
      volume: typeof saved?.volume === 'number' && Number.isFinite(saved.volume) ? Math.max(0, Math.min(100, saved.volume)) : defaultPreferences.volume,
    };
  } catch { return { ...defaultPreferences }; }
}

export function savePreferences(preferences: GamePreferences) {
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Storage may be disabled. */ }
}
