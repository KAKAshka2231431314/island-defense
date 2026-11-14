// Планирование волн и путей лодок (без Phaser — можно гонять в Node).
import { ENEMY_COST, ENEMY_UNLOCK, WAVES, type EnemyType } from '../data/balance';
import { TILE } from '../data/config';
import type { Point } from '../entities/Unit';
import type { LandingPoint } from '../mapgen/IslandGenerator';
import type { IslandGrid } from '../mapgen/IslandGrid';
import type { Rng } from '../mapgen/rng';

export interface BoatPlan {
  landing: number;
  cargo: EnemyType[];
  /** номер лодки среди идущих к тому же берегу (задержка и сдвиг при причаливании) */
  slot: number;
}

const seats = (t: EnemyType) => WAVES.seatCost[t] ?? 1;

/** Роли в составе волны: основа (рядовые, щитоносцы), поддержка (стрелки, шаман), угроза (громила, подрывник, бочка). */
export const ROLES: Record<keyof typeof WAVES.roleShare, EnemyType[]> = {
  base: ['goblin_torch', 'skull'],
  support: ['harpoon_fish', 'shaman'],
  threat: ['troll', 'goblin_tnt', 'goblin_barrel'],
};

/** Случайный тип из доступных по бюджету: дешёвые чаще (вес 1/цена). */
function pickType(rng: Rng, pool: EnemyType[], budget: number, cargo: EnemyType[]): EnemyType | null {
  const affordable = pool.filter((t) => ENEMY_COST[t] <= budget && !(t === 'troll' && cargo.includes('troll')));
  if (!affordable.length) return null;
  const weights = affordable.map((t) => 1 / ENEMY_COST[t]);
  let r = rng() * weights.reduce((a, c) => a + c, 0);
  for (let i = 0; i < affordable.length; i++) {
    r -= weights[i];
    if (r <= 0) return affordable[i];
  }
  return affordable[affordable.length - 1];
}

/** Разложить десант по лодкам с учётом мест (крупные враги — в отдельных лодках). */
export function splitIntoBoats(cargo: EnemyType[]): EnemyType[][] {
  const sorted = [...cargo].sort((a, b) => seats(b) - seats(a));
  const boats: { list: EnemyType[]; used: number }[] = [];
  for (const t of sorted) {
    const s = Math.min(seats(t), WAVES.boatSeats);
    let boat = boats.find((x) => x.used + s <= WAVES.boatSeats);
    if (!boat) { boat = { list: [], used: 0 }; boats.push(boat); }
    boat.list.push(t);
    boat.used += s;
  }
  return boats.map((x) => x.list);
}

export interface WavePlan {
  boats: BoatPlan[];
}

/** Состав волн острова. difficulty: 0 — первый остров, растёт по ходу кампании. */
export function planWaves(difficulty: number, isFinal: boolean, landings: LandingPoint[], rng: Rng, extraWave = false): WavePlan[] {
  const count = Math.min(WAVES.countMax, WAVES.countBase + Math.floor(difficulty * WAVES.countPerDifficulty)) + (isFinal ? 1 : 0) + (extraWave ? 1 : 0);
  const types = (Object.keys(ENEMY_UNLOCK) as EnemyType[]).filter((t) => ENEMY_UNLOCK[t] <= difficulty);
  const trollWave = difficulty >= ENEMY_UNLOCK.troll ? count - (isFinal ? 2 : 1) : -1;
  const waves: WavePlan[] = [];
  for (let w = 0; w < count; w++) {
    const boatCount = Math.max(1, Math.min(1 + Math.floor(difficulty * WAVES.boatsPerDifficulty + w * WAVES.boatsPerWave),
      WAVES.boatsMax, landings.length));
    const order = landings.map((_, i) => i);
    if (difficulty > 0) order.sort(() => rng() - 0.5);
    const boats: BoatPlan[] = [];
    const waveBudget = (WAVES.waveBudgetBase + difficulty * WAVES.waveBudgetPerDifficulty + w * WAVES.waveBudgetPerWave)
      * (isFinal ? WAVES.finalBudgetMult : 1);
    for (let b = 0; b < boatCount; b++) {
      let budget = waveBudget / boatCount;
      const cargo: EnemyType[] = [];
      if (isFinal && w === count - 1 && b === 0) {
        cargo.push('minotaur');
        budget = Math.max(2, budget - ENEMY_COST.minotaur * 0.5);
      } else if (w === trollWave && b === 0) {
        // На сложных островах один громила обязательно придёт; в финале — перед волной минотавра.
        cargo.push('troll');
        budget = Math.max(1, budget - ENEMY_COST.troll);
      }
      // бюджет лодки делится по ролям; роль, которой на острове ещё нет, отдаёт долю основе
      const first = w === 0 && difficulty === 0;
      const roles = (Object.keys(ROLES) as (keyof typeof ROLES)[]).map((role) => ({
        pool: first ? (role === 'base' ? (['goblin_torch'] as EnemyType[]) : []) : ROLES[role].filter((t) => types.includes(t)),
        share: WAVES.roleShare[role] as number,
      }));
      let spare = 0;
      for (const r of roles.slice(1)) if (!r.pool.length) { spare += r.share; r.share = 0; }
      roles[0].share += spare;
      let left = budget;
      for (const r of [...roles.slice(1), roles[0]]) {
        // угроза и поддержка сначала (им нужен цельный бюджет на дорогой тип), основа — на остаток
        let b = r === roles[0] ? left : budget * r.share;
        while (cargo.length < WAVES.boatCapacity) {
          const pick = pickType(rng, r.pool, b, cargo);
          if (!pick) break;
          cargo.push(pick);
          b -= ENEMY_COST[pick];
          left -= ENEMY_COST[pick];
        }
      }
      const landing = order[b % order.length];
      if (cargo.length) splitIntoBoats(cargo).forEach((part, i) => boats.push({ landing, cargo: part, slot: i }));
    }
    waves.push({ boats });
  }
  return waves;
}

/** Путь лодки по воде от края карты до причала, только по вертикали и горизонтали. */
export function waterPath(grid: IslandGrid, landing: LandingPoint): Point[] {
  const water = (x: number, y: number) => grid.inBounds(x, y) && grid.isWater(x, y) && grid.cliffLevel(x, y) === 0 && !grid.stairAt(x, y);
  const dockX = landing.x + landing.dx, dockY = landing.y + landing.dy;
  const start = grid.idx(dockX, dockY);
  const parent = new Int32Array(grid.w * grid.h).fill(-2);
  parent[start] = -1;
  const queue = [start];
  let border = -1;
  while (queue.length) {
    const c = queue.shift()!;
    const cx = c % grid.w, cy = Math.floor(c / grid.w);
    if (cx === 0 || cy === 0 || cx === grid.w - 1 || cy === grid.h - 1) { border = c; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!water(nx, ny)) continue;
      const n = grid.idx(nx, ny);
      if (parent[n] !== -2) continue;
      parent[n] = c;
      queue.push(n);
    }
  }
  const center = (i: number): Point => ({ x: ((i % grid.w) + 0.5) * TILE, y: (Math.floor(i / grid.w) + 0.5) * TILE });
  const cells: number[] = [];
  for (let c = border >= 0 ? border : start; c >= 0; c = parent[c]) cells.push(c);
  const pts = cells.map(center);
  const first = pts[0];
  const bx = border >= 0 ? border % grid.w : dockX, by = border >= 0 ? Math.floor(border / grid.w) : dockY;
  const ox = bx === 0 ? -1 : bx === grid.w - 1 ? 1 : 0;
  const oy = by === 0 ? -1 : by === grid.h - 1 ? 1 : 0;
  const off = (ox || oy) ? { x: ox, y: oy } : { x: landing.dx, y: landing.dy };
  pts.unshift({ x: first.x + off.x * WAVES.spawnOffshore * TILE, y: first.y + off.y * WAVES.spawnOffshore * TILE });
  const dock = pts[pts.length - 1];
  pts.push({ x: dock.x - landing.dx * TILE * 0.3, y: dock.y - landing.dy * TILE * 0.3 });
  return pts;
}

