import type { RankingEntry } from './database';

export const rankingStorageKey = 'crossy:ranking:v1';
export const playerNameLimit = 24;
export const rankingLimit = 20;

export function sortRanking(entries: RankingEntry[]) {
  return [...entries].sort((a, b) => b.pontos - a.pontos || a.created_at.localeCompare(b.created_at)).slice(0, rankingLimit);
}

export function loadRanking(): RankingEntry[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(rankingStorageKey) ?? '[]');
    if (!Array.isArray(saved)) return [];
    return sortRanking(saved.filter((entry): entry is RankingEntry => entry && typeof entry === 'object' &&
      typeof entry.id === 'string' && typeof entry.nome === 'string' && entry.nome.trim().length > 0 &&
      entry.nome.length <= playerNameLimit && Number.isSafeInteger(entry.pontos) && entry.pontos > 0 &&
      typeof entry.created_at === 'string' && Number.isFinite(Date.parse(entry.created_at))));
  } catch { return []; }
}

export function storeRanking(entries: RankingEntry[]): boolean {
  try { localStorage.setItem(rankingStorageKey, JSON.stringify(sortRanking(entries))); return true; }
  catch { return false; }
}
