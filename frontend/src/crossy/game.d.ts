import type { Appearance } from '../lib/customization';
export type CharacterPreview = { setAppearance(value: Appearance): void; dispose(): void };
export type GameController = CharacterPreview & { forward(): void; restart(): void; pause(value: boolean): void; resize(): void };
export function createGame(canvas: HTMLCanvasElement, callbacks: { onScore(score: number): void; onState(state: 'home' | 'playing' | 'over'): void }, appearance?: Appearance): Promise<GameController>;
export function createCharacterPreview(canvas: HTMLCanvasElement, appearance: Appearance): Promise<CharacterPreview>;
