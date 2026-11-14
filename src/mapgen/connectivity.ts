import type { IslandGrid } from './IslandGrid';

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export interface Components {
  /** метка компоненты для каждой клетки, -1 — непроходимо */
  label: Int32Array;
  sizes: number[];
  /** индекс самой большой компоненты */
  main: number;
}

/** Компоненты связности проходимых клеток с учётом лестниц и перепадов. */
export function walkComponents(grid: IslandGrid): Components {
  const label = new Int32Array(grid.w * grid.h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const i = grid.idx(x, y);
      if (label[i] !== -1 || !grid.isWalkable(x, y)) continue;
      const id = sizes.length;
      let size = 0;
      label[i] = id;
      stack.push(i);
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        const cx = c % grid.w, cy = (c / grid.w) | 0;
        for (const [dx, dy] of DIRS4) {
          const nx = cx + dx, ny = cy + dy;
          if (!grid.inBounds(nx, ny)) continue;
          const n = grid.idx(nx, ny);
          if (label[n] !== -1 || !grid.canStep(cx, cy, nx, ny)) continue;
          label[n] = id;
          stack.push(n);
        }
      }
      sizes.push(size);
    }
  }
  let main = -1;
  sizes.forEach((s, i) => { if (main < 0 || s > sizes[main]) main = i; });
  return { label, sizes, main };
}

export function isFullyConnected(grid: IslandGrid): boolean {
  return walkComponents(grid).sizes.length <= 1;
}

/** Кратчайшие расстояния от клетки start до всей проходимой земли, с учётом лестниц. */
export function walkDistances(grid: IslandGrid, start: number): Int32Array {
  const dist = new Int32Array(grid.w * grid.h).fill(-1);
  const sx = start % grid.w, sy = (start / grid.w) | 0;
  if (!grid.isWalkable(sx, sy)) return dist;
  const queue = [start];
  dist[start] = 0;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const cx = c % grid.w, cy = (c / grid.w) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx, ny = cy + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const n = grid.idx(nx, ny);
      if (dist[n] !== -1 || !grid.canStep(cx, cy, nx, ny)) continue;
      dist[n] = dist[c] + 1;
      queue.push(n);
    }
  }
  return dist;
}

/** Обычная 4-связная заливка по предикату. Возвращает список компонент (индексы клеток). */
export function floodComponents(w: number, h: number, pred: (x: number, y: number) => boolean): number[][] {
  const seen = new Uint8Array(w * h);
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i] || !pred(x, y)) continue;
      const comp: number[] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        comp.push(c);
        const cx = c % w, cy = (c / w) | 0;
        for (const [dx, dy] of DIRS4) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (seen[n] || !pred(nx, ny)) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      out.push(comp);
    }
  }
  return out;
}

/** Расстояние (в шагах, 8-связно) от каждой клетки до ближайшей клетки, где pred = true. */
export function distanceField(w: number, h: number, pred: (x: number, y: number) => boolean): Int32Array {
  const dist = new Int32Array(w * h).fill(-1);
  let queue: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pred(x, y)) { dist[y * w + x] = 0; queue.push(y * w + x); }
  while (queue.length) {
    const next: number[] = [];
    for (const c of queue) {
      const cx = c % w, cy = (c / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (dist[n] !== -1) continue;
          dist[n] = dist[c] + 1;
          next.push(n);
        }
      }
    }
    queue = next;
  }
  return dist;
}
