import { CAMPAIGN } from '../src/data/balance';
import { TILESET_BY_LEVEL } from '../src/data/config';
import { generateIsland } from '../src/mapgen/IslandGenerator';
import { IslandGrid } from '../src/mapgen/IslandGrid';
import { walkDistances } from '../src/mapgen/connectivity';
import { generateCampaignMap } from '../src/mapgen/campaignMap';
import { ISLAND_POOLS } from '../src/mapgen/islandPools';

const all = [...ISLAND_POOLS.easy, ...ISLAND_POOLS.medium, ...ISLAND_POOLS.hard];
if (ISLAND_POOLS.easy.length !== 15 || ISLAND_POOLS.medium.length !== 20 || ISLAND_POOLS.hard.length !== 15 || all.length !== 50) {
  throw new Error('Пул карт должен содержать 15 лёгких, 20 средних и 15 сложных островов');
}
if (new Set(all).size !== 50) throw new Error('В пуле карт есть повторяющийся сид');

for (const seed of all) {
  const island = generateIsland(seed);
  const castles = island.houses.filter((h) => h.kind === 'castle');
  if (castles.length !== 1) throw new Error(`У карты пула нет ровно одного замка: сид ${seed}`);
  const castle = castles[0];
  for (const l of island.landings) {
    if (l.dy !== 1) throw new Error(`У карты пула высадка не с юга: сид ${seed}`);
    const route = walkDistances(island.grid, island.grid.idx(l.x, l.y));
    if (route[island.grid.idx(castle.doorX, castle.doorY)] < 0) throw new Error(`У карты пула нет пути к замку: сид ${seed}`);
  }
  for (const st of island.grid.stairs) {
    if (st.side !== 'left' && st.side !== 'right') continue;
    if (!TILESET_BY_LEVEL[st.level - 1]) throw new Error(`У боковой лестницы нет нижнего слоя: сид ${seed}`);
    for (const [x, y] of IslandGrid.stairCellsOf(st)) {
      const [low] = island.grid.walkRange(x, y);
      if (low !== st.level - 1) throw new Error(`Лестница без нижнего слоя: сид ${seed}, клетка ${x},${y}`);
    }
  }
}

for (const campaignSeed of [11, 22, 33]) {
  const nodes = generateCampaignMap(campaignSeed);
  const usedByPool = { easy: new Set<number>(), medium: new Set<number>(), hard: new Set<number>() };
  for (const n of nodes) {
    const pool = n.col <= 1 ? 'easy' : n.col <= 3 ? 'medium' : 'hard';
    if (!(ISLAND_POOLS[pool] as readonly number[]).includes(n.seed)) throw new Error(`Остров колонки ${n.col} получил сид не из пула ${pool}`);
    if (usedByPool[pool].has(n.seed)) throw new Error(`Карта ${n.seed} повторилась в кампании`);
    usedByPool[pool].add(n.seed);
  }
  if (nodes.filter((n) => n.isFinal).length !== 1) throw new Error('В кампании должен быть один финальный остров');
}
const a = generateCampaignMap(11).map((n) => n.seed).join(',');
const b = generateCampaignMap(22).map((n) => n.seed).join(',');
if (a === b) throw new Error('Разные кампании получили одинаковую последовательность карт');

console.log(`Пул карт: ${all.length}; кампании и текстуры лестниц проверены`);
