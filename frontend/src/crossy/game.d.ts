import type { Appearance } from '../lib/customization';
export type CharacterPreview = { setAppearance(value: Appearance): void; setCrowned(value: boolean): void; dispose(): void };
export type GameController = CharacterPreview & { forward(): void; restart(): void; pause(value: boolean): void; resize(): void };
export type LocalMultiplayerController = Omit<GameController, 'forward' | 'setAppearance' | 'setCrowned'> & {
  forward(player: 1 | 2): void;
  setAppearance(value: Appearance, player: 1 | 2): void;
};
export function createGame(canvas: HTMLCanvasElement, callbacks: { onScore(score: number): void; onState(state: 'home' | 'playing' | 'over'): void }, appearance?: Appearance): Promise<GameController>;
export function createLocalMultiplayerGame(canvas: HTMLCanvasElement, callbacks: {
  onScore(player: 1 | 2, score: number): void;
  onState(player: 1 | 2, state: 'home' | 'playing' | 'over'): void;
}, appearances: [Appearance, Appearance]): Promise<LocalMultiplayerController>;
export function createCharacterPreview(canvas: HTMLCanvasElement, appearance: Appearance): Promise<CharacterPreview>;
