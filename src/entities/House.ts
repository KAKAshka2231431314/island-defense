import Phaser from 'phaser';
import { HOUSE } from '../data/balance';
import { DEPTH, TILE } from '../data/config';
import type { HouseSpot } from '../mapgen/IslandGenerator';
import { fxKey } from '../systems/AnimationRegistry';
import type { Squad } from './Squad';
import type { Point } from './Unit';

export type HouseState = 'intact' | 'burning' | 'destroyed';

/** Дом на острове: его поджигают враги; в нём отряд восстанавливает погибших солдат. */
/** Период пульсации значка угрозы над незащищённым домом, мс. */
const THREAT_PULSE_MS = 700;
/** Сгоревшая казарма — затемнённый спрайт (отдельной картинки в паке нет). */
const BURNT_TINT = 0x4a3c36;

export class House {
  state: HouseState = 'intact';
  /** 0..1 — прогресс поджога врагами */
  ignite = 0;
  /** рядом наш отряд (ставит BattleWorld) — значок угрозы не пульсирует */
  defended = false;
  /** о пожаре уже объявлено (BattleWorld шлёт houseIgnited один раз) */
  fireAnnounced = false;
  burnLeft = 0;
  occupant: Squad | null = null;
  healTimer = 0;
  readonly door: Point;
  readonly center: Point;
  private readonly fires: Phaser.GameObjects.Sprite[] = [];
  private readonly igniteBar: Phaser.GameObjects.Graphics;
  private threatIcon: Phaser.GameObjects.Sprite | null = null;
  private keyMark: Phaser.GameObjects.Graphics | null = null;

  constructor(private readonly scene: Phaser.Scene, readonly spot: HouseSpot, readonly sprite: Phaser.GameObjects.Image) {
    this.door = { x: (spot.doorX + 1) * TILE, y: (spot.doorY + 0.35) * TILE };
    this.center = { x: (spot.x + spot.width / 2) * TILE, y: (spot.y + 0.5) * TILE };
    this.igniteBar = scene.add.graphics().setDepth(DEPTH.ui - 15);
  }

  get value(): number {
    if (this.spot.kind === 'barracks') return HOUSE.barracksCoins;
    if (this.spot.kind === 'castle') return 0;
    return HOUSE.coinsByVariant[this.spot.variant] ?? 3;
  }

  get alive(): boolean {
    return this.state === 'intact';
  }

  setKeyHouse(): void {
    const g = this.scene.add.graphics().setPosition(this.sprite.x, this.sprite.y - 142).setScale(1.4).setDepth(DEPTH.ui - 14);
    g.fillStyle(0xffd84a, 1).lineStyle(3, 0x3d2718, 1);
    g.fillTriangle(0, -12, 10, 0, 0, 12).fillTriangle(0, -12, -10, 0, 0, 12);
    g.strokeTriangle(0, -12, 10, 0, 0, 12).strokeTriangle(0, -12, -10, 0, 0, 12);
    this.keyMark = g;
  }

  /** Клик попал в сам дом (спрайт или клетки основания; ряд входа под домом — уже земля для приказов). */
  contains(x: number, y: number): boolean {
    const b = this.sprite.getBounds();
    const inSprite = x >= b.left + 14 && x <= b.right - 14 && y >= b.top + 40 && y <= b.bottom - 8;
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    const inCells = cx >= this.spot.x && cx < this.spot.x + this.spot.width && (cy === this.spot.y || cy === this.spot.y - 1);
    return inSprite || inCells;
  }

  /** Враги у двери продвигают поджог. Возвращает true, если дом загорелся. */
  addIgnite(amount: number): boolean {
    if (this.state !== 'intact') return false;
    this.ignite = Math.min(1, this.ignite + amount);
    if (this.ignite >= 1) {
      this.setOnFire();
      return true;
    }
    return false;
  }

  setOnFire(): void {
    this.state = 'burning';
    this.burnLeft = this.spot.kind === 'castle' ? HOUSE.castleBurnTime : HOUSE.burnTime;
    const wide = this.spot.kind === 'barracks' || this.spot.kind === 'castle';
    const spots = wide
      ? [[-60, -60], [40, -90], [-10, -130], [64, -40], [-40, -20], [20, -30], [70, -110]]
      : [[-30, -50], [22, -70], [-4, -100], [30, -30], [-26, -20]];
    spots.forEach(([dx, dy], i) => {
      const key = `fire${(i % 3) + 1}`;
      const f = this.scene.add.sprite(this.sprite.x + dx, this.sprite.y + dy, `fx_fire${(i % 3) + 1}`)
        .setOrigin(0.5, 1).setDepth(this.sprite.depth + 1);
      f.play({ key: fxKey(key), startFrame: i });
      this.fires.push(f);
    });
  }

  /** Возвращает true в момент, когда дом сгорел. */
  update(dt: number): boolean {
    if (this.keyMark) {
      this.keyMark.setPosition(this.sprite.x, this.sprite.y - 142)
        .setAlpha(0.7 + 0.3 * Math.sin(this.scene.time.now / 300)).setVisible(this.state === 'intact');
    }
    this.drawIgnite();
    if (this.state !== 'burning') return false;
    this.burnLeft -= dt;
    if (this.burnLeft <= 0) {
      this.state = 'destroyed';
      // сгоревшей казармы в паке нет — тёмный остов
      if (this.spot.kind === 'castle') this.sprite.setTexture('castle_destroyed');
      else if (this.spot.kind === 'barracks') this.sprite.setTint(BURNT_TINT);
      else this.sprite.setTexture('house_destroyed');
      // от пожара остаётся пара угольков
      this.fires.forEach((f, i) => {
        if (i < 2) f.setScale(0.6).setPosition(this.sprite.x + (i ? 18 : -20), this.sprite.y - 6);
        else f.destroy();
      });
      this.fires.splice(2);
      return true;
    }
    return false;
  }

  /** Потухание поджога, если враги ушли. */
  coolDown(amount: number): void {
    if (this.state === 'intact') this.ignite = Math.max(0, this.ignite - amount);
  }

  /** Полоса поджога над домом и значок огня слева; пульсирует, если дом никто не защищает. */
  private drawIgnite(): void {
    const g = this.igniteBar;
    g.clear();
    if (this.state !== 'intact' || this.ignite <= 0) {
      this.threatIcon?.setVisible(false);
      return;
    }
    const w = 56, x = this.sprite.x - w / 2 + 8, y = this.sprite.y - 150;
    const pulse = this.defended ? 1 : 0.6 + 0.4 * Math.sin(this.scene.time.now / THREAT_PULSE_MS * Math.PI * 2);
    g.fillStyle(0x0f1a20, 0.7).fillRoundedRect(x - 2, y - 2, w + 4, 9, 3);
    g.fillStyle(0xff7a1a, pulse).fillRect(x, y, w * this.ignite, 5);
    if (!this.threatIcon) {
      this.threatIcon = this.scene.add.sprite(0, 0, 'fx_fire1').setOrigin(0.5, 0.8).setScale(0.42).setDepth(DEPTH.ui - 15);
      this.threatIcon.play(fxKey('fire1'));
    }
    this.threatIcon.setVisible(true).setPosition(x - 12, y + 6).setAlpha(pulse);
  }

  destroy(): void {
    this.fires.forEach((f) => f.destroy());
    this.igniteBar.destroy();
    this.threatIcon?.destroy();
    this.keyMark?.destroy();
  }
}
