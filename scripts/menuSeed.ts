// Подбор сида для острова меню: npm run menu:seed [кол-во]
import { MENU } from '../src/data/balance';
import { generateIsland } from '../src/mapgen/IslandGenerator';

const n = Number(process.argv[2] ?? 3000);
const good: { seed: number; score: number; info: string }[] = [];
for (let seed = 1; seed <= n; seed++) {
  try {
    const d = generateIsland(seed, MENU.island);
    const g = d.grid;
    const trees = d.decor.filter((o) => o.kind === 'tree').length;
    const sheep = d.decor.filter((o) => o.kind === 'sheep').length;
    const terraces = g.stairs.filter((s) => s.level === 3).length;
    // низина вдоль берега (как в бою) — заметная часть острова
    let low = 0;
    for (let i = 0; i < g.level.length; i++) if (g.level[i] === 1) low++;
    const barracks = d.houses.some((h) => h.kind === 'barracks');
    if (low / d.landCells < 0.4) continue;
    if (g.maxLevel < 3 || terraces < 1 || g.stairs.length < 2 || d.houses.length < 2 || d.houses.length > 3 || trees < 3 || sheep < 2) continue;
    let y0 = 99, y1 = -1, x0 = 99, x1 = -1;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.getLevel(x, y) > 0) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    let plateau = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.getLevel(x, y) >= 3) plateau++;
    // компактный, не слишком вытянутый, с заметным плато и 3 домами
    const score = (barracks ? 1 : 0) + (d.houses.length === 3 ? 2 : 0) + Math.min(plateau, 16) / 8 - Math.abs((x1 - x0) / (y1 - y0) - 1.3) - Math.max(0, trees - 10) * 0.1;
    good.push({ seed, score, info: `суша ${d.landCells}, низина ${Math.round(low / d.landCells * 100)} %${barracks ? ", казарма" : ""}, ${x1 - x0 + 1}×${y1 - y0 + 1} клеток, терраса ${plateau}, лестниц ${g.stairs.length}, дома ${d.houses.length}, деревья ${trees}, овцы ${sheep}` });
  } catch { /* сид не подошёл */ }
}
good.sort((a, b) => b.score - a.score);
console.log(`подходит ${good.length} из ${n}`);
for (const g of good.slice(0, 12)) console.log(g.seed, g.score.toFixed(2), g.info);
