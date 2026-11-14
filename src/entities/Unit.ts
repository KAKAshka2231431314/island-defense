import { FEEL, MOVE, PROJECTILE_HIT, type UnitStats } from '../data/balance';
import type { UnitType } from '../data/units';
import type { BattleWorld } from '../systems/BattleWorld';
import type { Boat } from './Boat';
import type { House } from './House';
import type { Squad } from './Squad';
import { depthAt } from '../systems/depth';
import { UnitView } from './UnitView';

export type Team = 'player' | 'enemy';
/** Конечный автомат юнита: idle → move → engage → attack → dead. */
export type UnitState = 'idle' | 'move' | 'engage' | 'attack' | 'dead';
export type DeathCause = 'killed' | 'drowned';

interface AttackAction {
  elapsed: number;
  windup: number;
  duration: number;
  hitDone: boolean;
  target: Unit | null;
  px: number;
  py: number;
}

export interface Point {
  x: number;
  y: number;
}

let nextId = 1;

export class Unit {
  readonly id = nextId++;
  readonly view: UnitView;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damageMult = 1;
  speedMult = 1;
  knockMult = 1;
  state: UnitState = 'idle';
  navGoal: Point | null = null;
  target: Unit | null = null;
  /** дом, который враг идёт поджигать */
  targetHouse: House | null = null;
  squad: Squad | null = null;
  isCommander = false;
  /** идёт по приказу: не отвлекается на бой, пока не дойдёт */
  ordered = false;
  /** держит щит (пехота) */
  guarding = false;
  facing = 1;
  aimX = 1;
  aimY = 0;
  kvx = 0;
  kvy = 0;
  stunLeft = 0;
  /** дрожь от попадания в щит: сколько секунд ещё трясётся и откуда прилетело */
  joltLeft = 0;
  joltX = 0;
  joltY = 0;
  cooldownLeft = 0;
  thinkLeft = Math.random() * 0.2;
  losLeft = 0;
  losDirect = false;
  moving = false;
  /** внутри дома: невидим, не дерётся, не получает урон */
  hidden = false;
  /** отложенная гибель (отряд без командира разбегается) */
  doomLeft = -1;
  deathCause: DeathCause | null = null;
  deadTime = 0;
  removed = false;
  /** Удар в щит: вздрогнуть и чуть отъехать назад (dx, dy — направление полёта снаряда). */
  shieldJolt(dx: number, dy: number, knock: number): void {
    const l = Math.hypot(dx, dy) || 1;
    this.joltX = dx / l;
    this.joltY = dy / l;
    this.joltLeft = PROJECTILE_HIT.shieldJoltSec;
    this.kvx += this.joltX * knock;
    this.kvy += this.joltY * knock;
  }

  /** метка для ИИ (например, «высаживается») */
  aiTag = '';
  /** визуальное смещение при падении с уступа (спрайт «догоняет» позицию), px */
  fallOffset = 0;
  /** высота спрайта на боковой лестнице: от 0 у земли до отрицательного смещения у плато */
  climbOffset = 0;
  /** рывок: способность пехоты (весь отряд в одну точку) или бросок минотавра; damage/knockback — свои, иначе как у рывка пехоты */
  dash: { left: number; vx: number; vy: number; hit: Set<Unit>; power: number; damage?: number; knockback?: number } | null = null;
  /** сидит в лодке (пассажир): не ходит, не толкается; стрелки бьют с палубы */
  boat: Boat | null = null;
  /** лодка, на которой приплыл (к ней отступает) */
  homeBoat: Boat | null = null;
  /** скорость своего хода, px/с (для упреждения стрелков) */
  vx = 0;
  vy = 0;
  /** hit-stop: короткая заморозка при сильном ударе (и у бьющего, и у цели), с */
  freezeLeft = 0;
  /** куда отлетает тело при гибели (по последнему сильному удару), px/с */
  flingX = 0;
  flingY = 0;
  /** последний удар: направление и сила (для отлёта тела) */
  lastHitX = 0;
  lastHitY = 0;
  lastHitAt = -99;
  /** множитель следующей перезарядки (слабый тычок копейщика вплотную — дольше) */
  nextCooldownMult = 1;
  /** таймеры поведения: смена цели не чаще раза в retarget, отход стрелков, рывок минотавра */
  retargetLeft = 0;
  kiteLeft = 0;
  dashCooldown = 0;
  private attack: AttackAction | null = null;

  constructor(
    readonly world: BattleWorld,
    readonly team: Team,
    readonly type: UnitType,
    readonly stats: UnitStats,
    x: number,
    y: number,
    readonly spriteKey: string,
  ) {
    this.x = x;
    this.y = y;
    this.hp = this.maxHp = stats.hp;
    this.view = new UnitView(world.scene, x, y, spriteKey);
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get knockSpeed(): number {
    return Math.hypot(this.kvx, this.kvy);
  }

  get attacking(): boolean {
    return this.attack !== null;
  }

  /** Идёт замах (удар ещё не нанесён). */
  get windingUp(): boolean {
    return this.attack !== null && !this.attack.hitDone;
  }

  /** Может сейчас принимать решения и начинать действия. */
  get canAct(): boolean {
    return this.alive && !this.hidden && this.stunLeft <= 0 && !this.attack && this.knockSpeed < 60;
  }

  /** Можно ли по юниту бить/целиться. */
  get targetable(): boolean {
    return this.alive && !this.hidden;
  }

  dist(p: Point): number {
    return Math.hypot(p.x - this.x, p.y - this.y);
  }

  lookAt(p: Point): void {
    const dx = p.x - this.x, dy = p.y - this.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    this.aimX = dx / len;
    this.aimY = dy / len;
    if (Math.abs(dx) > 2) this.facing = Math.sign(dx);
  }

  startAttack(target: Unit | null, px = target?.x ?? this.x + this.facing * 30, py = target?.y ?? this.y): void {
    if (!this.alive || this.attack) return;
    this.lookAt({ x: px, y: py });
    this.navGoal = null;
    this.state = 'attack';
    const duration = Math.max(this.stats.windup + 0.1, this.view.playAttack(this.aimX, this.aimY));
    this.attack = { elapsed: 0, windup: this.stats.windup, duration, hitDone: false, target, px, py };
  }

  cancelAttack(): void {
    if (!this.attack) return;
    this.attack = null;
    this.cooldownLeft = Math.max(this.cooldownLeft, this.stats.cooldown * 0.5);
    if (this.alive) this.state = 'idle';
  }

  die(cause: DeathCause): void {
    if (!this.alive) return;
    this.state = 'dead';
    this.deathCause = cause;
    this.attack = null;
    this.dash = null;
    this.target = null;
    this.navGoal = null;
    this.guarding = false;
    this.kvx = this.kvy = 0;
    this.deadTime = 0;
    this.view.clearTint();
    // сильный последний удар — тело отлетает по его направлению
    if (cause === 'killed' && this.world.time - this.lastHitAt < 0.2) {
      this.flingX = this.lastHitX * FEEL.deathFling;
      this.flingY = this.lastHitY * FEEL.deathFling;
    }
    if (cause === 'killed') this.view.playState('death', false);
    else this.view.stop();
  }

  update(dt: number): void {
    if (!this.alive) {
      this.updateDead(dt);
      return;
    }
    if (this.doomLeft > 0) {
      this.doomLeft -= dt;
      if (this.doomLeft <= 0) {
        this.world.kill(this);
        return;
      }
    }
    if (this.hidden) {
      this.view.setVisible(false);
      return;
    }
    // hit-stop: замер на долю секунды (анимация стоит, таймеры не идут)
    if (this.freezeLeft > 0) {
      this.freezeLeft -= dt;
      if (this.freezeLeft > 0) {
        this.view.anims.pause();
        this.syncView();
        return;
      }
      this.view.anims.resume();
    }
    this.stunLeft = Math.max(0, this.stunLeft - dt);
    this.joltLeft = Math.max(0, this.joltLeft - dt);
    this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    this.retargetLeft = Math.max(0, this.retargetLeft - dt);
    this.kiteLeft = Math.max(0, this.kiteLeft - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    // пассажир лодки: позицию задаёт лодка, толчки не действуют; стрелок может бить с палубы
    if (this.boat) {
      this.kvx = this.kvy = 0;
      this.navGoal = null;
      this.moving = false;
      if (this.attack) this.updateAttack(dt);
      if (!this.alive) return;
      if (!this.attack) this.state = this.target ? 'engage' : 'idle';
      this.updateAnim();
      this.syncView();
      return;
    }
    this.moving = false;

    if (this.kvx || this.kvy) {
      this.world.knockMove(this, this.kvx * dt, this.kvy * dt);
      if (!this.alive) return;
      const damp = Math.exp(-MOVE.knockbackDamping * dt);
      this.kvx *= damp;
      this.kvy *= damp;
      if (this.knockSpeed < MOVE.knockbackStop) this.kvx = this.kvy = 0;
    }

    if (this.fallOffset < 0) this.fallOffset = Math.min(0, this.fallOffset + MOVE.fallSpeed * dt);
    const x0 = this.x, y0 = this.y;
    if (this.dash) this.world.updateDash(this, dt);
    else if (this.attack) this.updateAttack(dt);
    else if (this.navGoal && this.stunLeft <= 0 && this.knockSpeed < 60) this.world.steer(this, dt);
    if (!this.alive) return;
    // скорость шага (для упреждения лучников; толчки не в счёт)
    if (dt > 0) { this.vx = (this.x - x0) / dt; this.vy = (this.y - y0) / dt; }

    if (!this.attack) this.state = this.moving ? (this.target ? 'engage' : 'move') : this.target ? 'engage' : 'idle';
    this.updateAnim();
    this.syncView();
  }

  syncView(): void {
    this.view.setVisible(!this.hidden);
    this.syncClimbOffset();
    // дрожь щита — затухающие колебания вдоль направления удара
    const j = this.joltLeft > 0
      ? Math.sin(this.joltLeft * PROJECTILE_HIT.shieldJoltHz) * PROJECTILE_HIT.shieldJoltPx * (this.joltLeft / PROJECTILE_HIT.shieldJoltSec)
      : 0;
    // замах тяжёлого (тролль, минотавр) видно заранее: спрайт дрожит и мигает красным
    let sx = 0;
    const a = this.attack;
    if (a && !a.hitDone && this.stats.knockResist >= FEEL.telegraphKnockResist) {
      const t = this.world.time;
      sx = Math.sin(t * FEEL.telegraphShakeHz) * FEEL.telegraphShakePx;
      if (Math.sin(t * FEEL.telegraphBlinkHz) > 0) this.view.setTint(FEEL.telegraphTint);
      else this.view.clearTint();
    } else if (this.view.isTinted && !this.view.tintFill) this.view.clearTint();
    this.view.setPosition(this.x + this.joltX * j + sx, this.y + this.fallOffset + this.climbOffset + this.joltY * j);
    this.view.face(this.facing);
    // стабильный порядок при равном Y (иначе соседи «мигают», меняясь местами); пассажир — над лодкой
    this.view.syncDepth(this.boat ? this.boat.riderDepth(this) : depthAt(this.world.grid, this.x, this.y, (this.id % 997) * 1e-4));
  }

  private syncClimbOffset(): void {
    const g = this.world.grid;
    const cx = Math.floor(this.x / 64), cy = Math.floor(this.y / 64);
    const local = this.x / 64 - cx;
    const stair = g.stairAt(cx, cy)?.def;
    if (stair?.side === 'left' || stair?.side === 'right') {
      const progress = stair.side === 'left' ? local : 1 - local;
      this.climbOffset = -MOVE.sideStairRise * Math.max(0, Math.min(1, progress));
      return;
    }
    this.climbOffset = 0;
    const level = g.getLevel(cx, cy);
    const left = g.stairAt(cx - 1, cy)?.def;
    if (left?.side === 'left' && left.level === level) {
      this.climbOffset = -MOVE.sideStairRise * (1 - local);
      return;
    }
    const right = g.stairAt(cx + 1, cy)?.def;
    if (right?.side === 'right' && right.level === level) this.climbOffset = -MOVE.sideStairRise * local;
  }

  private updateAttack(dt: number): void {
    const a = this.attack!;
    a.elapsed += dt;
    if (!a.hitDone && a.elapsed >= a.windup) {
      a.hitDone = true;
      // цель могла сместиться: бьём туда, где она сейчас (для ближнего боя)
      if (a.target && a.target.alive && !this.stats.projectile) {
        a.px = a.target.x;
        a.py = a.target.y;
      }
      this.world.resolveAttack(this, a.target, a.px, a.py);
      if (!this.alive) return;
    }
    if (a.elapsed >= a.duration) {
      this.attack = null;
      this.cooldownLeft = this.stats.cooldown * this.nextCooldownMult;
      this.nextCooldownMult = 1;
      this.state = this.target ? 'engage' : 'idle';
    }
  }

  private updateAnim(): void {
    if (this.attack) return;
    if (this.moving) this.view.playState('run');
    else if (this.guarding && this.view.hasState('guard')) this.view.playGuard(this.aimX, this.aimY);
    else this.view.playState('idle');
  }

  private updateDead(dt: number): void {
    this.deadTime += dt;
    if (this.deathCause === 'drowned') {
      // уходит под воду
      if (this.fallOffset < 0) this.fallOffset = Math.min(0, this.fallOffset + MOVE.fallSpeed * dt);
      const k = Math.min(1, this.deadTime / MOVE.drownTime);
      this.view.setAlpha(1 - k);
      this.view.setPosition(this.x, this.y + this.fallOffset + k * 18);
      this.view.setCrop(0, 0, this.view.frame.width, this.view.frame.height * (this.view.originY + 0.05 - k * 0.4));
      if (k >= 1) this.remove();
      return;
    }
    // отлёт тела: быстро гаснет; в воду и за край не уносит
    if (this.flingX || this.flingY) {
      const nx = this.x + this.flingX * dt, ny = this.y + this.flingY * dt;
      const g = this.world.grid, cx = Math.floor(nx / 64), cy = Math.floor(ny / 64);
      if (g.isWalkable(cx, cy)) { this.x = nx; this.y = ny; } else this.flingX = this.flingY = 0;
      const damp = Math.exp(-FEEL.deathFlingDamping * dt);
      this.flingX *= damp;
      this.flingY *= damp;
      if (Math.hypot(this.flingX, this.flingY) < 10) this.flingX = this.flingY = 0;
    }
    this.view.setPosition(this.x, this.y);
    if (this.deadTime > 4) {
      this.view.setAlpha(Math.max(0, 1 - (this.deadTime - 4)));
      if (this.deadTime > 5) this.remove();
    }
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.view.destroy();
  }
}
