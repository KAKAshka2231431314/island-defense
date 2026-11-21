import { mulberry32 } from './rng';

/** Отобранные карты кампании: 15 лёгких, 20 средних, 15 сложных. */
export const ISLAND_POOLS = {
  easy: [212, 189, 239, 205, 85, 119, 44, 75, 118, 202, 140, 108, 126, 156, 169],
  medium: [41, 46, 72, 122, 124, 125, 132, 136, 160, 168, 218, 222, 226, 230, 246, 254, 271, 274, 299, 300],
  hard: [50, 236, 114, 240, 61, 298, 196, 284, 242, 21, 89, 57, 26, 278, 198],
} as const;

export type IslandPool = keyof typeof ISLAND_POOLS;

/** Перемешанные сиды пула для одной кампании; карты не повторяются, пока пул не закончится. */
export function shuffledIslandPool(seed: number, pool: IslandPool): number[] {
  const rng = mulberry32(seed ^ (pool === 'easy' ? 0x51f15e : pool === 'medium' ? 0x6d1e55 : 0x9a4d2b));
  const out = [...ISLAND_POOLS[pool]];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
