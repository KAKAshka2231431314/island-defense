import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { ISLAND } from '../data/balance';
import { distanceField, floodComponents, isFullyConnected, walkComponents, walkDistances } from './connectivity';
import { IslandGrid } from './IslandGrid';
import { packSquares, squareCells, type Square } from './zones';
import { mulberry32, randInt, type Rng } from './rng';

/** Параметры генерации (как ISLAND в balance.ts, но с обычными числами вместо литералов). */
export type IslandParams = { [K in keyof typeof ISLAND]: (typeof ISLAND)[K] extends number ? number : (typeof ISLAND)[K] extends readonly [number, number] ? [number, number] : (typeof ISLAND)[K] };

/** Параметры текущей генерации (подменяются на время generateIsland с overrides). */
let P: IslandParams = ISLAND;

/** Клетка берега, куда причаливает лодка; (dx, dy) — направление от берега в море. */
export interface LandingPoint {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** Дом занимает квадрат 2×2 (нижний ряд — y), казарма — два квадрата рядом (4×2); вход — клетки (doorX, doorY)
 *  и (doorX+1, doorY) под зданием (у казармы — посередине, на стыке двух квадратов). */
export interface HouseSpot {
  x: number;
  y: number;
  doorX: number;
  doorY: number;
  variant: number;
  kind: 'house' | 'barracks';
  /** ширина в клетках: 2 — дом, 4 — казарма */
  width: number;
}

export type DecorKind = 'tree' | 'bush' | 'rock' | 'sheep';

export interface DecorSpot {
  kind: DecorKind;
  x: number;
  y: number;
  variant: number;
}

export interface IslandData {
  seed: number;
  attempt: number;
  grid: IslandGrid;
  landings: LandingPoint[];
  houses: HouseSpot[];
  decor: DecorSpot[];
  landCells: number;
  /** квадраты 2×2 — зоны отрядов */
  squares: Square[];
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Счётчик причин отбраковки попыток (для настройки генератора). */
export const genStats: Record<string, number> = {};
function reject(reason: string): null {
  genStats[reason] = (genStats[reason] ?? 0) + 1;
  return null;
}

function fbm(noise: NoiseFunction2D, x: number, y: number, octaves: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Выбор максимально разнесённых точек (farthest point sampling). */
function spreadPick<T extends { x: number; y: number }>(rng: Rng, cands: T[], max: number, minDist: number,
  avoid: { x: number; y: number }[] = []): T[] {
  const chosen: T[] = [];
  const pool = shuffle(rng, cands.slice());
  const minD = (c: T) => {
    let m = Infinity;
    for (const p of [...chosen, ...avoid]) m = Math.min(m, Math.hypot(p.x - c.x, p.y - c.y));
    return m;
  };
  while (chosen.length < max && pool.length) {
    let best = -1, bestD = -1;
    for (let i = 0; i < pool.length; i++) {
      const d = minD(pool[i]);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (bestD < minDist) break;
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen;
}

/**
 * Генерирует остров по сиду. Детерминированно: один сид → один и тот же остров.
 * Если попытка не прошла проверки (мало суши, нет 3 точек высадки, не влезли дома), пробуем снова
 * с производным сидом той же последовательности.
 */
export function generateIsland(seed: number, overrides: Partial<IslandParams> = {}): IslandData {
  const prev = P;
  P = { ...ISLAND, ...overrides };
  try {
    for (let attempt = 0; attempt < P.maxAttempts; attempt++) {
      const data = tryGenerate(seed, attempt);
      if (data) return data;
    }
  } finally {
    P = prev;
  }
  throw new Error(`Не удалось сгенерировать остров для сида ${seed}`);
}

function tryGenerate(seed: number, attempt: number): IslandData | null {
  const rng = mulberry32((seed ^ Math.imul(attempt + 1, 0x9e3779b1)) >>> 0);
  const W = P.width, H = P.height;
  const shapeNoise = createNoise2D(rng);
  const heightNoise = createNoise2D(rng);

  // ---------- 1. форма суши ----------
  let land = new Uint8Array(W * H);
  const B = P.borderWater;
  const inner = (x: number, y: number) => x >= B && y >= B && x < W - B && y < H - B;
  const cx = W / 2 + (rng() * 2 - 1) * W * P.centerJitter;
  const cy = H / 2 + (rng() * 2 - 1) * H * P.centerJitter;
  const rx = W * P.radiusX, ry = H * P.radiusY;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inner(x, y)) continue;
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      const v = 1 - d + fbm(shapeNoise, x * P.noiseFreq, y * P.noiseFreq, P.noiseOctaves) * P.noiseAmp;
      if (v > P.landThreshold) land[y * W + x] = 1;
    }
  }

  // ---------- 2. сглаживание (клеточный автомат) ----------
  for (let p = 0; p < P.smoothPasses; p++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!inner(x, y)) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && land[(y + dy) * W + x + dx]) n++;
        const i = y * W + x;
        next[i] = n >= 5 ? 1 : n <= 2 ? 0 : land[i];
      }
    }
    land = next;
  }

  // берег — по парам столбцов, чтобы суша резалась на квадраты 2×2 без обрезков по краям
  snapColumns(land, W, H);

  // ---------- 3. один остров, без озёр ----------
  const landComps = floodComponents(W, H, (x, y) => land[y * W + x] === 1);
  if (!landComps.length) return reject('no-land');
  landComps.sort((a, b) => b.length - a.length);
  land.fill(0);
  for (const i of landComps[0]) land[i] = 1;
  for (const comp of floodComponents(W, H, (x, y) => land[y * W + x] === 0)) {
    const touchesBorder = comp.some((i) => {
      const x = i % W, y = (i / W) | 0;
      return x === 0 || y === 0 || x === W - 1 || y === H - 1;
    });
    if (!touchesBorder) for (const i of comp) land[i] = 1;
  }
  // убрать «перешейки» в одну клетку по диагонали — они ломают пену и проходимость
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const a = land[y * W + x], b = land[y * W + x + 1], c = land[(y + 1) * W + x], d = land[(y + 1) * W + x + 1];
      if (a && d && !b && !c) land[y * W + x + 1] = 1;
      if (b && c && !a && !d) land[y * W + x] = 1;
    }
  }
  // Засыпаем воду, зажатую сушей с трёх сторон: такие щели выглядят дырами в текстуре между скалами.
  for (;;) {
    const fill: number[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (land[i]) continue;
      let banks = 0;
      for (const [dx, dy] of DIRS4) if (land[(y + dy) * W + x + dx]) banks++;
      if (banks >= 3) fill.push(i);
    }
    if (!fill.length) break;
    for (const i of fill) land[i] = 1;
  }
  const landCells = land.reduce((s, v) => s + v, 0);
  if (landCells < P.minLandCells) return reject('land-small');
  if (landCells > P.maxLandCells) return reject('land-big');

  // ---------- 4. высоты ----------
  const level = new Uint8Array(land);
  const coastDist = distanceField(W, H, (x, y) => land[y * W + x] === 0);
  const at = (arr: Uint8Array, x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : arr[y * W + x]);
  /** основной уровень острова: 2 у острова-скалы, 1 у плоского */
  const base = P.rockBase ? 2 : 1;
  if (P.rockBase && !carveLowlands(land, level, W, H, heightNoise)) return reject('plateau-small');
  const nearLower = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(level, x + dx, y + dy) < base) return true;
    return false;
  };
  const cand = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (land[i] && level[i] === base && coastDist[i] >= P.plateauCoastDist && !nearLower(x, y)
        && fbm(heightNoise, x * P.plateauFreq, y * P.plateauFreq, 2) > P.plateauThreshold) cand[i] = 1;
    }
  }
  // террасы только из блоков 2×2 — без змеек шириной в клетку, чтобы каждый уровень читался отдельной стеной
  const terraceMask = open2x2(openMask(cand, W, H), W, H);
  fillGaps(terraceMask, W, H, (x, y) => land[y * W + x] === 1 && level[y * W + x] === base && coastDist[y * W + x] >= 1);
  if (P.rockBase) {
    snapColumns(terraceMask, W, H);
    for (let i = 0; i < terraceMask.length; i++) if (terraceMask[i] && (!land[i] || level[i] !== base)) terraceMask[i] = 0;
  }
  const plateau = open2x2(terraceMask, W, H);
  const plateauComps = floodComponents(W, H, (x, y) => at(plateau, x, y) === 1)
    .filter((c) => c.length >= P.plateauMinSize)
    .sort((a, b) => b.length - a.length)
    .slice(0, P.plateauMaxCount);
  for (const comp of plateauComps) {
    for (const i of comp) level[i] = base + 1;
    if (!P.rockBase && rng() < P.level3Chance) addLevel3(comp, level, W, H, heightNoise);
  }
  if (P.rockBase) {
    // холмы уровня 2 в широкой низине; выше террас уровня 3 остров не поднимается
    addBlocks(level, W, H, 1, P.lowlandHillMax, rng);
  }
  // Под южным обрывом тоже не оставляем узких водных карманов: под скалой должна быть земля, а не просвет моря.
  for (;;) {
    const cliffs = new IslandGrid(W, H, level);
    const fill: number[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (level[i]) continue;
      let banks = 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (cliffs.isLand(nx, ny) || cliffs.cliffLevel(nx, ny) > 0) banks++;
      }
      if (banks >= 3) fill.push(i);
    }
    if (!fill.length) break;
    for (const i of fill) level[i] = 1;
  }

  // ---------- 5. лестницы + связность ----------
  let grid!: IslandGrid;
  for (let iter = 0; iter < 12; iter++) {
    grid = new IslandGrid(W, H, level.slice());
    const placed = placeStairs(grid, level, rng);
    if (placed === null) return reject('rock-stairs');
    if (!placed) continue; // что-то сплющили — пересобрать
    const comps = walkComponents(grid);
    if (comps.sizes.length <= 1) break;
    // остров-скала: бухта, в которую не встала лестница, засыпается до уровня острова (основу не опускаем)
    if (P.rockBase) {
      let raised = false;
      for (let i = 0; i < comps.label.length; i++) {
        if (comps.label[i] >= 0 && comps.label[i] !== comps.main && level[i] === 1) { level[i] = 2; raised = true; }
      }
      if (raised) continue;
    }
    if (!flattenBlocker(grid, level, comps)) {
      // не нашли, что сплющить: отрезанные карманы просто закрываем (там вырастут деревья)
      for (let i = 0; i < comps.label.length; i++) {
        if (comps.label[i] >= 0 && comps.label[i] !== comps.main) grid.blocked[i] = 1;
      }
      break;
    }
  }
  if (!isFullyConnected(grid)) return reject('disconnected');
  const pockets: number[] = [];
  for (let i = 0; i < grid.blocked.length; i++) if (grid.blocked[i]) pockets.push(i);
  // входы на лестницы и склоны не закрываются ни домами, ни лесом, ни декором, и лодки к ним не причаливают
  const stairEntry = new Uint8Array(W * H);
  const stairSupport = new Uint8Array(W * H);
  for (const s of grid.stairs) {
    if (s.side === 'left' || s.side === 'right') {
      const px = s.x + (s.side === 'left' ? 1 : -1);
      stairSupport[grid.idx(px, s.y)] = 1;
      stairSupport[grid.idx(px, s.y + 1)] = 1;
    } else {
      for (let x = s.x; x < s.x + s.width; x++) stairSupport[grid.idx(x, s.y - 1)] = 1;
    }
    for (const [sx, sy] of IslandGrid.stairCellsOf(s)) {
      for (const [dx, dy] of DIRS4) {
        const nx = sx + dx, ny = sy + dy;
        if (grid.inBounds(nx, ny) && !grid.stairAt(nx, ny) && grid.canStep(sx, sy, nx, ny)) stairEntry[ny * W + nx] = 1;
      }
    }
  }

  // ---------- 6. квадраты 2×2 — зоны отрядов, как клетки поля в Bad North ----------
  let squares = packSquares(grid);
  const squareOf = new Int32Array(W * H).fill(-1);
  const indexSquares = () => {
    squareOf.fill(-1);
    squares.forEach((q, i) => { for (const c of squareCells(q, W)) squareOf[c] = i; });
  };
  indexSquares();
  // Узкие проходы достраиваются до полного квадрата, а не остаются землёй без зоны отряда.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = grid.idx(x, y);
    if (squareOf[i] >= 0 || !grid.isWalkable(x, y) || grid.stairAt(x, y)) continue;
    const level = grid.getLevel(x, y), qx = x - (x % 2);
    for (const qy of [y, y - 1]) {
      const q = { x: qx, y: qy, level };
      if (qy < 0 || qy + 1 >= H) continue;
      const cells = squareCells(q, W);
      if (cells.some((c) => squareOf[c] >= 0 || stairSupport[c] || grid.stairAt(c % W, (c / W) | 0) || grid.blocked[c])) continue;
      for (const c of cells) grid.level[c] = level;
      squares.push(q);
      indexSquares();
      break;
    }
  }
  // Декоративные обрезки блокируем до расстановки зданий: проверки маршрутов должны видеть итоговую проходимость.
  const filler = new Uint8Array(W * H);
  // Достройка квадратов может зажать воду сушей и скалами с трёх сторон. Засыпаем такие визуальные дыры декором.
  for (;;) {
    const fill: number[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = grid.idx(x, y);
      if (!grid.isWater(x, y)) continue;
      let banks = 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (grid.isLand(nx, ny) || grid.cliffLevel(nx, ny) > 0) banks++;
      }
      if (banks >= 3) fill.push(i);
    }
    if (!fill.length) break;
    for (const i of fill) {
      grid.level[i] = 1;
      grid.blocked[i] = 1;
      filler[i] = 1;
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = grid.idx(x, y);
    if (squareOf[i] >= 0 || !grid.isWalkable(x, y) || grid.stairAt(x, y)) continue;
    grid.blocked[i] = 1;
    filler[i] = 1;
  }
  if (!isFullyConnected(grid)) return reject('squares-disconnected');

  // ---------- 7. точки высадки: клетка квадрата низины у воды, с любой стороны острова ----------
  const openWater = (x: number, y: number) => !grid.inBounds(x, y) || (grid.isWater(x, y) && grid.cliffLevel(x, y) === 0);
  const landingCands: LandingPoint[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (squareOf[y * W + x] < 0 || grid.getLevel(x, y) !== 1 || stairEntry[y * W + x]) continue;
      for (const [dx, dy] of DIRS4) {
        if (dy !== 1) continue; // враги нападают только с юга
        let clear = true;
        for (let k = 1; k <= P.landingClearance && clear; k++) clear = openWater(x + dx * k, y + dy * k);
        if (clear) landingCands.push({ x, y, dx, dy });
      }
    }
  }
  const landings = spreadPick(rng, landingCands, P.landingMax, P.landingMinSpacing);
  if (landings.length < P.landingMin) return reject('landings');
  const landingSquares = new Set(landings.map((l) => squareOf[l.y * W + l.x]));

  // ---------- 8. дома: занимают целый квадрат, дверь — в квадрат прямо под ним ----------
  const squareAt = (x: number, y: number) => (grid.inBounds(x, y) ? squareOf[y * W + x] : -1);
  const houses: HouseSpot[] = [];
  const doorSquares = new Set<number>();
  const usedSquares = new Set<number>();
  /** квадрат подходит под здание: на плато, не у высадки и не у входа на лестницу, не у самой воды */
  const buildable = (i: number) => {
    const q = squares[i];
    return !landingSquares.has(i) && !squareCells(q, W).some((c) => stairEntry[c] || coastDist[c] < P.houseCoastDist)
      && !landings.some((l) => Math.hypot(l.x - q.x, l.y - q.y) < P.houseLandingDist);
  };
  /** квадрат прямо под квадратом i (дверь), или −1 */
  const below = (i: number) => {
    const q = squares[i], d = squareAt(q.x, q.y + 2);
    return d >= 0 && squares[d].x === q.x && squares[d].y === q.y + 2 ? d : -1;
  };
  const barracksClear = (i: number) => {
    const q = squares[i];
    for (let y = q.y - 1; y <= q.y + 2; y++) for (let x = q.x - 1; x <= q.x + 4; x++) {
      if (grid.inBounds(x, y) && (grid.cliffLevel(x, y) > 0 || grid.stairAt(x, y))) return false;
    }
    return true;
  };
  const routesBeforeHouses = landings.map((l) => walkDistances(grid, grid.idx(l.x, l.y)));
  /** занять квадраты зданием, если все маршруты от высадок останутся короткими */
  const occupy = (cells: number[]) => {
    for (const c of cells) grid.blocked[c] = 1;
    const direct = routesBeforeHouses.every((before, r) => {
      const after = walkDistances(grid, grid.idx(landings[r].x, landings[r].y));
      for (let i = 0; i < before.length; i++) {
        if (before[i] < 0 || !grid.isWalkable(i % W, (i / W) | 0)) continue;
        if (after[i] < 0 || after[i] > before[i] + P.houseMaxDetour) return false;
      }
      return true;
    });
    if (direct) return true;
    for (const c of cells) grid.blocked[c] = 0;
    return false;
  };

  // казарма рыцарей: два квадрата рядом на одном уровне, под обоими — свободные квадраты (вход посередине)
  if (rng() < P.barracksChance) {
    const pairs: { x: number; y: number; a: number; b: number }[] = [];
    squares.forEach((q, a) => {
      const b = squareAt(q.x + 2, q.y);
      if (b < 0 || squares[b].y !== q.y || squares[b].x !== q.x + 2 || squares[b].level !== q.level) return;
      if (!buildable(a) || !buildable(b) || below(a) < 0 || below(b) < 0 || !barracksClear(a)) return;
      pairs.push({ x: q.x + 2, y: q.y + 1, a, b });
    });
    for (const p of shuffle(rng, pairs)) {
      if (!occupy([...squareCells(squares[p.a], W), ...squareCells(squares[p.b], W)])) continue;
      usedSquares.add(p.a).add(p.b);
      doorSquares.add(below(p.a)).add(below(p.b));
      const q = squares[p.a];
      houses.push({ x: q.x, y: q.y + 1, doorX: q.x + 1, doorY: q.y + 2, variant: 0, kind: 'barracks', width: 4 });
      break;
    }
  }
  const houseCands: (Square & { door: number })[] = [];
  squares.forEach((q, i) => {
    const door = below(i);
    if (door >= 0 && buildable(i)) houseCands.push({ ...q, door });
  });
  // казарма считается за дом
  const houseTarget = randInt(rng, P.housesMin, P.housesMax);
  const avoid = houses.map((h) => ({ x: h.x + 1, y: h.y - 1 }));
  for (const q of spreadPick(rng, houseCands, houseTarget * 3, P.houseSpacing, avoid)) {
    if (houses.length >= houseTarget) break;
    const qi = squareAt(q.x, q.y);
    if (usedSquares.has(qi) || doorSquares.has(qi) || usedSquares.has(q.door) || !occupy(squareCells(q, W))) continue;
    usedSquares.add(qi);
    doorSquares.add(q.door);
    houses.push({ x: q.x, y: q.y + 1, doorX: q.x, doorY: q.y + 2, variant: randInt(rng, 1, 3), kind: 'house', width: 2 });
  }
  if (houses.length < P.housesMin) return reject('houses');

  const decor: DecorSpot[] = [];
  // карманы, закрытые на шаге 5, — лес
  for (const i of pockets) decor.push({ kind: 'tree', x: i % W, y: (i / W) | 0, variant: randInt(rng, 1, 4) });

  // ---------- 9. рощи: несколько квадратов у берега целиком под лес ----------
  const forestCands = squares
    .map((q, i) => ({ ...q, i }))
    .filter((q) => q.level >= base && !landingSquares.has(q.i) && !usedSquares.has(q.i) && !doorSquares.has(q.i)
      && squareCells(q, W).some((c) => coastDist[c] <= 2) && !squareCells(q, W).some((c) => stairEntry[c]));
  let forests = 0;
  for (const q of shuffle(rng, forestCands)) {
    if (forests >= P.forestClusters) break;
    const cells = squareCells(q, W);
    if (!occupy(cells)) continue;
    usedSquares.add(q.i);
    forests++;
    // 3–4 дерева в квадрате
    for (const c of shuffle(rng, cells.slice()).slice(0, 3 + (rng() < 0.5 ? 1 : 0))) {
      decor.push({ kind: 'tree', x: c % W, y: (c / W) | 0, variant: randInt(rng, 1, 4) });
    }
  }
  squares = squares.filter((_, i) => !usedSquares.has(i));
  indexSquares();

  // ---------- 10. остаточная земля вне игровых квадратов — явно непроходимый декор ----------
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!filler[i]) continue;
      // Входы на подъёмы остаются открытыми, остальные обрезки закрыты деревом или заметным камнем.
      if (stairEntry[i]) continue;
      const kind: DecorKind = rng() < P.fillerTree ? 'tree' : 'rock';
      decor.push({ kind, x, y, variant: randInt(rng, 1, 4) });
    }
  }
  if (!isFullyConnected(grid)) return reject('squares-disconnected');

  // ---------- 11. мелкий декор на квадратах (не мешает ходить): кусты, камни, овцы ----------
  const reserved = new Uint8Array(W * H);
  const reserve = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (grid.inBounds(x + dx, y + dy)) reserved[grid.idx(x + dx, y + dy)] = 1;
  };
  landings.forEach((l) => reserve(l.x, l.y, 1));
  for (let i = 0; i < stairEntry.length; i++) if (stairEntry[i]) reserved[i] = 1;
  houses.forEach((h) => { reserve(h.doorX, h.doorY, 0); reserve(h.doorX + 1, h.doorY, 0); });
  const free = (x: number, y: number) => squareOf[y * W + x] >= 0 && !reserved[y * W + x];
  const scatter = (kind: DecorKind, count: number, variants: number, onlyLevel = 0) => {
    const cands: { x: number; y: number }[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (free(x, y) && (!onlyLevel || grid.getLevel(x, y) === onlyLevel)) cands.push({ x, y });
    for (const c of shuffle(rng, cands).slice(0, count)) {
      reserved[grid.idx(c.x, c.y)] = 1;
      decor.push({ kind, x: c.x, y: c.y, variant: randInt(rng, 1, variants) });
    }
  };
  scatter('bush', Math.round(landCells * P.bushDensity), 2);
  scatter('rock', Math.round(landCells * P.rockDensity), 4);
  scatter('sheep', randInt(rng, P.sheepMin, P.sheepMax), 1, base);

  return { seed, attempt, grid, landings, houses, decor, landCells, squares };
}



/**
 * Низины как в Bad North: суша у воды — уровень 1 (туда пристают лодки), середина острова — плато уровня 2.
 * Клетка становится плато, если суша тянется от неё на lowlandDepth клеток во все стороны (на юг — на клетку
 * дальше: там под плато ряд скалы). Местами на юге плато доходит до воды и обрывается скалой в море.
 * Плато выровнено по парам столбцов и собрано из блоков 2×2; берётся самый большой кусок.
 */
function carveLowlands(land: Uint8Array, level: Uint8Array, W: number, H: number, noise: NoiseFunction2D): boolean {
  const isLand = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && land[y * W + x] === 1;
  const D = P.lowlandDepth;
  const southCliff = (x: number) => fbm(noise, (x >> 1) * P.southCliffFreq + 200, 7.3, 1) > P.southCliffThreshold;
  const plateau = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isLand(x, y)) continue;
      const south = southCliff(x) ? 0 : D + 1;
      let ok = true;
      for (let dy = -D; dy <= south && ok; dy++) for (let dx = -D; dx <= D; dx++) if (!isLand(x + dx, y + dy)) { ok = false; break; }
      if (ok) plateau[y * W + x] = 1;
    }
  }
  snapColumns(plateau, W, H);
  const opened = open2x2(plateau, W, H);
  const comps = floodComponents(W, H, (x, y) => opened[y * W + x] === 1 && isLand(x, y)).sort((a, b) => b.length - a.length);
  if (!comps.length || comps[0].length < P.plateauMinCells) return false;
  for (let i = 0; i < level.length; i++) if (land[i]) level[i] = 1;
  for (const i of comps[0]) level[i] = 2;
  return true;
}

/**
 * Поднять на уровень L+1 до count блоков 2×2 (иногда 4×2) внутри земли уровня L: под блоком — ряд под скалу
 * и ряд выхода с лестницы той же земли; ring — ещё и кольцо этой земли вокруг (иначе по бокам и сверху может
 * быть земля ниже, но не выше). Блоки по сетке квадратов и не вплотную друг к другу.
 */
function addBlocks(level: Uint8Array, W: number, H: number, L: number, count: number, rng: Rng, ring = true): number {
  const lv = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : level[y * W + x]);
  const fits = (x0: number, y0: number, w: number) => {
    for (let y = y0 - 1; y <= y0 + 3; y++) {
      for (let x = x0 - 1; x <= x0 + w; x++) {
        const inner = x >= x0 && x < x0 + w && y >= y0;
        const v = lv(x, y);
        if (inner || ring ? v !== L : v > L) return false;
      }
    }
    return true;
  };
  const cands: { x: number; y: number; w: number }[] = [];
  for (let y = 1; y < H - 4; y++) {
    for (let x = 2; x < W - 3; x += 2) {
      if (!fits(x, y, 2)) continue;
      cands.push({ x, y, w: fits(x, y, 4) && rng() < 0.5 ? 4 : 2 });
    }
  }
  let made = 0;
  for (const c of shuffle(rng, cands)) {
    if (made >= count) break;
    if (!fits(c.x, c.y, c.w)) continue; // соседний блок уже занял место
    for (let y = c.y; y < c.y + 2; y++) for (let x = c.x; x < c.x + c.w; x++) level[y * W + x] = L + 1;
    made++;
  }
  return made;
}

/** Морфологическое «открытие»: убирает тонкие отростки шириной в 1 клетку. */
function openMask(mask: Uint8Array, W: number, H: number): Uint8Array {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
  const core = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (at(x, y) && at(x + 1, y) && at(x - 1, y) && at(x, y + 1) && at(x, y - 1)) core[y * W + x] = 1;
    }
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!at(x, y)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && core[ny * W + nx]) { near = true; break; }
      }
      if (near) out[y * W + x] = 1;
    }
  }
  return out;
}

/** Оставляет только клетки, входящие хотя бы в один блок 2×2 маски. */
function open2x2(mask: Uint8Array, W: number, H: number): Uint8Array {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (at(x, y) && at(x + 1, y) && at(x, y + 1) && at(x + 1, y + 1)) {
        out[y * W + x] = out[y * W + x + 1] = out[(y + 1) * W + x] = out[(y + 1) * W + x + 1] = 1;
      }
    }
  }
  return out;
}

/** Уровень 3 внутри плато: только клетки, полностью окружённые уровнем 2 и с запасом снизу под скалу. */
function addLevel3(comp: number[], level: Uint8Array, W: number, H: number, noise: NoiseFunction2D): void {
  const lv = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : level[y * W + x]);
  const mask = new Uint8Array(W * H);
  for (const i of comp) {
    const x = i % W, y = (i / W) | 0;
    let inside = lv(x, y + 2) >= 2;
    for (let dy = -1; dy <= 1 && inside; dy++) for (let dx = -1; dx <= 1; dx++) if (lv(x + dx, y + dy) < 2) { inside = false; break; }
    if (inside && fbm(noise, x * 0.2 + 50, y * 0.2 + 50, 2) > -P.level3Threshold) mask[i] = 1;
  }
  const opened = open2x2(mask, W, H);
  const comps = floodComponents(W, H, (x, y) => opened[y * W + x] === 1)
    .filter((c) => c.length >= P.level3MinSize)
    .sort((a, b) => b.length - a.length);
  if (comps.length) for (const i of comps[0]) level[i] = 3;
}

/** Заполняет щели в 1 клетку между частями плато (иначе скала «висит» в узкой щели). */
function fillGaps(mask: Uint8Array, W: number, H: number, allowed: (x: number, y: number) => boolean): void {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (at(x, y) || !allowed(x, y)) continue;
        if ((at(x, y - 1) && at(x, y + 1)) || (at(x - 1, y) && at(x + 1, y))) mask[y * W + x] = 1;
      }
    }
  }
}


/**
 * Подъёмы на плато (уровни 2..max), в каждую нижнюю область — свои прямые ступени
 * на южном крае (по возможности в две клетки шириной, по сетке квадратов).
 * Если плато не к чему спустить — опускает его на уровень ниже и возвращает false (пересобрать сетку);
 * null — у основы острова-скалы нет подходящего места для обязательного подъёма.
 */
function placeStairs(grid: IslandGrid, level: Uint8Array, rng: Rng): boolean | null {
  const W = grid.w, H = grid.h;
  for (let L = 2; L <= grid.maxLevel; L++) {
    const lowerId = new Int32Array(W * H).fill(-1);
    const lowerSize: number[] = [];
    floodComponents(W, H, (x, y) => grid.getLevel(x, y) === L - 1 && grid.cliffLevel(x, y) === 0)
      .forEach((c, id) => { lowerSize[id] = c.length; for (const i of c) lowerId[i] = id; });
    // клетка (x, y) — ступени плато уровня L: сверху плато, снизу проходимая земля уровня L−1
    const okStep = (x: number, y: number) =>
      grid.getLevel(x, y - 1) === L && grid.cliffLevel(x, y - 1) === 0 && !grid.stairAt(x, y - 1)
      && grid.getLevel(x, y) === L - 1 && grid.cliffLevel(x, y) === L && !grid.stairAt(x, y)
      && grid.getLevel(x, y + 1) === L - 1 && grid.cliffLevel(x, y + 1) === 0 && !grid.stairAt(x, y + 1);
    type Cand = { x: number; y: number; width: number; region: number; side: 'front' };
    const fits = (c: Cand) => Array.from({ length: c.width }, (_, k) => okStep(c.x + k, c.y)).every(Boolean);
    const comps = floodComponents(W, H, (x, y) => grid.getLevel(x, y) >= L);
    const largest = Math.max(...comps.map((c) => c.length));
    for (const comp of comps) {
      const inComp = new Set(comp);
      const cands: Cand[] = [];
      for (const i of comp) {
        const x = i % W, y = ((i / W) | 0) + 1;
        if (!okStep(x, y)) continue;
        const region = lowerId[(y + 1) * W + x];
        // в две клетки — от чётного столбца, как квадраты
        if (x % 2 === 0 && okStep(x + 1, y) && inComp.has((y - 1) * W + x + 1)) cands.push({ x, y, width: 2, region, side: 'front' });
        else cands.push({ x, y, width: 1, region, side: 'front' });
      }
      if (!cands.length) {
        // основу острова-скалы не опускаем — попытка бракуется
        if (P.rockBase && L === 2 && comp.length === largest) return null;
        for (const i of comp) level[i] = L - 1;
        return false;
      }
      const required: Cand[] = [];
      if (P.rockBase && L === 2 && comp.length === largest) {
        // На основное плато обязательно есть подъём с юга.
        const options = cands.filter(fits);
        const c = options[Math.floor(rng() * options.length)];
        if (!c) return null;
        grid.addStair({ x: c.x, y: c.y, width: c.width, level: L, side: c.side });
        required.push(c);
      }
      for (const region of new Set(cands.map((c) => c.region))) {
        const mine = cands.filter((o) => o.region === region);
        const wide = mine.filter((o) => o.width === 2);
        // с низины на плато основы — подъёмов больше: низина тянется вокруг всего острова
        const extra = P.rockBase && L === 2 ? Math.floor((lowerSize[region] ?? 0) / P.stairRegionCells) : 0;
        const want = randInt(rng, P.stairsPerPlateau[0], P.stairsPerPlateau[1]) + extra;
        const picks = required.filter((c) => c.region === region);
        const frontPool = wide.length ? wide : mine;
        const pool = frontPool.filter((o) => !picks.includes(o));
        picks.push(...spreadPick(rng, pool, want - picks.length, 3, picks));
        for (const c of picks) {
          if (!required.includes(c) && fits(c)) grid.addStair({ x: c.x, y: c.y, width: c.width, level: L, side: c.side });
        }
      }
    }
  }
  return true;
}

/** Выровнять маску по парам столбцов (x, x+1) с чётного x: смешанная пара → обе клетки по большинству соседей. */
function snapColumns(mask: Uint8Array, W: number, H: number): void {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x + 1 < W; x += 2) {
      if (at(x, y) === at(x + 1, y)) continue;
      const near = at(x, y - 1) + at(x + 1, y - 1) + at(x, y + 1) + at(x + 1, y + 1) + at(x - 1, y) + at(x + 2, y);
      const v = near >= 3 ? 1 : 0;
      mask[y * W + x] = v;
      mask[y * W + x + 1] = v;
    }
  }
}

/**
 * Остров распался на несколько проходимых частей. Находим плато, которое отрезает кусок,
 * и опускаем его. Возвращает false, если ничего опустить не удалось.
 */
function flattenBlocker(grid: IslandGrid, level: Uint8Array, comps: ReturnType<typeof walkComponents>): boolean {
  const W = grid.w, H = grid.h;
  const flattenAt = (x: number, y: number): boolean => {
    const L = grid.getLevel(x, y);
    if (L < 2 || (P.rockBase && L <= 2)) return false; // основу острова-скалы не опускаем
    const comp = floodComponents(W, H, (cx, cy) => grid.getLevel(cx, cy) >= L).find((c) => c.includes(y * W + x));
    if (!comp) return false;
    for (const i of comp) level[i] = Math.max(1, Math.min(level[i], L - 1));
    return true;
  };
  // отрезанные куски, начиная с самых маленьких
  const ids = comps.sizes.map((s, i) => ({ s, i })).filter((c) => c.i !== comps.main).sort((a, b) => a.s - b.s);
  for (const { i: id } of ids) {
    for (let k = 0; k < comps.label.length; k++) {
      if (comps.label[k] !== id) continue;
      const x = k % W, y = (k / W) | 0;
      if (grid.getLevel(x, y) >= 2 && flattenAt(x, y)) return true;
      // плоский карман: ищем соседнюю скалу и плато над ней
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (grid.cliffLevel(nx, ny) > 0 && flattenAt(nx, ny - 1)) return true;
      }
    }
  }
  return false;
}
