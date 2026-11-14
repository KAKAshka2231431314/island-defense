import Phaser from 'phaser';
import { WAVES } from '../data/balance';
import { DEPTH } from '../data/config';
import type { LandingPoint } from '../mapgen/IslandGenerator';
import { fxKey } from '../systems/AnimationRegistry';
import type { Point, Unit } from './Unit';

/**
 * waiting — ждёт очереди за краем карты; sailing — плывёт к берегу; unloading — высаживает десант;
 * standby — стоит у причала, пока жив десант (может забрать отступающих); leaving — уплывает.
 */
export type BoatState = 'waiting' | 'sailing' | 'unloading' | 'standby' | 'leaving' | 'gone';

/** Места пассажиров на палубе (смещения от центра лодки) для 1–4 человек. */
const SEATS: Record<number, [number, number][]> = {
  1: [[0, -22]],
  2: [[-20, -22], [20, -22]],
  3: [[-30, -20], [0, -26], [30, -20]],
  4: [[-36, -20], [-12, -26], [12, -26], [36, -20]],
};

/**
 * Лодка с десантом. Пассажиры — настоящие враги (Unit с unit.boat = эта лодка): по ним стреляют лучники,
 * стрелки бьют с палубы. Высадив всех, лодка остаётся у причала: уцелевшие при отступлении садятся
 * обратно, и лодка уплывает (с ними — враги спаслись). Когда на берегу никого не осталось — уплывает пустой.
 */
export class Boat {
  readonly sprite: Phaser.GameObjects.Sprite;
  state: BoatState;
  x: number;
  y: number;
  private seg = 0;
  private unloadLeft = 0;
  private waitLeft: number;
  /** кто сейчас на палубе */
  readonly riders: Unit[] = [];
  /** весь десант лодки (для сбора у берега и отступления) */
  readonly crew: Unit[] = [];
  /** когда закончилась высадка (время мира), −1 — ещё нет */
  unloadedAt = -1;
  /** десант отступает к лодке */
  retreating = false;
  /** когда началось отступление (время мира) */
  retreatAt = -1;
  /** путь назад от причала для отплытия */
  private back: Point[] = [];
  private backSeg = 0;

  constructor(
    scene: Phaser.Scene,
    /** путь по воде: от точки появления до причала */
    readonly path: Point[],
    readonly landing: LandingPoint,
    delay = 0,
  ) {
    this.x = path[0].x;
    this.y = path[0].y;
    this.waitLeft = delay;
    this.state = delay > 0 ? 'waiting' : 'sailing';
    this.sprite = scene.add.sprite(this.x, this.y, 'boat').setOrigin(0.5, 0.62);
    this.sprite.play({ key: fxKey('boat'), startFrame: Math.floor(Math.random() * 8) });
    this.sync();
  }

  get dock(): Point {
    return this.path[this.path.length - 1];
  }

  /** Ещё есть кого высаживать (лодка в пути или у берега с десантом). */
  get pending(): boolean {
    return (this.state === 'waiting' || this.state === 'sailing' || this.state === 'unloading') && this.riders.some((u) => u.alive);
  }

  /** Посадить врага на палубу. */
  board(u: Unit): void {
    if (!this.riders.includes(u)) this.riders.push(u);
    if (!this.crew.includes(u)) this.crew.push(u);
    u.boat = this;
    u.navGoal = null;
    u.target = null;
    u.kvx = u.kvy = 0;
    this.sync();
  }

  /** Убрать с палубы (высадился или погиб). */
  drop(u: Unit): void {
    const i = this.riders.indexOf(u);
    if (i >= 0) this.riders.splice(i, 1);
    if (u.boat === this) u.boat = null;
  }

  /** Глубина пассажира на палубе (над лодкой). */
  riderDepth(u: Unit): number {
    return this.depth + 1 + Math.max(0, this.riders.indexOf(u)) * 0.01;
  }

  private get depth(): number {
    // за верхним краем карты y < 0 — не даём лодке уйти под слой воды
    return DEPTH.objects + Math.max(0, this.y);
  }

  /** Сколько десанта ещё на острове (живые, не на палубе). */
  get ashore(): number {
    return this.crew.filter((u) => u.alive && u.boat !== this).length;
  }

  /** Двигает лодку. onUnload(враг, точка) вызывается для каждого высаживаемого. */
  update(dt: number, now: number, onUnload: (u: Unit, at: Point) => void): void {
    const x0 = this.x, y0 = this.y;
    if (this.state === 'waiting') {
      this.waitLeft -= dt;
      if (this.waitLeft <= 0) this.state = 'sailing';
    } else if (this.state === 'sailing') {
      if (this.follow(this.path, dt)) {
        this.state = 'unloading';
        this.unloadLeft = 0.2;
      }
    } else if (this.state === 'unloading') {
      this.unloadLeft -= dt;
      if (this.unloadLeft <= 0) {
        const u = this.riders.find((r) => r.alive);
        if (u) {
          const at = this.seatPos(u);
          this.drop(u);
          onUnload(u, at);
          this.unloadLeft = WAVES.unloadInterval;
        } else {
          this.riders.length = 0;
          this.unloadedAt = now;
          this.back = [...this.path].reverse();
          this.backSeg = 0;
          this.state = 'standby';
        }
      }
    } else if (this.state === 'standby') {
      if (this.retreating && this.retreatAt < 0) this.retreatAt = now;
      // все свои на борту или погибли — уплывает; отступающие не добежали за retreatWaitSec — уплывает без них
      const tooLong = this.retreatAt >= 0 && now - this.retreatAt > WAVES.retreatWaitSec;
      if ((this.ashore === 0 && now - this.unloadedAt > 1) || tooLong) {
        for (const u of this.crew) if (u.alive && u.boat !== this) u.homeBoat = null;
        this.state = 'leaving';
      }
    } else if (this.state === 'leaving') {
      if (this.followBack(WAVES.boatSpeed * dt)) {
        this.state = 'gone';
        // уплыли — спаслись: выбывают из боя (не гибнут)
        for (const u of this.riders) {
          if (!u.alive) continue;
          u.state = 'dead';
          u.remove();
        }
        this.destroy();
        return;
      }
      this.sprite.setAlpha(Math.max(0.2, this.sprite.alpha - dt * 0.15));
    }
    this.sync();
    // пассажиры движутся вместе с лодкой (лучники берут упреждение и по ним)
    if (dt > 0) for (const u of this.riders) { u.vx = (this.x - x0) / dt; u.vy = (this.y - y0) / dt; }
  }

  private seatPos(u: Unit): Point {
    const seats = SEATS[Math.min(4, Math.max(1, this.riders.length))] ?? SEATS[4];
    const [ox, oy] = seats[Math.max(0, this.riders.indexOf(u))] ?? [0, -22];
    const flip = this.sprite.flipX ? -1 : 1;
    return { x: this.x + ox * flip, y: this.y + oy + 10 };
  }

  private sync(): void {
    this.sprite.setPosition(this.x, this.y).setDepth(this.depth);
    for (const u of this.riders) {
      if (!u.alive) continue;
      const p = this.seatPos(u);
      u.x = p.x;
      u.y = p.y;
      u.view.setFlipX(this.sprite.flipX);
    }
  }

  /** Возвращает true, когда дошли до конца пути. */
  private follow(path: Point[], dt: number): boolean {
    let step = WAVES.boatSpeed * dt;
    while (step > 0 && this.seg < path.length - 1) {
      const to = path[this.seg + 1];
      const dx = to.x - this.x, dy = to.y - this.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 1) this.sprite.setFlipX(dx < 0);
      if (d <= step) {
        this.x = to.x;
        this.y = to.y;
        this.seg++;
        step -= d;
      } else {
        this.x += (dx / d) * step;
        this.y += (dy / d) * step;
        step = 0;
      }
    }
    return this.seg >= path.length - 1;
  }

  /** Движение по пути назад (от причала в море) на step px. true — дошли до края карты. */
  private followBack(step: number): boolean {
    const path = this.back;
    while (step > 0 && this.backSeg < path.length - 1) {
      const to = path[this.backSeg + 1];
      const dx = to.x - this.x, dy = to.y - this.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 1) this.sprite.setFlipX(dx < 0);
      if (d <= step) {
        this.x = to.x;
        this.y = to.y;
        this.backSeg++;
        step -= d;
      } else {
        this.x += (dx / d) * step;
        this.y += (dy / d) * step;
        step = 0;
      }
    }
    return this.backSeg >= path.length - 1;
  }

  destroy(): void {
    if (this.sprite.active) this.sprite.destroy();
  }
}
