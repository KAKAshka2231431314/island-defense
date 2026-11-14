// Сетка острова: высоты клеток + лестницы. Источник правды для отрисовки и проходимости.
//
// level: 0 — вода, 1 — плоская земля, 2..3 — возвышенности.
// Скала уровня L занимает клетку прямо под нижним краем плато (x, y+1) — она непроходима.
// Лестница уровня L — прямые ступени вместо скалы: ряд из width клеток (x..x+width−1, y) под нижним
// краем плато; сверху — плато уровня L, снизу — земля уровня L−1. Базовый level клеток лестницы = L − 1.
// Боковой склон (side 'left' / 'right') — столбец из двух клеток (x, y) и (x, y+1) вдоль бокового края
// плато; на плато входят сбоку, с земли — сбоку или снизу.

/** front — прямые ступени в обрыве; left / right — склон слева / справа от плато */
export type StairSide = 'front' | 'left' | 'right';

export interface StairDef {
  x: number;
  /** ряд ступеней (на месте скалы); у бокового склона — верхняя клетка, рядом с нижним рядом плато */
  y: number;
  width: number;
  /** на какой уровень ведёт */
  level: number;
  side?: StairSide;
}

export interface StairCell {
  def: StairDef;
}

export class IslandGrid {
  readonly level: Uint8Array;
  /** клетки, занятые домами/деревьями (непроходимы) */
  readonly blocked: Uint8Array;
  readonly stairs: StairDef[] = [];
  private readonly stairCells = new Map<number, StairCell>();

  constructor(readonly w: number, readonly h: number, level?: Uint8Array) {
    this.level = level ?? new Uint8Array(w * h);
    this.blocked = new Uint8Array(w * h);
  }

  setBlocked(x: number, y: number, v: boolean): void {
    if (this.inBounds(x, y)) this.blocked[this.idx(x, y)] = v ? 1 : 0;
  }

  isBlocked(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.blocked[this.idx(x, y)] === 1;
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  getLevel(x: number, y: number): number {
    return this.inBounds(x, y) ? this.level[this.idx(x, y)] : 0;
  }

  setLevel(x: number, y: number, v: number): void {
    if (this.inBounds(x, y)) this.level[this.idx(x, y)] = v;
  }

  get maxLevel(): number {
    let m = 0;
    for (const v of this.level) m = Math.max(m, v);
    return m;
  }

  addStair(def: StairDef): void {
    this.stairs.push(def);
    for (const [x, y] of IslandGrid.stairCellsOf(def)) this.stairCells.set(this.idx(x, y), { def });
  }

  /** Клетки лестницы: ряд у прямых ступеней, столбец из двух у бокового склона. */
  static stairCellsOf(def: StairDef): [number, number][] {
    if (def.side === 'left' || def.side === 'right') return [[def.x, def.y], [def.x, def.y + 1]];
    const out: [number, number][] = [];
    for (let i = 0; i < def.width; i++) out.push([def.x + i, def.y]);
    return out;
  }

  stairAt(x: number, y: number): StairCell | undefined {
    return this.inBounds(x, y) ? this.stairCells.get(this.idx(x, y)) : undefined;
  }

  isWater(x: number, y: number): boolean {
    return this.getLevel(x, y) === 0;
  }

  /** Уровень скалы, занимающей клетку (0 — скалы нет). Берём самую высокую. */
  cliffLevel(x: number, y: number): number {
    if (this.stairAt(x, y)) return 0;
    const up = this.getLevel(x, y - 1);
    const me = this.getLevel(x, y);
    return up >= 2 && up > me ? up : 0;
  }

  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y) || this.isBlocked(x, y)) return false;
    if (this.stairAt(x, y)) return true;
    return this.getLevel(x, y) >= 1 && this.cliffLevel(x, y) === 0;
  }

  /** Диапазон высот, с которыми клетка соединяется (лестница — два уровня). */
  walkRange(x: number, y: number): [number, number] {
    const s = this.stairAt(x, y);
    if (s) return [s.def.level - 1, s.def.level];
    const l = this.getLevel(x, y);
    return [l, l];
  }

  /** Можно ли шагнуть из соседней клетки a в b (4 или 8 направлений). */
  canStep(ax: number, ay: number, bx: number, by: number): boolean {
    if (!this.isWalkable(ax, ay) || !this.isWalkable(bx, by)) return false;
    const aStair = this.stairAt(ax, ay), bStair = this.stairAt(bx, by);
    if (aStair && bStair && aStair.def !== bStair.def && aStair.def.level !== bStair.def.level) return false;
    const frontA = aStair && (!aStair.def.side || aStair.def.side === 'front');
    const frontB = bStair && (!bStair.def.side || bStair.def.side === 'front');
    if (ax !== bx && ay === by && (frontA || frontB) && aStair?.def !== bStair?.def) return false;
    const [a0, a1] = this.walkRange(ax, ay);
    const [b0, b1] = this.walkRange(bx, by);
    if (a1 < b0 || b1 < a0) return false;
    if (ax !== bx && ay !== by) {
      // диагональ: оба ортогональных соседа должны быть проходимы с того же уровня
      return this.canStep(ax, ay, bx, ay) && this.canStep(ax, ay, ax, by)
        && this.canStep(bx, ay, bx, by) && this.canStep(ax, by, bx, by);
    }
    return true;
  }

  /** Земля под тайлами плоского слоя (включая клетки под плато и лестницами). */
  isLand(x: number, y: number): boolean {
    return this.getLevel(x, y) >= 1;
  }

  /** Построить сетку из ASCII-карты (для тестов).
   *  «~» вода, «.» земля, «^» уровень 2, «3» уровень 3,
   *  «S» — ступени на уровень 2 (под нижним краем плато), «s» — ступени на уровень 3. */
  static fromAscii(rows: string[]): IslandGrid {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const g = new IslandGrid(w, h);
    const levels: Record<string, number> = { '~': 0, '.': 1, '^': 2, '3': 3, S: 1, s: 2 };
    rows.forEach((row, y) => {
      for (let x = 0; x < w; x++) {
        const ch = row[x] ?? '~';
        g.setLevel(x, y, levels[ch] ?? 0);
        if (ch === 'S' || ch === 's') g.addStair({ x, y, width: 1, level: ch === 'S' ? 2 : 3 });
      }
    });
    return g;
  }
}
