import Phaser from 'phaser';
import { TILE } from '../data/config';
import type { DecorSpot, HouseSpot, IslandData } from '../mapgen/IslandGenerator';
import type { Rng } from '../mapgen/rng';
import { fxKey } from './AnimationRegistry';
import { depthAt } from './depth';

/** Где у спрайта «земля» (origin Y) для разных листов декора. */
const TREE_ORIGIN: Record<number, number> = { 1: 0.88, 2: 0.88, 3: 0.84, 4: 0.84 };

/** Рисует дома, деревья, кусты, камни и овец по данным генератора. */
export class IslandDecorRenderer {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  readonly houseSprites = new Map<HouseSpot, Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene, private readonly data: IslandData, private readonly rng: Rng) {}

  render(): void {
    for (const h of this.data.houses) this.house(h);
    for (const d of this.data.decor) this.decor(d);
  }

  destroy(): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
    this.houseSprites.clear();
  }

  /** Стоячий объект (дерево, дом, овца): сортируется по своему Y с учётом высоты. */
  private sort<T extends Phaser.GameObjects.Components.Depth & { x: number; y: number }>(o: T): T {
    o.setDepth(depthAt(this.data.grid, o.x, o.y));
    return o;
  }

  /** Наземный декор (кусты, камни): всегда под юнитами своей клетки, но под плато, если оно перед ним. */
  private ground<T extends Phaser.GameObjects.Components.Depth>(o: T, d: DecorSpot): T {
    o.setDepth(depthAt(this.data.grid, (d.x + 0.5) * TILE, d.y * TILE, 0.5));
    return o;
  }

  private house(h: HouseSpot): void {
    const x = (h.x + h.width / 2) * TILE;
    const y = (h.y + 1) * TILE - 6;
    const img = this.sort(this.scene.add.image(x, y, h.kind === 'barracks' ? 'barracks' : `house${h.variant}`).setOrigin(0.5, 1));
    this.objects.push(img);
    this.houseSprites.set(h, img);
  }

  private decor(d: DecorSpot): void {
    const cx = (d.x + 0.5) * TILE;
    const bottom = (d.y + 1) * TILE;
    const r = this.rng;
    switch (d.kind) {
      case 'tree': {
        const key = `tree${d.variant}`;
        const s = this.scene.add.sprite(cx + (r() - 0.5) * 12, bottom - 8, key).setOrigin(0.5, TREE_ORIGIN[d.variant]);
        s.play({ key: fxKey(key), startFrame: Math.floor(r() * 8) });
        this.objects.push(this.sort(s));
        break;
      }
      case 'bush': {
        const key = `bush${d.variant}`;
        const s = this.scene.add.sprite(cx + (r() - 0.5) * 24, bottom - 14, key).setOrigin(0.5, 0.75);
        s.play({ key: fxKey(key), startFrame: Math.floor(r() * 8) });
        this.objects.push(this.ground(s, d));
        break;
      }
      case 'rock': {
        const img = this.scene.add.image(cx + (r() - 0.5) * 24, bottom - 18, `rock${d.variant}`).setOrigin(0.5, 0.8);
        this.objects.push(this.ground(img, d));
        break;
      }
      case 'sheep': {
        const s = this.scene.add.sprite(cx, bottom - 18, 'sheep_idle').setOrigin(0.5, 0.7).setFlipX(r() < 0.5);
        const grid = this.data.grid;
        let walking = false;
        const loop = () => {
          if (!s.active) return;
          s.play(fxKey(r() < 0.6 ? 'sheep_idle' : 'sheep_grass'));
        };
        // иногда овца переходит на пару шагов (только по проходимой земле того же уровня)
        const wander = () => {
          const tx = s.x + (r() - 0.5) * 80, ty = s.y + (r() - 0.5) * 50;
          const from = [Math.floor(s.x / TILE), Math.floor((s.y + 18) / TILE)];
          const to = [Math.floor(tx / TILE), Math.floor((ty + 18) / TILE)];
          if (!grid.isWalkable(to[0], to[1]) || grid.getLevel(to[0], to[1]) !== grid.getLevel(from[0], from[1])) return false;
          walking = true;
          s.setFlipX(tx < s.x).play(fxKey('sheep_move'));
          this.scene.tweens.add({
            targets: s, x: tx, y: ty, duration: (Math.hypot(tx - s.x, ty - s.y) / 28) * 1000,
            onUpdate: () => s.setDepth(depthAt(grid, s.x, s.y)),
            onComplete: () => { walking = false; loop(); },
          });
          return true;
        };
        s.on(Phaser.Animations.Events.ANIMATION_REPEAT, () => {
          if (walking) return;
          const roll = r();
          if (roll < 0.12 && wander()) return;
          if (roll < 0.35) loop();
        });
        loop();
        this.objects.push(this.sort(s));
        break;
      }
    }
  }
}
