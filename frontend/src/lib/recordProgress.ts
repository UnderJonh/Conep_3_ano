export type RecordMusicStage = 'normal' | 'near' | 'victory';

export function recordProgress(score: number, record: number): { stage: RecordMusicStage; crowned: boolean } {
  const target = Math.max(0, Math.floor(record));
  if (target === 0) return { stage: 'normal', crowned: false };
  if (score > target) return { stage: 'victory', crowned: true };
  if (target > 0 && score >= Math.ceil(target / 2)) return { stage: 'near', crowned: false };
  return { stage: 'normal', crowned: false };
}
