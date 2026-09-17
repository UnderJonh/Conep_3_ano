export type GameController = { forward(): void; restart(): void; pause(value: boolean): void; resize(): void; dispose(): void };
export function createGame(canvas: HTMLCanvasElement, callbacks: { onScore(score: number): void; onState(state: 'home' | 'playing' | 'over'): void }): Promise<GameController>;
