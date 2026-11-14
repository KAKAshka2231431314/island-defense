import Phaser from 'phaser';
import { FOG } from '../data/balance';
import { DEPTH, TILE } from '../data/config';
import type { IslandGrid } from '../mapgen/IslandGrid';
import { distanceField } from '../mapgen/connectivity';
import type { Rng } from '../mapgen/rng';

let fogId = 0;

/**
 * Туман над морем, как в Bad North: у берега чисто, дальше в море — молочная дымка,
 * из которой выплывают лодки. Плюс медленно ползущие клочья тумана над водой.
 */
export class Fog {
  private readonly key: string;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  /** sheet: false — только клочья тумана, без сплошной дымки (в меню дымка рисуется градиентом поверх экрана). */
  constructor(private readonly scene: Phaser.Scene, grid: IslandGrid, rng: Rng, opts: { sheet?: boolean } = {}) {
    this.key = `fog_${fogId++}`;
    if (opts.sheet !== false) this.buildSheet(grid);
    this.buildWisps(grid, rng);
  }

  private buildSheet(grid: IslandGrid): void {
    const scene = this.scene;
    const M = FOG.margin;
    const W = grid.w + M * 2, H = grid.h + M * 2;
    // расстояние (в клетках) от каждой клетки до ближайшей суши
    const dist = distanceField(W, H, (x, y) => grid.getLevel(x - M, y - M) >= 1 || grid.cliffLevel(x - M, y - M) > 0);
    // текстура «1 пиксель = 1 клетка», растягивается со сглаживанием → мягкий градиент
    const tex = scene.textures.createCanvas(this.key, W, H)!;
    const ctx = tex.getContext();
    const img = ctx.createImageData(W, H);
    const [r, g, b] = [(FOG.color >> 16) & 255, (FOG.color >> 8) & 255, FOG.color & 255];
    for (let i = 0; i < W * H; i++) {
      const d = dist[i];
      const t = Phaser.Math.Clamp((d - FOG.clearDist) / (FOG.fullDist - FOG.clearDist), 0, 1);
      const a = t * t * (3 - 2 * t) * FOG.maxAlpha; // smoothstep
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Math.round(a * 255);
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    const sheet = scene.add.image(-M * TILE, -M * TILE, this.key).setOrigin(0).setScale(TILE).setDepth(DEPTH.ui - 300);
    this.objects.push(sheet);
  }

  private buildWisps(grid: IslandGrid, rng: Rng): void {
    const scene = this.scene;
    // клочья тумана над водой (облака из пака, светлые и полупрозрачные)
    const worldW = grid.w * TILE, worldH = grid.h * TILE;
    for (let i = 0; i < FOG.wisps; i++) {
      const c = scene.add.image(0, 0, `cloud${(i % 8) + 1}`)
        .setTint(FOG.color).setAlpha(FOG.wispAlpha).setScale(1 + rng() * 0.8).setDepth(DEPTH.ui - 299);
      const place = () => {
        // по краю мира: сверху/снизу/слева/справа от острова
        const side = Math.floor(rng() * 4);
        const along = rng();
        const out = (FOG.clearDist + 2 + rng() * 5) * TILE;
        if (side === 0) c.setPosition(-out + along * (worldW + out * 2), -out * 0.6);
        else if (side === 1) c.setPosition(-out + along * (worldW + out * 2), worldH + out * 0.6);
        else if (side === 2) c.setPosition(-out, along * worldH);
        else c.setPosition(worldW + out, along * worldH);
      };
      place();
      const drift = () => {
        scene.tweens.add({
          targets: c, x: c.x + (rng() - 0.3) * 260, y: c.y + (rng() - 0.5) * 80, alpha: FOG.wispAlpha * (0.6 + rng() * 0.6),
          duration: 9000 + rng() * 9000, ease: 'Sine.easeInOut',
          onComplete: () => { if (rng() < 0.25) place(); drift(); },
        });
      };
      drift();
      this.objects.push(c);
    }
  }

  destroy(): void {
    this.objects.forEach((o) => o.destroy());
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }
}
