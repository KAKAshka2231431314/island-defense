import Phaser from 'phaser';
import { PROJECTILE_HIT, PROJECTILES, type ProjectileKind } from '../data/balance';
import { DEPTH } from '../data/config';
import { fxKey } from '../systems/AnimationRegistry';
import type { Team, Unit } from './Unit';

/** Поворот картинки снаряда относительно направления полёта (картинка гарпуна нарисована ↗). */
const ROT_OFFSET: Partial<Record<ProjectileKind, number>> = { harpoon: Math.PI / 4 };
/** Снаряд летит по дуге из (sx, sy) в (tx, ty) за фиксированное время. */
export class Projectile {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly sx: number;
  readonly sy: number;
  readonly duration: number;
  readonly arcHeight: number;
  t = 0;
  landed = false;
  /** после попадания мимо стрела торчит в земле */
  stuckLeft = 0;
  x: number;
  y: number;

  constructor(
    scene: Phaser.Scene,
    readonly kind: ProjectileKind,
    readonly team: Team,
    readonly owner: Unit,
    readonly target: Unit | null,
    readonly tx: number,
    readonly ty: number,
    readonly damage: number,
    readonly areaRadius = 0,
  ) {
    // вылетает из «рук», а не из ног
    this.sx = owner.x + owner.facing * 10;
    this.sy = owner.y - 26;
    this.x = this.sx;
    this.y = this.sy;
    const def = PROJECTILES[kind];
    const dist = Math.hypot(tx - this.sx, ty - this.sy);
    this.duration = Math.max(0.15, dist / def.speed);
    this.arcHeight = dist * def.arc;
    const tex = kind === 'arrow' ? 'arrow' : kind === 'harpoon' ? 'harpoon' : kind === 'dynamite' ? 'dynamite' : 'shaman_projectile';
    this.sprite = scene.add.sprite(this.sx, this.sy, tex).setDepth(DEPTH.objects + 5000);
    if (kind === 'arrow') this.sprite.setScale(0.75);
    if (kind === 'dynamite') this.sprite.play(fxKey('dynamite'));
    if (kind === 'shaman_orb') this.sprite.play(fxKey('shaman_projectile')).setScale(0.6);
  }

  /** Возвращает true в момент приземления. */
  update(dt: number): boolean {
    if (this.landed) {
      this.stuckLeft -= dt;
      const fade = PROJECTILE_HIT.stuckFadeSec;
      if (this.stuckLeft < fade) this.sprite.setAlpha(Math.max(0, this.stuckLeft / fade));
      return false;
    }
    this.t += dt;
    const p = Math.min(1, this.t / this.duration);
    const gx = this.sx + (this.tx - this.sx) * p;
    const gy = this.sy + (this.ty - this.sy) * p;
    const lift = this.arcHeight * 4 * p * (1 - p);
    const nx = gx, ny = gy - lift;
    const ang = Math.atan2(ny - this.y, nx - this.x);
    this.x = nx;
    this.y = ny;
    this.sprite.setPosition(nx, ny);
    if (this.kind === 'arrow' || this.kind === 'harpoon') this.sprite.setRotation(ang + (ROT_OFFSET[this.kind] ?? 0));
    if (p >= 1) {
      this.landed = true;
      return true;
    }
    return false;
  }

  /** Оставить снаряд в земле на время (промах). */
  stick(seconds: number, depth: number): void {
    this.stuckLeft = seconds;
    this.sprite.setDepth(depth);
  }

  /** Отскок от щита: снаряд падает в землю перед щитом, наклонённый как попало. */
  deflect(x: number, y: number, seconds: number, depth: number): void {
    this.sprite.setPosition(x, y).setRotation(this.sprite.rotation + Math.PI * (0.65 + Math.random() * 0.5));
    this.stick(seconds, depth);
  }

  get finished(): boolean {
    return this.landed && this.stuckLeft <= 0;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
