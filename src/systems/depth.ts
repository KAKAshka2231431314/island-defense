// Сортировка по глубине с учётом высот.
//
// Объект на уровне L рисуется так, будто он на (L-1) клеток южнее: ключ = y + (L-1)·TILE.
// Вертикальные скалы участвуют в сортировке: тот, кто стоит за обрывом, оказывается под ним,
// а тот, кто стоит на плато или перед скалой, — поверх. Плоский верх плато остаётся под объектами.
import { DEPTH, TILE } from '../data/config';
import type { IslandGrid } from '../mapgen/IslandGrid';

/** Уровень клетки для сортировки: ступени — уровень плато (юнит на них поверх скалы), вода — 1. */
export function sortLevel(grid: IslandGrid, cx: number, cy: number): number {
  const s = grid.stairAt(cx, cy);
  if (s) return s.def.level;
  return Math.max(1, grid.getLevel(cx, cy));
}

export function sortKey(grid: IslandGrid, x: number, y: number): number {
  return y + (sortLevel(grid, Math.floor(x / TILE), Math.floor(y / TILE)) - 1) * TILE;
}

/** Глубина объекта, стоящего в точке (x, y). */
export function depthAt(grid: IslandGrid, x: number, y: number, bias = 0): number {
  return DEPTH.objects + sortKey(grid, x, y) + bias;
}

/** Плоская поверхность плато лежит под объектами; глубина нужна только для порядка уровней земли. */
export function plateauDepth(_r: number, L: number): number {
  return DEPTH.flat + L * 0.1;
}

/** Глубина плитки скалы уровня L в клетке ряда c (под плато). */
export function cliffDepth(c: number, L: number): number {
  return DEPTH.objects + (c + L - 2) * TILE + 0.5;
}
