// Прогон генератора без браузера: npm run gen:test [кол-во сидов] [сид для печати]
import { generateIsland, genStats } from '../src/mapgen/IslandGenerator';
import { floodComponents, isFullyConnected, walkDistances } from '../src/mapgen/connectivity';
import { IslandGrid } from '../src/mapgen/IslandGrid';
import { FlowFields } from '../src/systems/FlowField';
import { ISLAND } from '../src/data/balance';
import { zonesFromSquares } from '../src/mapgen/zones';

const adjacentStairs = IslandGrid.fromAscii(['^^3', 'Ss.', '...']);
if (adjacentStairs.canStep(0, 1, 1, 1) || adjacentStairs.canStep(1, 1, 0, 1)) {
  throw new Error('Регрессия: соседние лестницы соединяют уровни 1 и 3 напрямую');
}
const frontStair = IslandGrid.fromAscii(['^^^', 'SSS', '...']);
if (frontStair.canStep(1, 1, 0, 1) || frontStair.canStep(1, 1, 2, 1)
  || !frontStair.canStep(1, 0, 1, 1) || !frontStair.canStep(1, 1, 1, 2)) {
  throw new Error('Регрессия: прямая лестница проходима сбоку или закрыта сверху/снизу');
}
const singleStair = IslandGrid.fromAscii(['^^^', '.S.', '...']);
const climbRoute = new FlowFields(singleStair);
if (climbRoute.next(singleStair.idx(1, 2), singleStair.idx(1, 0)) !== singleStair.idx(1, 1)
  || climbRoute.next(singleStair.idx(1, 1), singleStair.idx(1, 0)) !== singleStair.idx(1, 0)) {
  throw new Error('Регрессия: одиночная прямая лестница не ведёт на плато');
}
const wideStair = new IslandGrid(2, 2, new Uint8Array([2, 2, 1, 1]));
wideStair.addStair({ x: 0, y: 1, width: 2, level: 2 });
if (!wideStair.canStep(0, 1, 1, 1)) throw new Error('Регрессия: разделены клетки одной широкой лестницы');
const mainStairRoute = IslandGrid.fromAscii(['~~~~~~~', '~^^~~~~', '~^^...~', '~SS...~', '.......']);
mainStairRoute.addStair({ x: 3, y: 2, width: 1, level: 2, side: 'right' });
const route = new FlowFields(mainStairRoute);
const start = mainStairRoute.idx(4, 2), goal = mainStairRoute.idx(1, 1);
if (route.next(start, goal) !== mainStairRoute.idx(3, 2)) {
  throw new Error('Регрессия: отряд обходит остров вместо короткого допустимого подъёма');
}

const n = Number(process.argv[2] ?? 200);
const show = process.argv[3] ? Number(process.argv[3]) : 1;
let fails = 0, attempts = 0, lv2 = 0, lv3 = 0, houses = 0, landings = 0, stairs = 0;
// стороны высадок (куда смотрит лодка) и виды подъёмов
const landDir: Record<string, number> = {};
const stairSide: Record<string, number> = {};
let oneSided = 0, barracks = 0, lowShare = 0, hills = 0, houseGap = 0, gapN = 0, minGap = 99, bushPairs = 0;
const t0 = performance.now();
for (let seed = 1; seed <= n; seed++) {
  try {
    const d = generateIsland(seed);
    attempts += d.attempt + 1;
    const max = d.grid.maxLevel;
    if (max > 3) throw new Error(`Высота больше 3: сид ${seed}, уровень ${max}`);
    for (let y = 0; y < d.grid.h; y++) for (let x = 0; x < d.grid.w; x++) {
      const L = d.grid.getLevel(x, y);
      if (L < 2) continue;
      const solidBlock = [0, -1].some((dy) => [0, -1].some((dx) => {
        const bx = x + dx, by = y + dy;
        return bx >= 0 && by >= 0 && bx + 1 < d.grid.w && by + 1 < d.grid.h
          && d.grid.getLevel(bx, by) >= L && d.grid.getLevel(bx + 1, by) >= L
          && d.grid.getLevel(bx, by + 1) >= L && d.grid.getLevel(bx + 1, by + 1) >= L;
      }));
      if (!solidBlock) throw new Error(`Возвышенность без блока 2×2: сид ${seed}, клетка ${x},${y}, уровень ${L}`);
    }
    const zoneMap = zonesFromSquares(d.grid, d.squares);
    for (const h of d.houses) {
      if (h.kind === 'house' && (h.width !== 2 || !d.grid.isBlocked(h.x, h.y - 1) || !d.grid.isBlocked(h.x, h.y))) {
        throw new Error(`Маленький дом не занимает 2×2 клетки: сид ${seed}`);
      }
    }
    for (const st of d.grid.stairs) {
      if (st.side !== 'left' && st.side !== 'right') continue;
      for (const [x, y] of IslandGrid.stairCellsOf(st)) {
        const zoneId = zoneMap.zoneOfCell[d.grid.idx(x, y)];
        if (zoneId < 0) throw new Error(`Боковая лестница без зоны отряда: сид ${seed}, клетка ${x},${y}`);
        const zone = zoneMap.zones[zoneId];
        if (zone.level !== st.level - 1 || zone.cells.some((c) => d.grid.stairAt(c % d.grid.w, Math.floor(c / d.grid.w)))) {
          throw new Error(`Клик по боковой лестнице не ведёт в квадрат под ней: сид ${seed}, клетка ${x},${y}`);
        }
      }
    }
    if (!d.grid.stairs.some((s) => s.level === 2 && (s.side ?? 'front') === 'front')) {
      throw new Error(`Нет обязательного подъёма снизу: сид ${seed}`);
    }
    for (const st of d.grid.stairs) {
      if ((st.side ?? 'front') !== 'front') throw new Error(`Боковая лестница на новой карте: сид ${seed}`);
    }
    if (max >= 2) lv2++;
    if (max >= 3) lv3++;
    houses += d.houses.length; landings += d.landings.length; stairs += d.grid.stairs.length;
    const dirs = new Set<string>();
    for (const l of d.landings) {
      if (l.dy !== 1) throw new Error(`Высадка не с юга: сид ${seed}, клетка ${l.x},${l.y}`);
      const k = "юг";
      dirs.add(k);
      landDir[k] = (landDir[k] ?? 0) + 1;
    }
    let bottom = -1;
    for (let i = 0; i < d.grid.level.length; i++) if (d.grid.level[i] >= 1) bottom = Math.max(bottom, Math.floor(i / d.grid.w));
    let beachTop = bottom - (ISLAND.lowlandDepth + 2);
    if (beachTop % 2 === 1) beachTop--;
    for (let y = 0; y < d.grid.h; y++) for (let x = 0; x < d.grid.w; x++) {
      if (d.grid.getLevel(x, y) !== 1 || d.grid.stairAt(x, y) || d.grid.cliffLevel(x, y) > 0 || d.grid.isBlocked(x, y)) continue;
      if (y < beachTop) throw new Error(`Пляж выше южной полосы: сид ${seed}, клетка ${x},${y}`);
    }
    if (dirs.size <= 1) oneSided++;
    hills += floodComponents(d.grid.w, d.grid.h, (x, y) => d.grid.getLevel(x, y) === 2).length - 1;
    { const c = d.houses.map((h) => ({ x: h.x + h.width / 2, y: h.y })); let m = 99; for (let a = 0; a < c.length; a++) for (let b = a + 1; b < c.length; b++) m = Math.min(m, Math.hypot(c[a].x - c[b].x, c[a].y - c[b].y)); if (m < 99) { houseGap += m; gapN++; minGap = Math.min(minGap, m); } }
    barracks += d.houses.filter((h) => h.kind === "barracks").length;
    { let low = 0, all = 0; for (let i = 0; i < d.grid.level.length; i++) { if (d.grid.level[i] >= 1) all++; if (d.grid.level[i] === 1) low++; } lowShare += low / all; }
    for (const st of d.grid.stairs) {
      const k = st.side ?? "front"; stairSide[k] = (stairSide[k] ?? 0) + 1;
      if (st.side === 'left' || st.side === 'right') {
        const px = st.x + (st.side === 'left' ? 1 : -1);
        if (d.grid.getLevel(px, st.y) !== st.level || d.grid.getLevel(px, st.y + 1) !== st.level) {
          throw new Error(`Склон стоит на южном крае, а не сбоку плато: сид ${seed}, клетка ${st.x},${st.y}`);
        }
      }
      for (const [sx, sy] of IslandGrid.stairCellsOf(st)) {
        if (d.decor.some((o) => o.kind === 'rock' && o.x === sx && o.y === sy)) {
          throw new Error(`Камень на лестнице: сид ${seed}, клетка ${sx},${sy}`);
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = sx + dx, y = sy + dy;
          if (!d.grid.inBounds(x, y) || d.grid.stairAt(x, y) || !d.grid.canStep(sx, sy, x, y)) continue;
          if (d.decor.some((o) => (o.kind === 'tree' || o.kind === 'rock') && o.x === x && o.y === y)) {
            throw new Error(`Дерево или камень перед лестницей: сид ${seed}, клетка ${x},${y}`);
          }
        }
      }
    }
    for (const h of d.houses) {
      if (h.kind !== 'barracks') continue;
      for (let y = h.y - 2; y <= h.y + 1; y++) for (let x = h.x - 1; x <= h.x + h.width; x++) {
        if (!d.grid.inBounds(x, y)) continue;
        if (d.grid.cliffLevel(x, y) > 0 || d.grid.stairAt(x, y)) {
          throw new Error(`Казарма касается стены или лестницы: сид ${seed}, клетка ${x},${y}`);
        }
      }
    }
    const clearHouses = new IslandGrid(d.grid.w, d.grid.h, d.grid.level.slice());
    clearHouses.blocked.set(d.grid.blocked);
    d.grid.stairs.forEach((st) => clearHouses.addStair(st));
    for (const h of d.houses) for (let y = h.y - 1; y <= h.y; y++) for (let x = h.x; x < h.x + h.width; x++) {
      clearHouses.setBlocked(x, y, false);
    }
    for (const l of d.landings) {
      const start = d.grid.idx(l.x, l.y);
      const before = walkDistances(clearHouses, start), after = walkDistances(d.grid, start);
      for (let i = 0; i < before.length; i++) {
        if (before[i] < 0 || !d.grid.isWalkable(i % d.grid.w, (i / d.grid.w) | 0)) continue;
        if (after[i] < 0 || after[i] > before[i] + ISLAND.houseMaxDetour) {
          throw new Error(`Дом создал обход ${after[i] - before[i]} клеток: сид ${seed}, высадка ${l.x},${l.y}`);
        }
      }
    }
    if (!isFullyConnected(d.grid)) console.log('НЕ СВЯЗАН', seed);
    for (const q of d.squares) {
      for (const o of d.decor) {
        if ((o.kind !== 'tree' && o.kind !== 'bush') || o.x < q.x || o.x > q.x + 1 || o.y < q.y || o.y > q.y + 1) continue;
        throw new Error(`Зона отряда содержит дерево или куст: сид ${seed}, клетка ${o.x},${o.y}`);
      }
    }
    bushPairs += d.decor.filter((t) => t.kind === 'tree'
      && d.decor.some((b) => b.kind === 'bush' && Math.hypot(b.x - t.x, b.y - t.y) <= 1.5)).length;
    const zoned = new Set(d.squares.flatMap((q) => [q.y * d.grid.w + q.x, q.y * d.grid.w + q.x + 1, (q.y + 1) * d.grid.w + q.x, (q.y + 1) * d.grid.w + q.x + 1]));
    const decorative = new Set<number>();
    for (const o of d.decor) {
      if (o.kind !== 'tree' && o.kind !== 'bush') continue;
      const qx = o.x - (o.x % 2);
      for (const qy of [o.y, o.y - 1]) {
        if (qy < 0 || qy + 1 >= d.grid.h) continue;
        for (const c of [qy * d.grid.w + qx, qy * d.grid.w + qx + 1, (qy + 1) * d.grid.w + qx, (qy + 1) * d.grid.w + qx + 1]) decorative.add(c);
      }
    }
    for (let y = 0; y < d.grid.h; y++) for (let x = 0; x < d.grid.w; x++) {
      const i = d.grid.idx(x, y);
      if (d.grid.isWater(x, y)) {
        const banks = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => d.grid.isLand(x + dx, y + dy) || d.grid.cliffLevel(x + dx, y + dy) > 0).length;
        if (banks >= 3) throw new Error(`Узкий разрыв земли: сид ${seed}, клетка ${x},${y}`);
      }
      if (d.grid.isWalkable(x, y) && !d.grid.stairAt(x, y) && !zoned.has(i) && !decorative.has(i)) throw new Error(`Земля без квадрата: сид ${seed}, клетка ${x},${y}`);
      if (!d.grid.isWalkable(x, y) || d.grid.stairAt(x, y)) continue;
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (d.grid.inBounds(nx, ny) && !d.grid.stairAt(nx, ny) && d.grid.getLevel(x, y) !== d.grid.getLevel(nx, ny)
          && d.grid.canStep(x, y, nx, ny)) throw new Error(`Диагональ минует лестницу: сид ${seed}, ${x},${y} → ${nx},${ny}`);
      }
    }
  } catch (e) { fails++; console.log('FAIL', seed, (e as Error).message); }
}
const ok = n - fails;
if (ok && !bushPairs) throw new Error('Рядом с деревьями не появились кусты');
if (ok && (stairSide.left || stairSide.right)) throw new Error('На новых картах остались боковые подъёмы');
console.log(`сидов ${n}, провалов ${fails}, ср. попыток ${(attempts / ok).toFixed(2)}, ${((performance.now() - t0) / n).toFixed(1)} мс/остров`);
console.log('причины отбраковки:', JSON.stringify(genStats));
console.log('высадки по сторонам:', JSON.stringify(landDir), 'островов с высадкой с одной стороны:', oneSided);
console.log('подъёмы:', JSON.stringify(stairSide));
console.log(`холмов в низине ${hills}, ближайшие дома: в среднем ${(houseGap / gapN).toFixed(1)}, минимум ${minGap.toFixed(1)} клеток`);
console.log(`казарм на ${ok} островов: ${barracks}, доля низины ${Math.round(lowShare / ok * 100)} %`);
console.log(`с плато ${lv2}, с уровнем 3 ${lv3}, ср. домов ${(houses / ok).toFixed(1)}, высадок ${(landings / ok).toFixed(1)}, лестниц ${(stairs / ok).toFixed(1)}`);

const d = generateIsland(show);
const g = d.grid;
const rows: string[] = [];
for (let y = 0; y < g.h; y++) {
  let r = '';
  for (let x = 0; x < g.w; x++) {
    const s = g.stairAt(x, y);
    const house = d.houses.find((h) => (h.y === y || h.y - 1 === y) && x >= h.x && x < h.x + h.width);
    const land = d.landings.find((l) => l.x === x && l.y === y);
    const dec = d.decor.find((o) => o.x === x && o.y === y);
    r += house ? (house.kind === 'barracks' ? 'K' : 'H') : land ? 'B' : s ? (s.def.side === 'left' ? '<' : s.def.side === 'right' ? '>' : 'S') : g.cliffLevel(x, y) ? '#'
      : g.getLevel(x, y) === 0 ? '~' : dec?.kind === 'tree' ? 'T' : String(g.getLevel(x, y)).replace('1', '.');
  }
  rows.push(r);
}
console.log(`\nсид ${show} (попытка ${d.attempt}): суша ${d.landCells}, дома ${d.houses.length}, высадки ${d.landings.length}\n` + rows.join('\n'));
