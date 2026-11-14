import type { IslandGrid } from '../mapgen/IslandGrid';

const N8: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// При равной длине основные ступени предпочтительнее, но короткий боковой подъём не отбрасывается.
const SIDE_RAMP_COST = 0.01;

/**
 * Поля потоков (Dijkstra от цели по всей сетке) с кэшем.
 * Учитывают перепады высот: шаг возможен только по grid.canStep (лестницы, без скал).
 * Остров маленький (~700 клеток), поэтому поле считается за доли миллисекунды.
 */
export class FlowFields {
  private readonly cache = new Map<number, Float32Array>();
  private readonly maxCache = 256;

  constructor(private readonly grid: IslandGrid) {}

  clear(): void {
    this.cache.clear();
  }

  field(goal: number): Float32Array {
    let f = this.cache.get(goal);
    if (f) {
      // освежить в LRU
      this.cache.delete(goal);
      this.cache.set(goal, f);
      return f;
    }
    f = this.compute(goal);
    this.cache.set(goal, f);
    if (this.cache.size > this.maxCache) this.cache.delete(this.cache.keys().next().value!);
    return f;
  }

  /** Расстояние в клетках от from до goal (Infinity — недостижимо). */
  distance(from: number, goal: number): number {
    return this.field(goal)[from];
  }

  /** Следующая клетка на пути от from к goal, -1 — если уже на месте или пути нет. */
  next(from: number, goal: number): number {
    if (from === goal) return -1;
    const f = this.field(goal);
    const g = this.grid;
    const fx = from % g.w, fy = (from / g.w) | 0;
    let best = -1, bestD = f[from];
    for (const [dx, dy] of N8) {
      const nx = fx + dx, ny = fy + dy;
      if (!g.inBounds(nx, ny)) continue;
      const n = g.idx(nx, ny);
      if (f[n] < bestD && g.canStep(fx, fy, nx, ny)) { bestD = f[n]; best = n; }
    }
    return best;
  }

  private compute(goal: number): Float32Array {
    const g = this.grid;
    const dist = new Float32Array(g.w * g.h).fill(Infinity);
    dist[goal] = 0;
    // простая двоичная куча по (dist, idx)
    const heap: number[] = [goal];
    const less = (a: number, b: number) => dist[a] < dist[b];
    const push = (v: number) => {
      heap.push(v);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(heap[i], heap[p])) break;
        [heap[i], heap[p]] = [heap[p], heap[i]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      return top;
    };
    const done = new Uint8Array(g.w * g.h);
    while (heap.length) {
      const c = pop();
      if (done[c]) continue;
      done[c] = 1;
      const cx = c % g.w, cy = (c / g.w) | 0;
      for (const [dx, dy, cost] of N8) {
        const nx = cx + dx, ny = cy + dy;
        if (!g.inBounds(nx, ny)) continue;
        const n = g.idx(nx, ny);
        if (done[n]) continue;
        // поле строится от цели, поэтому шаг проверяем в обратную сторону (n → c)
        if (!g.canStep(nx, ny, cx, cy)) continue;
        const side = g.stairAt(nx, ny)?.def.side;
        const nd = dist[c] + cost + (side === 'left' || side === 'right' ? SIDE_RAMP_COST : 0);
        if (nd < dist[n]) { dist[n] = nd; push(n); }
      }
    }
    return dist;
  }
}
