import Phaser from 'phaser';
import { DEPTH, TILE } from '../data/config';
import type { IslandData } from '../mapgen/IslandGenerator';

/** Отладочный слой сетки: проходимость, скалы, лестницы, точки высадки, входы в дома. */
export class DebugOverlay {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, private readonly data: IslandData) {
    this.g = scene.add.graphics().setDepth(DEPTH.ui - 10).setVisible(false);
    this.draw();
  }

  get visible(): boolean {
    return this.g.visible;
  }

  toggle(): void {
    this.g.setVisible(!this.g.visible);
  }

  destroy(): void {
    this.g.destroy();
  }

  private draw(): void {
    const { g, data } = this;
    const grid = data.grid;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const px = x * TILE, py = y * TILE;
        if (grid.stairAt(x, y)) g.fillStyle(0xffd400, 0.45).fillRect(px, py, TILE, TILE);
        else if (grid.cliffLevel(x, y)) g.fillStyle(0x7a1010, 0.45).fillRect(px, py, TILE, TILE);
        else if (grid.isBlocked(x, y)) g.fillStyle(0xff3030, 0.35).fillRect(px, py, TILE, TILE);
        else if (grid.isWalkable(x, y)) {
          const lv = grid.getLevel(x, y);
          g.fillStyle(lv === 1 ? 0x30ff60 : lv === 2 ? 0x30a0ff : 0xc060ff, 0.18).fillRect(px, py, TILE, TILE);
        }
        if (grid.getLevel(x, y) > 0 || grid.cliffLevel(x, y)) g.lineStyle(1, 0x000000, 0.2).strokeRect(px, py, TILE, TILE);
      }
    }
    for (const h of data.houses) {
      g.lineStyle(3, 0x2050ff, 0.9).strokeRect(h.doorX * TILE + 4, h.doorY * TILE + 4, TILE * 2 - 8, TILE - 8);
    }
    for (const l of data.landings) {
      const cx = (l.x + 0.5) * TILE, cy = (l.y + 0.5) * TILE;
      const fx = cx + l.dx * TILE * 2.5, fy = cy + l.dy * TILE * 2.5;
      g.lineStyle(5, 0xffffff, 0.9).lineBetween(fx, fy, cx, cy);
      g.fillStyle(0xffffff, 0.9).fillCircle(cx, cy, 10);
    }
  }
}
