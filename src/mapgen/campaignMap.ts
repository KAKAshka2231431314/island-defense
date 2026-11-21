import { CAMPAIGN } from '../data/balance';
import type { ItemId } from '../entities/Squad';
import { shuffledIslandPool } from './islandPools';
import { mulberry32, randInt, type Rng } from './rng';

export type RewardKind = 'none' | 'item' | 'recruit';
export type NodeState = 'open' | 'done' | 'stormed';

export interface IslandNode {
  id: number;
  col: number;
  row: number;
  /** позиция на карте, 0..1 */
  x: number;
  y: number;
  seed: number;
  difficulty: number;
  isFinal: boolean;
  reward: RewardKind;
  item: ItemId | null;
  /** ссылки на острова следующей колонки */
  links: number[];
  state: NodeState;
}

const ITEMS: ItemId[] = ['bomb', 'horn', 'shield'];

/** Граф островов: колонки слева направо, у каждого острова 1–2 связи вперёд; финал — отдельно справа. */
export function generateCampaignMap(seed: number): IslandNode[] {
  const rng: Rng = mulberry32(seed ^ 0x51ed270b);
  const pools = {
    easy: shuffledIslandPool(seed, 'easy'),
    medium: shuffledIslandPool(seed, 'medium'),
    hard: shuffledIslandPool(seed, 'hard'),
  };
  const used = { easy: 0, medium: 0, hard: 0 };
  const pickSeed = (col: number) => {
    const pool = col <= 1 ? 'easy' : col <= 3 ? 'medium' : 'hard';
    return pools[pool][used[pool]++ % pools[pool].length];
  };
  const nodes: IslandNode[] = [];
  const cols: IslandNode[][] = [];
  let id = 0;
  for (let c = 0; c < CAMPAIGN.columns; c++) {
    const n = randInt(rng, CAMPAIGN.islandsPerColumn[0], CAMPAIGN.islandsPerColumn[1]);
    const col: IslandNode[] = [];
    for (let r = 0; r < n; r++) {
      const roll = rng();
      const reward: RewardKind = c === 0 ? 'none' : roll < CAMPAIGN.itemChance ? 'item' : roll < CAMPAIGN.itemChance + CAMPAIGN.recruitChance ? 'recruit' : 'none';
      const node: IslandNode = {
        id: id++, col: c, row: r,
        x: (c + 0.5) / (CAMPAIGN.columns + 1),
        y: (r + 0.5) / n + (rng() - 0.5) * (0.25 / n),
        seed: pickSeed(c),
        difficulty: c,
        isFinal: false,
        reward,
        item: reward === 'item' ? ITEMS[Math.floor(rng() * ITEMS.length)] : null,
        links: [],
        state: 'open',
      };
      col.push(node);
      nodes.push(node);
    }
    cols.push(col);
  }
  const final: IslandNode = {
    id: id++, col: CAMPAIGN.columns, row: 0, x: (CAMPAIGN.columns + 0.5) / (CAMPAIGN.columns + 1), y: 0.5,
    seed: pickSeed(CAMPAIGN.columns), difficulty: CAMPAIGN.columns - 1 + CAMPAIGN.finalDifficultyBonus, isFinal: true,
    reward: 'none', item: null, links: [], state: 'open',
  };
  nodes.push(final);
  cols.push([final]);

  // связи: каждый остров → ближайший по высоте в следующей колонке (+ иногда второй); у каждого есть вход
  for (let c = 0; c < cols.length - 1; c++) {
    const next = cols[c + 1];
    for (const a of cols[c]) {
      const sorted = [...next].sort((p, q) => Math.abs(p.y - a.y) - Math.abs(q.y - a.y));
      a.links.push(sorted[0].id);
      if (sorted[1] && rng() < 0.5) a.links.push(sorted[1].id);
    }
    for (const b of next) {
      if (cols[c].some((a) => a.links.includes(b.id))) continue;
      const nearest = [...cols[c]].sort((p, q) => Math.abs(p.y - b.y) - Math.abs(q.y - b.y))[0];
      nearest.links.push(b.id);
    }
  }
  return nodes;
}
