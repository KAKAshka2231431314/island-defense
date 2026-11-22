// Зоны острова (как клетки поля в Bad North): квадраты 2×2 клетки, в каждом стоит ровно один отряд.
import { TILE } from '../data/config';
import { IslandGrid } from './IslandGrid';

export interface Zone {
  id: number;
  zx: number;
  zy: number;
  /** клетки квадрата */
  cells: number[];
  /** центр и границы квадрата, px */
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  level: number;
}

export interface ZoneMap {
  zones: Zone[];
  /** клетка → id зоны (-1 — не входит ни в одну зону) */
  zoneOfCell: Int32Array;
  size: number;
}

// ======================================================================
// Квадраты: вся проходимая земля режется на полноценные квадраты 2×2 (как клетки поля в Bad North)
// ======================================================================

/** Квадрат 2×2 клетки: левый верхний угол и уровень. */
export interface Square {
  x: number;
  y: number;
  level: number;
}

export function squareCells(q: { x: number; y: number }, w: number): number[] {
  return [q.y * w + q.x, q.y * w + q.x + 1, (q.y + 1) * w + q.x, (q.y + 1) * w + q.x + 1];
}

/**
 * Упаковать проходимую землю в квадраты 2×2. Столбцы — парами от чётного x (сетка ровная по горизонтали);
 * по вертикали каждая пара столбцов режется на отрезки одного уровня, квадраты встают с начала отрезка,
 * а при нечётной длине — так, чтобы по возможности совпасть с чётными рядами (под скалой ряды сдвигаются).
 */
export function packSquares(grid: IslandGrid): Square[] {
  const out: Square[] = [];
  const pairOk = (x: number, y: number): number => {
    const l = grid.getLevel(x, y);
    const ok = (cx: number) => grid.isWalkable(cx, y) && !grid.stairAt(cx, y) && grid.getLevel(cx, y) === l;
    return l >= 1 && ok(x) && ok(x + 1) ? l : 0;
  };
  for (let x = 0; x + 1 < grid.w; x += 2) {
    let y = 0;
    while (y < grid.h) {
      const l = pairOk(x, y);
      if (!l) { y++; continue; }
      let end = y;
      while (end + 1 < grid.h && pairOk(x, end + 1) === l) end++;
      const len = end - y + 1;
      let start = y;
      if (len % 2 === 1 && y % 2 === 1) start = y + 1; // лишняя клетка — сверху, чтобы попасть в чётные ряды
      for (let r = start; r + 1 <= end; r += 2) out.push({ x, y: r, level: l });
      y = end + 1;
    }
  }
  return out;
}

/** Зоны из квадратов; лестницы не являются зонами для постановки отрядов. */
export function zonesFromSquares(grid: IslandGrid, squares: Square[]): ZoneMap {
  const zoneOfCell = new Int32Array(grid.w * grid.h).fill(-1);
  const zones: Zone[] = squares.map((q, id) => {
    const cells = squareCells(q, grid.w);
    for (const c of cells) zoneOfCell[c] = id;
    return {
      id, zx: q.x / 2, zy: Math.floor(q.y / 2), cells, level: q.level,
      cx: (q.x + 1) * TILE, cy: (q.y + 1) * TILE,
      x0: q.x * TILE, y0: q.y * TILE, x1: (q.x + 2) * TILE, y1: (q.y + 2) * TILE,
    };
  });
  return { zones, zoneOfCell, size: 2 };
}
