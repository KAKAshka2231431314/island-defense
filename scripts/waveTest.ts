// Сводка размеров волн по сложности: npm run wave:test
import { ENEMY_COST } from '../src/data/balance';
import { generateIsland } from '../src/mapgen/IslandGenerator';
import { mulberry32 } from '../src/mapgen/rng';
import { planWaves, waterPath } from '../src/systems/WavePlanner';

for (let seed = 1; seed <= 30; seed++) {
  for (const landing of generateIsland(seed).landings) {
    const path = waterPath(generateIsland(seed).grid, landing);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if ((b.x - a.x) * landing.dx + (b.y - a.y) * landing.dy > 1) {
        throw new Error(`Лодка отплывает во время подхода: сид ${seed}, высадка ${JSON.stringify(landing)}, участок ${JSON.stringify([a, b])}`);
      }
      if (Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1) {
        throw new Error(`Диагональный участок лодки: сид ${seed}, участок ${JSON.stringify([a, b])}`);
      }
    }
  }
}

const island = generateIsland(7);
const regular = planWaves(3, false, island.landings, mulberry32(94));
const extended = planWaves(3, false, island.landings, mulberry32(94), true);
if (extended.length !== regular.length + 1) throw new Error('Особое задание не добавило ровно одну волну');
for (let d = 0; d <= 6; d++) {
  for (const fin of d === 6 ? [false, true] : [false]) {
    const plans = planWaves(d, fin, island.landings, mulberry32(d * 31 + 1));
    const trolls = plans.flatMap((p) => p.boats).filter((b) => b.cargo.includes('troll')).length;
    const expectedTrolls = d >= 3 ? 1 : 0;
    if (trolls !== expectedTrolls) {
      throw new Error(`Сложность ${d}${fin ? ' (финал)' : ''}: троллей ${trolls}, ожидалось ${expectedTrolls}`);
    }
    const desc = plans.map((p) => {
      const all = p.boats.flatMap((b) => b.cargo);
      const pts = all.reduce((s, t) => s + ENEMY_COST[t], 0);
      return `${p.boats.length}л/${all.length}в/${pts.toFixed(0)}о`;
    });
    console.log(`сложность ${d}${fin ? ' ФИНАЛ' : ''}: ${desc.join('  ')}`);
  }
}
