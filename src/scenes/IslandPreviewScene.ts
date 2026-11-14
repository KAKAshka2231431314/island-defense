import Phaser from 'phaser';
import { TILE, WATER_COLOR } from '../data/config';
import { generateIsland } from '../mapgen/IslandGenerator';
import { mulberry32 } from '../mapgen/rng';
import { IslandDecorRenderer } from '../systems/IslandDecorRenderer';
import { TerrainRenderer } from '../systems/TerrainRenderer';

/** Рамка окошка и отметки мест высадки. */
const FRAME_COLOR = 0x3d2718;
const FRAME_PX = 3;
const LANDING_COLOR = 0xe0402a;
/** Поля вокруг острова в окошке, доля размера суши. */
const MARGIN = 0.06;

export interface PreviewRect { x: number; y: number; w: number; h: number }

/**
 * Предпросмотр острова в окне подготовки к бою: тот же остров, что будет в бою (рельеф, лестницы, дома,
 * деревья), с отметками мест высадки. Сцена запускается поверх карты кампании; камера — окошко в rect.
 */
export class IslandPreviewScene extends Phaser.Scene {
  constructor() {
    super('IslandPreview');
  }

  create(data: { seed: number; rect: PreviewRect }): void {
    const island = generateIsland(data.seed);
    const rng = mulberry32(data.seed);
    const g = island.grid;
    new TerrainRenderer(this, g, rng).render();
    new IslandDecorRenderer(this, island, rng).render();

    // места высадки — красные стрелки с моря к берегу
    const marks = this.add.graphics().setDepth(1e7);
    for (const l of island.landings) {
      const cx = (l.x + 0.5 + l.dx * 1.4) * TILE, cy = (l.y + 0.5 + l.dy * 1.4) * TILE;
      const px = -l.dy, py = l.dx;
      marks.fillStyle(LANDING_COLOR, 1).lineStyle(6, 0xffffff, 0.9);
      const tip = { x: cx - l.dx * 30, y: cy - l.dy * 30 };
      const a = { x: cx + l.dx * 18 + px * 24, y: cy + l.dy * 18 + py * 24 };
      const b = { x: cx + l.dx * 18 - px * 24, y: cy + l.dy * 18 - py * 24 };
      marks.strokeTriangle(tip.x, tip.y, a.x, a.y, b.x, b.y).fillTriangle(tip.x, tip.y, a.x, a.y, b.x, b.y);
    }

    // камера — окошко в окне подготовки, остров целиком
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (g.getLevel(x, y) < 1) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
    }
    const lw = (x1 - x0 + 2) * TILE, lh = (y1 - y0 + 2.5) * TILE;
    const r = data.rect;
    const cam = this.cameras.main;
    cam.setViewport(r.x, r.y, r.w, r.h).setBackgroundColor(WATER_COLOR);
    cam.setZoom(Math.min(r.w / lw, r.h / lh) * (1 - MARGIN));
    cam.centerOn(((x0 + x1) / 2) * TILE, ((y0 + y1) / 2 - 0.25) * TILE);
    cam.fadeIn(250);

    // рамка поверх — отдельной камерой без масштаба
    const ui = this.cameras.add(0, 0, this.scale.width, this.scale.height).setName('frame');
    const frame = this.add.graphics().lineStyle(FRAME_PX, FRAME_COLOR, 1).strokeRect(r.x - FRAME_PX / 2, r.y - FRAME_PX / 2, r.w + FRAME_PX, r.h + FRAME_PX);
    cam.ignore(frame);
    ui.ignore(this.children.list.filter((o) => o !== frame));
  }
}
