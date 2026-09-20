export function unlockAudio(): void;
export function setGameVolume(value: number): void;
export function setMusicVolume(value: number): void;
export function setMusicStage(value: 'normal' | 'near' | 'victory'): void;
export function playAudioSample(resource: string): Promise<void>;
export function playMusicSample(): Promise<void>;
