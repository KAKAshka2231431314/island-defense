import Phaser from 'phaser';
import { AI, ENEMY_UNITS, WAVES } from '../data/balance';
import { TILE } from '../data/config';
import { Boat } from '../entities/Boat';
import type { Point, Unit } from '../entities/Unit';
import type { LandingPoint } from '../mapgen/IslandGenerator';
import { randInt, type Rng } from '../mapgen/rng';
import type { BattleWorld } from './BattleWorld';
import { sfx } from './Sound';
import { waterPath, type WavePlan } from './WavePlanner';

export { planWaves } from './WavePlanner';

/**
 * Запускает волны по плану, ведёт лодки и высаживает врагов. Десант — настоящие враги с самого начала:
 * сидят в лодке (по ним можно стрелять, стрелки бьют с палубы), высаживаются, собираются у берега.
 * Когда от десанта волны остаётся ≤ AI.retreatFraction, выжившие отступают к своим лодкам и уплывают.
 */
export class WaveManager {
  readonly boats: Boat[] = [];
  waveIndex = -1;
  private timer: number = WAVES.firstDelay;
  private waveTime = 0;
  private waveTotal = 0;
  /** десант каждой волны (для отступления) */
  private readonly waveCrew: Unit[][] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: BattleWorld,
    readonly plans: WavePlan[],
    private readonly rng: Rng,
  ) {
    world.boats = this.boats;
  }

  get totalWaves(): number {
    return this.plans.length;
  }

  /** Секунд до первой волны (для таймера на экране). */
  get countdown(): number {
    return this.waveIndex < 0 ? Math.max(0, this.timer) : 0;
  }

  get allSpawned(): boolean {
    return this.waveIndex >= this.plans.length - 1 && !this.boats.some((b) => b.pending);
  }

  /** Все волны высажены, врагов не осталось (отступившие уплыли). */
  get finished(): boolean {
    return this.allSpawned && !this.world.units.some((u) => u.team === 'enemy' && u.alive);
  }

  /** Лодки, которые ещё плывут к острову (для стрелок-предупреждений). */
  get incoming(): Boat[] {
    return this.boats.filter((b) => b.state === 'sailing');
  }

  /** Куда приплывут лодки следующей волны (для предупреждений до её начала). */
  nextLandings(): LandingPoint[] {
    const next = this.plans[this.waveIndex + 1];
    return next ? next.boats.map((b) => this.world.island.landings[b.landing]) : [];
  }

  update(dt: number): void {
    this.timer -= dt;
    this.waveTime += dt;
    for (const b of this.boats) b.update(dt, this.world.time, (u, at) => this.unload(u, at));
    for (let i = this.boats.length - 1; i >= 0; i--) if (this.boats[i].state === 'gone') this.boats.splice(i, 1);
    this.checkRetreat();

    if (this.waveIndex >= this.plans.length - 1) return;
    let ready: boolean;
    if (this.waveIndex < 0) {
      ready = this.timer <= 0;
    } else {
      const pending = this.boats.some((b) => b.pending);
      const alive = this.world.units.filter((u) => u.team === 'enemy' && u.alive).length;
      ready = !pending && this.waveTime >= WAVES.minGap
        && (alive <= this.waveTotal * WAVES.nextWhenAliveFraction || this.waveTime >= WAVES.maxWaveTime);
    }
    if (ready) this.startWave(this.waveIndex + 1);
  }

  /** Отступление: от десанта волны осталось мало — его лодки забирают выживших. */
  private checkRetreat(): void {
    this.waveCrew.forEach((crew) => {
      if (crew.length < 3) return;
      const boats = new Set(crew.map((u) => u.homeBoat).filter((b): b is Boat => !!b));
      if ([...boats].some((b) => b.retreating || b.pending)) return;
      const alive = crew.filter((u) => u.alive).length;
      if (alive === 0 || alive > Math.floor(crew.length * AI.retreatFraction)) return;
      for (const b of boats) b.retreating = true;
    });
  }

  /** Тупик (долго никто никого не бьёт): все десанты отступают к лодкам. Возвращает, было ли кому. */
  retreatAll(): boolean {
    let any = false;
    for (const b of this.boats) {
      if (b.ashore > 0) { b.retreating = true; any = true; }
    }
    return any;
  }

  private startWave(i: number): void {
    this.waveIndex = i;
    this.waveTime = 0;
    const plan = this.plans[i];
    this.waveTotal = plan.boats.reduce((s, b) => s + b.cargo.length, 0);
    const crew: Unit[] = [];
    for (const b of plan.boats) {
      const landing = this.world.island.landings[b.landing];
      const path = waterPath(this.world.island.grid, landing);
      // несколько лодок к одному берегу: разъезжаются вдоль берега и подходят по очереди
      if (b.slot > 0) {
        const side = b.slot % 2 ? 1 : -1, k = Math.ceil(b.slot / 2) * WAVES.boatLateral * side;
        const last = path[path.length - 1];
        const shifted = { x: last.x - landing.dy * k, y: last.y + landing.dx * k };
        const g = this.world.grid, cx = Math.floor(shifted.x / TILE), cy = Math.floor(shifted.y / TILE);
        if (g.inBounds(cx, cy) && g.isWater(cx, cy) && g.cliffLevel(cx, cy) === 0) {
          const before = path[path.length - 2];
          const bend = before.x === last.x ? { x: last.x, y: shifted.y } : { x: shifted.x, y: last.y };
          const bx = Math.floor(bend.x / TILE), by = Math.floor(bend.y / TILE);
          if (g.inBounds(bx, by) && g.isWater(bx, by) && g.cliffLevel(bx, by) === 0) path.splice(-1, 1, bend, shifted);
        }
      }
      const boat = new Boat(this.scene, path, landing, b.slot * WAVES.boatStagger);
      for (const type of b.cargo) {
        const u = this.world.spawnUnit('enemy', type, { ...ENEMY_UNITS[type] }, boat.x, boat.y);
        u.homeBoat = boat;
        boat.board(u);
        crew.push(u);
      }
      this.boats.push(boat);
    }
    this.waveCrew.push(crew);
    sfx.play('horn');
    this.scene.events.emit('waveStarted', i);
  }

  /** Враг сходит с лодки на берег и чуть вглубь, там ждёт остальных (AI.gatherSec). */
  private unload(u: Unit, at: Point): void {
    const l = u.homeBoat!.landing;
    u.x = at.x;
    u.y = at.y;
    u.aiTag = 'landing';
    const jitter = () => (this.rng() - 0.5) * 40;
    u.navGoal = { x: (l.x + 0.5 - l.dx * 0.6) * TILE + jitter(), y: (l.y + 0.5 - l.dy * 0.6) * TILE + jitter() };
    u.lookAt(u.navGoal);
    u.thinkLeft = 0.4 + randInt(this.rng, 0, 3) * 0.1;
  }

  destroy(): void {
    this.boats.forEach((b) => b.destroy());
  }
}
