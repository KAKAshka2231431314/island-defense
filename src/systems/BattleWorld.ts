import Phaser from 'phaser';
import { ABILITY, AI, FEEL, HOUSE, ITEMS, MOVE, PLAYER_UNITS, PROJECTILE_HIT, PROJECTILES, SQUAD, type UnitStats } from '../data/balance';
import { WEATHER, type WeatherKind } from '../data/conditions';
import type { Boat } from '../entities/Boat';
import { DEPTH, TILE } from '../data/config';
import { barOffsetFor, bodyRadius, SQUAD_COLORS, spriteKeyFor, type UnitType } from '../data/units';
import { House } from '../entities/House';
import { Projectile } from '../entities/Projectile';
import { Squad, type SquadDef } from '../entities/Squad';
import { Unit, type DeathCause, type Point, type Team } from '../entities/Unit';
import type { HouseSpot, IslandData } from '../mapgen/IslandGenerator';
import { IslandGrid, type StairDef } from '../mapgen/IslandGrid';
import { packSquares, zonesFromSquares, type Zone, type ZoneMap } from '../mapgen/zones';
import { applyItem, applyItemToUnit } from './Abilities';
import { thinkEnemy } from './ai/EnemyAI';
import { thinkPlayer } from './ai/PlayerAI';
import { depthAt } from './depth';
import { ZoneMarks } from './ZoneMarks';
import { Effects } from './Effects';
import { FlowFields } from './FlowField';
import { sfx } from './Sound';

/**
 * Мир боя: юниты, отряды, дома, снаряды. Движение по сетке с перепадами высот,
 * отбрасывание (падение с уступов, утопление), урон и строй отрядов.
 * Всё время — игровое (уже умноженное на замедление/ускорение).
 */
/** Нормальный разброс (≈ σ = 1): сумма трёх равномерных. */
function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 2;
}

export class BattleWorld {
  readonly units: Unit[] = [];
  readonly squads: Squad[] = [];
  readonly houses: House[] = [];
  readonly projectiles: Projectile[] = [];
  /** лодки волн (ставит WaveManager): по десанту в них стреляют лучники */
  boats: Boat[] = [];
  readonly flow: FlowFields;
  readonly fx: Effects;
  /** события: squadLost(squad), houseBurned(house), unitKilled(unit) */
  readonly events = new Phaser.Events.EventEmitter();
  selected: Squad | null = null;
  hovered: Squad | null = null;
  time = 0;
  private reconciling = false;
  /** время последнего урона или поджога (для обнаружения «зависшего» боя) */
  lastActivity = 0;
  private readonly timers: { left: number; fn: () => void }[] = [];
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly rings: Phaser.GameObjects.Graphics;
  /** подсветка квадратов на земле: выбранный отряд, отряд под курсором, куда пойдёт отряд, сетка зон */
  private readonly marks: ZoneMarks;
  /** предпросмотр под курсором для выбранного отряда: зона и места строя */
  preview: { zone: Zone | null; slots: Point[]; ability?: boolean; valid?: boolean } | null = null;
  /** зоны острова и какой отряд где стоит (одна зона — один отряд) */
  readonly zoneMap: ZoneMap;
  private readonly zoneOccupant = new Map<number, Squad>();
  /** счётчики для проверки баланса (матчапы, тест щитов): стрелы игрока не в упор — попали / отбиты щитом;
   *  удары ближнего боя по щитоносцу (кроме тяжёлых и пока он не бьёт сам) — всего / отбито */
  readonly stats = { arrowHits: 0, arrowBlocked: 0, meleeOnShield: 0, meleeBlocked: 0 };
  /** подходы к лестницам: клетка ступеней, клетки у её подножия и верхняя клетка выхода → лестница */
  private readonly stairApproach = new Map<number, StairDef>();

  constructor(readonly scene: Phaser.Scene, readonly island: IslandData, houseSprites: Map<HouseSpot, Phaser.GameObjects.Image>, readonly weather: WeatherKind = 'clear') {
    this.flow = new FlowFields(island.grid);
    // зоны — квадраты 2×2 из генератора (в одной зоне стоит один отряд, как в Bad North)
    this.zoneMap = zonesFromSquares(island.grid, island.squares ?? packSquares(island.grid));
    this.fx = new Effects(scene, (x, y) => depthAt(island.grid, x, y));
    this.bars = scene.add.graphics().setDepth(DEPTH.ui - 20);
    this.rings = scene.add.graphics().setDepth(DEPTH.ui - 26);
    this.marks = new ZoneMarks(scene);
    for (const [spot, img] of houseSprites) this.houses.push(new House(scene, spot, img));
    const g = island.grid;
    for (const s of g.stairs) {
      for (const [sx, sy] of IslandGrid.stairCellsOf(s)) {
        this.stairApproach.set(g.idx(sx, sy), s);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = sx + dx, ny = sy + dy;
          if (g.inBounds(nx, ny) && !g.stairAt(nx, ny) && g.canStep(sx, sy, nx, ny) && !this.stairApproach.has(g.idx(nx, ny))) {
            this.stairApproach.set(g.idx(nx, ny), s);
          }
        }
      }
    }
  }

  get grid(): IslandGrid {
    return this.island.grid;
  }

  // ------------------------------------------------------------------ сетка

  cellIdx(x: number, y: number): number {
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    return this.grid.inBounds(cx, cy) ? this.grid.idx(cx, cy) : -1;
  }

  cellCenter(i: number): Point {
    return { x: ((i % this.grid.w) + 0.5) * TILE, y: (Math.floor(i / this.grid.w) + 0.5) * TILE };
  }

  /** Можно ли пешком перейти из точки a в соседнюю точку b, не задевая дома и деревья телом. */
  canStepPx(ax: number, ay: number, bx: number, by: number, radius = 0): boolean {
    const g = this.grid;
    const acx = Math.floor(ax / TILE), acy = Math.floor(ay / TILE);
    const bcx = Math.floor(bx / TILE), bcy = Math.floor(by / TILE);
    if (acx === bcx && acy === bcy && !this.overlapsBlocked(bx, by, radius)) return true;
    if (!g.isWalkable(bcx, bcy)) return false;
    if (!g.isWalkable(acx, acy)) return true; // выбраться из «плохой» клетки можно всегда
    if (this.overlapsBlocked(bx, by, radius)) return false;
    if (Math.abs(acx - bcx) > 1 || Math.abs(acy - bcy) > 1) return false;
    return g.canStep(acx, acy, bcx, bcy);
  }

  /** Тело радиуса radius не должно пересекать заблокированную клетку (дом, дерево, камень). */
  private overlapsBlocked(x: number, y: number, radius: number): boolean {
    if (radius <= 0) return false;
    const g = this.grid;
    const x0 = Math.floor((x - radius) / TILE), x1 = Math.floor((x + radius) / TILE);
    const y0 = Math.floor((y - radius) / TILE), y1 = Math.floor((y + radius) / TILE);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (g.isBlocked(cx, cy)) return true;
    return false;
  }

  /** Прямая проходимость по отрезку (без обходов), с запасом на радиус бойца. */
  clearLine(ax: number, ay: number, bx: number, by: number, radius = 0): boolean {
    const g = this.grid;
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 16);
    let pcx = Math.floor(ax / TILE), pcy = Math.floor(ay / TILE);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
      if (cx === pcx && cy === pcy) continue;
      if (!g.isWalkable(cx, cy)) return false;
      if (g.isWalkable(pcx, pcy) && !g.canStep(pcx, pcy, cx, cy)) return false;
      if (this.overlapsBlocked(px, py, radius * 0.5)) return false;
      const side = g.stairAt(cx, cy)?.def.side;
      if (side === 'left' || side === 'right') return false;
      pcx = cx;
      pcy = cy;
    }
    return true;
  }

  /** Ближайшая к (x, y) проходимая точка, достижимая из from (если задано). */
  nearestWalkable(x: number, y: number, from?: Point): Point | null {
    const g = this.grid;
    const ccx = Math.floor(x / TILE), ccy = Math.floor(y / TILE);
    const fromIdx = from ? this.cellIdx(from.x, from.y) : -1;
    const ok = (cx: number, cy: number) => g.isWalkable(cx, cy)
      && (fromIdx < 0 || this.flow.distance(fromIdx, g.idx(cx, cy)) < Infinity);
    if (ok(ccx, ccy)) return { x, y };
    let best: Point | null = null, bestD = Infinity;
    for (let r = 1; r <= 6 && !best; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = ccx + dx, cy = ccy + dy;
          if (!ok(cx, cy)) continue;
          const p = { x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE };
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) { bestD = d; best = p; }
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ движение

  /** Шаг юнита к navGoal: напрямую, если путь свободен, иначе по полю потоков. */
  steer(u: Unit, dt: number): void {
    const goal = u.navGoal!;
    const d = u.dist(goal);
    if (d < MOVE.arriveDist) {
      u.navGoal = null;
      return;
    }
    const radius = bodyRadius(u.type) * 0.75;
    u.losLeft -= dt;
    if (u.losLeft <= 0) {
      u.losLeft = MOVE.losRecheck;
      u.losDirect = this.clearLine(u.x, u.y, goal.x, goal.y, radius);
    }
    let wx = goal.x, wy = goal.y;
    const fromCell = this.cellIdx(u.x, u.y);
    const inBadCell = fromCell < 0 || !this.grid.isWalkable(fromCell % this.grid.w, Math.floor(fromCell / this.grid.w));
    if (!u.losDirect && !inBadCell) {
      const from = fromCell, to = this.cellIdx(goal.x, goal.y);
      if (from >= 0 && to >= 0 && from !== to) {
        const next = this.flow.next(from, to);
        if (next < 0) {
          u.navGoal = null; // недостижимо
          return;
        }
        const c = this.cellCenter(next);
        wx = c.x;
        wy = c.y;
      }
    }
    const len = Math.hypot(wx - u.x, wy - u.y);
    if (len < 0.01) return;
    const step = Math.min(len, u.stats.speed * u.speedMult * dt);
    const dx = (wx - u.x) / len, dy = (wy - u.y) / len;
    if (this.tryMove(u, dx * step, dy * step)) {
      u.moving = true;
      if (Math.abs(dx) > 0.15) u.facing = Math.sign(dx);
      // взгляд — по ходу движения, если нет цели и щит не поднят (поднятый щит остаётся повёрнут к угрозе)
      if (!u.target && !u.guarding) { u.aimX = dx; u.aimY = dy; }
    } else {
      u.losLeft = 0; // упёрся — перепроверить путь
    }
  }

  tryMove(u: Unit, dx: number, dy: number): boolean {
    const nx = u.x + dx, ny = u.y + dy;
    const radius = bodyRadius(u.type) * 0.75;
    if (this.canStepPx(u.x, u.y, nx, ny, radius)) { u.x = nx; u.y = ny; return true; }
    if (dx && this.canStepPx(u.x, u.y, nx, u.y, radius)) { u.x = nx; return true; }
    if (dy && this.canStepPx(u.x, u.y, u.x, ny, radius)) { u.y = ny; return true; }
    return false;
  }

  /** Смещение от удара: можно слететь с уступа или в воду. */
  knockMove(u: Unit, dx: number, dy: number): void {
    if (this.tryKnock(u, u.x + dx, u.y + dy)) return;
    if (dx && this.tryKnock(u, u.x + dx, u.y)) { u.kvy = 0; return; }
    if (dy && this.tryKnock(u, u.x, u.y + dy)) { u.kvx = 0; return; }
    u.kvx = u.kvy = 0;
  }

  private tryKnock(u: Unit, nx: number, ny: number): boolean {
    const g = this.grid;
    const ax = Math.floor(u.x / TILE), ay = Math.floor(u.y / TILE);
    const bx = Math.floor(nx / TILE), by = Math.floor(ny / TILE);
    if (ax === bx && ay === by) { u.x = nx; u.y = ny; return true; }
    const isWater = (cx: number, cy: number) => !g.inBounds(cx, cy) || (g.isWater(cx, cy) && g.cliffLevel(cx, cy) === 0 && !g.stairAt(cx, cy));
    // слабый толчок не сбрасывает за край — юнит упирается
    const guarded = u.isCommander && !!u.squad && u.squad.aliveUnits.some((s) => !s.isCommander);
    const strong = u.knockSpeed >= MOVE.edgeKnockMin && !guarded;
    if (isWater(bx, by)) {
      if (!strong) return false;
      u.x = nx; u.y = ny;
      this.kill(u, 'drowned');
      return true;
    }
    if (g.isWalkable(ax, ay) ? g.canStep(ax, ay, bx, by) : g.isWalkable(bx, by)) { u.x = nx; u.y = ny; return true; }
    const aMin = g.walkRange(ax, ay)[0];
    const cliff = g.cliffLevel(bx, by);
    if (cliff > 0) {
      if (aMin < cliff || !strong) return false; // упёрся в скалу снизу или удар слабый
      // слетел с плато через скалу: приземляется под ней
      let fy = by + 1;
      while (g.cliffLevel(bx, fy) > 0) fy++;
      const landY = (fy + 0.3) * TILE;
      if (isWater(bx, fy)) {
        u.fallOffset = u.y - landY;
        u.x = nx; u.y = landY;
        this.kill(u, 'drowned');
        return true;
      }
      if (!g.isWalkable(bx, fy)) return false;
      u.fallOffset = u.y - landY;
      u.x = nx; u.y = landY;
      this.fall(u);
      return true;
    }
    if (strong && g.isWalkable(bx, by) && g.walkRange(bx, by)[1] < aMin) {
      u.fallOffset = -TILE * 0.4;
      u.x = nx; u.y = ny;
      this.fall(u);
      return true;
    }
    return false;
  }

  private fall(u: Unit): void {
    this.fx.dust(u.x, u.y);
    u.stunLeft = Math.max(u.stunLeft, 0.4);
    this.damage(u, MOVE.fallDamage, u, 0, null);
  }

  /** Расталкивание юнитов, чтобы не стояли друг в друге. */
  /** Боец стоит на своём месте в строю (не идёт, не дерётся). */
  private settled(u: Unit): boolean {
    if (u.navGoal || u.attacking || u.target || u.knockSpeed > 1) return false;
    const s = u.squad?.slots.get(u);
    return !!s && u.dist(s) < 12;
  }

  private separate(dt: number): void {
    const list = this.units.filter((u) => u.alive && !u.hidden);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const ra = bodyRadius(a.type);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const r = ra + bodyRadius(b.type) + (MOVE.separationRadius - 24);
        let dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2);
        if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
        const push = ((r - d) / r) * MOVE.separationStrength * dt;
        const nx = dx / d, ny = dy / d;
        const ma = ra * ra, mb = bodyRadius(b.type) ** 2;
        const wa = mb / (ma + mb), wb = ma / (ma + mb);
        // бойцы одного отряда, уже стоящие на своих местах, друг друга не толкают (строй плотный, как в Bad North);
        // идущий к своему месту проходит сквозь стоящих товарищей, не сбивая строй и не упираясь в него
        if (a.squad && a.squad === b.squad && (this.settled(a) || this.settled(b))) continue;
        this.tryMove(a, -nx * push * wa * 2, -ny * push * wa * 2);
        this.tryMove(b, nx * push * wb * 2, ny * push * wb * 2);
      }
    }
  }

  // ------------------------------------------------------------------ спавн

  spawnUnit(team: Team, type: UnitType, stats: UnitStats, x: number, y: number, commander = false): Unit {
    const u = new Unit(this, team, type, stats, x, y, spriteKeyFor(type, team, commander));
    u.isCommander = commander;
    this.units.push(u);
    return u;
  }

  /**
   * Строй — квадрат вокруг точки, первым идёт центр (место командира).
   * Места, попавшие в воду, скалу или на другой уровень, переносятся на ближайшие допустимые клетки.
   */
  formationSlots(goal: Point, count: number): Point[] {
    const start = this.cellIdx(goal.x, goal.y);
    if (start < 0) return Array.from({ length: count }, () => ({ ...goal }));
    const cols = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / cols);
    const square: Point[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        square.push({ x: goal.x + (c - (cols - 1) / 2) * SQUAD.spacingX, y: goal.y + (r - (rows - 1) / 2) * SQUAD.spacingY });
      }
    }
    square.sort((a, b) => Math.hypot(a.x - goal.x, a.y - goal.y) - Math.hypot(b.x - goal.x, b.y - goal.y));
    const wanted = square.slice(0, count);
    const ok = (p: Point) => {
      const i = this.cellIdx(p.x, p.y);
      if (i < 0 || !this.grid.isWalkable(i % this.grid.w, Math.floor(i / this.grid.w))) return false;
      return this.flow.distance(i, start) <= SQUAD.formationMaxDetour;
    };
    const pool = this.bfsSlots(goal, count * 2);
    const used = new Set<number>();
    return wanted.map((p) => {
      if (ok(p)) return p;
      let bi = -1, bd = Infinity;
      pool.forEach((q, i) => {
        if (used.has(i)) return;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) { bd = d; bi = i; }
      });
      if (bi < 0) return { ...goal };
      used.add(bi);
      return pool[bi];
    });
  }

  /** Запасные места строя: клетки по обходу от цели (только достижимые), по SQUAD.perCell мест в клетке. */
  private bfsSlots(goal: Point, count: number): Point[] {
    const g = this.grid;
    const start = this.cellIdx(goal.x, goal.y);
    const out: Point[] = [];
    if (start < 0) return Array.from({ length: count }, () => ({ ...goal }));
    const o = SQUAD.slotOffset;
    const pattern: [number, number][] = SQUAD.perCell >= 4
      ? [[-o, -o * 0.7], [o, -o * 0.7], [-o, o * 0.7], [o, o * 0.7]]
      : ([[-o, -o * 0.6], [o, -o * 0.6], [0, o * 0.8]] as [number, number][]).slice(0, SQUAD.perCell);
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length && out.length < count) {
      const c = queue.shift()!;
      const cx = c % g.w, cy = Math.floor(c / g.w);
      const base = c === start ? goal : this.cellCenter(c);
      for (const [ox, oy] of pattern) {
        if (out.length >= count) break;
        out.push({
          x: Phaser.Math.Clamp(base.x + ox, cx * TILE + 8, (cx + 1) * TILE - 8),
          y: Phaser.Math.Clamp(base.y + oy, cy * TILE + 8, (cy + 1) * TILE - 8),
        });
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!g.inBounds(nx, ny)) continue;
        const n = g.idx(nx, ny);
        if (seen.has(n) || !g.canStep(cx, cy, nx, ny)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    while (out.length < count) out.push({ ...goal });
    return out;
  }

  spawnSquad(def: SquadDef, index: number, at: Point): Squad {
    const sq = new Squad(def, index);
    const base = PLAYER_UNITS[def.cls];
    const lvl = Math.min(def.level, SQUAD.levelHpMult.length - 1);
    const hpM = SQUAD.levelHpMult[lvl], dmgM = SQUAD.levelDamageMult[lvl];
    const n = sq.soldiersMax;
    const zone = this.pickZone(at.x, at.y, at, sq);
    this.occupy(sq, zone);
    if (zone) at = { x: zone.cx, y: zone.cy };
    const slots = zone ? this.zoneSlots(zone, n + 1) : this.formationSlots(at, n + 1);
    for (let i = 0; i <= n; i++) {
      const commander = i === 0;
      const stats = {
        ...base,
        hp: Math.round(base.hp * hpM * (commander ? SQUAD.commanderHpMult : 1)),
        knockResist: commander ? Math.min(0.9, base.knockResist + SQUAD.commanderKnockResist) : base.knockResist,
      };
      const u = this.spawnUnit('player', def.cls, stats, slots[i].x, slots[i].y, commander);
      u.damageMult = dmgM * (commander ? SQUAD.commanderDamageMult : 1);
      u.squad = sq;
      sq.units.push(u);
      sq.slots.set(u, slots[i]);
      if (commander) sq.commander = u;
    }
    applyItem(sq);
    // общее здоровье отряда: командир + солдаты (щит-предмет увеличивает весь запас)
    const itemHp = def.item === 'shield' ? ITEMS.shield.hpMult : 1;
    sq.soldierHp = Math.round(base.hp * hpM * itemHp);
    sq.cmdHp = Math.round(sq.soldierHp * SQUAD.commanderHpMult);
    sq.maxHp = sq.cmdHp + n * sq.soldierHp;
    sq.hp = sq.maxHp;
    sq.anchor = { ...at };
    this.squads.push(sq);
    return sq;
  }

  /** Добавить солдата в отряд (восстановление в доме). */
  addSoldier(sq: Squad, at: Point): Unit {
    const proto = sq.units.find((u) => !u.isCommander) ?? sq.commander;
    const stats = { ...proto.stats, hp: sq.commander.stats.hp / SQUAD.commanderHpMult, knockResist: PLAYER_UNITS[sq.cls].knockResist };
    const u = this.spawnUnit('player', sq.cls, stats, at.x, at.y, false);
    u.damageMult = proto.isCommander ? proto.damageMult / SQUAD.commanderDamageMult : proto.damageMult;
    applyItemToUnit(sq, u);
    u.squad = sq;
    sq.units.push(u);
    sq.slots.set(u, { ...at });
    sq.hp = Math.min(sq.maxHp, sq.hp + sq.soldierHp);
    return u;
  }

  // ------------------------------------------------------------------ приказы

  /** Прямоугольник, охватывающий видимых бойцов отряда (для рамки и клика). */
  squadBounds(sq: Squad): { x0: number; y0: number; x1: number; y1: number } | null {
    const us = sq.aliveUnits.filter((u) => !u.hidden);
    if (!us.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const u of us) {
      x0 = Math.min(x0, u.x - 20);
      x1 = Math.max(x1, u.x + 20);
      y0 = Math.min(y0, u.y + u.fallOffset + u.climbOffset - 52);
      y1 = Math.max(y1, u.y + 10);
    }
    return { x0, y0, x1, y1 };
  }

  /** Отряд под точкой: клик в любом месте его рамки (если рамки пересекаются — ближайший центр). */
  squadAt(x: number, y: number): Squad | null {
    let best: Squad | null = null, bestD = Infinity;
    for (const sq of this.squads) {
      if (sq.lost) continue;
      const b = this.squadBounds(sq);
      if (!b || x < b.x0 - 6 || x > b.x1 + 6 || y < b.y0 - 6 || y > b.y1 + 6) continue;
      const d = Math.hypot((b.x0 + b.x1) / 2 - x, (b.y0 + b.y1) / 2 - y);
      if (d < bestD) { bestD = d; best = sq; }
    }
    return best;
  }

  houseAt(x: number, y: number): House | null {
    return this.houses.find((h) => h.state !== 'destroyed' && h.contains(x, y)) ?? null;
  }

  /** Приказ отряду идти в точку. Возвращает точку назначения (или null, если туда не пройти). */
  orderSquad(sq: Squad, x: number, y: number): Point | null {
    if (sq.lost) return null;
    if (sq.inHouse) this.exitHouse(sq);
    sq.entering = null;
    const alive = sq.aliveUnits;
    const lead = sq.commander.alive ? sq.commander : alive[0];
    if (!lead) return null;
    const requested = this.zoneAt(x, y);
    const other = requested ? this.zoneOccupiedBy(requested) : null;
    if (requested && other && other !== sq) return this.swapSquads(sq, other, requested);
    const zone = this.pickZone(x, y, lead, sq);
    if (!zone) return null;
    this.occupy(sq, zone);
    const goal = { x: zone.cx, y: zone.cy };
    this.assignSlots(sq, goal, this.zoneSlots(zone, alive.length));
    return goal;
  }

  private swapSquads(sq: Squad, other: Squad, target: Zone): Point | null {
    const source = sq.zone;
    const a = sq.commander.alive ? sq.commander : sq.aliveUnits[0];
    const b = other.commander.alive ? other.commander : other.aliveUnits[0];
    if (!source || !a || !b || other.lost || other.inHouse) return null;
    if (this.flow.distance(this.cellIdx(a.x, a.y), this.cellIdx(target.cx, target.cy)) === Infinity
      || this.flow.distance(this.cellIdx(b.x, b.y), this.cellIdx(source.cx, source.cy)) === Infinity) return null;
    this.occupy(sq, null);
    this.occupy(other, null);
    this.occupy(sq, target);
    this.occupy(other, source);
    other.entering = null;
    this.assignSlots(sq, { x: target.cx, y: target.cy }, this.zoneSlots(target, sq.aliveUnits.length));
    this.assignSlots(other, { x: source.cx, y: source.cy }, this.zoneSlots(source, other.aliveUnits.length));
    return { x: target.cx, y: target.cy };
  }

  // ------------------------------------------------------------------ зоны

  zoneAt(x: number, y: number): Zone | null {
    const i = this.cellIdx(x, y);
    const z = i >= 0 ? this.zoneMap.zoneOfCell[i] : -1;
    return z >= 0 ? this.zoneMap.zones[z] : null;
  }

  zoneOccupiedBy(z: Zone): Squad | null {
    const o = this.zoneOccupant.get(z.id);
    return o && !o.lost ? o : null;
  }

  /** Зона для приказа: под точкой; иначе ближайшая по реальному маршруту, а не просто по прямой на экране. */
  pickZone(x: number, y: number, from: Point, sq: Squad | null, allowSwap = false): Zone | null {
    const start = this.cellIdx(from.x, from.y);
    const field = start >= 0 ? this.flow.field(start) : null;
    const pathDist = (z: Zone) => field ? field[z.cells[0]] : Infinity;
    const ok = (z: Zone, swapping = false) => {
      const o = this.zoneOccupiedBy(z);
      if (o && o !== sq && !(swapping && sq?.zone)) return false;
      return start < 0 || Number.isFinite(pathDist(z));
    };
    const under = this.zoneAt(x, y);
    if (under && ok(under, allowSwap)) return under;
    let best: Zone | null = null, bestD = Infinity;
    for (const z of this.zoneMap.zones) {
      const route = pathDist(z);
      if (!Number.isFinite(route)) continue;
      const d = start >= 0 ? route * TILE + Math.hypot(z.cx - x, z.cy - y) * 0.2 : Math.hypot(z.cx - x, z.cy - y);
      if (d < bestD && ok(z)) { bestD = d; best = z; }
    }
    return best;
  }

  /** Занять зону отрядом (прежняя освобождается). */
  occupy(sq: Squad, z: Zone | null): void {
    if (sq.zone && this.zoneOccupant.get(sq.zone.id) === sq) this.zoneOccupant.delete(sq.zone.id);
    sq.zone = z;
    if (z) this.zoneOccupant.set(z.id, sq);
  }

  /** Квадратный строй внутри зоны (шаг ужимается под её размер), первым — центр для командира. */
  zoneSlots(z: Zone, n: number): Point[] {
    const full = z.cells.length === Math.round(((z.x1 - z.x0) / TILE) * ((z.y1 - z.y0) / TILE));
    if (!full) return this.spreadSlots(z, n);
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const w = z.x1 - z.x0, h = z.y1 - z.y0;
    const sx = cols > 1 ? Math.min(SQUAD.spacingX, (w - 30) / (cols - 1)) : 0;
    const sy = rows > 1 ? Math.min(SQUAD.spacingY, (h - 22) / (rows - 1)) : 0;
    const cx = z.cx, cy = z.cy + 4;
    const pts: Point[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pts.push({ x: cx + (c - (cols - 1) / 2) * sx, y: cy + (r - (rows - 1) / 2) * sy });
    pts.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    // место вне зоны (неполная зона у скалы) — к центру ближайшей клетки зоны
    return pts.slice(0, n).map((p) => {
      const i = this.cellIdx(p.x, p.y);
      if (i >= 0 && this.zoneMap.zoneOfCell[i] === z.id) return p;
      let best = z.cells[0], bd = Infinity;
      for (const c of z.cells) {
        const cc = this.cellCenter(c);
        const d = Math.hypot(cc.x - p.x, cc.y - p.y);
        if (d < bd) { bd = d; best = c; }
      }
      const cc = this.cellCenter(best);
      return { x: cc.x + (Math.random() - 0.5) * 24, y: cc.y + (Math.random() - 0.5) * 18 };
    });
  }

  /** Неполная зона (у скалы, дерева, берега): бойцы распределяются по её клеткам поровну, сеткой внутри клетки. */
  private spreadSlots(z: Zone, n: number): Point[] {
    const cells = [...z.cells].sort((a, b) => {
      const ca = this.cellCenter(a), cb = this.cellCenter(b);
      return Math.hypot(ca.x - z.cx, ca.y - z.cy) - Math.hypot(cb.x - z.cx, cb.y - z.cy);
    });
    const per = Math.ceil(n / cells.length);
    const cols = Math.ceil(Math.sqrt(per)), rows = Math.ceil(per / cols);
    const sx = cols > 1 ? Math.min(SQUAD.spacingX, (TILE - 18) / (cols - 1)) : 0;
    const sy = rows > 1 ? Math.min(SQUAD.spacingY, (TILE - 14) / (rows - 1)) : 0;
    const out: Point[] = [];
    for (let k = 0; k < per && out.length < n; k++) {
      for (const c of cells) {
        if (out.length >= n) break;
        const cc = this.cellCenter(c);
        const col = k % cols, row = Math.floor(k / cols);
        out.push({ x: cc.x + (col - (cols - 1) / 2) * sx, y: cc.y + 4 + (row - (rows - 1) / 2) * sy });
      }
    }
    // первым — место у центра (командир)
    out.sort((a, b) => Math.hypot(a.x - z.cx, a.y - z.cy) - Math.hypot(b.x - z.cx, b.y - z.cy));
    return out;
  }

  private assignSlots(sq: Squad, goal: Point, slots?: Point[]): void {
    const alive = sq.aliveUnits;
    const free = slots ? [...slots] : this.formationSlots(goal, alive.length);
    sq.slots.clear();
    // командир — в центр строя, остальные — к ближайшим свободным местам
    const order = [...alive].sort((a, b) => (a.isCommander ? -1 : b.isCommander ? 1 : a.dist(goal) - b.dist(goal)));
    for (const u of order) {
      let bi = 0, bd = Infinity;
      free.forEach((s, i) => {
        const d = u.isCommander ? i : u.dist(s);
        if (d < bd) { bd = d; bi = i; }
      });
      const slot = free.splice(bi, 1)[0];
      sq.slots.set(u, slot);
      u.ordered = true;
      u.cancelAttack();
      u.target = null;
      u.guarding = false;
      u.navGoal = { ...slot };
    }
    sq.anchor = { ...goal };
  }

  /** Приказ войти в дом: отряд идёт к двери и прячется внутри, где восстанавливает солдат. */
  orderEnterHouse(sq: Squad, house: House): boolean {
    if (sq.lost || house.state !== 'intact') return false;
    if (house.occupant && house.occupant !== sq) return false;
    if (sq.inHouse === house) return true;
    if (sq.inHouse) this.exitHouse(sq);
    const lead = sq.commander.alive ? sq.commander : sq.aliveUnits[0];
    if (!lead || this.flow.distance(this.cellIdx(lead.x, lead.y), this.cellIdx(house.door.x, house.door.y)) === Infinity) return false;
    this.occupy(sq, null);
    this.assignSlots(sq, house.door);
    // все идут прямо к двери и скрываются внутри по одному
    for (const u of sq.aliveUnits) {
      const p = { x: house.door.x + (Math.random() - 0.5) * 20, y: house.door.y + Math.random() * 10 };
      sq.slots.set(u, p);
      u.navGoal = { ...p };
    }
    sq.entering = house;
    return true;
  }

  exitHouse(sq: Squad): void {
    const house = sq.inHouse;
    sq.inHouse = null;
    if (house && house.occupant === sq) house.occupant = null;
    const units = sq.aliveUnits;
    const at = house?.door ?? sq.anchor;
    const zone = this.pickZone(at.x, at.y + TILE * 0.6, at, sq);
    this.occupy(sq, zone);
    const slots = zone ? this.zoneSlots(zone, units.length) : this.formationSlots(at, units.length);
    units.forEach((u, i) => {
      u.hidden = false;
      u.x = slots[i].x;
      u.y = slots[i].y;
      u.navGoal = null;
      u.ordered = false;
      sq.slots.set(u, slots[i]);
      u.syncView();
    });
    sq.anchor = zone ? { x: zone.cx, y: zone.cy } : { ...at };
  }

  // ------------------------------------------------------------------ бой

/**
   * Может ли u бить t в ближнем бою: только на одном уровне (или когда кто-то из них на ступенях —
   * клетка лестницы относится к обоим уровням). С обрыва вниз и снизу вверх мечом не достать.
   */
  canMelee(u: Point, t: Point): boolean {
    const g = this.grid;
    const [a0, a1] = g.walkRange(Math.floor(u.x / TILE), Math.floor(u.y / TILE));
    const [b0, b1] = g.walkRange(Math.floor(t.x / TILE), Math.floor(t.y / TILE));
    return a1 >= b0 && b1 >= a0;
  }

  /** Дальность атаки u по цели t: стрелки на возвышенности бьют дальше; ближний бой через перепад высот — никак (−1). */
  rangeTo(u: Unit, t: Unit): number {
    const r = u.stats.range;
    if (!u.stats.projectile) {
      if (this.holdsClimb(u, t)) return r * (1 + AI.pikeBraceReach + AI.pikeStairReach);
      if (!this.canMelee(u, t)) return -1;
      return u.guarding && u.type === 'pike' ? r * (1 + AI.pikeBraceReach) : r;
    }
    const g = this.grid;
    const lu = g.walkRange(Math.floor(u.x / TILE), Math.floor(u.y / TILE))[1];
    const lt = g.walkRange(Math.floor(t.x / TILE), Math.floor(t.y / TILE))[1];
    return (lu > lt ? r * (1 + AI.highGroundRangeBonus) : r) * WEATHER[this.weather].rangeMult;
  }

  /** Ближайший враг для u: в радиусе aggro от юнита и не дальше leashR от anchor; ближнему бою нужен путь. */
  findTarget(u: Unit, anchor: Point, leashR: number, aggro: number): Unit | null {
    const from = this.cellIdx(u.x, u.y);
    let best: Unit | null = null, bestD = Infinity;
    for (const e of this.units) {
      if (e.team === u.team || !e.targetable) continue;
      const d = u.dist(e);
      if (d > aggro || d >= bestD) continue;
      if (Math.hypot(e.x - anchor.x, e.y - anchor.y) > leashR) continue;
      if (!u.stats.projectile && from >= 0) {
        const to = this.cellIdx(e.x, e.y);
        if (to < 0) continue;
        const pathLen = this.flow.distance(to, from) * TILE;
        if (!(pathLen <= aggro * AI.pathAggroMult + TILE)) continue;
      }
      best = e;
      bestD = d;
    }
    return best;
  }

  /** Ближайший враг любого расстояния, до которого можно дойти. */
  nearestReachableFoe(u: Unit): Unit | null {
    const from = this.cellIdx(u.x, u.y);
    let best: Unit | null = null, bestD = Infinity;
    for (const e of this.units) {
      if (e.team === u.team || !e.targetable) continue;
      const to = this.cellIdx(e.x, e.y);
      if (to < 0 || from < 0) continue;
      const d = this.flow.distance(to, from);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) return best;
    // никого не достать по пути (например, сами стоим в воде) — ближайший по прямой
    let bd = Infinity;
    for (const e of this.units) {
      if (e.team === u.team || !e.targetable) continue;
      const d = u.dist(e);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** Ближайший враг по прямой в радиусе (для разворота и стойки). */
  nearestFoe(u: Unit, radius: number): Unit | null {
    let best: Unit | null = null, bestD = radius;
    for (const e of this.units) {
      if (e.team === u.team || !e.targetable) continue;
      const d = u.dist(e);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /**
   * Откуда по u стреляют: летящий рядом с ним вражеский снаряд (точка вылета) или ближайший вражеский стрелок,
   * который достаёт до u. null — стрелков нет.
   */
  rangedThreat(u: Unit): Point | null {
    let best: Point | null = null, bd = Infinity;
    for (const p of this.projectiles) {
      if (p.team === u.team || p.finished) continue;
      const d = Math.hypot(p.tx - u.x, p.ty - u.y);
      if (d < AI.shieldProjectileRadius && d < bd) { bd = d; best = { x: p.sx, y: p.sy }; }
    }
    if (best) return best;
    for (const e of this.units) {
      if (e.team === u.team || !e.targetable || !e.stats.projectile) continue;
      const d = u.dist(e);
      if (d <= e.stats.range * AI.shieldThreatMult && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  nearestFoeShooter(u: Unit, radius: number): Unit | null {
    let best: Unit | null = null, bestD = radius;
    for (const e of this.units) {
      if (e.team === u.team || !e.targetable || !e.stats.projectile) continue;
      const d = u.dist(e);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** Момент удара/выстрела (вызывается юнитом в кадр удара). */
  resolveAttack(attacker: Unit, target: Unit | null, px: number, py: number): void {
    const s = attacker.stats;
    const dmg = s.damage * attacker.damageMult;
    // Враг повреждает здание только непосредственным ударом у двери, без метательных факелов и бомб.
    if (attacker.team === 'enemy' && attacker.aiTag === 'burn' && attacker.type !== 'goblin_barrel') {
      const h = attacker.targetHouse;
      if (!h || h.state !== 'intact' || attacker.dist(h.door) >= AI.burnDoorDist || this.levelAt(attacker) !== this.levelAt(h.door)) return;
      const defended = this.units.some((u) => u.team === 'player' && u.alive && !u.hidden && u.dist(h.door) < HOUSE.defendRadius);
      const ignite = attacker.type === 'goblin_tnt' ? AI.firebombIgnite : AI.torchIgnite;
      h.addIgnite(ignite * (defended ? AI.defendedIgniteMult : 1));
      this.lastActivity = this.time;
      this.fx.dust(h.door.x, h.door.y);
      sfx.play('hit', 0.7);
      return;
    }
    if (s.projectile) {
      if (target && !target.targetable) return;
      // целится туда, где цель сейчас, — с разбросом, растущим с дальностью; бегущих часто мажут
      const def = PROJECTILES[s.projectile];
      // лучники игрока берут упреждение по ходу цели (враги — нет: от их стрел можно уйти)
      if (target && attacker.team === 'player') {
        const flight = Math.max(0.15, Math.hypot(px - attacker.x, py - attacker.y) / def.speed);
        px += target.vx * flight * AI.archerLead;
        py += target.vy * flight * AI.archerLead;
      }
      let sigma = (def.scatterBase + Math.hypot(px - attacker.x, py - attacker.y) * def.scatterPerPx) * WEATHER[this.weather].scatterMult;
      if (target && this.levelAt(attacker) > this.levelAt(target)) sigma *= AI.highGroundScatterMult;
      sfx.play(s.projectile === 'arrow' ? 'arrow' : 'swing', 0.7);
      this.projectiles.push(new Projectile(this.scene, s.projectile, attacker.team, attacker, target,
        px + gauss() * sigma, py + gauss() * sigma * PROJECTILE_HIT.scatterYMult, dmg));
      return;
    }
    if (attacker.type === 'troll' || attacker.type === 'minotaur') {
      // громила бьёт широкой дугой перед собой: раскидывает строй, сбрасывает с обрывов
      this.arcDamage(attacker, s.range * AI.heavyArcReach, AI.heavyArcCos, dmg, s.knockback * attacker.knockMult);
      this.fx.dust(attacker.x + attacker.aimX * s.range * 0.7, attacker.y + attacker.aimY * s.range * 0.7);
      sfx.play('hit', 1.4);
      this.scene.cameras.main.shake(140, 0.005);
      return;
    }
    if (s.splash) {
      let cx = attacker.x, cy = attacker.y;
      const barrel = attacker.type === 'goblin_barrel';
      if (!barrel) {
        const reach = Math.min(Math.hypot(px - attacker.x, py - attacker.y), s.range * AI.splashReach);
        cx += attacker.aimX * reach;
        cy += attacker.aimY * reach;
      }
      // удар по площади в ближнем бою (тролль, минотавр) тоже не достаёт через обрыв; взрыв бочки — достаёт
      this.splashDamage(attacker, cx, cy, s.splash, dmg, s.knockback * attacker.knockMult, undefined, !barrel);
      if (barrel) {
        sfx.play('explosion');
        this.fx.explosion(cx, cy, true);
        this.igniteHousesNear(attacker, cx, cy, s.splash + 30);
        this.scene.cameras.main.shake(120, 0.004);
        this.kill(attacker, 'killed');
      } else {
        this.fx.dust(cx, cy);
        sfx.play('hit', 1.4);
      }
      return;
    }
    const holds = !!target && this.holdsClimb(attacker, target);
    const reach = holds ? this.rangeTo(attacker, target!) : s.range;
    if (target && target.targetable && attacker.dist(target) <= reach * AI.meleeHitTolerance + 8 && (holds || this.canMelee(attacker, target))) {
      let knock = s.knockback * attacker.knockMult * (holds ? AI.pikeStairKnockMult : 1);
      let hit = dmg;
      if (attacker.type === 'pike') {
        // враг прорвался внутрь копья — урон слабее, но близкий выпад отбрасывает его обратно
        if (!holds && attacker.dist(target) < s.range * AI.pikeCloseFrac) {
          hit *= AI.pikeCloseMult;
          knock *= AI.pikeCloseKnockMult;
          attacker.nextCooldownMult = AI.pikeCloseCooldownMult;
        } else if (target.windingUp && target.stats.knockResist >= FEEL.telegraphKnockResist) {
          // копьё встречает тяжёлого в замахе — сбивает удар
          target.cancelAttack();
          target.stunLeft = Math.max(target.stunLeft, AI.pikeInterruptStun);
          this.fx.block(target.x, target.y - 30);
        }
      }
      this.damage(target, hit, attacker, knock, attacker, true);
      if (!holds) return;
      // копьё сбрасывает с подъёма: цель и соседей на тех же ступенях — вниз, с оглушением
      const stair = this.stairApproach.get(this.cellIdx(target.x, target.y));
      for (const e of this.units) {
        if (e.team === attacker.team || !e.targetable || e.stats.knockResist >= 0.8) continue;
        if (e !== target) {
          if (Math.hypot(e.x - target.x, e.y - target.y) > AI.pikeStairSweep) continue;
          if (this.stairApproach.get(this.cellIdx(e.x, e.y)) !== stair || !this.holdsClimb(attacker, e)) continue;
          const dx = e.x - attacker.x, dy = e.y - attacker.y, l = Math.hypot(dx, dy) || 1;
          const eff = knock * (1 - e.stats.knockResist);
          e.kvx += (dx / l) * eff;
          e.kvy += (dy / l) * eff;
        }
        e.stunLeft = Math.max(e.stunLeft, AI.pikeStairStun);
        e.cancelAttack();
      }
      this.fx.dust(target.x, target.y);
    }
  }

  /** Уровень земли под юнитом (на ступенях — верхний). */
  levelAt(u: Point): number {
    return this.grid.walkRange(Math.floor(u.x / TILE), Math.floor(u.y / TILE))[1];
  }

  /** Удар по дуге перед бойцом (cos половины угла ≥ arcCos), только на своём уровне. */
  private arcDamage(attacker: Unit, radius: number, arcCos: number, dmg: number, knock: number): void {
    for (const e of [...this.units]) {
      if (e.team === attacker.team || !e.targetable) continue;
      const dx = e.x - attacker.x, dy = e.y - attacker.y, d = Math.hypot(dx, dy);
      if (d > radius || (d > 8 && (dx * attacker.aimX + dy * attacker.aimY) / d < arcCos)) continue;
      if (!this.canMelee(attacker, e)) continue;
      this.damage(e, e.isCommander ? dmg * SQUAD.commanderSplashMult : dmg, attacker, knock, attacker, true);
    }
  }

  /** Самое плотное скопление чужих для u в радиусе: центр группы и сколько в ней. */
  clusterNear(u: Unit, radius: number): { x: number; y: number; n: number } | null {
    const foes = this.units.filter((e) => e.team !== u.team && e.targetable && !e.boat && u.dist(e) <= radius);
    let best: { x: number; y: number; n: number } | null = null;
    for (const f of foes) {
      const group = foes.filter((o) => Math.hypot(o.x - f.x, o.y - f.y) <= AI.clusterRadius);
      if (best && group.length <= best.n) continue;
      const x = group.reduce((a, o) => a + o.x, 0) / group.length, y = group.reduce((a, o) => a + o.y, 0) / group.length;
      best = { x, y, n: group.length };
    }
    return best;
  }

  /** Копейщик бьёт вниз только с верхнего выхода лестницы по врагу на ступенях или у их подножия. */
  holdsClimb(attacker: Unit, target: Unit): boolean {
    if (attacker.type !== 'pike' || attacker.team === target.team) return false;
    const g = this.grid;
    const s = this.stairApproach.get(this.cellIdx(target.x, target.y));
    if (!s) return false;
    const ax = Math.floor(attacker.x / TILE), ay = Math.floor(attacker.y / TILE);
    if (g.stairAt(ax, ay) || g.getLevel(ax, ay) !== s.level) return false;
    const cells = IslandGrid.stairCellsOf(s);
    if (!cells.some(([sx, sy]) => g.canStep(sx, sy, ax, ay))) return false;
    const tx = Math.floor(target.x / TILE), ty = Math.floor(target.y / TILE);
    if (g.stairAt(tx, ty)?.def === s) return true;
    return g.getLevel(tx, ty) === s.level - 1 && cells.some(([sx, sy]) => g.canStep(sx, sy, tx, ty));
  }

  splashDamage(attacker: Unit | null, cx: number, cy: number, radius: number, dmg: number, knock: number, team?: Team, sameLevel = false): void {
    const foeTeam = team ?? (attacker?.team === 'player' ? 'enemy' : 'player');
    for (const e of [...this.units]) {
      if (e.team !== foeTeam || !e.targetable) continue;
      if (sameLevel && attacker && !this.canMelee(attacker, e)) continue;
      if (Math.hypot(e.x - cx, e.y - cy) > radius) continue;
      this.damage(e, e.isCommander ? dmg * SQUAD.commanderSplashMult : dmg, { x: cx, y: cy }, knock, attacker);
    }
  }

  private igniteHousesNear(attacker: Unit, x: number, y: number, r: number): void {
    for (const h of this.houses) {
      if (h.state === 'intact' && this.levelAt(attacker) === this.levelAt(h.door)
        && Math.hypot(h.center.x - x, h.center.y - y) < r + 40) h.setOnFire();
    }
  }

  private landProjectile(p: Projectile): void {
    const s = p.owner.stats;
    const g = this.grid;
    const tcx = Math.floor(p.tx / TILE), tcy = Math.floor(p.ty / TILE);
    const inWater = !g.inBounds(tcx, tcy) || (g.isWater(tcx, tcy) && g.cliffLevel(tcx, tcy) === 0);
    if (p.areaRadius > 0) {
      this.splashDamage(p.owner, p.tx, p.ty, p.areaRadius, p.damage, 0, p.team === 'player' ? 'enemy' : 'player');
      if (!inWater) p.stick(PROJECTILE_HIT.stuckSec, depthAt(this.grid, p.tx, p.ty, -1));
      return;
    }
    if (s.splash) {
      if (p.kind === 'shaman_orb') this.fx.play('shaman_explosion', p.tx, p.ty - 10);
      else if (inWater) this.fx.splash(p.tx, p.ty);
      else this.fx.explosion(p.tx, p.ty);
      sfx.play(inWater ? 'splash' : 'explosion', 0.7);
      this.splashDamage(p.owner, p.tx, p.ty, s.splash, p.damage, s.knockback, p.team === 'player' ? 'enemy' : 'player');
      return;
    }
    const victim = this.projectileVictim(p);
    if (!victim) {
      if (inWater) { this.fx.splash(p.tx, p.ty); return; }
      p.stick(PROJECTILE_HIT.stuckSec, depthAt(this.grid, p.tx, p.ty, -1));
      return;
    }
    // щит: пехота/скелеты закрываются от снаряда, летящего в лицо; поднятый щит (стойка) закрывает шире
    if (victim.stats.blocksFront && !victim.attacking && victim.stunLeft <= 0) {
      const ix = p.tx - p.sx, iy = p.ty - p.sy;
      const l = Math.hypot(ix, iy);
      const cone = victim.guarding ? AI.shieldGuardCone : AI.shieldIdleCone;
      if (l > 0 && (ix * victim.aimX + iy * victim.aimY) / l < cone) {
        this.fx.block(victim.x + victim.aimX * 12, victim.y - 22);
        sfx.play('block');
        victim.shieldJolt(ix, iy, PROJECTILE_HIT.shieldArrowKnock);
        if (p.team === 'player' && Math.hypot(p.sx - p.tx, p.sy - p.ty) >= AI.closeShotDist) this.stats.arrowBlocked++;
        if (p.kind === 'arrow' || p.kind === 'harpoon') {
          const fx = victim.x + victim.aimX * 16 + (Math.random() - 0.5) * 18, fy = victim.y + 6 + Math.random() * 10;
          p.deflect(fx, fy, PROJECTILE_HIT.stuckSec, depthAt(this.grid, fx, fy, -1));
        }
        return;
      }
    }
    const pointBlank = Math.hypot(p.sx - p.tx, p.sy - p.ty) < AI.closeShotDist;
    if (p.team === 'player' && !pointBlank) this.stats.arrowHits++;
    let dmg = p.damage;
    if (s.closePenalty && pointBlank) dmg *= s.closePenalty;
    // стрела или гарпун в бойца без щита — сразу насмерть (и у игрока, и у врагов; тролль и минотавр держат);
    // в упор — нет: натянуть лук некогда
    if (!pointBlank && PROJECTILE_HIT.oneShotKinds.includes(p.kind) && this.oneShot(victim)) dmg = Math.max(dmg, this.lethalDamage(victim));
    this.damage(victim, dmg, { x: p.sx, y: p.sy }, s.knockback, p.owner);
  }

  /** Кто стоит в точке падения снаряда (цель могла уйти — тогда никто). */
  private projectileVictim(p: Projectile): Unit | null {
    const hitR = PROJECTILES[p.kind].hitRadius;
    let victim: Unit | null = null, bd = Infinity;
    for (const e of this.units) {
      if (e.team === p.team || !e.targetable) continue;
      const d = Math.hypot(e.x - p.tx, e.y - p.ty);
      if (d <= hitR + bodyRadius(e.type) * PROJECTILE_HIT.bodyHitMult && d < bd) { bd = d; victim = e; }
    }
    return victim;
  }

  /**
   * Погибает ли боец от прямого попадания снаряда: без щита и не из тяжёлых. В отряде игрока без щитов попадание
   * всегда уносит одного солдата (даже если попали в командира — он падает последним); одинокий командир держится.
   */
  private oneShot(v: Unit): boolean {
    if (v.stats.blocksFront) return false;
    if (v.squad && !v.squad.lost) return v.squad.aliveUnits.some((u) => !u.isCommander);
    return v.stats.hp <= PROJECTILE_HIT.oneShotMaxHp;
  }

  /**
   * Урон, которого ровно хватает убить бойца, по которому попали. В отряде игрока — одного солдата
   * (общий запас уменьшается на его долю; если попали в командира, а солдаты живы, падает ближайший солдат).
   */
  private lethalDamage(v: Unit): number {
    const sq = v.squad;
    if (!sq || sq.lost) return v.hp;
    const soldiers = sq.aliveUnits.filter((u) => !u.isCommander).length;
    if (soldiers === 0) return sq.hp;
    return Math.max(0, sq.hp - (sq.cmdHp + (soldiers - 1) * sq.soldierHp));
  }

  damage(target: Unit, amount: number, src: Point, knock: number, attacker: Unit | null, melee = false): void {
    if (!target.targetable) return;
    this.lastActivity = this.time;
    // щит: удар ближнего боя спереди — шанс заблокировать (урона нет, лишь толчок); удар тяжёлого щит не держит
    if (melee && attacker && target.stats.blocksFront && !target.attacking && target.stunLeft <= 0) {
      const dx = attacker.x - target.x, dy = attacker.y - target.y, l = Math.hypot(dx, dy) || 1;
      this.stats.meleeOnShield++;
      const heavy = attacker.stats.knockResist >= FEEL.telegraphKnockResist;
      if (!heavy && (dx * target.aimX + dy * target.aimY) / l > 0.35 && Math.random() < AI.meleeBlockChance) {
        this.stats.meleeBlocked++;
        this.fx.block(target.x + target.aimX * 12, target.y - 22);
        sfx.play('block');
        target.kvx -= (dx / l) * knock * AI.blockKnockMult;
        target.kvy -= (dy / l) * knock * AI.blockKnockMult;
        return;
      }
    }
    if (target.squad) target.squad.lastFight = this.time;
    if (attacker?.squad) attacker.squad.lastFight = this.time;
    if (target.squad && !target.squad.lost) this.squadDamage(target, amount);
    else target.hp -= amount;
    sfx.play('hit', 0.6);
    this.fx.flash(target.view);
    this.fx.hit(target.x, target.y, src.x, src.y, knock >= FEEL.hitStopKnock);
    this.fx.damageNumber(target.x, target.y - barOffsetFor(target.spriteKey) - 4, amount, target.team === 'player' ? '#ff8a7a' : '#ffffff');
    if (knock > 0) {
      const eff = knock * (1 - target.stats.knockResist);
      if (eff > 1) {
        let dx = target.x - src.x, dy = target.y - src.y;
        let l = Math.hypot(dx, dy);
        if (l < 0.5) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; l = Math.hypot(dx, dy); }
        target.kvx += (dx / l) * eff;
        target.kvy += (dy / l) * eff;
        target.lastHitX = (dx / l) * eff;
        target.lastHitY = (dy / l) * eff;
        target.lastHitAt = this.time;
        // hit-stop: сильный удар на миг замораживает обоих
        if (eff >= FEEL.hitStopKnock && !target.boat) {
          target.freezeLeft = FEEL.hitStopSec;
          if (attacker && melee) attacker.freezeLeft = FEEL.hitStopSec;
          this.fx.dust(target.x, target.y);
        }
        if (eff > 150) {
          target.stunLeft = Math.max(target.stunLeft, MOVE.heavyHitStun);
          target.cancelAttack();
        }
      }
    }
    if (attacker?.stats.stun && target.stats.knockResist < 0.8) {
      target.stunLeft = Math.max(target.stunLeft, attacker.stats.stun);
      target.cancelAttack();
    }
    if (!target.squad && target.hp <= 0) this.kill(target, 'killed');
  }

  /** Урон отряду игрока идёт в общий запас; бойцы гибнут по мере его убывания, командир — последним. */
  private squadDamage(hit: Unit, amount: number): void {
    const sq = hit.squad!;
    sq.hp = Math.max(0, sq.hp - amount);
    if (sq.hp <= 0) {
      this.kill(sq.commander, 'killed');
      return;
    }
    const soldiers = sq.aliveUnits.filter((u) => !u.isCommander && !u.hidden);
    const hiddenSoldiers = sq.aliveUnits.filter((u) => !u.isCommander && u.hidden).length;
    const desired = Math.max(0, Math.ceil((sq.hp - sq.cmdHp) / sq.soldierHp) - hiddenSoldiers);
    let excess = soldiers.length - desired;
    while (excess-- > 0) {
      // погибает тот, по кому попали, иначе ближайший к удару солдат
      const alive = soldiers.filter((u) => u.alive);
      const victim = !hit.isCommander && hit.alive && alive.includes(hit) ? hit
        : alive.sort((a, b) => a.dist(hit) - b.dist(hit))[0];
      if (!victim) break;
      this.reconciling = true;
      this.kill(victim, 'killed');
      this.reconciling = false;
    }
  }

  kill(u: Unit, cause: DeathCause = 'killed'): void {
    if (!u.alive) return;
    if (u.boat) {
      // убит в лодке — падает за борт
      u.boat.drop(u);
      cause = 'drowned';
    }
    u.hp = 0;
    u.die(cause);
    if (cause === 'drowned') { this.fx.splash(u.x, u.y); sfx.play('splash'); }
    else { this.fx.death(u.x, u.y, u.team === 'player'); sfx.play('death', 0.6); }
    this.events.emit('unitKilled', u);
    const sq = u.squad;
    // солдат погиб не от урона по запасу (утонул и т.п.) — запас отряда уменьшается на его долю
    if (sq && !u.isCommander && !this.reconciling && !sq.lost) {
      const soldiers = sq.aliveUnits.filter((s) => !s.isCommander).length;
      sq.hp = Math.min(sq.hp, sq.cmdHp + soldiers * sq.soldierHp);
    }
    if (u.isCommander && sq && !sq.lost) {
      sq.hp = 0;
      // командир пал — отряд потерян навсегда, солдаты гибнут следом
      sq.lost = true;
      this.occupy(sq, null);
      sq.entering = null;
      if (sq.inHouse) this.exitHouse(sq);
      sq.aliveUnits.forEach((s, i) => { s.doomLeft = 0.25 + i * 0.12; });
      if (this.selected === sq) this.selected = null;
      this.events.emit('squadLost', sq);
    }
  }

  /** Отложенное действие в игровом времени (учитывает замедление). */
  schedule(delay: number, fn: () => void): void {
    this.timers.push({ left: delay, fn });
  }

  /** Рывок пехоты: бежит по прямой, сбивая врагов на пути. */
  updateDash(u: Unit, dt: number): void {
    const d = u.dash!;
    d.left -= dt;
    const moved = this.tryMove(u, d.vx * dt, d.vy * dt);
    u.moving = true;
    u.view.playState('run');
    const c = ABILITY.charge;
    for (const e of [...this.units]) {
      if (e.team === u.team || !e.targetable || d.hit.has(e) || u.dist(e) > c.hitRadius + 10) continue;
      d.hit.add(e);
      this.damage(e, (d.damage ?? c.damage) * d.power, u, (d.knockback ?? c.knockback) * d.power * u.knockMult, u);
    }
    if (d.left <= 0 || !moved) u.dash = null;
  }

  /** Оставшиеся враги отступают в море (бой зашёл в тупик). */
  retreatEnemies(): number {
    let n = 0;
    for (const u of this.units) {
      if (u.team !== 'enemy' || !u.alive || u.homeBoat) continue;
      this.fx.dust(u.x, u.y);
      u.state = 'dead';
      u.remove();
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ цикл

  update(dt: number): void {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.left -= dt;
      if (t.left <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    for (const u of this.units) {
      if (!u.alive || u.hidden) continue;
      u.thinkLeft -= dt;
      if (u.thinkLeft > 0) continue;
      u.thinkLeft = AI.thinkInterval;
      if (u.team === 'player') thinkPlayer(u, this);
      else thinkEnemy(u, this);
    }
    for (const u of this.units) u.update(dt);
    // враги, которые куда-то идут, — бой не в тупике
    if (this.units.some((u) => u.team === 'enemy' && u.alive && u.moving)) this.lastActivity = this.time;
    this.separate(dt);

    for (const p of this.projectiles) if (p.update(dt)) this.landProjectile(p);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].finished) {
        this.projectiles[i].destroy();
        this.projectiles.splice(i, 1);
      }
    }
    this.updateHouses(dt);
    for (let i = this.units.length - 1; i >= 0; i--) if (this.units[i].removed) this.units.splice(i, 1);
    for (const sq of this.squads) sq.abilityCooldown = Math.max(0, sq.abilityCooldown - dt);
    this.drawOverlay();
  }

  private updateHouses(dt: number): void {
    for (const h of this.houses) {
      if (h.state === 'intact') {
        // поджог растёт от ударов у двери, сам по себе понемногу гаснет; наш отряд рядом гасит быстрее
        const defended = this.units.some((u) => u.team === 'player' && u.alive && !u.hidden && u.dist(h.door) < HOUSE.defendRadius);
        h.defended = defended;
        h.coolDown(dt * (defended ? AI.igniteDecayDefended : AI.igniteDecay));
      }
      // дом мог загореться от удара или взрыва — объявляем один раз
      if (h.state !== 'intact' && !h.fireAnnounced) {
        h.fireAnnounced = true;
        this.events.emit('houseIgnited', h);
      }
      if (h.update(dt)) {
        sfx.play('fire');
        this.events.emit('houseBurned', h);
        if (h.occupant) {
          const sq = h.occupant;
          this.exitHouse(sq);
          for (const u of sq.aliveUnits) {
            this.damage(u, u.maxHp * HOUSE.burnEjectDamage, h.center, 160, null);
          }
        }
      }
    }
    // вход в дом и восстановление
    for (const sq of this.squads) {
      if (sq.lost) continue;
      const house = sq.entering;
      if (house) {
        if (house.state !== 'intact' || (house.occupant && house.occupant !== sq)) {
          sq.entering = null;
        } else {
          for (const u of sq.aliveUnits) {
            if (!u.hidden && u.dist(house.door) < HOUSE.enterRadius) { u.hidden = true; u.navGoal = null; u.target = null; }
          }
          if (sq.aliveUnits.every((u) => u.hidden)) {
            sq.entering = null;
            sq.inHouse = house;
            house.occupant = sq;
            house.healTimer = HOUSE.healEnterDelay;
          }
        }
      }
      if (sq.inHouse && sq.inHouse.occupant === sq) this.healInHouse(sq, sq.inHouse, dt);
    }
  }

  private healInHouse(sq: Squad, house: House, dt: number): void {
    house.healTimer -= dt;
    if (house.healTimer > 0) return;
    house.healTimer = HOUSE.healInterval;
    const soldiers = sq.aliveUnits.filter((u) => !u.isCommander).length;
    if (soldiers < sq.soldiersMax) {
      const u = this.addSoldier(sq, house.door);
      u.hidden = true;
      this.events.emit('soldierRestored', sq);
      this.fx.play('heal', house.door.x, house.door.y - 30, { scale: 0.6 });
      return;
    }
    // все на месте — лечим раны и выходим
    for (const u of sq.aliveUnits) u.hp = u.maxHp;
    sq.hp = sq.maxHp;
    this.exitHouse(sq);
  }

  private drawOverlay(): void {
    const g = this.bars;
    g.clear();
    // враги — по полоске на каждого
    for (const u of this.units) {
      if (!u.alive || u.hidden || u.squad) continue;
      const w = u.stats.hp > 100 ? 48 : 26;
      const x = Math.round(u.x - w / 2), y = Math.round(u.y + u.fallOffset + u.climbOffset - barOffsetFor(u.spriteKey));
      const frac = Phaser.Math.Clamp(u.hp / u.maxHp, 0, 1);
      g.fillStyle(0x000000, 0.65).fillRect(x - 1, y - 1, w + 2, 6);
      g.fillStyle(u.team === 'player' ? 0x63d66a : 0xe0483c, 1).fillRect(x, y, Math.round(w * frac), 4);
    }
    // отряды — одна общая полоска над командиром
    for (const sq of this.squads) {
      const cmd = sq.commander;
      if (sq.lost || !cmd.alive || cmd.hidden) continue;
      const w = 56, f = sq.hpFraction;
      const x = Math.round(cmd.x - w / 2), y = Math.round(cmd.y + cmd.fallOffset + cmd.climbOffset - barOffsetFor(cmd.spriteKey) - 6);
      g.fillStyle(0x000000, 0.65).fillRect(x - 1, y - 1, w + 2, 8);
      g.fillStyle(f > 0.5 ? 0x63d66a : f > 0.25 ? 0xf0c040 : 0xe0483c, 1).fillRect(x, y, Math.round(w * f), 6);
      // деления по бойцам
      const per = sq.soldierHp / sq.maxHp;
      for (let s = 1; s <= sq.soldiersMax; s++) {
        const px = x + Math.round(w * (sq.cmdHp / sq.maxHp + (s - 1) * per));
        if (px > x && px < x + w) g.fillStyle(0x000000, 0.35).fillRect(px, y, 1, 6);
      }
      // флажок командира — видно, где центр отряда, даже когда командир закрыт строем
      const color = SQUAD_COLORS[sq.index % SQUAD_COLORS.length];
      const px = Math.round(cmd.x - 6), top = y - 40;
      g.fillStyle(0x2a1a10, 1).fillRect(px - 2, top - 2, 4, 40);
      g.fillStyle(0xd9b98a, 1).fillRect(px - 1, top - 1, 2, 38);
      // полотнище с тёмной обводкой
      g.fillStyle(0x2a1a10, 1).fillTriangle(px, top - 2, px, top + 18, px + 27, top + 8);
      g.fillStyle(color, 1).fillTriangle(px + 1, top, px + 1, top + 15, px + 23, top + 8);
      g.fillStyle(0xffffff, 0.35).fillTriangle(px + 1, top, px + 1, top + 5, px + 12, top + 3);
    }
    // выделение — клеткой на земле, как в Bad North: квадрат отряда, квадрат под курсором, куда пойдёт отряд
    const m = this.marks;
    m.begin();
    const pulse = 0.75 + 0.25 * Math.sin(this.scene.time.now / 180);
    const sel = this.selected && !this.selected.lost ? this.selected : null;
    const pv = sel ? this.preview : null;
    if (sel) {
      // сетка зон: в каждой помещается один отряд; занятые чужими — темнее
      for (const z of this.zoneMap.zones) {
        if (z === sel.zone || z === pv?.zone) continue;
        const occ = this.zoneOccupiedBy(z);
        m.mark(z, { fill: 0x000000, fillAlpha: occ ? 0.14 : 0, line: 0xffffff, lineAlpha: 0.22, lineWidth: 1 });
      }
    }
    const hov = this.hovered && this.hovered !== sel && !this.hovered.lost ? this.hovered : null;
    if (hov?.zone) m.mark(hov.zone, { fill: 0xffffff, fillAlpha: 0.08, line: 0xffffff, lineAlpha: 0.6, corners: true });
    if (sel?.zone) {
      const color = SQUAD_COLORS[sel.index % SQUAD_COLORS.length];
      m.mark(sel.zone, { fill: color, fillAlpha: 0.22, line: 0xffffff, lineAlpha: pulse, corners: true });
    }
    if (pv?.zone && pv.zone !== sel?.zone) {
      const color = pv.ability ? (pv.valid ? 0xffd84a : 0xe0483c) : 0xbfe6ff;
      m.mark(pv.zone, { fill: color, fillAlpha: 0.16, line: color, lineAlpha: 0.95, corners: true });
    }
    m.end();
    const r = this.rings;
    r.clear();
    if (pv?.slots.length) {
      for (const p of pv.slots) {
        r.fillStyle(0xffffff, 0.35).fillEllipse(p.x, p.y, 18, 8);
        r.lineStyle(1, 0xffffff, 0.8).strokeEllipse(p.x, p.y, 18, 8);
      }
    }
  }

  /** Предпросмотр строя выбранного отряда в точке (для подсветки под курсором). */
  previewAt(sq: Squad, x: number, y: number): { zone: Zone | null; slots: Point[] } | null {
    const lead = sq.commander.alive ? sq.commander : sq.aliveUnits[0];
    if (!lead) return null;
    const zone = this.pickZone(x, y, lead, sq, true);
    return zone ? { zone, slots: this.zoneSlots(zone, sq.aliveUnits.length) } : null;
  }

  destroy(): void {
    this.units.forEach((u) => u.remove());
    this.projectiles.forEach((p) => p.destroy());
    this.houses.forEach((h) => h.destroy());
    this.bars.destroy();
    this.rings.destroy();
    this.marks.destroy();
    this.events.removeAllListeners();
  }
}
